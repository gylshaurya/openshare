/**
 * End-to-end demo scenario against a local deployment + running app (SPEC §19):
 *   pnpm chain · pnpm deploy:local · pnpm dev · pnpm e2e
 * Uses anvil's unlocked accounts (Seed.s.sol indices) and the app's API routes for attestations/ops.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  SHARE,
  formatUsd6,
  mockUSDTAbi,
  openShareCoreAbi,
  openShareTokenAbi,
  parseDeployment,
  poolKeyFor,
  poolSwapTestAbi,
  roleRegistryAbi,
} from "@openshare/shared";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const d = parseDeployment(JSON.parse(readFileSync(join(root, "deployments", "31337.json"), "utf8")));
const MN = "test test test test test test test test test test test junk";
const addr = (i: number) => mnemonicToAccount(MN, { addressIndex: i }).address;
const X = addr(5), ALICE = addr(7), BOB = addr(9), CAROL = addr(10);
const asset = d.assets[0]!;
const pub = createPublicClient({ chain: foundry, transport: http() });
const wallet = createWalletClient({ chain: foundry, transport: http() });

async function send(from: Address, address: Address, abi: any, functionName: string, args: unknown[]) {
  const { request } = await pub.simulateContract({ address, abi, functionName, args, account: from } as never);
  const hash = await wallet.writeContract(request as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted`);
  return r;
}
async function api(path: string, body: unknown) {
  const r = await fetch(`${APP}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error}`);
  return j;
}
const step = (s: string) => console.log(`\n▶ ${s}`);
const core = d.core;
const bal = (a: Address) => pub.readContract({ address: asset.token, abi: openShareTokenAbi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;
const usdt = (a: Address) => pub.readContract({ address: d.usdt, abi: mockUSDTAbi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;
const supply = () => pub.readContract({ address: asset.token, abi: openShareTokenAbi, functionName: "totalSupply" }) as Promise<bigint>;

async function main() {
  step("Alice registers as minter (demo World ID identity)");
  const role = (await pub.readContract({ address: d.roles, abi: roleRegistryAbi, functionName: "roleOf", args: [ALICE] })) as number;
  if (role === 0) {
    const s = await api("/api/world/demo", { wallet: ALICE, role: 1, handle: "alice" });
    await send(ALICE, d.roles, roleRegistryAbi, "register", [
      { ...s.attestation, nullifierHash: BigInt(s.attestation.nullifierHash), expiresAt: BigInt(s.attestation.expiresAt) },
      s.signature,
    ]);
  }

  step("Alice proves a 100-share pledge to Broker X (mock proof) and X co-signs");
  const { proof } = await api("/api/attest/mock", { wallet: ALICE, isin: asset.isin, quantity: 100, pledgee: "ZERODHA-MARGIN", client: "ALICE01", seed: String(Date.now()) });
  const reg = await send(ALICE, core, openShareCoreAbi, "registerPledge", [d.attestedVerifier, proof as Hex, X]);
  const next = (await pub.readContract({ address: core, abi: openShareCoreAbi, functionName: "nextPledgeId" })) as bigint;
  const pid = next - 1n;
  void reg;
  await send(X, core, openShareCoreAbi, "acceptPledge", [pid]);

  step("Market closes for the weekend; Alice mints 100 at 02:00 Saturday");
  await api("/api/ops", { action: "close", extended: true });
  await send(ALICE, d.usdt, mockUSDTAbi, "approve", [core, 2n ** 255n]);
  await send(ALICE, core, openShareCoreAbi, "mint", [pid, 100n]);
  console.log("  supply", Number((await supply()) / SHARE), "Alice", Number((await bal(ALICE)) / SHARE));

  step("Bob buys on the pool (closed-market fee 0.30%)");
  const key = poolKeyFor(asset.token, d.usdt, d.hook);
  const usdtIs0 = key.currency0.toLowerCase() === d.usdt.toLowerCase();
  await send(BOB, d.usdt, mockUSDTAbi, "approve", [d.swapRouter, 2n ** 255n]);
  await send(BOB, d.swapRouter, poolSwapTestAbi, "swap", [
    key,
    { zeroForOne: usdtIs0, amountSpecified: -800_000_000n, sqrtPriceLimitX96: usdtIs0 ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n },
    { takeClaims: false, settleUsingBurn: false },
    "0x",
  ]);
  const bobTokens = await bal(BOB);
  console.log("  Bob holds", Number(bobTokens) / 1e18, asset.symbol);

  step("Bob redeems 40 → FIFO ticket");
  await send(ALICE, asset.token, openShareTokenAbi, "transfer", [BOB, 40n * SHARE]);
  const before = await usdt(BOB);
  await send(BOB, core, openShareCoreAbi, "requestRedemption", [asset.assetId, 40n]);
  let tid = ((await pub.readContract({ address: core, abi: openShareCoreAbi, functionName: "nextTicketId" })) as bigint) - 1n;
  const t1 = (await pub.readContract({ address: core, abi: openShareCoreAbi, functionName: "getTicket", args: [tid] })) as any;
  console.log("  ticket", tid, "→ pledge", t1.pledgeId);

  const brokerOf = async (ticket: bigint) => {
    const t = (await pub.readContract({ address: core, abi: openShareCoreAbi, functionName: "getTicket", args: [ticket] })) as any;
    const p = (await pub.readContract({ address: core, abi: openShareCoreAbi, functionName: "getPledge", args: [t.pledgeId] })) as any;
    return p.broker as Address;
  };
  const b1 = await brokerOf(tid);
  step(`Monday: the ticket's broker (${b1 === X ? "X" : "Y"}) sells and settles at $16.11`);
  await api("/api/ops", { action: "open" });
  await send(b1, d.usdt, mockUSDTAbi, "approve", [core, 2n ** 255n]);
  await send(b1, core, openShareCoreAbi, "settleRedemption", [tid, 16_110_000n]);
  console.log("  Bob received", formatUsd6((await usdt(BOB)) - before));

  step("Carol redeems 20; the assigned broker ignores it; 3 sessions pass; anyone claims the default");
  await send(ALICE, asset.token, openShareTokenAbi, "transfer", [CAROL, 20n * SHARE]);
  await send(CAROL, core, openShareCoreAbi, "requestRedemption", [asset.assetId, 20n]);
  tid = ((await pub.readContract({ address: core, abi: openShareCoreAbi, functionName: "nextTicketId" })) as bigint) - 1n;
  await api("/api/ops", { action: "advance", sessions: 3 });
  // minDefaultDelay is 1 minute with DEMO_PARAMS; move anvil time forward.
  await pub.request({ method: "evm_increaseTime" as never, params: [120] as never });
  await pub.request({ method: "evm_mine" as never, params: [] as never });
  const c0 = await usdt(CAROL);
  await send(BOB, core, openShareCoreAbi, "claimDefault", [tid]);
  console.log("  Carol paid from the broker's bond:", formatUsd6((await usdt(CAROL)) - c0));
  const b2 = await brokerOf(tid);
  const broker = (await pub.readContract({ address: core, abi: openShareCoreAbi, functionName: "getBroker", args: [b2] })) as any;
  console.log(`  Broker ${b2 === X ? "X" : "Y"} status:`, broker[0] === 2 ? "Defaulted" : broker[0]);

  step("Rule check");
  const a = (await pub.readContract({ address: core, abi: openShareCoreAbi, functionName: "getAsset", args: [asset.assetId] })) as any;
  const sup = (await supply()) / SHARE;
  console.log(`  supply ${sup} ≤ pledged ${a[4]} + reserve ${a[6]}:`, sup <= a[4] + a[6] ? "✓" : "✗");
  if (sup > a[4] + a[6]) process.exit(1);
  console.log("\nE2E OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
