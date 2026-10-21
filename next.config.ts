import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["ali-oss", "cos-nodejs-sdk-v5", "esdk-obs-nodejs"],
  allowedDevOrigins: ["link.mualliance.cn"]
};

export default nextConfig;
