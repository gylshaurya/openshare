import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { mnemonicToAccount, privateKeyToAccount, type LocalAccount } from "viem/accounts";
import { chainById, parseDeployment, type Deployment } from "@openshare/shared";

/** Server-only configuration. Keys never reach the browser. */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
export const RPC_URL = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";
export const DEMO_MODE = (process.env.NEXT_PUBLIC_DEMO_MODE ?? "true") === "true";
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

/** Loads a key from env; on a local chain falls back to the anvil account with the Seed.s.sol index. */
function account(envName: string, localIndex: number): LocalAccount | undefined {
  const pk = process.env[envName];
  if (pk) return privateKeyToAccount(pk as Hex);
  if (CHAIN_ID === 31337) return mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: localIndex });
  return undefined;
}

export const signers = {
  relayer: () => account("RELAYER_PRIVATE_KEY", 1),
  world: () => account("WORLD_ATTESTOR_PRIVATE_KEY", 2),
  mock: () => account("MOCK_ATTESTOR_PRIVATE_KEY", 3),
  kite: () => account("KITE_ATTESTOR_PRIVATE_KEY", 4),
};

export function deployment(): Deployment {
  const path = process.env.DEPLOYMENT_PATH ?? join(process.cwd(), "..", "deployments", `${CHAIN_ID}.json`);
  return parseDeployment(JSON.parse(readFileSync(/*turbopackIgnore: true*/ path, "utf8")));
}

export function publicClient() {
  return createPublicClient({ chain: chainById(CHAIN_ID), transport: http(RPC_URL) });
}

export function walletClient(acc: LocalAccount) {
  return createWalletClient({ chain: chainById(CHAIN_ID), transport: http(RPC_URL), account: acc });
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json" },
  });
