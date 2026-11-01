import { chainById } from "@openshare/shared";

/** Client-visible configuration (NEXT_PUBLIC_*). */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";
export const DEMO_MODE = (process.env.NEXT_PUBLIC_DEMO_MODE ?? "true") === "true";
export const IS_LOCAL = CHAIN_ID === 31337;
export const chain = chainById(CHAIN_ID);
export const EXPLORER = IS_LOCAL ? undefined : "https://explorer.testnet.whitechain.io";

export const WORLD = {
  appId: process.env.NEXT_PUBLIC_WORLD_APP_ID ?? "",
  rpId: process.env.NEXT_PUBLIC_WORLD_RP_ID ?? "",
  env: (process.env.NEXT_PUBLIC_WORLD_ENV ?? "staging") as "staging" | "production",
  action: "openshare-role",
};
export const WORLD_ENABLED = WORLD.appId.startsWith("app_") && WORLD.rpId.length > 0;
