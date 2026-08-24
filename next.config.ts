import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@anthropic-ai/sdk',
    '@google/generative-ai',
  ],
  // Pin the workspace root. On the Studio a stray ~/package-lock.json (June
  // 2026, unrelated to this app) makes Next infer $HOME as the root and trace
  // the entire home directory. Without this, every build there warns that "the
  // whole project was traced" and the trace list is meaningless.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
