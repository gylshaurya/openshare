# Whitechain Sepolia (chain 1874)

Researched and checked live on 2026-11-01.

| Item | Value |
|---|---|
| RPC | `https://rpc.testnet.whitechain.io` (WS `wss://rpc.testnet.whitechain.io/ws`), 50 req/s per IP, batch ≤ 100 |
| Chain | ID 1874, OP Stack L2 settling on Ethereum Sepolia. Gas token WBT (18 dec). 1 s blocks, 40M block gas limit, base fee about 5 gwei |
| EVM | Prague (Isthmus). TSTORE/TLOAD, MCOPY and PUSH0 confirmed. Compile with `evm_version = "cancun"` |
| viem | `import { whitechainSepolia } from "viem/chains"`. Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Explorer | https://explorer.testnet.whitechain.io (Blockscout) |
| Verify | `forge verify-contract <addr> src/X.sol:X --rpc-url https://rpc.testnet.whitechain.io/ --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/` (the trailing `/api/` is required) |
| Faucet | https://faucet.testnet.whitechain.io: **WBT only**, 0.5 WBT per 24 h, GitHub login (account ≥ 30 days) + captcha |
| CREATE2 proxy | `0x4e59b44847b379578588920cA78FbF26c0B4956C`: present |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3`: present |
| Uniswap v4 | **Not deployed.** OpenShare deploys its own PoolManager plus test routers (`script/DeployUniswap.s.sol`) |
| Test USDT | `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`: "Tether USD", 6 decimals, EIP-2612 permit + EIP-3009. **Mint is `onlyOwner`; the faucet does not dispense it.** |
| Docs token list USDT | `0xaa7962d073935D387e8d442DA1D7149C81388f46` (symbol `USDT.e`) |

## Consequences for OpenShare
- `USDT_ADDRESS` is configurable. If it's empty, the deploy script deploys `MockUSDT` (open mint, labelled "mock USDT" in the UI).
- To use the real test USDT, the team must obtain a balance from the token owner or from the Whitechain team, then distribute it to demo actors.
- Gas estimate for the full deploy (protocol + v4 + pool + seed): about 0.15–0.25 WBT. That's one or two faucet claims.
