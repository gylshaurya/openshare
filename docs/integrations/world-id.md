# World ID (IDKit 4.x) integration

Researched 2026-11-01. Implements SPEC D15 and §8.3 / §10.3.

## Packages
| Package | Version | Use |
|---|---|---|
| `@worldcoin/idkit` | ^4.6.0 | React widget `IDKitRequestWidget`, preset `proofOfHuman` |
| `@worldcoin/idkit-core` | ^4.6.0 | `signRequest` (`/signing`), `hashSignal` (`/hashing`), server side |

Don't use 2.x/3.x. In 4.0 the verification level is replaced by presets/credentials, and **RP signatures are mandatory**.

## Flow
1. The client calls `POST /api/world/rp-signature`. The server runs `signRequest({ signingKeyHex: RP_SIGNING_KEY, action: "openshare-role" })` and returns `{sig, nonce, created_at, expires_at}`. The TTL is 300 s, so fetch right before opening the widget.
2. The client renders `IDKitRequestWidget` with:
   - `app_id`, `action="openshare-role"`
   - `rp_context={rp_id, nonce, created_at, expires_at, signature}`
   - `allow_legacy_proofs={false}`
   - `environment` (`staging` = simulator, `production` = World App)
   - `preset={proofOfHuman({ signal })}`, where `signal = encodePacked(["uint8","address"], [role, wallet])`
3. In `handleVerify(result)`, the client calls `POST /api/world/verify {idkitResponse, wallet, role}`. The server:
   - Checks `environment == ENV`, `protocol_version == "4.0"`, `action == "openshare-role"`, `responses[0].issuer_schema_id == 1` (Proof of Human), and `signal_hash == hashSignal(encodePacked(role, wallet))`.
   - Forwards the result **as-is** to `POST https://developer.world.org/api/v4/verify/{rp_id}`.
   - Requires `success === true`.
   - Takes `nullifier = BigInt(responses[0].nullifier)`.
   - Signs the EIP-712 `RoleAttestation {wallet, role, nullifierHash, expiresAt}` with `WORLD_ATTESTOR_PRIVATE_KEY` (a separate key, **not** the RP signing key).
4. The client calls `RoleRegistry.register(att, sig)`. The contract enforces one nullifier → one role → one wallet.

## Gotchas
- The Portal **does not reject reused nullifiers** and doesn't check the signal. The contract plus the server-side checks above must do it.
- v4 uniqueness proofs may be one-time per action (`nullifier_replayed`). Make the backend idempotent: if the same (nullifier, wallet, role) is verified again, re-issue the attestation.
- The same human gets an unlinkable nullifier per action, which is why we use **one** action for both roles.
- Environments must match end to end: staging app + simulator (https://simulator.worldcoin.org), or production + World App.
- `app_staging_` apps are legacy. Create a **production** app; it mirrors to staging.

## Developer Portal setup (manual, owner)
1. https://developer.world.org: create a team and an app (external, cloud).
2. Enable World ID 4.0 and save `app_id`, `rp_id`, and `signing_key` (shown once).
3. Create the action `openshare-role` in staging (and production).
4. Put `NEXT_PUBLIC_WORLD_APP_ID`, `NEXT_PUBLIC_WORLD_RP_ID`, `NEXT_PUBLIC_WORLD_ENV`, and `WORLD_RP_SIGNING_KEY` in `app/.env.local`.

## Dev fallback
If World credentials aren't configured and `NEXT_PUBLIC_DEMO_MODE=true`, `/api/world/verify` accepts a **demo identity** (the nullifier is derived from a user-typed handle) and the UI labels it `DEMO IDENTITY`. It's never available when `DEMO_MODE` is off.

Sources: docs.world.org/world-id/idkit/integrate, /4-0-migration, /idkit/signatures, /api-reference/developer-portal/verify, /world-id/idkit/credentials, github.com/worldcoin/idkit/tree/main/js/examples/nextjs.
