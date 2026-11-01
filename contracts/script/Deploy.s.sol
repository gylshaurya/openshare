// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";

import {OpenShareCore} from "../src/core/OpenShareCore.sol";
import {BondVault} from "../src/core/BondVault.sol";
import {TokenFactory} from "../src/core/TokenFactory.sol";
import {RoleRegistry} from "../src/registry/RoleRegistry.sol";
import {ComplianceRegistry} from "../src/registry/ComplianceRegistry.sol";
import {PriceOracle} from "../src/oracle/PriceOracle.sol";
import {AttestedPledgeVerifier} from "../src/verifiers/AttestedPledgeVerifier.sol";
import {ReclaimPledgeVerifier} from "../src/verifiers/ReclaimPledgeVerifier.sol";
import {OpenShareHook} from "../src/hook/OpenShareHook.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";
import {Types} from "../src/libraries/Types.sol";

/// @notice Deploys the full OpenShare stack (protocol + Uniswap v4 + hook + pools) and writes
///         ../deployments/<chainId>.json. SPEC §16 Phase 4.
/// Env:
///   DEPLOYER_PRIVATE_KEY (required)
///   USDT_ADDRESS          (optional; empty => deploy MockUSDT)
///   RELAYER_ADDRESS, WORLD_ATTESTOR_ADDRESS, KITE_ATTESTOR_ADDRESS, MOCK_ATTESTOR_ADDRESS (optional; default deployer)
///   RECLAIM_ATTESTOR_ADDRESS (optional; default Reclaim's 0x2448…9072)
///   DEMO_PARAMS=true      (short attestation windows and minRedeemShares=1 for live demos)
contract Deploy is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant RECLAIM_ATTESTOR = 0x244897572368Eadf65bfBc5aec98D8e5443a9072;

    struct Listing {
        string isin;
        string symbol;
        string name;
        uint256 inrPaise;
    }

    struct Deployed {
        address usdt;
        bool mockUsdt;
        ComplianceRegistry compliance;
        RoleRegistry roles;
        PriceOracle oracle;
        BondVault vault;
        TokenFactory factory;
        OpenShareCore core;
        AttestedPledgeVerifier attested;
        ReclaimPledgeVerifier reclaim;
        PoolManager manager;
        PoolSwapTest swapRouter;
        PoolModifyLiquidityTest lpRouter;
        OpenShareHook hook;
    }

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address relayer = vm.envOr("RELAYER_ADDRESS", deployer);
        address worldAttestor = vm.envOr("WORLD_ATTESTOR_ADDRESS", deployer);
        address kiteAttestor = vm.envOr("KITE_ATTESTOR_ADDRESS", address(0));
        address mockAttestor = vm.envOr("MOCK_ATTESTOR_ADDRESS", address(0));
        address reclaimAttestor = vm.envOr("RECLAIM_ATTESTOR_ADDRESS", RECLAIM_ATTESTOR);
        bool demo = vm.envOr("DEMO_PARAMS", false);
        address usdtAddr = vm.envOr("USDT_ADDRESS", address(0));

        Deployed memory d;
        vm.startBroadcast(pk);

        if (usdtAddr == address(0)) {
            usdtAddr = address(new MockUSDT());
            d.mockUsdt = true;
        }
        d.usdt = usdtAddr;
        require(MockUSDT(usdtAddr).decimals() == 6, "USDT must have 6 decimals");

        d.compliance = new ComplianceRegistry(deployer);
        d.roles = new RoleRegistry(deployer);
        d.oracle = new PriceOracle(deployer);
        d.vault = new BondVault(IERC20(usdtAddr));
        d.factory = new TokenFactory();
        d.core = new OpenShareCore(
            deployer,
            IERC20(usdtAddr),
            d.roles,
            d.compliance,
            IPriceOracle(address(d.oracle)),
            d.vault,
            d.factory,
            _params(demo)
        );
        d.vault.setCore(address(d.core));

        d.attested = new AttestedPledgeVerifier(deployer);
        if (kiteAttestor != address(0)) d.attested.setAttestor(kiteAttestor, Types.KIND_KITE);
        if (mockAttestor != address(0)) d.attested.setAttestor(mockAttestor, Types.KIND_MOCK);
        address[] memory ra = new address[](1);
        ra[0] = reclaimAttestor;
        d.reclaim = new ReclaimPledgeVerifier(deployer, ra);
        d.core.setVerifier(address(d.attested), true);
        d.core.setVerifier(address(d.reclaim), true);

        d.roles.grantRole(d.roles.WORLD_ATTESTOR_ROLE(), worldAttestor);
        d.oracle.grantRole(d.oracle.RELAYER_ROLE(), relayer);
        if (relayer != deployer) d.oracle.grantRole(d.oracle.RELAYER_ROLE(), deployer);
        if (demo) d.oracle.setMaxPriceAge(1 hours);

        // Uniswap v4 (not deployed on the target chain; SPEC D20).
        d.manager = new PoolManager(deployer);
        d.swapRouter = new PoolSwapTest(d.manager);
        d.lpRouter = new PoolModifyLiquidityTest(d.manager);
        d.hook = _deployHook(d, deployer);

        Listing[] memory listings = _listings();
        bytes32[] memory ids = new bytes32[](listings.length);
        address[] memory tokens = new address[](listings.length);
        PriceOracle.PriceUpdate[] memory updates = new PriceOracle.PriceUpdate[](listings.length);
        for (uint256 i; i < listings.length; ++i) {
            (ids[i], tokens[i]) = d.core.listAsset(listings[i].isin, listings[i].symbol, listings[i].name);
            updates[i] = PriceOracle.PriceUpdate(ids[i], listings[i].inrPaise, 87_500_000, 1);
        }
        // Initial prices so the protocol is usable immediately (relay overwrites them).
        d.oracle.pushPrices(updates);
        for (uint256 i; i < listings.length; ++i) {
            PoolKey memory key = _poolKey(tokens[i], usdtAddr, address(d.hook));
            d.manager.initialize(key, _sqrtPrice(tokens[i], usdtAddr, _usd6(listings[i].inrPaise)));
        }
        vm.stopBroadcast();

        _write(d, ids, tokens, listings, deployer, demo);
    }

    function _params(bool demo) internal pure returns (OpenShareCore.Params memory p) {
        p = OpenShareCore.Params({
            bondRatioBps: 11_000,
            bondRatioExtendedBps: 12_500,
            mintFeeBps: 10,
            redeemFeeBps: 20,
            priceBandBps: 100,
            defaultPenaltyBps: 500,
            cureWindow: 24 hours,
            attestationInterval: 7 days,
            staleGrace: 3 days,
            maxProofAge: 24 hours,
            minDefaultDelay: 1 hours,
            deadlineSessions: 3,
            minRedeemShares: 10,
            maxTicketsPerRequest: 8,
            maxFifoScan: 64
        });
        if (demo) {
            p.cureWindow = 10 minutes;
            p.attestationInterval = 1 days;
            p.staleGrace = 10 minutes;
            p.minDefaultDelay = 1 minutes;
            p.minRedeemShares = 1;
        }
    }

    function _listings() internal pure returns (Listing[] memory l) {
        l = new Listing[](3);
        l[0] = Listing("INE002A01018", "oRELIANCE", "OpenShare Reliance Industries", 140_000);
        l[1] = Listing("INE467B01029", "oTCS", "OpenShare Tata Consultancy Services", 315_000);
        l[2] = Listing("INE009A01021", "oINFY", "OpenShare Infosys", 150_000);
    }

    function _usd6(uint256 inrPaise) internal pure returns (uint256) {
        return inrPaise * 1e10 / 87_500_000;
    }

    function _deployHook(Deployed memory d, address owner) internal returns (OpenShareHook) {
        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory args = abi.encode(
            IPoolManager(address(d.manager)), address(d.core), IPriceOracle(address(d.oracle)), d.compliance, d.usdt, owner
        );
        bytes32 initHash = keccak256(abi.encodePacked(type(OpenShareHook).creationCode, args));
        uint256 salt;
        address predicted;
        for (; salt < 500_000; ++salt) {
            predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, bytes32(salt), initHash))))
            );
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK == flags && predicted.code.length == 0) break;
        }
        OpenShareHook hook = new OpenShareHook{salt: bytes32(salt)}(
            IPoolManager(address(d.manager)), address(d.core), IPriceOracle(address(d.oracle)), d.compliance, d.usdt, owner
        );
        require(address(hook) == predicted, "hook address mismatch");
        return hook;
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

    /// sqrtPriceX96 for `usd6` USDT (6 dec) per 1e18 token units.
    function _sqrtPrice(address token, address usdt, uint256 usd6) internal pure returns (uint160) {
        (uint256 num, uint256 den) = token < usdt ? (usd6, uint256(1e18)) : (uint256(1e18), usd6);
        return uint160(Math.sqrt((num << 192) / den));
    }

    function _write(
        Deployed memory d,
        bytes32[] memory ids,
        address[] memory tokens,
        Listing[] memory listings,
        address deployer,
        bool demo
    ) internal {
        string memory assets = "[";
        for (uint256 i; i < ids.length; ++i) {
            string memory o = string.concat(
                '{"assetId":"',
                vm.toString(ids[i]),
                '","token":"',
                vm.toString(tokens[i]),
                '","isin":"',
                listings[i].isin,
                '","symbol":"',
                listings[i].symbol,
                '","name":"',
                listings[i].name,
                '"}'
            );
            assets = string.concat(assets, o, i + 1 < ids.length ? "," : "");
        }
        assets = string.concat(assets, "]");

        string memory j = string.concat(
            "{",
            _kv("chainId", vm.toString(block.chainid)),
            _kv("deployer", vm.toString(deployer)),
            _kv("usdt", vm.toString(d.usdt)),
            '"mockUsdt":',
            d.mockUsdt ? "true," : "false,",
            '"demoParams":',
            demo ? "true," : "false,",
            _kv("compliance", vm.toString(address(d.compliance))),
            _kv("roles", vm.toString(address(d.roles))),
            _kv("oracle", vm.toString(address(d.oracle))),
            _kv("vault", vm.toString(address(d.vault)))
        );
        j = string.concat(
            j,
            _kv("core", vm.toString(address(d.core))),
            _kv("attestedVerifier", vm.toString(address(d.attested))),
            _kv("reclaimVerifier", vm.toString(address(d.reclaim))),
            _kv("poolManager", vm.toString(address(d.manager))),
            _kv("swapRouter", vm.toString(address(d.swapRouter))),
            _kv("lpRouter", vm.toString(address(d.lpRouter))),
            _kv("hook", vm.toString(address(d.hook))),
            _kv("deployBlock", vm.toString(block.number)),
            '"assets":',
            assets,
            "}"
        );
        string memory path = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
        vm.writeFile(path, j);
        console2.log("Deployment written to", path);
        console2.log("core", address(d.core));
        console2.log("hook", address(d.hook));
    }

    function _kv(string memory k, string memory v) internal pure returns (string memory) {
        return string.concat('"', k, '":"', v, '",');
    }
}
