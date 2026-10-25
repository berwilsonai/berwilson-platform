import { FileQuestion } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import { loadCompanyKnowledge } from '@/lib/documents/unfiled'
import { loadTargets } from '@/lib/email-sweep/route-phase'
import UnparentedDocuments, {
  type FilingTarget,
} from '@/components/documents/UnparentedDocuments'

export const metadata = { title: 'Files with no deal — Ber Wilson Intelligence' }

/**
 * Every file that arrived on deal mail and is on no record.
 *
 * ⚠ THE DOOR FOR WHAT /decide HOLDS BACK. That queue only lists a document it
 * can name a destination for; everything `matchDocument` cannot place is held
 * out so the queue can reach zero (§12 — ambiguity means NO match). On the first
 * live import that was 4 of 4, because `BW MNDA (with Non-Circumvention)` names
 * no record and a `Quit Claim Deed` names no record. Held is the right verdict
 * for a MATCHER and the wrong place to stop for a HUMAN, who knows which
 * counterparty the MNDA was for. So /decide reports the count and this page is
 * what the count points at.
 *
 * Admin-only, matching `/decide` and the refile route it writes through: filing
 * changes what Ber AI retrieves for everyone, so it is not a per-project grant.
 *
 * ⚠ THE SAME PASS AS THE QUEUE, UNFILTERED — `loadCompanyKnowledge('unparented')`
 * rather than `findUnparentedDocuments()`. Exactly the relationship /company has
 * with /decide for company knowledge: one reader, the queue takes the confident
 * subset, the page shows all of it. Two queries would be two definitions of one
 * list, and then the count and the page disagree about what is waiting (§12).
 */
export default async function UnfiledDocumentsPage() {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const [documents, rawTargets] = await Promise.all([
    loadCompanyKnowledge('unparented'),
    // The same record list the router and every other filing surface matches
    // against, so a deal that can be routed to can also be chosen by hand.
    loadTargets().catch(() => []),
  ])

  // ⚠ NARROWED BECAUSE THE TYPE PERMITS MORE THAN THE QUERY RETURNS, which is a
  // different reason from the one that first went here. `Target.kind` is
  // `LinkRecordKind`, so it includes `lead` and `steel_deal` and `tsc` demands
  // the narrowing; `loadTargets()` itself selects only from `projects` and
  // `opportunities` (37 rows here), so nothing is actually being dropped today.
  // The filter is therefore a type obligation AND a real guard for the day
  // loadTargets widens: a lead holds no documents — `refileDocument` has no arm
  // for one and the refile route's TARGET_TABLES names only these three — so
  // offering it would be a picker whose button cannot work.
  //
  // `flatMap` rather than `.filter()` with a type predicate, because narrowing
  // a union member through a guard does not survive into the subsequent `.map`.
  const targets: FilingTarget[] = rawTargets
    .flatMap((t) =>
      t.kind === 'project' || t.kind === 'opportunity' || t.kind === 'steel_deal'
        ? [{ kind: t.kind, id: t.id, name: t.name }]
        : []
    )
    .sort((a, b) => a.name.localeCompare(b.name))

  const proposed = documents.filter((d) => d.target !== null).length

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <FileQuestion className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl">Files with no deal</h1>
          <p className="text-sm text-muted-foreground">
            These arrived as attachments on correspondence that could not be matched to a
            record, so they are on no deal and nothing answers from them. Pick the deal and
            the file moves, with its indexed passages — or set it aside if it is not a
            document worth keeping.
          </p>
        </div>
      </div>

      {/*
        One quantity, named apart from the other (§12). "Waiting" is the whole
        list; "already proposed" is the subset /decide offers. Summing them or
        showing one number for both is how a reader stops trusting either.
      */}
      {documents.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {documents.length} {documents.length === 1 ? 'file is' : 'files are'} waiting
          {proposed > 0 && (
            <>
              {' '}— {proposed} of them already{' '}
              {proposed === 1 ? 'has a deal' : 'have a deal'} proposed and{' '}
              {proposed === 1 ? 'is' : 'are'} also on Decide
            </>
          )}
          .
        </p>
      )}

      <UnparentedDocuments documents={documents} targets={targets} />
    </div>
  )
}
