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
  /*
    ⚠ A WAY TO COMPILE WITHOUT DEPLOYING, WHICH THIS REPO HAD NO WAY TO DO.
    CLAUDE.md's own runbook records that `npm run build` IS the deploy here:
    the launchd job is `KeepAlive: true`, so replacing `.next` under the
    running `next start` kills it and launchd boots the new build within a
    minute, kickstart or not. The consequence is that verifying a change
    compiles has been indistinguishable from shipping it — "never run
    `npm run build` against a working tree you are not willing to ship".

    `next build` has no `--distDir` flag (checked against `next build --help`,
    16.2.6), so the only place this can be set is here. Unset — which is every
    real build and every deploy — the spread contributes NO KEYS, so the config
    object is identical to what it was and the runbook is unchanged. Set, the
    build lands elsewhere and the live app keeps serving:

      BW_DIST_DIR=.next-verify npm run build && git checkout -- tsconfig.json

    ⚠ THE PATH MUST BE RELATIVE TO THE PROJECT ROOT. An absolute path is
    resolved against the root rather than used as given: `BW_DIST_DIR=/tmp/x`
    wrote 151MB to `<repo>/tmp/x` on the first attempt here, inside the
    working tree, while reporting a clean build.

    ⚠ AND `next build` REWRITES tsconfig.json — it appends the dist dir's own
    generated-types glob to `include` and reformats the whole file. With the
    default `.next` that entry is already there so nothing changes; with a
    custom dir it leaves a real diff, which two sessions sharing this repo
    could stage by accident. Hence the `git checkout` above: it is part of the
    command, not an afterthought.

    ⚠ (And do not write that glob out in this comment: it contains the two
    characters that END a block comment, which is how this very block was
    truncated once — tsc then reported an unterminated template literal 16
    lines further down, naming neither the cause nor the line.)

    ⚠ IT IS A VERIFICATION OF COMPILATION, NOT OF BEHAVIOUR. §12: a build that
    exits 0 having listed the route is not evidence that the route answers.
    A verify build also makes Turbopack name `next.config.ts` in its "NFT
    list" warnings — an artifact of customising distDir (reproduced with the
    env read removed entirely), not of this block.
  */
  ...(process.env.BW_DIST_DIR ? { distDir: process.env.BW_DIST_DIR } : {}),
};

export default nextConfig;
