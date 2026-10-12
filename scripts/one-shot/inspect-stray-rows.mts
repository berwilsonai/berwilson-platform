/** Read-only: what are the 1000 "stray" rows the task sheet reports? */
import { batchGetValues } from '@/lib/integrations/google-sheets'
import { createAdminClient } from '@/lib/supabase/admin'

const { data } = await createAdminClient().from('task_sheet_state').select('spreadsheet_id').maybeSingle()
const id = (data as { spreadsheet_id: string }).spreadsheet_id
const got = await batchGetValues(id, ['All open'])
const rows = got.get('All open') ?? []
console.log('rows returned for "All open":', rows.length)

const nonEmpty = rows.filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''))
console.log('rows with something in them:', nonEmpty.length)
console.log('\nfirst row:', JSON.stringify(rows[0]?.slice(0, 3)))
console.log('row 50 (past the data):', JSON.stringify(rows[50]))
console.log('row 400:', JSON.stringify(rows[400]))
const onlyDone = rows.filter(
  (r) => r.slice(1).every((c) => c === null || c === undefined || String(c).trim() === '')
       && r[0] !== null && r[0] !== undefined && String(r[0]).trim() !== ''
)
console.log('\nrows whose ONLY content is the Done cell:', onlyDone.length)
