# Zerodha Kite Connect (trusted attestor fallback)

Verified 2026-11-01. Implements SPEC D18, §10.2.

## What it can and can't prove
- **Can:** a **margin pledge to Zerodha**, read from `collateral_quantity` on `GET /portfolio/holdings` (Zerodha staff: "use collateral_quantity to track the pledged quantity"). Older threads report 0 values, so **test it with a real pledge**.
- **Can't:** pledges to third parties (loan against shares, NBFC). These aren't visible on Kite or in the Kite API. They appear only in Console or at CDSL.
- So in demos, Zerodha stands in as the pledgee, and the broker's pledgee ID hash is `keccak256("ZERODHA-MARGIN")`. This is labelled in the UI.

## Setup (owner action)
1. developers.kite.trade/signup → My Apps → Create New App → **Personal** (free; execution and portfolio APIs, no market data).
2. Redirect URL: `http://localhost:3000/api/attest/kite/callback` (and the deployed URL).
3. Put `KITE_API_KEY` and `KITE_API_SECRET` in `app/.env.local`.
4. Pledge 1 share for margin: Console → Portfolio → Holdings → Pledge, then approve the CDSL OTP.

## Flow
1. `GET https://kite.zerodha.com/connect/login?v=3&api_key=…`, which redirects back with `?request_token=…` (valid for a few minutes).
2. `POST https://api.kite.trade/session/token` (form: `api_key`, `request_token`, `checksum = sha256(api_key + request_token + api_secret)`; header `X-Kite-Version: 3`). This returns `access_token` (valid until 6 AM the next day).
3. `GET https://api.kite.trade/portfolio/holdings` with headers `X-Kite-Version: 3` and `Authorization: token api_key:access_token`.
4. Find the holding by `isin` and read `collateral_quantity` (plus `collateral_type`).
5. Sign `PledgeFacts` (EIP-712, kind = Kite) with `KITE_ATTESTOR_PRIVATE_KEY`, then discard the token.
