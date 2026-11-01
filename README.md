# OpenShare

**Mint tokenized stock against your own pledged shares. Bonded brokers guarantee redemption.**

A shareholder locks shares in their own demat account with a depository pledge to an independent, bonded pledge broker, proves the pledge on-chain (zkTLS or a trusted attestor), and mints one token per share. Tokens trade 24/7 on a Uniswap v4 pool. Any holder can redeem: the broker sells the shares on the exchange and pays USDT, and if it misses the deadline, its on-chain bond pays 105%.

For every stock, the contracts enforce:

```
tokens in existence ≤ shares still pledged + shares converted into a bond-funded USDT reserve
```

📄 **Full specification, design decisions and implementation plan: [`docs/SPEC.md`](docs/SPEC.md)**

## Repository

| Path | What |
|---|---|
| `contracts/` | Foundry: `OpenShareCore`, `BondVault`, `OpenShareToken`, `RoleRegistry` (World ID), `ComplianceRegistry`, `PriceOracle`, `AttestedPledgeVerifier`, `ReclaimPledgeVerifier`, `OpenShareHook` (Uniswap v4), plus deploy and seed scripts |
| `app/` | Next.js app: dashboard, minter, broker, trade, redeem, ops pages, and the API routes (World ID verify, attestors, Kite, Reclaim, demo ops) |
| `services/relay/` | Price relay: NSE calendar, market-data sources, session closes, CLI |
| `packages/shared/` | ABIs (generated), EIP-712 types, units and pool math |
| `scripts/` | ABI generator, end-to-end scenario |
| `docs/` | Spec and integration notes (World ID, Reclaim, Kite, Whitechain, Uniswap v4) |

## Quick start (local)

Requires Foundry, Node 20+ and pnpm 10.

```bash
pnpm install
pnpm chain                 # terminal 1: anvil (12 unlocked accounts, 1s blocks)
pnpm deploy:local          # deploy everything + seed demo actors (brokers X/Y, Dev's LP pledge)
pnpm dev                   # terminal 2: app on http://localhost:3000
pnpm e2e                   # optional: run the whole demo scenario headlessly
```

On a local chain, the header has a **persona switcher** (Alice, Dev, Broker X, Broker Y, Bob, Carol, Admin) that uses anvil's unlocked accounts, so no wallet setup is needed. Demo controls (open or close sessions, advance sessions, set prices) live on **/ops**.

## Tests

```bash
pnpm test:contracts        # 70+ unit, scenario (worked week), hook, Reclaim and invariant tests
pnpm -r test               # shared + relay unit tests
```

## Whitechain Sepolia (chain 1874)

1. Fund the deployer (`DEPLOYER_ADDRESS` in `.env`) with WBT from https://faucet.testnet.whitechain.io. About 0.3 WBT covers the deploy and the demo-actor gas top-ups.
2. `pnpm deploy:whitechain` (deploys and verifies on Blockscout, writes `deployments/1874.json`).
3. `pnpm seed:whitechain` (demo actors; requires MockUSDT, i.e. `USDT_ADDRESS` left empty).
4. `cp app/.env.whitechain app/.env.local && pnpm dev`
5. `cp services/relay/.env.whitechain services/relay/.env && pnpm relay`

## Trust labels

Every trusted or mocked component is labelled in the UI:

| Label | Meaning |
|---|---|
| `zkTLS` | Reclaim proof |
| `TRUSTED ATTESTOR` | Kite API attestor |
| `MOCK` | demo proof |
| `TRUSTED RELAY` / `MANUAL` | prices |
| `DEMO IDENTITY` | World ID stand-in in demo mode |

Testnet prototype. Not an offer of securities.
