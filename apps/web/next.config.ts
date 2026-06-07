import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@aula-agente/shared", "@aula-agente/database"],
  experimental: {
    // On Windows+pnpm, symlinks=false (needed to prevent duplicate React instances
    // from path-casing differences) causes the devtools RSC manifest lookup to fail.
    // Disabling the segment explorer avoids the 500 error without losing functionality.
    devtoolSegmentExplorer: false,
  },
  webpack: (config) => {
    // Prevents webpack from treating the same file as different modules due to
    // Windows case-insensitive paths (Desktop vs desktop) causing duplicate React instances
    config.resolve.symlinks = false;
    return config;
  },
};

export default nextConfig;
