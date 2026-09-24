/**
 * POST /api/contacts/scan-card/ocr
 *
 * Multipart body: { image: File } → { raw_text }. Recognition only.
 *
 * The batch uploader posts each photo here on its own rather than shipping the
 * whole stack in one request. Three reasons, in order of how much they matter:
 *   - recognition is instant and local, so the reader learns within a second
 *     which photo was too dark and can retake it while the card is still in
 *     their hand, instead of finding out twenty minutes later;
 *   - a dozen phone photos is 60-80MB, and this box has been OOM-killed before
 *     (§12) — one 6MB request at a time never approaches that;
 *   - by the time anything slow starts, only TEXT is in play. The photographs
 *     are already gone.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ocrImage, CARD_IMAGE_TYPES } from '@/lib/ai/card-ocr'

export const maxDuration = 120

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

  try {
    const rawText = await ocrImage(buffer, file.name || 'card.jpg')
    return Response.json({ raw_text: rawText, file_name: file.name || null })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not read the image.' },
      { status: 422 },
    )
  }
}
