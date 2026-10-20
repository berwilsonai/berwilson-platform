/**
 * POST / DELETE /api/attention/dismiss — push an attention item out of sight,
 * and put it back.
 *
 * ⚠ THE BODY IS TRUSTED FOR ONE FIELD AND NOTHING ELSE. A dismissal snapshots
 * the item's title, project name and project id, and every one of those is read
 * off the LIVE item here rather than taken from the request. §12's hardest
 * version of this (`/api/records/[child]/[id]`): a client that can name its own
 * parent can move a row onto a record it may write — here it would be worse than
 * that, because `project_id` is what contains the dismissed list from a
 * `confidential` project (§8), so a fabricated one would write a protected
 * milestone's title into a surface every viewer can read. The client sends an
 * item key. Everything else comes from the engine.
 *
 * ⚠ AND THAT IS ALSO THE ACCESS CHECK, STRUCTURALLY. `computeAttention()` has
 * already dropped every item belonging to a protected project before this
 * handler sees the list, so an item key that is not in it cannot be dismissed —
 * you can only silence what you can see. That is a fact about the choke point
 * rather than a condition written here, which is the only kind of check that
 * cannot be forgotten by the route added next year.
 */

import { NextRequest, NextResponse } from 'next/server'

import { getViewer } from '@/lib/auth/viewer'
import { computeAttention } from '@/lib/attention'
import {
  ATTENTION_DISMISS_DAYS,
  attentionCategoryForKey,
} from '@/lib/attention-kinds'
import { dismissAttentionItem, restoreAttentionItem } from '@/lib/attention-dismissals'

/** The ceiling on a quiet. A dismissal is "not now", never "never". */
const MAX_DISMISS_DAYS = 90

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { itemKey?: unknown; days?: unknown } | null
  const itemKey = typeof body?.itemKey === 'string' ? body.itemKey.trim() : ''
  if (!itemKey) return NextResponse.json({ error: 'Which item?' }, { status: 400 })

  // An unrecognised prefix is refused rather than stored. §12: a prefix
  // discriminator is a registry with no type behind it, and a key that matches
  // no kind would be a row nothing can ever render or restore.
  const category = attentionCategoryForKey(itemKey)
  if (!category) {
    return NextResponse.json({ error: 'That is not an attention item.' }, { status: 400 })
  }

  const days =
    typeof body?.days === 'number' && Number.isFinite(body.days)
      ? Math.min(MAX_DISMISS_DAYS, Math.max(1, Math.round(body.days)))
      : ATTENTION_DISMISS_DAYS

  const { items } = await computeAttention()
  const item = items.find((i) => i.id === itemKey)
  if (!item) {
    // Already dismissed, already dealt with, or belongs to a project this
    // surface withholds. All three are the same answer to the reader, and none
    // of them is an error worth a 500.
    return NextResponse.json(
      { error: 'That item is no longer on the list — reload to see what is.' },
      { status: 404 }
    )
  }

  try {
    const { dismissedUntil } = await dismissAttentionItem({
      itemKey,
      category: item.category,
      title: item.title,
      projectName: item.project_name,
      projectId: item.project_id,
      days,
      actor: viewer.teamMemberName ?? viewer.email ?? null,
    })
    return NextResponse.json({ dismissed: true, dismissedUntil })
  } catch (err) {
    console.error('[attention/dismiss] failed:', err)
    return NextResponse.json({ error: 'Could not dismiss that item.' }, { status: 500 })
  }
}

/**
 * DELETE — the undo, reached by the Undo toast and by Restore on the Dismissed
 * view. Idempotent: deleting a mark that is already gone is a success, because
 * the reader's intent ("put it back") is satisfied either way.
 */
export async function DELETE(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { itemKey?: unknown } | null
  const itemKey = typeof body?.itemKey === 'string' ? body.itemKey.trim() : ''
  if (!itemKey) return NextResponse.json({ error: 'Which item?' }, { status: 400 })

  try {
    await restoreAttentionItem(itemKey)
    return NextResponse.json({ restored: true })
  } catch (err) {
    console.error('[attention/dismiss] restore failed:', err)
    return NextResponse.json({ error: 'Could not restore that item.' }, { status: 500 })
  }
}
