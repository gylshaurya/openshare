import type { Address, Hex } from "viem";

/** EIP-712 definitions matching RoleRegistry.sol (SPEC §8.3). */
export const roleAttestationTypes = {
  RoleAttestation: [
    { name: "wallet", type: "address" },
    { name: "role", type: "uint8" },
    { name: "nullifierHash", type: "uint256" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export const roleDomain = (chainId: number, verifyingContract: Address) =>
  ({ name: "OpenShareRoles", version: "1", chainId, verifyingContract }) as const;

export interface RoleAttestation {
  wallet: Address;
  role: number;
  nullifierHash: bigint;
  expiresAt: bigint;
}

/** EIP-712 definitions matching AttestedPledgeVerifier.sol (SPEC §8.6). */
export const pledgeFactsTypes = {
  PledgeFacts: [
    { name: "pledgeRef", type: "bytes32" },
    { name: "assetId", type: "bytes32" },
    { name: "quantity", type: "uint64" },
    { name: "pledgorIdHash", type: "bytes32" },
    { name: "pledgeeIdHash", type: "bytes32" },
    { name: "status", type: "uint8" },
    { name: "observedAt", type: "uint64" },
    { name: "wallet", type: "address" },
    { name: "kind", type: "uint8" },
  ],
} as const;

export const pledgeAttestorDomain = (chainId: number, verifyingContract: Address) =>
  ({ name: "OpenSharePledgeAttestor", version: "1", chainId, verifyingContract }) as const;

export interface PledgeFacts {
  pledgeRef: Hex;
  assetId: Hex;
  quantity: bigint;
  pledgorIdHash: Hex;
  pledgeeIdHash: Hex;
  status: number;
  observedAt: bigint;
  wallet: Address;
  kind: number;
}

/** ABI tuple used to encode `abi.encode(PledgeFacts, bytes signature)` for AttestedPledgeVerifier.verify. */
export const pledgeFactsAbiParams = [
  {
    type: "tuple",
    components: [
      { name: "pledgeRef", type: "bytes32" },
      { name: "assetId", type: "bytes32" },
      { name: "quantity", type: "uint64" },
      { name: "pledgorIdHash", type: "bytes32" },
      { name: "pledgeeIdHash", type: "bytes32" },
      { name: "status", type: "uint8" },
      { name: "observedAt", type: "uint64" },
      { name: "wallet", type: "address" },
      { name: "kind", type: "uint8" },
    ],
  },
  { type: "bytes" },
] as const;

/** ABI of ReclaimPledgeVerifier.Proof for `abi.encode(Proof)`. */
export const reclaimProofAbiParams = [
  {
    type: "tuple",
    components: [
      {
        name: "claimInfo",
        type: "tuple",
        components: [
          { name: "provider", type: "string" },
          { name: "parameters", type: "string" },
          { name: "context", type: "string" },
        ],
      },
      {
        name: "signedClaim",
        type: "tuple",
        components: [
          {
            name: "claim",
            type: "tuple",
            components: [
              { name: "identifier", type: "bytes32" },
              { name: "owner", type: "address" },
              { name: "timestampS", type: "uint32" },
              { name: "epoch", type: "uint32" },
            ],
          },
          { name: "signatures", type: "bytes[]" },
        ],
      },
    ],
  },
] as const;
