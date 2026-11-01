import { createConfig, http, type Transport } from "wagmi";
import type { Chain } from "viem";
import { injected, mock } from "wagmi/connectors";
import { chain, IS_LOCAL, RPC_URL } from "./config";
import { PERSONAS } from "./personas";

/**
 * Wallets: any injected wallet (MetaMask etc.). On a local chain, one `mock` connector per demo persona
 * routes transactions to anvil's unlocked accounts, so the multi-party demo needs no key imports.
 */
const personaConnectors = IS_LOCAL
  ? PERSONAS.map((p) => mock({ accounts: [p.address], features: { reconnect: true } }))
  : [];

export const wagmiConfig = createConfig({
  chains: [chain as Chain],
  connectors: [injected(), ...personaConnectors],
  transports: { [chain.id]: http(RPC_URL) } as Record<number, Transport>,
  ssr: true,
});
