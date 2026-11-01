# OpenShare: Product Specification and Implementation Plan

> **Status:** v1.0 · living document. This is the single source of truth for what OpenShare is, every design decision made so far, and how to build it.
> **Audience:** engineers and coding agents. An agent should be able to implement OpenShare end to end from this document alone. If code and this spec disagree, fix one of them in the same change, and record why in §6 (Decision log).

---

## 0. Rules for agents working from this spec

1. **Never break the invariant** in §9. Every state-changing function in `OpenShareCore` must keep `totalSupply(asset) == Σ pledge.minted + reserveShares(asset)` and `pledge.minted ≤ pledge.quantity`. The invariant test suite (§17) must pass before any commit that touches contracts.
2. **Don't add mechanisms this spec rejects** (§6, "Rejected"). In particular: no protocol price cap, no auto-mint, no dividend pass-through, no FIFO gaming protection beyond §8.6.
3. **Label every trusted or mocked component** in the UI exactly as §11.7 describes. Never present a mocked or trusted step as trustless.
4. **Never commit secrets.** `.env*` files are gitignored except `.env.example`. Testnet keys only.
5. **Keep commits small and frequent,** one logical change each. Conventional prefixes: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
6. **Units are fixed** (§8.1). Don't introduce new decimal conventions.
7. **When something external is unverified** (§21), build behind the interface in §8 and use the documented fallback. Don't block.
8. **Run `forge test` and `pnpm -r build`** before declaring a phase done. Each phase has acceptance criteria in §16.

---

## 1. Product overview

**OpenShare lets anyone who owns real shares mint tokenized stock against them, without handing the shares to a custodian.**

- A shareholder (the **minter**) keeps the shares in their own demat (brokerage depository) account and locks them with a **depository pledge** in favour of an independent, bonded **pledge broker**.
- The minter proves the pledge on-chain with a **zkTLS proof** of their depository/broker statement, then mints the same number of tokens. They can sell those tokens 24/7, at whatever price the market pays.
- Any token holder can **redeem**. The pledge broker enforces (invokes) the pledge, sells the shares on the exchange and pays the holder in USDT. If the broker fails, the broker's **on-chain USDT bond** pays the holder instead.
- There is **one token per stock** (per ISIN). Every minter and every broker mints into the same fungible token, so liquidity isn't fragmented across issuers.

The first market is India (NSE-listed shares held at CDSL/NSDL), because Indian depositories already support retail pledges. The protocol is market-agnostic: only the **lock adapter** (how a pledge is created and proven) changes per country.

**Analogy:** a car bought on loan. You keep and drive the car, but the registration says "hypothecated to the bank", so you can't sell it. Here the shares stay in your account, but the depository marks them "pledged to X".

---

## 2. Problem

1. **Gatekept tokenized stocks.** Today's tokenized equities are issued by a single firm. It holds the shares in custody, controls minting, and captures the profit whenever the token price drifts from the real price.
   - *Case study (HIMS, Aug 30–31, 2026):* only about $440K of tokens existed. Over a weekend, buyers pushed the token to $61 while the real share was $28.84 (+112%). Nobody else was allowed to add supply. On Monday the single authorised minter minted at about $29 and sold into the premium.
2. **Fragmentation.** Each issuer's token for the same stock is a separate, non-interchangeable asset, which splits liquidity.
3. **Access to Indian equities.** Indian stocks are hard for non-residents to buy. NSE trades only about 31 hours a week (09:15–15:30 IST on weekdays), so it's closed roughly 81% of the time.
4. **Exclusion of existing shareholders.** Millions of people own shares but can't put them on-chain or earn from on-chain demand.

---

## 3. Solution and core mechanism

### 3.1 The one rule

For each stock, the contracts enforce:

```
tokens in existence  ≤  shares still pledged  +  shares already converted into a USDT reserve by bond payouts
```

- **Mint** adds to both sides.
- **Redemption settlement** and **minter release** subtract from both.
- **Trading** touches neither, which is why trading runs 24/7 without the depository.

### 3.2 Lifecycle

```
           weekday, off-chain                          on-chain, any time
┌─────────────────────────────────────┐   ┌──────────────────────────────────────────────────┐
│ Minter creates a depository pledge  │   │ registerPledge(proof) → acceptPledge (broker      │
│ to broker X (24–48 working hours)   │──▶│ co-sign) → mint 24/7 → sell on Uniswap v4 pool    │
└─────────────────────────────────────┘   └──────────────────────────────────────────────────┘
                                                            │
                     holder redeems ◀────────────────────────┘
                          │  tokens escrowed; ticket assigned FIFO to a pledge
                          ▼
     broker invokes pledge, sells on NSE, pays USDT ──▶ settleRedemption: tokens burn, pledge shrinks
                          │ (misses deadline: 3 trading sessions)
                          ▼
     claimDefault: bond pays holder at last close × 1.05; tokens burn; shares stay with broker
```

### 3.3 Why it matters

- **Open minting.** Anyone with pledged shares can mint at any time, including weekends. Minters compete, so premiums close faster, and the profit is spread across shareholders instead of captured by one firm.
- **No custodian.** Shares stay in the owner's account until a redemption actually happens.
- **Verifiable, not trusted.** Brokers are bonded, pledges are proven with zkTLS and re-proven periodically, and failures are provable on-chain.

---

## 4. Roles

| Role | Who | Does | Earns | Identity |
|---|---|---|---|---|
| **Minter** | Any shareholder with a demat account | Pledges shares, proves the pledge, mints and sells tokens, re-proves the pledge periodically | Token sale proceeds, including any premium | World ID (Proof of Human), role `MINTER` |
| **Pledge broker** | An entity with a CDSL demat account and a USDT bond | Accepts pledges, keeps the bond healthy, settles redemptions, re-proves pledges | Mint fee (0.10%) and redemption fee (0.20%) | World ID (Proof of Human), role `BROKER` |
| **Holder** | Anyone with a wallet who isn't on the denylist | Trades 24/7, redeems for USDT | Stock exposure without a brokerage account | None (denylist only) |
| **Relayer** | An operator key run by the protocol | Posts prices, USD/INR, session closes and market status to the oracle | — | Role-gated key |
| **Compliance officer** | An operator key | Maintains the denylist, pauses assets for corporate actions | — | Role-gated key |
| **Protocol** | Smart contracts | Enforces the rule, bonds, deadlines and defaults | Nothing (holds no shares, takes no premium) | — |

**One human, one role.** A human verified with World ID can hold the `MINTER` role or the `BROKER` role, never both (§8.3). This makes "minter and broker are the same person" impossible without a second human.

---

## 5. Worked example (revised)

The numbers are illustrative: 1 Reliance share = ₹1,400 ≈ $16.00, the redemption fee is 0.20%, and bonds are 110% of pledged value (125% over an extended closure). The cast is Alice (100 shares), Dev (200 shares), brokers X and Y, and Bob and Carol (crypto users).

| When | Event | Supply | Pledged (counted) | Reserve | Rule |
|---|---|---|---|---|---|
| Thu | Alice's pledge #1 (100 shares to X) is proven and accepted, and she mints 100 | 100 | #1: 100 | 0 | 100 ≤ 100 ✓ |
| Fri | Dev's pledge #2 (200 to Y) is accepted, nothing minted yet. Alice sells 60 to Bob at $16.00 | 100 | #1: 100 · #2: 200 | 0 | ✓ |
| Sat 02:00 | News breaks and the token trades at $18 with NSE closed. **Dev mints 200 on his own initiative** and sells into the premium, and the price falls to about $16.30. There's no protocol cap | 300 | #1: 100 · #2: 200 | 0 | 300 ≤ 300 ✓ |
| Sun | Bob sells 20 to Carol. Trades touch no pledge | 300 | unchanged | 0 | ✓ |
| Sun | Bob redeems 40. The tokens are escrowed and FIFO assigns ticket T1 to pledge #1 (oldest pledge with minted tokens). The deadline is 3 trading sessions | 300 | unchanged | 0 | ✓ |
| Mon | X invokes 40 shares, sells at ₹1,410 ≈ $16.11, and calls `settleRedemption(T1, 16.11)`. Bob receives 643.11 USDT (gross 644.40, fee 1.29). The tokens burn and pledge #1 drops to 60 | 260 | #1: 60 · #2: 200 | 0 | ✓ |
| Tue | Carol redeems 20, and ticket T2 is assigned to pledge #1 | 260 | #1: 60 · #2: 200 | 0 | ✓ |
| Thu | The deadline passes. Anyone calls `claimDefault(T2)`. X's bond pays Carol 20 × $16.10 × 1.05 = 338.10 USDT, the tokens burn, pledge #1 drops to 40 (X keeps the 20 shares to recover), and X is marked Defaulted | 240 | #1: 40 · #2: 200 | 0 | 240 ≤ 240 ✓ |
| Fri | Alice buys back 40 tokens, burns them against pledge #1, then releases 40. X must unpledge off-chain | 200 | #2: 200 | 0 | 200 ≤ 200 ✓ |

**The default rule:** the bond pays, the escrowed tokens burn, and the matching shares stay pledged to the broker so it can recover what it paid. The minter never gets them back for free, and the holder is never paid twice.

---

## 6. Decision log

Each decision has an ID, used in code comments (`// D7`).

### Accepted

| ID | Decision | Rationale |
|---|---|---|
| **D1** | **Broker bond = 110% of the value of shares pledged to the broker, 125% during an extended market closure** (weekend or holiday gap). Below the requirement, the broker can't accept new pledges or withdraw. Below 100%, a 24-hour cure window starts; if it isn't cured, the broker is marked Defaulted (frozen). | The bond must cover a broker that takes all pledged shares and disappears. Gaps over closures can move the price about 15%, so a buffer is needed. Total collateral is about 210% by design: the bond is collusion insurance, not custody. |
| **D2** | Exposure is measured on **pledged** quantity, not minted quantity. | Minters can mint 24/7 without the broker present (D5), so all pledged shares must be covered at all times. |
| **D3** | **No protocol price management.** Weekend and closed-market prices are set entirely by traders. Buyers carry price risk. | A fixed cap would force minters to sell below fair value when real news breaks (minters get picked off by informed traders). Self-interested minters with pledged capacity already sell into premiums, so the market caps squeezes. |
| **D4** | **Minting is open 24/7** against already-accepted pledges. | Premiums appear only while the exchange is closed (about 81% of the week). Blocking minting then would recreate the single-minter failure. |
| **D5** | **The broker co-signs once, at pledge acceptance.** After that the minter mints without the broker. | Brokers aren't online at 02:00 on Saturday. Acceptance happens on a weekday, when the broker can check the depository. |
| **D6** | **Dividends and corporate-action pass-through are out of scope.** Assets can be paused (`mintPaused`, `transfersPaused`) around corporate actions. | Deferred by product decision. Revisit later; the candidate design is an over-pledge buffer (D-R4). |
| **D7** | **Default rule:** on a missed redemption deadline, the bond pays `shares × lastClose × 1.05`, the escrowed tokens burn, the pledge's counted quantity shrinks, and the broker keeps the off-chain shares to recover. The broker becomes `Defaulted`. | Pays the holder exactly once, and makes the broker whole only through its own shares. |
| **D8** | **Unauthorised invocation is a default (N1).** If a re-proof shows fewer pledged shares than the contract counts, the shortfall is first taken from the minter's *unminted* capacity, and the minter is compensated from the bond at `lastClose × 1.05` per share. The remainder (shares backing minted tokens) is **converted to reserve**: the bond moves `shares × lastClose × 1.05` USDT into the asset's reserve, and those tokens become reserve-backed. The broker becomes `Defaulted`. | Only the pledgee can invoke or release a pledge, so any unexplained drop is the broker's act. Whether it was theft from the minter or collusion with the minter, holders stay fully backed, and in the collusion case the cartel just pays itself. |
| **D9** | **Mandatory periodic re-proofs (issue 1).** Each active pledge must be re-proven at least every `attestationInterval` (7 days) by its minter or broker. If it's stale, anyone can `flagStale` (minting frozen). After a further `staleGrace` (3 days), anyone can `slashStale`: the minted, unescrowed shares convert to reserve (bond-funded) and the broker becomes `Defaulted`. | A lock nobody independent can observe must be re-proven, and silence must cost the party that can observe it. Random challenge redemptions are roadmap (D-R3). |
| **D10** | **Redemption assignment is FIFO** over pledges with outstanding, unescrowed minted tokens, in acceptance order. A request can split across pledges, producing one ticket per pledge. Reserve-backed shares are redeemed first, instantly and pro-rata. | Simple and auditable. Pro-rata or random weighting is roadmap (E13). |
| **D11** | **Redemptions are whole shares only, minimum 10 shares** (`minRedeemShares`, configurable). | Brokers can't sell fractions, and tiny redemptions are spam (E14, E15). |
| **D12** | **Redemption deadline = 3 trading sessions of that asset** (`deadlineSessions`). Sessions are counted per asset from oracle session closes, and only sessions where the asset traded count. Holidays and halts pause the clock automatically. | Invoke + sell + T+1 settlement + INR→USDT conversion realistically takes 2–3 sessions (N6, E3, E4). |
| **D13** | **Sale-price honesty:** the holder receives `max(reportedSalePrice, lastClose × (1 − 1%)) × shares × (1 − 0.20%)`, paid by the broker from its own USDT (not from the bond). | The broker bears any shortfall, and a contract-note proof isn't required for the MVP (issue 14). |
| **D14** | **Pledge proofs must show a confirmed pledge, be bound to the submitting wallet, and use a unique pledge reference once** (nullifier). The pledgee in the proof must match the accepting broker's registered pledgee ID hash. | Prevents minting on pending pledges, replay from other wallets, and double minting (E11, E12). |
| **D15** | **World ID (Proof of Human) gates minters and brokers.** One action (`openshare-role`). The nullifier maps to exactly one role and one wallet. Holders aren't World-ID-gated. | Proof of Human is the minimum credential that stops one person from being both minter and broker (issue 3). |
| **D16** | **Holder compliance via a denylist plus per-asset pauses,** enforced in the token's `_update` hook (every transfer, mint and burn). Pools work because the PoolManager isn't denylisted, and the final transfer to a blocked user reverts. | Transfer rules are enforced in the contract, and pools work without per-pool allowlists (E17). |
| **D17** | **Oracle = a signed price relay run by the protocol operator,** behind a pluggable `IPriceOracle` interface. It's labelled "trusted relay" in the UI. Stretch goal: Reclaim zkTLS proof of the NSE quote page. | No on-chain oracle publishes NSE prices yet. The interface lets Pyth or Chainlink feeds replace it with a one-line config change. |
| **D18** | **Pledge verification is pluggable** (`IPledgeVerifier`). Primary: Reclaim zkTLS proof of the Zerodha Console (or CDSL) pledge page. Fallback: an attestor service that reads the Zerodha Kite Connect API (`collateral_quantity`, i.e. a margin pledge to Zerodha) and signs an EIP-712 statement, labelled "trusted attestor". Demo mode: a mock attestor, labelled "mock". | zkTLS for these pages is unproven. The Kite API can only see margin pledges (pledges to third parties aren't visible on Kite), so the fallback uses a margin pledge as a stand-in for a pledge to the broker. |
| **D19** | **Uniswap v4 pool per asset (asset/USDT) with `OpenShareHook`.** It restricts pools to listed assets paired with USDT, uses dynamic fees (`openFee` while the exchange is open, `closedFee` while it's closed, `staleFee` when the oracle is stale), and reverts swaps when the asset's transfers are paused. | Closed-market trading carries information risk for LPs, so wider fees protect them. No price caps (D3). |
| **D20** | **Everything is deployed on one chain** (target: Whitechain Sepolia, chain ID 1874, an OP Stack L2). That includes a self-deployed Uniswap v4 PoolManager if none exists. | No cross-chain messaging means one less failure mode. |
| **D21** | **Bond and settlement asset: USDT** (configurable address). The bond is valued at par. | A depegged bond asset is a known risk, and a basket of bond assets is roadmap (E18). |
| **D22** | **Pledges are created off-chain on weekdays and can't be created on weekends.** The UX encourages one large pledge, minted against in lots. | Pledging to a third party at Zerodha is a paper/eSign form, processed in 24–48 working hours (verified). |
| **D23** | **The pledge reference** is the depository's pledge sequence number (PSN) when the proof exposes it. Otherwise it's `keccak256(pledgorIdHash, pledgeeIdHash, isin, quantity, createdDate)`. For the Kite fallback it's `keccak256("KITE", userIdHash, isin)`. | Issue 16. |
| **D24** | **Fees:** mint 0.10% of minted value (USDT, minter → broker, at mint), redemption 0.20% (withheld from the holder's payout). Holding fees are roadmap. | Brokers need revenue (issue 10). |

### Rejected (do not implement)

| ID | Rejected idea | Why |
|---|---|---|
| D-R1 | A protocol premium cap or auto-mint hook (mint from pre-pledged capacity when price > oracle + band) | Forces minters to sell below fair value on real news, and adds complexity (D3). |
| D-R2 | Tiered or reduced bonds for regulated brokers | Roadmap only. MVP uses D1. |
| D-R3 | Random challenge redemptions | Roadmap. Mentioned in docs, not built. |
| D-R4 | Dividend pass-through enforced against the broker's bond | Punishes the broker for the minter's failure. Deferred entirely (D6). |
| D-R5 | Chainlink CRE plus a Sepolia → L2 message bridge for prices | Unnecessary once the oracle is a direct relay on the same chain (D17, D20). |
| D-R6 | Pyth or Chainlink price feeds now | No NSE feeds exist yet. Supported later via `IPriceOracle`. |
| D-R7 | World ID gating for holders | Not the minimum credential for the trust decision. The holder denylist covers compliance. |
| D-R8 | Insurance pool funded by fees | Roadmap. MVP pays pro-rata from the defaulting broker's bond only (issue 7). |
| D-R9 | Reassigning a defaulted broker's pledges to a new broker | Roadmap (issue 13). MVP freezes minting on them, and redemptions continue, paid by the broker or its bond. |

---

## 7. System architecture

```
                 ┌───────────────────────────────── Web app (Next.js) ──────────────────────────────────┐
                 │ /            dashboard: supply vs pledged vs reserve, brokers, freshness, market, premium │
                 │ /minter      World ID role → prove pledge (Reclaim | Kite | Mock) → mint / burn / release │
                 │ /broker      World ID role → register → bond → accept pledges → redemption queue → settle  │
                 │ /trade       swap asset/USDT on the v4 pool · add liquidity                               │
                 │ /redeem      request redemption · tickets · claim default                                 │
                 │ /ops         relay status · demo controls (session/market) · denylist                     │
                 │ API routes:  /api/world/verify  /api/attest/kite/*  /api/attest/mock  /api/reclaim/*       │
                 └───────────────┬───────────────────────────────────────────────┬────────────────────────────┘
                                 │ EIP-712 attestations (role, pledge facts)      │ txs (wagmi/viem)
                                 ▼                                                 ▼
┌──────────────── Chain (Whitechain Sepolia 1874) ──────────────────────────────────────────────────────────┐
│ RoleRegistry ◀── World attestor signer        ComplianceRegistry (denylist, pauses)                       │
│ PriceOracle  ◀── Relay service (prices, FX, session closes, market status)                                │
│ PledgeVerifiers: AttestedPledgeVerifier (Kite/Mock signer) · ReclaimPledgeVerifier (zkTLS witnesses)      │
│ OpenShareCore ── BondVault (USDT)      OpenShareToken (one per ISIN, ERC-20, compliance in _update)       │
│ Uniswap v4: PoolManager · OpenShareHook (dynamic fee, pool guard) · PoolSwapTest/ModifyLiquidity routers  │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲
        │ cron: prices every 5 min during sessions; session close after 15:30 IST; market flags
┌───────┴────────── services/relay (Node/TS) ── sources: Yahoo Finance, NSE, FX APIs (median) ──┐
```

---

## 8. On-chain specification

Solidity `^0.8.26`, compiled with `evm_version = "cancun"` (Uniswap v4 needs transient storage). OpenZeppelin Contracts v5. Every contract uses custom errors and emits events for every state change. Access control uses OZ `AccessControl`.

### 8.1 Units and conventions

| Quantity | Unit | Notes |
|---|---|---|
| Shares (pledge quantity, minted, tickets) | `uint64` whole shares | Never fractional on-chain in Core accounting |
| Token amount | `uint256`, 18 decimals | `1 share = 1e18` token units. Core converts with `SHARE = 1e18` |
| USDT amount | `uint256`, 6 decimals | Read `decimals()` at deploy and assert it's 6 |
| Price | `uint256` USDT per share, **6 decimals** (`usd6`) | e.g. $16.10 = `16_100_000` |
| INR price | `uint256` paise (2 decimals) | Stored for transparency only |
| USD/INR | `uint256`, 6 decimals | e.g. 87.50 = `87_500_000` |
| Ratios and fees | basis points (`bps`, 10_000 = 100%) | |
| Asset ID | `bytes32 = keccak256(bytes(isin))` | e.g. ISIN `INE002A01018` (Reliance) |
| Pledge ID | `uint256`, incrementing from 1 | |
| Ticket ID | `uint256`, incrementing from 1 | |

### 8.2 Contracts overview

| Contract | Responsibility |
|---|---|
| `ComplianceRegistry` | Denylist, per-asset `mintPaused` / `transfersPaused` |
| `RoleRegistry` | World-ID-backed roles: one nullifier → one role → one wallet |
| `PriceOracle` (implements `IPriceOracle`) | Prices, FX, per-asset session counter, last close, market status, extended-closure flag, price source |
| `OpenShareToken` | ERC-20 per ISIN. Mint and burn only by Core. Compliance checks in `_update` |
| `AttestedPledgeVerifier` (implements `IPledgeVerifier`) | Verifies EIP-712 `PledgeFacts` signed by an allowed attestor (Kite or mock), with the kind recorded |
| `ReclaimPledgeVerifier` (implements `IPledgeVerifier`) | Verifies Reclaim zkTLS proofs: witness signatures, provider hash, context address, extracted fields |
| `BondVault` | Holds broker USDT bonds. Deposit, withdraw (Core checks health), pay-out by Core only |
| `OpenShareCore` | Assets, brokers, pledges, minting, burning, release, re-proofs, redemptions, defaults, reserves |
| `OpenShareHook` | Uniswap v4 hook: pool guard and dynamic fees |

### 8.3 RoleRegistry

```solidity
enum Role { None, Minter, Broker }
struct RoleAttestation { address wallet; uint8 role; uint256 nullifierHash; uint64 expiresAt; }
// EIP-712 domain: name "OpenShareRoles", version "1"
```

- `register(RoleAttestation att, bytes sig)`. Requires: `block.timestamp ≤ att.expiresAt`; signer has `WORLD_ATTESTOR_ROLE`; `att.wallet == msg.sender`; `nullifierRole[att.nullifierHash] == None`; `roleOf[att.wallet] == None`; `att.role ∈ {Minter, Broker}`. Effects: stores `nullifierRole`, `nullifierWallet`, `roleOf[wallet]`. Event: `RoleRegistered(wallet, role, nullifierHash)`.
- Views: `roleOf(address) → Role`, `isMinter(address)`, `isBroker(address)`.
- Admin `revoke(address)` (`DEFAULT_ADMIN_ROLE`) clears the wallet's role but **keeps the nullifier consumed**, so the human can't re-register under the other role.
- **Off-chain attestor:** `/api/world/verify` verifies the IDKit proof for action `openshare-role` with `signal = wallet address (lowercase hex)`, then signs `RoleAttestation` with `WORLD_ATTESTOR_PRIVATE_KEY` (expiry 1 hour). Exact IDKit/verify API is in §10.3.

### 8.4 ComplianceRegistry

- `setBlocked(address, bool)` (`COMPLIANCE_ROLE`) → `Blocked(address, bool)`.
- `setMintPaused(bytes32 assetId, bool)` and `setTransfersPaused(bytes32 assetId, bool)` (`COMPLIANCE_ROLE`).
- Views: `isBlocked(address)`, `mintPaused(assetId)`, `transfersPaused(assetId)`.
- `canTransfer(assetId, from, to) → bool`: false if the asset's transfers are paused (except mint and burn by Core) or if either party (excluding `address(0)`) is blocked.

### 8.5 PriceOracle (`IPriceOracle`)

```solidity
interface IPriceOracle {
  function price(bytes32 assetId) external view returns (uint256 usd6, uint64 updatedAt);
  function lastClose(bytes32 assetId) external view returns (uint256 usd6, uint64 sessionId);
  function assetSessions(bytes32 assetId) external view returns (uint64); // sessions in which the asset traded
  function marketOpen() external view returns (bool);
  function extendedClosure() external view returns (bool);
  function isStale(bytes32 assetId) external view returns (bool); // marketOpen && now - updatedAt > maxPriceAge
}
```

State: per asset `{usd6, inrPaise, usdInr6, updatedAt, closeUsd6, closeSessionId, sessions, halted, source}`. Global: `marketOpen`, `extendedClosure`, `currentSessionId`, `maxPriceAge` (default 15 min).

`enum PriceSource { Unset, Relay, Manual, Reclaim }`. Exposed so the UI can label prices.

Relayer functions (`RELAYER_ROLE`):
- `pushPrices(PriceUpdate[] updates)` with `PriceUpdate {bytes32 assetId; uint256 inrPaise; uint256 usdInr6; uint8 source;}`. Computes `usd6 = inrPaise * 1e6 * 1e6 / (usdInr6 * 100)`, i.e. `inrPaise * 1e10 / usdInr6`. Reverts on zero values.
- `closeSession(uint64 sessionId, SessionClose[] closes, bool nextIsExtendedClosure)` with `SessionClose {bytes32 assetId; uint256 inrPaise; uint256 usdInr6; bool traded;}`. Requires `sessionId == currentSessionId + 1`. For each asset: set the close; `if (traded) sessions++`; set `halted = !traded`. Sets `marketOpen = false` and `extendedClosure = nextIsExtendedClosure`. Emits `SessionClosed`.
- `setMarketOpen(bool)`. Opening a session clears `extendedClosure`.
- `setHalted(bytes32, bool)`.

Admin: `setMaxPriceAge`. Stretch: `ReclaimPriceVerifier` can call `pushVerifiedPrice` with `source = Reclaim` (§10.6).

`requiredBondBps()` lives in Core: `extendedClosure ? 12_500 : 11_000`.

### 8.6 IPledgeVerifier and PledgeFacts

```solidity
struct PledgeFacts {
  bytes32 pledgeRef;      // D23
  bytes32 assetId;        // keccak256(isin)
  uint64  quantity;       // pledged shares currently in "confirmed" status
  bytes32 pledgorIdHash;  // keccak256(depository client ID / Kite user_id), never raw
  bytes32 pledgeeIdHash;  // keccak256(pledgee BO ID), or keccak256("ZERODHA-MARGIN") for the Kite fallback
  uint8   status;         // 1 = CONFIRMED (only accepted value)
  uint64  observedAt;     // when the source was read
  address wallet;         // bound wallet, must equal the submitter
  uint8   kind;           // 1 = Reclaim, 2 = KiteAttested, 3 = Mock
}
interface IPledgeVerifier {
  function verify(bytes calldata proof) external view returns (PledgeFacts memory);
}
```

**AttestedPledgeVerifier:** `proof = abi.encode(PledgeFacts facts, bytes signature)`. EIP-712 domain `OpenSharePledgeAttestor` v1. The signer must hold `ATTESTOR_ROLE`, and the signer's kind must equal `facts.kind`: `attestorKind[signer]` is set when granting, either Kite or Mock. A mock signer can only produce `kind = Mock`.

**ReclaimPledgeVerifier:** see §10.5. It parses the Reclaim proof and checks witnesses, provider hash allowlist, context address equals the submitter (it receives `wallet` through the facts and Core checks it), and extracted parameters (`isin`, `quantity`, `pledgee`, `status`, `psn`?).

Core keeps `allowedVerifier[address] → bool`. A pledge records which verifier and kind created it. Re-proofs may use any allowed verifier, but must produce the same `pledgeRef`.

### 8.7 OpenShareToken

- `ERC20(name, symbol)`, 18 decimals. Constructor `(name, symbol, assetId, core, compliance)`.
- `mint(to, amount)` and `burn(from, amount)`: `onlyCore`.
- `_update(from, to, value)` override: if not (Core minting or burning), `require(compliance.canTransfer(assetId, from, to))`. Mint and burn by Core still check that the recipient isn't blocked (a blocked holder can't receive a mint).
- Naming: symbol `o` + ticker (e.g. `oRELIANCE`), name `OpenShare <Company>`.

### 8.8 BondVault

- `deposit(uint256 amount)`: the caller must be a registered broker in Core (`core.isRegisteredBroker`). `safeTransferFrom` USDT. `bond[broker] += amount`.
- `withdraw(uint256 amount)`: `require(core.canWithdraw(broker, amount))`. Transfers to the broker.
- `pay(address broker, address to, uint256 amount) returns (uint256 paid)`: `onlyCore`. Pays `min(amount, bond[broker])`, so a shortfall pays pro-rata in effect (D-R8).
- View: `bond(address)`.

### 8.9 OpenShareCore

#### Storage

```solidity
struct Asset {
  bool listed; address token; string isin; string symbol;
  uint64 reserveShares;      // tokens outstanding backed by reserveUsdt
  uint256 reserveUsdt;       // USDT held by Core for reserve-backed redemptions
  uint256[] fifo;            // pledge IDs in acceptance order
  uint256 fifoCursor;        // first index that may still have redeemable minted tokens
}
enum BrokerStatus { None, Active, Defaulted }
struct Broker {
  BrokerStatus status; bytes32 pledgeeIdHash; string name;
  uint64 undercollateralizedSince; // 0 if healthy
  mapping-free aggregates: see below
}
enum PledgeStatus { None, Proposed, Active, Closed }
struct Pledge {
  bytes32 assetId; address minter; address broker; bytes32 pledgeRef; address verifier; uint8 kind;
  PledgeStatus status; bool frozen;
  uint64 quantity;           // counted pledged shares
  uint64 minted;             // outstanding tokens attributed to this pledge (incl. escrowed)
  uint64 pendingRedemption;  // escrowed shares in Pending tickets
  uint64 lastAttestedAt; uint64 acceptedAt; uint64 staleFlaggedAt;
}
enum TicketStatus { None, Pending, Settled, Defaulted }
struct Ticket {
  uint256 pledgeId; address holder; uint64 shares; uint64 startSession; uint64 requestedAt;
  TicketStatus status; uint256 paidUsdt;
}
mapping(bytes32 => Asset) assets; bytes32[] assetIds;
mapping(address => Broker) brokers;
mapping(address => mapping(bytes32 => uint64)) brokerPledged;   // Σ quantity of the broker's Active pledges per asset
mapping(address => bytes32[]) brokerAssets;                     // assets with nonzero history, for exposure loops
mapping(address => uint256) brokerPendingTickets;
mapping(bytes32 => bool) usedPledgeRef;
mapping(uint256 => Pledge) pledges; uint256 nextPledgeId = 1;
mapping(uint256 => Ticket) tickets; uint256 nextTicketId = 1;
Params params; // §14
```

#### Admin and params (`PARAM_ROLE`, `DEFAULT_ADMIN_ROLE`)
- `listAsset(string isin, string symbol, string name) → (bytes32 assetId, address token)`. Deploys `OpenShareToken` via `TokenFactory` (keeps Core under the 24 KB size limit).
- `setVerifier(address, bool)`, `setParams(Params)`.

#### Brokers
- `registerBroker(bytes32 pledgeeIdHash, string name)`. Requires `roleRegistry.isBroker(msg.sender)` and status `None`. Sets `Active`.
- `exposureUsd6(broker) = Σ_asset brokerPledged[broker][asset] × oracle.price(asset)`. Uses the latest price; reverts if any price is unset.
- `requiredBondBps() = oracle.extendedClosure() ? bondRatioExtendedBps : bondRatioBps`.
- `isHealthy(broker) = bond × 10_000 ≥ exposure × requiredBondBps`.
- `canWithdraw(broker, amount)`: status `Active`; `brokerPendingTickets == 0`; and after withdrawal, `(bond − amount) × 10_000 ≥ exposure × requiredBondBps`. A `Defaulted` broker can withdraw only when `exposure == 0 && pendingTickets == 0`.
- `pokeCollateral(broker)` (anyone): if `bond × 10_000 < exposure × 10_000` (below 100%) and `undercollateralizedSince == 0`, set it to now. If at or above 100%, reset to 0. If `undercollateralizedSince != 0 && now ≥ undercollateralizedSince + cureWindow` (24 h), set `Defaulted`. Emits events.

#### Pledges
- `registerPledge(address verifier, bytes proof, address broker) → pledgeId`. Requires: `allowedVerifier[verifier]`; `roleRegistry.isMinter(msg.sender)`; facts from `verify(proof)` with `facts.wallet == msg.sender`; `facts.status == CONFIRMED`; `now − facts.observedAt ≤ maxProofAge` (24 h); asset listed and not `mintPaused`; `!usedPledgeRef[facts.pledgeRef]`; `brokers[broker].status == Active`; `facts.pledgeeIdHash == brokers[broker].pledgeeIdHash`; `facts.quantity > 0`. Effects: create the pledge as `Proposed`, store `quantity = facts.quantity` and `lastAttestedAt = facts.observedAt`; mark `usedPledgeRef`. Event `PledgeRegistered`.
- `cancelPledge(pledgeId)`: the minter, while `Proposed`. Sets `Closed` (the ref stays used).
- `acceptPledge(pledgeId)`: `msg.sender == pledge.broker`; status `Proposed`; broker `Active`. After adding `quantity` to `brokerPledged`, it must be `isHealthy(broker)`. Effects: `Active`, `acceptedAt = now`, push onto `assets[a].fifo`. Event `PledgeAccepted`.
- `rejectPledge(pledgeId)`: broker, while `Proposed` → `Closed`.
- `mint(pledgeId, uint64 shares)`: minter only; pledge `Active`, not `frozen`; broker not `Defaulted`; asset not `mintPaused`; attestation fresh (`now ≤ lastAttestedAt + attestationInterval`); `minted + shares ≤ quantity`. Fee: `fee = shares × price × mintFeeBps / 10_000`, transferred minter → broker in USDT (skipped if the fee is 0). Effects: `minted += shares`; `token.mint(minter, shares × 1e18)`. Event `Minted`. **Permitted at any time of day or week (D4).**
- `burn(pledgeId, uint64 shares)`: minter only; `shares ≤ minted − pendingRedemption`. Burns from the minter's balance. `minted −= shares`. Event `Burned`.
- `release(pledgeId, uint64 shares)`: minter only; pledge `Active`; `shares ≤ quantity − minted`. Effects: `quantity −= shares`; `brokerPledged −= shares`; if `quantity == 0`, set `Closed`. Event `ReleaseRequested(pledgeId, shares)`. The broker must unpledge off-chain (trusted, documented).
- `attest(pledgeId, address verifier, bytes proof)`: `msg.sender ∈ {minter, broker}`; `facts.wallet == msg.sender`; `facts.pledgeRef == pledge.pledgeRef`; confirmed; fresh; pledge `Active`.
  - If `facts.quantity ≥ quantity`: `lastAttestedAt = facts.observedAt`. If the pledge was frozen only for staleness, unfreeze it (`staleFlaggedAt = 0`).
  - Else apply **shortfall (D8)** with `s = quantity − facts.quantity`:
    - `free = quantity − minted`; `fromFree = min(s, free)`. The bond pays the minter `fromFree × close × (10_000 + defaultPenaltyBps) / 10_000`.
    - `convertible = minted − pendingRedemption`; `toReserve = min(s − fromFree, convertible)`. The bond pays `toReserve × close × (1 + penalty)` into Core's reserve: `reserveUsdt += paid`, `reserveShares += toReserve`, `minted −= toReserve`.
    - `quantity −= fromFree + toReserve`; `brokerPledged −= same`; `frozen = true`; broker `Defaulted`; `lastAttestedAt = observedAt`.
    - Any remaining shortfall concerns escrowed shares; their tickets will default normally.
    - Event `PledgeShortfall`.
- `flagStale(pledgeId)` (anyone): `Active` and `now > lastAttestedAt + attestationInterval` → `frozen = true`, `staleFlaggedAt = now`.
- `slashStale(pledgeId)` (anyone): `staleFlaggedAt != 0` and `now > lastAttestedAt + attestationInterval + staleGrace`. Converts `minted − pendingRedemption` to reserve (bond-funded, `× (1 + penalty)` at last close) exactly like the shortfall branch; `quantity −= converted`; broker `Defaulted`. Event `StaleSlashed`.

#### Redemptions
- `requestRedemption(bytes32 assetId, uint64 shares) → uint256[] ticketIds`: `shares ≥ minRedeemShares`; asset not paused for redemptions (`mintPaused` also pauses new redemptions, because corporate actions freeze both). Pull `shares × 1e18` tokens from the holder into Core (requires approval; Core is exempt from compliance blocking as an escrow).
  1. **Reserve first:** `r = min(shares, reserveShares)`. If `r > 0`: `pay = reserveUsdt × r / reserveShares`; burn `r`; update the reserve; transfer `pay` to the holder. Event `ReserveRedeemed`.
  2. **FIFO for the remainder:** iterate `fifo` from `fifoCursor`. For each pledge with `avail = minted − pendingRedemption > 0`, take `t = min(avail, remaining)` and create a `Pending` ticket `{pledgeId, holder, t, startSession: oracle.assetSessions(asset), requestedAt: now}`; `pendingRedemption += t`; `brokerPendingTickets[broker]++`. Pledges with `avail == 0` are skipped but not passed; `fifoCursor` advances only past `Closed` pledges (a pledge with unminted capacity may mint again later). Bounded by `maxTicketsPerRequest` (8) tickets and `maxFifoScan` (64) pledges scanned; revert `TooFragmented` if exceeded.
  3. If tokens remain unassigned (impossible while the invariant holds), revert.
- `settleRedemption(ticketId, uint256 salePriceUsd6)`: broker of the ticket's pledge; `Pending`. Computes `floor = close × (10_000 − priceBandBps) / 10_000`, `perShare = max(salePrice, floor)`, `gross = perShare × shares`, `payout = gross − gross × redeemFeeBps / 10_000`. `safeTransferFrom(broker → holder, payout)`. Burns the escrowed tokens. `pledge.minted −= shares`, `pendingRedemption −= shares`, `quantity −= shares`, `brokerPledged −= shares`; if `quantity == 0`, close the pledge; `brokerPendingTickets−−`. `Settled`. Event `RedemptionSettled`. Allowed after the deadline too, as long as nobody has claimed the default yet.
- `claimDefault(ticketId)` (anyone): `Pending` and `oracle.assetSessions(asset) ≥ startSession + deadlineSessions` and `now ≥ requestedAt + minDefaultDelay` (sanity, 1 h). Pays `due = shares × close × (10_000 + defaultPenaltyBps) / 10_000` from `bondVault.pay(broker, holder, due)` (it may pay less if the bond is exhausted). Burns the escrowed tokens. Pledge accounting is the same as settlement (D7). Broker `Defaulted`. `Defaulted` status, `paidUsdt` recorded. Event `RedemptionDefaulted`.

#### Views for UI
`getAsset`, `getPledge`, `getTicket`, `pledgesOf(minter)`, `pledgesOfBroker(broker)`, `ticketsOf(holder)`, `ticketsOfBroker(broker)`, `brokerHealth(broker) → (bond, exposure, requiredBps, ratioBps, status, undercollateralizedSince)`, `backing(assetId) → (supplyShares, Σ quantity of Active pledges, Σ minted, reserveShares, reserveUsdt)`. Keep per-minter, per-broker and per-holder ID arrays for the views.

### 8.10 OpenShareHook (Uniswap v4)

- Permissions: `beforeInitialize`, `beforeSwap`. All others false.
- `beforeInitialize(sender, key, sqrtPrice)`: require that one currency is a listed OpenShare token (via `core.assetOfToken(token)`), the other is USDT, `key.fee == LPFeeLibrary.DYNAMIC_FEE_FLAG`, and `key.hooks == this`. Optionally `sender == owner`, so only the protocol creates pools.
- `beforeSwap(...)`: look up the asset. If `compliance.transfersPaused(asset)`, revert `AssetPaused`. Fee: `oracle.isStale(asset) ? staleFee : (oracle.marketOpen() ? openFee : closedFee)`. Return `(selector, ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG)`.
- Defaults: `openFee = 500` (0.05%), `closedFee = 3000` (0.30%), `staleFee = 10_000` (1.00%). Settable by the owner.
- Deploy at a mined CREATE2 address whose low bits encode exactly these flags (HookMiner).
- No price cap logic (D-R1).

### 8.11 Events (complete list, the dashboard depends on them)

`AssetListed, BrokerRegistered, BrokerStatusChanged, BondDeposited, BondWithdrawn, BondPaid, PledgeRegistered, PledgeAccepted, PledgeRejected, PledgeCancelled, Minted, Burned, ReleaseRequested, Attested, PledgeShortfall, StaleFlagged, StaleSlashed, ReserveRedeemed, RedemptionRequested, RedemptionSettled, RedemptionDefaulted, RoleRegistered, Blocked, PauseChanged, PricesPushed, SessionClosed, MarketStatusChanged`.

---

## 9. Accounting and invariants

For every asset `a`:

- **I1:** `token(a).totalSupply() == (Σ_p∈a pledge.minted + reserveShares(a)) × 1e18`
- **I2:** for every pledge, `pendingRedemption ≤ minted ≤ quantity`
- **I3:** `Σ_p pendingRedemption == Σ_t∈Pending ticket.shares`, and Core's token balance == `Σ pending × 1e18`
- **I4:** `reserveShares == 0 ⇒ reserveUsdt == 0`, and Core's USDT balance ≥ `Σ_a reserveUsdt(a)`
- **I5:** `brokerPledged[b][a] == Σ quantity of b's Active pledges in a`
- **I6 (the rule):** `totalSupply ≤ (Σ_Active quantity + reserveShares) × 1e18`, which follows from I1 and I2.

These are checked by `test/invariant/` (§17).

---

## 10. Off-chain services and integrations

### 10.1 Relay (`services/relay`, Node 20, TypeScript, viem)

- **Sources** (median of the available ones, at least 2 required, each within 1% of the median or excluded):
  - Price: Yahoo Finance chart API (`RELIANCE.NS`), NSE quote API (cookie handshake), plus an optional third source.
  - USD/INR: Yahoo `INR=X`, Frankfurter (ECB), open.er-api.
  - If fewer than 2 agree, don't post, and log a warning.
- **Calendar:** NSE regular session 09:15–15:30 IST, Mon–Fri, minus the holiday list in `services/relay/calendar/nse-holidays-2026.json` (and 2027).
- **Loop:**
  - At session open, `setMarketOpen(true)`.
  - Every 5 minutes during the session, `pushPrices`.
  - At 15:45 IST, `closeSession(id+1, closes, nextIsExtendedClosure)`, where extended means the next session is more than 1 calendar day away.
  - Outside sessions, push FX only if desired (prices unchanged).
- **Manual/demo commands** (CLI): `relay set-price RELIANCE 1410.00`, `relay open`, `relay close [--extended]`, `relay halt RELIANCE`. These post with `source = Manual`, so the UI shows a **MANUAL** badge.
- Configuration via `.env` (§18). Idempotent: reads `currentSessionId` from the chain before closing.

### 10.2 Attestor API (Next.js route handlers, server-only keys)

- `POST /api/attest/mock` (enabled only if `NEXT_PUBLIC_DEMO_MODE=true`): body `{wallet, isin, quantity, pledgeeLabel, pledgeRefSeed}`. Signs `PledgeFacts` with `kind = Mock` using `MOCK_ATTESTOR_PRIVATE_KEY`.
- **Kite fallback:**
  - `GET /api/attest/kite/login?wallet=0x…` redirects to `https://kite.zerodha.com/connect/login?v=3&api_key=…`. The wallet goes in an HttpOnly cookie, with a CSRF state.
  - `GET /api/attest/kite/callback?request_token=…` exchanges the token (`POST https://api.kite.trade/session/token` with `api_key`, `request_token` and `checksum = sha256(api_key + request_token + api_secret)`), then calls `GET https://api.kite.trade/portfolio/holdings` with headers `X-Kite-Version: 3` and `Authorization: token api_key:access_token`. For the requested ISIN, it reads `collateral_quantity`.
  - It signs `PledgeFacts {pledgeRef: keccak256("KITE", keccak256(user_id), isin), quantity: collateral_quantity, pledgorIdHash: keccak256(user_id), pledgeeIdHash: keccak256("ZERODHA-MARGIN"), status: 1, observedAt: now, wallet, kind: KiteAttested}` with `KITE_ATTESTOR_PRIVATE_KEY`.
  - It **discards the access token** after use and never stores holdings.

### 10.3 World ID

- Action `openshare-role`. Signal = the connected wallet address. Credential: Proof of Human (Orb). Staging app plus the simulator for development.
- `POST /api/world/verify {proof payload, wallet, role}` verifies with the World Developer API (the exact endpoint and payload depend on the IDKit version; see `docs/integrations/world-id.md`). On success, it signs `RoleAttestation` (`WORLD_ATTESTOR_PRIVATE_KEY`). The contract enforces the uniqueness rules (§8.3).

### 10.4 Reclaim zkTLS (pledge proofs)

- **Provider:** a custom Reclaim provider for the Zerodha Console holdings/pledge view (or CDSL Easi). It reveals only `isin`, `pledged quantity`, `pledgee` (hashed on-chain), `status`, and `psn` if present.
- **Flow:** the client asks `/api/reclaim/session` for a signed request (APP_SECRET stays server-side), with the context set to the wallet address. The user completes the proof in the Reclaim flow, and the client submits the proof to `registerPledge` or `attest` through `ReclaimPledgeVerifier`.
- See `docs/integrations/reclaim.md` for the exact SDK calls and on-chain verification details. **Until the provider exists**, the UI offers Kite and Mock with clear labels.

### 10.5 ReclaimPledgeVerifier (on-chain)

- Holds the witness (attestor) address set by epoch, and an allowlist of provider hashes.
- Verifies:
  1. The claim identifier hash matches `keccak256(provider, parameters, context)`.
  2. Signatures from the required witnesses.
  3. Parses `context` for `contextAddress` and the extracted parameters.
  4. Maps them into `PledgeFacts` with `kind = Reclaim`, hashing the pledgee and pledgor IDs.
- Parsing is string-based, following Reclaim's `Claims` helper. Keep the parsing in a library with tests against a recorded fixture proof.

### 10.6 Stretch: Reclaim-proven NSE price

`ReclaimPriceVerifier` accepts a Reclaim/zkFetch proof of the NSE quote endpoint for a symbol. It extracts `lastPrice` or `closePrice` and pushes it to the oracle with `source = Reclaim` if it's within `maxDeviationBps` of the relay price. It only complements the relay.

---

## 11. Frontend specification (`app/`, Next.js App Router)

Stack: Next.js (App Router, TypeScript), wagmi v2 + viem, RainbowKit, TanStack Query, Tailwind CSS. Contract ABIs and addresses are generated into `app/src/generated/` from Foundry artifacts and `deployments/<chainId>.json`.

### 11.1 Global
- Header: wallet connect, the connected role badge (Minter, Broker, or none), the network guard (chain 1874 or local 31337), and the market status pill (Open, Closed, Extended closure, Halted).
- Price sources are shown everywhere a price appears: a `RELAY` / `MANUAL` / `RECLAIM` badge and its age.

### 11.2 Dashboard `/`
For each asset:
- Supply, Σ pledged (Active), Σ minted, reserve shares and USDT, and the invariant status (✓ / ✗).
- Oracle price, pool price (from `slot0`) and **premium %**.
- Available mint capacity (Σ quantity − minted over unfrozen pledges).

Broker table: bond, exposure, required %, ratio %, status, pending tickets, oldest re-proof age, minter concentration (the largest minter's share of the broker's pledges, computed from events).

Pledge table: ID, minter (short), broker, quantity, minted, pending, last re-proof age (red when stale), proof kind badge.

Activity feed: the last 50 events.

### 11.3 Minter `/minter`
1. **Role step:** if there's no role, the IDKit widget → `/api/world/verify` → `register` tx.
2. **Prove pledge:** choose the proof source (Reclaim, Kite or Mock, with badges). Pick the broker from a list (showing the pledgee ID hash match hint). Submit `registerPledge`.
3. **My pledges:** status, quantity, minted, freshness, and actions: **Mint** (amount, fee preview, a "you are selling exposure; buying back may cost more" warning), **Burn**, **Release**, **Re-prove**, **Cancel** (if Proposed).

### 11.4 Broker `/broker`
- Role step, then `registerBroker` (name + pledgee demat ID; only the hash goes on-chain).
- Bond panel: deposit and withdraw, with a live ratio gauge against the requirement (110% / 125%).
- Incoming pledges: accept or reject, with a preview of the post-accept ratio.
- Redemption queue: tickets with sessions remaining, and **Settle** (enter the sale price; shows floor, payout and fee). Requires a USDT approval to Core.
- Re-prove pledges.

### 11.5 Trade `/trade`
Swap between the asset and USDT through the v4 pool (test router), with a quote, slippage and the current fee tier explained (open, closed or stale). An "Add liquidity" panel for LPs.

### 11.6 Redeem `/redeem`
Request redemption (whole shares, minimum 10). Shows "paid at next sessions' sale price (≥ last close − 1%) − 0.20% fee, within 3 trading sessions" and an instant reserve portion if one exists. My tickets show their status, with **Claim default** when it's eligible.

### 11.7 Ops `/ops`
Relay heartbeat, last session, `marketOpen` / `extendedClosure`. Demo controls (only when `DEMO_MODE` is on): they call the relay CLI or relayer-key routes to open or close sessions, set prices and halt. Denylist management (`COMPLIANCE_ROLE`).

**Labelling rules (mandatory):**
- Mock proof → orange `MOCK` badge.
- Kite attestor → yellow `TRUSTED ATTESTOR`.
- Reclaim → green `zkTLS`.
- Relay prices → `TRUSTED RELAY`; manual → `MANUAL`.
- Release (off-chain unpledge) → "Broker unpledges off-chain (trusted step)".

---

## 12. Trust assumptions and threat model

| Component | Trust | Mitigation |
|---|---|---|
| Pledge existence | zkTLS witnesses (Reclaim), or the attestor key (Kite/Mock) | Periodic re-proofs (D9), wallet binding, pledge refs used once, visible proof kind |
| Broker honesty | Economic | Bond ≥ 110%/125% of pledged value (D1), shortfall and stale slashing (D8, D9), default payouts (D7) |
| Minter + broker collusion | Economic plus identity | One human, one role (D15); the bond covers holders in full; the cartel pays itself |
| Prices and calendar | Relay operator | Median of sources, a visible source badge, stale-fee hook, pluggable oracle (D17) |
| Release (unpledge) | Broker, off-chain | Documented. A re-proof catches over-release (it shows up as a shortfall only if the broker releases more than requested) |
| Compliance | Compliance key | Denylist only; no custody |
| Admin | Admin key | Param changes are emitted. Production would add a timelock (roadmap) |

**Attacks considered:**
- Replaying a proof (wallet binding + nullifier).
- Proving a pending pledge (status = CONFIRMED + broker co-sign).
- The same human as both roles (World ID).
- A broker draining via withdraw (health check).
- A broker invoking without a redemption (D8).
- Mint spam (minting requires a fresh proof).
- Redemption spam (the minimum size).
- Oracle staleness (stale fee, and a stale price can't be used for defaults: `claimDefault` uses the last *session close*).
- FIFO gaming (roadmap).
- Bond depeg (E18, roadmap).

---

## 13. Edge-case handling matrix

| # | Scenario | Handling in MVP |
|---|---|---|
| E1 | Monday gap up | 125% bond over extended closures; redemptions paid at the actual sale price ≥ floor |
| E2 | Monday gap down | The UI quotes "next session's sale price", never a weekend quote |
| E3 | Circuit limit or halt | Per-asset sessions count only when the asset traded, so the deadline pauses |
| E4 | Holidays or special sessions | The relay calendar posts no session on holidays; special sessions are posted manually |
| E5 | Redemption run | FIFO tickets; brokers settle at their pace within 3 sessions, otherwise the bond pays. Large caps only |
| E6 | Delisting or ISIN change | `mintPaused` + `transfersPaused`; manual migration (roadmap) |
| E7 | Minter's demat frozen | Broker risk: the bond pays on default |
| E8 | Minter dies | Legal (pledge binds heirs); no protocol change |
| E9 | Broker insolvent | Bond; regulated brokers in production |
| E10 | Broker app down | Existing tokens unaffected; minting waits |
| E11 | Pending pledge proof | Only `CONFIRMED`, plus the broker's acceptance |
| E12 | Proof replay | Wallet binding + `usedPledgeRef` |
| E13 | FIFO gaming | Accepted for MVP |
| E14 | Fractional tokens | Tradeable; redemption in whole shares only (dust is roadmap) |
| E15 | Tiny redemption spam | `minRedeemShares = 10` |
| E16 | Message delay | N/A, single chain (D20) |
| E17 | Blocked user via pool | The token's `_update` blocks the final transfer |
| E18 | USDT depeg | Roadmap (bond basket, valuation at oracle price) |

---

## 14. Parameters (defaults)

| Param | Default | Notes |
|---|---|---|
| `bondRatioBps` | 11_000 | 110% |
| `bondRatioExtendedBps` | 12_500 | 125% during extended closure |
| `cureWindow` | 24 h | Below 100% |
| `attestationInterval` | 7 days | Demo deployments may set 10 min |
| `staleGrace` | 3 days | Demo: 5 min |
| `maxProofAge` | 24 h | Facts `observedAt` freshness |
| `mintFeeBps` | 10 | 0.10% |
| `redeemFeeBps` | 20 | 0.20% |
| `priceBandBps` | 100 | Sale-price floor = close − 1% |
| `defaultPenaltyBps` | 500 | +5% |
| `deadlineSessions` | 3 | |
| `minDefaultDelay` | 1 h | |
| `minRedeemShares` | 10 | Demo may use 1 |
| `maxTicketsPerRequest` | 8 | |
| `maxFifoScan` | 64 | pledges scanned per request |
| Hook `openFee` / `closedFee` / `staleFee` | 500 / 3000 / 10000 | hundredths of a bip (v4 fee units) |
| Oracle `maxPriceAge` | 15 min | |

---

## 15. Repository layout and tooling

```
openshare/
├── docs/SPEC.md, docs/integrations/{world-id,reclaim,kite,whitechain,uniswap-v4}.md
├── contracts/                       # Foundry
│   ├── foundry.toml                 # solc 0.8.26, evm_version cancun, optimizer 200 runs (via_ir if needed)
│   ├── src/
│   │   ├── core/OpenShareCore.sol, BondVault.sol, TokenFactory.sol, OpenShareToken.sol
│   │   ├── registry/RoleRegistry.sol, ComplianceRegistry.sol
│   │   ├── oracle/PriceOracle.sol, interfaces/IPriceOracle.sol
│   │   ├── verifiers/AttestedPledgeVerifier.sol, ReclaimPledgeVerifier.sol, interfaces/IPledgeVerifier.sol
│   │   ├── hook/OpenShareHook.sol
│   │   └── libraries/Types.sol, Errors.sol
│   ├── test/ unit/, scenario/WorkedWeek.t.sol, invariant/, hook/
│   └── script/ Deploy.s.sol, DeployUniswap.s.sol, Seed.s.sol, Config.sol
├── services/relay/                  # TS: src/{sources,calendar,cli,loop}.ts
├── app/                             # Next.js web app + API routes
├── deployments/<chainId>.json       # addresses written by deploy scripts
├── package.json, pnpm-workspace.yaml
├── .env.example
└── README.md
```

Conventions: Solidity style follows the Solidity style guide, with NatSpec on public functions. Formatting: `forge fmt`, and Prettier for TS. Use pnpm workspaces.

---

## 16. Implementation plan

Each phase ends with its acceptance criteria met and committed.

### Phase 0: Scaffold
- pnpm workspace, Foundry project, OZ v5, Uniswap v4-core and v4-periphery as git submodules (pinned tags), `.env.example`, README skeleton.
- **Accept:** `forge build` and `pnpm install` succeed.

### Phase 1: Registries, oracle, token, verifiers
- `ComplianceRegistry`, `RoleRegistry` (EIP-712), `PriceOracle`, `OpenShareToken`, `TokenFactory`, `AttestedPledgeVerifier`, and their unit tests (happy paths plus every revert).
- **Accept:** 100% of the specified reverts are tested.

### Phase 2: Core + BondVault
- All of §8.9, with unit tests per function.
- `scenario/WorkedWeek.t.sol` reproduces §5 exactly (numbers match to the cent).
- Invariant suite I1–I6 with a handler fuzzing register, accept, mint, burn, release, attest (incl. shortfall), redeem, settle, default, and price/session moves.
- **Accept:** `forge test` is green, and the invariant runs pass 256 runs × depth 50.

### Phase 3: Uniswap v4 hook and pool
- `OpenShareHook` with tests using v4 test utilities (fee switching, pool guard, paused revert).
- Deploy scripts for PoolManager, test routers, hook mining, and pool init + liquidity seed.
- **Accept:** a local end-to-end script swaps USDT→asset on anvil.

### Phase 4: Deployment
- `Deploy.s.sol` (all contracts, roles, params, asset listing for RELIANCE `INE002A01018`), writing `deployments/<chainId>.json`.
- `Seed.s.sol` for demo actors on a local chain, plus a mock USDT for local runs.
- Whitechain Sepolia deploy and verification once the deployer is funded.
- **Accept:** a local anvil deploy + seed works with a single command (`pnpm dev:chain`).

### Phase 5: Relay
- Sources, median, calendar, loop, and CLI. Unit tests for the median, calendar and unit conversion.
- **Accept:** it posts to local anvil, and the dashboard shows the prices.

### Phase 6: Web app
- All pages in §11. API routes: mock attestor, World verify, Kite, Reclaim session.
- **Accept:** the full demo flow (§19) works against local anvil with the Mock proof and the World ID simulator. `pnpm -r build` passes.

### Phase 7: Real integrations
- World ID staging/production app ID; Kite attestor with a real margin pledge; Reclaim custom provider + `ReclaimPledgeVerifier` with a recorded fixture.
- **Accept:** one real Kite-attested pledge, and if possible one real Reclaim proof, on the testnet.

### Phase 8: Stretch
- Reclaim-proven NSE price (§10.6). Polish, demo recording.

---

## 17. Testing strategy

- **Unit:** every external function. Every custom error has at least one test.
- **Scenario:** the worked week (§5), the shortfall theft (D8), stale slashing (D9), undercollateralisation cure and default (D1), and reserve redemptions.
- **Invariant:** handler-based fuzzing (I1–I6), including oracle price and session moves and extended-closure toggles.
- **Hook:** fee selection under open, closed and stale; non-USDT pairs rejected; paused swaps revert.
- **Services:** vitest for relay sources (with mocked HTTP), median, calendar, and the attestor signature format (verified against the contract's EIP-712 hash in a Foundry FFI-free fixture: the TS test generates a signature, and a Foundry test checks a hard-coded vector).
- **E2E (manual script):** §19 on anvil.

---

## 18. Configuration (`.env.example`)

```
# chain
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
DEPLOYER_PRIVATE_KEY=
USDT_ADDRESS=                      # empty → deploy MockUSDT (local only)
# keys (testnet only)
RELAYER_PRIVATE_KEY=
WORLD_ATTESTOR_PRIVATE_KEY=
KITE_ATTESTOR_PRIVATE_KEY=
MOCK_ATTESTOR_PRIVATE_KEY=
# world id
NEXT_PUBLIC_WORLD_APP_ID=
WORLD_ACTION=openshare-role
WORLD_RP_ID=                       # if required by the IDKit version
WORLD_RP_SIGNING_KEY=              # if required
# kite
KITE_API_KEY=
KITE_API_SECRET=
# reclaim
RECLAIM_APP_ID=
RECLAIM_APP_SECRET=
RECLAIM_PROVIDER_ID=
# app
NEXT_PUBLIC_DEMO_MODE=true
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
```

---

## 19. Demo script (about 3 minutes)

1. **Dashboard:** one asset (oRELIANCE), the rule ✓, two brokers with healthy bonds, market **Closed (extended)**.
2. **Alice (minter):** World ID → prove her pledge (Kite or Reclaim; Mock as the fallback, labelled) → broker X has accepted → **mint 100 at 02:00 on a Saturday** → sell 60 on the pool (fee tier: closed, 0.30%).
3. **Squeeze:** a buyer pushes the price to +12%. Dev mints from his already-accepted pledge on his own initiative and sells, and the premium shrinks on the dashboard. Nothing in the protocol forced it.
4. **Bob redeems 40:** a ticket is assigned FIFO to Alice's pledge. Relay "opens Monday"; X settles at the sale price, and Bob is paid in USDT.
5. **Carol redeems 20:** X ignores it. Three sessions are advanced. Anyone claims the default, Carol is paid 105% from X's bond, and X turns red (Defaulted).
6. **Theft case:** a re-proof shows a shortfall, and the minter is compensated from the bond (D8).
7. **Close** on the rule ✓ throughout.

---

## 20. Out of scope / roadmap

- Dividends and corporate actions pass-through (D6). Candidate: an over-pledge buffer.
- Insurance pool (D-R8), reassignment (D-R9), challenge redemptions (D-R3), tiered bonds (D-R2).
- Pro-rata or random redemption assignment (E13), dust cash-out (E14), bond baskets (E18).
- Timelocked governance; multiple relayer signers with a threshold.
- Additional markets (lock adapters for other countries).
- Legal structure: a loan-against-shares agreement between minter and broker; a regulated pledgee (an NBFC with a CDSL demat); a licensed venue and on-ramp.

---

## 21. External facts, verified and unverified

| Fact | Status |
|---|---|
| Pledging to a third party at Zerodha is offline: a Pledge Request Form, eSign + physical signature or courier; the pledgee needs a CDSL demat; 24–48 working hours; ₹32 + GST per ISIN | **Verified** (Zerodha support) |
| Shares pledged to third parties don't appear on Kite (only on Console); the Kite API `collateral_quantity` = quantity used as collateral (margin pledge) | **Verified** (Zerodha support, Kite docs) |
| Kite Connect Personal (execution APIs) is free since April 2025; market data costs extra | **Verified** (Zerodha forum) |
| Whitechain Sepolia: chain ID 1874, OP Stack L2; test USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` | Verified (public docs); RPC details in `docs/integrations/whitechain.md` |
| No public on-chain NSE price feed (Pyth/Chainlink) | Verified as of 2026-11; Pyth lists India as upcoming |
| Partial invocation/release of a pledge, pledge sequence numbers on statements | **Unverified.** Design assumes partial invocation is possible; the fallback is lots of 10 shares |
| A Reclaim provider for Console or CDSL pledge pages | **Unverified**, needs a custom provider |

---

## 22. Glossary

- **Demat:** an electronic securities account at a depository participant (e.g. Zerodha on CDSL).
- **Pledge (pledgor / pledgee):** a lien recorded at the depository. The pledgor can't sell; the pledgee can invoke (take) the shares.
- **Invocation:** the pledgee transferring the pledged shares to itself.
- **PSN:** pledge sequence number.
- **ISIN:** International Securities Identification Number.
- **Session:** one exchange trading day.
- **Extended closure:** a gap of more than one calendar day until the next session.
- **Reserve:** USDT held by Core that backs tokens whose pledged shares were lost to a broker failure.
