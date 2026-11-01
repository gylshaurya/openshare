// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";

import {OpenShareCore} from "../src/core/OpenShareCore.sol";
import {BondVault} from "../src/core/BondVault.sol";
import {RoleRegistry} from "../src/registry/RoleRegistry.sol";
import {PriceOracle} from "../src/oracle/PriceOracle.sol";
import {AttestedPledgeVerifier} from "../src/verifiers/AttestedPledgeVerifier.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";
import {PledgeFacts, Role, Types} from "../src/libraries/Types.sol";

/// @notice Seeds demo actors on a fresh deployment (local anvil, or testnet with MockUSDT).
///         Actors are derived from DEMO_MNEMONIC (default: anvil's mnemonic):
///         0 admin/deployer · 1 relayer · 2 world attestor · 3 mock attestor · 4 kite attestor
///         5 broker X (pledgee "ZERODHA-MARGIN") · 6 broker Y (CDSL BO id) · 7 Alice · 8 Dev (LP minter) · 9 Bob · 10 Carol
contract Seed is Script {
    string constant DEFAULT_MNEMONIC = "test test test test test test test test test test test junk";

    struct Ctx {
        OpenShareCore core;
        RoleRegistry roles;
        PriceOracle oracle;
        BondVault vault;
        AttestedPledgeVerifier attested;
        MockUSDT usdt;
        PoolModifyLiquidityTest lpRouter;
        address hook;
        bytes32 asset;
        address token;
    }

    function key(uint32 i) internal view returns (uint256) {
        return vm.deriveKey(vm.envOr("DEMO_MNEMONIC", DEFAULT_MNEMONIC), i);
    }

    function run() external {
        string memory json =
            vm.readFile(string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json"));
        Ctx memory c;
        c.core = OpenShareCore(vm.parseJsonAddress(json, ".core"));
        c.roles = RoleRegistry(vm.parseJsonAddress(json, ".roles"));
        c.oracle = PriceOracle(vm.parseJsonAddress(json, ".oracle"));
        c.vault = BondVault(vm.parseJsonAddress(json, ".vault"));
        c.attested = AttestedPledgeVerifier(vm.parseJsonAddress(json, ".attestedVerifier"));
        c.usdt = MockUSDT(vm.parseJsonAddress(json, ".usdt"));
        c.lpRouter = PoolModifyLiquidityTest(vm.parseJsonAddress(json, ".lpRouter"));
        c.hook = vm.parseJsonAddress(json, ".hook");
        c.asset = vm.parseJsonBytes32(json, ".assets[0].assetId");
        c.token = vm.parseJsonAddress(json, ".assets[0].token");
        require(vm.parseJsonBool(json, ".mockUsdt"), "Seed requires MockUSDT (fund actors manually otherwise)");

        uint256 admin = vm.envOr("DEPLOYER_PRIVATE_KEY", key(0));
        address brokerY = vm.addr(key(6));
        address dev = vm.addr(key(8));

        // 1. Admin: fund everyone with gas (testnets) and mock USDT; register attestor kinds.
        vm.startBroadcast(admin);
        // Top each actor up to a target balance (Whitechain gas is ~10 gwei; Dev's pledge + mint + LP ≈ 1.7M gas).
        uint256 gasTarget = vm.envOr("DEMO_GAS_TARGET_WEI", uint256(0.01 ether));
        for (uint32 i = 1; i <= 10; ++i) {
            address a = vm.addr(key(i));
            uint256 target = i == 1 ? gasTarget * 5 : i == 8 ? gasTarget * 3 : gasTarget; // relayer pushes prices all day
            if (a.balance < target) payable(a).transfer(target - a.balance);
        }
        for (uint32 i = 5; i <= 10; ++i) {
            if (c.usdt.balanceOf(vm.addr(key(i))) < 100_000e6) c.usdt.mint(vm.addr(key(i)), 250_000e6);
        }
        c.attested.setAttestor(vm.addr(key(3)), Types.KIND_MOCK);
        c.attested.setAttestor(vm.addr(key(4)), Types.KIND_KITE);
        c.roles.grantRole(c.roles.WORLD_ATTESTOR_ROLE(), vm.addr(key(2)));
        c.oracle.grantRole(c.oracle.RELAYER_ROLE(), vm.addr(key(1)));
        vm.stopBroadcast();

        // 2. Relayer: a first session close so deadlines/closes have a reference.
        vm.startBroadcast(key(1));
        if (c.oracle.currentSessionId() == 0) {
            bytes32[] memory ids = c.core.getAssetIds();
            PriceOracle.SessionClose[] memory closes = new PriceOracle.SessionClose[](ids.length);
            for (uint256 i; i < ids.length; ++i) {
                (, uint256 inr, uint256 usdInr,,,,,,) = c.oracle.prices(ids[i]);
                closes[i] = PriceOracle.SessionClose(ids[i], inr, usdInr, true);
            }
            c.oracle.closeSession(1, closes, false);
        }
        vm.stopBroadcast();

        // 3. Roles via World attestor signatures (demo identities; production uses IDKit, SPEC §10.3).
        _role(c, 5, Role.Broker);
        _role(c, 6, Role.Broker);
        _role(c, 7, Role.Minter);
        _role(c, 8, Role.Minter);

        // 4. Brokers register and bond (idempotent: skips steps already on-chain).
        _broker(c, 5, keccak256("ZERODHA-MARGIN"), "Broker X (Zerodha margin stand-in)");
        _broker(c, 6, keccak256("1208160000000001"), "Broker Y (CDSL BO 1208160000000001)");

        // 5. Dev (market maker): mock pledge of 1,000 RELIANCE to Y, accepted, mints 400, seeds the pool.
        if (c.core.pledgesOf(dev).length > 0) {
            console2.log("Dev already has a pledge; skipping step 5");
            return;
        }
        PledgeFacts memory f = PledgeFacts({
            pledgeRef: keccak256(abi.encodePacked("SEED-DEV-", block.timestamp)),
            assetId: c.asset,
            quantity: 1_000,
            pledgorIdHash: keccak256("DEV-CLIENT"),
            pledgeeIdHash: keccak256("1208160000000001"),
            status: Types.STATUS_CONFIRMED,
            observedAt: uint64(block.timestamp),
            wallet: dev,
            kind: Types.KIND_MOCK
        });
        bytes memory proof = _signFacts(c, f, key(3));
        vm.startBroadcast(key(8));
        if (c.usdt.allowance(dev, address(c.core)) == 0) c.usdt.approve(address(c.core), type(uint256).max);
        uint256 pid = c.core.registerPledge(address(c.attested), proof, brokerY);
        vm.stopBroadcast();
        vm.broadcast(key(6));
        c.core.acceptPledge(pid);

        vm.startBroadcast(key(8));
        c.core.mint(pid, 400);
        IERC20(c.token).approve(address(c.lpRouter), type(uint256).max);
        c.usdt.approve(address(c.lpRouter), type(uint256).max);
        // Full-range liquidity ≈ 250 shares + 4,000 USDT at $16.
        c.lpRouter.modifyLiquidity(
            _poolKey(c.token, address(c.usdt), c.hook),
            IPoolManager.ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(60),
                tickUpper: TickMath.maxUsableTick(60),
                liquidityDelta: 1e15,
                salt: 0
            }),
            ""
        );
        vm.stopBroadcast();

        console2.log("Seeded. Dev pledge", pid);
    }

    function _broker(Ctx memory c, uint32 idx, bytes32 pledgee, string memory name) internal {
        address who = vm.addr(key(idx));
        (OpenShareCore.BrokerStatus st,,,) = c.core.getBroker(who);
        vm.startBroadcast(key(idx));
        if (st == OpenShareCore.BrokerStatus.None) c.core.registerBroker(pledgee, name);
        if (c.usdt.allowance(who, address(c.vault)) == 0) c.usdt.approve(address(c.vault), type(uint256).max);
        if (c.vault.bond(who) == 0) c.vault.deposit(60_000e6);
        if (c.usdt.allowance(who, address(c.core)) == 0) c.usdt.approve(address(c.core), type(uint256).max);
        vm.stopBroadcast();
    }

    function _role(Ctx memory c, uint32 idx, Role role) internal {
        address wallet = vm.addr(key(idx));
        if (c.roles.roleOf(wallet) != Role.None) return;
        RoleRegistry.RoleAttestation memory att = RoleRegistry.RoleAttestation({
            wallet: wallet,
            role: uint8(role),
            nullifierHash: uint256(keccak256(abi.encodePacked("demo-human-", idx))),
            expiresAt: uint64(block.timestamp + 1 days)
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key(2), c.roles.hashAttestation(att));
        vm.broadcast(key(idx));
        c.roles.register(att, abi.encodePacked(r, s, v));
    }

    function _signFacts(Ctx memory c, PledgeFacts memory f, uint256 pk) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, c.attested.hashFacts(f));
        return abi.encode(f, abi.encodePacked(r, s, v));
    }

    function _poolKey(address token, address usdt, address hook) internal pure returns (PoolKey memory) {
        (address a, address b) = token < usdt ? (token, usdt) : (usdt, token);
        return PoolKey({
            currency0: Currency.wrap(a),
            currency1: Currency.wrap(b),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(hook)
        });
    }
}
