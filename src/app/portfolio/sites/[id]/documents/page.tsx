import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { formatDate } from '@/lib/utils/constants'

const DOC_TYPE_BADGE: Record<string, string> = {
  contract: 'bg-blue-50 text-blue-700 ring-blue-200',
  proposal: 'bg-violet-50 text-violet-700 ring-violet-200',
  permit: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  report: 'bg-amber-50 text-amber-700 ring-amber-200',
  drawing: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  correspondence: 'bg-slate-100 text-slate-600 ring-slate-200',
  legal: 'bg-red-50 text-red-600 ring-red-200',
  financial: 'bg-orange-50 text-orange-700 ring-orange-200',
  other: 'bg-slate-50 text-slate-500 ring-slate-200',
}

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const [
    { data: site },
    { data: documents },
  ] = await Promise.all([
    supabase.from('sites').select('id').eq('id', id).single(),
    supabase.from('documents').select('*').eq('site_id', id).order('uploaded_at', { ascending: false }),
  ])

  if (!site) notFound()

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{(documents ?? []).length} document{(documents ?? []).length !== 1 ? 's' : ''}</p>
      </div>

      {(documents ?? []).length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-400">No documents linked to this site yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">File Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Type</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Classification</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-500">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {(documents ?? []).map(doc => (
                <tr key={doc.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900 truncate">{doc.file_name}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    {doc.doc_type ? (
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${DOC_TYPE_BADGE[doc.doc_type] ?? DOC_TYPE_BADGE.other}`}>
                        {doc.doc_type}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{doc.classification ?? '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(doc.uploaded_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
