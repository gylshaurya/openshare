# Reclaim zkTLS integration

Researched 2026-11-01. Implements SPEC D18, §10.4–10.6.

## Packages
- `@reclaimprotocol/js-sdk` 5.8.3: proof requests (server init, browser flow) and `transformForOnchain`.
- `@reclaimprotocol/zk-fetch` 1.1.0: server-side proofs of HTTP APIs (used for the NSE price, the stretch goal).
- On-chain: OpenShare's own `ReclaimPledgeVerifier`, an allowlist verifier. Reclaim isn't deployed on chain 1874, and the official `Reclaim.sol` uses an exact `0.8.4` pragma plus epoch-based witness selection.

## Credentials (owner action)
https://dev.reclaimprotocol.org/my-applications → `RECLAIM_APP_ID`, `RECLAIM_APP_SECRET` (shown once). The provider ID comes from the custom provider you create (below).

## Flow
1. **Server** (`/api/reclaim/session`): `ReclaimProofRequest.init(APP_ID, APP_SECRET, PROVIDER_ID)` → `setContext(wallet.toLowerCase(), "<chainId>:<core>:<nonce>")` → `toJsonString()`. **The APP_SECRET never reaches the browser.**
2. **Browser:** `ReclaimProofRequest.fromJsonString(json)` → `triggerReclaimFlow()` or `getRequestUrl()` (QR code) → `startSession({onSuccess(proofs)})`.
3. **Browser:** `transformForOnchain(proof)` gives `{claimInfo{provider, parameters, context}, signedClaim{claim{identifier, owner, timestampS, epoch}, signatures}}`. The browser ABI-encodes it and calls `core.registerPledge(reclaimVerifier, encoded, broker)` or `core.attest(...)`.

## Proof anatomy
- `identifier = keccak256(provider + "\n" + parameters + "\n" + context)`
- Signed message (EIP-191 personal_sign): `"0x<identifier hex>\n0x<owner lowercase>\n<timestampS>\n<epoch>"`
- `context` is JSON: `{contextAddress, contextMessage, extractedParameters:{...}, providerHash, reclaimSessionId, ...}`
- Current attestor: `0x244897572368Eadf65bfBc5aec98D8e5443a9072` (epoch 1 on every official deployment). Reclaim's `/api/attestors` also lists `0x1be31a94…d4bb` and `0x15ea9011…97e5`.

## On-chain checks (ReclaimPledgeVerifier)
1. The identifier recomputes, and ≥ `threshold` distinct allowlisted attestor signatures are present (low-s).
2. `providerHash` (from context) ∈ the allowed provider hashes. **Critical:** without this, any URL with the same field names would pass.
3. `contextAddress` = the wallet that ends up in `PledgeFacts.wallet` (Core checks it against `msg.sender`).
4. `timestampS` becomes `observedAt` (Core checks freshness).
5. Extracted parameters (`isin`, `quantity`, `pledgee`, `status`, `pledgeRef`) are parsed with `extractFieldFromContext(context, '"<key>":"')`. Numbers arrive as strings.

## Custom provider (owner action, needs a Zerodha login)
- No Zerodha, CDSL or NSDL provider exists in Reclaim's explorer (searched).
- Build one with the Reclaim agent (`claude plugin marketplace add reclaimprotocol/developer-tools`, then `claude plugin install reclaim@reclaim`) or with the legacy DevTool:
  1. Log in to the source.
  2. Capture the XHR that holds the pledged quantity.
  3. Add `responseMatches`/`responseRedactions` for `isin`, quantity and status.
  4. Publish, and note the `providerHash`.
- Candidate sources:
  - **Zerodha Console** (margin pledges): after SSO, `console.zerodha.com/api/reports/holdings/portfolio?date=…` (an async report; poll until `state == "SUCCESS"`).
  - **CDSL Easiest** (third-party pledges with pledgee + PSN; server-rendered, needs XPath).

## Stretch: verifiable price via zkFetch
Prove a quote from a market-data API whose terms allow automated access (e.g. Twelve Data with an API key, the key passed as a private param). Use `client.zkFetch(url, publicOpts, privateOpts{headers or query secrets}, {responseMatches, responseRedactions})`. Don't use the NSE website: it blocks automated clients, and circumventing that is out of bounds.
