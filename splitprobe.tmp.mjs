import { callGemini } from '@/lib/ai/gemini'
import { LEAD_TRIAGE_SYSTEM_PROMPT, LEAD_TRIAGE_PROMPT_VERSION } from '@/lib/ai/prompts/lead-triage'
import { sweepDb } from '@/lib/email-sweep/db'
const db = sweepDb()
const { data: leads } = await db.from('leads').select('thread_id').neq('status','spam').not('thread_id','is',null)
const ids = [...new Set((leads??[]).map(l=>l.thread_id))]
const rows=[]
for (let i=0;i<ids.length;i+=100){
  const { data } = await db.from('email_threads').select('id,subject,raw_markdown').in('id', ids.slice(i,i+100))
  rows.push(...(data??[]))
}
const ENUM=/(^|\n)\s*(\d[\).]|[-*•]\s)/g
const MULTI=/\b(a few|several|couple of|multiple|some)\s+(projects?|deals?|opportunit|jobs?|sites?)|\b(another|second|third)\s+(project|deal|one|site)|\bprojects?\s+(for you|we have|i have)|\bhere are\b/i
const cands = rows.filter(r=>{const t=r.raw_markdown??'';return (t.match(ENUM)??[]).length>=3||MULTI.test(t)})
console.log(`probing ${cands.length} candidates (read-only, nothing is written)\n`)
let split=0
for (const r of cands) {
  try {
    const { data } = await callGemini({ task:'lead-triage', systemPrompt:LEAD_TRIAGE_SYSTEM_PROMPT,
      userMessage:(r.raw_markdown??'').slice(0,40000), userId:'00000000-0000-0000-0000-000000000000',
      promptVersion:LEAD_TRIAGE_PROMPT_VERSION, maxTokens:4096 })
    const n = Array.isArray(data?.leads) ? data.leads.filter(l=>l.is_lead).length : 1
    if (n>1){ split++; console.log(`  SPLIT ${n}  ${(r.subject??'').slice(0,56)}`); for(const l of data.leads.filter(x=>x.is_lead)) console.log(`         └ ${l.route.padEnd(12)} ${String(l.title).slice(0,52)}`) }
    else console.log(`  1       ${(r.subject??'').slice(0,56)}`)
  } catch(e){ console.log(`  ERR     ${(r.subject??'').slice(0,50)} ${e.message.slice(0,40)}`) }
}
console.log(`\n${split} of ${cands.length} candidates genuinely describe several opportunities`)
