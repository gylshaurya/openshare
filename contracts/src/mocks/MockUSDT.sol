// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Local-only test USDT (6 decimals, open faucet). Never deployed to a public network.
contract MockUSDT is ERC20 {
    constructor() ERC20("Tether USD (mock)", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
