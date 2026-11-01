// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "../utils/Base.t.sol";
import {ReclaimPledgeVerifier} from "../../src/verifiers/ReclaimPledgeVerifier.sol";
import {OpenShareCore} from "../../src/core/OpenShareCore.sol";
import {PledgeFacts, Types, Role} from "../../src/libraries/Types.sol";

contract ReclaimVerifierTest is Base {
    uint256 constant ATTESTOR_PK = 0x5EC12E7;
    address constant REAL_ATTESTOR = 0x244897572368Eadf65bfBc5aec98D8e5443a9072;
    bytes32 constant PROVIDER_HASH = keccak256("openshare-console-pledge-provider");

    ReclaimPledgeVerifier rv;
    address alice;
    address x;

    function setUp() public override {
        super.setUp();
        address[] memory a = new address[](2);
        a[0] = vm.addr(ATTESTOR_PK);
        a[1] = REAL_ATTESTOR;
        rv = new ReclaimPledgeVerifier(admin, a);
        vm.startPrank(admin);
        rv.setProvider(PROVIDER_HASH, true, false, keccak256("ZERODHA-MARGIN"));
        core.setVerifier(address(rv), true);
        vm.stopPrank();
        alice = makeMinter("alice");
        // Broker whose pledgee id is Zerodha's margin account label (Kite/Console stand-in, D18).
        x = makeAddr("X");
        giveRole(x, Role.Broker);
        vm.prank(x);
        core.registerBroker(keccak256("ZERODHA-MARGIN"), "X");
        depositBond(x, 100_000e6);
    }

    // ------------------------------------------------------------- helpers

    function _context(address wallet, string memory params, bytes32 providerHash) internal view returns (string memory) {
        return string.concat(
            '{"contextAddress":"',
            vm.toLowercase(vm.toString(wallet)),
            '","contextMessage":"1874:core:1","extractedParameters":{',
            params,
            '},"providerHash":"',
            vm.toString(providerHash),
            '","reclaimSessionId":"abc"}'
        );
    }

    function _proof(string memory ctx, uint32 ts, uint256 pk) internal view returns (ReclaimPledgeVerifier.Proof memory p) {
        p.claimInfo = ReclaimPledgeVerifier.ClaimInfo("http", '{"url":"https://console.zerodha.com/api/x"}', ctx);
        bytes32 id = keccak256(abi.encodePacked(p.claimInfo.provider, "\n", p.claimInfo.parameters, "\n", p.claimInfo.context));
        address owner = address(0xABCD);
        p.signedClaim.claim = ReclaimPledgeVerifier.CompleteClaimData(id, owner, ts, 1);
        bytes memory m = abi.encodePacked(
            vm.toString(id), "\n", vm.toLowercase(vm.toString(owner)), "\n", vm.toString(uint256(ts)), "\n", "1"
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n", vm.toString(m.length), m));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        p.signedClaim.signatures = new bytes[](1);
        p.signedClaim.signatures[0] = abi.encodePacked(r, s, v);
    }

    string constant PARAMS = '"isin":"INE002A01018","qty":"25","client":"AB1234","status":"SUCCESS"';

    // ------------------------------------------------------------- tests

    /// Real proof signed by Reclaim attestor 0x2448…9072 (fixture from reclaim-solidity-sdk samples).
    function test_realReclaimProofSignatureVerifies() public view {
        ReclaimPledgeVerifier.Proof memory p;
        p.claimInfo = ReclaimPledgeVerifier.ClaimInfo(
            string(hex"68747470"),
            string(
                hex"7b2268656164657273223a7b22616363657074223a226170706c69636174696f6e2f6a736f6e2c20746578742f706c61696e2c202a2f2a227d2c226d6574686f64223a22474554222c22726573706f6e73654d617463686573223a5b7b2274797065223a22636f6e7461696e73222c2276616c7565223a227b5c22657468657265756d5c223a7b5c227573645c223a333830342e32347d7d227d5d2c22726573706f6e7365526564616374696f6e73223a5b5d2c2275726c223a2268747470733a2f2f6170692e636f696e6765636b6f2e636f6d2f6170692f76332f73696d706c652f70726963653f6964733d657468657265756d2676735f63757272656e636965733d757364227d"
            ),
            string(hex"7b2270726f766964657248617368223a22307865313165316635363962643437663032616361333330366135623534346531326233376263626365623065386466383930653037663732333930316637303966227d")
        );
        p.signedClaim.claim = ReclaimPledgeVerifier.CompleteClaimData(
            0x9b92efaa7f1c6fc7e0ff86f2ff0dbe569788ad36f2ec3d730a5715c21e25fdda, 0x1Be31A94361a391bBaFB2a4CCd704F57dc04d4bb, 1717383161, 1
        );
        p.signedClaim.signatures = new bytes[](1);
        p.signedClaim.signatures[0] =
            hex"3fcc9f4cf27950a9b88cd2bfdc44a3735709e35390ec79962a12a459f16253be2cd75686d42c09993650d1e96d7f8d898b628686c896c7598f296ec9d3c490b31b";
        string memory ctx = rv.verifySignatures(p);
        assertEq(bytes(rv.extractField(ctx, '"providerHash":"')).length, 66);
    }

    function test_verify_mapsFacts() public view {
        ReclaimPledgeVerifier.Proof memory p =
            _proof(_context(alice, PARAMS, PROVIDER_HASH), uint32(block.timestamp), ATTESTOR_PK);
        PledgeFacts memory f = rv.verify(abi.encode(p));
        assertEq(f.assetId, ASSET);
        assertEq(f.quantity, 25);
        assertEq(f.wallet, alice);
        assertEq(f.status, Types.STATUS_CONFIRMED);
        assertEq(f.pledgeeIdHash, keccak256("ZERODHA-MARGIN"));
        assertEq(f.pledgorIdHash, keccak256("AB1234"));
        assertEq(f.kind, Types.KIND_RECLAIM);
        assertEq(f.observedAt, block.timestamp);
    }

    function test_endToEnd_registerAndMintWithReclaim() public {
        bytes memory proof = abi.encode(_proof(_context(alice, PARAMS, PROVIDER_HASH), uint32(block.timestamp), ATTESTOR_PK));
        vm.prank(alice);
        uint256 id = core.registerPledge(address(rv), proof, x);
        vm.prank(x);
        core.acceptPledge(id);
        mintFor(alice, id, 25);
        assertEq(token.balanceOf(alice), shares(25));
        assertEq(core.getPledge(id).kind, Types.KIND_RECLAIM);
    }

    function test_psnBecomesRef() public view {
        string memory params = string.concat(PARAMS, ',"psn":"PSN-0001"');
        PledgeFacts memory f =
            rv.verify(abi.encode(_proof(_context(alice, params, PROVIDER_HASH), uint32(block.timestamp), ATTESTOR_PK)));
        assertEq(f.pledgeRef, keccak256(abi.encodePacked("PSN", "PSN-0001")));
    }

    function test_unconfirmedStatus() public view {
        string memory params = '"isin":"INE002A01018","qty":"25","client":"AB1234","status":"PENDING"';
        PledgeFacts memory f =
            rv.verify(abi.encode(_proof(_context(alice, params, PROVIDER_HASH), uint32(block.timestamp), ATTESTOR_PK)));
        assertEq(f.status, 0);
    }

    function test_rejects() public {
        // wrong provider
        bytes32 other = keccak256("evil-provider");
        bytes memory p1 = abi.encode(_proof(_context(alice, PARAMS, other), uint32(block.timestamp), ATTESTOR_PK));
        vm.expectRevert(abi.encodeWithSelector(ReclaimPledgeVerifier.ProviderNotAllowed.selector, other));
        rv.verify(p1);

        // unknown attestor
        bytes memory p2 = abi.encode(_proof(_context(alice, PARAMS, PROVIDER_HASH), uint32(block.timestamp), 0xBAD));
        vm.expectRevert(abi.encodeWithSelector(ReclaimPledgeVerifier.UnknownAttestor.selector, vm.addr(0xBAD)));
        rv.verify(p2);

        // tampered context
        ReclaimPledgeVerifier.Proof memory p3 =
            _proof(_context(alice, PARAMS, PROVIDER_HASH), uint32(block.timestamp), ATTESTOR_PK);
        p3.claimInfo.context = _context(alice, '"isin":"INE002A01018","qty":"9999","client":"AB1234"', PROVIDER_HASH);
        vm.expectRevert(ReclaimPledgeVerifier.IdentifierMismatch.selector);
        rv.verify(abi.encode(p3));

        // missing field
        bytes memory p4 = abi.encode(
            _proof(_context(alice, '"isin":"INE002A01018","qty":"25"', PROVIDER_HASH), uint32(block.timestamp), ATTESTOR_PK)
        );
        vm.expectRevert(abi.encodeWithSelector(ReclaimPledgeVerifier.MissingField.selector, "client"));
        rv.verify(p4);
    }

    function test_replayFromOtherWalletRejectedByCore() public {
        address dev = makeMinter("dev");
        bytes memory proof = abi.encode(_proof(_context(alice, PARAMS, PROVIDER_HASH), uint32(block.timestamp), ATTESTOR_PK));
        vm.prank(dev);
        vm.expectRevert(OpenShareCore.WrongWallet.selector);
        core.registerPledge(address(rv), proof, x);
    }

    function test_parsers() public view {
        assertEq(rv.parseUintPrefix("1,200.50"), 1200);
        assertEq(rv.parseAddress("0x00000000000000000000000000000000000000ff"), address(0xff));
    }
}
