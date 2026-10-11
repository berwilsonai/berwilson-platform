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
 * TCC-protected, so whatever runs this must hold Full Disk Access — and that
 * same grant reaches the whole home folder. That is a real cost and the reason
 * this is a deliberate, human-run pass rather than something a cron does
 * quietly. `messagesReadable()` reports whether the grant exists so a caller
 * can say so plainly instead of failing with SQLITE_CANTOPEN.
 */

import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { messageText, appleDate } from './decode'

const DB = join(homedir(), 'Library', 'Messages', 'chat.db')

export function messagesDbPath(): string {
  return DB
}

/** Whether the database can actually be opened — i.e. whether FDA is granted. */
export function messagesReadable(): { ok: boolean; reason?: string } {
  if (!existsSync(DB)) return { ok: false, reason: `no Messages database at ${DB}` }
  try {
    const db = new DatabaseSync(DB, { readOnly: true })
    db.prepare('select 1 from message limit 1').get()
    db.close()
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      reason: /authoriz|permission|unable to open/i.test(message)
        ? 'Full Disk Access is not granted to whatever is running this (System Settings → Privacy & Security → Full Disk Access)'
        : message,
    }
  }
}

export interface ChatRow {
  chatId: number
  /** Phone numbers / iMessage addresses in the conversation. */
  handles: string[]
  displayName: string | null
  messages: string[]
  sentByMe: number
  total: number
  lastAt: Date | null
}

export interface ReadOptions {
  /** Only conversations with a message newer than this. */
  since?: Date
  /** Cap messages read per conversation — a classifier needs a sample, not all. */
  perChatLimit?: number
}

/**
 * Every conversation with its decoded messages.
 *
 * Returns conversations rather than messages because the classifier works per
 * conversation (see classify.ts) — and because assembling them here keeps the
 * snapshot's lifetime to this one call.
 */
export function readChats(opts: ReadOptions = {}): ChatRow[] {
  const perChatLimit = opts.perChatLimit ?? 400
  const tmp = mkdtempSync(join(tmpdir(), 'bw-msg-'))
  const copy = join(tmp, 'chat.db')

  try {
    copyFileSync(DB, copy)
    // The WAL is where recent messages live; without it the snapshot is stale.
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(DB + suffix)) copyFileSync(DB + suffix, copy + suffix)
    }

    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      const sinceClause = opts.since
        ? `and m.date / 1000000000 + 978307200 > ${Math.floor(opts.since.getTime() / 1000)}`
        : ''

      const messageStmt = db.prepare(
          `select c.ROWID            as chatId,
                  c.display_name     as displayName,
                  m.ROWID            as messageId,
                  m.text             as text,
                  m.attributedBody   as attributedBody,
                  m.is_from_me       as isFromMe,
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
        displayName: string | null
        text: string | null
        attributedBody: Uint8Array | null
        isFromMe: bigint
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
            handles: handlesByChat.get(chatId) ?? [],
            displayName: r.displayName,
            messages: [],
            sentByMe: 0,
            total: 0,
            lastAt: null,
          }
          byChat.set(chatId, chat)
        }
        chat.total += 1
        if (Number(r.isFromMe) === 1) chat.sentByMe += 1
        const at = appleDate(r.date)
        if (at && (!chat.lastAt || at > chat.lastAt)) chat.lastAt = at
        // Ordered newest-first by the query, so the cap keeps recent messages —
        // which is what a classifier should judge a live conversation on.
        if (chat.messages.length < perChatLimit) {
          const body = messageText({ text: r.text, attributedBody: r.attributedBody })
          if (body) chat.messages.push(body)
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
