/**
 * Email processing pipeline.
 * Receives a Graph message ID, fetches the full email, classifies it to a project,
 * extracts structured intelligence, and stores everything in the database.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { callGemini } from '@/lib/ai/gemini'
import {
  fetchMessage,
  fetchAttachments,
  extractPlainText,
  isEmailProcessed,
  markEmailProcessed,
} from '@/lib/integrations/microsoft-graph'
import type { GraphMessage, GraphAttachment } from '@/lib/integrations/microsoft-graph'
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_PROMPT_VERSION,
} from '@/lib/ai/prompts/extraction'
import {
  CLASSIFICATION_SYSTEM_PROMPT,
  CLASSIFICATION_PROMPT_VERSION,
  buildClassificationMessage,
} from '@/lib/ai/prompts/classification'
import type { ExtractionResult } from '@/types/domain'
import { resolveEmailParticipants } from '@/lib/email/participants'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClassificationResult {
  project_id: string | null
  confidence: number
  reasoning: string
}

interface PipelineResult {
  status: 'processed' | 'duplicate' | 'failed' | 'junk'
  updateId?: string
  projectId?: string | null
  confidence?: number
  error?: string
}

// ---------------------------------------------------------------------------
// Junk mail filter — skip emails that aren't worth processing
// ---------------------------------------------------------------------------

/** Sender domains that are always junk (newsletters, marketing, automated) */
const JUNK_SENDER_DOMAINS = [
  'noreply', 'no-reply', 'mailer-daemon', 'postmaster',
  'notifications', 'marketing', 'newsletter', 'promo',
  'bounce', 'auto-reply', 'autoreply', 'donotreply',
]

/** Subject patterns that indicate junk/automated mail */
const JUNK_SUBJECT_PATTERNS = [
  /^out of office/i,
  /^automatic reply/i,
  /^auto[- ]?reply/i,
  /unsubscribe/i,
  /newsletter/i,
  /\bpromotion\b/i,
  /\bmarketing\b/i,
  /delivery status notification/i,
  /\bDSN\b/,
  /read:?\s/i,
  /^your .{0,20} receipt/i,
  /^your .{0,20} order/i,
  /^confirm your (email|account|subscription)/i,
  /^welcome to/i,
  /password reset/i,
  /verify your (email|account)/i,
  /security alert/i,
  /sign[- ]?in .{0,20} (new|detected|attempt)/i,
  /calendar:?\s/i,
  /invitation:?\s/i,
  /accepted:?\s/i,
  /declined:?\s/i,
  /tentative:?\s/i,
  /canceled:?\s/i,
]

/** Known automated sender domains to skip */
const JUNK_SENDER_DOMAIN_SUFFIXES = [
  'linkedin.com', 'facebookmail.com', 'twitter.com', 'x.com',
  'mailchimp.com', 'sendgrid.net', 'constantcontact.com',
  'hubspot.com', 'salesforce.com', 'marketo.com',
  'amazonses.com', 'google.com', 'accounts.google.com',
  'intuit.com', 'quickbooks.com', 'paypal.com',
  'docusign.net', 'zoom.us', 'calendly.com',
]

function isJunkEmail(
  senderEmail: string,
  subject: string,
): boolean {
  const senderLocal = senderEmail.split('@')[0].toLowerCase()
  const senderDomain = senderEmail.split('@')[1]?.toLowerCase() ?? ''

  // Check sender local part
  if (JUNK_SENDER_DOMAINS.some((d) => senderLocal.includes(d))) return true

  // Check sender domain
  if (JUNK_SENDER_DOMAIN_SUFFIXES.some((d) => senderDomain.endsWith(d))) return true

  // Check subject patterns
  if (JUNK_SUBJECT_PATTERNS.some((p) => p.test(subject))) return true

  return false
}

// ---------------------------------------------------------------------------
// Pipeline entry point
// ---------------------------------------------------------------------------

/**
 * Process a single email notification from Microsoft Graph.
 * Idempotent on internetMessageId.
 */
export async function processEmailNotification(
  graphMessageId: string,
  emailAddress: string
): Promise<PipelineResult> {
  let message: GraphMessage

  // 1. Fetch the full message from Graph
  try {
    message = await fetchMessage(graphMessageId, emailAddress)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[email-pipeline] Failed to fetch message ${graphMessageId}:`, msg)
    return { status: 'failed', error: `Fetch failed: ${msg}` }
  }

  // 2. Check idempotency — skip if already processed
  if (await isEmailProcessed(message.internetMessageId)) {
    console.log(`[email-pipeline] Duplicate: ${message.internetMessageId}`)
    return { status: 'duplicate' }
  }

  // 3. Junk mail filter — skip newsletters, marketing, automated messages
  const senderAddr = message.from.emailAddress.address
  if (isJunkEmail(senderAddr, message.subject)) {
    console.log(`[email-pipeline] Junk skipped: "${message.subject}" from ${senderAddr}`)
    await markEmailProcessed({
      internetMessageId: message.internetMessageId,
      graphMessageId: message.id,
      emailAddress,
      subject: message.subject,
      senderEmail: senderAddr,
      updateId: null,
      status: 'skipped',
    })
    return { status: 'junk' }
  }

  // 4. Extract plain text body
  const bodyText = extractPlainText(message.body)
  if (!bodyText || bodyText.trim().length < 10) {
    await markEmailProcessed({
      internetMessageId: message.internetMessageId,
      graphMessageId: message.id,
      emailAddress,
      subject: message.subject,
      senderEmail: senderAddr,
      updateId: null,
      status: 'skipped',
    })
    return { status: 'processed' }
  }

  // 5a. Tier 1 contact resolution — auto-create contacts for all From/To/CC participants.
  //     Runs in the background; never blocks the main pipeline.
  resolveEmailParticipants(message).catch((err) =>
    console.error('[email-pipeline] Participant resolution failed:', err)
  )

  // 5. Classify — which project does this email relate to?
  const classification = await classifyEmail(message, bodyText)

  // 6. Extract structured intelligence
  const extraction = await extractEmail(bodyText)

  // 7. Determine review state — CONSERVATIVE: default to manual review.
  // Only auto-approve when confidence is very high (>= 0.9) AND a project matched.
  // Everything else goes to the review queue so nothing ends up in the wrong project.
  let reviewState: 'approved' | 'pending' = 'pending'
  let reviewReason: string | null = null

  if (classification.confidence >= 0.9 && classification.project_id) {
    reviewState = 'approved'
  } else if (classification.confidence >= 0.4 && classification.project_id) {
    reviewReason = 'ambiguous_project'
  } else {
    reviewReason = 'unknown_project'
  }

  const supabase = createAdminClient()

  // 7. Create the update record
  const { data: update, error: updateError } = await supabase
    .from('updates')
    .insert({
      project_id: classification.project_id,
      source: 'email' as const,
      source_ref: message.internetMessageId,
      raw_content: buildRawContent(message, bodyText),
      summary: extraction.summary,
      action_items: extraction.action_items,
      waiting_on: extraction.waiting_on,
      risks: extraction.risks,
      decisions: extraction.decisions,
      mentioned_parties: extraction.mentioned_parties ?? [],
      confidence: extraction.confidence,
      review_state: reviewState,
    })
    .select('id')
    .single()

  if (updateError || !update) {
    console.error('[email-pipeline] Failed to insert update:', updateError?.message)
    await markEmailProcessed({
      internetMessageId: message.internetMessageId,
      graphMessageId: message.id,
      emailAddress,
      subject: message.subject,
      senderEmail: message.from.emailAddress.address,
      updateId: null,
      status: 'failed',
    })
    return { status: 'failed', error: `DB insert failed: ${updateError?.message}` }
  }

  // 8. If confidence requires review, add to review queue
  if (reviewReason) {
    await supabase.from('review_queue').insert({
      source_table: 'updates',
      record_id: update.id,
      project_id: classification.project_id,
      reason: reviewReason,
      confidence: classification.confidence,
      ai_explanation: classification.reasoning,
    })
  }

  // 9. Process attachments (if any)
  if (message.hasAttachments) {
    await processAttachments(message.id, emailAddress, update.id, classification.project_id)
  }

  // 10. Mark as processed for idempotency
  await markEmailProcessed({
    internetMessageId: message.internetMessageId,
    graphMessageId: message.id,
    emailAddress,
    subject: message.subject,
    senderEmail: message.from.emailAddress.address,
    updateId: update.id,
  })

  console.log(
    `[email-pipeline] Processed: "${message.subject}" → project=${classification.project_id} confidence=${classification.confidence}`
  )

  return {
    status: 'processed',
    updateId: update.id,
    projectId: classification.project_id,
    confidence: classification.confidence,
  }
}

// ---------------------------------------------------------------------------
// Classification step
// ---------------------------------------------------------------------------

async function classifyEmail(
  message: GraphMessage,
  bodyText: string
): Promise<ClassificationResult> {
  const supabase = createAdminClient()

  // Fetch all active projects with their players and hierarchy info for classification context
  const { data: projects } = await supabase
    .from('projects')
    .select(`
      id, name, solicitation_number, client_entity, sector, parent_project_id,
      project_players ( role, party:parties ( full_name ) )
    `)
    .eq('status', 'active')

  const allProjects = projects ?? []
  // Build parent name lookup and child names lookup
  const idToName = new Map(allProjects.map((p) => [p.id, p.name]))
  const childNamesOf = new Map<string, string[]>()
  for (const p of allProjects) {
    if (p.parent_project_id) {
      const siblings = childNamesOf.get(p.parent_project_id) ?? []
      siblings.push(p.name)
      childNamesOf.set(p.parent_project_id, siblings)
    }
  }

  const projectList = allProjects.map((p) => ({
    id: p.id,
    name: p.name,
    solicitation_number: p.solicitation_number,
    client_entity: p.client_entity,
    sector: p.sector,
    parent_project_id: p.parent_project_id,
    parent_name: p.parent_project_id ? (idToName.get(p.parent_project_id) ?? null) : null,
    child_names: childNamesOf.get(p.id) ?? [],
    players: (p.project_players ?? [])
      .filter((pp: { party: { full_name: string } | null }) => pp.party)
      .map((pp: { role: string; party: { full_name: string } | null }) =>
        `${pp.party!.full_name} (${pp.role})`
      ),
  }))

  const recipients = [
    ...message.toRecipients.map((r) => r.emailAddress.address),
    ...message.ccRecipients.map((r) => r.emailAddress.address),
  ]

  const userMessage = buildClassificationMessage(
    {
      subject: message.subject,
      senderName: message.from.emailAddress.name,
      senderEmail: message.from.emailAddress.address,
      recipients,
      bodyText,
    },
    projectList
  )

  try {
    const result = await callGemini<ClassificationResult>({
      task: 'classify',
      systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
      userMessage,
      userId: SYSTEM_USER_ID,
      promptVersion: CLASSIFICATION_PROMPT_VERSION,
    })

    // Validate that the returned project_id actually exists
    if (result.data.project_id) {
      const validProject = projectList.find((p) => p.id === result.data.project_id)
      if (!validProject) {
        return { project_id: null, confidence: 0, reasoning: 'AI returned invalid project_id' }
      }
    }

    return result.data
  } catch (err) {
    console.error('[email-pipeline] Classification failed:', err)
    return { project_id: null, confidence: 0, reasoning: 'Classification error — defaulting to unassigned' }
  }
}

// ---------------------------------------------------------------------------
// Extraction step
// ---------------------------------------------------------------------------

async function extractEmail(bodyText: string): Promise<ExtractionResult> {
  try {
    const result = await callGemini<ExtractionResult>({
      task: 'extract',
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userMessage: bodyText.slice(0, 50_000),
      userId: SYSTEM_USER_ID,
      promptVersion: EXTRACTION_PROMPT_VERSION,
    })
    return result.data
  } catch (err) {
    console.error('[email-pipeline] Extraction failed:', err)
    // Return a minimal extraction so the email still gets saved
    return {
      summary: 'Extraction failed — raw email content preserved.',
      action_items: [],
      waiting_on: [],
      risks: [],
      decisions: [],
      mentioned_parties: [],
      mentioned_projects: [],
      confidence: 0,
    }
  }
}

// ---------------------------------------------------------------------------
// Attachment processing
// ---------------------------------------------------------------------------

async function processAttachments(
  messageId: string,
  emailAddress: string,
  updateId: string,
  projectId: string | null
) {
  if (!projectId) return // Can't file attachments without a project

  try {
    const attachments = await fetchAttachments(messageId, emailAddress)
    const supabase = createAdminClient()

    for (const att of attachments) {
      if (att.isInline || !att.contentBytes) continue

      // Upload to Supabase Storage
      const storagePath = `${projectId}/emails/${messageId}/${att.name}`
      const fileBuffer = Buffer.from(att.contentBytes, 'base64')

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, fileBuffer, {
          contentType: att.contentType,
          upsert: true,
        })

      if (uploadError) {
        console.error(`[email-pipeline] Attachment upload failed: ${att.name}`, uploadError.message)
        continue
      }

      // Create document record
      await supabase.from('documents').insert({
        project_id: projectId,
        storage_path: storagePath,
        file_name: att.name,
        file_size_bytes: att.size,
        mime_type: att.contentType,
        doc_type: 'correspondence',
        source: 'email' as const,
      })
    }
  } catch (err) {
    console.error('[email-pipeline] Attachment processing failed:', err)
    // Non-fatal — the email update is already saved
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRawContent(message: GraphMessage, bodyText: string): string {
  const recipients = [
    ...message.toRecipients.map((r) => `${r.emailAddress.name} <${r.emailAddress.address}>`),
  ].join(', ')

  const cc = message.ccRecipients
    .map((r) => `${r.emailAddress.name} <${r.emailAddress.address}>`)
    .join(', ')

  return [
    `Subject: ${message.subject}`,
    `From: ${message.from.emailAddress.name} <${message.from.emailAddress.address}>`,
    `To: ${recipients}`,
    cc ? `CC: ${cc}` : '',
    `Date: ${message.receivedDateTime}`,
    `Message-ID: ${message.internetMessageId}`,
    `Conversation-ID: ${message.conversationId}`,
    '',
    bodyText,
  ]
    .filter(Boolean)
    .join('\n')
}
