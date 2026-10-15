// bw-snapshot — copy the TCC-protected local databases somewhere the platform
// can read them. It does nothing else, and that is the entire point.
//
// ⚠ FULL DISK ACCESS IS NOT GRANULAR, SO THE THING THAT HOLDS IT MUST BE SMALL.
// ~/Library/Messages and the Notes and Voice Memos group containers are
// TCC-protected: whatever reads them needs Full Disk Access, and that grant
// reaches the whole home folder. The platform's own node process must never
// hold it — it also holds the service-role key, the Google refresh tokens and
// the mail corpus, so a compromise there would reach every file Richard owns.
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

/// The database allowlist. Each entry is copied with its -wal and -shm sidecars
/// if present. Audio attachments are handled separately, further down.
let databases: [(name: String, path: URL)] = [
    ("chat.db", home.appending(path: "Library/Messages/chat.db")),
    (
        "NoteStore.sqlite",
        home.appending(path: "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite")
    ),
    // iPhone Voice Memos, synced by iCloud — the door for an IN-PERSON meeting.
    // ⚠ Optional, and absent until Voice Memos.app has been opened once on this
    // Mac: the container exists from account setup but holds nothing until the
    // app runs, and it keeps syncing only while it runs (the same trap Notes
    // set on 10-12). A missing store is skipped and reported, never fatal — the
    // exit contract below still only fails on a FAILED copy.
    (
        "CloudRecordings.db",
        home.appending(
            path: "Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings/CloudRecordings.db"
        )
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
            //
            // ⚠ AND FOUNDATION NAMES THE WRONG HALF, SO SAY WHICH HALF IT IS.
            // A TCC denial on the SOURCE comes back from `copyItem` as
            // "chat.db couldn't be copied because you don't have permission to
            // access local-sources" — the DESTINATION directory. Measured
            // 2026-10-12 off the first scheduled run: the destination was a
            // 700 directory owned by the same user and perfectly writable,
            // while the real fault was that launchd's copy of this binary has
            // no Full Disk Access. The message as Foundation phrases it sends
            // the reader to chase directory permissions that are already fine.
            // So the source is probed and named explicitly.
            let readable = fm.isReadableFile(atPath: from.path)
            let hint = readable
                ? "destination \(destination.path) — check that directory"
                : "cannot READ \(from.path): grant Full Disk Access to this binary "
                    + "(System Settings → Privacy & Security → Full Disk Access → + → "
                    + CommandLine.arguments[0]
                    + "). Foundation blames the destination here; it is wrong."
            FileHandle.standardError.write(
                "bw-snapshot: FAILED \(db.name)\(suffix): \(error.localizedDescription) [\(hint)]\n"
                    .data(using: .utf8)!
            )
            ok = false
        }
    }
    if ok { copied += 1 } else { failed += 1 }
}

// ── Audio attachments from Apple Notes ──────────────────────────────────────
//
// ⚠ WHY THIS IS HERE AT ALL, AND WHY IT IS AUDIO ONLY. An iOS call recording
// becomes a note titled "Call with <name>" whose body is 254 bytes — a title
// and an attachment pointer, with NO transcript. The recording IS the content,
// so a database-only snapshot leaves the one artifact worth having behind. The
// bytes are already on this Mac (iCloud downloads them while Notes.app runs),
// under Accounts/<account>/Media/<identifier>/<generation>/<filename>.
//
// The platform's own process cannot read them: the Notes group container is
// TCC-protected and the app process must never hold Full Disk Access (it also
// holds the service-role key and the Google refresh tokens). So this copies
// them, like the databases.
//
// ⚠ AUDIO EXTENSIONS ONLY, AND THAT IS A PRIVACY DECISION RATHER THAN A SIZE
// ONE. That Media tree holds 146 files — family photos, screenshots, PDFs,
// meditation tracks. The platform has no use for any of it, and copying a
// personal photo library into a directory the app CAN read would widen this
// binary's blast radius for nothing. The allowlist stays as narrow as the
// purpose: things that might be a recorded call.
//
// The relative path is preserved so the reader can resolve a note's attachment
// deterministically through the database FK chain (attachment → ZMEDIA → that
// row's ZIDENTIFIER / ZGENERATION1 / ZFILENAME) rather than matching on a
// filename — three different notes here each carry a `recording.m4a`.
// ⚠ `qta` IS NOT OPTIONAL HERE AND ITS ABSENCE WAS SILENT. Voice Memos
// writes a QuickTime container (`ftyp qt  `, AAC inside) rather than an m4a
// for anything recorded by a recent iOS, and 39 of the 111 recordings on this
// box — EVERY ONE made in 2026, including both of the hour-long ones — carry
// that extension. With no branch for it the copier reported "0 recording(s)
// copied" and the reader reported 111 memos with 71 audio files, which reads
// as a quiet corpus rather than a missing format (§12 — a file type with no
// branch is invisible, not unreadable, and nothing reports it). Verified
// 2026-10-15: `afinfo` identifies it, `afconvert` decodes it to 16 kHz mono
// in 0.04s, and whisper returned real speech from the result.
let audioExtensions: Set<String> = ["m4a", "mp3", "mp4", "caf", "wav", "aac", "aiff", "qta"]
let mediaRoots = home.appending(path: "Library/Group Containers/group.com.apple.notes/Accounts")
let mediaDestination = destination.appending(path: "notes-media", directoryHint: .isDirectory)

var audioCopied = 0
var audioFailed = 0

if let accounts = try? fm.contentsOfDirectory(at: mediaRoots, includingPropertiesForKeys: nil) {
    for account in accounts {
        let mediaRoot = account.appending(path: "Media", directoryHint: .isDirectory)
        guard let walker = fm.enumerator(at: mediaRoot, includingPropertiesForKeys: [.isRegularFileKey])
        else { continue }
        for case let file as URL in walker {
            guard audioExtensions.contains(file.pathExtension.lowercased()) else { continue }
            // Relative to Media/, so <identifier>/<generation>/<filename> survives.
            let relative = file.path.replacingOccurrences(of: mediaRoot.path + "/", with: "")
            let to = mediaDestination.appending(path: relative)
            do {
                // Already copied and unchanged in size? Leave it. These are
                // megabytes each and the snapshot runs four times a day.
                if let existing = try? fm.attributesOfItem(atPath: to.path)[.size] as? Int,
                   let current = try? fm.attributesOfItem(atPath: file.path)[.size] as? Int,
                   existing == current {
                    continue
                }
                try fm.createDirectory(
                    at: to.deletingLastPathComponent(),
                    withIntermediateDirectories: true,
                    attributes: [.posixPermissions: 0o700]
                )
                if fm.fileExists(atPath: to.path) { try fm.removeItem(at: to) }
                try fm.copyItem(at: file, to: to)
                try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: to.path)
                audioCopied += 1
            } catch {
                FileHandle.standardError.write(
                    "bw-snapshot: FAILED audio \(relative): \(error.localizedDescription)\n"
                        .data(using: .utf8)!
                )
                audioFailed += 1
            }
        }
    }
}

// ── Recordings from iPhone Voice Memos ──────────────────────────────────────
//
// ⚠ THIS IS THE AUDIO FOR AN IN-PERSON MEETING, AND IT IS THE CONTENT ITSELF.
// Voice Memos stores the m4a beside its database in the same group container,
// so unlike Notes there is no FK chain to walk and no Media tree of family
// photos to filter — every file here is a recording somebody made deliberately.
// The database row carries the title and the date; this carries the only thing
// whisper can read.
//
// ⚠ IT HONOURS A SKIP LIST, WHICH IS THE PLATFORM TELLING THIS BINARY TO FORGET
// SOMETHING. Every memo is transcribed and then judged by the summarizer; a
// recording judged private has its transcript, its chunks and its copied audio
// deleted. Without this list the next run would copy that audio straight back —
// four times a day, forever — and a personal recording would sit permanently in
// a directory the app process can read, which is exactly the blast-radius
// widening the Notes block above refuses.
//
// The list is FILE NAMES, one per line, because that is what this binary can
// act on: the mapping from a recording's identifier to its file lives in the
// database, and giving this program a SQLite client to read it would widen the
// one thing that must stay narrow. It can only ever REMOVE files from the copy
// set, so nothing a caller writes there can make this read more than it already
// could — the header's promise is intact.
let voiceMemosRoot = home.appending(
    path: "Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings",
    directoryHint: .isDirectory
)
let voiceMemosDestination = destination.appending(path: "voice-memos", directoryHint: .isDirectory)
let skipListPath = voiceMemosDestination.appending(path: ".skip")

var skipNames: Set<String> = []
if let raw = try? String(contentsOf: skipListPath, encoding: .utf8) {
    for line in raw.split(separator: "\n") {
        let name = line.trimmingCharacters(in: .whitespaces)
        if !name.isEmpty && !name.hasPrefix("#") { skipNames.insert(name) }
    }
}

var memoCopied = 0
var memoFailed = 0
var memoSkipped = 0

if let files = try? fm.contentsOfDirectory(at: voiceMemosRoot, includingPropertiesForKeys: nil) {
    for file in files {
        guard audioExtensions.contains(file.pathExtension.lowercased()) else { continue }
        let name = file.lastPathComponent
        if skipNames.contains(name) {
            memoSkipped += 1
            continue
        }
        let to = voiceMemosDestination.appending(path: name)
        do {
            // Already copied and unchanged in size? Leave it. An hour of audio
            // is tens of megabytes and this runs four times a day.
            if let existing = try? fm.attributesOfItem(atPath: to.path)[.size] as? Int,
               let current = try? fm.attributesOfItem(atPath: file.path)[.size] as? Int,
               existing == current {
                continue
            }
            try fm.createDirectory(
                at: voiceMemosDestination,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            if fm.fileExists(atPath: to.path) { try fm.removeItem(at: to) }
            try fm.copyItem(at: file, to: to)
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: to.path)
            memoCopied += 1
        } catch {
            FileHandle.standardError.write(
                "bw-snapshot: FAILED recording \(name): \(error.localizedDescription)\n"
                    .data(using: .utf8)!
            )
            memoFailed += 1
        }
    }
}

print("bw-snapshot: \(copied) database(s) copied to \(destination.path)\(failed > 0 ? ", \(failed) FAILED" : "")")
print("bw-snapshot: \(audioCopied) audio attachment(s) copied\(audioFailed > 0 ? ", \(audioFailed) FAILED" : "")")
print(
    "bw-snapshot: \(memoCopied) recording(s) copied"
        + (memoSkipped > 0 ? ", \(memoSkipped) skip-listed as private" : "")
        + (memoFailed > 0 ? ", \(memoFailed) FAILED" : "")
)


// ⚠ A NON-ZERO EXIT IS THE ONLY SIGNAL THE CRON HAS. If this exits 0 having
// copied nothing, the sweep reads a stale snapshot and reports a quiet inbox —
// which is indistinguishable from there being no texts. A liveness check needs
// a clock, not a count (§12), so the sweep also checks the snapshot's age.
exit(failed > 0 || memoFailed > 0 || copied == 0 ? 1 : 0)
