// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {OpenShareCore} from "../../src/core/OpenShareCore.sol";
import {OpenShareToken} from "../../src/core/OpenShareToken.sol";
import {BondVault} from "../../src/core/BondVault.sol";
import {TokenFactory} from "../../src/core/TokenFactory.sol";
import {RoleRegistry} from "../../src/registry/RoleRegistry.sol";
import {ComplianceRegistry} from "../../src/registry/ComplianceRegistry.sol";
import {PriceOracle} from "../../src/oracle/PriceOracle.sol";
import {AttestedPledgeVerifier} from "../../src/verifiers/AttestedPledgeVerifier.sol";
import {IPriceOracle} from "../../src/interfaces/IPriceOracle.sol";
import {MockUSDT} from "../../src/mocks/MockUSDT.sol";
import {PledgeFacts, Role, Types, PriceSource} from "../../src/libraries/Types.sol";

/// @notice Full protocol deployment plus helpers shared by unit, scenario and invariant tests.
contract Base is Test {
    uint256 internal constant WORLD_PK = 0xA11CE;
    uint256 internal constant MOCK_PK = 0xB0B;
    uint256 internal constant KITE_PK = 0xC0FFEE;

    string internal constant ISIN = "INE002A01018";
    bytes32 internal ASSET;
    uint256 internal constant USD_INR = 87_500_000; // 87.50

    address internal admin = makeAddr("admin");
    address internal relayer = makeAddr("relayer");

    MockUSDT internal usdt;
    ComplianceRegistry internal compliance;
    RoleRegistry internal roles;
    PriceOracle internal oracle;
    BondVault internal vault;
    TokenFactory internal factory;
    OpenShareCore internal core;
    AttestedPledgeVerifier internal attested;
    OpenShareToken internal token;

    uint256 internal nullifierCounter = 1;
    uint256 internal refCounter = 1;
    uint64 internal sessionCounter;
    bytes32 internal attestedDomain;
    bytes32 internal factsTypehash;

    function setUp() public virtual {
        vm.warp(1_780_000_000);
        vm.startPrank(admin);
        usdt = new MockUSDT();
        compliance = new ComplianceRegistry(admin);
        roles = new RoleRegistry(admin);
        oracle = new PriceOracle(admin);
        vault = new BondVault(IERC20(address(usdt)));
        factory = new TokenFactory();
        core = new OpenShareCore(
            admin,
            IERC20(address(usdt)),
            roles,
            compliance,
            IPriceOracle(address(oracle)),
            vault,
            factory,
            _params()
        );
        vault.setCore(address(core));
        attested = new AttestedPledgeVerifier(admin);
        attested.setAttestor(vm.addr(MOCK_PK), Types.KIND_MOCK);
        attested.setAttestor(vm.addr(KITE_PK), Types.KIND_KITE);
        core.setVerifier(address(attested), true);
        factsTypehash = attested.PLEDGE_FACTS_TYPEHASH();
        attestedDomain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("OpenSharePledgeAttestor"),
                keccak256("1"),
                block.chainid,
                address(attested)
            )
        );
        roles.grantRole(roles.WORLD_ATTESTOR_ROLE(), vm.addr(WORLD_PK));
        oracle.grantRole(oracle.RELAYER_ROLE(), relayer);
        address t;
        (ASSET, t) = core.listAsset(ISIN, "oRELIANCE", "Bull Street Reliance Industries");
        token = OpenShareToken(t);
        vm.stopPrank();

        setPriceInr(140_000); // ₹1,400.00 => $16.00
    }

    function _params() internal view virtual returns (OpenShareCore.Params memory p) {
        // Read defaults from a throwaway call-free copy of OpenShareCore.defaultParams().
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
    }

    // ------------------------------------------------------------------ oracle helpers

    function setPriceInr(uint256 inrPaise) internal {
        PriceOracle.PriceUpdate[] memory u = new PriceOracle.PriceUpdate[](1);
        u[0] = PriceOracle.PriceUpdate(ASSET, inrPaise, USD_INR, uint8(PriceSource.Relay));
        vm.prank(relayer);
        oracle.pushPrices(u);
    }

    function closeSession(uint256 inrPaise, bool traded, bool extended) internal {
        PriceOracle.SessionClose[] memory c = new PriceOracle.SessionClose[](1);
        c[0] = PriceOracle.SessionClose(ASSET, inrPaise, USD_INR, traded);
        vm.prank(relayer);
        oracle.closeSession(++sessionCounter, c, extended);
    }

    function setMarketOpen(bool open) internal {
        vm.prank(relayer);
        oracle.setMarketOpen(open);
    }

    // ------------------------------------------------------------------ role helpers

    function signRole(address wallet, Role role, uint256 nullifier, uint64 expiresAt)
        internal
        view
        returns (RoleRegistry.RoleAttestation memory att, bytes memory sig)
    {
        att = RoleRegistry.RoleAttestation(wallet, uint8(role), nullifier, expiresAt);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                roles.domainSeparator(),
                keccak256(abi.encode(roles.ROLE_ATTESTATION_TYPEHASH(), wallet, uint8(role), nullifier, expiresAt))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(WORLD_PK, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function giveRole(address wallet, Role role) internal returns (uint256 nullifier) {
        nullifier = nullifierCounter++;
        (RoleRegistry.RoleAttestation memory att, bytes memory sig) =
            signRole(wallet, role, nullifier, uint64(block.timestamp + 1 hours));
        vm.prank(wallet);
        roles.register(att, sig);
    }

    function pledgeeHash(address broker) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("BO-", broker));
    }

    function makeBroker(string memory name, uint256 bondUsdt6) internal returns (address broker) {
        broker = makeAddr(name);
        giveRole(broker, Role.Broker);
        vm.prank(broker);
        core.registerBroker(pledgeeHash(broker), name);
        if (bondUsdt6 > 0) depositBond(broker, bondUsdt6);
    }

    function depositBond(address broker, uint256 amount) internal {
        usdt.mint(broker, amount);
        vm.startPrank(broker);
        usdt.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }

    function makeMinter(string memory name) internal returns (address minter) {
        minter = makeAddr(name);
        giveRole(minter, Role.Minter);
        usdt.mint(minter, 1_000_000e6);
        vm.prank(minter);
        usdt.approve(address(core), type(uint256).max);
    }

    // ------------------------------------------------------------------ proof helpers

    function facts(address wallet, bytes32 ref, uint64 qty, address broker) internal view returns (PledgeFacts memory) {
        return PledgeFacts({
            pledgeRef: ref,
            assetId: ASSET,
            quantity: qty,
            pledgorIdHash: keccak256(abi.encodePacked("CL-", wallet)),
            pledgeeIdHash: pledgeeHash(broker),
            status: Types.STATUS_CONFIRMED,
            observedAt: uint64(block.timestamp),
            wallet: wallet,
            kind: Types.KIND_MOCK
        });
    }

    /// @dev Local EIP-712 hash (no external call, so it never consumes a pending vm.prank).
    function hashFactsLocal(PledgeFacts memory f) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                factsTypehash,
                f.pledgeRef,
                f.assetId,
                f.quantity,
                f.pledgorIdHash,
                f.pledgeeIdHash,
                f.status,
                f.observedAt,
                f.wallet,
                f.kind
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", attestedDomain, structHash));
    }

    function sign(PledgeFacts memory f, uint256 pk) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hashFactsLocal(f));
        return abi.encode(f, abi.encodePacked(r, s, v));
    }

    function proofFor(PledgeFacts memory f) internal view returns (bytes memory) {
        return sign(f, MOCK_PK);
    }

    function newRef() internal returns (bytes32) {
        return keccak256(abi.encode("ref", refCounter++));
    }

    /// Registers and accepts a pledge; returns its id and ref.
    function pledge(address minter, address broker, uint64 qty) internal returns (uint256 id, bytes32 ref) {
        ref = newRef();
        bytes memory proof = proofFor(facts(minter, ref, qty, broker));
        vm.prank(minter);
        id = core.registerPledge(address(attested), proof, broker);
        vm.prank(broker);
        core.acceptPledge(id);
    }

    function mintFor(address minter, uint256 pledgeId, uint64 n) internal {
        vm.prank(minter);
        core.mint(pledgeId, n);
    }

    function attestQty(uint256 pledgeId, address by, uint64 provenQty) internal {
        OpenShareCore.Pledge memory p = core.getPledge(pledgeId);
        PledgeFacts memory f = facts(by, p.pledgeRef, provenQty, p.broker);
        vm.prank(by);
        core.attest(pledgeId, address(attested), proofFor(f));
    }

    function shares(uint256 n) internal pure returns (uint256) {
        return n * 1e18;
    }

    // ------------------------------------------------------------------ invariant checks

    function assertInvariants() internal view {
        (, , , , uint64 totalPledged, uint64 totalMinted, uint64 reserveShares, uint256 reserveUsdt, uint256 fifoLen,)
        = core.getAsset(ASSET);
        uint256 sumMinted;
        uint256 sumQty;
        uint256 sumPending;
        for (uint256 i; i < fifoLen; ++i) {
            OpenShareCore.Pledge memory p = core.getPledge(core.fifoAt(ASSET, i));
            assertLe(p.pendingRedemption, p.minted, "I2 pending<=minted");
            assertLe(p.minted, p.quantity, "I2 minted<=quantity");
            sumMinted += p.minted;
            if (p.status == OpenShareCore.PledgeStatus.Active) sumQty += p.quantity;
            sumPending += p.pendingRedemption;
        }
        assertEq(sumMinted, totalMinted, "totalMinted aggregate");
        assertEq(sumQty, totalPledged, "totalPledged aggregate");
        assertEq(token.totalSupply(), (uint256(totalMinted) + reserveShares) * 1e18, "I1 supply");
        assertEq(token.balanceOf(address(core)), sumPending * 1e18, "I3 escrow");
        if (reserveShares == 0) assertEq(reserveUsdt, 0, "I4 reserve");
        assertGe(usdt.balanceOf(address(core)), reserveUsdt, "I4 usdt");
        assertLe(token.totalSupply(), (uint256(totalPledged) + reserveShares) * 1e18, "I6 rule");
    }
}
