/**
 * Import a mail search's attachments onto a record that already exists.
 *
 * The intake wizard stages attachments during its research run and promotes the
 * chosen ones at confirm. This script is the repair path for a record that was
 * created BEFORE its attachments were reachable — in particular every record
 * confirmed while the MIME walker was misreading Gmail-composed attachments as
 * inline chrome (fixed 2026-09-17), which staged nothing and so promoted
 * nothing.
 *
 * It drives the production code, not a copy of it: the same searchThreads, the
 * same staging folder, the same promoteStagedAttachment / processPromotedDocumentAi,
 * and the same publishRecordToDrive that confirm now calls. Re-running is safe —
 * a file already on the record by name+size is skipped.
 *
 *   node --experimental-strip-types --import ./scripts/register-aliases.mjs \
 *        --env-file=.env.local scripts/import-thread-attachments.mts \
 *        --term "englertmining@gmail.com" --opportunity <uuid> [--days 365] [--dry]
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { searchThreads } from '@/lib/integrations/gmail-search'
import {
  fetchAttachmentBytes,
  isGoogleConfigured,
  MAILBOXES,
  LEAD_MAILBOXES,
  type MailAttachmentRef,
} from '@/lib/integrations/google-workspace'
import {
  STAGING_FOLDER,
  removeStagedFiles,
  sanitizeFileName,
  promoteStagedAttachment,
  processPromotedDocumentAi,
  type StagedAttachment,
  type PromotedDocument,
  type PromoteTarget,
} from '@/lib/email-ingestion/attachments'
import { publishRecordToDrive } from '@/lib/drive/publish'

const MAX_BYTES = 25 * 1024 * 1024

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

const term = arg('term')
const projectId = arg('project')
const opportunityId = arg('opportunity')
const days = Number(arg('days') ?? 365)
const dry = process.argv.includes('--dry')

if (!term || (!projectId && !opportunityId)) {
  console.error('Usage: --term "<search>" (--project <uuid> | --opportunity <uuid>) [--days N] [--dry]')
  process.exit(1)
}
if (!isGoogleConfigured()) {
  console.error('Google Workspace is not configured.')
  process.exit(1)
}

const target: PromoteTarget = projectId
  ? { kind: 'project', id: projectId }
  : { kind: 'opportunity', id: opportunityId! }

const supabase = createAdminClient()

// Every mailbox, not just the deal ones: a repair should find the file wherever
// it landed, and dedupe collapses a conversation held in two mailboxes.
const mailboxes = [...new Set([...MAILBOXES, ...LEAD_MAILBOXES])]
const search = await searchThreads(term, { sinceDays: days, maxThreads: 40, mailboxes })
console.log(`Found ${search.threads.length} thread(s) for "${term}" across ${mailboxes.length} mailboxes`)
for (const note of search.notes) console.log(`  note: ${note}`)

// What is already on the record — re-running must not duplicate.
const docTable = target.kind === 'project' ? 'documents' : 'opportunity_documents'
const fk = target.kind === 'project' ? 'project_id' : 'opportunity_id'
const { data: existingDocs } = await supabase
  .from(docTable)
  .select('file_name, file_size_bytes')
  .eq(fk, target.id)
const existing = new Set(
  (existingDocs ?? []).map((d: any) => `${d.file_name}|${d.file_size_bytes}`)
)

// Collect the real attachments, deduped across the reply chain and mailboxes.
const wanted: { att: MailAttachmentRef; mailbox: string; subject: string }[] = []
const seen = new Set<string>()
for (const thread of search.threads) {
  for (const m of thread.messages) {
    for (const a of m.attachments) {
      if (a.isInline) continue
      const key = `${a.name}|${a.size}`
      if (seen.has(key)) continue
      seen.add(key)
      if (existing.has(key)) {
        console.log(`  skip (already on record): ${a.name}`)
        continue
      }
      if (a.size > MAX_BYTES) {
        console.log(`  skip (>${MAX_BYTES / 1024 / 1024}MB): ${a.name} (${Math.round(a.size / 1024 / 1024)}MB)`)
        continue
      }
      wanted.push({ att: a, mailbox: thread.mailbox, subject: thread.subject })
    }
  }
}

console.log(`\n${wanted.length} attachment(s) to import:`)
for (const w of wanted) console.log(`  ${w.att.name} (${w.att.mimeType}, ${Math.round(w.att.size / 1024)}KB)`)
if (dry || wanted.length === 0) {
  console.log(dry ? '\n--dry: nothing written.' : '\nNothing to do.')
  process.exit(0)
}

// Stage → promote, exactly as run + confirm do.
const stagingId = `repair-${target.id}`
const staged: StagedAttachment[] = []
for (const [i, w] of wanted.entries()) {
  let bytes: string
  try {
    bytes = await fetchAttachmentBytes(w.mailbox, w.att.messageId, w.att.attachmentId)
  } catch (err) {
    console.error(`  download failed (${w.att.name}): ${err instanceof Error ? err.message : err}`)
    continue
  }
  const path = `${STAGING_FOLDER}/${stagingId}/${i + 1}_${sanitizeFileName(w.att.name)}`
  const { error } = await supabase.storage
    .from('documents')
    .upload(path, Buffer.from(bytes, 'base64'), {
      contentType: w.att.mimeType || 'application/octet-stream',
      upsert: true,
    })
  if (error) {
    console.error(`  stage failed (${w.att.name}): ${error.message}`)
    continue
  }
  staged.push({
    name: w.att.name,
    mime_type: w.att.mimeType || null,
    size_bytes: w.att.size,
    storage_path: path,
    thread_subject: w.subject,
    analyzed: false,
  })
}
console.log(`\nStaged ${staged.length}/${wanted.length}`)

const promoted: PromotedDocument[] = []
for (const [i, s] of staged.entries()) {
  const doc = await promoteStagedAttachment(supabase, s, target, i)
  if (doc) {
    promoted.push(doc)
    console.log(`  promoted: ${doc.fileName}`)
  }
}
await removeStagedFiles(supabase, staged)
console.log(`\nPromoted ${promoted.length}/${staged.length} onto ${target.kind} ${target.id}`)

// Drive first — the team can read the files while the local model is still
// working through summaries.
try {
  const published = await publishRecordToDrive(target.kind, target.id)
  console.log(
    `Drive: uploaded ${published.uploaded}, already ${published.alreadyPublished}, failed ${published.failed}`
  )
  console.log(`  ${published.folderUrl}`)
  for (const e of published.errors) console.log(`  error: ${e}`)
} catch (err) {
  console.error('Drive publish failed:', err instanceof Error ? err.message : err)
}

console.log('\nRunning the document AI pass (summary + full text + embedding), one at a time…')
for (const [i, doc] of promoted.entries()) {
  const t0 = Date.now()
  await processPromotedDocumentAi(doc)
  console.log(`  [${i + 1}/${promoted.length}] ${doc.fileName} — ${Math.round((Date.now() - t0) / 1000)}s`)
}
console.log('\nDone.')
