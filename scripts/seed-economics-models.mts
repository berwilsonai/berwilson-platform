/**
 * Give every deal an economics model, and stage the figures its own documents
 * already state.
 *
 * MEASURED 2026-10-22: `deal_economics` held ZERO rows. So did
 * `economics_lines`, `economics_buckets` and `economics_capacity_sources`. All
 * 30 records carried `economics_capture_value` NULL and `economics_status`
 * NULL, and 29 of 30 had no `estimated_value` either — which `clear-estimated-
 * value.mts` had deliberately emptied because it meant five different things
 * across eight projects.
 *
 * The consequence is the one an executive feels first: "how big is this deal,
 * and how much of it is ours" had no answer anywhere in the platform, for any
 * deal, while ten tables of machinery stood ready and `/mspa`, the pipeline
 * view and the portfolio brief had nothing to total.
 *
 * ⚠ IT INVENTS NO FIGURE. Two steps, and only the first writes anything the
 * reader sees: `createEconomics` makes the empty model and its default
 * buckets, then `extractEconomicsFromDocuments` reads the deal's own documents
 * and stages what it finds in `economics_input_proposals` as `pending`, each
 * with the sentence it was quoted from. Accepting a proposal is what writes a
 * value and its provenance, and that is a human's act (§11). A figure with no
 * quote is discarded by the extractor before it ever reaches the table.
 *
 * ⚠ AN EMPTY MODEL IS NOT A DEAL SIZE. `economics_capture_value` stays NULL
 * until the lines compute, so nothing here publishes a number — a model with
 * no lines has no defensible capture figure and `persistComputed` refuses to
 * write one (§12: a rolled-up sum with nothing in it is NULL, not 0).
 *
 * ⚠ RUN IT WITH THE BOX TO ITSELF. LM Studio serves ONE request at a time, so
 * this queues against Pepper's crons and against anybody asking Ber AI a
 * question. Each document window is a 30-60s call to a 22GB model. Progress is
 * per record and the pass is resumable — a record that already has a model is
 * skipped, so an interrupted run continues rather than restarting (§12: work
 * fired off after a handler returns dies with the next kickstart, and a deploy
 * IS a kickstart).
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/seed-economics-models.mts
 *        [--apply] [--models-only | --extract-only] [--limit N] [--record <uuid>]
 *
 * `--models-only` creates the models and stages nothing: no model call, runs in
 * seconds, and makes the Economics tab usable on every deal immediately.
 * `--extract-only` is the second half — it reads the documents of records that
 * already have a model, which is the only way the two-phase run works.
 */
import { createAdminClient } from '../src/lib/supabase/admin'
import { createEconomics } from '../src/lib/economics/store'
import { extractEconomicsFromDocuments } from '../src/lib/economics/extract'
import type { RecordKind } from '../src/lib/records/scope'

const APPLY = process.argv.includes('--apply')
const MODELS_ONLY = process.argv.includes('--models-only')
/**
 * Extract against models that already exist, instead of creating new ones.
 *
 * ⚠ THE TWO-PHASE RUN NEEDS THIS AND THE FIRST VERSION HAD NO WAY TO SAY IT.
 * The record selection is "has no model yet", which is right for phase one and
 * silently selects NOTHING after it: `--models-only` gives all 30 records a
 * model in seconds, and the extraction pass then found 0 records to work on
 * and reported success. A pass that reports what it did must actually have
 * done it (§12).
 */
const EXTRACT_ONLY = process.argv.includes('--extract-only')
/** Re-extract a record that already has staged proposals. Duplicates them. */
const REDO = process.argv.includes('--redo')
const LIMIT = Number(process.argv[process.argv.indexOf('--limit') + 1]) || Infinity
const ONE = process.argv.includes('--record') ? process.argv[process.argv.indexOf('--record') + 1] : null

/**
 * Whose actor the model is created as.
 *
 * A seeded model is the platform's own act, not a person's, and
 * `calcDbAs(actor)` is what puts a name in `activity_log` rather than
 * "system" (§12 — a trail whose every row reads "system" answers nothing).
 */
const ACTOR = { id: '00000000-0000-0000-0000-000000000000', email: 'pepper@berwilson.com' }

type Row = Record<string, unknown>

async function main() {
  const db = createAdminClient()

  const { data: projects, error: pErr } = await db.from('projects').select('id, name, stage, confidential')
  if (pErr) throw new Error(`projects: ${pErr.message}`)
  const { data: opps, error: oErr } = await db.from('opportunities').select('id, name')
  if (oErr) throw new Error(`opportunities: ${oErr.message}`)

  const { data: models, error: mErr } = await db
    .from('deal_economics')
    .select('id, project_id, opportunity_id')
  if (mErr) throw new Error(`deal_economics: ${mErr.message}`)

  // ── What has already been extracted, so a re-run resumes ──────────────────
  //
  // ⚠ WITHOUT THIS A RESTART DUPLICATES EVERY FINISHED RECORD'S PROPOSALS.
  // The pass is ~9 hours over 629 documents and runs unattended, so it WILL be
  // interrupted at some point — a deploy, a reboot, an OOM. §12: store what
  // the pass needs to resume. A record with proposals already staged is done;
  // `--redo` is the deliberate override.
  const { data: staged, error: sErr } = await db
    .from('economics_input_proposals')
    .select('economics_id')
  if (sErr) throw new Error(`economics_input_proposals: ${sErr.message}`)
  const extracted = new Set(
    (staged ?? []).map((r) => (r as Row).economics_id).filter((v): v is string => typeof v === 'string')
  )
  const modelIdFor = new Map<string, string>()
  for (const raw of models ?? []) {
    const m = raw as Row
    const parent = (m.project_id ?? m.opportunity_id) as string | null
    if (parent) modelIdFor.set(parent, String(m.id))
  }

  const haveProject = new Set(
    (models ?? []).map((m) => (m as Row).project_id).filter((v): v is string => typeof v === 'string')
  )
  const haveOpp = new Set(
    (models ?? []).map((m) => (m as Row).opportunity_id).filter((v): v is string => typeof v === 'string')
  )

  // Document counts, so the report says which records the extraction can
  // actually learn anything from rather than implying all 30 will yield.
  const { data: docs } = await db.from('documents').select('project_id').is('superseded_at', null)
  const docsByProject = new Map<string, number>()
  for (const raw of docs ?? []) {
    const id = (raw as Row).project_id
    if (typeof id === 'string') docsByProject.set(id, (docsByProject.get(id) ?? 0) + 1)
  }
  const { data: oppDocs } = await db.from('opportunity_documents').select('opportunity_id')
  const docsByOpp = new Map<string, number>()
  for (const raw of oppDocs ?? []) {
    const id = (raw as Row).opportunity_id
    if (typeof id === 'string') docsByOpp.set(id, (docsByOpp.get(id) ?? 0) + 1)
  }

  type Target = { kind: RecordKind; id: string; name: string; docs: number; has: boolean }
  const targets: Target[] = [
    ...(projects ?? []).map((raw) => {
      const p = raw as Row
      return {
        kind: 'project' as RecordKind,
        id: String(p.id),
        name: String(p.name),
        docs: docsByProject.get(String(p.id)) ?? 0,
        has: haveProject.has(String(p.id)),
      }
    }),
    ...(opps ?? []).map((raw) => {
      const o = raw as Row
      return {
        kind: 'opportunity' as RecordKind,
        id: String(o.id),
        name: String(o.name),
        docs: docsByOpp.get(String(o.id)) ?? 0,
        has: haveOpp.has(String(o.id)),
      }
    }),
  ]
    .filter((t) => (ONE ? t.id === ONE : true))
    .sort((a, b) => b.docs - a.docs)

  // Phase one wants the records with no model; phase two wants the ones that
  // HAVE a model and documents to read. Asking for both with one predicate is
  // what made the second phase a no-op.
  const selected = EXTRACT_ONLY
    ? targets.filter((t) => {
        if (!t.has || t.docs === 0) return false
        if (REDO) return true
        const mid = modelIdFor.get(t.id)
        return !(mid && extracted.has(mid))
      })
    : targets.filter((t) => !t.has)
  const todo = selected.slice(0, LIMIT === Infinity ? undefined : LIMIT)

  console.log(
    `${APPLY ? 'APPLY' : 'DRY RUN'}${MODELS_ONLY ? ' (models only)' : ''}${EXTRACT_ONLY ? ' (extract only)' : ''} — ${
      EXTRACT_ONLY
        ? `${todo.length} record(s) with a model and documents to read (${
            targets.filter((t) => {
              const mid = modelIdFor.get(t.id)
              return t.has && t.docs > 0 && mid && extracted.has(mid)
            }).length
          } already extracted, skipped)`
        : `${todo.length} record(s) need a model, ${targets.length - todo.length} already have one`
    }`
  )
  console.log(`  documents available: ${todo.reduce((a, t) => a + t.docs, 0)} across ${todo.filter((t) => t.docs > 0).length} record(s)`)
  console.log(`  ${todo.filter((t) => t.docs === 0).length} record(s) have no documents — they get an empty model and nothing is staged\n`)

  let created = 0
  let proposals = 0
  const discarded: Record<string, number> = {}

  for (const t of todo) {
    if (!APPLY) {
      console.log(
        `  would ${EXTRACT_ONLY ? 'extract' : 'create'}: ${t.kind} ${t.name} (${t.docs} doc${t.docs === 1 ? '' : 's'})`
      )
      continue
    }

    let economicsId: string
    if (EXTRACT_ONLY) {
      const existing = (models ?? []).find((m) =>
        t.kind === 'project' ? (m as Row).project_id === t.id : (m as Row).opportunity_id === t.id
      )
      if (!existing) {
        console.error(`  ! ${t.name}: no model found, skipping`)
        continue
      }
      economicsId = String((existing as Row).id)
      console.log(`  extracting for ${t.kind} ${t.name} (${t.docs} doc${t.docs === 1 ? '' : 's'})`)
    } else {
      try {
        economicsId = await createEconomics(t.kind, t.id, ACTOR)
        created++
      } catch (e) {
        console.error(`  ! ${t.name}: ${e instanceof Error ? e.message : e}`)
        continue
      }
      console.log(`  created model for ${t.kind} ${t.name} (${t.docs} doc${t.docs === 1 ? '' : 's'})`)
    }

    if (MODELS_ONLY || t.docs === 0) continue

    try {
      const r = await extractEconomicsFromDocuments(economicsId, t.kind, t.id, ACTOR, {
        userId: ACTOR.id,
      })
      proposals += r.proposalsCreated
      for (const [k, v] of Object.entries(r.discardedReasons)) discarded[k] = (discarded[k] ?? 0) + v
      console.log(
        `    read ${r.documentsRead}, skipped ${r.documentsSkipped}, staged ${r.proposalsCreated} proposal(s), discarded ${r.figuresDiscarded} figure(s)`
      )
      for (const note of r.notes.slice(0, 3)) console.log(`    note: ${note}`)
    } catch (e) {
      console.error(`    ! extraction failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  if (!APPLY) {
    console.log(`\nnothing written. Re-run with --apply (add --models-only to skip the model calls).`)
    return
  }
  console.log(`\ncreated ${created} model(s), staged ${proposals} proposal(s) for review at /projects/<id>?tab=economics`)
  if (Object.keys(discarded).length > 0) {
    console.log(`figures discarded: ${Object.entries(discarded).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
