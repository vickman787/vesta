import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  webpack(config) {
    // viem (via genlayer-js) optionally requires `ws` for its WebSocket
    // transport. The browser bundle only uses the HTTP transport, and bundling
    // the Node implementation breaks the build.
    config.resolve.alias.ws = false;
    return config;
  },
};

export default nextConfig;
