import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { findQuoteTemplate, seedQuoteTemplate } from '@/lib/steel/quote-template'

export const maxDuration = 300

/**
 * Create the quote template in Drive, once.
 *
 * Admin-only by DEFAULT-DENY: `/api/steel/quote-template` appears in no
 * permissions.ts allowlist, and the guard below is belt-and-braces because the
 * `/api/steel` prefix IS allowlisted for steel_sales.
 */
export async function GET() {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return forbiddenJson()
  try {
    const template = await findQuoteTemplate()
    return Response.json({ template })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not read the template' },
      { status: 500 }
    )
  }
}

export async function POST() {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return forbiddenJson()
  try {
    const template = await seedQuoteTemplate()
    return Response.json({ template })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Seeding failed' },
      { status: 400 }
    )
  }
}
