import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server.js for the container.
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
