# Publishing a kit

Two ways to do this. Most people want the first one.

## The easy way: Submit for review

No account, no CLI, nothing to fill in but a name. Open the
[builder](https://genius-pad.github.io/), drop sounds onto the pad grid,
trim/name them, click **Publish**, then **Submit for review**. That's it —
your kit goes into a queue the catalog owner reviews (see "What happens
after you submit" below). You keep using your own `.gp` locally the whole
time; submitting doesn't take it away from you or require anything else.

## The GitHub way: open a Pull Request yourself

For people who already have a GitHub account and would rather commit it
themselves instead of waiting on a review queue. In the Publish dialog,
open **Advanced: publish via GitHub yourself**.

### 1. Build it

The advanced panel:
- computes the kit's **sha256** and shows its size,
- warns right there if the kit is over the **20 MB** catalog limit (trim
  samples or drop a pad if you see that warning — a PR over the limit will
  be rejected automatically, see below),
- gives you a **Download .gp** button,
- gives you a ready-made **catalog.json entry** (JSON, with a Copy button).

### 2. Upload the file

On this repo, go to **Add file → Upload files**, open the `kits/` folder,
and drop your `.gp` in. (The Publish dialog's "Open upload page" button does
this for you once you've set the repo/branch fields.)

If you don't have write access to this repo, GitHub automatically forks it
and opens this as a Pull Request for you — that's expected, not an error.

### 3. Add the catalog entry

In the same commit/PR, open `catalog.json` in GitHub's web editor and paste
the entry the Publish dialog gave you into the `kits` array (keep the
trailing comma rules valid — it's just JSON).

### 4. Open the Pull Request

If GitHub didn't already turn your upload into one, open a Pull Request
against `master`.

## What happens after you submit (the easy way)

Submissions go to `gpad-submit-worker`, a small Cloudflare Worker with its
own review queue (`admin.html`) — not straight into the catalog. It checks
the kit's structure and size the moment you submit (same rules as below),
holds it, and only becomes a real commit to this repo once the catalog
owner clicks **Approve**. There's no notification when that happens (no
account to notify) — check back on the site, your kit will just be in the
Catalog once it's in.

## What happens automatically (the GitHub way)

A GitHub Actions check (`validate-catalog.yml`) runs on every PR that
touches `catalog.json` or `kits/**`. It:

- re-parses `catalog.json` and checks every entry has the fields it needs,
- makes sure `file` points at a real `.gp` under `kits/`,
- **recomputes the sha256** of that file and compares it to the entry — a
  mismatch fails the check,
- **rejects anything over 20 MB** (`GpadCore.MAX_KIT_BYTES`, same number the
  Publish dialog warns about),
- checks `sizeBytes` actually matches the file on disk,
- runs the exact same structural validator the builder uses on import
  (`validateGpadStructure` — 4 banks × 16 pads, samples exist, 16-bit PCM
  WAV, no path traversal) against the real bytes, not just the metadata,
- flags orphan `.gp` files nobody's `catalog.json` entry points at, and
  duplicate `id`s.

Run it yourself before opening a PR with `node scripts/validate-catalog.cjs`
— same check, same result, no waiting on CI.

A green check doesn't merge anything by itself — a human (the catalog
owner) still reviews the PR (does the kit sound like what it's named,
does the size make sense) and merges it. The check just means the owner
isn't the one who has to catch a corrupted zip or a bad hash by hand.

## What's *not* checked

Nobody automatically listens to your kit. The bot can tell you a kick.wav
is really 16-bit PCM audio — it can't tell you it's a good kick. That part's
still a human looking at the PR.
