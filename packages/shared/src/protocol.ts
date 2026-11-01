import { keccak256, toBytes, type Address, type Hex } from "viem";
import { foundry, whitechainSepolia } from "viem/chains";

/** Mirrors contracts/src/libraries/Types.sol and OpenShareCore enums. */
export const Role = { None: 0, Minter: 1, Broker: 2 } as const;
export const PledgeStatus = { None: 0, Proposed: 1, Active: 2, Closed: 3 } as const;
export const TicketStatus = { None: 0, Pending: 1, Settled: 2, Defaulted: 3 } as const;
export const BrokerStatus = { None: 0, Active: 1, Defaulted: 2 } as const;
export const PriceSource = { Unset: 0, Relay: 1, Manual: 2, Reclaim: 3 } as const;
export const ProofKind = { Reclaim: 1, Kite: 2, Mock: 3 } as const;
export const STATUS_CONFIRMED = 1;

export const PLEDGE_STATUS_LABEL = ["None", "Proposed", "Active", "Closed"] as const;
export const TICKET_STATUS_LABEL = ["None", "Pending", "Settled", "Defaulted"] as const;
export const BROKER_STATUS_LABEL = ["None", "Active", "Defaulted"] as const;
export const PRICE_SOURCE_LABEL = ["UNSET", "TRUSTED RELAY", "MANUAL", "zkTLS"] as const;
export const PROOF_KIND_LABEL: Record<number, string> = { 1: "zkTLS", 2: "TRUSTED ATTESTOR", 3: "MOCK" };

/** Pledgee label used when Zerodha (margin pledge) stands in for the broker (SPEC D18). */
export const ZERODHA_MARGIN_PLEDGEE = "ZERODHA-MARGIN";
export const pledgeeHash = (pledgeeId: string): Hex => keccak256(toBytes(pledgeeId));
export const assetIdOf = (isin: string): Hex => keccak256(toBytes(isin));

export const chains = { foundry, whitechainSepolia };
export const chainById = (id: number) => (id === whitechainSepolia.id ? whitechainSepolia : foundry);

export interface DeployedAsset {
  assetId: Hex;
  token: Address;
  isin: string;
  symbol: string;
  name: string;
}

export interface Deployment {
  chainId: number;
  deployer: Address;
  usdt: Address;
  mockUsdt: boolean;
  demoParams: boolean;
  compliance: Address;
  roles: Address;
  oracle: Address;
  vault: Address;
  core: Address;
  attestedVerifier: Address;
  reclaimVerifier: Address;
  poolManager: Address;
  swapRouter: Address;
  lpRouter: Address;
  hook: Address;
  deployBlock: number;
  assets: DeployedAsset[];
}

/** Normalises the JSON written by contracts/script/Deploy.s.sol (numbers are written as strings). */
export function parseDeployment(raw: unknown): Deployment {
  const r = raw as Record<string, unknown>;
  return {
    ...(r as unknown as Deployment),
    chainId: Number(r.chainId),
    deployBlock: Number(r.deployBlock ?? 0),
    mockUsdt: Boolean(r.mockUsdt),
    demoParams: Boolean(r.demoParams),
  };
}

/** Indian NSE company names for listed ISINs (display only). */
export const COMPANY: Record<string, { ticker: string; name: string; yahoo: string; nse: string }> = {
  INE002A01018: { ticker: "RELIANCE", name: "Reliance Industries", yahoo: "RELIANCE.NS", nse: "RELIANCE" },
  INE467B01029: { ticker: "TCS", name: "Tata Consultancy Services", yahoo: "TCS.NS", nse: "TCS" },
  INE009A01021: { ticker: "INFY", name: "Infosys", yahoo: "INFY.NS", nse: "INFY" },
};
