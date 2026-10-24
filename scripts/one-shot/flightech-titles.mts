/**
 * Title + employer for each Flightech delegation participant, read out of the
 * biography the document already carries.
 *
 * No web research. The evidence is in hand — their own organiser wrote a
 * paragraph about each of them — and asking the open web about 233 strangers
 * would be slower, rate-limited (the Gemini key is free tier, 20/day) and less
 * reliable than the text we were handed.
 *
 * BATCHED, because 233 serial extraction calls is hours of LM Studio time for a
 * job whose unit of work is two short strings. Batching is the thing that can
 * silently mis-align, so each bio carries an explicit index and the model must
 * echo back BOTH the index and the name; a row whose name does not match the one
 * we sent is discarded rather than stored against the wrong person (§12 — a
 * batch that mis-aligns silently is worse than one that fails).
 *
 * Resumable: the answers are written after every batch, keyed by name, so a
 * re-run reads only what is missing. LM Studio serves one request at a time, so
 * there is nothing to gain from overlapping them.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *     --env-file=.env.local scripts/one-shot/flightech-titles.mts
 *
 * Env: ROSTER_DIR (holds records.json, receives titles.json), BATCH, LIMIT.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { localChat, stripThink } from '@/lib/ai/local'

interface Rec { name: string; bio: string; delegation: string }
interface Read { title: string | null; company: string | null }

const DIR = process.env.ROSTER_DIR
if (!DIR) throw new Error('ROSTER_DIR is required')
const OUT = `${DIR}/titles.json`

const recs: Rec[] = JSON.parse(readFileSync(`${DIR}/records.json`, 'utf-8'))
const done: Record<string, Read> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : {}

const BATCH = Number(process.env.BATCH) || 8
const LIMIT = Number(process.env.LIMIT) || recs.length

const SYSTEM = `You read short professional biographies and return each person's CURRENT job title and CURRENT employer.

Rules:
- Use ONLY the biography given. Never guess and never add anything not written in it.
- "Current" means the role the biography presents in the present tense. Ignore earlier roles.
- title: the role alone — "Chief Revenue Officer", "Founder", "Deputy Commissioner of International Trade". Never put the company in it.
- company: the organisation alone — "MixMode", "Georgia Department of Economic Development". Never put the role in it.
- If the biography does not state one of them, return null for that field. A null is a correct answer; an invented value is not.
- Return ONLY a JSON array, with no prose and no code fence:
[{"i":<index>,"name":"<the name exactly as given>","title":<string|null>,"company":<string|null>}]`

/** A model that answers "null", "N/A" or a whole sentence has not answered. */
function clean(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim().replace(/^["']|["']$/g, '') : ''
  if (!s || s.length > 160) return null
  if (/^(null|none|n\/?a|unknown|not stated|not specified)$/i.test(s)) return null
  return s
}

const pending = recs.map((r, i) => ({ ...r, i })).filter((r) => !(r.name in done)).slice(0, LIMIT)
console.log(`${recs.length} records · ${Object.keys(done).length} already read · ${pending.length} to do`)

let ok = 0
const unmatched: string[] = []

for (let s = 0; s < pending.length; s += BATCH) {
  const batch = pending.slice(s, s + BATCH)
  const user = batch.map((r) => `[${r.i}] ${r.name}\n${r.bio.slice(0, 1400)}`).join('\n\n---\n\n')
  const t0 = Date.now()

  let parsed: Array<{ i?: unknown; name?: unknown; title?: unknown; company?: unknown }> = []
  try {
    const res = await localChat({
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      temperature: 0.1,
    })
    const text = stripThink(res.text).replace(/```(?:json)?/g, '').trim()
    const m = text.match(/\[[\s\S]*\]/)
    const val = JSON.parse(m ? m[0] : text)
    parsed = Array.isArray(val) ? val : []
  } catch (err) {
    console.error(`  batch at ${s}: ${err instanceof Error ? err.message : String(err)}`)
    continue
  }

  const byIndex = new Map(parsed.map((p) => [Number(p.i), p]))
  for (const r of batch) {
    const p = byIndex.get(r.i)
    if (!p || String(p.name ?? '').trim() !== r.name) { unmatched.push(r.name); continue }
    done[r.name] = { title: clean(p.title), company: clean(p.company) }
    ok++
  }
  writeFileSync(OUT, JSON.stringify(done, null, 1))
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`  ${Math.min(s + BATCH, pending.length)}/${pending.length}  ${secs}s  read=${ok} unmatched=${unmatched.length}`)
}

console.log(`\nread ${ok} · unmatched ${unmatched.length} · stored ${Object.keys(done).length}/${recs.length}`)
if (unmatched.length) console.log('unmatched:', unmatched.slice(0, 20).join(', '))
