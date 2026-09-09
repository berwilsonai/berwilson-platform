/**
 * Registers the repo's `@/` path alias so scripts can import application code
 * directly. Pair with --experimental-strip-types to run TypeScript sources.
 */
import { register } from 'node:module'
register('../deploy/alias-loader.mjs', import.meta.url)
