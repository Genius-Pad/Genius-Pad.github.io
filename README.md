# Genius·Pad — Kit Catalog & Builder

A kit catalog for Genius·Pad sample kits, plus the browser tool used to
build and publish them. The site itself is static (GitHub Pages) — the
only backend is a small Cloudflare Worker whose one job is accepting kit
submissions from people who don't have (and shouldn't need) a GitHub
account.

**Live site:** https://genius-pad.github.io/

## What's in this repo

- `index.html` + `gpad-core.js` — the kit builder, a single offline HTML
  page. Drop audio onto a 4×16 pad grid, trim it, and export a `.gp` kit
  archive. No install, no build step — open `index.html` directly or visit
  the live site above.
- `catalog.json` — the list of published kits (name, author, bpm, size,
  sha256, file path). The builder's **Catalog** panel reads this to show
  what's available; **Publish** helps prepare a new entry for it.
- `kits/*.gp` — the actual kit archives listed in `catalog.json`.
- `scripts/validate-catalog.cjs` + `.github/workflows/validate-catalog.yml`
  — the automated check every Pull Request gets, see below.
- `admin.html` — token-gated review queue for the catalog owner: see
  what's been submitted, download/preview it, Approve or Reject.
- New here? Click **Guide** in the builder's header for a short 4-step
  walkthrough (what a kit is, how the 4 banks/16 pads are meant to be used,
  how to build/publish, how to browse/download).

Right now the catalog holds two small demo kits (synthesized tones/noise,
just to prove the plumbing works end to end) — real kits go in as people
publish them.

## Browsing / downloading kits

Open the [live site](https://genius-pad.github.io/) and
click **Catalog**. Each entry has:

- **Download** — grabs the `.gp` file.
- **Load** — pulls it straight into the builder so you can look inside,
  tweak it, or re-export.

A kit's `sha256` is checked against the downloaded bytes before it loads —
if it doesn't match, you get a warning instead of a silently broken kit.

## Publishing a kit

Build it in the [builder](https://genius-pad.github.io/), click **Publish**.
Two ways from there:

- **Submit for review** — the normal way. No GitHub account. Type a name,
  optionally a note, hit submit. It's sent to a small backend
  (`gpad-submit-worker`, see below) that queues it for the catalog owner to
  approve. You keep using your own copy locally in the meantime — nothing
  about submitting takes the file away from you.
- **Advanced: publish via GitHub yourself** — collapsed under that heading
  in the same dialog. For people who do have a GitHub account and would
  rather commit it themselves: download the `.gp`, upload it to `kits/`,
  paste the JSON entry into `catalog.json`, open a Pull Request. See
  **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full walkthrough.

Either way, nothing reaches the live catalog without a human — the catalog
owner — approving it. A submission through the Worker becomes an ordinary
commit only once approved in `admin.html`; a Pull Request only merges once
reviewed. Every PR also gets an automated check first
(`scripts/validate-catalog.cjs`, run by `.github/workflows/validate-catalog.yml`):
sha256 must match, the file must pass the same structural check the builder
uses on import, and it must be **under 20 MB**. A green check doesn't merge
anything by itself.

## gpad-submit-worker

`tools/gpad-submit-worker/` isn't in this repo — it's a separate Cloudflare
Worker deployed from the main development repo (kept there so its source
lives next to the `gpad-core.js` it depends on). It's what makes "Submit
for review" possible without a GitHub account: it validates the kit,
holds it in a review queue, and — only once the owner clicks Approve in
`admin.html` — commits it to this repo using its own bot credentials
(never exposed to the browser or stored here).

## Format

A `.gp` file is a plain zip (`stored`/`deflate`, no custom compression):

```
kit.json                    # format 2: name, author, bpm, banks[4].pads[16]
_.wav                       # silent placeholder for empty pads
samples/A/<label>.wav …     # 16-bit PCM mono
```

`gpad-core.js` is dependency-free and has no DOM code — it's the same file
whether it's running in this page or under Node, so the exact same logic
that builds a kit also validates one on the way back in.

## Only kits, not the app

This repo is the **kit catalog and browser builder only**. The Genius·Pad
Android app itself is a separate, private project — nothing here is its
source code, just the tool for making sounds it can load.
