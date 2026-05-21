import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow external image sources if needed
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
