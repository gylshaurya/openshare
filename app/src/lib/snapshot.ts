import {
  encodeAbiParameters,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  BrokerStatus,
  openShareCoreAbi,
  openShareHookAbi,
  openShareTokenAbi,
  poolKeyAbi,
  poolKeyFor,
  poolManagerAbi,
  poolPriceUsd6,
  priceOracleAbi,
  roleRegistryAbi,
  bondVaultAbi,
  mockUSDTAbi,
  type Deployment,
} from "@openshare/shared";

export interface AssetView {
  assetId: Hex;
  token: Address;
  isin: string;
  symbol: string;
  name: string;
  supply: bigint; // token units (1e18)
  totalPledged: bigint; // shares
  totalMinted: bigint; // shares
  reserveShares: bigint;
  reserveUsdt: bigint;
  priceUsd6: bigint;
  priceUpdatedAt: bigint;
  inrPaise: bigint;
  usdInr6: bigint;
  closeUsd6: bigint;
  sessions: bigint;
  halted: boolean;
  source: number;
  poolPriceUsd6: bigint;
  hookFee: number;
  stale: boolean;
}

export interface BrokerView {
  address: Address;
  status: number;
  name: string;
  pledgeeIdHash: Hex;
  undercollateralizedSince: bigint;
  bond: bigint;
  exposure: bigint;
  requiredBps: bigint;
  ratioBps: bigint;
  pendingTickets: bigint;
}

export interface PledgeView {
  id: bigint;
  assetId: Hex;
  minter: Address;
  broker: Address;
  pledgeRef: Hex;
  verifier: Address;
  kind: number;
  status: number;
  frozen: boolean;
  quantity: bigint;
  minted: bigint;
  pendingRedemption: bigint;
  lastAttestedAt: bigint;
  acceptedAt: bigint;
  staleFlaggedAt: bigint;
}

export interface TicketView {
  id: bigint;
  pledgeId: bigint;
  holder: Address;
  shares: bigint;
  startSession: bigint;
  requestedAt: bigint;
  status: number;
  paidUsdt: bigint;
  sessionsRemaining: bigint;
}

export interface Params {
  bondRatioBps: number;
  bondRatioExtendedBps: number;
  mintFeeBps: number;
  redeemFeeBps: number;
  priceBandBps: number;
  defaultPenaltyBps: number;
  cureWindow: bigint;
  attestationInterval: bigint;
  staleGrace: bigint;
  maxProofAge: bigint;
  minDefaultDelay: bigint;
  deadlineSessions: bigint;
  minRedeemShares: bigint;
}

export interface UserView {
  address: Address;
  role: number;
  usdt: bigint;
  balances: Record<string, bigint>; // assetId -> token units
  usdtAllowanceCore: bigint;
}

export interface Snapshot {
  blockTime: bigint;
  marketOpen: boolean;
  extendedClosure: boolean;
  currentSessionId: bigint;
  lastHeartbeat: bigint;
  requiredBondBps: bigint;
  params: Params;
  assets: AssetView[];
  brokers: BrokerView[];
  pledges: PledgeView[];
  tickets: TicketView[];
  user?: UserView;
}

export function poolId(token: Address, usdt: Address, hook: Address): Hex {
  const k = poolKeyFor(token, usdt, hook);
  return keccak256(encodeAbiParameters(poolKeyAbi, [k as never]));
}

/** Reads the whole protocol state used by the UI. Demo scale: iterates all pledges and tickets. */
export async function loadSnapshot(client: PublicClient, d: Deployment, account?: Address): Promise<Snapshot> {
  const core = { address: d.core, abi: openShareCoreAbi } as const;
  const oracle = { address: d.oracle, abi: priceOracleAbi } as const;

  const [block, marketOpen, extendedClosure, currentSessionId, lastHeartbeat, requiredBondBps, paramsRaw, brokers, nextPledgeId, nextTicketId] =
    await Promise.all([
      client.getBlock(),
      client.readContract({ ...oracle, functionName: "marketOpen" }),
      client.readContract({ ...oracle, functionName: "extendedClosure" }),
      client.readContract({ ...oracle, functionName: "currentSessionId" }),
      client.readContract({ ...oracle, functionName: "lastHeartbeat" }),
      client.readContract({ ...core, functionName: "requiredBondBps" }),
      client.readContract({ ...core, functionName: "params" }),
      client.readContract({ ...core, functionName: "getBrokers" }),
      client.readContract({ ...core, functionName: "nextPledgeId" }),
      client.readContract({ ...core, functionName: "nextTicketId" }),
    ]);

  const pr = paramsRaw as unknown as readonly [number, number, number, number, number, number, bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, number];
  const params: Params = {
    bondRatioBps: pr[0],
    bondRatioExtendedBps: pr[1],
    mintFeeBps: pr[2],
    redeemFeeBps: pr[3],
    priceBandBps: pr[4],
    defaultPenaltyBps: pr[5],
    cureWindow: pr[6],
    attestationInterval: pr[7],
    staleGrace: pr[8],
    maxProofAge: pr[9],
    minDefaultDelay: pr[10],
    deadlineSessions: pr[11],
    minRedeemShares: pr[12],
  };

  const assets = await Promise.all(
    d.assets.map(async (a): Promise<AssetView> => {
      const [info, p, supply, stale, fee, slot0] = await Promise.all([
        client.readContract({ ...core, functionName: "getAsset", args: [a.assetId] }),
        client.readContract({ ...oracle, functionName: "prices", args: [a.assetId] }),
        client.readContract({ address: a.token, abi: openShareTokenAbi, functionName: "totalSupply" }),
        client.readContract({ ...oracle, functionName: "isStale", args: [a.assetId] }),
        client.readContract({ address: d.hook, abi: openShareHookAbi, functionName: "currentFee", args: [a.assetId] }),
        client
          .readContract({
            address: d.poolManager,
            abi: poolManagerAbi,
            functionName: "extsload",
            args: [keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId(a.token, d.usdt, d.hook), 6n]))],
          })
          .catch(() => "0x0" as Hex),
      ]);
      const i = info as unknown as readonly [boolean, Address, string, string, bigint, bigint, bigint, bigint, bigint, bigint];
      const q = p as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, number];
      const sqrt = BigInt(slot0 as Hex) & ((1n << 160n) - 1n);
      return {
        ...a,
        supply: supply as bigint,
        totalPledged: i[4],
        totalMinted: i[5],
        reserveShares: i[6],
        reserveUsdt: i[7],
        priceUsd6: q[0],
        inrPaise: q[1],
        usdInr6: q[2],
        priceUpdatedAt: q[3],
        closeUsd6: q[4],
        sessions: q[6],
        halted: q[7],
        source: Number(q[8]),
        poolPriceUsd6: poolPriceUsd6(sqrt, a.token, d.usdt),
        hookFee: Number(fee),
        stale: stale as boolean,
      };
    }),
  );

  const brokerViews = await Promise.all(
    (brokers as Address[]).map(async (b): Promise<BrokerView> => {
      const [info, health] = await Promise.all([
        client.readContract({ ...core, functionName: "getBroker", args: [b] }),
        client.readContract({ ...core, functionName: "brokerHealth", args: [b] }).catch(() => null),
      ]);
      const i = info as unknown as readonly [number, Hex, string, bigint];
      const h = (health ?? [0n, 0n, 0n, 0n, 0n]) as unknown as readonly [bigint, bigint, bigint, bigint, bigint];
      if (!health) {
        const bond = (await client.readContract({ address: d.vault, abi: bondVaultAbi, functionName: "bond", args: [b] })) as bigint;
        return { address: b, status: i[0], pledgeeIdHash: i[1], name: i[2], undercollateralizedSince: i[3], bond, exposure: 0n, requiredBps: 0n, ratioBps: 0n, pendingTickets: 0n };
      }
      return {
        address: b,
        status: i[0],
        pledgeeIdHash: i[1],
        name: i[2],
        undercollateralizedSince: i[3],
        bond: h[0],
        exposure: h[1],
        requiredBps: h[2],
        ratioBps: h[3],
        pendingTickets: h[4],
      };
    }),
  );

  const pledgeIds = Array.from({ length: Number(nextPledgeId as bigint) - 1 }, (_, k) => BigInt(k + 1));
  const pledges = await Promise.all(
    pledgeIds.map(async (id): Promise<PledgeView> => {
      const p = (await client.readContract({ ...core, functionName: "getPledge", args: [id] })) as unknown as Omit<PledgeView, "id">;
      return { id, ...p, kind: Number(p.kind), status: Number(p.status) };
    }),
  );

  const ticketIds = Array.from({ length: Number(nextTicketId as bigint) - 1 }, (_, k) => BigInt(k + 1));
  const tickets = await Promise.all(
    ticketIds.map(async (id): Promise<TicketView> => {
      const [t, rem] = await Promise.all([
        client.readContract({ ...core, functionName: "getTicket", args: [id] }),
        client.readContract({ ...core, functionName: "sessionsRemaining", args: [id] }),
      ]);
      const tv = t as unknown as Omit<TicketView, "id" | "sessionsRemaining">;
      return { id, ...tv, status: Number(tv.status), sessionsRemaining: rem as bigint };
    }),
  );

  let user: UserView | undefined;
  if (account && account !== zeroAddress) {
    const [role, usdt, allowance, ...bals] = await Promise.all([
      client.readContract({ address: d.roles, abi: roleRegistryAbi, functionName: "roleOf", args: [account] }),
      client.readContract({ address: d.usdt, abi: mockUSDTAbi, functionName: "balanceOf", args: [account] }),
      client.readContract({ address: d.usdt, abi: mockUSDTAbi, functionName: "allowance", args: [account, d.core] }),
      ...d.assets.map((a) => client.readContract({ address: a.token, abi: openShareTokenAbi, functionName: "balanceOf", args: [account] })),
    ]);
    user = {
      address: account,
      role: Number(role),
      usdt: usdt as bigint,
      usdtAllowanceCore: allowance as bigint,
      balances: Object.fromEntries(d.assets.map((a, k) => [a.assetId, bals[k] as bigint])),
    };
  }

  return {
    blockTime: block.timestamp,
    marketOpen: marketOpen as boolean,
    extendedClosure: extendedClosure as boolean,
    currentSessionId: currentSessionId as bigint,
    lastHeartbeat: lastHeartbeat as bigint,
    requiredBondBps: requiredBondBps as bigint,
    params,
    assets,
    brokers: brokerViews,
    pledges,
    tickets,
    user,
  };
}

export const isActiveBroker = (b: BrokerView) => b.status === BrokerStatus.Active;
