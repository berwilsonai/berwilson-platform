// Client-side helpers for opening/downloading stored documents.
// Signed URLs are minted server-side (GET /api/documents/[id] and
// GET /api/opportunities/documents/[id]) because the self-hosted Supabase
// storage has no RLS policies for the anon key — the admin client signs,
// the route enforces access.

const VIEWABLE_MIME_PREFIXES = ['image/', 'text/']
const VIEWABLE_MIMES = new Set(['application/pdf'])

export function isViewableInBrowser(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false
  return VIEWABLE_MIMES.has(mimeType) || VIEWABLE_MIME_PREFIXES.some((p) => mimeType.startsWith(p))
}

async function fetchSignedUrl(apiPath: string): Promise<string | null> {
  try {
    const res = await fetch(apiPath)
    if (!res.ok) return null
    const { url } = await res.json()
    return typeof url === 'string' ? url : null
  } catch {
    return null
  }
}

/**
 * Open a document inline in a new tab (PDFs, images, text). Non-viewable
 * types (docx, xlsx, …) fall back to a download so the user isn't left
 * staring at a blank tab. Returns false if a link couldn't be created.
 */
export async function viewDocument(apiPath: string, mimeType?: string | null): Promise<boolean> {
  if (!isViewableInBrowser(mimeType)) return downloadDocument(apiPath)

  // Open the tab synchronously so popup blockers tie it to the click,
  // then point it at the signed URL once we have one.
  const win = window.open('about:blank', '_blank')
  const url = await fetchSignedUrl(apiPath)
  if (!url) {
    win?.close()
    return false
  }
  if (win) win.location.href = url
  else window.open(url, '_blank')
  return true
}

/**
 * Fetch a document's stored readable text (extracted text, AI summary as
 * fallback) for the read-aloud button. Returns null when none is stored.
 */
export async function fetchDocumentText(documentId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/documents/${documentId}?text=1`)
    if (!res.ok) return null
    const { text } = await res.json()
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

/** Force a download (signed URL with Content-Disposition: attachment). */
export async function downloadDocument(apiPath: string): Promise<boolean> {
  const sep = apiPath.includes('?') ? '&' : '?'
  const url = await fetchSignedUrl(`${apiPath}${sep}download=1`)
  if (!url) return false
  const a = document.createElement('a')
  a.href = url
  a.click()
  return true
}
