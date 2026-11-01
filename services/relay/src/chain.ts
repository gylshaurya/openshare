import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById, parseDeployment, priceOracleAbi, type Deployment } from "@openshare/shared";
import "dotenv/config";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function config() {
  const chainId = Number(process.env.CHAIN_ID ?? 31337);
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  // Local default: anvil account #1 (matches Seed.s.sol relayer index 1).
  const pk = (process.env.RELAYER_PRIVATE_KEY ??
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") as Hex;
  const deploymentPath = process.env.DEPLOYMENT_PATH ?? join(ROOT, "deployments", `${chainId}.json`);
  return { chainId, rpcUrl, pk, deploymentPath };
}

export function loadDeployment(path: string): Deployment {
  return parseDeployment(JSON.parse(readFileSync(path, "utf8")));
}

export function clients() {
  const c = config();
  const chain = chainById(c.chainId);
  const account = privateKeyToAccount(c.pk);
  const transport = http(c.rpcUrl);
  const pub = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ chain, transport, account });
  const dep = loadDeployment(c.deploymentPath);
  return { pub, wallet, account, dep, chain };
}

export type Clients = ReturnType<typeof clients>;

export async function readOracleAsset(cl: Clients, assetId: Hex) {
  const r = (await cl.pub.readContract({
    address: cl.dep.oracle,
    abi: priceOracleAbi,
    functionName: "prices",
    args: [assetId],
  })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, number];
  return {
    usd6: r[0],
    inrPaise: r[1],
    usdInr6: r[2],
    updatedAt: r[3],
    closeUsd6: r[4],
    closeSessionId: r[5],
    sessions: r[6],
    halted: r[7],
    source: r[8],
  };
}
