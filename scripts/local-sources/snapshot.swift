// bw-snapshot — copy the TCC-protected local databases somewhere the platform
// can read them. It does nothing else, and that is the entire point.
//
// ⚠ FULL DISK ACCESS IS NOT GRANULAR, SO THE THING THAT HOLDS IT MUST BE SMALL.
// ~/Library/Messages and the Notes group container are TCC-protected: whatever
// reads them needs Full Disk Access, and that grant reaches the whole home
// folder. The platform's own node process must never hold it — it also holds
// the service-role key, the Google refresh tokens and the mail corpus, so a
// compromise there would reach every file Richard owns.
//
// So FDA is granted to THIS binary, whose only capability is to copy a fixed
// allowlist of paths into ~/berwilson-data/local-sources/. There is no argument
// that widens the set, no path taken from the caller, and no way to make it
// read anything else. Same precedent as bw-ocr (scripts/ocr/card-ocr.swift):
// one job, no model, nothing resident, nothing leaves the box.
//
// ⚠ IT COPIES THE -wal AND -shm SIDECARS, WHICH IS CORRECTNESS AND NOT CAUTION.
// Messages and Notes both hold their database open with a write-ahead log, so
// the main file alone is stale — measured 2026-10-11, reading NoteStore.sqlite
// without its 63MB WAL hid a call recording from three weeks earlier entirely
// and reported a snapshot from the last checkpoint with no error at all.
//
// Build: zsh scripts/build-snapshot.sh   →   ~/.local/bin/bw-snapshot
// Grant: System Settings → Privacy & Security → Full Disk Access → bw-snapshot

import Foundation

let home = FileManager.default.homeDirectoryForCurrentUser
let destination = home.appending(path: "berwilson-data/local-sources", directoryHint: .isDirectory)

/// The allowlist. Each entry is copied with its -wal and -shm sidecars if present.
let databases: [(name: String, path: URL)] = [
    ("chat.db", home.appending(path: "Library/Messages/chat.db")),
    (
        "NoteStore.sqlite",
        home.appending(path: "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite")
    ),
]

let fm = FileManager.default

// 700: the snapshot is a copy of the two most personal files on the machine.
// It is readable by its owner and nobody else, including other local accounts.
do {
    try fm.createDirectory(
        at: destination,
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
    )
} catch {
    FileHandle.standardError.write("bw-snapshot: cannot create \(destination.path): \(error)\n".data(using: .utf8)!)
    exit(1)
}

var copied = 0
var failed = 0

for db in databases {
    guard fm.fileExists(atPath: db.path.path) else {
        print("bw-snapshot: skipped \(db.name) — not present")
        continue
    }

    var ok = true
    for suffix in ["", "-wal", "-shm"] {
        let from = URL(fileURLWithPath: db.path.path + suffix)
        guard fm.fileExists(atPath: from.path) else { continue }
        let to = destination.appending(path: db.name + suffix)
        do {
            // Replace rather than update in place: a half-written snapshot read
            // by the sweep is a corrupt database, and the sweep cannot tell.
            let tmp = destination.appending(path: db.name + suffix + ".partial")
            if fm.fileExists(atPath: tmp.path) { try fm.removeItem(at: tmp) }
            try fm.copyItem(at: from, to: tmp)
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tmp.path)
            if fm.fileExists(atPath: to.path) { try fm.removeItem(at: to) }
            try fm.moveItem(at: tmp, to: to)
        } catch {
            // Naming the file AND the reason: "snapshot failed" with no path is
            // the message that sends someone to read the whole binary.
            FileHandle.standardError.write(
                "bw-snapshot: FAILED \(db.name)\(suffix): \(error.localizedDescription)\n".data(using: .utf8)!
            )
            ok = false
        }
    }
    if ok { copied += 1 } else { failed += 1 }
}

print("bw-snapshot: \(copied) database(s) copied to \(destination.path)\(failed > 0 ? ", \(failed) FAILED" : "")")

// ⚠ A NON-ZERO EXIT IS THE ONLY SIGNAL THE CRON HAS. If this exits 0 having
// copied nothing, the sweep reads a stale snapshot and reports a quiet inbox —
// which is indistinguishable from there being no texts. A liveness check needs
// a clock, not a count (§12), so the sweep also checks the snapshot's age.
exit(failed > 0 || copied == 0 ? 1 : 0)
