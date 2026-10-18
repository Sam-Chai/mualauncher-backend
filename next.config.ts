import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Resolve only this checkout, even when a parent directory has a lockfile.
  turbopack: { root: __dirname },
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["ali-oss", "cos-nodejs-sdk-v5", "esdk-obs-nodejs"],
};

export default nextConfig;
