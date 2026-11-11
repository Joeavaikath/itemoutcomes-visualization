# Item Outcomes — Backup Lifecycle

An animated, dependency-free visualization of Velero's per-item backup outcomes artifact.

The page includes thirteen server-side scenarios:

| Scenario | What it shows |
|---|---|
| KubeVirt volume rescue | item capture, ownership and reporting, volume-path skip, capture-time attempt, CSI rescue |
| Clean stateless item | one ConfigMap and the no-item-operations finalize path |
| Prehook failure | a Pod row recorded before `Observe`, then raised to Failed |
| Async BIA failure | an operation that settles after the first write and fails the item at finalize |
| Finalize overlays | `Merge`, `ApplyOperations`, and `ApplyVolumes` over one stored artifact |
| Volume failure | a captured disk fails and the owning PVC row becomes Failed |
| Pending operation | an unexpected pending operation at finalize leaves the artifact unfinalized |
| Posthook failure | a Pod is backed up, then its posthook fails after the archive write |
| Item skip after volume skip | an item-level skip clears the marker, so a captured disk cannot rescue it |
| Rename and rekey | a reporting item is renamed and the provenance edge follows the final identity |
| Multiple attempts and cap | ten attempts merge, sort worst-first, cap at eight, and record the dropped count |
| PV-owned volume | the PVC is absent, so the volume summary lands on the PV row |
| Owner and reporter | a PVC keeps its controller owner while additional-item reporters are preserved |

`owner` is the controller ownerReference; `reportedBy` is additional-item provenance, not parentage. A row can have both, and neither overrides the other.

The hook scenarios show the intended per-item attribution. Current upstream hook handling has a known `on-error` gap (#10816); until fixed, hook failures may only appear in `Backup.status.hookStatus`.

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

Draft. The thirteen scenarios above are implemented. Still to add:

- a scenario selector deep link so a specific step can be shared
- a “watch” mode that auto-advances without narration
- an artifact-diff view between two steps
