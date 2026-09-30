/**
 * A lead's files, in the folder the people who will price them can open.
 *
 * The platform is tailnet-only, so for every lane whose audience has no login
 * this folder is not a convenience — it is the only way they ever see a drawing
 * or an addendum. `sheet.ts` publishes the LIST they work from; this publishes
 * the FILES a row refers to.
 *
 * One folder per lane, one subfolder per lead. Sharing is granted on the LANE
 * folder, once, and inherited by every lead under it — the alternative is a
 * permission grant per lead, which is a hundred grants a year to maintain and
 * revoke by hand.
 *
 * ⚠ The lane's parent folder must be created BY A HUMAN on the shared drive and
 * its id pasted into the category. `drive.file` lets the impersonated user add
 * children to a folder a person made on a shared drive, but does not let it
 * create one in My Drive (§12, 09-16) — the same contract as
 * STEEL_QUOTES_FOLDER_ID. A lane with no folder id simply does not publish, and
 * says so rather than inventing a location.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  DriveScopeError,
  ensureFolder,
  folderUrl,
  shareWithAddresses,
  uploadToFolder,
} from '@/lib/integrations/google-drive-write'
import { PRIMARY_MAILBOX, isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { parseLeadAttachments, type LeadRow } from './db'
import type { LeadCategory } from './categories'

/**
 * Publish one lead's staged attachments into its lane's Drive folder.
 *
 * Returns the folder URL, or null when the lane has no folder configured, when
 * Google is not configured, or when the lead has no files. Null is a legitimate
 * outcome, not a failure: most bid invitations arrive as a message with a link
 * to a plan room and carry no attachment at all, which is precisely why the
 * sheet rather than the folder is the primary surface.
 */
export async function publishLeadToCategoryFolder(
  lead: LeadRow,
  category: LeadCategory | null
): Promise<string | null> {
  if (!category?.drive_folder_id || !isGoogleConfigured()) return null

  const staged = parseLeadAttachments(lead.attachments)
  if (staged.length === 0) return null

  // Sharing asserted on the LANE folder on every publish, for the same reason
  // ensureDomainShared runs nightly: a permission someone removed by hand fails
  // silently, and the shape of that failure is the platform reporting success
  // while the folder fills up invisibly to the people it was filled for.
  if (category.share_with.length > 0) {
    await shareWithAddresses(category.drive_folder_id, category.share_with).catch((err) =>
      console.warn('[leads/drive] could not assert lane sharing:', err)
    )
  }

  // One subfolder per lead, named for the lead. Named rather than looked up by
  // title: two leads may legitimately share a title, and merging their bid
  // packages would be worse than an untidy folder list.
  const folder = await ensureFolder(
    `${lead.title.slice(0, 120)} — ${(lead.received_at ?? lead.created_at ?? '').slice(0, 10)}`,
    category.drive_folder_id
  )

  const supabase = createAdminClient()
  for (const file of staged) {
    try {
      const { data: blob, error } = await supabase.storage
        .from('documents')
        .download(file.storage_path)
      if (error || !blob) throw new Error(error?.message ?? 'file missing from storage')

      await uploadToFolder({
        folderId: folder.id,
        name: file.name,
        mimeType: file.mime_type ?? 'application/octet-stream',
        bytes: await blob.arrayBuffer(),
      })
    } catch (err) {
      // A missing scope fails identically for every remaining file, so say it
      // once and stop rather than repeating it per document.
      if (err instanceof DriveScopeError) throw err
      console.warn(`[leads/drive] ${file.name} not published:`, err)
    }
  }

  return folderUrl(folder.id)
}

/**
 * Assert sharing on every lane folder that has outside recipients.
 *
 * Run from the sweep's publish phase. Cheap, idempotent, and the only thing
 * that repairs a grant somebody removed in Drive — a content hash cannot detect
 * a change made on the far side of the API (§12, 08-26).
 */
export async function assertCategoryFolderSharing(
  categories: LeadCategory[]
): Promise<{ folder: string; granted: string[]; failed: string[] }[]> {
  if (!isGoogleConfigured()) return []
  const out: { folder: string; granted: string[]; failed: string[] }[] = []

  for (const c of categories) {
    if (!c.drive_folder_id || c.share_with.length === 0) continue
    const result = await shareWithAddresses(
      c.drive_folder_id,
      c.share_with,
      PRIMARY_MAILBOX
    ).catch(() => ({ granted: [], failed: c.share_with }))
    if (result.granted.length > 0 || result.failed.length > 0) {
      out.push({ folder: c.label, ...result })
    }
  }
  return out
}
