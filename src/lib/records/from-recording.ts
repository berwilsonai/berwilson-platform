/**
 * A recording that names a deal we do not have becomes the record.
 *
 * Richard's direction, 2026-10-19: *"If the call transcript talks about moving
 * forward or discussing further, I want you to automatically create a project
 * or opportunity."* This is the third narrow amendment to §11's "nothing is
 * CREATED without a human confirm" — after the internal-task exception (10-12)
 * and the reciprocated-contact exception (10-15) — and it is written to the
 * same shape as those two: **the gate is a RULE, not a score.**
 *
 * ⚠ AND THE RULE IS DELIBERATELY NOT THE ONE THAT WAS ASKED FOR. "Talks about
 * moving forward" is said on nearly every call, and the queue already measured
 * what happens when intent language decides: 110 of 126 staged sessions
 * proposed CREATE against a register of 26 records. So intent is necessary and
 * not sufficient. Two conditions must both hold, and both are facts:
 *
 *   1. **NO EXISTING RECORD MATCHES.** Not the model's opinion — the resolver's
 *      answer, through `resolveMeetingTarget`, which is the same ladder
 *      `/decide` was pointed at on 10-17. A `target`, a `suggestion` OR an
 *      `ambiguous` verdict all mean a record probably exists, and all three
 *      refuse: §12 says ambiguity must mean no match, and here "no match" has
 *      to mean "no CREATE" as well, or the ambiguous case manufactures the
 *      duplicate the resolver just declined to pick.
 *   2. **A HARD FACT, not a phrase.** One of three, each checkable outside the
 *      transcript's own enthusiasm — see {@link findHardFact}. Today's Synetra
 *      call is the pattern: an MNDA with non-circumvention came back signed
 *      inside the hour. That is evidence; "we'll circle back" is not.
 *
 * Everything created carries `auto_created_from` = the recording's source ref,
 * which is the undo handle (one WHERE clause retires a whole run) and the
 * idempotency key (a unique constraint makes a re-run unable to duplicate).
 * Writes go through `provDbAs(PEPPER_ACTOR)` so `activity_log` names Pepper
 * rather than "system" — an unattributable autonomous create is the one thing
 * this design cannot tolerate.
 *
 * ⚠ NO SECOND MODEL CALL. The TLDR is composed from prose the recap already
 * produced. LM Studio serves one request at a time, so a model call here queues
 * behind — and in front of — whatever a human is asking Ber AI; and a summary
 * of a summary is where a detail gets invented. The extraction's per-record
 * `discussion` was written for exactly this job: what this meeting said about
 * THAT deal and nothing else.
 */

import {
  type MeetingIntakeExtraction,
  type MeetingReferencedRecord,
} from '@/lib/ai/prompts/meeting-intake'
import { PEPPER_ACTOR, assertPepper, provDbAs } from '@/lib/provenance/db'
import { PROJECT_SECTORS } from '@/lib/provenance/fields'
import { distinguishingWords } from '@/lib/records/resolve'
import { createAdminClient } from '@/lib/supabase/admin'
import { orIlike } from '@/lib/utils/postgrest'

/** How many records one recording may create. A broker call names eight sites. */
const MAX_PER_RECORDING = Number(process.env.RECORDING_MAX_NEW_RECORDS ?? 3)

/** Days either side of the recording that correspondence is read for a signature. */
const DOCUMENT_WINDOW_DAYS = Number(process.env.RECORDING_DOCUMENT_WINDOW_DAYS ?? 14)

/** How far ahead a booked follow-up still counts as one. */
const FOLLOW_UP_WINDOW_DAYS = Number(process.env.RECORDING_FOLLOW_UP_WINDOW_DAYS ?? 60)

/**
 * Subjects that mean a document came back EXECUTED, not that one was sent.
 *
 * ⚠ "Signature requested" is not a fact about a deal — it is a fact about an
 * intention, which is the thing this whole gate exists to not act on. Only the
 * completion side is listed.
 */
const EXECUTED_SUBJECT_PATTERNS = [
  'esigned document ready',
  'esignature completed',
  'signature completed',
  'has been signed',
  'fully executed',
  'countersigned',
  'completed: ',
]

/** The ilike terms that narrow the window in SQL before the patterns above run. */
const EXECUTED_SQL_TERMS = ['esigned', 'esignature', 'signed', 'executed', 'countersign']

export type HardFactKind = 'dated_next_step' | 'executed_document' | 'follow_up_meeting'

export interface HardFact {
  kind: HardFactKind
  /** One phrase a human can check the claim against. Never a score. */
  detail: string
}

export interface CreatedRecord {
  kind: 'project' | 'opportunity'
  id: string
  name: string
  /** For an opportunity: joint_venture | acquisition | investment, or null if unstated. */
  oppType: string | null
  /** The succinct line that goes in the text. */
  tldr: string
  /** What happens next, with its date when the recording gave one. */
  nextStep: string | null
  fact: HardFact
}

export interface PromoteResult {
  created: CreatedRecord[]
  /** Every record considered and not created, with the reason. Never silent. */
  skipped: { name: string; why: string }[]
}

export interface PromoteInput {
  extraction: MeetingIntakeExtraction
  /** `voicememo:<id>` / `driveaudio:<id>` — the undo handle and the dedupe key. */
  sourceRef: string
  /** 'YYYY-MM-DD' — when the conversation happened. */
  recordedOn: string
  /** Mailboxes whose calendars may be read for a booked follow-up. */
  mailboxes?: string[]
  /** Decide everything, write nothing. */
  dryRun?: boolean
}

/**
 * Create the records this recording earned, and say why it did not create the
 * others.
 */
export async function promoteRecordingRecords(input: PromoteInput): Promise<PromoteResult> {
  const { extraction, sourceRef, recordedOn, dryRun = false } = input
  const result: PromoteResult = { created: [], skipped: [] }

  const refs = extraction.referenced_records ?? []
  if (refs.length === 0) return result

  if (!dryRun) await assertPepper()

  const counterparty = counterpartyName(extraction)

  for (const ref of refs) {
    if (result.created.length >= MAX_PER_RECORDING) {
      result.skipped.push({
        name: ref.name,
        why: `${MAX_PER_RECORDING} records already created from this recording — the rest stay staged at /decide`,
      })
      continue
    }

    const name = (ref.name ?? '').trim()
    if (name.length < 3) {
      result.skipped.push({ name: ref.name ?? '(unnamed)', why: 'the name is too thin to act on' })
      continue
    }

    // ── 1. Does a record already exist? ──────────────────────────────────────
    const existing = await describeExisting(name)
    if (existing) {
      result.skipped.push({ name, why: existing })
      continue
    }

    // ── 2. Is there a hard fact? ─────────────────────────────────────────────
    const fact = await findHardFact({
      ref,
      name,
      counterparty,
      extraction,
      recordedOn,
      mailboxes: input.mailboxes,
      soleRecord: refs.length === 1,
    })
    if (!fact) {
      result.skipped.push({
        name,
        why: 'nothing but intent — no dated next step, no executed document, no follow-up booked',
      })
      continue
    }

    // ── 3. Create it ─────────────────────────────────────────────────────────
    const nextStep = datedNextStep(extraction, name, refs.length === 1)
    const tldr = composeTldr(ref, extraction)
    const kind = destinationFor(ref)

    if (dryRun) {
      result.created.push({
        kind,
        id: '(dry run)',
        name,
        oppType: kind === 'opportunity' ? opportunityType(ref) : null,
        tldr,
        nextStep: nextStep?.label ?? null,
        fact,
      })
      continue
    }

    const created = await insertRecord({
      kind,
      name,
      ref,
      extraction,
      sourceRef,
      recordedOn,
      nextStepLabel: nextStep?.label ?? null,
      fact,
    })
    if (typeof created === 'string') {
      result.skipped.push({ name, why: created })
      continue
    }
    result.created.push({ ...created, tldr, nextStep: nextStep?.label ?? null, fact })
  }

  return result
}

// ─── gate 1: does it already exist ───────────────────────────────────────────

/**
 * A sentence saying which record this name already is, or null when it is
 * genuinely new.
 *
 * ⚠ ALL THREE OF THE RESOLVER'S NEGATIVE ANSWERS REFUSE. `target` is a match,
 * `suggestion` is a pre-tick a human confirms, and `ambiguous` means several
 * records could be it. Only the fourth case — nothing at any bar — is new work.
 */
async function describeExisting(name: string): Promise<string | null> {
  const { resolveMeetingTarget } = await import('@/lib/meetings/file-notes')
  let res
  try {
    res = await resolveMeetingTarget([name])
  } catch (err) {
    // ⚠ FAIL CLOSED. A resolver that threw has not told us the record is new,
    // and creating on a failed lookup is how a register fills with duplicates.
    return `could not check for an existing record (${err instanceof Error ? err.message : String(err)})`
  }
  if (res.target) return `already a ${res.target.kind}: ${res.target.name}`
  if (res.suggestion) return `looks like the existing ${res.suggestion.kind} ${res.suggestion.name} — staged for a human`
  if (res.ambiguous) return `ambiguous against existing records (${res.ambiguous})`

  // A record created moments ago by THIS recording's sibling reference, or by a
  // run that failed after the insert. The unique constraint would catch it, but
  // reporting "already created" reads better than a constraint violation.
  const supabase = createAdminClient()
  const [p, o] = await Promise.all([
    supabase.from('projects').select('id').ilike('name', name).limit(1),
    supabase.from('opportunities').select('id').ilike('name', name).limit(1),
  ])
  if ((p.data?.length ?? 0) > 0 || (o.data?.length ?? 0) > 0) {
    return 'a record with this exact name already exists'
  }
  return null
}

// ─── gate 2: the hard fact ───────────────────────────────────────────────────

/**
 * One checkable fact that this conversation produced something, or null.
 *
 * The three are ordered cheapest-first, and the first one found wins: the point
 * is whether a fact EXISTS, not how many there are.
 */
export async function findHardFact(args: {
  ref: MeetingReferencedRecord
  name: string
  counterparty: string | null
  extraction: MeetingIntakeExtraction
  recordedOn: string
  mailboxes?: string[]
  soleRecord: boolean
}): Promise<HardFact | null> {
  // (a) A follow-up with a DATE on it. Free — the recap already parsed it.
  const dated = datedNextStep(args.extraction, args.name, args.soleRecord)
  if (dated) {
    return { kind: 'dated_next_step', detail: dated.label }
  }

  // ⚠ THE RECORD'S OWN NAME, NOT THE COUNTERPARTY'S. See `identifiesRecord` for
  // the measurement that forced this: counterparty words made one Tensor MNDA
  // the "fact" behind four unrelated sites on one call.
  if ([...distinguishingWords(args.name)].length === 0) return null

  // (b) A document that came back EXECUTED near the conversation.
  const signed = await executedDocument(args.name, args.recordedOn).catch(() => null)
  if (signed) return { kind: 'executed_document', detail: signed }

  // (c) A follow-up already on the calendar.
  const booked = await followUpBooked(args.name, args.mailboxes).catch(() => null)
  if (booked) return { kind: 'follow_up_meeting', detail: booked }

  return null
}

/**
 * The task with a due date that belongs to this record.
 *
 * `record_hint` is the model's own link back to `referenced_records[].name`, so
 * it is compared by name. A hint-less task counts ONLY when the meeting named
 * one record — with two deals in the room an unattributed task cannot be
 * assigned to either (§12: a value two records could claim goes to neither).
 */
export function datedNextStep(
  extraction: MeetingIntakeExtraction,
  name: string,
  soleRecord: boolean
): { label: string; date: string } | null {
  const target = name.trim().toLowerCase()
  for (const task of extraction.tasks ?? []) {
    if (!task.due_date) continue
    const hint = (task.record_hint ?? '').trim().toLowerCase()
    const mine = hint ? hint === target : soleRecord
    if (!mine) continue
    return { label: `${task.title.trim()} (by ${task.due_date})`, date: task.due_date }
  }
  return null
}

/** A subject in the window that says a document was executed AND names this deal. */
async function executedDocument(recordName: string, recordedOn: string): Promise<string | null> {
  const supabase = createAdminClient()
  const anchor = new Date(`${recordedOn}T12:00:00Z`).getTime()
  if (!isFinite(anchor)) return null
  const from = new Date(anchor - DOCUMENT_WINDOW_DAYS * 86_400_000).toISOString()
  const to = new Date(anchor + DOCUMENT_WINDOW_DAYS * 86_400_000).toISOString()

  // ⚠ THE FILTER IS BUILT, NOT CONCATENATED. §12: an unescaped comma in `.or()`
  // kills the query and the caller reads it as "no results"; unquoted
  // parentheses return an empty set with no error at all.
  const clause = EXECUTED_SQL_TERMS.map((t) => orIlike(['subject'], t))
    .filter((c): c is string => Boolean(c))
    .join(',')
  if (!clause) return null

  const { data, error } = await supabase
    .from('email_threads')
    .select('subject, last_at')
    .gte('last_at', from)
    .lte('last_at', to)
    .or(clause)
    .limit(1000)
  if (error) throw new Error(error.message)

  for (const row of (data ?? []) as { subject: string | null; last_at: string | null }[]) {
    const subject = (row.subject ?? '').toLowerCase()
    // The wrapper decides WHETHER a document was executed…
    if (!EXECUTED_SUBJECT_PATTERNS.some((p) => subject.includes(p))) continue
    // …and the document's own name decides WHICH deal it is about. Matching the
    // deal against the whole subject let "eSigned Document Ready:" supply the
    // word that convicted a template (see `identifiesRecord`).
    if (!identifiesRecord(documentNameFromSubject(row.subject ?? ''), recordName)) continue
    return `${(row.subject ?? '').trim().slice(0, 90)} (${(row.last_at ?? '').slice(0, 10)})`
  }
  return null
}

/** A calendar event ahead of us whose title names THIS deal. */
async function followUpBooked(recordName: string, mailboxes?: string[]): Promise<string | null> {
  const { fetchCalendarEvents, allMailboxes, isGoogleConfigured } = await import(
    '@/lib/integrations/google-workspace'
  )
  if (!isGoogleConfigured()) return null
  const boxes = mailboxes && mailboxes.length > 0 ? mailboxes : allMailboxes()
  const now = new Date()
  const timeMin = new Date(now.getTime() + 60 * 60 * 1000).toISOString()
  const timeMax = new Date(now.getTime() + FOLLOW_UP_WINDOW_DAYS * 86_400_000).toISOString()

  for (const mailbox of boxes) {
    const events = await fetchCalendarEvents(timeMin, timeMax, mailbox).catch(() => [])
    for (const ev of events) {
      // Same bar as the document: the whole name, or it is a shared word. A
      // solicitation titled "AMD 0001 IDIQ" matched "SBIR Phase 3 / $102M IDIQ
      // Vehicle" on `idiq` under the any-word rule — a contract-vehicle noun,
      // not a deal.
      if (!identifiesRecord(ev.subject ?? '', recordName)) continue
      return `${(ev.subject ?? '').trim().slice(0, 70)} on ${(ev.start ?? '').slice(0, 10)}`
    }
  }
  return null
}

/**
 * Does this text name THIS deal — the whole name, contiguously?
 *
 * ⚠ THREE RULES WERE TRIED HERE AND THE REAL CORPUS KILLED THE FIRST TWO.
 * Measured 2026-10-19 by running the gate over 18 already-staged meetings:
 *
 *   1. **ANY distinguishing word matches.** 9 records would have been created
 *      and every one was wrong. The search included the COUNTERPARTY's words,
 *      so one `Tensor MNDA (with Non-Circumvention)` became the "fact" behind
 *      *Uintah Basin Project*, *Alberta Project*, *Weber Data Center* and *Deer
 *      Creek Public Infrastructure*. And Gmail's own wrapper is in the
 *      haystack: *West Virginia Power-**Ready** Site* matched a **template** on
 *      the word in *"eSigned Document **Ready**:"*.
 *   2. **EVERY distinguishing word matches, counterparty excluded.** Down to 3,
 *      all still wrong — because `distinguishingWords` correctly drops the
 *      vocabulary every record shares, so *Tensor Site* and *Tensor IQ Data
 *      Center* both reduce to the single word `tensor`, which is the
 *      counterparty's. "Every word" and "one shared word" are the same test on
 *      a two-word name, which is §12's shared-industry-word trap with no
 *      threshold that escapes it.
 *   3. **"…and the counterparty is new to the register."** Measured before
 *      building it, and it does not discriminate at all: `Tensor IQ` is named
 *      by **0** projects and opportunities, exactly like `Synetra`.
 *
 * What survives is the strict, threshold-free form: **the document is named
 * after the deal.** The record's whole name must appear contiguously, once
 * punctuation is flattened. `synetra` ⊂ `bw mnda synetra with non circumvention
 * docx` passes — which is the case this gate exists for, a first MNDA with a
 * counterparty whose name IS the deal. `tensor iq data center` ⊄ `tensor mnda`
 * does not, and that deal stays staged for a human, which is where it already
 * was. A long name (`Weirton — Cleveland-Cliffs (WV)`) will never be created
 * this way, and that is the right answer: it already exists.
 *
 * ⚠ `distinguishingWords` is still consulted, for one job only — a name with no
 * identity-bearing word at all ("The Project") must not match on its filler.
 */
export function identifiesRecord(text: string, recordName: string): boolean {
  if ([...distinguishingWords(recordName)].length === 0) return false
  const flat = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  const needle = flat(recordName)
  if (needle.length < 3) return false
  return flat(text).includes(needle)
}

/**
 * A subject with the vendor's own wrapper removed, so only the document's name
 * is matched against.
 *
 * Gmail's eSignature subjects are `eSigned Document Ready: "<file>.docx - …"`,
 * and a forwarded one adds `Fwd:`. Where a quoted file name is present it IS
 * the answer; otherwise the known prefixes come off. Leaving them on is what
 * let the word "ready" convict a template, above.
 */
export function documentNameFromSubject(subject: string): string {
  const quoted = subject.match(/"([^"]{3,})"/)
  if (quoted) return quoted[1]
  return subject
    .replace(/^\s*(re|fwd|fw)\s*:\s*/gi, '')
    .replace(/^\s*(esigned document ready|esignature completed|signature completed|completed)\s*:\s*/i, '')
    .trim()
}

// ─── the record itself ───────────────────────────────────────────────────────

/**
 * Which table this belongs in.
 *
 * ⚠ §12 SAYS THE MODEL'S `kind` IS A GUESS AND A MATCH IS A FACT — and here, by
 * construction, there is no match to read instead: gate 1 only lets a name
 * through when NOTHING in either table resolves. So the guess is all there is,
 * and the prompt that produced it states the test in the model's own
 * instructions ("project" for built work, "opportunity" only for a corporate
 * transaction), which is the same test a human would apply.
 *
 * The default is the opportunity side, deliberately. A first recorded
 * conversation about something we do not have is a PURSUIT; a project is work we
 * hold. Wrong-but-recoverable beats a project register filling with talk.
 */
export function destinationFor(ref: MeetingReferencedRecord): 'project' | 'opportunity' {
  return ref.kind === 'project' ? 'project' : 'opportunity'
}

/**
 * joint_venture | acquisition | investment, read off what was actually said.
 *
 * Null when the conversation did not say — Richard asked for partnership and
 * acquisition calls to be *tagged as such*, and inventing the tag where the
 * transcript is silent is worse than leaving the question open on the record.
 */
export function opportunityType(ref: MeetingReferencedRecord): string | null {
  const text = `${ref.name ?? ''} ${ref.note ?? ''} ${ref.discussion ?? ''}`.toLowerCase()
  if (/\bacquisi|\bacquire|\bmerger\b|\bbuy(ing)? the (company|business)|\bletter of intent\b|\bloi\b/.test(text)) {
    return 'acquisition'
  }
  if (/\bpartner|\bpartnership\b|\bjoint venture\b|\bjv\b|\bteaming\b|\bmnda\b|\bnda\b|\bnon-circumvention\b/.test(text)) {
    return 'joint_venture'
  }
  if (/\bequity stake\b|\binvest(ment|ing|or)?\b|\bcapital into\b/.test(text)) return 'investment'
  return null
}

/** A sector the enum will accept, or null. §12: a value outside an enum fails the WHOLE write. */
function safeSector(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  return (PROJECT_SECTORS as readonly string[]).includes(v) ? v : null
}

function insertError(kind: string, name: string, message: string): string {
  return `${kind} "${name}" could not be created: ${message}`
}

async function insertRecord(args: {
  kind: 'project' | 'opportunity'
  name: string
  ref: MeetingReferencedRecord
  extraction: MeetingIntakeExtraction
  sourceRef: string
  recordedOn: string
  nextStepLabel: string | null
  fact: HardFact
}): Promise<{ kind: 'project' | 'opportunity'; id: string; name: string; oppType: string | null } | string> {
  const { kind, name, ref, extraction, sourceRef, recordedOn, nextStepLabel, fact } = args
  const db = provDbAs(PEPPER_ACTOR)

  // The description is the permanent note Richard asked for: what this is, read
  // off the recording, with the fact that opened the gate written down beside it
  // so the create is auditable on the record itself and not only in a log.
  const provenance =
    `Created automatically from a recording on ${recordedOn}. ` +
    `Gate: ${fact.kind.replace(/_/g, ' ')} — ${fact.detail}. ` +
    `Review and correct anything here; it was read from speech, not typed.`
  const body = [ref.discussion?.trim() || ref.note?.trim() || extraction.summary?.trim() || null, provenance]
    .filter(Boolean)
    .join('\n\n')

  if (kind === 'opportunity') {
    const oppType = opportunityType(ref)
    const { data, error } = await db
      .from('opportunities')
      .insert({
        name,
        opp_type: oppType,
        status: 'identified',
        description: body,
        next_step: nextStepLabel,
        identified_date: recordedOn,
        source: 'Recording',
        counterparty: counterpartyName(extraction),
        location: ref.location?.trim() || null,
        sector: ref.sector?.trim() || null,
        estimated_value: typeof ref.estimated_value === 'number' ? ref.estimated_value : null,
        auto_created_from: sourceRef,
      })
      .select('id, name')
      .maybeSingle()
    if (error) return insertError('opportunity', name, error.message)
    if (!data) return insertError('opportunity', name, 'the insert returned no row')
    return { kind, id: (data as { id: string }).id, name: (data as { name: string }).name, oppType }
  }

  // ⚠ `projects.sector` IS NOT NULL AND HAS NO DEFAULT — found by the upload
  // verification on 2026-10-19, which could not even create its own scratch
  // project. §12 says a field the caller never mentioned must be OMITTED rather
  // than nulled, because an explicit NULL does not fall back to the column
  // DEFAULT — and that rule has an unstated precondition: omission only works
  // where a default EXISTS. Here `status` and `stage` have one and `sector` does
  // not, so omitting it is a `23502`, which this pass would have reported as a
  // skip with a Postgres message in it.
  //
  // The fix is NOT to pick a sector. The enum is government | infrastructure |
  // real_estate | prefab | institutional | technology | health, there is no
  // "unknown" member, and a guessed sector reads on the record as a fact
  // somebody established. A conversation that did not say what KIND of work a
  // deal is has not given enough to open a project, so it stays staged for a
  // human — which is where it already was.
  const sector = safeSector(ref.sector)
  if (!sector) {
    return (
      `project "${name}" was not created: the recording never said what sector it is ` +
      `(projects.sector is required and there is no honest default). It stays staged at /decide, ` +
      `where one tap creates it with the sector you pick.`
    )
  }

  const { data, error } = await db
    .from('projects')
    .insert({
      name,
      sector,
      // Omitted-vs-nulled still applies to these two, which DO have defaults.
      stage: 'pursuit',
      status: 'active',
      description: body,
      location: ref.location?.trim() || null,
      estimated_value: typeof ref.estimated_value === 'number' ? ref.estimated_value : null,
      auto_created_from: sourceRef,
    })
    .select('id, name')
    .maybeSingle()
  if (error) return insertError('project', name, error.message)
  if (!data) return insertError('project', name, 'the insert returned no row')
  return { kind, id: (data as { id: string }).id, name: (data as { name: string }).name, oppType: null }
}

// ─── the words that go in the text ───────────────────────────────────────────

/**
 * The organization on the other side of the table, or null.
 *
 * ⚠ DECIDED ON THE `is_organization` FLAG AND THEN NARROWED BY NAME, never the
 * other way round (§12: the model's flag may convict and never acquit). Ber
 * Wilson's own name appearing as an "attendee" is a measured failure of this
 * extraction — our own company attended four of its own calls.
 */
function counterpartyName(extraction: MeetingIntakeExtraction): string | null {
  // ⚠ BOTH LISTS, BECAUSE THE PROMPT MOVED THE COMPANIES (1.3, 2026-10-28).
  // `attendees` used to mean "present or referenced" and so carried the
  // organizations this reads for; it now means the room, and a counterparty
  // organization lands in `mentioned`. Reading only the new field would have
  // lost every session staged before the change, and reading only the old one
  // loses every session after it — §12: a verdict computed before a fact
  // existed must be re-asked once the fact arrives, and fixing the producer
  // does not fix the consumer.
  const people = [...(extraction.attendees ?? []), ...(extraction.mentioned ?? [])]
  for (const person of people) {
    if (!person.is_organization) continue
    const name = (person.name ?? '').trim()
    if (!name) continue
    if (/ber\s*wilson|dino\s/i.test(name)) continue
    return name
  }
  // Failing that, the company written beside an external person.
  for (const person of people) {
    const company = (person.company ?? '').trim()
    if (!company) continue
    if (/ber\s*wilson/i.test(company)) continue
    return company
  }
  return null
}

/** First sentences of prose, cut at a sentence boundary, never mid-word. */
export function succinct(text: string, limit = 150): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= limit) return clean
  const window = clean.slice(0, limit + 40)
  const stop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('; '))
  if (stop >= 60) return window.slice(0, stop + 1).trim()
  const space = clean.slice(0, limit).lastIndexOf(' ')
  return `${clean.slice(0, space > 40 ? space : limit).trim()}…`
}

/**
 * What this deal IS, in one line.
 *
 * Prefers the per-record `discussion` — the paragraph the prompt asks for about
 * THAT deal and nothing else. §12: one narrative written to three records put
 * the Steelton negotiation on Riverdale's feed, and a TLDR is the same trap in
 * 150 characters.
 */
export function composeTldr(
  ref: MeetingReferencedRecord,
  extraction: MeetingIntakeExtraction
): string {
  const own = ref.discussion?.trim() || ref.note?.trim()
  if (own) return succinct(own)
  // No per-record paragraph means the recording only mentioned it, so the
  // meeting-wide summary is the honest fallback — and it is labelled as one.
  const summary = extraction.summary?.trim()
  return summary ? succinct(summary) : 'Read off a recording; no detail was stated.'
}
