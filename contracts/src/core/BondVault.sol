// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ICoreForVault {
    function isRegisteredBroker(address broker) external view returns (bool);
    function canWithdraw(address broker, uint256 amount) external view returns (bool);
}

/// @title BondVault
/// @notice Holds broker USDT bonds. Only OpenShareCore can pay out of a bond. SPEC §8.8 (D1, D7, D8).
contract BondVault {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdt;
    address public core;
    address private immutable deployer;

    mapping(address => uint256) public bond;

    event BondDeposited(address indexed broker, uint256 amount);
    event BondWithdrawn(address indexed broker, uint256 amount);
    event BondPaid(address indexed broker, address indexed to, uint256 requested, uint256 paid);

    error OnlyCore();
    error NotBroker();
    error WithdrawNotAllowed();
    error CoreAlreadySet();

    constructor(IERC20 usdt_) {
        usdt = usdt_;
        deployer = msg.sender;
    }

    /// @notice One-time wiring (Core is deployed after the vault).
    function setCore(address core_) external {
        if (msg.sender != deployer || core != address(0)) revert CoreAlreadySet();
        core = core_;
    }

    function deposit(uint256 amount) external {
        if (!ICoreForVault(core).isRegisteredBroker(msg.sender)) revert NotBroker();
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        bond[msg.sender] += amount;
        emit BondDeposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        if (!ICoreForVault(core).canWithdraw(msg.sender, amount)) revert WithdrawNotAllowed();
        bond[msg.sender] -= amount;
        usdt.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(msg.sender, amount);
    }

    /// @notice Pays up to `amount` from `broker`'s bond to `to`. Returns what was actually paid (D-R8: pro-rata
    ///         shortfall is borne by the recipient when the bond is exhausted).
    function pay(address broker, address to, uint256 amount) external returns (uint256 paid) {
        if (msg.sender != core) revert OnlyCore();
        uint256 b = bond[broker];
        paid = amount < b ? amount : b;
        if (paid > 0) {
            bond[broker] = b - paid;
            usdt.safeTransfer(to, paid);
        }
        emit BondPaid(broker, to, amount, paid);
    }
}
