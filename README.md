# Item Outcomes — Backup Lifecycle

An animated, dependency-free visualization of Velero's per-item backup outcomes artifact.

The page follows one KubeVirt backup through:

- item capture
- parentage capture
- volume-path skip and capture-time attempt
- first artifact write with `finalized:false`
- volume-info rescue
- final artifact write with `finalized:true`

The right-hand panel shows the artifact as it evolves, while the sequence diagram shows the server-side calls that change it.

## Run locally

No build step is required.

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

You can also open `index.html` directly, but a local server is recommended.

## Controls

- **Play / Pause** — run the storyboard
- **Step** — advance one step
- **Reset** — return to the first step
- **Speed** — change playback speed
- **Table / JSON** — switch artifact views
- **Space** — play or pause
- **Left / Right arrows** — step backward or forward

## Files

| File | Purpose |
|---|---|
| `index.html` | Layout and controls |
| `styles.css` | Dark theme, layout, animations |
| `app.js` | Storyboard reducer, SVG sequence renderer, artifact panel, playback |
| `data/storyboard.js` | Participants and the KubeVirt rescue scenario |

## Editing the storyboard

Each step combines a server call, narration, and an artifact mutation:

```js
{
  phase: "capture",
  from: "backupper",
  to: "recorder",
  call: "SkipVolume(disk1)",
  narration: "The pod-volume path declines the disk.",
  operation: {
    type: "patchRow",
    key: "persistentvolumeclaims|ns|disk1",
    patch: { outcome: "Skipped", skippedByVolume: true }
  },
  highlight: "persistentvolumeclaims|ns|disk1"
}
```

Supported operations:

| Operation | Effect |
|---|---|
| `envelope` | Patch `schemaVersion`, `kind`, `backupName`, or `finalized` |
| `upsertRow` | Add or merge one item row |
| `patchRow` | Patch one row and optionally remove fields |
| `volumeInfo` | Update the volume-info card |

## Deploying to GitHub Pages

The site is static. Two options:

1. Push the repository to a `gh-pages` branch and set Pages to serve that branch.
2. Add a GitHub Actions workflow using `actions/deploy-pages` and deploy the repository root.

No backend or build output is required.

## Status

Draft. The current scenario is the KubeVirt volume rescue. Additional scenarios planned:

- clean stateless item
- prehook failure
- asynchronous BIA operation and the finalize branch
- no-item-operations finalize
