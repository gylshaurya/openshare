// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Base} from "../utils/Base.t.sol";
import {OpenShareCore} from "../../src/core/OpenShareCore.sol";

/// @notice Handler-based invariant fuzzing of SPEC §9 (I1–I6). The test contract is its own handler.
contract InvariantsTest is StdInvariant, Base {
    address[2] minters;
    address[2] brokers;
    address[3] holders;
    uint256[] pledgeIds;
    uint256[] ticketIds;

    function setUp() public override {
        super.setUp();
        minters[0] = makeMinter("m0");
        minters[1] = makeMinter("m1");
        brokers[0] = makeBroker("b0", 5_000_000e6);
        brokers[1] = makeBroker("b1", 5_000_000e6);
        holders[0] = makeAddr("h0");
        holders[1] = makeAddr("h1");
        holders[2] = makeAddr("h2");
        for (uint256 i; i < 2; ++i) {
            usdt.mint(brokers[i], 50_000_000e6);
            vm.prank(brokers[i]);
            usdt.approve(address(core), type(uint256).max);
        }

        bytes4[] memory sel = new bytes4[](11);
        sel[0] = this.h_pledge.selector;
        sel[1] = this.h_mint.selector;
        sel[2] = this.h_burn.selector;
        sel[3] = this.h_release.selector;
        sel[4] = this.h_transfer.selector;
        sel[5] = this.h_redeem.selector;
        sel[6] = this.h_settle.selector;
        sel[7] = this.h_sessionAndDefault.selector;
        sel[8] = this.h_shortfall.selector;
        sel[9] = this.h_price.selector;
        sel[10] = this.h_staleSlash.selector;
        targetSelector(FuzzSelector({addr: address(this), selectors: sel}));
        targetContract(address(this));
    }

    // ---------------------------------------------------------------- handlers

    function h_pledge(uint256 m, uint256 b, uint64 qty) external {
        qty = uint64(bound(qty, 1, 500));
        address minter = minters[m % 2];
        address broker = brokers[b % 2];
        (OpenShareCore.BrokerStatus st,,,) = core.getBroker(broker);
        if (st != OpenShareCore.BrokerStatus.Active) return;
        bytes32 ref = newRef();
        bytes memory proof = proofFor(facts(minter, ref, qty, broker));
        vm.prank(minter);
        uint256 id = core.registerPledge(address(attested), proof, broker);
        vm.prank(broker);
        try core.acceptPledge(id) {
            pledgeIds.push(id);
        } catch {}
    }

    function _pledge(uint256 i) internal view returns (uint256 id, OpenShareCore.Pledge memory p, bool ok) {
        if (pledgeIds.length == 0) return (0, p, false);
        id = pledgeIds[i % pledgeIds.length];
        p = core.getPledge(id);
        ok = p.status == OpenShareCore.PledgeStatus.Active;
    }

    function h_mint(uint256 i, uint64 n) external {
        (uint256 id, OpenShareCore.Pledge memory p, bool ok) = _pledge(i);
        if (!ok || p.quantity == p.minted) return;
        n = uint64(bound(n, 1, p.quantity - p.minted));
        vm.prank(p.minter);
        try core.mint(id, n) {} catch {}
    }

    function h_burn(uint256 i, uint64 n) external {
        (uint256 id, OpenShareCore.Pledge memory p,) = _pledge(i);
        uint64 avail = p.minted - p.pendingRedemption;
        uint256 bal = token.balanceOf(p.minter) / 1e18;
        if (avail == 0 || bal == 0) return;
        n = uint64(bound(n, 1, avail < bal ? avail : bal));
        vm.prank(p.minter);
        core.burn(id, n);
    }

    function h_release(uint256 i, uint64 n) external {
        (uint256 id, OpenShareCore.Pledge memory p, bool ok) = _pledge(i);
        if (!ok || p.quantity == p.minted) return;
        n = uint64(bound(n, 1, p.quantity - p.minted));
        vm.prank(p.minter);
        core.release(id, n);
    }

    function h_transfer(uint256 from, uint256 to, uint256 amt) external {
        address f = from % 2 == 0 ? minters[from % 2] : minters[1];
        address t = holders[to % 3];
        uint256 bal = token.balanceOf(f);
        if (bal == 0) return;
        amt = bound(amt, 1, bal);
        vm.prank(f);
        token.transfer(t, amt);
    }

    function h_redeem(uint256 h, uint64 n) external {
        address holder = holders[h % 3];
        uint256 bal = token.balanceOf(holder) / 1e18;
        if (bal < 10) return;
        n = uint64(bound(n, 10, bal));
        vm.prank(holder);
        try core.requestRedemption(ASSET, n) returns (uint256[] memory ids) {
            for (uint256 k; k < ids.length; ++k) {
                ticketIds.push(ids[k]);
            }
        } catch {}
    }

    function h_settle(uint256 i, uint256 px) external {
        if (ticketIds.length == 0) return;
        uint256 tid = ticketIds[i % ticketIds.length];
        OpenShareCore.Ticket memory t = core.getTicket(tid);
        if (t.status != OpenShareCore.TicketStatus.Pending) return;
        px = bound(px, 1e6, 40e6);
        address broker = core.getPledge(t.pledgeId).broker;
        vm.prank(broker);
        core.settleRedemption(tid, px);
    }

    function h_sessionAndDefault(uint256 i, bool traded) external {
        skip(1 days);
        closeSession(140_000, traded, false);
        if (ticketIds.length == 0) return;
        uint256 tid = ticketIds[i % ticketIds.length];
        try core.claimDefault(tid) {} catch {}
    }

    function h_shortfall(uint256 i, uint64 drop, bool byBroker) external {
        (uint256 id, OpenShareCore.Pledge memory p, bool ok) = _pledge(i);
        if (!ok || p.quantity == 0) return;
        drop = uint64(bound(drop, 0, p.quantity));
        attestQty(id, byBroker ? p.broker : p.minter, p.quantity - drop);
    }

    function h_price(uint256 inrPaise) external {
        setPriceInr(bound(inrPaise, 50_000, 400_000));
    }

    function h_staleSlash(uint256 i) external {
        (uint256 id,, bool ok) = _pledge(i);
        if (!ok) return;
        skip(11 days);
        try core.slashStale(id) {} catch {}
    }

    // ---------------------------------------------------------------- invariants

    function invariant_accounting() public view {
        assertInvariants();
    }

    function invariant_brokerPledgedMatchesActivePledges() public view {
        for (uint256 b; b < 2; ++b) {
            uint256 sum;
            uint256[] memory ids = core.pledgesOfBroker(brokers[b]);
            for (uint256 k; k < ids.length; ++k) {
                OpenShareCore.Pledge memory p = core.getPledge(ids[k]);
                if (p.status == OpenShareCore.PledgeStatus.Active) sum += p.quantity;
            }
            assertEq(core.brokerPledged(brokers[b], ASSET), sum, "I5");
        }
    }

    function invariant_pendingTicketsMatchEscrow() public view {
        uint256 pending;
        for (uint256 k; k < ticketIds.length; ++k) {
            OpenShareCore.Ticket memory t = core.getTicket(ticketIds[k]);
            if (t.status == OpenShareCore.TicketStatus.Pending) pending += t.shares;
        }
        assertEq(token.balanceOf(address(core)), pending * 1e18, "I3 tickets");
    }
}
