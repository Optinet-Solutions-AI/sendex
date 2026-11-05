import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@sendex/core", "@sendex/db", "@sendex/ui"],
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
  webpack: (config) => {
    // Workspace packages are ESM TypeScript with `.js` import specifiers; let webpack find the .ts.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
