import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@openshare/shared"],
  turbopack: { root: join(process.cwd(), "..") },
  outputFileTracingRoot: join(process.cwd(), ".."),
};

export default nextConfig;
