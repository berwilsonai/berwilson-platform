'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, CheckCircle2, AlertTriangle, Loader2, X, Building2, ChevronRight, ExternalLink, Users, Layers } from 'lucide-react'
import FitAssessmentCard from '@/components/proposals/FitAssessmentCard'
import { createClient } from '@/lib/supabase/client'

type Step = 'upload' | 'review' | 'parties' | 'confirm' | 'done'

interface ExtractedProject {
  name: string | null
  description: string | null
  sector: string | null
  stage: string | null
  estimated_value: number | null
  contract_type: string | null
  delivery_method: string | null
  location: string | null
  client_entity: string | null
  solicitation_number: string | null
  award_date: string | null
  ntp_date: string | null
  substantial_completion_date: string | null
  scope_of_work: string | null
  key_facts?: string[]
  confidence: number
}

interface DeveloperCompany {
  name: string
  description: string | null
  location: string | null
  website: string | null
}

interface Extraction {
  document_type: string
  intake_summary: string
  is_master_plan?: boolean
  master_plan_name?: string | null
  developer_company: DeveloperCompany | null
  projects: ExtractedProject[]
  parties: Array<{ name: string; company: string | null; role: string; email: string | null; phone: string | null; is_organization: boolean }>
  entities: Array<{ name: string; entity_type: string; relationship: string; jurisdiction: string | null }>
  risks: Array<{ text: string; severity: string }>
  compliance_requirements: string[]
  confidence: number
}

interface PartyMatch {
  extracted_index: number
  extracted_name: string
  matched_party_id: string | null
  matched_party_name: string | null
  match_type: 'exact_email' | 'exact_name' | 'fuzzy_name' | 'none'
  confidence: number
}

interface FitAssessment {
  recommendation: 'pursue' | 'consider' | 'pass'
  fit_score: number
  summary: string
  strengths: string[]
  concerns: string[]
  gaps: string[]
  key_questions: string[]
  profile_incomplete: boolean
}

interface UploadedFile { temp_path: string; file_name: string; file_size_bytes: number; mime_type: string; is_primary: boolean }

interface MatchCandidate {
  project_id: string
  project_name: string
  score: number
  match_reasons: string[]
  extracted_project_index: number
}

interface DoneResult {
  created_projects: Array<{ id: string; name: string }>
  attached_projects: Array<{ id: string; name: string }>
  developer_entity_id: string | null
  documents_created: number
  parties_created: number
  parties_linked: number
  entities_created: number
}

const SECTORS = ['government', 'infrastructure', 'real_estate', 'prefab', 'institutional']
const STAGES = ['pursuit', 'capture', 'bid', 'award', 'mobilization', 'execution', 'closeout']

const DOC_TYPE_LABELS: Record<string, string> = {
  single_project_proposal: 'Single Project Proposal',
  developer_portfolio: 'Developer Portfolio Deck',
  master_plan: 'Master Plan / Multi-Phase Development',
  plans_drawings: 'Plans / Drawings',
  market_research: 'Market Research',
  investment_pitch: 'Investment Pitch',
  other: 'Document',
}

interface WizardProps {
  availableParents?: Array<{ id: string; name: string }>
}

export default function ProposalIntakeWizard({ availableParents: initialParents }: WizardProps = {}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('upload')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [files, setFiles] = useState<File[]>([])
  const [primaryIndex, setPrimaryIndex] = useState(0)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [extraction, setExtraction] = useState<Extraction | null>(null)
  const [partyMatches, setPartyMatches] = useState<PartyMatch[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [matchCandidates, setMatchCandidates] = useState<MatchCandidate[]>([])
  const [fitAssessment, setFitAssessment] = useState<FitAssessment | null>(null)
  const [availableParents, setAvailableParents] = useState<Array<{ id: string; name: string }>>([])

  // User selections
  const [selectedProjectIndices, setSelectedProjectIndices] = useState<number[]>([])
  const [editedProjects, setEditedProjects] = useState<Record<number, Partial<ExtractedProject>>>({})
  const [createDeveloperVendor, setCreateDeveloperVendor] = useState(true)
  const [parentProjectId, setParentProjectId] = useState<string>('')
  // Per-project: attach to existing or create new
  const [projectAttachments, setProjectAttachments] = useState<Record<number, string | null>>({})
  const [partyActions, setPartyActions] = useState<Array<{ extracted_index: number; action: string; existing_party_id?: string; role?: string }>>([])

  const [doneResult, setDoneResult] = useState<DoneResult | null>(null)

  // Set initial parents if provided, otherwise fetch on mount
  useEffect(() => {
    if (initialParents?.length) {
      setAvailableParents(initialParents)
    } else {
      fetch('/api/projects/parents')
        .then(r => r.ok ? r.json() : [])
        .then(data => setAvailableParents(Array.isArray(data) ? data : []))
        .catch(() => {})
    }
  }, [initialParents])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)])
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!)])
  }, [])

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
    if (primaryIndex === index) setPrimaryIndex(0)
    else if (primaryIndex > index) setPrimaryIndex((p) => p - 1)
  }

  // Upload a single file using 3MB chunks (for files that exceed Supabase's direct upload limit)
  const uploadChunked = async (file: File): Promise<{ chunk_session: string; total_chunks: number }> => {
    const CHUNK_SIZE = 3 * 1024 * 1024 // 3MB — safely under Vercel's 4.5MB body limit
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const chunkBlob = file.slice(start, end)

      const form = new FormData()
      form.append('chunk', chunkBlob, `chunk_${i}`)
      form.append('session_id', sessionId)
      form.append('chunk_index', String(i))
      form.append('total_chunks', String(totalChunks))
      form.append('file_name', file.name)
      form.append('mime_type', file.type || 'application/octet-stream')

      const res = await fetch('/api/proposals/upload-chunk', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Chunk ${i + 1}/${totalChunks} failed`)
      }
    }

    return { chunk_session: sessionId, total_chunks: totalChunks }
  }

  const handleAnalyze = async () => {
    if (!files.length) return
    setLoading(true)
    setError(null)

    // Safety cap: 200MB per file to prevent runaway Gemini token costs
    const MAX_FILE_BYTES = 200 * 1024 * 1024
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        setError(`${file.name} is ${Math.round(file.size / 1024 / 1024)}MB — max is 200MB per file. Split large drawing sets into sections.`)
        setLoading(false)
        return
      }
    }

    const supabase = createClient()

    // For large files (primary file only), use chunked upload
    // For all other files, try direct Supabase upload
    const primaryFile = files[primaryIndex] || files[0]
    const SUPABASE_LIMIT = 48 * 1024 * 1024 // 48MB — just under the 50MB free tier cap

    let intakeBody: Record<string, unknown>

    if (primaryFile.size > SUPABASE_LIMIT) {
      // Large primary file: use chunked upload (auto-splits into 3MB pieces)
      try {
        const { chunk_session, total_chunks } = await uploadChunked(primaryFile)
        intakeBody = {
          chunk_session,
          total_chunks,
          file_name: primaryFile.name,
          mime_type: primaryFile.type || 'application/octet-stream',
          file_size_bytes: primaryFile.size,
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed')
        setLoading(false)
        return
      }
    } else {
      // Small files: direct Supabase upload
      const storedFiles: Array<{ storage_path: string; file_name: string; file_size_bytes: number; mime_type: string }> = []

      for (const file of files) {
        const timestamp = Date.now()
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const storagePath = `proposals/pending/${timestamp}_${safeName}`

        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(storagePath, file, {
            contentType: file.type || 'application/octet-stream',
            cacheControl: '3600',
            upsert: false,
          })

        if (uploadError) {
          setError(`Failed to upload ${file.name}: ${uploadError.message}`)
          setLoading(false)
          return
        }

        storedFiles.push({
          storage_path: storagePath,
          file_name: file.name,
          file_size_bytes: file.size,
          mime_type: file.type || 'application/octet-stream',
        })
      }

      intakeBody = { files: storedFiles, primary_file_index: primaryIndex }
    }

    // Call intake API with file references (tiny JSON body)
    let res: Response
    try {
      res = await fetch('/api/proposals/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(intakeBody),
      })
    } catch {
      setError('Could not reach the server — check your connection and try again.')
      setLoading(false)
      return
    }

    let data: Record<string, unknown>
    try {
      data = await res.json()
    } catch {
      setError(res.status >= 500 ? 'The server timed out — try again in a moment.' : `Server error (${res.status}) — please try again.`)
      setLoading(false)
      return
    }

    try {
      if (!res.ok) { setError((data.error as string) || 'Extraction failed'); setLoading(false); return }

      setSessionId(data.session_id as string)
      setExtraction(data.extraction as Extraction)
      setPartyMatches((data.party_matches as PartyMatch[]) || [])
      setUploadedFiles((data.uploaded_files as UploadedFile[]) || [])
      setMatchCandidates((data.match_candidates as MatchCandidate[]) || [])
      setFitAssessment((data.fit_assessment as FitAssessment | null) ?? null)

      // Default: select all projects
      setSelectedProjectIndices(((data.extraction as Extraction).projects || []).map((_: unknown, i: number) => i))

      // Pre-fill attachments for high-confidence matches
      const attachments: Record<number, string | null> = {}
      for (const mc of ((data.match_candidates as MatchCandidate[]) || [])) {
        if (mc.score >= 0.7) {
          attachments[mc.extracted_project_index] = mc.project_id
        }
      }
      setProjectAttachments(attachments)

      // Init party actions
      setPartyActions(((data.party_matches as PartyMatch[]) || []).map((pm: PartyMatch) => ({
        extracted_index: pm.extracted_index,
        action: pm.match_type === 'none' ? 'create_new' : 'link_existing',
        existing_party_id: pm.matched_party_id || undefined,
        role: (data.extraction as Extraction).parties[pm.extracted_index]?.role || 'other',
      })))

      setStep('review')
    } catch (e) { setError('Unexpected error: ' + (e instanceof Error ? e.message : String(e))) }
    finally { setLoading(false) }
  }

  const getProject = (index: number): ExtractedProject => {
    const base = extraction!.projects[index]
    const edits = editedProjects[index] || {}
    return { ...base, ...edits }
  }

  const updateProject = (index: number, field: string, value: unknown) => {
    setEditedProjects((prev) => ({ ...prev, [index]: { ...prev[index], [field]: value } }))
  }

  const toggleProject = (index: number) => {
    setSelectedProjectIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    )
  }

  const handleConfirm = async () => {
    if (!sessionId || !extraction) return
    setLoading(true)
    setError(null)

    const projectsToCreate = selectedProjectIndices.map((i) => {
      const p = getProject(i)
      const attachId = projectAttachments[i] || null
      return {
        name: p.name || `Project ${i + 1}`,
        sector: p.sector || 'real_estate',
        stage: p.stage || 'pursuit',
        description: p.description || null,
        estimated_value: p.estimated_value || null,
        contract_type: p.contract_type || null,
        delivery_method: p.delivery_method || null,
        location: p.location || null,
        client_entity: p.client_entity || null,
        solicitation_number: p.solicitation_number || null,
        award_date: p.award_date || null,
        ntp_date: p.ntp_date || null,
        substantial_completion_date: p.substantial_completion_date || null,
        parent_project_id: parentProjectId || null,
        attach_to_existing_id: attachId,
      }
    })

    let res: Response
    try {
      res = await fetch('/api/proposals/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          projects_to_create: projectsToCreate,
          create_developer_contact: createDeveloperVendor,
          party_actions: partyActions,
          entity_actions: (extraction.entities || []).map((_, i) => ({ extracted_index: i, action: 'create_new' })),
        }),
      })
    } catch {
      setError('Could not reach the server — check your connection and try again.')
      setLoading(false)
      return
    }

    let data: Record<string, unknown>
    try {
      data = await res.json()
    } catch {
      setError(res.status >= 500 ? 'The server timed out or crashed — please try again.' : `Server error (${res.status}) — please try again.`)
      setLoading(false)
      return
    }

    if (!res.ok) { setError((data.error as string) || 'Confirmation failed'); setLoading(false); return }
    setDoneResult(data as unknown as DoneResult)
    setStep('done')
    setLoading(false)
  }

  // --- STEP: UPLOAD ---
  if (step === 'upload') {
    return (
      <div className="space-y-6">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => document.getElementById('file-input')?.click()}
          className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:border-primary/50 transition-colors cursor-pointer"
        >
          <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-4" />
          <p className="text-lg font-medium">Drop documents here</p>
          <p className="text-sm text-muted-foreground mt-1">Proposals, plans, pitch decks, SOWs — any format. Multiple files supported.</p>
          <input id="file-input" type="file" multiple accept=".pdf,.doc,.docx,.txt,.md,.csv,.html" className="hidden" onChange={handleFileSelect} />
        </div>

        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-md border border-border bg-card">
                <FileText size={16} className="text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm truncate">{f.name}</span>
                <span className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                {files.length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); setPrimaryIndex(i) }}
                    className={`text-xs px-2 py-0.5 rounded ${i === primaryIndex ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                    {i === primaryIndex ? 'Primary' : 'Set Primary'}
                  </button>
                )}
                <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive"><X size={14} /></button>
              </div>
            ))}
          </div>
        )}

        {error && <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}

        <button onClick={handleAnalyze} disabled={!files.length || loading}
          className="w-full py-3 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <><Loader2 size={16} className="animate-spin" /> Analyzing... this may take 20-30 seconds</> : 'Analyze Document'}
        </button>
      </div>
    )
  }

  // --- STEP: REVIEW ---
  if (step === 'review' && extraction) {
    return (
      <div className="space-y-6">

        {/* AI Intake Summary Banner */}
        <div className="p-4 rounded-lg border border-border bg-muted/30">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={18} className="text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded">
                  {DOC_TYPE_LABELS[extraction.document_type] || extraction.document_type}
                </span>
                <span className="text-xs text-muted-foreground">{uploadedFiles[0]?.file_name}</span>
              </div>
              <p className="text-sm text-foreground">{extraction.intake_summary}</p>
            </div>
          </div>
        </div>

        {/* Fit Assessment — should Ber Wilson pursue this? */}
        {fitAssessment && <FitAssessmentCard fit={fitAssessment} />}

        {/* Master Plan Indicator */}
        {extraction.is_master_plan && extraction.master_plan_name && (
          <div className="p-4 rounded-lg border border-purple-200 bg-purple-50/50 dark:border-purple-900 dark:bg-purple-950/20">
            <div className="flex items-center gap-3">
              <Layers size={18} className="text-purple-600 dark:text-purple-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">Master Plan: {extraction.master_plan_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {extraction.projects.length} sub-project{extraction.projects.length !== 1 ? 's' : ''} detected — these will be grouped under a parent program.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Developer Company Card */}
        {extraction.developer_company && (
          <div className="p-4 rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <Building2 size={18} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{extraction.developer_company.name}</p>
                  {extraction.developer_company.location && <p className="text-xs text-muted-foreground">{extraction.developer_company.location}</p>}
                  {extraction.developer_company.description && <p className="text-xs text-muted-foreground mt-1">{extraction.developer_company.description}</p>}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={createDeveloperVendor} onChange={(e) => setCreateDeveloperVendor(e.target.checked)} />
                Add to vendors
              </label>
            </div>
          </div>
        )}

        {/* Parent Program Picker */}
        {availableParents.length > 0 && (
          <div className="p-4 rounded-lg border border-border bg-card">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Assign to Parent Program <span className="font-normal">(optional)</span>
            </label>
            <select
              value={parentProjectId}
              onChange={(e) => setParentProjectId(e.target.value)}
              className="w-full px-2 py-1.5 rounded border border-input bg-background text-sm"
            >
              <option value="">None (standalone project{extraction.projects.length > 1 ? 's' : ''})</option>
              {availableParents.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Group these under an existing program like a master development or developer pipeline.
            </p>
          </div>
        )}

        {/* Projects List */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">
              {extraction.projects.length === 1 ? 'Project Found' : `${extraction.projects.length} Projects Found`}
            </h2>
            {extraction.projects.length > 1 && (
              <button onClick={() => setSelectedProjectIndices(
                selectedProjectIndices.length === extraction.projects.length ? [] : extraction.projects.map((_, i) => i)
              )} className="text-xs text-primary underline">
                {selectedProjectIndices.length === extraction.projects.length ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>

          <div className="space-y-3">
            {extraction.projects.map((_, i) => {
              const p = getProject(i)
              const selected = selectedProjectIndices.includes(i)
              return (
                <div key={i} className={`rounded-lg border transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-border bg-card opacity-60'}`}>
                  {/* Header row */}
                  <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => toggleProject(i)}>
                    <input type="checkbox" checked={selected} onChange={() => toggleProject(i)} className="shrink-0" onClick={(e) => e.stopPropagation()} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name || `Project ${i + 1}`}</p>
                      <p className="text-xs text-muted-foreground truncate">{p.location}{p.estimated_value ? ` · $${p.estimated_value.toLocaleString()}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {p.sector && <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.sector.replace('_', ' ')}</span>}
                      {p.stage && <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.stage}</span>}
                    </div>
                  </div>

                  {/* Expanded edit fields (only when selected) */}
                  {selected && (
                    <div className="px-3 pb-3 pt-1 border-t border-border/50 grid grid-cols-2 gap-2">
                      <div className="col-span-2">
                        <label className="text-xs text-muted-foreground">Project Name</label>
                        <input type="text" value={p.name || ''} onChange={(e) => updateProject(i, 'name', e.target.value)}
                          className="w-full mt-0.5 px-2 py-1.5 rounded border border-input bg-background text-sm" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Sector</label>
                        <select value={p.sector || ''} onChange={(e) => updateProject(i, 'sector', e.target.value)}
                          className="w-full mt-0.5 px-2 py-1.5 rounded border border-input bg-background text-sm">
                          <option value="">Select...</option>
                          {SECTORS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Stage</label>
                        <select value={p.stage || 'pursuit'} onChange={(e) => updateProject(i, 'stage', e.target.value)}
                          className="w-full mt-0.5 px-2 py-1.5 rounded border border-input bg-background text-sm">
                          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Location</label>
                        <input type="text" value={p.location || ''} onChange={(e) => updateProject(i, 'location', e.target.value)}
                          className="w-full mt-0.5 px-2 py-1.5 rounded border border-input bg-background text-sm" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Est. Value ($)</label>
                        <input type="number" value={p.estimated_value || ''} onChange={(e) => updateProject(i, 'estimated_value', e.target.value ? Number(e.target.value) : null)}
                          className="w-full mt-0.5 px-2 py-1.5 rounded border border-input bg-background text-sm" />
                      </div>
                      {p.description && (
                        <div className="col-span-2">
                          <label className="text-xs text-muted-foreground">Description</label>
                          <textarea rows={2} value={p.description} onChange={(e) => updateProject(i, 'description', e.target.value)}
                            className="w-full mt-0.5 px-2 py-1.5 rounded border border-input bg-background text-sm" />
                        </div>
                      )}
                      {p.key_facts && p.key_facts.length > 0 && (
                        <div className="col-span-2">
                          <p className="text-xs text-muted-foreground mb-1">Key facts</p>
                          <ul className="text-xs text-foreground/80 space-y-0.5">
                            {p.key_facts.map((f, fi) => <li key={fi} className="flex items-start gap-1"><span className="text-muted-foreground mt-0.5">·</span>{f}</li>)}
                          </ul>
                        </div>
                      )}
                      {/* Existing project match */}
                      {(() => {
                        const matches = matchCandidates.filter(mc => mc.extracted_project_index === i && mc.score > 0.3)
                        if (!matches.length) return null
                        const attached = projectAttachments[i]
                        return (
                          <div className="col-span-2 p-2.5 rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
                            <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1.5">Possible existing match</p>
                            {matches.map(mc => (
                              <div key={mc.project_id} className="flex items-center gap-2 text-sm">
                                <input
                                  type="radio"
                                  name={`attach_${i}`}
                                  checked={attached === mc.project_id}
                                  onChange={() => setProjectAttachments(prev => ({ ...prev, [i]: mc.project_id }))}
                                />
                                <span className="flex-1">
                                  <strong>{mc.project_name}</strong>
                                  <span className="text-xs text-muted-foreground ml-1">({Math.round(mc.score * 100)}% match — {mc.match_reasons.join(', ')})</span>
                                </span>
                              </div>
                            ))}
                            <div className="flex items-center gap-2 text-sm mt-1">
                              <input
                                type="radio"
                                name={`attach_${i}`}
                                checked={!attached}
                                onChange={() => setProjectAttachments(prev => ({ ...prev, [i]: null }))}
                              />
                              <span>Create as new project</span>
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Risks */}
        {extraction.risks && extraction.risks.length > 0 && (
          <div className="p-3 rounded-md border border-border bg-card">
            <p className="text-xs font-medium text-muted-foreground mb-2">Risks Identified</p>
            <div className="space-y-1">
              {extraction.risks.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 ${r.severity === 'critical' || r.severity === 'blocker' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400' : r.severity === 'watch' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-900/40 text-gray-600 dark:text-gray-400'}`}>{r.severity}</span>
                  <span className="text-xs">{r.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}

        <div className="flex gap-3 pt-4 border-t border-border">
          <button onClick={() => setStep('upload')} className="px-4 py-2 rounded-md border border-input text-sm hover:bg-muted">Back</button>
          <button onClick={() => setStep('parties')} disabled={selectedProjectIndices.length === 0}
            className="flex-1 py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            Next: Review Contacts <ChevronRight size={14} />
          </button>
        </div>
      </div>
    )
  }

  // --- STEP: PARTIES ---
  if (step === 'parties' && extraction) {
    const orgParties = extraction.parties.filter(p => p.is_organization)
    const individualMatches = partyMatches.filter(pm => !extraction.parties[pm.extracted_index]?.is_organization)

    return (
      <div className="space-y-6">
        <h2 className="text-base font-semibold">Contacts & Companies</h2>
        <p className="text-sm text-muted-foreground">Individuals go to Contacts. Companies go to Vendors & Partners.</p>

        {/* Organizations → Vendors */}
        {orgParties.length > 0 && (
          <div>
            <p className="label-caps text-muted-foreground mb-2">Companies → Vendors & Partners</p>
            <div className="space-y-1.5">
              {orgParties.map((org, i) => (
                <div key={`org-${i}`} className="p-2.5 rounded-md border border-blue-200 bg-blue-50/30 dark:border-blue-900 dark:bg-blue-950/20 flex items-center gap-2">
                  <Building2 size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                  <span className="text-sm font-medium flex-1">{org.name}</span>
                  <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-2 py-0.5 rounded">{org.role}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Individuals → Contacts */}
        <div>
          <p className="label-caps text-muted-foreground mb-2">Individuals → Contacts</p>
          {individualMatches.length === 0 ? (
            <div className="flex items-center gap-2 p-4 rounded-md border border-border text-sm text-muted-foreground">
              <Users size={14} /> No individual contacts were extracted from this document.
            </div>
          ) : (
            <div className="space-y-2">
              {individualMatches.map((pm) => {
                const party = extraction.parties[pm.extracted_index]
                const action = partyActions.find((a) => a.extracted_index === pm.extracted_index)
                return (
                  <div key={pm.extracted_index} className="p-3 rounded-md border border-border flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{pm.extracted_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {party?.company && `${party.company} · `}{party?.role}
                        {party?.email && ` · ${party.email}`}
                      </p>
                    </div>
                    {pm.match_type !== 'none' ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <CheckCircle2 size={14} className="text-green-600 dark:text-green-400" />
                        <span className="text-xs text-green-700 dark:text-green-300">{pm.match_type === 'fuzzy_name' ? '~' : ''}{pm.matched_party_name}</span>
                        <button onClick={() => setPartyActions((prev) => prev.map((a) => a.extracted_index === pm.extracted_index
                          ? { ...a, action: a.action === 'link_existing' ? 'create_new' : 'link_existing', existing_party_id: pm.matched_party_id || undefined }
                          : a))} className="text-xs underline text-muted-foreground">
                          {action?.action === 'link_existing' ? 'Create new' : 'Use match'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded shrink-0">New contact</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {extraction.entities && extraction.entities.length > 0 && (
          <div>
            <p className="label-caps text-muted-foreground mb-2">Legal Entities → Vendors</p>
            {extraction.entities.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-sm p-2 rounded border border-border mb-1">
                <span className="font-medium">{e.name}</span>
                <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{e.entity_type}</span>
                <span className="text-xs text-muted-foreground">{e.relationship}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3 pt-4 border-t border-border">
          <button onClick={() => setStep('review')} className="px-4 py-2 rounded-md border border-input text-sm hover:bg-muted">Back</button>
          <button onClick={() => setStep('confirm')} className="flex-1 py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm flex items-center justify-center gap-2">
            Next: Confirm <ChevronRight size={14} />
          </button>
        </div>
      </div>
    )
  }

  // --- STEP: CONFIRM ---
  if (step === 'confirm' && extraction) {
    const newParties = partyActions.filter((a) => a.action === 'create_new').length
    const linkedParties = partyActions.filter((a) => a.action === 'link_existing').length

    return (
      <div className="space-y-6">
        <h2 className="text-base font-semibold">Confirm & Ingest</h2>

        <div className="p-4 rounded-lg border border-border bg-card space-y-3">
          {parentProjectId && (
            <div className="flex items-center gap-2">
              <Layers size={14} className="text-purple-600 dark:text-purple-400 shrink-0" />
              <span className="text-sm">Under program: <strong>{availableParents.find(p => p.id === parentProjectId)?.name}</strong></span>
            </div>
          )}

          {selectedProjectIndices.map((i) => {
            const p = getProject(i)
            const attachId = projectAttachments[i]
            const matchName = attachId ? matchCandidates.find(mc => mc.project_id === attachId)?.project_name : null
            return (
              <div key={i} className="flex items-center gap-2">
                <CheckCircle2 size={14} className={attachId ? 'text-amber-600 dark:text-amber-400 shrink-0' : 'text-green-600 dark:text-green-400 shrink-0'} />
                <span className="text-sm">
                  {attachId
                    ? <>Attach docs to existing: <strong>{matchName}</strong></>
                    : <>Create project: <strong>{p.name}</strong>{p.location ? ` — ${p.location}` : ''}</>
                  }
                </span>
              </div>
            )
          })}

          {createDeveloperVendor && extraction.developer_company && (
            <div className="flex items-center gap-2">
              <Building2 size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="text-sm">Add to vendors: <strong>{extraction.developer_company.name}</strong></span>
            </div>
          )}

          {(newParties > 0 || linkedParties > 0) && (
            <div className="flex items-center gap-2">
              <Users size={14} className="text-muted-foreground shrink-0" />
              <span className="text-sm">
                {linkedParties > 0 && `${linkedParties} contact${linkedParties !== 1 ? 's' : ''} matched`}
                {linkedParties > 0 && newParties > 0 && ', '}
                {newParties > 0 && `${newParties} new contact${newParties !== 1 ? 's' : ''}`}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <FileText size={14} className="text-muted-foreground shrink-0" />
            <span className="text-sm">{uploadedFiles.length} document{uploadedFiles.length !== 1 ? 's' : ''} stored</span>
          </div>
        </div>

        {error && <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}

        <div className="flex gap-3 pt-4 border-t border-border">
          <button onClick={() => setStep('parties')} className="px-4 py-2 rounded-md border border-input text-sm hover:bg-muted">Back</button>
          <button onClick={handleConfirm} disabled={loading}
            className="flex-1 py-3 rounded-md bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={16} className="animate-spin" /> Ingesting...</> : 'Ingest into CRM'}
          </button>
        </div>
      </div>
    )
  }

  // --- STEP: DONE ---
  if (step === 'done' && doneResult && extraction) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center shrink-0">
            <CheckCircle2 size={20} className="text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Ingestion Complete</h2>
            <p className="text-sm text-muted-foreground">{extraction.intake_summary}</p>
          </div>
        </div>

        {/* Summary of what was created */}
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {doneResult.created_projects.map((proj) => (
            <div key={proj.id} className="flex items-center justify-between p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium">Created: {proj.name}</span>
              </div>
              <button onClick={() => router.push(`/projects/${proj.id}`)}
                className="flex items-center gap-1 text-xs text-primary hover:underline">
                Open <ExternalLink size={11} />
              </button>
            </div>
          ))}

          {(doneResult.attached_projects || []).map((proj) => (
            <div key={proj.id} className="flex items-center justify-between p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium">Updated: {proj.name}</span>
              </div>
              <button onClick={() => router.push(`/projects/${proj.id}`)}
                className="flex items-center gap-1 text-xs text-primary hover:underline">
                Open <ExternalLink size={11} />
              </button>
            </div>
          ))}

          {doneResult.developer_entity_id && (
            <div className="flex items-center gap-2 p-3">
              <Building2 size={14} className="text-blue-600 dark:text-blue-400" />
              <span className="text-sm">{extraction.developer_company?.name} added to vendors</span>
            </div>
          )}

          {(doneResult.parties_created > 0 || doneResult.parties_linked > 0) && (
            <div className="flex items-center gap-2 p-3">
              <Users size={14} className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {doneResult.parties_linked > 0 && `${doneResult.parties_linked} contact${doneResult.parties_linked !== 1 ? 's' : ''} linked`}
                {doneResult.parties_linked > 0 && doneResult.parties_created > 0 && ' · '}
                {doneResult.parties_created > 0 && `${doneResult.parties_created} new contact${doneResult.parties_created !== 1 ? 's' : ''} created`}
              </span>
            </div>
          )}

          {doneResult.entities_created > 0 && (
            <div className="flex items-center gap-2 p-3">
              <CheckCircle2 size={14} className="text-purple-600 dark:text-purple-400" />
              <span className="text-sm text-muted-foreground">{doneResult.entities_created} entit{doneResult.entities_created !== 1 ? 'ies' : 'y'} created</span>
            </div>
          )}

          <div className="flex items-center gap-2 p-3">
            <FileText size={14} className="text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{doneResult.documents_created} document{doneResult.documents_created !== 1 ? 's' : ''} stored</span>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => { setStep('upload'); setFiles([]); setExtraction(null); setDoneResult(null); setSelectedProjectIndices([]); setProjectAttachments({}); setParentProjectId(''); }}
            className="flex-1 py-2 rounded-md border border-input text-sm hover:bg-muted">
            Ingest Another Document
          </button>
          {(() => {
            const allProjects = [...doneResult.created_projects, ...(doneResult.attached_projects || [])]
            return allProjects.length === 1 ? (
              <button onClick={() => router.push(`/projects/${allProjects[0].id}`)}
                className="flex-1 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium">
                Open Project
              </button>
            ) : null
          })()}
        </div>
      </div>
    )
  }

  return null
}

// ─── Fit Assessment Card ──────────────────────────────────────────────────────

