# Pepper's text channel — the one hand-built step

**Why this file exists.** Pepper texts from the Studio itself, so nothing leaves
the hardware. On macOS 27 that needs one shortcut per recipient, built by hand
once. There is no way to script this step, and the reason is worth recording.

## What changed under us

Measured on this box, 2026-10-12, macOS 27.0 (26A428):

```
$ sdef /System/Applications/Messages.app | grep -c '<command name="send"'
0
```

Messages ships **no scripting dictionary at all** — no `send`, no `buddy`, no
`service`. Every "send an iMessage from the terminal" recipe on the internet is
written against a dictionary this OS does not have.

⚠ **And it does not fail cleanly.** Messages accepts the Apple event and never
answers, so AppleScript hangs to its own timeout:

```
execution error: Messages got an error: AppleEvent timed out. (-1712)
```

Reproduced twice, with an explicit `with timeout of 20 seconds` block, against a
running Messages. `-1712` is a timeout, **not** `-1743` ("not authorized") — so
this is not a permissions problem and granting Automation will not fix it. On an
unattended 06:50 cron, an AppleScript transport would be a fifteen-minute hang
and a silently missing morning.

Apple's sanctioned replacement is the Shortcuts CLI, `/usr/bin/shortcuts`, which
is present and working here.

## Build the two shortcuts (about a minute each)

Open **Shortcuts.app** → **+** (new shortcut), then:

1. Add action **Send Message**.
2. For the message content, pick the **Shortcut Input** variable.
3. For the recipient, type the number:
   - Richard → `+1 801 815 9150`
   - Eric → `+1 385 436 6519`
4. In the shortcut's settings (ⓘ in the sidebar), make sure **Pin in Menu Bar**
   is off and the shortcut is allowed to run without asking. If macOS prompts
   the first time, allow it — the prompt is per-shortcut and does not come back.
5. Name them **exactly**:
   - `Pepper Text Richard`
   - `Pepper Text Eric`

Verify the names the platform will look for:

```bash
shortcuts list
```

## Tell the platform

In `.env.local` — one variable, semicolon-separated `email=handle=shortcut`:

```
PEPPER_TEXT_TARGETS=moose@berwilson.com=+18018159150=Pepper Text Richard;tuaone@berwilson.com=+13854366519=Pepper Text Eric
```

The handle is normalized on the way in, so `801-815-9150` is accepted and stored
as `+18018159150`. A malformed entry drops **that** entry and reports it; it
never widens to "send to everyone". `normalizeHandle` **refuses** anything it
cannot be sure of rather than guessing, because a wrong handle texts a deal's
obligations to a stranger.

Then, because the env is read at boot:

```bash
launchctl kickstart -k gui/$(id -u)/com.berwilson.platform
```

## Check it

```bash
zsh deploy/pepper-text-check.sh
```

Asserts `/usr/bin/shortcuts` exists, that every shortcut named in
`PEPPER_TEXT_TARGETS` is actually in `shortcuts list`, and that every handle
normalized. It does **not** send — a health check that texts somebody is a
health check nobody runs.

To send a real one:

```bash
curl -s -X POST localhost:3000/api/cron/pepper-text \
  -H "Authorization: Bearer $CRON_SECRET" -d '{"dryRun":false}'
```

## The trap this channel carries

⚠ **The Studio sends as Richard's own Apple ID.** A text to Eric therefore lands
in the Richard↔Eric conversation, which `IMESSAGE_INTERNAL_HANDLES` marks
internal and the sweep ingests unconditionally — and `is_from_me` cannot tell
Pepper's text from Richard's own, because his real texts are also from him and
those are exactly what the sweep is for.

This is the 2026-10-09 bug (131 of 481 open commitments were Pepper reading her
own morning notes) in a channel with no Gmail labels to spot it with. The guard
is therefore **structural**: every send is hashed into `pepper_outbound_texts`
*before* it goes, and ingestion drops what it finds there
(`src/lib/imessage/own-outbound.ts`). It does not depend on a prefix, a display
name or a sentence anybody might reword — §12, key the guard on what cannot be
renamed, **including by us**.

If the guard row cannot be written, **the message is not sent.** An unsent
morning text is a visible problem; a self-feeding ledger is an invisible one.
