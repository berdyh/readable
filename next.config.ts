import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
    resolveAlias: {
      canvas: path.resolve(__dirname, "src/shims/emptyCanvas.ts"),
    },
  },
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    config.resolve.alias.canvas = path.resolve(
      __dirname,
      "src/shims/emptyCanvas.ts",
    );
    return config;
  },
};

export default nextConfig;
