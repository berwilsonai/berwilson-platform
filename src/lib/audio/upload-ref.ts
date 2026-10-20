/**
 * The upload door's thread-id prefix, alone in a module with no imports.
 *
 * ⚠ IT LIVES HERE TO AVOID A REQUIRE CYCLE, not for tidiness.
 * `meetings/attach-recording.ts` must recognise an upload's thread id, and
 * `audio/upload.ts` imports `attach-recording` for
 * `fileMeetingFromThreadLinks` — so putting the predicate in `upload.ts` closes
 * a cycle that the app tolerates and a verification script does not (§12: a
 * barrel export closes a require cycle the app never notices).
 */

/** `upload:` — so a reader of a fingerprint can tell which door it came through. */
export const UPLOAD_THREAD_PREFIX = 'upload'

/** The same string with its colon, for the prefix switches that compare on it. */
export const UPLOAD_THREAD_ID_PREFIX = `${UPLOAD_THREAD_PREFIX}:`

export function uploadThreadId(token: string): string {
  return `${UPLOAD_THREAD_PREFIX}:${token}`
}

export function isUploadThread(gmailThreadId: string | null | undefined): boolean {
  return Boolean(gmailThreadId?.startsWith(`${UPLOAD_THREAD_PREFIX}:`))
}
