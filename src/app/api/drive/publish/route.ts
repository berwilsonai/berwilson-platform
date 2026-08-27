import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { publishRecordToDrive, type DriveRecordKind } from '@/lib/drive/publish'

/**
 * POST /api/drive/publish  { kind, id }
 *
 * Copies a record's documents into its Drive folder so people who cannot reach
 * the tailnet can open them. Generous duration: a bid package is several large
 * PDFs and each is downloaded from storage then uploaded to Google.
 *
 * Admin-only by default-deny — `/api/drive` appears in no permissions.ts
 * allowlist. Opening it to project managers on their own projects is a
 * one-line change if it is ever wanted; publishing is a sharing decision, so it
 * starts closed.
 */
export const maxDuration = 300

const KINDS: DriveRecordKind[] = ['project', 'opportunity', 'steel']

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const kind = body.kind as DriveRecordKind
  const id = typeof body.id === 'string' ? body.id : ''

  if (!KINDS.includes(kind) || !id) {
    return NextResponse.json(
      { error: `Send { kind, id } where kind is one of ${KINDS.join(', ')}.` },
      { status: 400 }
    )
  }

  try {
    const result = await publishRecordToDrive(kind, id)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api/drive/publish] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
