/**
 * POST /api/contacts/scan-card
 *
 * Multipart body: { image: File } → a drafted contact (creates NOTHING).
 *
 * The photo is recognized on-device, held in memory and a temp file for the
 * length of the OCR call, and deleted — it is never written to storage. The
 * draft goes back to the reviewer, who confirms it via ./confirm.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ocrImage, CARD_IMAGE_TYPES } from '@/lib/ai/card-ocr'
import { buildCardDraft } from '@/lib/contacts/card-intake'

// OCR is instant; the model calls and grounded search are what take the time.
export const maxDuration = 300

const MAX_BYTES = 20 * 1024 * 1024 // a modern phone photo is 3-6MB

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Expected a multipart form with an image.' }, { status: 400 })
  }

  const file = form.get('image')
  if (!(file instanceof File)) {
    return Response.json({ error: 'No image was uploaded.' }, { status: 400 })
  }
  if (file.size === 0) {
    return Response.json({ error: 'The uploaded image was empty.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is ${MAX_BYTES / 1024 / 1024}MB.` },
      { status: 400 },
    )
  }
  // Some phones post HEIC with an empty or generic type; fall back to the
  // recognizer, which rejects anything it genuinely cannot decode.
  if (file.type && !CARD_IMAGE_TYPES.includes(file.type) && !file.type.startsWith('image/')) {
    return Response.json({ error: `${file.type} is not an image.` }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  let rawText: string
  try {
    rawText = await ocrImage(buffer, file.name || 'card.jpg')
  } catch (err) {
    // A missing binary and an illegible photo are both user-actionable, and the
    // messages say which is which.
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not read the image.' },
      { status: 422 },
    )
  }

  try {
    const draft = await buildCardDraft(rawText, user.id)
    return Response.json({ draft })
  } catch (err) {
    console.error('[scan-card] draft failed', err)
    return Response.json(
      {
        error: err instanceof Error ? err.message : 'Could not build a contact from the card.',
        // The recognized text survives a model failure, so the reviewer still
        // has something to type from rather than re-photographing the card.
        raw_text: rawText,
      },
      { status: 500 },
    )
  }
}
