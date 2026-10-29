/**
 * What a /decide row IS, and what pressing it can do.
 *
 * ⚠ IN `src/lib` AND NOT IN THE CLIENT COMPONENT, because they are now shared.
 * `planAccept` has to name every kind and every action to be able to assert it
 * covers them, and §12 is explicit that a helper shared between server and
 * client lives here — a type exported from a `'use client'` file drags the
 * whole module behind it the moment anything but `tsc` reads the import, and
 * the verification loader cannot resolve a `.tsx` at all.
 */

export type DecideKind =
  | 'intake'
  | 'review'
  | 'document'
  | 'unparented'
  | 'misfiled'
  | 'proposal'

/**
 * ⚠ Until now this queue could only DISMISS. Every "yes" meant leaving the
 * page, opening a form on another route — which dropped the recommendation on
 * the way in — and re-forming a judgement the model had already made. Measured
 * on 2026-09-23: 5 intake sessions confirmed ever against 136 decided, and
 * 0 leads promoted out of 1,268. The recommendations were good; agreeing with
 * one was just more expensive than ignoring it.
 *
 * ⚠ This does NOT create anything on its own — CLAUDE.md §11 is untouched.
 * The click IS the human review the invariant requires; what changed is where
 * the click lives. The review screens remain for when you want to edit first.
 */
export type AcceptAction =
  | 'project'
  | 'opportunity'
  | 'merge'
  /**
   * Make it a task on a deal we already have, and create nothing else.
   *
   * ⚠ THE MISSING MIDDLE OF THIS QUEUE (10-22). A staged call or thread offered
   * three answers — create a whole record, merge the conversation onto one, or
   * dismiss it — and the commonest real answer was none of them: *"that is not
   * a project, that is a task on Steelton."* Reaching it meant leaving the page
   * for /tasks and retyping what the extraction already held, which is the same
   * cost that got 5 sessions confirmed out of 136 before Accept existed at all.
   *
   * Legal under §11: the invariant is that mail must not become a record
   * WITHOUT human review, and the press IS the review. Nothing is created
   * unattended — the automatic path stays the one narrow `side='us'`
   * all-internal commitment exception, which is latched elsewhere.
   */
  | 'task'
  | 'approve'
  | 'file'
  | 'setaside'
  | 'confirmfield'
