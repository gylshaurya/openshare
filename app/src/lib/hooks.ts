"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { BaseError, ContractFunctionRevertedError, type Abi, type Address } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { parseDeployment, type Deployment } from "@openshare/shared";
import { loadSnapshot, type Snapshot } from "./snapshot";

export function useDeployment() {
  return useQuery({
    queryKey: ["deployment"],
    queryFn: async (): Promise<Deployment> => {
      const r = await fetch("/api/deployment");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "deployment not found");
      return parseDeployment(j);
    },
    staleTime: Infinity,
    retry: 1,
  });
}

/** Whole-protocol snapshot, refreshed every 4 seconds and after every transaction. */
export function useSnapshot() {
  const { data: d } = useDeployment();
  const client = usePublicClient();
  const { address } = useAccount();
  return useQuery({
    queryKey: ["snapshot", d?.core, address],
    enabled: Boolean(d && client),
    queryFn: (): Promise<Snapshot> => loadSnapshot(client as never, d!, address as Address | undefined),
    refetchInterval: 4000,
  });
}

export function errorMessage(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert?.data?.errorName) return `${revert.data.errorName}${revert.data.args?.length ? `(${revert.data.args.join(", ")})` : ""}`;
    return e.shortMessage;
  }
  return (e as Error)?.message ?? String(e);
}

export interface TxRequest {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

/** Simulate → send → wait, with decoded revert reasons. Invalidates the snapshot afterwards. */
export function useTx() {
  const client = usePublicClient();
  const { data: wallet } = useWalletClient();
  const { address } = useAccount();
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const send = useCallback(
    async (label: string, ...reqs: TxRequest[]) => {
      if (!client || !wallet || !address) {
        setError("Connect a wallet first");
        return false;
      }
      setError(null);
      setPending(label);
      try {
        for (const r of reqs) {
          const { request } = await client.simulateContract({ ...(r as object), account: address } as never);
          const hash = await wallet.writeContract(request as never);
          setLastHash(hash);
          const receipt = await client.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") throw new Error("transaction reverted");
        }
        await qc.invalidateQueries({ queryKey: ["snapshot"] });
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setPending(null);
      }
    },
    [client, wallet, address, qc],
  );

  return { send, pending, error, setError, lastHash };
}

export function nowSec() {
  return BigInt(Math.floor(Date.now() / 1000));
}

export function ago(ts: bigint, now: bigint): string {
  if (ts === 0n) return "never";
  const s = Number(now - ts);
  if (s < 0) return "just now";
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function short(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}
