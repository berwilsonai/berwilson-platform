'use client'

/**
 * The last boundary. Catches a throw in the ROOT LAYOUT itself, which
 * `src/app/error.tsx` cannot — that one renders INSIDE the layout, so if the
 * layout is what failed there is nothing left to render it.
 *
 * ⚠ WHY THIS MATTERS HERE AND NOT IN EVERY APP. The root layout is not a
 * passive shell: it awaits `countAttention()`, `countDecideItems()` and
 * `listCategories()` to build the sidebar badges. Those are database reads, on
 * every page, and the Supabase gateway is a container on this same box. A
 * restart, a Colima hiccup or a failing migration therefore takes out the
 * LAYOUT, not a page — and until 2026-10-17 that rendered Next's unstyled
 * default error page, which says nothing useful and offers no way back.
 *
 * ⚠ EVERY STYLE IS INLINE, DELIBERATELY. This component replaces the root
 * layout, and the root layout is what imports `globals.css` and runs the
 * pre-paint theme script — neither is guaranteed to have reached the document
 * when the layout is the thing that threw. So no Tailwind class, no token, no
 * `cn()`, and no import from the app shell: the colours are literal and the
 * dark variant comes from `prefers-color-scheme`, which needs no JavaScript.
 *
 * It must also render its own <html> and <body>. Next requires it.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <style>{`
          .bw-ge { --bg:#f7f7f9; --fg:#1b1b20; --dim:#6b6b76; --line:#e3e3e9; --card:#fff; }
          @media (prefers-color-scheme: dark) {
            .bw-ge { --bg:#121216; --fg:#f3f3f5; --dim:#a0a0ab; --line:#2a2a31; --card:#1b1b20; }
          }
        `}</style>
        <div
          className="bw-ge"
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: 'var(--bg)',
            color: 'var(--fg)',
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: '30rem',
              width: '100%',
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: '12px',
              padding: '28px',
            }}
          >
            <h1 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 600 }}>
              The platform could not start this page
            </h1>
            <p style={{ margin: '12px 0 0', fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--dim)' }}>
              This is the application shell failing, not one screen — usually the database
              container being unreachable. <strong style={{ color: 'var(--fg)', fontWeight: 600 }}>Nothing
              has been lost:</strong> every record lives in Postgres and nothing here writes on load.
            </p>
            <p style={{ margin: '12px 0 0', fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--dim)' }}>
              If reloading does not clear it, the thing to check on the Studio is whether Supabase
              is up:{' '}
              <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem', color: 'var(--fg)' }}>
                docker ps
              </code>
              .
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: '20px',
                height: '36px',
                padding: '0 16px',
                borderRadius: '8px',
                border: 0,
                background: 'var(--fg)',
                color: 'var(--bg)',
                fontSize: '0.875rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            {/* The digest is the only handle on the server-side stack, which is
                never sent to the browser. Without it a report is unactionable. */}
            {error.digest && (
              <p style={{ margin: '16px 0 0', fontSize: '0.75rem', color: 'var(--dim)' }}>
                Reference: <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{error.digest}</code>
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  )
}
