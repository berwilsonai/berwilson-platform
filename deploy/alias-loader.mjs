const ROOT = new URL('./src/', import.meta.url).href
async function trySuffixes(base, context, next) {
  for (const suffix of ['', '.ts', '.tsx', '/index.ts']) {
    try { return await next(base + suffix, context) } catch { /* next */ }
  }
  return next(base, context)
}
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) return trySuffixes(ROOT + specifier.slice(2), context, next)
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/.test(specifier)) return trySuffixes(specifier, context, next)
  return next(specifier, context)
}
