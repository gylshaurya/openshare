// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPledgeVerifier} from "../interfaces/IPledgeVerifier.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {PledgeFacts, Types} from "../libraries/Types.sol";
import {RoleRegistry} from "../registry/RoleRegistry.sol";
import {ComplianceRegistry} from "../registry/ComplianceRegistry.sol";
import {OpenShareToken} from "./OpenShareToken.sol";
import {TokenFactory} from "./TokenFactory.sol";
import {BondVault} from "./BondVault.sol";

/// @title OpenShareCore
/// @notice Pledges, minting, redemptions, bonds and defaults. Enforces, per asset:
///         totalSupply == (Σ pledge.minted + reserveShares) * 1e18  and  pendingRedemption <= minted <= quantity.
///         SPEC §8.9 and §9. Decision IDs (Dn) refer to SPEC §6.
contract OpenShareCore is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PARAM_ROLE = keccak256("PARAM_ROLE");

    // ------------------------------------------------------------------ types

    struct Params {
        uint16 bondRatioBps; // D1: 11_000
        uint16 bondRatioExtendedBps; // D1: 12_500
        uint16 mintFeeBps; // D24: 10
        uint16 redeemFeeBps; // D24: 20
        uint16 priceBandBps; // D13: 100
        uint16 defaultPenaltyBps; // D7: 500
        uint64 cureWindow; // D1: 24h
        uint64 attestationInterval; // D9: 7d
        uint64 staleGrace; // D9: 3d
        uint64 maxProofAge; // D14: 24h
        uint64 minDefaultDelay; // D12: 1h
        uint64 deadlineSessions; // D12: 3
        uint64 minRedeemShares; // D11: 10
        uint32 maxTicketsPerRequest; // 8
        uint32 maxFifoScan; // 64
    }

    struct Asset {
        bool listed;
        address token;
        string isin;
        string symbol;
        uint64 totalPledged; // Σ quantity of Active pledges
        uint64 totalMinted; // Σ minted
        uint64 reserveShares;
        uint256 reserveUsdt;
        uint256[] fifo;
        uint256 fifoCursor;
    }

    enum BrokerStatus {
        None,
        Active,
        Defaulted
    }

    struct Broker {
        BrokerStatus status;
        bytes32 pledgeeIdHash;
        string name;
        uint64 undercollateralizedSince;
    }

    enum PledgeStatus {
        None,
        Proposed,
        Active,
        Closed
    }

    struct Pledge {
        bytes32 assetId;
        address minter;
        address broker;
        bytes32 pledgeRef;
        address verifier;
        uint8 kind;
        PledgeStatus status;
        bool frozen;
        uint64 quantity;
        uint64 minted;
        uint64 pendingRedemption;
        uint64 lastAttestedAt;
        uint64 acceptedAt;
        uint64 staleFlaggedAt;
    }

    enum TicketStatus {
        None,
        Pending,
        Settled,
        Defaulted
    }

    struct Ticket {
        uint256 pledgeId;
        address holder;
        uint64 shares;
        uint64 startSession;
        uint64 requestedAt;
        TicketStatus status;
        uint256 paidUsdt;
    }

    // ------------------------------------------------------------------ storage

    IERC20 public immutable usdt;
    RoleRegistry public immutable roles;
    ComplianceRegistry public immutable compliance;
    IPriceOracle public oracle;
    BondVault public immutable vault;
    TokenFactory public immutable tokenFactory;

    Params public params;

    mapping(bytes32 => Asset) internal _assets;
    bytes32[] public assetIds;
    mapping(address => bytes32) public assetOfToken;

    mapping(address => Broker) internal _brokers;
    address[] public brokerList;
    mapping(address => mapping(bytes32 => uint64)) public brokerPledged;
    mapping(address => bytes32[]) internal _brokerAssets;
    mapping(address => mapping(bytes32 => bool)) internal _brokerHasAsset;
    mapping(address => uint256) public brokerPendingTickets;

    mapping(address => bool) public allowedVerifier;
    mapping(bytes32 => bool) public usedPledgeRef;

    mapping(uint256 => Pledge) internal _pledges;
    uint256 public nextPledgeId = 1;
    mapping(address => uint256[]) internal _minterPledges;
    mapping(address => uint256[]) internal _brokerPledges;

    mapping(uint256 => Ticket) internal _tickets;
    uint256 public nextTicketId = 1;
    mapping(address => uint256[]) internal _holderTickets;
    mapping(address => uint256[]) internal _brokerTickets;

    // ------------------------------------------------------------------ events

    event AssetListed(bytes32 indexed assetId, address token, string isin, string symbol);
    event VerifierSet(address indexed verifier, bool allowed);
    event ParamsSet(Params params);
    event OracleSet(address oracle);
    event BrokerRegistered(address indexed broker, bytes32 pledgeeIdHash, string name);
    event BrokerStatusChanged(address indexed broker, BrokerStatus status, string reason);
    event UndercollateralizedFlagged(address indexed broker, uint64 since);
    event PledgeRegistered(
        uint256 indexed pledgeId,
        bytes32 indexed assetId,
        address indexed minter,
        address broker,
        bytes32 pledgeRef,
        uint64 quantity,
        uint8 kind
    );
    event PledgeAccepted(uint256 indexed pledgeId, address indexed broker);
    event PledgeRejected(uint256 indexed pledgeId);
    event PledgeCancelled(uint256 indexed pledgeId);
    event PledgeClosed(uint256 indexed pledgeId);
    event Minted(uint256 indexed pledgeId, address indexed minter, uint64 shares, uint256 feeUsdt);
    event Burned(uint256 indexed pledgeId, address indexed minter, uint64 shares);
    event ReleaseRequested(uint256 indexed pledgeId, address indexed minter, uint64 shares);
    event Attested(uint256 indexed pledgeId, address indexed by, uint64 provenQuantity, uint8 kind);
    event PledgeShortfall(
        uint256 indexed pledgeId,
        uint64 shortfall,
        uint64 fromFree,
        uint64 toReserve,
        uint256 minterCompensation,
        uint256 reserveFunded
    );
    event StaleFlagged(uint256 indexed pledgeId);
    event StaleSlashed(uint256 indexed pledgeId, uint64 converted, uint256 reserveFunded);
    event ReserveRedeemed(bytes32 indexed assetId, address indexed holder, uint64 shares, uint256 paid);
    event RedemptionRequested(
        uint256 indexed ticketId, uint256 indexed pledgeId, address indexed holder, uint64 shares, uint64 startSession
    );
    event RedemptionSettled(uint256 indexed ticketId, uint256 salePriceUsd6, uint256 perShareUsd6, uint256 payout);
    event RedemptionDefaulted(uint256 indexed ticketId, uint256 due, uint256 paid);

    // ------------------------------------------------------------------ errors

    error NotListed();
    error AlreadyListed();
    error AssetPaused();
    error VerifierNotAllowed();
    error NotMinter();
    error NotBrokerRole();
    error BrokerExists();
    error BrokerNotActive();
    error NotPledgeMinter();
    error NotPledgeBroker();
    error NotPledgeParty();
    error WrongWallet();
    error NotConfirmed();
    error ProofTooOld();
    error ProofFromFuture();
    error PledgeRefUsed();
    error PledgeRefMismatch();
    error PledgeeMismatch();
    error ZeroAmount();
    error BadStatus();
    error Frozen();
    error AttestationStale();
    error ExceedsCapacity();
    error ExceedsAvailable();
    error Unhealthy();
    error PriceUnavailable();
    error BelowMinimum();
    error TooFragmented();
    error InsufficientBacking();
    error NotYetDefaultable();
    error NotStale();

    // ------------------------------------------------------------------ constructor & admin

    constructor(
        address admin,
        IERC20 usdt_,
        RoleRegistry roles_,
        ComplianceRegistry compliance_,
        IPriceOracle oracle_,
        BondVault vault_,
        TokenFactory tokenFactory_,
        Params memory params_
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PARAM_ROLE, admin);
        usdt = usdt_;
        roles = roles_;
        compliance = compliance_;
        oracle = oracle_;
        vault = vault_;
        tokenFactory = tokenFactory_;
        params = params_;
        emit ParamsSet(params_);
    }

    function defaultParams() public pure returns (Params memory) {
        return Params({
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

    function listAsset(string calldata isin, string calldata symbol, string calldata name)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (bytes32 assetId, address token)
    {
        assetId = keccak256(bytes(isin));
        Asset storage a = _assets[assetId];
        if (a.listed) revert AlreadyListed();
        token = tokenFactory.deploy(name, symbol, assetId, address(compliance));
        a.listed = true;
        a.token = token;
        a.isin = isin;
        a.symbol = symbol;
        assetIds.push(assetId);
        assetOfToken[token] = assetId;
        emit AssetListed(assetId, token, isin, symbol);
    }

    function setVerifier(address verifier, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        allowedVerifier[verifier] = allowed;
        emit VerifierSet(verifier, allowed);
    }

    function setParams(Params calldata p) external onlyRole(PARAM_ROLE) {
        params = p;
        emit ParamsSet(p);
    }

    function setOracle(IPriceOracle o) external onlyRole(DEFAULT_ADMIN_ROLE) {
        oracle = o;
        emit OracleSet(address(o));
    }

    // ------------------------------------------------------------------ brokers

    function registerBroker(bytes32 pledgeeIdHash, string calldata name) external {
        if (!roles.isBroker(msg.sender)) revert NotBrokerRole();
        Broker storage b = _brokers[msg.sender];
        if (b.status != BrokerStatus.None) revert BrokerExists();
        b.status = BrokerStatus.Active;
        b.pledgeeIdHash = pledgeeIdHash;
        b.name = name;
        brokerList.push(msg.sender);
        emit BrokerRegistered(msg.sender, pledgeeIdHash, name);
    }

    function isRegisteredBroker(address broker) external view returns (bool) {
        return _brokers[broker].status != BrokerStatus.None;
    }

    function requiredBondBps() public view returns (uint256) {
        return oracle.extendedClosure() ? params.bondRatioExtendedBps : params.bondRatioBps;
    }

    function exposureUsd6(address broker) public view returns (uint256 total) {
        bytes32[] storage list = _brokerAssets[broker];
        for (uint256 i; i < list.length; ++i) {
            uint64 q = brokerPledged[broker][list[i]];
            if (q == 0) continue;
            total += uint256(q) * _price(list[i]);
        }
    }

    function isHealthy(address broker) public view returns (bool) {
        return vault.bond(broker) * Types.BPS >= exposureUsd6(broker) * requiredBondBps();
    }

    function canWithdraw(address broker, uint256 amount) external view returns (bool) {
        Broker storage b = _brokers[broker];
        uint256 bond = vault.bond(broker);
        if (amount > bond) return false;
        if (brokerPendingTickets[broker] != 0) return false;
        uint256 exposure = exposureUsd6(broker);
        if (b.status == BrokerStatus.Defaulted) return exposure == 0;
        if (b.status != BrokerStatus.Active) return false;
        return (bond - amount) * Types.BPS >= exposure * requiredBondBps();
    }

    /// @notice Anyone can update a broker's under-collateralisation timer, and default it after the cure window (D1).
    function pokeCollateral(address broker) external {
        Broker storage b = _brokers[broker];
        if (b.status != BrokerStatus.Active) revert BrokerNotActive();
        bool below100 = vault.bond(broker) < exposureUsd6(broker);
        if (!below100) {
            if (b.undercollateralizedSince != 0) {
                b.undercollateralizedSince = 0;
                emit UndercollateralizedFlagged(broker, 0);
            }
            return;
        }
        if (b.undercollateralizedSince == 0) {
            b.undercollateralizedSince = uint64(block.timestamp);
            emit UndercollateralizedFlagged(broker, uint64(block.timestamp));
        } else if (block.timestamp >= b.undercollateralizedSince + params.cureWindow) {
            _setDefaulted(broker, "undercollateralized");
        }
    }

    // ------------------------------------------------------------------ pledges

    function registerPledge(address verifier, bytes calldata proof, address broker)
        external
        nonReentrant
        returns (uint256 pledgeId)
    {
        if (!allowedVerifier[verifier]) revert VerifierNotAllowed();
        if (!roles.isMinter(msg.sender)) revert NotMinter();
        PledgeFacts memory f = IPledgeVerifier(verifier).verify(proof);
        _checkFacts(f);
        Asset storage a = _assets[f.assetId];
        if (!a.listed) revert NotListed();
        if (compliance.mintPaused(f.assetId)) revert AssetPaused();
        if (usedPledgeRef[f.pledgeRef]) revert PledgeRefUsed();
        Broker storage b = _brokers[broker];
        if (b.status != BrokerStatus.Active) revert BrokerNotActive();
        if (f.pledgeeIdHash != b.pledgeeIdHash) revert PledgeeMismatch();
        if (f.quantity == 0) revert ZeroAmount();

        usedPledgeRef[f.pledgeRef] = true;
        pledgeId = nextPledgeId++;
        Pledge storage p = _pledges[pledgeId];
        p.assetId = f.assetId;
        p.minter = msg.sender;
        p.broker = broker;
        p.pledgeRef = f.pledgeRef;
        p.verifier = verifier;
        p.kind = f.kind;
        p.status = PledgeStatus.Proposed;
        p.quantity = f.quantity;
        p.lastAttestedAt = f.observedAt;
        _minterPledges[msg.sender].push(pledgeId);
        _brokerPledges[broker].push(pledgeId);
        emit PledgeRegistered(pledgeId, f.assetId, msg.sender, broker, f.pledgeRef, f.quantity, f.kind);
    }

    function cancelPledge(uint256 pledgeId) external {
        Pledge storage p = _pledges[pledgeId];
        if (p.minter != msg.sender) revert NotPledgeMinter();
        if (p.status != PledgeStatus.Proposed) revert BadStatus();
        p.status = PledgeStatus.Closed;
        emit PledgeCancelled(pledgeId);
    }

    /// @notice The broker's one-time co-signature (D5). Requires the broker to stay healthy (D1, D2).
    function acceptPledge(uint256 pledgeId) external {
        Pledge storage p = _pledges[pledgeId];
        if (p.broker != msg.sender) revert NotPledgeBroker();
        if (p.status != PledgeStatus.Proposed) revert BadStatus();
        if (_brokers[msg.sender].status != BrokerStatus.Active) revert BrokerNotActive();

        p.status = PledgeStatus.Active;
        p.acceptedAt = uint64(block.timestamp);
        brokerPledged[msg.sender][p.assetId] += p.quantity;
        if (!_brokerHasAsset[msg.sender][p.assetId]) {
            _brokerHasAsset[msg.sender][p.assetId] = true;
            _brokerAssets[msg.sender].push(p.assetId);
        }
        Asset storage a = _assets[p.assetId];
        a.totalPledged += p.quantity;
        a.fifo.push(pledgeId);
        if (!isHealthy(msg.sender)) revert Unhealthy();
        emit PledgeAccepted(pledgeId, msg.sender);
    }

    function rejectPledge(uint256 pledgeId) external {
        Pledge storage p = _pledges[pledgeId];
        if (p.broker != msg.sender) revert NotPledgeBroker();
        if (p.status != PledgeStatus.Proposed) revert BadStatus();
        p.status = PledgeStatus.Closed;
        emit PledgeRejected(pledgeId);
    }

    /// @notice Mint tokens against an accepted pledge. Allowed at any time, including weekends (D4).
    function mint(uint256 pledgeId, uint64 shares) external nonReentrant {
        Pledge storage p = _pledges[pledgeId];
        if (p.minter != msg.sender) revert NotPledgeMinter();
        if (p.status != PledgeStatus.Active) revert BadStatus();
        if (p.frozen) revert Frozen();
        if (_brokers[p.broker].status != BrokerStatus.Active) revert BrokerNotActive();
        if (compliance.mintPaused(p.assetId)) revert AssetPaused();
        if (block.timestamp > uint256(p.lastAttestedAt) + params.attestationInterval) revert AttestationStale();
        if (shares == 0) revert ZeroAmount();
        if (p.minted + shares > p.quantity) revert ExceedsCapacity();

        Asset storage a = _assets[p.assetId];
        p.minted += shares;
        a.totalMinted += shares;
        uint256 fee = uint256(shares) * _price(p.assetId) * params.mintFeeBps / Types.BPS;
        OpenShareToken(a.token).mint(msg.sender, uint256(shares) * Types.SHARE);
        if (fee > 0) usdt.safeTransferFrom(msg.sender, p.broker, fee);
        emit Minted(pledgeId, msg.sender, shares, fee);
    }

    /// @notice Minter burns tokens (e.g. bought back) against their pledge, freeing capacity.
    function burn(uint256 pledgeId, uint64 shares) external nonReentrant {
        Pledge storage p = _pledges[pledgeId];
        if (p.minter != msg.sender) revert NotPledgeMinter();
        if (shares == 0) revert ZeroAmount();
        if (shares > p.minted - p.pendingRedemption) revert ExceedsAvailable();
        Asset storage a = _assets[p.assetId];
        p.minted -= shares;
        a.totalMinted -= shares;
        OpenShareToken(a.token).burn(msg.sender, uint256(shares) * Types.SHARE);
        emit Burned(pledgeId, msg.sender, shares);
    }

    /// @notice Release unminted pledged shares. The broker must unpledge off-chain (trusted step).
    function release(uint256 pledgeId, uint64 shares) external {
        Pledge storage p = _pledges[pledgeId];
        if (p.minter != msg.sender) revert NotPledgeMinter();
        if (p.status != PledgeStatus.Active) revert BadStatus();
        if (shares == 0) revert ZeroAmount();
        if (shares > p.quantity - p.minted) revert ExceedsAvailable();
        _reduceQuantity(pledgeId, p, shares);
        emit ReleaseRequested(pledgeId, msg.sender, shares);
    }

    /// @notice Periodic re-proof by the minter or broker (D9). A lower proven quantity is a shortfall (D8).
    function attest(uint256 pledgeId, address verifier, bytes calldata proof) external nonReentrant {
        Pledge storage p = _pledges[pledgeId];
        if (msg.sender != p.minter && msg.sender != p.broker) revert NotPledgeParty();
        if (p.status != PledgeStatus.Active) revert BadStatus();
        if (!allowedVerifier[verifier]) revert VerifierNotAllowed();
        PledgeFacts memory f = IPledgeVerifier(verifier).verify(proof);
        _checkFacts(f);
        if (f.pledgeRef != p.pledgeRef) revert PledgeRefMismatch();

        if (f.observedAt > p.lastAttestedAt) p.lastAttestedAt = f.observedAt;
        emit Attested(pledgeId, msg.sender, f.quantity, f.kind);

        if (f.quantity >= p.quantity) {
            if (p.frozen && p.staleFlaggedAt != 0 && _brokers[p.broker].status == BrokerStatus.Active) {
                p.frozen = false;
                p.staleFlaggedAt = 0;
            }
            return;
        }
        _applyShortfall(pledgeId, p, p.quantity - f.quantity);
    }

    function flagStale(uint256 pledgeId) external {
        Pledge storage p = _pledges[pledgeId];
        if (p.status != PledgeStatus.Active) revert BadStatus();
        if (block.timestamp <= uint256(p.lastAttestedAt) + params.attestationInterval) revert NotStale();
        p.frozen = true;
        if (p.staleFlaggedAt == 0) p.staleFlaggedAt = uint64(block.timestamp);
        emit StaleFlagged(pledgeId);
    }

    /// @notice After the stale grace, convert the pledge's unescrowed minted shares to bond-funded reserve (D9).
    function slashStale(uint256 pledgeId) external nonReentrant {
        Pledge storage p = _pledges[pledgeId];
        if (p.status != PledgeStatus.Active) revert BadStatus();
        if (block.timestamp <= uint256(p.lastAttestedAt) + params.attestationInterval + params.staleGrace) {
            revert NotStale();
        }
        p.frozen = true;
        if (p.staleFlaggedAt == 0) p.staleFlaggedAt = uint64(block.timestamp);
        uint64 conv = p.minted - p.pendingRedemption;
        uint256 funded = _convertToReserve(pledgeId, p, conv);
        _setDefaulted(p.broker, "stale pledge");
        emit StaleSlashed(pledgeId, conv, funded);
    }

    // ------------------------------------------------------------------ redemptions

    function requestRedemption(bytes32 assetId, uint64 shares)
        external
        nonReentrant
        returns (uint256[] memory ticketIds)
    {
        Asset storage a = _assets[assetId];
        if (!a.listed) revert NotListed();
        if (shares < params.minRedeemShares || shares == 0) revert BelowMinimum();
        if (compliance.mintPaused(assetId)) revert AssetPaused();
        OpenShareToken token = OpenShareToken(a.token);

        // 1. Reserve-backed shares first, paid instantly and pro-rata (D8, D9, D10).
        uint64 r = shares < a.reserveShares ? shares : a.reserveShares;
        if (r > 0) {
            uint256 pay = a.reserveUsdt * r / a.reserveShares;
            a.reserveShares -= r;
            a.reserveUsdt -= pay;
            token.burn(msg.sender, uint256(r) * Types.SHARE);
            if (pay > 0) usdt.safeTransfer(msg.sender, pay);
            emit ReserveRedeemed(assetId, msg.sender, r, pay);
        }

        // 2. FIFO over pledges with unescrowed minted tokens (D10).
        uint64 remaining = shares - r;
        if (remaining == 0) return new uint256[](0);
        token.escrowFrom(msg.sender, uint256(remaining) * Types.SHARE);

        uint256 maxTickets = params.maxTicketsPerRequest;
        uint256[] memory ids = new uint256[](maxTickets);
        uint256 n;
        uint256 scanned;
        uint64 startSession = oracle.assetSessions(assetId);
        uint256 i = a.fifoCursor;
        while (remaining > 0) {
            if (i >= a.fifo.length) revert InsufficientBacking();
            if (++scanned > params.maxFifoScan) revert TooFragmented();
            uint256 pid = a.fifo[i];
            Pledge storage p = _pledges[pid];
            if (p.status == PledgeStatus.Closed) {
                if (i == a.fifoCursor) a.fifoCursor = i + 1;
                ++i;
                continue;
            }
            uint64 avail = p.minted - p.pendingRedemption;
            if (avail > 0) {
                if (n == maxTickets) revert TooFragmented();
                uint64 t = avail < remaining ? avail : remaining;
                p.pendingRedemption += t;
                remaining -= t;
                uint256 tid = nextTicketId++;
                _tickets[tid] = Ticket({
                    pledgeId: pid,
                    holder: msg.sender,
                    shares: t,
                    startSession: startSession,
                    requestedAt: uint64(block.timestamp),
                    status: TicketStatus.Pending,
                    paidUsdt: 0
                });
                brokerPendingTickets[p.broker] += 1;
                _holderTickets[msg.sender].push(tid);
                _brokerTickets[p.broker].push(tid);
                ids[n++] = tid;
                emit RedemptionRequested(tid, pid, msg.sender, t, startSession);
            }
            ++i;
        }
        ticketIds = new uint256[](n);
        for (uint256 k; k < n; ++k) {
            ticketIds[k] = ids[k];
        }
    }

    /// @notice Broker pays the holder from its own USDT after selling the invoked shares (D13).
    function settleRedemption(uint256 ticketId, uint256 salePriceUsd6) external nonReentrant {
        Ticket storage t = _tickets[ticketId];
        if (t.status != TicketStatus.Pending) revert BadStatus();
        Pledge storage p = _pledges[t.pledgeId];
        if (p.broker != msg.sender) revert NotPledgeBroker();

        uint256 close = _closePrice(p.assetId);
        uint256 floor = close * (Types.BPS - params.priceBandBps) / Types.BPS;
        uint256 perShare = salePriceUsd6 > floor ? salePriceUsd6 : floor;
        uint256 gross = perShare * t.shares;
        uint256 payout = gross - gross * params.redeemFeeBps / Types.BPS;

        t.status = TicketStatus.Settled;
        t.paidUsdt = payout;
        _finishTicket(t, p);
        usdt.safeTransferFrom(msg.sender, t.holder, payout);
        emit RedemptionSettled(ticketId, salePriceUsd6, perShare, payout);
    }

    /// @notice After the deadline, anyone can make the broker's bond pay the holder (D7, D12).
    function claimDefault(uint256 ticketId) external nonReentrant {
        Ticket storage t = _tickets[ticketId];
        if (t.status != TicketStatus.Pending) revert BadStatus();
        Pledge storage p = _pledges[t.pledgeId];
        if (
            oracle.assetSessions(p.assetId) < t.startSession + params.deadlineSessions
                || block.timestamp < uint256(t.requestedAt) + params.minDefaultDelay
        ) revert NotYetDefaultable();

        uint256 due = uint256(t.shares) * _closePrice(p.assetId) * (Types.BPS + params.defaultPenaltyBps) / Types.BPS;
        t.status = TicketStatus.Defaulted;
        address broker = p.broker;
        _finishTicket(t, p);
        uint256 paid = vault.pay(broker, t.holder, due);
        t.paidUsdt = paid;
        _setDefaulted(broker, "missed redemption deadline");
        emit RedemptionDefaulted(ticketId, due, paid);
    }

    // ------------------------------------------------------------------ internal

    function _checkFacts(PledgeFacts memory f) internal view {
        if (f.wallet != msg.sender) revert WrongWallet();
        if (f.status != Types.STATUS_CONFIRMED) revert NotConfirmed();
        if (f.observedAt > block.timestamp) revert ProofFromFuture();
        if (block.timestamp - f.observedAt > params.maxProofAge) revert ProofTooOld();
    }

    /// @dev Burns escrowed tokens and shrinks the pledge after settlement or default.
    function _finishTicket(Ticket storage t, Pledge storage p) internal {
        uint64 s = t.shares;
        Asset storage a = _assets[p.assetId];
        OpenShareToken(a.token).burn(address(this), uint256(s) * Types.SHARE);
        p.pendingRedemption -= s;
        p.minted -= s;
        a.totalMinted -= s;
        brokerPendingTickets[p.broker] -= 1;
        _reduceQuantity(t.pledgeId, p, s);
    }

    function _reduceQuantity(uint256 pledgeId, Pledge storage p, uint64 s) internal {
        if (s == 0) return;
        p.quantity -= s;
        brokerPledged[p.broker][p.assetId] -= s;
        _assets[p.assetId].totalPledged -= s;
        if (p.quantity == 0) {
            p.status = PledgeStatus.Closed;
            emit PledgeClosed(pledgeId);
        }
    }

    /// @dev D8: shortfall comes out of unminted capacity first (minter compensated), then minted shares are
    ///      converted to bond-funded reserve. Escrowed shares are left to their tickets' deadlines.
    function _applyShortfall(uint256 pledgeId, Pledge storage p, uint64 s) internal {
        uint256 close = _closePrice(p.assetId);
        uint64 free = p.quantity - p.minted;
        uint64 fromFree = s < free ? s : free;
        uint256 comp;
        if (fromFree > 0) {
            _reduceQuantity(pledgeId, p, fromFree);
            comp = vault.pay(p.broker, p.minter, _withPenalty(fromFree, close));
        }
        uint64 convertible = p.minted - p.pendingRedemption;
        uint64 rest = s - fromFree;
        uint64 toReserve = rest < convertible ? rest : convertible;
        uint256 funded = _convertToReserve(pledgeId, p, toReserve);
        p.frozen = true;
        _setDefaulted(p.broker, "pledge shortfall");
        emit PledgeShortfall(pledgeId, s, fromFree, toReserve, comp, funded);
    }

    function _convertToReserve(uint256 pledgeId, Pledge storage p, uint64 shares) internal returns (uint256 funded) {
        if (shares == 0) return 0;
        Asset storage a = _assets[p.assetId];
        address broker = p.broker;
        p.minted -= shares;
        a.totalMinted -= shares;
        a.reserveShares += shares;
        _reduceQuantity(pledgeId, p, shares);
        funded = vault.pay(broker, address(this), _withPenalty(shares, _closePrice(p.assetId)));
        a.reserveUsdt += funded;
    }

    function _withPenalty(uint64 shares, uint256 priceUsd6) internal view returns (uint256) {
        return uint256(shares) * priceUsd6 * (Types.BPS + params.defaultPenaltyBps) / Types.BPS;
    }

    function _setDefaulted(address broker, string memory reason) internal {
        Broker storage b = _brokers[broker];
        if (b.status == BrokerStatus.Defaulted) return;
        b.status = BrokerStatus.Defaulted;
        emit BrokerStatusChanged(broker, BrokerStatus.Defaulted, reason);
    }

    function _price(bytes32 assetId) internal view returns (uint256 p) {
        (p,) = oracle.price(assetId);
        if (p == 0) revert PriceUnavailable();
    }

    /// @dev Last session close; falls back to the latest price before the first close.
    function _closePrice(bytes32 assetId) internal view returns (uint256 c) {
        (c,) = oracle.lastClose(assetId);
        if (c == 0) c = _price(assetId);
    }

    // ------------------------------------------------------------------ views

    function getAsset(bytes32 assetId)
        external
        view
        returns (
            bool listed,
            address token,
            string memory isin,
            string memory symbol,
            uint64 totalPledged,
            uint64 totalMinted,
            uint64 reserveShares,
            uint256 reserveUsdt,
            uint256 fifoLength,
            uint256 fifoCursor
        )
    {
        Asset storage a = _assets[assetId];
        return (
            a.listed,
            a.token,
            a.isin,
            a.symbol,
            a.totalPledged,
            a.totalMinted,
            a.reserveShares,
            a.reserveUsdt,
            a.fifo.length,
            a.fifoCursor
        );
    }

    function getAssetIds() external view returns (bytes32[] memory) {
        return assetIds;
    }

    function getBroker(address broker)
        external
        view
        returns (BrokerStatus status, bytes32 pledgeeIdHash, string memory name, uint64 undercollateralizedSince)
    {
        Broker storage b = _brokers[broker];
        return (b.status, b.pledgeeIdHash, b.name, b.undercollateralizedSince);
    }

    function getBrokers() external view returns (address[] memory) {
        return brokerList;
    }

    function brokerHealth(address broker)
        external
        view
        returns (uint256 bond, uint256 exposure, uint256 requiredBps, uint256 ratioBps, uint256 pendingTickets)
    {
        bond = vault.bond(broker);
        exposure = exposureUsd6(broker);
        requiredBps = requiredBondBps();
        ratioBps = exposure == 0 ? type(uint256).max : bond * Types.BPS / exposure;
        pendingTickets = brokerPendingTickets[broker];
    }

    function getPledge(uint256 pledgeId) external view returns (Pledge memory) {
        return _pledges[pledgeId];
    }

    function getTicket(uint256 ticketId) external view returns (Ticket memory) {
        return _tickets[ticketId];
    }

    function pledgesOf(address minter) external view returns (uint256[] memory) {
        return _minterPledges[minter];
    }

    function pledgesOfBroker(address broker) external view returns (uint256[] memory) {
        return _brokerPledges[broker];
    }

    function ticketsOf(address holder) external view returns (uint256[] memory) {
        return _holderTickets[holder];
    }

    function ticketsOfBroker(address broker) external view returns (uint256[] memory) {
        return _brokerTickets[broker];
    }

    function fifoAt(bytes32 assetId, uint256 index) external view returns (uint256) {
        return _assets[assetId].fifo[index];
    }

    /// @notice Sessions remaining before a ticket can be defaulted (0 = defaultable by session count).
    function sessionsRemaining(uint256 ticketId) external view returns (uint64) {
        Ticket storage t = _tickets[ticketId];
        uint64 deadline = t.startSession + params.deadlineSessions;
        uint64 cur = oracle.assetSessions(_pledges[t.pledgeId].assetId);
        return cur >= deadline ? 0 : deadline - cur;
    }
}
