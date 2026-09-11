# Genius·Pad — Kit Catalog & Builder

A no-backend kit catalog for Genius·Pad sample kits, plus the browser tool
used to build and publish them. Everything here is static — GitHub Pages
serves the files, and publishing new kits goes through a normal Pull
Request.

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

1. Build your kit in the [builder](https://genius-pad.github.io/)
   and click **Publish**. It shows you the `.gp` file to download and a
   ready-made JSON entry for `catalog.json` (with a **Copy** button).
2. On GitHub, open this repo's **Add file → Upload files** page for the
   `kits/` folder and drop your `.gp` there (the Publish dialog has an
   "Open upload page" shortcut for this once you've set the repo URL).
3. Edit `catalog.json` in the same commit/PR and paste in the entry.
4. Open a Pull Request. If you don't have write access, GitHub does this
   for you automatically once you commit through the web UI.

The repo owner reviews the PR (kit size, whether the sound is what the name
says) and merges. Nothing is published automatically — every kit here has
gone through a human review first.

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
