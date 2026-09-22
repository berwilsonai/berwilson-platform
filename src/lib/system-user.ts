/**
 * The actor id used when the platform writes on its own behalf.
 *
 * Crons, document passes, lead triage and the sweep all log AI calls and
 * create records with no signed-in user behind them. This literal was
 * redeclared privately in ten files — one of them exported, nine not — which
 * is nine chances for one of them to drift into a different zero-uuid or to
 * be given a real user's id by mistake.
 *
 * Deliberately its own module rather than living in `email-ingestion/analyze`,
 * where the exported copy sat: a document pipeline and a daily-brief cron
 * importing an identity constant out of the email-intake analyzer inverts the
 * dependency and drags that module's weight along with it.
 */
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'
