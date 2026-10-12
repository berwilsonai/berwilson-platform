/**
 * Read the local Messages database. Read-only, on-box, nothing leaves.
 *
 * ⚠ IT WORKS ON A COPY, AND THAT IS NOT CAUTION — IT IS CORRECTNESS. Messages
 * keeps `chat.db` open with a write-ahead log, so `chat.db-wal` holds recent
 * messages that are not in the main file yet. Opening the live file read-only
 * either misses them or fails on a lock, and either way the symptom is "the
 * last few days of texts are missing" with nothing reporting it. Copying all
 * three files (db, -wal, -shm) and opening the copy gets a consistent snapshot
 * including the WAL.
 *
 * ⚠ IT NEEDS FULL DISK ACCESS, WHICH IS NOT GRANULAR. `~/Library/Messages` is
 * TCC-protected, so whatever reads it must hold Full Disk Access — and that
 * same grant reaches the whole home folder. The platform's own process must
 * NOT hold it: it also holds the service-role key and the mail tokens.
 *
 * So the cron path does not read this file. `bw-snapshot` (scripts/local-sources,
 * the only thing granted FDA) copies the three files into
 * ~/berwilson-data/local-sources/, and the sweep reads THAT via `dbPath`.
 * `messagesReadable()` reports whether a given path can be opened so a caller
 * can say so plainly instead of failing with SQLITE_CANTOPEN.
 */

import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { messageText, appleDate } from './decode'

const DB = join(homedir(), 'Library', 'Messages', 'chat.db')

/** The live, TCC-protected database. Reading this needs Full Disk Access. */
export function messagesDbPath(): string {
  return DB
}

/** Where `bw-snapshot` leaves its copy. Readable without Full Disk Access. */
export function snapshotDbPath(): string {
  return join(homedir(), 'berwilson-data', 'local-sources', 'chat.db')
}

/** Whether the database can actually be opened — i.e. whether FDA is granted. */
export function messagesReadable(dbPath: string = DB): { ok: boolean; reason?: string } {
  if (!existsSync(dbPath)) return { ok: false, reason: `no Messages database at ${dbPath}` }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    db.prepare('select 1 from message limit 1').get()
    db.close()
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      reason: /authoriz|permission|unable to open/i.test(message)
        ? `Full Disk Access is not granted to whatever is running this, or ${dbPath} is stale (System Settings → Privacy & Security → Full Disk Access)`
        : message,
    }
  }
}

/** One message, decoded. */
export interface ChatMessage {
  text: string
  at: Date
  /** Sent by the owner of this machine. */
  fromMe: boolean
}

export interface ChatRow {
  chatId: number
  /** Messages' own stable identity for the conversation, across rebuilds. */
  guid: string | null
  /** Phone numbers / iMessage addresses in the conversation. */
  handles: string[]
  displayName: string | null
  /**
   * Decoded messages, NEWEST FIRST.
   *
   * ⚠ CARRIES ITS TIMESTAMP AND DIRECTION, NOT JUST ITS TEXT. Bodies alone were
   * enough to classify a conversation, which is all this originally did. They
   * are not enough to INGEST one: a text session is rendered with the same
   * `### <ts> — <sender>` headings as mail so that `deltaFor` can count what it
   * has already posted onto a record, and splitting a chat into sessions needs
   * the gaps between messages. The query always selected both columns and threw
   * them away.
   */
  messages: ChatMessage[]
  sentByMe: number
  total: number
  /**
   * Tapbacks dropped from this conversation — the coverage signal for the
   * filter below. A pass whose failure mode is silently carrying duplicate
   * text needs a number beside it (§12).
   */
  tapbacks: number
  lastAt: Date | null
}

export interface ReadOptions {
  /** Only conversations with a message newer than this. */
  since?: Date
  /**
   * Cap messages read per conversation. 0 (the default) reads every message in
   * the window.
   *
   * ⚠ THE CAP IS NOT THE CLASSIFIER'S SAMPLE ANY MORE, AND CONFLATING THEM MADE
   * THE DRY RUN DISHONEST. The classifier judges the newest `CLASSIFY_SAMPLE`
   * messages (see targets.ts) while ingestion needs every message in the window
   * to build sessions — so if the cap were the sample, the survey and the sweep
   * would classify different inputs and the survey would stop predicting what
   * the sweep selects. The sample is applied at the classifier, once.
   */
  perChatLimit?: number
  /** Read a snapshot instead of the live database. */
  dbPath?: string
}

/**
 * Every conversation with its decoded messages.
 *
 * Returns conversations rather than messages because the classifier works per
 * conversation (see classify.ts) — and because assembling them here keeps the
 * snapshot's lifetime to this one call.
 */
export function readChats(opts: ReadOptions = {}): ChatRow[] {
  const perChatLimit = opts.perChatLimit ?? 0
  const source = opts.dbPath ?? DB
  const tmp = mkdtempSync(join(tmpdir(), 'bw-msg-'))
  const copy = join(tmp, 'chat.db')

  try {
    copyFileSync(source, copy)
    // The WAL is where recent messages live; without it the snapshot is stale.
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(source + suffix)) copyFileSync(source + suffix, copy + suffix)
    }

    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      const sinceClause = opts.since
        ? `and m.date / 1000000000 + 978307200 > ${Math.floor(opts.since.getTime() / 1000)}`
        : ''

      const messageStmt = db.prepare(
          `select c.ROWID            as chatId,
                  c.guid             as guid,
                  c.display_name     as displayName,
                  m.ROWID            as messageId,
                  m.text             as text,
                  m.attributedBody   as attributedBody,
                  m.is_from_me       as isFromMe,
                  m.associated_message_type as assocType,
                  m.date             as date
             from chat c
             join chat_message_join cmj on cmj.chat_id = c.ROWID
             join message m             on m.ROWID = cmj.message_id
            where 1 = 1 ${sinceClause}
            order by c.ROWID, m.date desc`
      )
      // ⚠ REQUIRED: `message.date` is Apple-epoch NANOSECONDS and overflows a
      // JS number, so the driver throws ERR_OUT_OF_RANGE on the whole query
      // rather than rounding. Every integer column then arrives as a bigint.
      messageStmt.setReadBigInts(true)
      const rows = messageStmt.all() as unknown as {
        chatId: bigint
        guid: string | null
        displayName: string | null
        text: string | null
        attributedBody: Uint8Array | null
        isFromMe: bigint
        assocType: bigint
        date: bigint
      }[]

      const handleStmt = db.prepare(
        `select chj.chat_id as chatId, h.id as handle
           from chat_handle_join chj
           join handle h on h.ROWID = chj.handle_id`
      )
      handleStmt.setReadBigInts(true)
      const handleRows = handleStmt.all() as unknown as { chatId: bigint; handle: string }[]

      const handlesByChat = new Map<number, string[]>()
      for (const h of handleRows) {
        const id = Number(h.chatId)
        const list = handlesByChat.get(id) ?? []
        list.push(h.handle)
        handlesByChat.set(id, list)
      }

      const byChat = new Map<number, ChatRow>()
      for (const r of rows) {
        const chatId = Number(r.chatId)
        let chat = byChat.get(chatId)
        if (!chat) {
          chat = {
            chatId,
            guid: r.guid,
            handles: handlesByChat.get(chatId) ?? [],
            displayName: r.displayName,
            messages: [],
            sentByMe: 0,
            total: 0,
            tapbacks: 0,
            lastAt: null,
          }
          byChat.set(chatId, chat)
        }
        /**
         * ⚠ A TAPBACK CARRIES THE WHOLE QUOTED MESSAGE, UNDER THE WRONG AUTHOR.
         *
         * Messages stores a reaction as its own `message` row whose body is
         * `Liked “<the entire text it reacts to>”` and whose `is_from_me` is
         * the REACTOR's. So Richard liking Eric's rundown of every outstanding
         * deal produced a second copy of that rundown attributed to Richard —
         * and the commitment extractor, reading both, could not tell who owed
         * what: all five obligations off that thread landed `side='them'` with
         * no owner at all.
         *
         * Measured on this box 2026-10-11: 46,106 of 305,241 messages are
         * tapbacks (15.1%), 1,933 of 13,953 in the last 90 days. They are not a
         * rounding error, and the duplicate is indistinguishable from a real
         * message once rendered.
         *
         * `associated_message_type` is 0 for an original message and non-zero
         * for anything attached to another one (2000-2006 added, 3000-3005
         * removed). The acknowledgement itself is not lost information, but it
         * is worth less than the damage its body does, and the message it reacts
         * to is in the same conversation two lines up.
         *
         * ⚠ COUNTED, NOT JUST DROPPED, and it does NOT count toward `total` —
         * that number is what the classifier reads as conversation volume, and a
         * reaction is not a message.
         */
        if (Number(r.assocType) !== 0) {
          chat.tapbacks += 1
          continue
        }
        chat.total += 1
        if (Number(r.isFromMe) === 1) chat.sentByMe += 1
        const at = appleDate(r.date)
        if (at && (!chat.lastAt || at > chat.lastAt)) chat.lastAt = at
        // Ordered newest-first by the query, so a cap keeps recent messages —
        // which is what a classifier should judge a live conversation on.
        if (perChatLimit === 0 || chat.messages.length < perChatLimit) {
          const body = messageText({ text: r.text, attributedBody: r.attributedBody })
          // A message with no decodable body still happened, so it counts
          // toward `total` above — but it cannot be rendered or classified.
          if (body && at) chat.messages.push({ text: body, at, fromMe: Number(r.isFromMe) === 1 })
        }
      }

      return [...byChat.values()]
    } finally {
      db.close()
    }
  } finally {
    // The snapshot is a copy of the most personal file on the machine. It does
    // not outlive the call, even if the read threw.
    rmSync(tmp, { recursive: true, force: true })
  }
}
