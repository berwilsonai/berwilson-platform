import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    /*
      ⚠ THE COMPILE-WITHOUT-SHIPPING RECIPE LANDS HERE, AND ESLINT DID NOT
      IGNORE IT. CLAUDE.md's documented way to typecheck a working tree you are
      not ready to deploy is `BW_DIST_DIR=.next-verify npm run build`, which
      writes a full Next build to a directory this list had never heard of. The
      next `npx eslint` then linted the build output: 27,909 problems against a
      repo whose frozen baseline is 23, which reads exactly like a catastrophe
      and is entirely an artifact of the recipe. Any BW_DIST_DIR is a build
      directory, so match the prefix rather than the one name in use today.
    */
    ".next-*/**",
  ]),
]);

export default eslintConfig;
