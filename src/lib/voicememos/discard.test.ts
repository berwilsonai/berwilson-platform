/**
 * Forgetting a private recording has to reach the AUDIO, and has to stick.
 *
 * ⚠ THESE TESTS EXIST BECAUSE THE FIRST VERSION REPORTED A DISCARD IT HAD NOT
 * PERFORMED. On the first synthetic end-to-end run (2026-10-14) the sweep
 * printed "transcript, chunks and audio discarded" while the m4a was still on
 * disk and the skip list had never been created — the resolver re-read the
 * store at its default path and found nothing there, logged it, and returned.
 * Nulling the transcript is the half that can answer a question out loud;
 * deleting the audio is the half that stops a personal recording sitting in a
 * directory the app process can read.
 *
 * ⚠ AND DELETING THE FILE ALONE IS A LOOP: `bw-snapshot` copies any memo audio
 * it does not already have, four times a day, so the skip list is what makes a
 * deletion permanent. A delete that reports success without skip-listing is
 * worse than no delete, because it reads as done.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The module resolves its paths from $HOME at call time, so each test gets its
 * own home. Imported dynamically for the same reason — a top-level import would
 * bind the real one.
 */
async function inFakeHome<T>(fn: (home: string) => Promise<T> | T): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), 'bw-home-'))
  const realHome = process.env.HOME
  process.env.HOME = home
  try {
    return await fn(home)
  } finally {
    if (realHome === undefined) delete process.env.HOME
    else process.env.HOME = realHome
    rmSync(home, { recursive: true, force: true })
  }
}

/** Where the copier leaves audio, under a given home. */
function audioDir(home: string): string {
  return join(home, 'berwilson-data', 'local-sources', 'voice-memos')
}

test('a discarded recording loses its audio AND is skip-listed', async () => {
  await inFakeHome(async (home) => {
    const { mkdirSync } = await import('node:fs')
    const dir = audioDir(home)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'private.m4a'), 'audio bytes')

    const { discardMemoAudioFiles } = await import('@/lib/voicememos/discard')
    const result = discardMemoAudioFiles(['private.m4a'])

    assert.equal(result.deleted, 1)
    assert.equal(result.skipListed, 1)
    assert.equal(existsSync(join(dir, 'private.m4a')), false, 'the audio must be gone')
    const skip = readFileSync(join(dir, '.skip'), 'utf8')
    assert.ok(skip.includes('private.m4a'))
    // The file says what it is for, because the next person to read it will be
    // wondering whether deleting it is safe.
    assert.ok(skip.includes('#'), 'the skip list explains itself')
  })
})

test('an already-deleted file is still skip-listed', async () => {
  // The inline redaction in the summarize phase deletes it first, so by the
  // time the sweep's own pass runs the file is usually gone — and skipping the
  // skip-listing there would let the copier bring it back within six hours.
  await inFakeHome(async (home) => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(audioDir(home), { recursive: true })
    const { discardMemoAudioFiles } = await import('@/lib/voicememos/discard')
    const result = discardMemoAudioFiles(['never-copied.m4a'])
    assert.equal(result.deleted, 0)
    assert.equal(result.skipListed, 1, 'skip-listing does not depend on the file existing')
  })
})

test('skip-listing is idempotent and does not duplicate', async () => {
  await inFakeHome(async (home) => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(audioDir(home), { recursive: true })
    const { addToSkipList, readSkipList } = await import('@/lib/voicememos/discard')
    assert.equal(addToSkipList(['a.m4a', 'b.m4a']), 2)
    assert.equal(addToSkipList(['a.m4a']), 0, 'already held')
    assert.equal(addToSkipList(['a.m4a', 'c.m4a']), 1, 'only the new one')
    assert.deepEqual([...readSkipList()].sort(), ['a.m4a', 'b.m4a', 'c.m4a'])
  })
})

test('one call with the same name twice writes it once', async () => {
  await inFakeHome(async (home) => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(audioDir(home), { recursive: true })
    const { discardMemoAudioFiles, readSkipList } = await import('@/lib/voicememos/discard')
    const result = discardMemoAudioFiles(['dup.m4a', 'dup.m4a', ''])
    assert.equal(result.skipListed, 1)
    assert.deepEqual([...readSkipList()], ['dup.m4a'])
  })
})

test('a missing skip list reads as empty rather than throwing', async () => {
  // It is read on every sweep, before anything has ever been discarded.
  await inFakeHome(async () => {
    const { readSkipList } = await import('@/lib/voicememos/discard')
    assert.equal(readSkipList().size, 0)
  })
})
