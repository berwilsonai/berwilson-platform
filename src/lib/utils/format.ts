export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatCurrencyCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`
  }
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`
  }
  return formatCurrency(value)
}

/**
 * The one file-size formatter.
 *
 * There were six copies with three different behaviours, so the same file
 * rendered differently depending on which screen you were looking at: 800
 * bytes showed as "800 B" on a project's Documents tab and "1 KB" in email
 * intake, and 2,048 bytes as "2.0 KB" or "2 KB". Two copies also skipped the
 * byte tier entirely and returned '' rather than an em dash for a missing
 * size, so "we don't know" and "it's tiny" looked identical.
 *
 * `empty` is an option only because a couple of surfaces render file size as a
 * quiet sub-label where an em dash would be noise.
 */
export function formatBytes(
  bytes: number | null | undefined,
  opts: { empty?: string } = {}
): string {
  const { empty = '—' } = opts
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return empty
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
