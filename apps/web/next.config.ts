import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // In a pnpm monorepo, the file tracer must start from the workspace root
  // so it can resolve node_modules that live at the root (e.g. next itself).
  // Without this, standalone output is missing packages → MODULE_NOT_FOUND.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@aula-agente/shared", "@aula-agente/database"],
  experimental: {
    devtoolSegmentExplorer: false,
  },
  webpack: (config) => {
    // symlinks=false only needed on Windows to prevent duplicate React instances
    // from case-insensitive path differences. Not needed (and potentially harmful)
    // in the Linux Docker production build.
    if (process.platform === "win32") {
      config.resolve.symlinks = false;
    }
    return config;
  },
};

export default nextConfig;
