// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../utils/Base.t.sol";
import {OpenShareCore} from "../../src/core/OpenShareCore.sol";

/// @notice Reproduces SPEC §5 (worked example) exactly.
contract WorkedWeekTest is Base {
    address alice;
    address dev;
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address x;
    address y;

    function test_workedWeek() public {
        x = makeBroker("X", 1_760e6);
        y = makeBroker("Y", 3_520e6);
        alice = makeMinter("alice");
        dev = makeMinter("dev");

        // Session 1 closes at ₹1,400 = $16.00 (the "previous" close before Thursday).
        setMarketOpen(true);
        closeSession(140_000, true, false);

        // Thu: Alice pledges 100 to X and mints 100.
        (uint256 p1,) = pledge(alice, x, 100);
        uint256 xBefore = usdt.balanceOf(x);
        mintFor(alice, p1, 100);
        assertEq(usdt.balanceOf(x) - xBefore, 1_600_000, "mint fee 0.10% of $1,600");
        assertEq(token.totalSupply(), shares(100));
        assertInvariants();

        // Fri: Dev pledges 200 to Y (unminted). Alice sells 60 to Bob at $16.00.
        (uint256 p2,) = pledge(dev, y, 200);
        vm.prank(alice);
        token.transfer(bob, shares(60));
        closeSession(140_000, true, true); // Friday close, weekend ahead (extended closure)
        assertTrue(oracle.extendedClosure());
        assertInvariants();

        // Sat 02:00: market closed; Dev mints 200 on his own initiative (D4).
        skip(1 days);
        mintFor(dev, p2, 200);
        assertEq(token.totalSupply(), shares(300));
        assertInvariants();

        // Sun: Bob sells 20 to Carol; Bob redeems 40 -> FIFO assigns pledge #1 (Alice).
        vm.prank(bob);
        token.transfer(carol, shares(20));
        vm.prank(bob);
        uint256[] memory t1 = core.requestRedemption(ASSET, 40);
        assertEq(t1.length, 1);
        assertEq(core.getTicket(t1[0]).pledgeId, p1, "FIFO -> oldest pledge with minted tokens");
        assertEq(token.balanceOf(address(core)), shares(40), "escrowed");
        assertInvariants();

        // Mon: X sells at $16.11 and settles. Bob gets 643.1112 USDT.
        skip(1 days);
        setMarketOpen(true);
        usdt.mint(x, 10_000e6);
        vm.startPrank(x);
        usdt.approve(address(core), type(uint256).max);
        core.settleRedemption(t1[0], 16_110_000);
        vm.stopPrank();
        assertEq(usdt.balanceOf(bob), 643_111_200, "Bob payout");
        assertEq(token.totalSupply(), shares(260));
        assertEq(core.getPledge(p1).quantity, 60);
        assertInvariants();
        closeSession(140_000, true, false); // Monday close

        // Tue: Carol redeems 20 -> pledge #1 again.
        vm.prank(carol);
        uint256[] memory t2 = core.requestRedemption(ASSET, 20);
        assertEq(core.getTicket(t2[0]).pledgeId, p1);
        vm.expectRevert(OpenShareCore.NotYetDefaultable.selector);
        core.claimDefault(t2[0]);

        // Tue, Wed, Thu sessions close at ₹1,408.75 = $16.10. X never settles.
        for (uint256 i; i < 3; ++i) {
            skip(1 days);
            closeSession(140_875, true, false);
        }
        assertEq(core.sessionsRemaining(t2[0]), 0);

        // Anyone claims the default: 20 x $16.10 x 1.05 = 338.10 USDT from X's bond.
        core.claimDefault(t2[0]);
        assertEq(usdt.balanceOf(carol), 338_100_000, "Carol paid 105% from bond");
        assertEq(vault.bond(x), 1_760e6 - 338_100_000);
        (OpenShareCore.BrokerStatus st,,,) = core.getBroker(x);
        assertEq(uint8(st), uint8(OpenShareCore.BrokerStatus.Defaulted));
        assertEq(token.totalSupply(), shares(240));
        assertEq(core.getPledge(p1).quantity, 40, "X keeps the 20 shares off-chain");
        assertInvariants();

        // Fri: Alice burns her remaining 40 and releases 40 -> pledge closed.
        vm.startPrank(alice);
        core.burn(p1, 40);
        core.release(p1, 40);
        vm.stopPrank();
        assertEq(uint8(core.getPledge(p1).status), uint8(OpenShareCore.PledgeStatus.Closed));
        assertEq(token.totalSupply(), shares(200));
        assertInvariants();

        // A defaulted broker with no exposure can withdraw what is left.
        assertTrue(core.canWithdraw(x, vault.bond(x)));
    }
}
