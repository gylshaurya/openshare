import { mnemonicToAccount } from "viem/accounts";
import type { Address } from "viem";

/**
 * Local demo personas (anvil's unlocked accounts, same indices as contracts/script/Seed.s.sol).
 * Only used when the app runs against a local chain; never for a public network.
 */
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

export interface Persona {
  key: string;
  label: string;
  role: string;
  index: number;
  address: Address;
}

const defs: Array<[string, string, string, number]> = [
  ["alice", "Alice", "Minter", 7],
  ["dev", "Dev", "Minter · LP", 8],
  ["x", "Broker X", "Broker", 5],
  ["y", "Broker Y", "Broker", 6],
  ["bob", "Bob", "Holder", 9],
  ["carol", "Carol", "Holder", 10],
  ["admin", "Admin", "Ops", 0],
];

export const PERSONAS: Persona[] = defs.map(([key, label, role, index]) => ({
  key,
  label,
  role,
  index,
  address: mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index }).address,
}));

export const personaOf = (a?: string) => PERSONAS.find((p) => p.address.toLowerCase() === a?.toLowerCase());
