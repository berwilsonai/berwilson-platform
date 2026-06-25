'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  X,
  Upload,
  FileUp,
  Camera,
  File,
  Loader2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface Project {
  id: string
  name: string
  sector: string
}

const DOC_TYPES = [
  'proposal',
  'contract',
  'drawing',
  'email',
  'report',
  'correspondence',
  'other',
] as const

type DocType = (typeof DOC_TYPES)[number]

function guessDocType(name: string): DocType {
  const lower = name.toLowerCase()
  if (lower.includes('contract') || lower.includes('agreement')) return 'contract'
  if (lower.includes('proposal') || lower.includes('rfp') || lower.includes('rfq')) return 'proposal'
  if (lower.includes('drawing') || lower.includes('plan') || lower.endsWith('.dwg')) return 'drawing'
  if (lower.includes('report')) return 'report'
  if (lower.includes('email') || lower.endsWith('.eml') || lower.endsWith('.msg')) return 'email'
  return 'other'
}

export default function MobileQuickUpload() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [docType, setDocType] = useState<DocType>('other')
  const [extractAi, setExtractAi] = useState(true)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Opened from the mobile "More" menu — no persistent floating button.
  useEffect(() => {
    function handleOpen() {
      setOpen(true)
    }
    window.addEventListener('open-quick-upload', handleOpen)
    return () => window.removeEventListener('open-quick-upload', handleOpen)
  }, [])

  useEffect(() => {
    if (open && projects.length === 0) {
      setLoading(true)
      const supabase = createClient()
      supabase
        .from('projects')
        .select('id, name, sector')
        .eq('status', 'active')
        .order('name')
        .then(({ data }) => {
          setProjects(data ?? [])
          setLoading(false)
        })
    }
  }, [open, projects.length])

  function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    setSelectedFile(file)
    setDocType(guessDocType(file.name))
  }

  async function handleUpload() {
    if (!selectedFile || !selectedProject) return
    setUploading(true)

    const formData = new FormData()
    formData.append('file', selectedFile)
    formData.append('project_id', selectedProject)
    formData.append('doc_type', docType)
    formData.append('extract_ai', String(extractAi))

    const res = await fetch('/api/documents/upload', {
      method: 'POST',
      body: formData,
    })

    setUploading(false)

    if (res.ok) {
      setSuccess(true)
      setTimeout(() => {
        setOpen(false)
        setSuccess(false)
        setSelectedFile(null)
        setSelectedProject('')
        setDocType('other')
        router.refresh()
      }, 1200)
    } else {
      const { error } = await res.json().catch(() => ({ error: 'Upload failed' }))
      alert(error ?? 'Upload failed. Please try again.')
    }
  }

  function handleClose() {
    setOpen(false)
    setSelectedFile(null)
    setSelectedProject('')
    setSuccess(false)
  }

  return (
    <>
      {/* Upload sheet overlay — triggered from the mobile "More" menu */}
      {open && (
        <div className="md:hidden fixed inset-0 z-[60] flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Sheet */}
          <div className="relative bg-background rounded-t-2xl max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3">
              <h2 className="text-lg font-semibold text-foreground">Quick Upload</h2>
              <button
                onClick={handleClose}
                className="p-2 -mr-2 rounded-full hover:bg-muted transition-colors"
              >
                <X size={20} className="text-muted-foreground" />
              </button>
            </div>

            <div className="px-5 pb-8 space-y-5">
              {success ? (
                <div className="flex flex-col items-center py-10 gap-3">
                  <div className="size-16 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                    <FileUp size={28} className="text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <p className="text-base font-medium text-foreground">Uploaded successfully</p>
                  <p className="text-sm text-muted-foreground">AI extraction in progress</p>
                </div>
              ) : (
                <>
                  {/* File selection */}
                  {!selectedFile ? (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-dashed border-border hover:border-foreground/30 hover:bg-muted/50 transition-colors"
                      >
                        <Upload size={28} className="text-muted-foreground" />
                        <span className="text-sm font-medium">Browse Files</span>
                      </button>
                      <button
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-dashed border-border hover:border-foreground/30 hover:bg-muted/50 transition-colors"
                      >
                        <Camera size={28} className="text-muted-foreground" />
                        <span className="text-sm font-medium">Take Photo</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                      <File size={20} className="shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(selectedFile.size / 1024).toFixed(0)} KB
                        </p>
                      </div>
                      <button
                        onClick={() => setSelectedFile(null)}
                        className="p-1.5 rounded-full hover:bg-muted transition-colors"
                      >
                        <X size={14} className="text-muted-foreground" />
                      </button>
                    </div>
                  )}

                  {/* Project selector */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Project</label>
                    {loading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
                        <Loader2 size={14} className="animate-spin" />
                        Loading projects...
                      </div>
                    ) : (
                      <select
                        value={selectedProject}
                        onChange={(e) => setSelectedProject(e.target.value)}
                        className="w-full h-11 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">Select a project...</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Doc type */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Document Type</label>
                    <div className="flex flex-wrap gap-2">
                      {DOC_TYPES.map((t) => (
                        <button
                          key={t}
                          onClick={() => setDocType(t)}
                          className={`h-8 px-3 rounded-full text-xs font-medium transition-colors capitalize ${
                            docType === t
                              ? 'bg-foreground text-background'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* AI toggle */}
                  <label className="flex items-center justify-between py-2 cursor-pointer">
                    <span className="text-sm font-medium text-foreground">AI extraction & summary</span>
                    <div
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        extractAi ? 'bg-foreground' : 'bg-muted-foreground/30'
                      }`}
                      onClick={() => setExtractAi(!extractAi)}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-background transition-transform ${
                          extractAi ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </label>

                  {/* Upload button */}
                  <button
                    onClick={handleUpload}
                    disabled={!selectedFile || !selectedProject || uploading}
                    className="w-full h-12 rounded-xl bg-foreground text-background text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
                  >
                    {uploading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload size={16} />
                        Upload Document
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Hidden file inputs */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.doc,.txt,.csv,.png,.jpg,.jpeg,.heic,.eml,.msg"
            onChange={(e) => handleFileSelect(e.target.files)}
          />
          <input
            ref={cameraInputRef}
            type="file"
            className="hidden"
            accept="image/*"
            capture="environment"
            onChange={(e) => handleFileSelect(e.target.files)}
          />
        </div>
      )}
    </>
  )
}
