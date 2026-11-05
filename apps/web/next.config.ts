import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@sendex/core", "@sendex/db", "@sendex/ui"],
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
};

export default nextConfig;
