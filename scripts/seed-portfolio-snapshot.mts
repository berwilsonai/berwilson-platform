/**
 * Write one portfolio snapshot now, so the history does not start empty.
 *
 * The cron runs Mondays; without this the first delta could not appear for a
 * fortnight. Safe to run repeatedly — the row upserts on `captured_on`.
 *
 *   export PATH="$HOME/.node/bin:$PATH"
 *   node --no-deprecation --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --env-file=.env.local --import ./deploy/register.mjs \
 *     scripts/seed-portfolio-snapshot.mts
 *
 * ⚠ `--env-file=.env.local` IS NOT OPTIONAL. Without it the admin client
 * throws `supabaseUrl is required` from inside the Supabase SDK, three frames
 * below anything in this repo, which reads like a broken module rather than a
 * missing environment.
 */
import { writeSnapshot } from '@/lib/records/snapshot'

const snapshot = await writeSnapshot()
console.log('Wrote portfolio snapshot:')
console.log(JSON.stringify(snapshot, null, 2))
