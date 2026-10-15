/**
 * `embedding_status` values that mean "this document is settled".
 *
 * Deliberately a module with NO imports. These values are read by the document
 * pipeline, the system-health probe, the sweep's reconcile pass and a backfill
 * script, and putting them next to the pipeline meant the health page imported
 * the pipeline — which imports the Gemini client, which imports the Google
 * Workspace layer, which traces the whole project in the build. A shared
 * constant should cost nothing to import.
 */

/**
 * A document whose text is searchable through its EMAIL THREAD rather than
 * through chunks of its own.
 *
 * A settled state, like 'complete' and 'skipped' — not a stage on the way to
 * one. `readAttachmentText` (thread-embeddings.ts) already pulls the verbatim
 * text out of every pdf/docx/text attachment and indexes it as `thread_chunks`,
 * so running the document embed as well put the same bytes in two corpora:
 * measured 2026-10-15, 1,191 of the chunks behind 145 correspondence documents
 * were a second copy of text `search_correspondence` already held.
 *
 * The document itself is untouched — it keeps its file, its `ai_summary` and
 * its `extracted_text`, so `list_documents` still presents it and
 * `get_document_content` still reads it. Only the duplicate index is gone.
 *
 * ⚠ ANY NEW READER OF `embedding_status` MUST KNOW THIS VALUE. It is settled,
 * so `needsAnotherPass` returns false for it; it is searchable, so the health
 * page must not count it as stuck. Both were one-line changes and both would
 * have failed silently — the nightly Drive sync re-running a ~48s model pass on
 * all 59 Drive-stamped rows forever, and the health page reporting a backlog
 * that is not there.
 */
export const INDEXED_IN_MAIL = 'indexed_in_mail'
