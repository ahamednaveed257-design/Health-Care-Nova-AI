# Care Nova AI GitHub-Ready Package

This folder is a clean public GitHub package for Care Nova AI. It contains the frontend, backend, API routes, agentic AI source code, offline medical seed database, install/PWA files, Docker files, and local verification scripts.

## File Size Rule

Every file in this folder is kept below 5 MB. Large optional assets are split into chunks under `large-assets/`, and the patient graph shards are bundled into 11 compressed files under `data/graph/patients/`.

## Included

- Frontend: `public/index.html`, `public/app.js`, CSS, icons, manifest, service worker.
- GitHub Pages entry: `public/index.html` loads the packaged local CSS and app JS from this folder so the public link stays self-contained within the repository.
- Backend/API: `server.js` and all `src/*.js` agent/runtime modules.
- Agentic model: intent routing, risk scoring, local AI evidence ranking, safety guardrails, memory, records, training calibration, insurance, labs, medicine, vitals, specialist, atlas, visits, wellness, summary, and safety workflows.
- Offline seed data: `data/offline-medical-db.json`.
- Empty local-private folders: memory, records, training, external cache, and OneDrive mirror placeholders.
- Bundled patient graph archive: `data/graph/patients.bundle.manifest.json` plus 11 `_bundle.part*.json.gz` files inside `data/graph/patients/` for GitHub-safe packaging.
- Optional guide video split into chunks when available.

## Not Included

Private runtime patient memory, patient records, local training state, OneDrive mirror content, external cache files, logs, screenshots, and old render drafts are not included. The packaged patient graph files are compressed demo/runtime shards prepared only so the GitHub-ready folder stays uploadable.

## Run Locally After Clone

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run release:check
& 'C:\Program Files\nodejs\node.exe' server.js
```

Open:

```text
http://127.0.0.1:4173
```

## Restore Optional Guide Video

For GitHub Pages, do not upload the full 73 MB guide video as one file. The public Guide tab loads it from `large-assets/manifest.json` and the 19 small `.part-*` files in `large-assets/public__media__care-nova-ai-usage-guide-v24.webm/`.

Upload the entire `github-ready-care-nova-ai` folder contents, including:

- `.nojekyll`
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `public/calm-theme.css`
- `public/visual-polish.css`
- `large-assets/manifest.json`
- every file inside `large-assets/public__media__care-nova-ai-usage-guide-v24.webm/`

If you want the HD guide video restored after clone/download, run:

```powershell
& 'C:\Program Files\nodejs\node.exe' scripts\restore-large-assets.js
```

The restore script validates checksums before writing the video back to `public/media/`.

## Package Checks

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run github:package-check
& 'C:\Program Files\nodejs\npm.cmd' run release:check
```

Split assets: 1
Guide video chunks: 19
Total split media: 76,530,319 bytes
Chunk size: 4 MB
