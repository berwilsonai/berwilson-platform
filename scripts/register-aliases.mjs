/**
 * Lets a standalone script import the app's own libs via the `@/` alias, so a
 * repair or verification runs the SAME code the platform runs rather than a
 * re-implementation of it.
 *
 *   node --experimental-strip-types --import ./scripts/register-aliases.mjs \
 *        --env-file=.env.local scripts/<name>.mts
 */
import { register } from 'node:module'
register('../deploy/alias-loader.mjs', import.meta.url)
