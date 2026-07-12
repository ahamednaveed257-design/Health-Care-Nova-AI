import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const dataDir = resolve(rootDir, "data");
const integrityCacheTtlMs = 15_000;
let cachedReport = null;
let cachedReportAtMs = 0;

const integrityTargets = [
  {
    id: "offline_database",
    label: "Offline medical database",
    file: "data/offline-medical-db.json",
    required: true,
    kind: "json",
    lifecycle: "bundled",
    detail: "Curated offline medical seed database."
  },
  {
    id: "offline_repository",
    label: "Offline clinical repository",
    file: "data/offline-clinical-repository.json",
    required: true,
    kind: "json",
    lifecycle: "bundled",
    detail: "Expanded clinical retrieval corpus."
  },
  {
    id: "offline_index",
    label: "Offline knowledge index",
    file: "data/offline-knowledge-index.json",
    required: true,
    kind: "json",
    lifecycle: "bundled",
    detail: "Searchable offline knowledge index."
  },
  {
    id: "memory_store",
    label: "Patient memory store",
    file: "data/memory/patient-memory.json",
    required: false,
    kind: "json",
    lifecycle: "runtime-generated",
    detail: "Persistent local memory store created after patient interactions."
  },
  {
    id: "record_store",
    label: "Patient record store",
    file: "data/records/patient-records.json",
    required: false,
    kind: "json",
    lifecycle: "runtime-generated",
    detail: "Persistent local record store created after record saves."
  },
  {
    id: "browser_state_store",
    label: "Browser state recovery store",
    file: "data/browser-state/browser-state.json",
    required: false,
    kind: "json",
    lifecycle: "runtime-generated",
    detail: "Browser-state recovery snapshots created after offline reconnect sync."
  },
  {
    id: "knowledge_graph_store",
    label: "Patient knowledge graph",
    file: "data/graph/patient-knowledge-graph.json",
    required: false,
    kind: "json",
    lifecycle: "runtime-generated",
    detail: "Structured local graph store created after analysis or profile updates."
  },
  {
    id: "training_store",
    label: "Training calibration store",
    file: "data/training/agent-training-state.json",
    required: false,
    kind: "json",
    lifecycle: "runtime-generated",
    detail: "Local calibration state created after training feedback is recorded."
  },
  {
    id: "external_cache",
    label: "External knowledge cache",
    file: "data/external/external-knowledge-cache.json",
    required: false,
    kind: "json",
    lifecycle: "runtime-generated",
    detail: "Optional online knowledge cache kept locally when external retrieval is enabled."
  },
  {
    id: "medicine_cache",
    label: "Medicine lookup cache",
    file: "data/external/medicine-lookup-cache.json",
    required: false,
    kind: "json",
    lifecycle: "runtime-generated",
    detail: "Optional local medicine lookup cache."
  },
  {
    id: "audit_log",
    label: "Operational audit log",
    file: "data/audit/operational-audit-log.json",
    required: false,
    kind: "json",
    lifecycle: "runtime-generated",
    detail: "Enterprise audit log created after operational events are recorded."
  },
  {
    id: "review_history",
    label: "Enterprise review history",
    file: "data/audit/admin-review-history.json",
    required: false,
    kind: "json",
    lifecycle: "runtime-generated",
    detail: "Enterprise release and governance review snapshots created after review saves."
  },
  {
    id: "mirror_manifest",
    label: "OneDrive mirror manifest",
    file: "data/onedrive-mirror/mirror-manifest.json",
    required: false,
    kind: "json",
    lifecycle: "runtime-generated",
    onlyWhenMirrorEnabled: true,
    detail: "Mirror manifest created after the first local-data-mirror sync."
  }
];

export function getStorageIntegrityTargetCatalog() {
  return integrityTargets.map((target) => ({
    id: target.id,
    label: target.label,
    file: target.file,
    required: target.required,
    lifecycle: target.lifecycle
  }));
}

export async function getStorageIntegrityReport(env = process.env) {
  const nowMs = Date.now();

  if (cachedReport && (nowMs - cachedReportAtMs) < integrityCacheTtlMs) {
    return cachedReport;
  }

  const mirrorEnabled = env.CARE_NOVA_ONEDRIVE_MIRROR_ENABLED !== "false";
  const checks = [];

  for (const target of integrityTargets) {
    if (target.onlyWhenMirrorEnabled && !mirrorEnabled) {
      checks.push({
        id: target.id,
        label: target.label,
        file: target.file,
        status: "pass",
        lifecycle: target.lifecycle,
        bytes: 0,
        updatedAt: "",
        detail: "Mirror-specific integrity check is skipped because the local OneDrive mirror is disabled."
      });
      continue;
    }

    checks.push(await inspectTarget(target));
  }

  const failCount = checks.filter((check) => check.status === "fail").length;
  const reviewCount = checks.filter((check) => check.status === "review").length;
  const passCount = checks.filter((check) => check.status === "pass").length;
  const criticalReady = !checks.some((check) => check.required && check.status !== "pass");

  cachedReport = {
    ok: true,
    status: failCount
      ? "storage-integrity-review-needed"
      : reviewCount
        ? "storage-integrity-monitored"
        : "storage-integrity-healthy",
    summary: {
      criticalReady,
      checkedFiles: checks.length,
      passCount,
      reviewCount,
      failCount,
      latestCheckAt: new Date().toISOString(),
      generatedDataMissing: checks.filter((check) => check.status === "review").map((check) => check.id)
    },
    checks,
    timestamp: new Date().toISOString()
  };
  cachedReportAtMs = nowMs;

  return cachedReport;
}

async function inspectTarget(target) {
  const absoluteFile = resolve(rootDir, target.file);
  const fileStats = await stat(absoluteFile).catch((error) => {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  });

  if (!fileStats) {
    return {
      id: target.id,
      label: target.label,
      file: target.file,
      status: target.required ? "fail" : "review",
      lifecycle: target.lifecycle,
      bytes: 0,
      updatedAt: "",
      detail: target.required
        ? "Required deployment file is missing."
        : "Runtime-generated file has not been created yet."
    };
  }

  try {
    if (target.kind === "json") {
      const raw = await readFile(absoluteFile, "utf8");
      JSON.parse(raw);
    }

    return {
      id: target.id,
      label: target.label,
      file: target.file,
      status: "pass",
      lifecycle: target.lifecycle,
      bytes: fileStats.size,
      updatedAt: fileStats.mtime.toISOString(),
      detail: target.detail
    };
  } catch (error) {
    return {
      id: target.id,
      label: target.label,
      file: target.file,
      status: "fail",
      lifecycle: target.lifecycle,
      bytes: fileStats.size,
      updatedAt: fileStats.mtime.toISOString(),
      detail: `File exists but could not be parsed safely: ${error.message || "unknown parse error"}`
    };
  }
}

export function getStorageIntegrityDataRoot() {
  return dataDir;
}
