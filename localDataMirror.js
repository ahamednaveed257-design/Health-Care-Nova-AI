import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const dataDir = resolve(rootDir, "data");
const defaultMirrorDir = resolve(dataDir, "onedrive-mirror");
const mirrorManifestName = "mirror-manifest.json";
const ignoredNames = new Set(["onedrive-mirror"]);
const transientMirrorErrorCodes = new Set(["ENOENT", "EBUSY", "EPERM"]);
let cachedMirrorManifest = { files: [], skippedFiles: [] };
let cachedMirrorManifestPath = "";
let cachedMirrorManifestMtimeMs = 0;
let mirrorManifestWriteQueue = Promise.resolve();

export function getLocalDataMirrorInfo(env = process.env) {
  const mirrorDir = resolveMirrorDir(env);
  const isOneDriveWorkspace = /onedrive/i.test(rootDir);

  return {
    mode: "localhost-primary-plus-onedrive-local-mirror",
    primaryRoot: "data",
    mirrorRoot: formatProjectRelativePath(mirrorDir),
    manifest: formatProjectRelativePath(resolve(mirrorDir, mirrorManifestName)),
    enabled: env.CARE_NOVA_ONEDRIVE_MIRROR_ENABLED !== "false",
    isOneDriveWorkspace,
    storagePolicy: "Write to localhost data files first, then copy the same data into the local OneDrive mirror folder.",
    trackedData: [
      "audit logs",
      "memory",
      "records",
      "browser state recovery snapshots",
      "graph",
      "training calibration",
      "external cache",
      "offline medical database"
    ]
  };
}

export async function getLocalDataMirrorStatus(env = process.env) {
  const info = getLocalDataMirrorInfo(env);
  const manifest = await readMirrorManifest(resolveMirrorDir(env));

  return {
    ...info,
    status: info.enabled ? "mirror-ready" : "mirror-disabled",
    lastSyncedAt: manifest?.syncedAt || "",
    lastReason: manifest?.reason || "",
    fileCount: manifest?.fileCount || 0,
    files: Array.isArray(manifest?.files) ? manifest.files : []
  };
}

export async function syncLocalDataMirror(reason = "manual-sync", env = process.env, options = {}) {
  const info = getLocalDataMirrorInfo(env);

  if (!info.enabled) {
    return {
      ...info,
      status: "mirror-disabled",
      reason,
      syncedAt: new Date().toISOString(),
      fileCount: 0,
      files: []
    };
  }

  const mirrorDir = resolveMirrorDir(env);
  const previousManifest = await readMirrorManifest(mirrorDir);
  const previousFiles = new Map((previousManifest.files || []).map((file) => [file.source, file]));
  const requestedFiles = Array.isArray(options.files) ? options.files.filter(Boolean) : [];
  const files = requestedFiles.length
    ? await resolveRequestedDataFiles(requestedFiles, mirrorDir)
    : await listDataFiles(dataDir, mirrorDir);
  const syncedFiles = [];
  const skippedFiles = [];
  let copiedCount = 0;

  await mkdir(mirrorDir, { recursive: true });

  for (const sourceFile of files) {
    const relativePath = relative(dataDir, sourceFile);
    const targetFile = resolve(mirrorDir, relativePath);
    const sourceLabel = formatProjectRelativePath(sourceFile);
    const mirrorLabel = formatProjectRelativePath(targetFile);

    try {
      const details = await stat(sourceFile);
      const manifestEntry = {
        source: sourceLabel,
        mirror: mirrorLabel,
        bytes: details.size,
        updatedAt: details.mtime.toISOString()
      };
      const previous = previousFiles.get(sourceLabel);
      const targetStats = await stat(targetFile).catch((error) => {
        if (error.code === "ENOENT") {
          return null;
        }

        throw error;
      });

      if (
        previous &&
        targetStats &&
        previous.bytes === manifestEntry.bytes &&
        previous.updatedAt === manifestEntry.updatedAt &&
        targetStats.size === manifestEntry.bytes
      ) {
        syncedFiles.push({
          ...manifestEntry,
          copied: false
        });
        continue;
      }

      await mkdir(dirname(targetFile), { recursive: true });
      await copyFile(sourceFile, targetFile);
      copiedCount += 1;
      syncedFiles.push({
        ...manifestEntry,
        copied: true
      });
    } catch (error) {
      if (!transientMirrorErrorCodes.has(error.code)) {
        throw error;
      }

      skippedFiles.push({
        source: sourceLabel,
        reason: error.code || "transient-local-file-change"
      });
    }
  }

  const manifestFiles = requestedFiles.length
    ? mergeManifestFiles(previousManifest.files, syncedFiles)
    : syncedFiles;
  const manifest = {
    ...info,
    status: "mirror-synced",
    reason,
    syncedAt: new Date().toISOString(),
    fileCount: manifestFiles.length,
    copiedCount,
    files: manifestFiles,
    skippedFiles
  };

  await writeMirrorManifest(mirrorDir, manifest);

  return manifest;
}

async function resolveRequestedDataFiles(requestedFiles, mirrorDir) {
  const output = [];
  const seen = new Set();

  for (const requestedFile of requestedFiles) {
    const candidate = resolveDataSourcePath(requestedFile);

    if (!isInside(candidate, dataDir) || isInside(candidate, mirrorDir)) {
      continue;
    }

    const details = await stat(candidate).catch((error) => {
      if (error.code === "ENOENT") {
        return null;
      }

      throw error;
    });

    if (!details?.isFile()) {
      continue;
    }

    const key = candidate.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(candidate);
  }

  return output.sort();
}

function resolveDataSourcePath(sourceFile) {
  const sourceText = String(sourceFile || "")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
  const dataRelativePath = sourceText.startsWith("data/")
    ? sourceText.slice("data/".length)
    : sourceText;

  return resolve(dataDir, dataRelativePath);
}

function mergeManifestFiles(previousFiles = [], syncedFiles = []) {
  const merged = new Map();

  for (const file of previousFiles) {
    if (file?.source) {
      merged.set(file.source, file);
    }
  }

  for (const file of syncedFiles) {
    if (file?.source) {
      merged.set(file.source, file);
    }
  }

  return [...merged.values()].sort((first, second) => first.source.localeCompare(second.source));
}

async function readMirrorManifest(mirrorDir) {
  try {
    await mirrorManifestWriteQueue.catch(() => {});

    const manifestPath = resolve(mirrorDir, mirrorManifestName);
    const manifestStats = await stat(manifestPath).catch((error) => {
      if (error.code === "ENOENT") {
        return null;
      }

      throw error;
    });

    if (
      cachedMirrorManifestPath === manifestPath &&
      cachedMirrorManifest &&
      (
        (manifestStats && cachedMirrorManifestMtimeMs === manifestStats.mtimeMs) ||
        (!manifestStats && cachedMirrorManifestMtimeMs === 0)
      )
    ) {
      return cachedMirrorManifest;
    }

    if (!manifestStats) {
      cachedMirrorManifest = { files: [], skippedFiles: [] };
      cachedMirrorManifestPath = manifestPath;
      cachedMirrorManifestMtimeMs = 0;
      return cachedMirrorManifest;
    }

    const manifest = normalizeMirrorManifest(JSON.parse(await readFile(manifestPath, "utf8")));

    cachedMirrorManifest = manifest;
    cachedMirrorManifestPath = manifestPath;
    cachedMirrorManifestMtimeMs = manifestStats.mtimeMs;

    return manifest;
  } catch {
    return { files: [], skippedFiles: [] };
  }
}

async function writeMirrorManifest(mirrorDir, manifest = {}) {
  const manifestPath = resolve(mirrorDir, mirrorManifestName);
  const normalizedManifest = normalizeMirrorManifest(manifest);
  const body = `${JSON.stringify(normalizedManifest, null, 2)}\n`;

  mirrorManifestWriteQueue = mirrorManifestWriteQueue.catch(() => {}).then(async () => {
    await writeFile(manifestPath, body, "utf8");
    const manifestStats = await stat(manifestPath).catch(() => null);

    cachedMirrorManifest = normalizedManifest;
    cachedMirrorManifestPath = manifestPath;
    cachedMirrorManifestMtimeMs = manifestStats?.mtimeMs || Date.now();
  });

  await mirrorManifestWriteQueue;
  return normalizedManifest;
}

async function listDataFiles(sourceDir, mirrorDir) {
  const output = [];
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (ignoredNames.has(entry.name) || entry.name.endsWith(".tmp")) {
      continue;
    }

    const entryPath = resolve(sourceDir, entry.name);

    if (isInside(entryPath, mirrorDir)) {
      continue;
    }

    if (entry.isDirectory()) {
      output.push(...await listDataFiles(entryPath, mirrorDir));
      continue;
    }

    if (entry.isFile()) {
      output.push(entryPath);
    }
  }

  return output.sort();
}

function resolveMirrorDir(env = process.env) {
  return resolve(env.CARE_NOVA_ONEDRIVE_MIRROR_DIR || defaultMirrorDir);
}

function resolveMirrorManifestPath(env = process.env) {
  return resolve(resolveMirrorDir(env), mirrorManifestName);
}

function isInside(candidate, parent) {
  const normalizedCandidate = resolve(candidate);
  const normalizedParent = resolve(parent);
  const prefix = normalizedParent.endsWith(sep) ? normalizedParent : `${normalizedParent}${sep}`;

  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(prefix);
}

function normalizeMirrorManifest(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? {
      ...value,
      files: Array.isArray(value.files) ? value.files : [],
      skippedFiles: Array.isArray(value.skippedFiles) ? value.skippedFiles : []
    }
    : { files: [], skippedFiles: [] };
}

function formatProjectRelativePath(filePath) {
  const projectRelative = relative(rootDir, filePath).replace(/\\/g, "/");

  if (!projectRelative || projectRelative.startsWith("..")) {
    return filePath;
  }

  return projectRelative;
}
