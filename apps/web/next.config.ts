import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@aula-agente/shared", "@aula-agente/database"],
};

export default nextConfig;
