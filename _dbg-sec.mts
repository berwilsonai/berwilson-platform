import { probeScopeCoverage } from '@/lib/system-health'
try { console.log('scopes:', JSON.stringify(await probeScopeCoverage()).slice(0, 500)) }
catch (e) { console.log('scopes THREW:', e instanceof Error ? e.message : e) }
