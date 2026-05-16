'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, CheckCircle2, AlertTriangle, Loader2, X } from 'lucide-react'

type Step = 'upload' | 'review' | 'match' | 'parties' | 'confirm'

interface UploadedFile {
  temp_path: string
  file_name: string
  file_size_bytes: number
  mime_type: string
  is_primary: boolean
}

interface PartyMatch {
  extracted_index: number
  extracted_name: string
  matched_party_id: string | null
  matched_party_name: string | null
  match_type: 'exact_email' | 'exact_name' | 'fuzzy_name' | 'none'
  confidence: number
}

interface MatchCandidate {
  project_id: string
  project_name: string
  score: number
  match_reasons: string[]
}

interface Extraction {
  project_name: string | null
  description: string | null
  sector: string | null
  estimated_value: number | null
  contract_type: string | null
  delivery_method: string | null
  location: string | null
  client_entity: string | null
  solicitation_number: string | null
  award_date: string | null
  ntp_date: string | null
  substantial_completion_date: string | null
  proposal_due_date: string | null
  scope_of_work: string | null
  parties: Array<{
    name: string
    company: string | null
    role: string
    email: string | null
    phone: string | null
    is_organization: boolean
  }>
  entities: Array<{
    name: string
    entity_type: string
    relationship: string
    jurisdiction: string | null
  }>
  key_dates: Array<{ label: string; date: string; type: string }>
  risks: Array<{ text: string; severity: string }>
  compliance_requirements: string[]
  bonding_required: boolean | null
  confidence: number
  field_confidences: Record<string, number>
}

const SECTORS = ['government', 'infrastructure', 'real_estate', 'prefab', 'institutional']
const STAGES = ['pursuit', 'capture', 'bid', 'award', 'mobilization', 'execution', 'closeout']

export default function ProposalIntakeWizard() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('upload')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Upload state
  const [files, setFiles] = useState<File[]>([])
  const [primaryIndex, setPrimaryIndex] = useState(0)

  // Extraction results
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [extraction, setExtraction] = useState<Extraction | null>(null)
  const [matchCandidates, setMatchCandidates] = useState<MatchCandidate[]>([])
  const [partyMatches, setPartyMatches] = useState<PartyMatch[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])

  // User decisions
  const [editedFields, setEditedFields] = useState<Record<string, unknown>>({})
  const [matchAction, setMatchAction] = useState<'create_new' | 'link_to_existing' | 'add_to_existing'>('create_new')
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  const [partyActions, setPartyActions] = useState<Array<{ extracted_index: number; action: string; existing_party_id?: string; role?: string }>>([])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const dropped = Array.from(e.dataTransfer.files)
    setFiles((prev) => [...prev, ...dropped])
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files)
      setFiles((prev) => [...prev, ...selected])
    }
  }, [])

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
    if (primaryIndex === index) setPrimaryIndex(0)
    else if (primaryIndex > index) setPrimaryIndex((prev) => prev - 1)
  }

  const handleAnalyze = async () => {
    if (!files.length) return
    setLoading(true)
    setError(null)

    const formData = new FormData()
    files.forEach((f) => formData.append('files', f))
    formData.append('primary_file_index', primaryIndex.toString())

    try {
      const res = await fetch('/api/proposals/intake', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Extraction failed')
        setLoading(false)
        return
      }

      setSessionId(data.session_id)
      setExtraction(data.extraction)
      setMatchCandidates(data.match_candidates || [])
      setPartyMatches(data.party_matches || [])
      setUploadedFiles(data.uploaded_files || [])

      // Initialize edited fields from extraction
      setEditedFields({
        name: data.extraction.project_name || '',
        sector: data.extraction.sector || '',
        stage: 'pursuit',
        description: data.extraction.description || '',
        estimated_value: data.extraction.estimated_value || '',
        contract_type: data.extraction.contract_type || '',
        delivery_method: data.extraction.delivery_method || '',
        location: data.extraction.location || '',
        client_entity: data.extraction.client_entity || '',
        solicitation_number: data.extraction.solicitation_number || '',
        award_date: data.extraction.award_date || '',
        ntp_date: data.extraction.ntp_date || '',
        substantial_completion_date: data.extraction.substantial_completion_date || '',
      })

      // Initialize party actions from matches
      const actions = (data.party_matches || []).map((pm: PartyMatch) => ({
        extracted_index: pm.extracted_index,
        action: pm.match_type === 'none' ? 'create_new' : 'link_existing',
        existing_party_id: pm.matched_party_id || undefined,
        role: data.extraction.parties[pm.extracted_index]?.role || 'other',
      }))
      setPartyActions(actions)

      setStep('review')
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
    if (!sessionId || !extraction) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/proposals/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          action: matchAction,
          existing_project_id: selectedMatchId,
          project_fields: {
            name: editedFields.name || extraction.project_name || 'Untitled Project',
            sector: editedFields.sector || extraction.sector || 'government',
            stage: editedFields.stage || 'pursuit',
            description: editedFields.description || extraction.description || null,
            estimated_value: editedFields.estimated_value ? Number(editedFields.estimated_value) : null,
            contract_type: editedFields.contract_type || null,
            delivery_method: editedFields.delivery_method || null,
            location: editedFields.location || null,
            client_entity: editedFields.client_entity || null,
            solicitation_number: editedFields.solicitation_number || null,
            award_date: editedFields.award_date || null,
            ntp_date: editedFields.ntp_date || null,
            substantial_completion_date: editedFields.substantial_completion_date || null,
          },
          party_actions: partyActions,
          entity_actions: (extraction.entities || []).map((_, i) => ({
            extracted_index: i,
            action: 'create_new',
          })),
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Confirmation failed')
        setLoading(false)
        return
      }

      router.push(`/projects/${data.project_id}`)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoading(false)
    }
  }

  const getConfidenceColor = (field: string) => {
    const conf = extraction?.field_confidences?.[field]
    if (conf === undefined) return ''
    if (conf >= 0.8) return 'border-l-green-500'
    if (conf >= 0.5) return 'border-l-amber-400'
    return 'border-l-red-400'
  }

  // --- RENDER ---

  if (step === 'upload') {
    return (
      <div className="space-y-6">
        {/* Dropzone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:border-primary/50 transition-colors cursor-pointer"
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-4" />
          <p className="text-lg font-medium text-foreground">Drop your proposal here</p>
          <p className="text-sm text-muted-foreground mt-1">PDF, Word, or text files. Multiple files supported.</p>
          <input
            id="file-input"
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.txt,.md,.csv,.html"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Files ({files.length})</p>
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-md border border-border bg-card">
                <FileText size={16} className="text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm truncate">{f.name}</span>
                <span className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                {files.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setPrimaryIndex(i) }}
                    className={`text-xs px-2 py-0.5 rounded ${
                      i === primaryIndex
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {i === primaryIndex ? 'Primary' : 'Set Primary'}
                  </button>
                )}
                <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <button
          onClick={handleAnalyze}
          disabled={!files.length || loading}
          className="w-full py-3 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? <><Loader2 size={16} className="animate-spin" /> Analyzing proposal...</> : 'Analyze Proposal'}
        </button>
      </div>
    )
  }

  if (step === 'review') {
    return (
      <div className="space-y-6">
        {/* Confidence banner */}
        {extraction && extraction.confidence < 0.5 && (
          <div className="p-3 rounded-md bg-amber-500/10 text-amber-700 text-sm flex items-center gap-2">
            <AlertTriangle size={14} />
            Low confidence extraction. This document may not be a standard proposal. Review carefully.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Editable form */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Extracted Project Details</h2>

            <div className={`border-l-4 ${getConfidenceColor('project_name')} pl-3`}>
              <label className="text-xs text-muted-foreground">Project Name</label>
              <input
                type="text"
                value={editedFields.name as string || ''}
                onChange={(e) => setEditedFields({ ...editedFields, name: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className={`border-l-4 ${getConfidenceColor('sector')} pl-3`}>
                <label className="text-xs text-muted-foreground">Sector</label>
                <select
                  value={editedFields.sector as string || ''}
                  onChange={(e) => setEditedFields({ ...editedFields, sector: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                >
                  <option value="">Select...</option>
                  {SECTORS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground">Stage</label>
                <select
                  value={editedFields.stage as string || 'pursuit'}
                  onChange={(e) => setEditedFields({ ...editedFields, stage: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                >
                  {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className={`border-l-4 ${getConfidenceColor('estimated_value')} pl-3`}>
              <label className="text-xs text-muted-foreground">Estimated Value ($)</label>
              <input
                type="number"
                value={editedFields.estimated_value as string || ''}
                onChange={(e) => setEditedFields({ ...editedFields, estimated_value: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className={`border-l-4 ${getConfidenceColor('contract_type')} pl-3`}>
                <label className="text-xs text-muted-foreground">Contract Type</label>
                <input
                  type="text"
                  value={editedFields.contract_type as string || ''}
                  onChange={(e) => setEditedFields({ ...editedFields, contract_type: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                />
              </div>

              <div className={`border-l-4 ${getConfidenceColor('delivery_method')} pl-3`}>
                <label className="text-xs text-muted-foreground">Delivery Method</label>
                <input
                  type="text"
                  value={editedFields.delivery_method as string || ''}
                  onChange={(e) => setEditedFields({ ...editedFields, delivery_method: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                />
              </div>
            </div>

            <div className={`border-l-4 ${getConfidenceColor('location')} pl-3`}>
              <label className="text-xs text-muted-foreground">Location</label>
              <input
                type="text"
                value={editedFields.location as string || ''}
                onChange={(e) => setEditedFields({ ...editedFields, location: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
              />
            </div>

            <div className={`border-l-4 ${getConfidenceColor('client_entity')} pl-3`}>
              <label className="text-xs text-muted-foreground">Client / Owner</label>
              <input
                type="text"
                value={editedFields.client_entity as string || ''}
                onChange={(e) => setEditedFields({ ...editedFields, client_entity: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
              />
            </div>

            <div className={`border-l-4 ${getConfidenceColor('solicitation_number')} pl-3`}>
              <label className="text-xs text-muted-foreground">Solicitation Number</label>
              <input
                type="text"
                value={editedFields.solicitation_number as string || ''}
                onChange={(e) => setEditedFields({ ...editedFields, solicitation_number: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className={`border-l-4 ${getConfidenceColor('award_date')} pl-3`}>
                <label className="text-xs text-muted-foreground">Award Date</label>
                <input
                  type="date"
                  value={editedFields.award_date as string || ''}
                  onChange={(e) => setEditedFields({ ...editedFields, award_date: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                />
              </div>
              <div className={`border-l-4 ${getConfidenceColor('ntp_date')} pl-3`}>
                <label className="text-xs text-muted-foreground">NTP Date</label>
                <input
                  type="date"
                  value={editedFields.ntp_date as string || ''}
                  onChange={(e) => setEditedFields({ ...editedFields, ntp_date: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                />
              </div>
              <div className={`border-l-4 ${getConfidenceColor('substantial_completion_date')} pl-3`}>
                <label className="text-xs text-muted-foreground">Substantial Completion</label>
                <input
                  type="date"
                  value={editedFields.substantial_completion_date as string || ''}
                  onChange={(e) => setEditedFields({ ...editedFields, substantial_completion_date: e.target.value })}
                  className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Description / Scope</label>
              <textarea
                rows={3}
                value={editedFields.description as string || ''}
                onChange={(e) => setEditedFields({ ...editedFields, description: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background text-sm"
              />
            </div>

            {/* Risks */}
            {extraction?.risks && extraction.risks.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground">Identified Risks</label>
                <div className="mt-1 space-y-1">
                  {extraction.risks.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                        r.severity === 'critical' || r.severity === 'blocker' ? 'bg-red-100 text-red-700' :
                        r.severity === 'watch' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                      }`}>{r.severity}</span>
                      <span>{r.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Compliance */}
            {extraction?.compliance_requirements && extraction.compliance_requirements.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground">Compliance Requirements</label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {extraction.compliance_requirements.map((c, i) => (
                    <span key={i} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{c}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: File info + summary */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Source Document</h2>
            <div className="p-4 rounded-md border border-border bg-muted/30">
              {uploadedFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 py-1">
                  <FileText size={14} className="text-muted-foreground" />
                  <span className="text-sm">{f.file_name}</span>
                  {f.is_primary && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">Primary</span>}
                </div>
              ))}
            </div>

            {extraction?.scope_of_work && (
              <div>
                <label className="text-xs text-muted-foreground">Full Scope of Work (from document)</label>
                <p className="mt-1 text-sm text-foreground/80 whitespace-pre-wrap border border-border rounded-md p-3 max-h-48 overflow-y-auto">
                  {extraction.scope_of_work}
                </p>
              </div>
            )}

            {extraction?.key_dates && extraction.key_dates.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground">Key Dates</label>
                <div className="mt-1 space-y-1">
                  {extraction.key_dates.map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-sm border-b border-border/50 py-1">
                      <span>{d.label}</span>
                      <span className="text-muted-foreground">{d.date}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 p-3 rounded-md bg-muted/50 text-xs text-muted-foreground">
              Overall extraction confidence: <span className="font-mono font-semibold">{((extraction?.confidence || 0) * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <div className="flex gap-3 pt-4 border-t border-border">
          <button
            onClick={() => setStep('upload')}
            className="px-4 py-2 rounded-md border border-input text-sm hover:bg-muted"
          >
            Back
          </button>
          <button
            onClick={() => setStep(matchCandidates.length > 0 ? 'match' : 'parties')}
            className="flex-1 py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm"
          >
            {matchCandidates.length > 0 ? 'Next: Check Matches' : 'Next: Review Contacts'}
          </button>
        </div>
      </div>
    )
  }

  if (step === 'match') {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold">Related Projects Found</h2>
        <p className="text-sm text-muted-foreground">
          This proposal may be related to existing projects. Choose how to proceed.
        </p>

        <div className="space-y-3">
          {matchCandidates.map((mc) => (
            <div
              key={mc.project_id}
              className={`p-4 rounded-md border cursor-pointer transition-colors ${
                selectedMatchId === mc.project_id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
              }`}
              onClick={() => setSelectedMatchId(mc.project_id)}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{mc.project_name}</span>
                <span className="text-xs font-mono text-muted-foreground">{(mc.score * 100).toFixed(0)}% match</span>
              </div>
              <div className="mt-1 flex gap-1">
                {mc.match_reasons.map((r) => (
                  <span key={r} className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                    {r.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2 pt-4">
          <label className="text-sm font-medium">What would you like to do?</label>
          <div className="space-y-2">
            <label className="flex items-center gap-3 p-3 rounded-md border border-border cursor-pointer hover:bg-muted/50">
              <input
                type="radio"
                name="matchAction"
                value="create_new"
                checked={matchAction === 'create_new'}
                onChange={() => setMatchAction('create_new')}
              />
              <div>
                <p className="text-sm font-medium">Create as standalone new project</p>
                <p className="text-xs text-muted-foreground">No relation to existing projects</p>
              </div>
            </label>

            {selectedMatchId && (
              <>
                <label className="flex items-center gap-3 p-3 rounded-md border border-border cursor-pointer hover:bg-muted/50">
                  <input
                    type="radio"
                    name="matchAction"
                    value="link_to_existing"
                    checked={matchAction === 'link_to_existing'}
                    onChange={() => setMatchAction('link_to_existing')}
                  />
                  <div>
                    <p className="text-sm font-medium">Create as sub-project of &ldquo;{matchCandidates.find((m) => m.project_id === selectedMatchId)?.project_name}&rdquo;</p>
                    <p className="text-xs text-muted-foreground">New project linked as a child</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 rounded-md border border-border cursor-pointer hover:bg-muted/50">
                  <input
                    type="radio"
                    name="matchAction"
                    value="add_to_existing"
                    checked={matchAction === 'add_to_existing'}
                    onChange={() => setMatchAction('add_to_existing')}
                  />
                  <div>
                    <p className="text-sm font-medium">Just add documents to &ldquo;{matchCandidates.find((m) => m.project_id === selectedMatchId)?.project_name}&rdquo;</p>
                    <p className="text-xs text-muted-foreground">Don&apos;t create a new project — attach files to the existing one</p>
                  </div>
                </label>
              </>
            )}
          </div>
        </div>

        <div className="flex gap-3 pt-4 border-t border-border">
          <button onClick={() => setStep('review')} className="px-4 py-2 rounded-md border border-input text-sm hover:bg-muted">Back</button>
          <button onClick={() => setStep('parties')} className="flex-1 py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm">
            Next: Review Contacts
          </button>
        </div>
      </div>
    )
  }

  if (step === 'parties') {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold">Contacts & Parties</h2>
        <p className="text-sm text-muted-foreground">
          Review extracted contacts. Matched contacts are linked to existing records; new ones will be created.
        </p>

        {partyMatches.length === 0 && extraction?.parties?.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No contacts were extracted from this document.</p>
        )}

        <div className="space-y-2">
          {partyMatches.map((pm) => {
            const party = extraction?.parties[pm.extracted_index]
            const action = partyActions.find((a) => a.extracted_index === pm.extracted_index)
            return (
              <div key={pm.extracted_index} className="p-3 rounded-md border border-border flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium">{pm.extracted_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {party?.company && `${party.company} · `}{party?.role}
                    {party?.email && ` · ${party.email}`}
                  </p>
                </div>

                {pm.match_type !== 'none' ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-green-600" />
                    <span className="text-xs text-green-700">
                      {pm.match_type === 'fuzzy_name' ? 'Possible: ' : 'Matched: '}
                      {pm.matched_party_name}
                    </span>
                    <button
                      onClick={() => {
                        setPartyActions((prev) =>
                          prev.map((a) =>
                            a.extracted_index === pm.extracted_index
                              ? { ...a, action: a.action === 'link_existing' ? 'create_new' : 'link_existing', existing_party_id: pm.matched_party_id || undefined }
                              : a
                          )
                        )
                      }}
                      className="text-xs underline text-muted-foreground"
                    >
                      {action?.action === 'link_existing' ? 'Create new instead' : 'Use match'}
                    </button>
                  </div>
                ) : (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">New contact</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Entities preview */}
        {extraction?.entities && extraction.entities.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mt-6 mb-2">Entities (will be created)</h3>
            <div className="space-y-1">
              {extraction.entities.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-sm p-2 rounded border border-border">
                  <span className="font-medium">{e.name}</span>
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{e.entity_type}</span>
                  <span className="text-xs text-muted-foreground">{e.relationship}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-4 border-t border-border">
          <button onClick={() => setStep(matchCandidates.length > 0 ? 'match' : 'review')} className="px-4 py-2 rounded-md border border-input text-sm hover:bg-muted">Back</button>
          <button onClick={() => setStep('confirm')} className="flex-1 py-2 rounded-md bg-primary text-primary-foreground font-medium text-sm">
            Next: Confirm
          </button>
        </div>
      </div>
    )
  }

  if (step === 'confirm') {
    const newParties = partyActions.filter((a) => a.action === 'create_new').length
    const linkedParties = partyActions.filter((a) => a.action === 'link_existing').length

    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold">Confirm & Create</h2>

        <div className="p-4 rounded-md border border-border bg-card space-y-3">
          {matchAction === 'create_new' && (
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-green-600" />
              <span className="text-sm">Create new project: <strong>{editedFields.name as string}</strong></span>
            </div>
          )}
          {matchAction === 'link_to_existing' && (
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-green-600" />
              <span className="text-sm">Create sub-project: <strong>{editedFields.name as string}</strong> (linked to {matchCandidates.find((m) => m.project_id === selectedMatchId)?.project_name})</span>
            </div>
          )}
          {matchAction === 'add_to_existing' && (
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-green-600" />
              <span className="text-sm">Add documents to: <strong>{matchCandidates.find((m) => m.project_id === selectedMatchId)?.project_name}</strong></span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <FileText size={14} className="text-muted-foreground" />
            <span className="text-sm">{uploadedFiles.length} document{uploadedFiles.length !== 1 ? 's' : ''} attached</span>
          </div>

          {(newParties > 0 || linkedParties > 0) && (
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-blue-600" />
              <span className="text-sm">
                {linkedParties > 0 && `${linkedParties} contact${linkedParties !== 1 ? 's' : ''} matched`}
                {linkedParties > 0 && newParties > 0 && ', '}
                {newParties > 0 && `${newParties} new contact${newParties !== 1 ? 's' : ''} to create`}
              </span>
            </div>
          )}

          {extraction?.entities && extraction.entities.length > 0 && (
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-purple-600" />
              <span className="text-sm">{extraction.entities.length} entit{extraction.entities.length !== 1 ? 'ies' : 'y'} to create</span>
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <div className="flex gap-3 pt-4 border-t border-border">
          <button onClick={() => setStep('parties')} className="px-4 py-2 rounded-md border border-input text-sm hover:bg-muted">Back</button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 py-3 rounded-md bg-green-600 text-white font-medium text-sm hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <><Loader2 size={16} className="animate-spin" /> Creating...</> : 'Create Project'}
          </button>
        </div>
      </div>
    )
  }

  return null
}
