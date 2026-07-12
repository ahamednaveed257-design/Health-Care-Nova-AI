# Care Nova AI Local Project File Map

This file explains where the complete local Care Nova AI model lives inside the `Health care Advisor` folder after removing GitHub-only deployment artifacts.

## Main Model Files

- `server.js`: local Node server, API routes, health probes, and localhost runtime.
- `src/healthEngine.js`: core agentic healthcare workflow, intent routing, risk scoring, guardrails, response synthesis, and specialist-agent orchestration.
- `src/localAiEngine.js`: local evidence ranking, calibration, and offline reasoning layer.
- `src/hybridModelRouter.js`: local/free plus paid/cloud provider catalog, cost-aware route selection, connectivity policy, and fallback chains.
- `src/agenticRuntime.js`: adaptive online/offline runtime policy, API fallback strategy, and plan-execute-validate trace builder.
- `src/offlineMedicalDatabase.js`: offline medical database, repository, manifest, and retrieval-index loader.
- `src/medicineLookupStore.js`: medicine lookup cache and safety lookup support.
- `src/memoryStore.js`: persistent local patient memory.
- `src/recordStore.js`: patient record storage.
- `src/knowledgeGraphStore.js`: patient knowledge graph storage.
- `src/localDataMirror.js`: local OneDrive mirror support.
- `src/trainingEngine.js`: governed local feedback and calibration state.
- `src/externalKnowledgeStore.js`: optional online-source cache layer.
- `src/enterprisePatientAccess.js`: patient-scoped access token policy for shared/public deployments.
- `src/productIntelligence.js`: capability and readiness metadata.
- `src/advancedCapabilityEngine.js`: advanced safety, evidence, report, and readiness features.

## User Interface Files

- `public/index.html`: complete Care Nova AI interface.
- `public/app.js`: all tab behavior, UI state, agent interactions, install flow, local records, and browser-side workflows.
- `public/styles.css`: main interface styling.
- `public/calm-theme.css`: calm theme styling.
- `public/visual-polish.css`: layout polish, icons, spacing, and responsive styling.
- `public/sw.js`: offline app shell and installed-app service worker.
- `public/site.webmanifest`: installable app metadata.
- `public/favicon.svg` and `public/app-icon.svg`: app icons.
- `public/media/care-nova-guide-poster.svg`: guide poster.
- `public/media/README.md`: optional guide video instructions.
- `index.html`: root app shell copy for easy local opening.

## Data Files

- `data/offline-medical-db.json`: curated offline medical seed database.
- `data/offline-clinical-repository.json`: generated expanded offline repository records.
- `data/offline-knowledge-index.json`: generated local lexical/vector-style retrieval index.
- `data/offline-repository-manifest.json`: source-family, update, validation, and maintenance manifest.
- `data/README.md`: explains which data is safe and which data stays local.
- `data/memory/.gitkeep`: keeps the memory folder visible without uploading patient memory.
- `data/records/.gitkeep`: keeps the records folder visible without uploading patient records.
- `data/graph/.gitkeep`: keeps the graph folder visible without uploading patient graph data.
- `data/training/.gitkeep`: keeps the training folder visible without uploading local calibration data.
- `data/external/.gitkeep`: keeps the external cache folder visible without uploading cached online references.
- `data/onedrive-mirror/.gitkeep`: keeps the OneDrive mirror folder visible without uploading private mirror files.

## Local Utility Files

- `scripts/model-file-check.js`: verifies required local model, UI, and data files exist.
- `scripts/build-offline-repository.js`: rebuilds the expanded offline clinical repository and retrieval index.
- `scripts/smoke-test.js`: healthcare scenario smoke tests.
- `scripts/deployment-check.js`: local deployment and readiness checks.
- `Dockerfile`, `.dockerignore`, `.env.example`: local deployment packaging and safe configuration template.
- `start-care-nova.cmd` and `start-care-nova-global.cmd`: Windows launch helpers.
- `release-check.cmd`: Windows release gate.
- `videos/care-nova-ai-usage-video/`: source files for the optional guide video.

## Local-Only Runtime Files

These are intentionally kept local:

- `data/memory/*.json`
- `data/records/*.json`
- `data/graph/*.json`
- `data/training/*.json`
- `data/external/*.json`
- `data/onedrive-mirror/**`
- `public/media/*.webm`
- `videos/**/renders/`
- `*.log`, screenshots, test traces, and reports

## Required Checks

Run these before using or sharing the local model:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run model:files
& 'C:\Program Files\nodejs\npm.cmd' run check
& 'C:\Program Files\nodejs\npm.cmd' run deploy:check
& 'C:\Program Files\nodejs\npm.cmd' run release:check
```
