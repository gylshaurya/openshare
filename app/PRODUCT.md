# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Four roles, each with its own workspace (confirmed):

- **Shareholders (minters):** Indian investors with shares in their own demat account. They pledge shares to a bonded broker and mint one token per share, getting liquidity without selling or moving the shares.
- **Pledge brokers:** regulated-style intermediaries who hold pledges, post a USDT bond (110% of pledged value, 125% over long closures) and settle redemptions by selling on NSE.
- **Global buyers and traders:** people outside India's market hours or access routes who buy and sell tokenized Indian stocks 24/7 on a Uniswap v4 pool.
- **Redeemers:** token holders exiting to USDT through the pledge broker, with the broker's bond as the backstop.

Admins and operators run a separate operations console that isn't in the main navigation.

## Product Purpose

Bull Street turns depository pledges into on-chain stock tokens. Shares never leave the shareholder's demat account. A pledge locks them to a bonded broker, and the contracts enforce, per stock: tokens in existence ≤ shares still pledged + bond-funded reserve. Success means a buyer can trust a token is backed and redeemable, and a shareholder can unlock liquidity in minutes.

## Positioning

Backing is enforced by contract against pledges proven from the depository side (zkTLS or a broker API attestation). There is no custodian holding the shares, and the broker's on-chain bond pays 105% if a redemption deadline is missed.

## Operating Context

- Whitechain Sepolia testnet (chain 1874), USDT settlement, MetaMask wallets.
- World ID gates the Minter and Broker roles: one human, one role.
- NSE is closed about 81% of the week. The pool stays open, with a wider fee while the exchange is closed.
- Prices come from an NSE relay. Redemptions settle within 3 NSE trading sessions.

## Capabilities and Constraints

- Mint, burn, release, re-attest pledges; broker accept/reject; bond deposit/withdraw; FIFO redemptions; default claims; swap and add liquidity; keeper actions (stale pledges, collateral checks); compliance denylist.
- The UI must look like a real product. No "mock", "demo" or "manual" labels in the interface; the team explains the testnet setup verbally (user decision, 2026-11-06).
- The landing page lives at `/`; the app lives at `/markets`, `/trade`, `/mint`, `/broker`, `/redeem` (and `/ops`, unlisted).

## Brand Commitments

- Name: Bull Street. Token symbols: `o` + NSE ticker (oRELIANCE, oTCS, oINFY).
- Visual reference supplied by the user: an institutional crypto-exchange design analysis (`../../DESIGN-coinbase.md`), to be used loosely and never copied as Coinbase branding.
- Legal footer: "Testnet. Not an offer of securities."

## Evidence on Hand

Live on-chain data (three listed stocks, two brokers, pledges, tickets) via the snapshot loader. There are no testimonials, customers, volumes or partner logos, and none may be invented.

## Product Principles

1. Backing is visible everywhere a token is shown.
2. Each role sees only its own job; nothing mixes broker and minter controls.
3. Numbers are exact, tabular and labelled with units (USD, ₹, shares).
4. Calm and institutional, not trading-app urgency.
