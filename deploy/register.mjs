/**
 * Loader shim so repo library code can be run as a standalone script:
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/<name>.mts
 * Registers the '@/…' path alias that Next resolves through tsconfig paths.
 */
import { register } from 'node:module'
register('./alias-loader.mjs', import.meta.url)
