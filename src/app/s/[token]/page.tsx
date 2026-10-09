import { notFound } from 'next/navigation'
import { resolveActionToken, type TokenRejection } from '@/lib/commitments/tokens'
import SettleCard from '@/components/commitments/SettleCard'

export const metadata = { title: 'Settle a commitment — Ber Wilson' }

/**
 * The one-tap settle page, reached from a link in Pepper's morning note.
 *
 * ⚠ PUBLIC BY DESIGN, AND THE TOKEN IS THE CREDENTIAL. This path is in
 * middleware's public list because the reader is on a phone at 06:50 and may
 * not hold a session — requiring a login here is what put the existing settle
 * controls two navigations away, which is most of why 476 commitments had never
 * been settled by anybody.
 *
 * What stands in for the session, in layers:
 *   * the token is 32 random bytes, stored only as a sha256 hash, delivered to
 *     the reader's own mailbox;
 *   * it is single-use and expires in a fortnight;
 *   * the app is tailnet-only, so this URL is unreachable from the open
 *     internet even with the token in hand;
 *   * and GET DOES NOTHING. Rendering this page is free. The verdict is a POST
 *     from the card below, because Gmail prefetches links and the mail gateways
 *     §12 records follow every URL in every message to scan it.
 *
 * The page shows one commitment's text, which is the deliberate disclosure: a
 * confirmation that does not say what it is about is one nobody can give
 * honestly. Rows belonging to a protected project never get here — tokens are
 * minted from the note, and the note reads through readOpenCommitments.
 */
export default async function SettlePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  // A token that is not even the right shape is not worth a database round
  // trip, and 404 is the honest answer for a URL that was never issued.
  if (!token || token.length < 20 || token.length > 128) notFound()

  const resolved = await resolveActionToken(token)

  if (!resolved.ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
        <Rejected reason={resolved.reason} />
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <SettleCard
        token={token}
        what={resolved.data.commitment.what}
        side={resolved.data.commitment.side}
        dueDate={resolved.data.commitment.due_date}
        ownerName={resolved.data.commitment.owner_name}
        createdAt={resolved.data.commitment.created_at}
      />
    </main>
  )
}

/**
 * Why a link will not work, in words.
 *
 * ⚠ NAMED, NEVER COLLAPSED INTO "INVALID LINK". "You already settled this" and
 * "this link expired" and "we have never seen this link" call for three
 * different reactions, and a single message would have the reader assume the
 * platform is broken in the one case where it worked perfectly — they settled
 * it, which is the whole point.
 */
function Rejected({ reason }: { reason: TokenRejection }) {
  const copy: Record<TokenRejection, { title: string; body: string }> = {
    used: {
      title: 'Already settled',
      body: 'This one has been dealt with — the link only works once, on purpose. Nothing further is needed.',
    },
    expired: {
      title: 'This link has expired',
      body: 'Links in the morning note stay live for two weeks. The commitment is still on the ledger if it was never settled.',
    },
    not_found: {
      title: 'We don’t recognise this link',
      body: 'It may have been truncated by a mail client. Open the commitments page and settle it there.',
    },
    gone: {
      title: 'That commitment is no longer on file',
      body: 'The conversation it was read out of has since been removed, which takes its obligations with it.',
    },
  }
  const { title, body } = copy[reason]

  return (
    <div className="rounded-xl border border-border bg-card p-6 elev-1">
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <a
        href="/commitments"
        className="mt-5 inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Open the ledger
      </a>
    </div>
  )
}
