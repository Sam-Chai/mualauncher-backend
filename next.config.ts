import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["ali-oss", "cos-nodejs-sdk-v5", "esdk-obs-nodejs"],
  turbopack: { root: process.cwd() }
};

export default createNextIntlPlugin()(nextConfig);
