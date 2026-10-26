/**
 * DOES THIS PROMPT STILL ANSWER THE SAME WAY WITHOUT THE MODEL'S REASONING?
 *
 * `qwen/qwen3.6-35b-a3b` spends 87-98% of every generation on a reasoning pass
 * this platform discards (measured over the 30 days to 2026-10-26: 55.3
 * GPU-hours, 28.3 of them on six mechanical prompts). LM Studio serves ONE
 * request at a time, so that is the queue a human waiting on Ber AI sits
 * behind. `reasoning_effort: 'none'` removes it — spot-measured at 62.7s to
 * 9.2s on one real obligation extraction, same three obligations found.
 *
 * ⚠ IT ALSO MADE A HARD CLASSIFICATION WRONG in the same spot check. So no
 * prompt may hold `PromptReasoning = 'none'` until this script says its answers
 * survive without it. Nothing here flips anything: it prints evidence.
 *
 * ## Why both arms run NOW, rather than against the logged answer
 *
 * The obvious design is to replay a stored input and diff against the stored
 * answer. That design is wrong here, and the reason is worth keeping: a system
 * prompt is not logged — only the user message is — so the comparison would
 * silently be against whatever revision of the prompt was live weeks ago, and a
 * disagreement could not be told apart from a prompt rewrite. §12 has this
 * exact shape twice (a stale prompt example is a lie the model repeats; a
 * worked example whose figures coincide cannot distinguish two readings).
 *
 * So the stored corpus supplies only the INPUT, and both arms are generated in
 * this run against the same current prompt. The only variable left is the one
 * being measured.
 *
 * ## ⚠ What this sample is biased toward, stated up front
 *
 * `logAiQuery` truncates `query_text` at 2,000 characters, so only the rows
 * UNDER that are faithful inputs — and those are systematically the SHORT ones:
 * roughly half of every task's corpus is truncated. A clean result here
 * licenses reasoning-off for inputs of the length sampled and no further, which
 * is why the length distribution of the sample is printed beside the corpus's
 * own. §12: a script reading a truncated set is worse than none, because it is
 * believed.
 *
 * ## Reading the output
 *
 * AGREEMENT is not correctness. Where the arms differ the pair is printed in
 * full, because only a person can say which answer was better. The one task
 * with a real human verdict behind it — Drive filing, against where a human
 * actually confirmed the document sits — is scored separately and is the
 * strongest evidence here (§12: a producer's gate is measured by the human's
 * dismissal rate, never by its own confidence).
 *
 * Usage:
 *   node --env-file=.env.local --import ./deploy/register.mjs \
 *     scripts/measure-reasoning-off.mts [--n 8] [--task thread-summary]
 *
 * ⚠ Run it in the background and never kill it mid-flight: killing the client
 * does not stop llama-server, which keeps generating and queues everything
 * after it behind a request nobody is reading.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { localChat } from '@/lib/ai/local'
import { JUDGEMENT_TEMPERATURE } from '@/lib/ai/gemini'
import { THREAD_SUMMARY_SYSTEM_PROMPT } from '@/lib/ai/prompts/thread-summary'
import { DRIVE_FILING_SYSTEM_PROMPT } from '@/lib/ai/prompts/drive-filing'
import { INTAKE_PREDECIDE_SYSTEM_PROMPT } from '@/lib/ai/prompts/intake-predecide'
import { COMMITMENT_SYSTEM_PROMPT } from '@/lib/commitments/prompt'
import { CHASE_SYSTEM_PROMPT } from '@/lib/commitments/chase'
import { DOC_SUMMARY_SYSTEM } from '@/lib/ai/document-pipeline'

/** The log truncates here, so a row at or over it is not the real input. */
const LOG_TRUNCATION = 2000

interface Task {
  /** `ai_queries.prompt_version` to draw inputs from. */
  version: string
  system: string
  /** Prose tasks have no structured verdict to compare. */
  jsonMode: boolean
  /**
   * The fields a CONSUMER actually branches on. Agreement is scored on these
   * and nothing else: a summary rephrased is not a changed decision, and
   * scoring it as one would bury the fields that matter.
   */
  decisionFields: string[]
  /** Fields where a length or count difference is worth seeing but not scoring. */
  shapeFields?: string[]
}

const TASKS: Record<string, Task> = {
  'thread-summary': {
    version: 'thread-summary-1.0',
    system: THREAD_SUMMARY_SYSTEM_PROMPT,
    jsonMode: true,
    // `relevance` is the one that decides whether a thread is ever read again,
    // and `deal_name` is the key the clusterer groups on.
    decisionFields: ['relevance', 'deal_name', 'counterparty'],
    shapeFields: ['people', 'key_facts', 'open_items', 'summary'],
  },
  commitments: {
    version: 'commitments-1.0',
    system: COMMITMENT_SYSTEM_PROMPT,
    jsonMode: true,
    // Compared as a SET below, not field by field — the array is the answer.
    decisionFields: ['commitments'],
  },
  'drive-filing': {
    version: 'drive-filing-1.1',
    system: DRIVE_FILING_SYSTEM_PROMPT,
    jsonMode: true,
    decisionFields: ['folder'],
    shapeFields: ['confidence'],
  },
  'intake-predecide': {
    version: 'intake-predecide-2.0',
    system: INTAKE_PREDECIDE_SYSTEM_PROMPT,
    jsonMode: true,
    decisionFields: ['disposition', 'merge_target_name'],
    shapeFields: ['confidence'],
  },
  'doc-summary': {
    version: 'doc-summary-1.0',
    system: DOC_SUMMARY_SYSTEM,
    jsonMode: true,
    // ⚠ NO DECISION FIELD EXISTS. `DocSummary` is `{summary?, confidence?}` and
    // nothing else — the first version of this script scored `doc_type`, which
    // this prompt has never produced, so it compared ∅ against ∅ and would have
    // reported 8/8 agreement having examined nothing. §12: an empty population
    // passes vacuously behind the same tick. The answer here IS the prose, so it
    // is printed for a human the way the chase task is.
    decisionFields: [],
    shapeFields: ['summary', 'confidence'],
  },
  'commitment-chase': {
    version: 'commitment-chase-1.0',
    system: CHASE_SYSTEM_PROMPT,
    jsonMode: false,
    // Prose. There is no verdict to agree on, so this one reports length and
    // latency and leaves the judgement to a reader.
    decisionFields: [],
  },
}

const JSON_SUFFIX =
  '\n\nRespond with valid JSON only — no prose before or after, no markdown code fences.'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback
}

function parse(text: string): unknown {
  let t = text.trim()
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

/** Normalise for comparison: case and surrounding space are not decisions. */
function norm(v: unknown): string {
  if (v === null || v === undefined) return '∅'
  if (typeof v === 'string') return v.trim().toLowerCase()
  return JSON.stringify(v)
}

/**
 * Commitments compare as a set of (side, what) pairs, loosely on `what`.
 *
 * ⚠ Jaccard, never the overlap coefficient — §12: `shared/min` makes a short
 * phrase a perfect subset of every longer one containing it, which would score
 * "send the schedule" and "send the revised schedule by Friday to counsel" as
 * identical and report agreement that is not there.
 */
function commitmentSetScore(a: unknown, b: unknown): { same: number; onlyA: number; onlyB: number } {
  const list = (x: unknown): Array<{ side: string; words: Set<string> }> =>
    (Array.isArray((x as { commitments?: unknown })?.commitments)
      ? (x as { commitments: Array<Record<string, unknown>> }).commitments
      : []
    ).map((c) => ({
      side: String(c.side ?? '?'),
      words: new Set(
        String(c.what ?? '')
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 2)
      ),
    }))
  const A = list(a)
  const B = list(b)
  const used = new Set<number>()
  let same = 0
  for (const x of A) {
    let best = -1
    let bestJ = 0
    B.forEach((y, j) => {
      if (used.has(j) || y.side !== x.side) return
      const inter = [...x.words].filter((w) => y.words.has(w)).length
      const union = new Set([...x.words, ...y.words]).size || 1
      const jac = inter / union
      if (jac > bestJ) {
        bestJ = jac
        best = j
      }
    })
    if (bestJ >= 0.5 && best >= 0) {
      used.add(best)
      same++
    }
  }
  return { same, onlyA: A.length - same, onlyB: B.length - same }
}

interface ArmResult {
  text: string
  seconds: number
  tokensOut: number
  reasoningChars: number
}

async function run(
  system: string,
  user: string,
  jsonMode: boolean,
  off: boolean,
  jsonSchema?: { name: string; schema: Record<string, unknown> }
): Promise<ArmResult> {
  const t0 = Date.now()
  const r = await localChat({
    messages: [
      // The prose ask is dropped when a schema enforces the shape, matching
      // what `callLocalText` does — otherwise this measures a prompt the
      // production path would not send.
      { role: 'system', content: jsonMode && !jsonSchema ? system + JSON_SUFFIX : system },
      { role: 'user', content: user },
    ],
    temperature: jsonMode ? JUDGEMENT_TEMPERATURE : undefined,
    ...(off ? { reasoning: 'none' as const } : {}),
    ...(jsonSchema ? { jsonSchema } : {}),
  })
  return {
    text: r.text,
    seconds: (Date.now() - t0) / 1000,
    tokensOut: r.tokensOut,
    reasoningChars: r.reasoningChars,
  }
}

async function measureTask(name: string, task: Task, n: number): Promise<void> {
  const supabase = createAdminClient()

  // Corpus shape first, so the sample's bias is visible before any result is.
  // ⚠ PAGINATED, because PostgREST truncates at 1000 rows SILENTLY and
  // `.limit()` does not beat it (§12). The first version of this script printed
  // "corpus 1000 calls" for a task holding 1,283 — a script reading a truncated
  // set is worse than none, because it is believed.
  const corpus: Array<{ id: string; query_text: string | null }> = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('ai_queries')
      .select('id, query_text')
      .eq('prompt_version', task.version)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`reading the corpus for ${task.version}: ${error.message}`)
    const page = data ?? []
    corpus.push(...page)
    if (page.length < PAGE) break
  }
  const faithful = corpus.filter((r) => (r.query_text?.length ?? 0) < LOG_TRUNCATION)

  console.log(`\n${'='.repeat(78)}\n${name}  (${task.version})\n${'='.repeat(78)}`)
  if (corpus.length === 0) {
    console.log('  NO LOGGED CALLS — nothing to replay. Not evidence of anything.')
    return
  }
  const lens = corpus.map((r) => r.query_text?.length ?? 0).sort((a, b) => a - b)
  console.log(
    `  corpus ${corpus.length} calls, ${corpus.length - faithful.length} truncated at ` +
      `${LOG_TRUNCATION} chars and therefore unusable as inputs; ` +
      `${faithful.length} faithful. corpus input chars p50=${lens[Math.floor(lens.length / 2)]} ` +
      `p90=${lens[Math.floor(lens.length * 0.9)]} max=${lens[lens.length - 1]}`
  )
  if (faithful.length === 0) {
    console.log('  ⚠ EVERY logged input is truncated. This task cannot be measured from the log.')
    return
  }

  // Spread the sample across the faithful length range rather than taking the
  // newest n, which would cluster on whatever the sweep happened to be reading.
  const sorted = [...faithful].sort(
    (a, b) => (a.query_text?.length ?? 0) - (b.query_text?.length ?? 0)
  )
  const picked = Array.from({ length: Math.min(n, sorted.length) }, (_, i) =>
    sorted[Math.floor((i * (sorted.length - 1)) / Math.max(1, Math.min(n, sorted.length) - 1))]!
  )
  const sLens = picked.map((r) => r.query_text!.length)
  console.log(
    `  sampling ${picked.length}, input chars ${Math.min(...sLens)}-${Math.max(...sLens)}` +
      `  ⚠ biased SHORT: the corpus reaches ${lens[lens.length - 1]}+\n`
  )

  let agree = 0
  let compared = 0
  let onSec = 0
  let offSec = 0
  let onTok = 0
  let offTok = 0
  let offParseFail = 0
  let onParseFail = 0
  /** Pairs where neither arm produced anything to compare. */
  let vacuous = 0

  for (const [i, row] of picked.entries()) {
    const user = row.query_text!
    const on = await run(task.system, user, task.jsonMode, false)
    const off = await run(task.system, user, task.jsonMode, true)
    onSec += on.seconds
    offSec += off.seconds
    onTok += on.tokensOut
    offTok += off.tokensOut

    // The reasoning-off arm must actually have skipped reasoning. If it did
    // not, every number below is measuring the same thing twice.
    if (off.reasoningChars !== 0) {
      console.log(
        `  ⚠⚠ ABORTING ${name}: reasoning_effort:'none' still produced ` +
          `${off.reasoningChars} chars of reasoning. The parameter is not reaching the ` +
          `server, so there is nothing to compare.`
      )
      return
    }

    if (!task.jsonMode) {
      console.log(
        `  [${i + 1}] prose — on ${on.seconds.toFixed(1)}s/${on.text.length}ch, ` +
          `off ${off.seconds.toFixed(1)}s/${off.text.length}ch`
      )
      console.log(`      ON : ${on.text.replace(/\s+/g, ' ').slice(0, 160)}`)
      console.log(`      OFF: ${off.text.replace(/\s+/g, ' ').slice(0, 160)}`)
      continue
    }

    const pOn = parse(on.text)
    const pOff = parse(off.text)
    if (pOn === null) onParseFail++
    if (pOff === null) offParseFail++
    if (pOn === null || pOff === null) {
      console.log(
        `  [${i + 1}] UNPARSEABLE — on=${pOn === null ? 'FAIL' : 'ok'} off=${pOff === null ? 'FAIL' : 'ok'}`
      )
      continue
    }

    compared++
    const o = pOn as Record<string, unknown>
    const f = pOff as Record<string, unknown>

    if (name === 'commitments') {
      const { same, onlyA, onlyB } = commitmentSetScore(o, f)
      // ⚠ TWO EMPTY ANSWERS ARE NOT AGREEMENT. The first version of this script
      // scored `matched 0, only-on 0, only-off 0` as AGREE, so a thread holding
      // no obligations at all counted as evidence that reasoning may be
      // skipped — §12's empty population passing vacuously behind the same
      // tick. A pair where neither arm found anything is reported and left OUT
      // of the denominator.
      if (same === 0 && onlyA === 0 && onlyB === 0) {
        vacuous++
        compared--
        console.log(
          `  [${i + 1}] BOTH EMPTY — no obligations either way, so no evidence` +
            `  (${on.seconds.toFixed(1)}s → ${off.seconds.toFixed(1)}s)`
        )
        continue
      }
      const ok = onlyA === 0 && onlyB === 0
      if (ok) agree++
      console.log(
        `  [${i + 1}] ${ok ? 'AGREE' : 'DIFFER'}  matched ${same}, only-on ${onlyA}, only-off ${onlyB}` +
          `  (${on.seconds.toFixed(1)}s → ${off.seconds.toFixed(1)}s)`
      )
      if (!ok) {
        console.log(`      ON : ${JSON.stringify(o.commitments)?.slice(0, 420)}`)
        console.log(`      OFF: ${JSON.stringify(f.commitments)?.slice(0, 420)}`)
      }
      continue
    }

    // ⚠ A declared decision field that neither arm produced is not agreement —
    // it is a field name that does not exist, scoring ∅ against ∅. Say so
    // rather than counting it, or this script reports a clean result for a
    // comparison it never made.
    const absent = task.decisionFields.filter((k) => !(k in o) && !(k in f))
    if (absent.length) {
      console.log(
        `  ⚠⚠ ${name} declares decision field(s) ${absent.join(', ')} that NEITHER arm ` +
          'returned. Agreement on them would be vacuous. Fix the task config.'
      )
      return
    }

    if (task.decisionFields.length === 0) {
      console.log(
        `  [${i + 1}] no verdict to compare  (${on.seconds.toFixed(1)}s → ${off.seconds.toFixed(1)}s)`
      )
      console.log(`      ON : ${JSON.stringify(o).replace(/\s+/g, ' ').slice(0, 300)}`)
      console.log(`      OFF: ${JSON.stringify(f).replace(/\s+/g, ' ').slice(0, 300)}`)
      continue
    }

    const diffs = task.decisionFields.filter((k) => norm(o[k]) !== norm(f[k]))
    if (diffs.length === 0) agree++
    console.log(
      `  [${i + 1}] ${diffs.length === 0 ? 'AGREE' : `DIFFER on ${diffs.join(', ')}`}` +
        `  (${on.seconds.toFixed(1)}s → ${off.seconds.toFixed(1)}s)`
    )
    for (const k of diffs) {
      console.log(`      ${k}: ON ${JSON.stringify(o[k])}  |  OFF ${JSON.stringify(f[k])}`)
    }
    for (const k of task.shapeFields ?? []) {
      const a = o[k]
      const b = f[k]
      const size = (v: unknown) =>
        Array.isArray(v) ? `${v.length} items` : typeof v === 'string' ? `${v.length}ch` : String(v)
      if (size(a) !== size(b)) console.log(`      ~ ${k}: ON ${size(a)}  |  OFF ${size(b)}`)
    }
  }

  const k = picked.length || 1
  console.log(
    `\n  ── ${name}: ` +
      (task.jsonMode && task.decisionFields.length
        ? `agreement ${agree}/${compared} on ${task.decisionFields.join('+')}; `
        : 'NO VERDICT FIELD — read the pairs above; ') +
      (vacuous ? `⚠ ${vacuous} pair(s) empty both ways and EXCLUDED; ` : '') +
      `latency ${(onSec / k).toFixed(1)}s → ${(offSec / k).toFixed(1)}s ` +
      `(${(onSec / Math.max(offSec, 0.1)).toFixed(1)}x); ` +
      `completion tokens ${Math.round(onTok / k)} → ${Math.round(offTok / k)}` +
      (onParseFail || offParseFail
        ? `; ⚠ unparseable on=${onParseFail} off=${offParseFail}`
        : '')
  )
  if (task.jsonMode && compared < picked.length) {
    console.log(
      `  ⚠ ${picked.length - compared} of ${picked.length} could not be compared — an ` +
        'agreement rate over a shrunken denominator is not the number it looks like.'
    )
  }
}


/**
 * THE HUMAN-VERDICT ARM — the only scoring here that measures CORRECTNESS.
 *
 * Everything above measures AGREEMENT between two arms, which cannot say which
 * arm was right. Drive filing is the one task where a human later ruled: a
 * document whose `filing_confirmed_at` is set is one somebody looked at and
 * said "it is right where it is", and `drive_folder_path` says where that was.
 * §12: a producer's gate is measured by the human's dismissal rate, never by
 * its own confidence.
 *
 * The logged input carries `DOCUMENT FILE NAME:`, so the row joins back to the
 * document without reconstructing anything — the candidate list in the message
 * is the one the model actually saw.
 *
 * ⚠ A FILE NAME MATCHING TWO DOCUMENTS IS SKIPPED, NOT GUESSED. §12: on an
 * import a false match skips a row rather than merging two, which is invisible.
 * Every skip is counted and printed with its reason, because a score over a
 * silently shrunken population is the number this script exists not to produce.
 */
async function measureAgainstHumanFilings(n: number): Promise<void> {
  const supabase = createAdminClient()
  console.log(`\n${'='.repeat(78)}\nHUMAN VERDICT — drive filing vs. where a human confirmed the document sits\n${'='.repeat(78)}`)

  const rows: Array<{ query_text: string | null; prompt_version: string | null }> = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('ai_queries')
      .select('query_text, prompt_version')
      .like('prompt_version', 'drive-filing%')
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) throw new Error(`reading drive-filing calls: ${error.message}`)
    const page = data ?? []
    rows.push(...page)
    if (page.length < 1000) break
  }

  const { data: docs, error: docErr } = await supabase
    .from('documents')
    .select('file_name, drive_folder_path, filing_confirmed_at')
    .not('drive_folder_path', 'is', null)
    .not('filing_confirmed_at', 'is', null)
    .is('superseded_at', null)
  if (docErr) throw new Error(`reading confirmed filings: ${docErr.message}`)

  // Count every name first, so an ambiguous one can be refused rather than
  // resolved to whichever row came back first.
  const byName = new Map<string, Array<{ path: string }>>()
  for (const d of docs ?? []) {
    if (!d.file_name || !d.drive_folder_path) continue
    const list = byName.get(d.file_name) ?? []
    list.push({ path: d.drive_folder_path })
    byName.set(d.file_name, list)
  }

  let ambiguous = 0
  let unmatchedTruth = 0
  const cases: Array<{ message: string; truth: string; file: string; candidates: string[] }> = []
  const seen = new Set<string>()

  for (const r of rows) {
    const msg = r.query_text
    if (!msg) continue
    const file = /DOCUMENT FILE NAME: ([^\n]+)/.exec(msg)?.[1]?.trim()
    if (!file || seen.has(file)) continue
    const hits = byName.get(file)
    if (!hits) continue
    if (hits.length > 1) {
      ambiguous++
      continue
    }
    // Candidates exactly as the model saw them.
    const candidates = [...msg.matchAll(/^- (.+)$/gm)].map((m) => m[1]!.trim())
    const path = hits[0]!.path.replace(/\s+\//g, '/').replace(/\/\s+/g, '/')
    // The truth is the candidate the document's own path ends with. Longest
    // first, so "Diligence/Environmental" wins over "Diligence".
    const truth = [...candidates]
      .sort((a, b) => b.length - a.length)
      .find((c) => path === c || path.endsWith(`/${c}`))
    if (!truth) {
      unmatchedTruth++
      continue
    }
    seen.add(file)
    cases.push({ message: msg, truth, file, candidates })
  }

  console.log(
    `  ${rows.length} logged filing calls; ${cases.length} join to a UNIQUE human-confirmed ` +
      `document whose folder is one of the candidates it was shown.\n` +
      `  skipped: ${ambiguous} ambiguous file name(s), ${unmatchedTruth} filed outside the candidate list.`
  )
  if (cases.length === 0) {
    console.log('  ⚠ NOTHING TO SCORE — not evidence that either arm is correct.')
    return
  }

  const picked = cases.slice(0, n)
  let onRight = 0
  let offRight = 0
  let onConf = 0
  let offConf = 0
  let enumRight = 0
  /** Answers outside the candidate list — what `coerce` discards to _Unsorted. */
  let offInvalid = 0
  let enumInvalid = 0

  for (const [i, c] of picked.entries()) {
    const on = await run(DRIVE_FILING_SYSTEM_PROMPT, c.message, true, false)
    const off = await run(DRIVE_FILING_SYSTEM_PROMPT, c.message, true, true)
    // THIRD ARM: reasoning off, with the candidate list as a JSON Schema enum.
    // The measured failure mode of the reasoning-off arm is TIDYING — it
    // "corrected" the folder `Dueschesne County Rail Corridor` to the correct
    // English spelling, which is not a candidate, so `coerce` rejects it and the
    // document goes to _Unsorted. The prompt already forbids that in prose
    // ("copied EXACTLY… do not reword, re-case, pluralise, or tidy it"); an enum
    // makes it impossible at the sampler instead of asking.
    const enumArm = await run(DRIVE_FILING_SYSTEM_PROMPT, c.message, true, true, {
      name: 'drive_filing',
      schema: {
        type: 'object',
        properties: {
          folder: { type: ['string', 'null'], enum: [...c.candidates, null] },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['folder', 'confidence', 'reason'],
        additionalProperties: false,
      },
    })
    const pOn = parse(on.text) as Record<string, unknown> | null
    const pOff = parse(off.text) as Record<string, unknown> | null
    const pEnum = parse(enumArm.text) as Record<string, unknown> | null
    const okOn = norm(pOn?.folder) === norm(c.truth)
    const okOff = norm(pOff?.folder) === norm(c.truth)
    const okEnum = norm(pEnum?.folder) === norm(c.truth)
    if (okOn) onRight++
    if (okOff) offRight++
    if (okEnum) enumRight++
    onConf += Number(pOn?.confidence) || 0
    offConf += Number(pOff?.confidence) || 0
    // An answer outside the candidate list is what `coerce` throws away, so
    // count it: it is the difference between a wrong filing and an _Unsorted one.
    if (pOff?.folder && !c.candidates.includes(String(pOff.folder))) offInvalid++
    if (pEnum?.folder && !c.candidates.includes(String(pEnum.folder))) enumInvalid++
    console.log(
      `  [${i + 1}] truth "${c.truth}" — ON ${okOn ? '✓' : `✗ ${JSON.stringify(pOn?.folder)}`}` +
        `  OFF ${okOff ? '✓' : `✗ ${JSON.stringify(pOff?.folder)}`}` +
        `  OFF+enum ${okEnum ? '✓' : `✗ ${JSON.stringify(pEnum?.folder)}`}` +
        `  conf ${Number(pOn?.confidence) || 0} / ${Number(pOff?.confidence) || 0}` +
        `  (${on.seconds.toFixed(1)}s → ${off.seconds.toFixed(1)}s → ${enumArm.seconds.toFixed(1)}s)`
    )
    if (!okOn || !okOff || !okEnum) console.log(`      ${c.file}`)
  }

  const k = picked.length
  console.log(
    `\n  ── HUMAN VERDICT over ${k}: reasoning ON correct ${onRight}/${k}, ` +
      `reasoning OFF correct ${offRight}/${k}, ` +
      `OFF+enum correct ${enumRight}/${k}; ` +
      `answers outside the candidate list (→ _Unsorted): OFF ${offInvalid}, OFF+enum ${enumInvalid}; ` +
      `mean confidence ${(onConf / k).toFixed(2)} vs ${(offConf / k).toFixed(2)}` +
      (offConf > onConf && offRight < onRight
        ? '  ⚠ OFF is MORE confident and LESS correct — the confidence gate ' +
          '(FILING_CONFIDENCE) is what sends a doubtful document to _Unsorted, so ' +
          'overconfidence files a wrong answer instead of parking it.'
        : '')
  )
}

const n = Number(arg('n', '8'))
const only = arg('task', '')
// `--human` on its own runs ONLY the correctness arm; add `--task` to also replay one.
const names = only ? [only] : process.argv.includes('--human') ? [] : Object.keys(TASKS)

console.log(
  `Reasoning-off measurement — ${new Date().toISOString()}\n` +
    `${names.length} task(s), n=${n} each, two arms per input, serial ` +
    '(LM Studio answers one request at a time).'
)

if (process.argv.includes('--human')) {
  await measureAgainstHumanFilings(n)
}

for (const name of names) {
  const task = TASKS[name]
  if (!task) {
    console.log(`\nunknown task: ${name}. Known: ${Object.keys(TASKS).join(', ')}`)
    continue
  }
  await measureTask(name, task, n)
}

console.log(
  '\nNothing was changed. A task may hold PromptReasoning = \'none\' only on the ' +
    'strength of the lines above, and only for inputs of the length sampled.'
)
