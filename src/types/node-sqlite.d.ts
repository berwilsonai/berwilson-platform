/**
 * Minimal ambient types for Node's built-in `node:sqlite`.
 *
 * Node 26 ships the module but the pinned @types/node in this project does not
 * declare it, so `tsc` fails on the import while the code runs perfectly. Only
 * the surface `src/lib/imessage/read.ts` uses is declared — this is a shim, not
 * an attempt at the whole API.
 *
 * ⚠ `setReadBigInts(true)` IS NOT OPTIONAL HERE. Messages stores dates as Apple
 * epoch NANOSECONDS, which exceed Number.MAX_SAFE_INTEGER, and the driver
 * throws `ERR_OUT_OF_RANGE` rather than silently losing precision. Reading them
 * as bigint is the only way the query returns at all.
 */
declare module 'node:sqlite' {
  interface StatementSync {
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
    setReadBigInts(enabled: boolean): void
  }

  interface DatabaseSyncOptions {
    readOnly?: boolean
    open?: boolean
  }

  class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions)
    prepare(sql: string): StatementSync
    exec(sql: string): void
    close(): void
  }

  export { DatabaseSync, type StatementSync, type DatabaseSyncOptions }
}
