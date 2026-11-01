// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../utils/Base.t.sol";
import {RoleRegistry} from "../../src/registry/RoleRegistry.sol";
import {PriceOracle} from "../../src/oracle/PriceOracle.sol";
import {OpenShareToken} from "../../src/core/OpenShareToken.sol";
import {AttestedPledgeVerifier} from "../../src/verifiers/AttestedPledgeVerifier.sol";
import {PledgeFacts, Role, Types, PriceSource} from "../../src/libraries/Types.sol";

contract RoleRegistryTest is Base {
    address w = makeAddr("w");

    function test_register_ok() public {
        uint256 n = giveRole(w, Role.Minter);
        assertTrue(roles.isMinter(w));
        assertEq(uint8(roles.nullifierRole(n)), uint8(Role.Minter));
        assertEq(roles.nullifierWallet(n), w);
    }

    function test_revert_expired() public {
        (RoleRegistry.RoleAttestation memory a, bytes memory s) =
            signRole(w, Role.Minter, 77, uint64(block.timestamp - 1));
        vm.prank(w);
        vm.expectRevert(RoleRegistry.AttestationExpired.selector);
        roles.register(a, s);
    }

    function test_revert_wrongWallet() public {
        (RoleRegistry.RoleAttestation memory a, bytes memory s) =
            signRole(w, Role.Minter, 77, uint64(block.timestamp + 60));
        vm.prank(makeAddr("thief"));
        vm.expectRevert(RoleRegistry.WrongWallet.selector);
        roles.register(a, s);
    }

    function test_revert_invalidRole() public {
        (RoleRegistry.RoleAttestation memory a, bytes memory s) =
            signRole(w, Role.None, 77, uint64(block.timestamp + 60));
        vm.prank(w);
        vm.expectRevert(RoleRegistry.InvalidRole.selector);
        roles.register(a, s);
    }

    function test_revert_badSignature() public {
        RoleRegistry.RoleAttestation memory a =
            RoleRegistry.RoleAttestation(w, uint8(Role.Minter), 77, uint64(block.timestamp + 60));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, roles.hashAttestation(a));
        vm.prank(w);
        vm.expectRevert(RoleRegistry.BadSignature.selector);
        roles.register(a, abi.encodePacked(r, s, v));
    }

    /// One human cannot be both minter and broker (D15, issue 3).
    function test_revert_sameHumanSecondRole() public {
        (RoleRegistry.RoleAttestation memory a, bytes memory s) =
            signRole(w, Role.Minter, 42, uint64(block.timestamp + 60));
        vm.prank(w);
        roles.register(a, s);
        address w2 = makeAddr("w2");
        (a, s) = signRole(w2, Role.Broker, 42, uint64(block.timestamp + 60));
        vm.prank(w2);
        vm.expectRevert(RoleRegistry.HumanAlreadyRegistered.selector);
        roles.register(a, s);
    }

    function test_revert_walletTwice() public {
        giveRole(w, Role.Minter);
        (RoleRegistry.RoleAttestation memory a, bytes memory s) =
            signRole(w, Role.Broker, 999, uint64(block.timestamp + 60));
        vm.prank(w);
        vm.expectRevert(RoleRegistry.WalletAlreadyRegistered.selector);
        roles.register(a, s);
    }

    function test_revoke_keepsNullifierConsumed() public {
        uint256 n = giveRole(w, Role.Minter);
        vm.prank(admin);
        roles.revoke(w);
        assertFalse(roles.isMinter(w));
        (RoleRegistry.RoleAttestation memory a, bytes memory s) =
            signRole(w, Role.Broker, n, uint64(block.timestamp + 60));
        vm.prank(w);
        vm.expectRevert(RoleRegistry.HumanAlreadyRegistered.selector);
        roles.register(a, s);
    }
}

contract ComplianceAndTokenTest is Base {
    address alice;
    address x;
    address bob = makeAddr("bob");

    function setUp() public override {
        super.setUp();
        x = makeBroker("X", 10_000e6);
        alice = makeMinter("alice");
        (uint256 id,) = pledge(alice, x, 100);
        mintFor(alice, id, 100);
    }

    function test_blockedReceiverCannotGetTokens() public {
        vm.prank(admin);
        compliance.setBlocked(bob, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OpenShareToken.TransferNotAllowed.selector, alice, bob));
        token.transfer(bob, 1e18);
    }

    function test_blockedSenderCannotSend() public {
        vm.prank(admin);
        compliance.setBlocked(alice, true);
        vm.prank(alice);
        vm.expectRevert();
        token.transfer(bob, 1e18);
    }

    function test_transfersPaused() public {
        vm.prank(admin);
        compliance.setTransfersPaused(ASSET, true);
        vm.prank(alice);
        vm.expectRevert();
        token.transfer(bob, 1e18);
        vm.prank(admin);
        compliance.setTransfersPaused(ASSET, false);
        vm.prank(alice);
        token.transfer(bob, 1e18);
        assertEq(token.balanceOf(bob), 1e18);
    }

    function test_onlyCoreMints() public {
        vm.expectRevert(OpenShareToken.OnlyCore.selector);
        token.mint(bob, 1);
    }

    function test_onlyComplianceRole() public {
        vm.expectRevert();
        compliance.setBlocked(bob, true);
    }
}

contract PriceOracleTest is Base {
    function test_toUsd6() public view {
        assertEq(oracle.toUsd6(140_000, USD_INR), 16_000_000);
        assertEq(oracle.toUsd6(140_875, USD_INR), 16_100_000);
    }

    function test_onlyRelayer() public {
        PriceOracle.PriceUpdate[] memory u = new PriceOracle.PriceUpdate[](0);
        vm.expectRevert();
        oracle.pushPrices(u);
    }

    function test_zeroValueReverts() public {
        PriceOracle.PriceUpdate[] memory u = new PriceOracle.PriceUpdate[](1);
        u[0] = PriceOracle.PriceUpdate(ASSET, 0, USD_INR, uint8(PriceSource.Relay));
        vm.prank(relayer);
        vm.expectRevert(PriceOracle.ZeroValue.selector);
        oracle.pushPrices(u);
    }

    function test_badSourceReverts() public {
        PriceOracle.PriceUpdate[] memory u = new PriceOracle.PriceUpdate[](1);
        u[0] = PriceOracle.PriceUpdate(ASSET, 1, USD_INR, 0);
        vm.prank(relayer);
        vm.expectRevert(PriceOracle.BadSource.selector);
        oracle.pushPrices(u);
    }

    function test_sessionsCountOnlyWhenTraded() public {
        closeSession(140_000, true, false);
        closeSession(140_000, false, false); // halted session (E3)
        closeSession(140_000, true, true);
        assertEq(oracle.assetSessions(ASSET), 2);
        assertEq(oracle.currentSessionId(), 3);
        assertTrue(oracle.extendedClosure());
        assertFalse(oracle.marketOpen());
    }

    function test_sessionIdMustIncrement() public {
        PriceOracle.SessionClose[] memory c = new PriceOracle.SessionClose[](0);
        vm.prank(relayer);
        vm.expectRevert(PriceOracle.BadSessionId.selector);
        oracle.closeSession(5, c, false);
    }

    function test_staleOnlyWhileOpen() public {
        assertFalse(oracle.isStale(ASSET));
        skip(1 hours);
        assertFalse(oracle.isStale(ASSET)); // market closed: not stale
        setMarketOpen(true);
        assertTrue(oracle.isStale(ASSET));
        setPriceInr(140_000);
        assertFalse(oracle.isStale(ASSET));
    }

    function test_openClearsExtended() public {
        closeSession(140_000, true, true);
        assertTrue(oracle.extendedClosure());
        setMarketOpen(true);
        assertFalse(oracle.extendedClosure());
    }
}

contract AttestedVerifierTest is Base {
    function test_unknownSigner() public {
        PledgeFacts memory f = facts(address(this), bytes32("r"), 10, address(1));
        bytes memory proof = sign(f, 0xDEAD);
        vm.expectRevert(abi.encodeWithSelector(AttestedPledgeVerifier.UnknownAttestor.selector, vm.addr(0xDEAD)));
        attested.verify(proof);
    }

    /// A mock signer cannot produce a Kite-kind proof, and vice versa.
    function test_kindMismatch() public {
        PledgeFacts memory f = facts(address(this), bytes32("r"), 10, address(1));
        f.kind = Types.KIND_KITE;
        bytes memory proof = sign(f, MOCK_PK);
        vm.expectRevert(
            abi.encodeWithSelector(AttestedPledgeVerifier.KindMismatch.selector, Types.KIND_MOCK, Types.KIND_KITE)
        );
        attested.verify(proof);
        // Kite signer with kite kind verifies.
        PledgeFacts memory out = attested.verify(sign(f, KITE_PK));
        assertEq(out.kind, Types.KIND_KITE);
    }

    function test_invalidKindSetter() public {
        vm.prank(admin);
        vm.expectRevert(AttestedPledgeVerifier.InvalidKind.selector);
        attested.setAttestor(address(1), 1);
    }
}
