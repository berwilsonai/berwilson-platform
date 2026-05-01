import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@supabase/supabase-js',
    '@supabase/ssr',
    '@anthropic-ai/sdk',
    '@google/generative-ai',
  ],
};

export default nextConfig;
