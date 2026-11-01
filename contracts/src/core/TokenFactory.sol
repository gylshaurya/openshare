// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {OpenShareToken} from "./OpenShareToken.sol";

/// @notice Deploys OpenShareToken instances so OpenShareCore stays under the contract size limit.
contract TokenFactory {
    function deploy(string calldata name, string calldata symbol, bytes32 assetId, address compliance)
        external
        returns (address)
    {
        // msg.sender (OpenShareCore) becomes the token's core.
        return address(new OpenShareToken(name, symbol, assetId, msg.sender, compliance));
    }
}
