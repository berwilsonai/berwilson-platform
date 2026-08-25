import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import { leadsDb, parseLeadAttachments, type LeadRow } from '@/lib/leads/db'

/**
 * GET /api/leads/[id]/attachment?path=…[&download=1]
 *
 * Mints a short-lived signed URL SERVER-side. Never let the browser call
 * createSignedUrl against this stack — the self-hosted storage has no RLS
 * policies, so an anon-key signing request cannot work (see CLAUDE.md 2026-07-08).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const path = request.nextUrl.searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'A path is required.' }, { status: 400 })

  const { data, error } = await leadsDb()
    .from('leads')
    .select('id, attachments')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // The path must belong to THIS lead — otherwise the id is just decoration and
  // any stored object could be signed by guessing its path.
  const owned = parseLeadAttachments((data as Pick<LeadRow, 'attachments'>).attachments).some(
    (a) => a.storage_path === path
  )
  if (!owned) return NextResponse.json({ error: 'Unknown attachment.' }, { status: 404 })

  const download = request.nextUrl.searchParams.get('download') === '1'
  const { data: signed, error: signErr } = await createAdminClient()
    .storage.from('documents')
    .createSignedUrl(path, 300, download ? { download: true } : undefined)

  if (signErr || !signed) {
    return NextResponse.json({ error: signErr?.message ?? 'Could not sign URL.' }, { status: 500 })
  }
  return NextResponse.json({ url: signed.signedUrl })
}
