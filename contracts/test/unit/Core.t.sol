// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../utils/Base.t.sol";
import {OpenShareCore} from "../../src/core/OpenShareCore.sol";
import {BondVault} from "../../src/core/BondVault.sol";
import {PledgeFacts, Role, Types} from "../../src/libraries/Types.sol";

contract CoreTest is Base {
    address alice;
    address dev;
    address x;
    address y;
    address bob = makeAddr("bob");

    function setUp() public override {
        super.setUp();
        x = makeBroker("X", 10_000e6);
        y = makeBroker("Y", 10_000e6);
        alice = makeMinter("alice");
        dev = makeMinter("dev");
        usdt.mint(x, 100_000e6);
        usdt.mint(y, 100_000e6);
        vm.prank(x);
        usdt.approve(address(core), type(uint256).max);
        vm.prank(y);
        usdt.approve(address(core), type(uint256).max);
    }

    // ------------------------------------------------------------- registerPledge

    function _register(PledgeFacts memory f, address broker) internal returns (uint256) {
        vm.prank(f.wallet);
        return core.registerPledge(address(attested), proofFor(f), broker);
    }

    function test_registerPledge_ok() public {
        uint256 id = _register(facts(alice, newRef(), 100, x), x);
        OpenShareCore.Pledge memory p = core.getPledge(id);
        assertEq(uint8(p.status), uint8(OpenShareCore.PledgeStatus.Proposed));
        assertEq(p.quantity, 100);
        assertEq(p.minter, alice);
        assertEq(p.kind, Types.KIND_MOCK);
    }

    function test_registerPledge_reverts() public {
        bytes32 ref = newRef();
        PledgeFacts memory f = facts(alice, ref, 100, x);
        bytes memory proof = proofFor(f);

        // verifier not allowed
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.VerifierNotAllowed.selector);
        core.registerPledge(address(0xBEEF), proof, x);

        // not a minter (broker y tries)
        PledgeFacts memory fy = facts(y, ref, 100, x);
        vm.prank(y);
        vm.expectRevert(OpenShareCore.NotMinter.selector);
        core.registerPledge(address(attested), proofFor(fy), x);

        // wrong wallet (replay by dev of alice's proof, E12)
        vm.prank(dev);
        vm.expectRevert(OpenShareCore.WrongWallet.selector);
        core.registerPledge(address(attested), proof, x);

        // pledgee mismatch (alice's pledge is to X, registered with Y)
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.PledgeeMismatch.selector);
        core.registerPledge(address(attested), proof, y);

        // not confirmed (E11)
        PledgeFacts memory fp = facts(alice, newRef(), 100, x);
        fp.status = 0;
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.NotConfirmed.selector);
        core.registerPledge(address(attested), proofFor(fp), x);

        // zero quantity
        PledgeFacts memory fz = facts(alice, newRef(), 0, x);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.ZeroAmount.selector);
        core.registerPledge(address(attested), proofFor(fz), x);

        // proof too old
        PledgeFacts memory fo = facts(alice, newRef(), 100, x);
        fo.observedAt = uint64(block.timestamp - 25 hours);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.ProofTooOld.selector);
        core.registerPledge(address(attested), proofFor(fo), x);

        // from future
        PledgeFacts memory ff = facts(alice, newRef(), 100, x);
        ff.observedAt = uint64(block.timestamp + 1);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.ProofFromFuture.selector);
        core.registerPledge(address(attested), proofFor(ff), x);

        // unlisted asset
        PledgeFacts memory fu = facts(alice, newRef(), 100, x);
        fu.assetId = keccak256("NOPE");
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.NotListed.selector);
        core.registerPledge(address(attested), proofFor(fu), x);

        // ok, then the same ref again (nullifier)
        vm.prank(alice);
        core.registerPledge(address(attested), proof, x);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.PledgeRefUsed.selector);
        core.registerPledge(address(attested), proof, x);
    }

    function test_registerPledge_mintPaused() public {
        vm.prank(admin);
        compliance.setMintPaused(ASSET, true);
        PledgeFacts memory f = facts(alice, newRef(), 100, x);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.AssetPaused.selector);
        core.registerPledge(address(attested), proofFor(f), x);
    }

    function test_cancel_and_reject() public {
        uint256 id = _register(facts(alice, newRef(), 100, x), x);
        vm.prank(bob);
        vm.expectRevert(OpenShareCore.NotPledgeMinter.selector);
        core.cancelPledge(id);
        vm.prank(alice);
        core.cancelPledge(id);
        assertEq(uint8(core.getPledge(id).status), uint8(OpenShareCore.PledgeStatus.Closed));

        uint256 id2 = _register(facts(alice, newRef(), 100, x), x);
        vm.prank(y);
        vm.expectRevert(OpenShareCore.NotPledgeBroker.selector);
        core.rejectPledge(id2);
        vm.prank(x);
        core.rejectPledge(id2);
        vm.prank(x);
        vm.expectRevert(OpenShareCore.BadStatus.selector);
        core.acceptPledge(id2);
    }

    // ------------------------------------------------------------- accept & bond health (D1, D2)

    function test_accept_requiresHealthyBond() public {
        address poor = makeBroker("poor", 1_759e6); // needs 1,760 for 100 sh @ $16
        uint256 id = _register(facts(alice, newRef(), 100, poor), poor);
        vm.prank(poor);
        vm.expectRevert(OpenShareCore.Unhealthy.selector);
        core.acceptPledge(id);
        depositBond(poor, 1e6);
        vm.prank(poor);
        core.acceptPledge(id);
    }

    function test_extendedClosureRequires125() public {
        address b = makeBroker("b", 1_800e6); // 112.5%
        uint256 id = _register(facts(alice, newRef(), 100, b), b);
        closeSession(140_000, true, true); // extended closure
        assertEq(core.requiredBondBps(), 12_500);
        vm.prank(b);
        vm.expectRevert(OpenShareCore.Unhealthy.selector);
        core.acceptPledge(id);
        setMarketOpen(true);
        vm.prank(b);
        core.acceptPledge(id);
    }

    function test_withdrawRules() public {
        (uint256 id,) = pledge(alice, x, 100); // exposure $1,600, need 1,760
        assertTrue(core.canWithdraw(x, 10_000e6 - 1_760e6));
        assertFalse(core.canWithdraw(x, 10_000e6 - 1_759e6));
        vm.prank(x);
        vm.expectRevert(BondVault.WithdrawNotAllowed.selector);
        vault.withdraw(9_000e6);
        vm.prank(x);
        vault.withdraw(8_000e6);
        assertEq(vault.bond(x), 2_000e6);

        // pending tickets block withdrawals
        mintFor(alice, id, 100);
        vm.prank(alice);
        core.requestRedemption(ASSET, 10);
        assertFalse(core.canWithdraw(x, 1));
    }

    function test_vaultOnlyBrokersDeposit_onlyCorePays() public {
        usdt.mint(bob, 10e6);
        vm.startPrank(bob);
        usdt.approve(address(vault), 10e6);
        vm.expectRevert(BondVault.NotBroker.selector);
        vault.deposit(10e6);
        vm.expectRevert(BondVault.OnlyCore.selector);
        vault.pay(x, bob, 1);
        vm.stopPrank();
    }

    function test_undercollateralized_cureAndDefault() public {
        address b = makeBroker("b", 1_760e6);
        (uint256 id,) = pledge(alice, b, 100);
        id;
        // price +20% => bond 1,760 < exposure 1,920
        setPriceInr(168_000);
        core.pokeCollateral(b);
        (,,, uint64 since) = core.getBroker(b);
        assertEq(since, block.timestamp);
        // cure by top-up
        depositBond(b, 500e6);
        core.pokeCollateral(b);
        (,,, since) = core.getBroker(b);
        assertEq(since, 0);
        // drop again and fail to cure
        setPriceInr(300_000);
        core.pokeCollateral(b);
        skip(24 hours);
        core.pokeCollateral(b);
        (OpenShareCore.BrokerStatus st,,,) = core.getBroker(b);
        assertEq(uint8(st), uint8(OpenShareCore.BrokerStatus.Defaulted));
    }

    // ------------------------------------------------------------- mint / burn / release

    function test_mint_rules() public {
        (uint256 id,) = pledge(alice, x, 100);
        vm.prank(bob);
        vm.expectRevert(OpenShareCore.NotPledgeMinter.selector);
        core.mint(id, 1);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.ZeroAmount.selector);
        core.mint(id, 0);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.ExceedsCapacity.selector);
        core.mint(id, 101);
        mintFor(alice, id, 100);
        assertEq(token.balanceOf(alice), shares(100));

        // proposed pledge cannot mint
        uint256 id2 = _register(facts(alice, newRef(), 50, x), x);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.BadStatus.selector);
        core.mint(id2, 1);
    }

    function test_mint_staleAttestation_thenReprove() public {
        (uint256 id,) = pledge(alice, x, 100);
        skip(7 days + 1);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.AttestationStale.selector);
        core.mint(id, 1);
        attestQty(id, alice, 100);
        mintFor(alice, id, 1);
    }

    function test_mint_pausedOrBrokerDefaulted() public {
        (uint256 id,) = pledge(alice, x, 100);
        vm.prank(admin);
        compliance.setMintPaused(ASSET, true);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.AssetPaused.selector);
        core.mint(id, 1);
    }

    function test_mint_allowedWhileMarketClosed() public {
        (uint256 id,) = pledge(alice, x, 100);
        closeSession(140_000, true, true); // weekend
        assertFalse(oracle.marketOpen());
        mintFor(alice, id, 50); // D4
        assertEq(token.balanceOf(alice), shares(50));
    }

    function test_burn_and_release() public {
        (uint256 id,) = pledge(alice, x, 100);
        mintFor(alice, id, 60);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.ExceedsAvailable.selector);
        core.release(id, 41);
        vm.prank(alice);
        core.release(id, 40);
        assertEq(core.getPledge(id).quantity, 60);
        assertEq(core.brokerPledged(x, ASSET), 60);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.ExceedsAvailable.selector);
        core.burn(id, 61);
        vm.prank(alice);
        core.burn(id, 60);
        vm.prank(alice);
        core.release(id, 60);
        assertEq(uint8(core.getPledge(id).status), uint8(OpenShareCore.PledgeStatus.Closed));
        assertInvariants();
    }

    // ------------------------------------------------------------- attest, shortfall (D8), stale (D9)

    function test_attest_onlyParties_refMustMatch() public {
        (uint256 id,) = pledge(alice, x, 100);
        PledgeFacts memory f = facts(bob, core.getPledge(id).pledgeRef, 100, x);
        vm.prank(bob);
        vm.expectRevert(OpenShareCore.NotPledgeParty.selector);
        core.attest(id, address(attested), proofFor(f));
        PledgeFacts memory g = facts(alice, bytes32("other"), 100, x);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.PledgeRefMismatch.selector);
        core.attest(id, address(attested), proofFor(g));
        attestQty(id, x, 100); // broker can re-prove too
    }

    /// Broker invoked 30 unminted shares without a redemption: the minter is compensated from the bond.
    function test_shortfall_fromFreeCapacity_compensatesMinter() public {
        closeSession(140_000, true, false);
        (uint256 id,) = pledge(alice, x, 100);
        mintFor(alice, id, 60);
        uint256 before = usdt.balanceOf(alice);
        attestQty(id, alice, 70); // 30 missing; free capacity = 40
        assertEq(usdt.balanceOf(alice) - before, 30 * 16_800_000, "30 x $16 x 1.05");
        OpenShareCore.Pledge memory p = core.getPledge(id);
        assertEq(p.quantity, 70);
        assertEq(p.minted, 60);
        assertTrue(p.frozen);
        (OpenShareCore.BrokerStatus st,,,) = core.getBroker(x);
        assertEq(uint8(st), uint8(OpenShareCore.BrokerStatus.Defaulted));
        assertInvariants();
    }

    /// Shortfall beyond free capacity converts minted shares into a bond-funded reserve (holders stay whole).
    function test_shortfall_intoMinted_fundsReserve_thenReserveRedeems() public {
        closeSession(140_000, true, false);
        (uint256 id,) = pledge(alice, x, 100);
        mintFor(alice, id, 90);
        vm.prank(alice);
        token.transfer(bob, shares(50));
        attestQty(id, alice, 40); // 60 missing: 10 from free, 50 to reserve
        (,,,,,, uint64 reserveShares, uint256 reserveUsdt,,) = core.getAsset(ASSET);
        assertEq(reserveShares, 50);
        assertEq(reserveUsdt, 50 * 16_800_000);
        assertEq(core.getPledge(id).minted, 40);
        assertEq(core.getPledge(id).quantity, 40);
        assertInvariants();

        // Bob redeems 20 -> paid instantly from the reserve, pro-rata.
        vm.prank(bob);
        uint256[] memory t = core.requestRedemption(ASSET, 20);
        assertEq(t.length, 0);
        assertEq(usdt.balanceOf(bob), 20 * 16_800_000);
        assertInvariants();
    }

    function test_stale_flag_then_slash() public {
        closeSession(140_000, true, false);
        (uint256 id,) = pledge(alice, x, 100);
        mintFor(alice, id, 100);
        vm.expectRevert(OpenShareCore.NotStale.selector);
        core.flagStale(id);
        skip(7 days + 1);
        core.flagStale(id);
        assertTrue(core.getPledge(id).frozen);
        vm.expectRevert(OpenShareCore.NotStale.selector);
        core.slashStale(id);
        skip(3 days);
        core.slashStale(id);
        (,,,,,, uint64 reserveShares, uint256 reserveUsdt,,) = core.getAsset(ASSET);
        assertEq(reserveShares, 100);
        assertEq(reserveUsdt, 100 * 16_800_000);
        assertInvariants();
    }

    function test_stale_reproofUnfreezes() public {
        (uint256 id,) = pledge(alice, x, 100);
        skip(7 days + 1);
        core.flagStale(id);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.Frozen.selector);
        core.mint(id, 1);
        attestQty(id, alice, 100);
        assertFalse(core.getPledge(id).frozen);
        mintFor(alice, id, 1);
    }

    // ------------------------------------------------------------- redemptions

    function test_redeem_minimumAndPause() public {
        (uint256 id,) = pledge(alice, x, 100);
        mintFor(alice, id, 100);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.BelowMinimum.selector);
        core.requestRedemption(ASSET, 9);
        vm.prank(admin);
        compliance.setMintPaused(ASSET, true);
        vm.prank(alice);
        vm.expectRevert(OpenShareCore.AssetPaused.selector);
        core.requestRedemption(ASSET, 10);
    }

    function test_redeem_splitsAcrossPledgesFifo() public {
        (uint256 a,) = pledge(alice, x, 30);
        (uint256 d,) = pledge(dev, y, 100);
        mintFor(alice, a, 30);
        mintFor(dev, d, 100);
        vm.prank(dev);
        token.transfer(bob, shares(50));
        vm.prank(bob);
        uint256[] memory t = core.requestRedemption(ASSET, 50);
        assertEq(t.length, 2);
        assertEq(core.getTicket(t[0]).pledgeId, a);
        assertEq(core.getTicket(t[0]).shares, 30);
        assertEq(core.getTicket(t[1]).pledgeId, d);
        assertEq(core.getTicket(t[1]).shares, 20);
        assertInvariants();
    }

    function test_redeem_skipsFullyEscrowedAndUnminted() public {
        (uint256 a,) = pledge(alice, x, 100); // never minted
        (uint256 d,) = pledge(dev, y, 100);
        a;
        mintFor(dev, d, 100);
        vm.prank(dev);
        uint256[] memory t = core.requestRedemption(ASSET, 10);
        assertEq(core.getTicket(t[0]).pledgeId, d, "unminted pledge is never redeemed against");
    }

    function test_settle_floorAndFee() public {
        closeSession(140_000, true, false); // close $16.00 => floor $15.84
        (uint256 id,) = pledge(alice, x, 100);
        mintFor(alice, id, 100);
        vm.prank(alice);
        token.transfer(bob, shares(10));
        vm.prank(bob);
        uint256[] memory t = core.requestRedemption(ASSET, 10);
        vm.prank(y);
        vm.expectRevert(OpenShareCore.NotPledgeBroker.selector);
        core.settleRedemption(t[0], 15_000_000);
        vm.prank(x);
        core.settleRedemption(t[0], 15_000_000); // reported below floor
        uint256 gross = 10 * 15_840_000;
        assertEq(usdt.balanceOf(bob), gross - gross * 20 / 10_000, "paid at floor minus 0.20%");
        vm.prank(x);
        vm.expectRevert(OpenShareCore.BadStatus.selector);
        core.settleRedemption(t[0], 16_000_000);
        assertInvariants();
    }

    function test_default_deadlinePausesOnHalts() public {
        (uint256 id,) = pledge(alice, x, 100);
        mintFor(alice, id, 100);
        vm.prank(alice);
        uint256[] memory t = core.requestRedemption(ASSET, 10);
        skip(2 hours);
        closeSession(140_000, true, false);
        closeSession(140_000, false, false); // halted: does not count (E3)
        closeSession(140_000, true, false);
        vm.expectRevert(OpenShareCore.NotYetDefaultable.selector);
        core.claimDefault(t[0]);
        closeSession(140_000, true, false);
        core.claimDefault(t[0]);
        assertEq(uint8(core.getTicket(t[0]).status), uint8(OpenShareCore.TicketStatus.Defaulted));
        assertInvariants();
    }

    function test_default_bondExhaustedPaysWhatIsLeft() public {
        address b = makeBroker("b", 1_760e6);
        (uint256 id,) = pledge(alice, b, 100);
        mintFor(alice, id, 100);
        vm.prank(alice);
        uint256[] memory t = core.requestRedemption(ASSET, 100);
        skip(2 hours);
        for (uint256 i; i < 3; ++i) closeSession(140_000, true, false);
        core.claimDefault(t[0]); // due 1,680 <= 1,760
        assertEq(vault.bond(b), 80e6);
        assertInvariants();
    }

    function test_settleAfterDeadlineAllowedUntilClaimed() public {
        (uint256 id,) = pledge(alice, x, 100);
        mintFor(alice, id, 100);
        vm.prank(alice);
        uint256[] memory t = core.requestRedemption(ASSET, 10);
        skip(2 hours);
        for (uint256 i; i < 4; ++i) closeSession(140_000, true, false);
        vm.prank(x);
        core.settleRedemption(t[0], 16_000_000);
        vm.expectRevert(OpenShareCore.BadStatus.selector);
        core.claimDefault(t[0]);
    }

    function test_paramsAndAdminGuards() public {
        OpenShareCore.Params memory p = core.defaultParams();
        vm.expectRevert();
        core.setParams(p);
        vm.expectRevert();
        core.listAsset("X", "X", "X");
        vm.prank(admin);
        vm.expectRevert(OpenShareCore.AlreadyListed.selector);
        core.listAsset(ISIN, "oRELIANCE", "dup");
    }

    function test_registerBroker_requiresRole() public {
        vm.prank(bob);
        vm.expectRevert(OpenShareCore.NotBrokerRole.selector);
        core.registerBroker(bytes32(0), "bob");
        vm.prank(x);
        vm.expectRevert(OpenShareCore.BrokerExists.selector);
        core.registerBroker(bytes32(0), "X again");
    }
}
