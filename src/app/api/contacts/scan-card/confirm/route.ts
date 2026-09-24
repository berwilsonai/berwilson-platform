/**
 * POST /api/contacts/scan-card/confirm
 *
 * Body: { draft: CardScanDraft, action?: 'create' | 'link' } → creates or fills
 * in the contact.
 *
 * Separate from the scan step because a scan must never create a record on its
 * own: OCR misreads, and the AI's fit read is a judgement a human signs off.
 * The reviewer's edits are what land here.
 *
 * The writing itself lives in lib/contacts/card-save, shared with the batch
 * confirm so both doors leave the directory in the same shape.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { actorAdminClient } from '@/lib/auth/viewer'
import { saveCardContact } from '@/lib/contacts/card-save'
import type { CardScanDraft } from '@/lib/contacts/card-intake'

export const maxDuration = 120

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { draft?: Partial<CardScanDraft>; action?: 'create' | 'link' }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const draft = body.draft
  if (!draft) return Response.json({ error: 'Missing draft.' }, { status: 400 })

  const action = body.action === 'link' ? 'link' : 'create'

  try {
    const result = await saveCardContact(draft, action, await actorAdminClient())
    return Response.json({ id: result.id, action: result.action })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not save the contact.' },
      { status: 500 },
    )
  }
}
