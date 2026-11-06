import { createRequire } from "node:module";
import type { NextConfig } from "next";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    // The release version (root package.json, bumped by release-please) for the sidebar footer.
    NEXT_PUBLIC_SENDEX_VERSION: `v${version}`,
  },
  transpilePackages: ["@sendex/core", "@sendex/db", "@sendex/ui"],
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
  experimental: {
    // List uploads post rows to a server action in chunks of 5,000 (see lists/actions.ts).
    serverActions: { bodySizeLimit: "4mb" },
  },
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
