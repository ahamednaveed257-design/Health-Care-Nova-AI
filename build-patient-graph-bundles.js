#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultMaxBundleBytes = 5 * 1024 * 1024;
const bundlePartPrefix = "_bundle.part";

export async function buildPatientGraphBundles({
  rootDir = defaultRootDir,
  targetRoot = rootDir,
  maxBundleBytes = defaultMaxBundleBytes,
  targetPartCount = null,
  removeSourceShards = false
} = {}) {
  const patientsDir = path.join(targetRoot, "data", "graph", "patients");
  const manifestPath = path.join(targetRoot, "data", "graph", "patients.bundle.manifest.json");

  if (!existsSync(patientsDir)) {
    return {
      ok: true,
      skipped: true,
      reason: "patients-directory-missing",
      patientsDir
    };
  }

  await mkdir(patientsDir, { recursive: true });

  const entries = await readdir(patientsDir, { withFileTypes: true });
  const patientFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("_bundle."))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (!patientFiles.length) {
    return {
      ok: true,
      skipped: true,
      reason: "no-patient-shards-to-bundle",
      patientsDir
    };
  }

  const generatedAt = new Date().toISOString();
  const patientEntries = [];
  let totalSourceBytes = 0;

  for (const fileName of patientFiles) {
    const fullPath = path.join(patientsDir, fileName);
    const raw = await readFile(fullPath, "utf8").catch((error) => {
      if (error.code === "ENOENT") {
        return null;
      }

      throw error;
    });

    if (raw === null) {
      continue;
    }

    const patientId = fileName.replace(/\.json$/i, "");
    const payload = JSON.parse(raw);
    const bytes = Buffer.byteLength(raw, "utf8");

    totalSourceBytes += bytes;
    patientEntries.push({
      patientId,
      payload,
      fileName,
      bytes
    });
  }

  const parts = buildBundleParts(patientEntries, generatedAt, maxBundleBytes, targetPartCount)
    .map((part, index) => ({
      ...part,
      file: `${bundlePartPrefix}${String(index + 1).padStart(2, "0")}.json.gz`
    }));

  await clearExistingBundleFiles(patientsDir);

  for (const part of parts) {
    await writeFile(path.join(patientsDir, part.file), part.buffer);
  }

  const manifest = {
    version: 1,
    generatedAt,
    compression: "gzip",
    maxBundleBytes,
    patientCount: patientEntries.length,
    totalSourceBytes,
    totalCompressedBytes: parts.reduce((total, part) => total + part.bytes, 0),
    partCount: parts.length,
    parts: parts.map((part) => ({
      file: part.file,
      bytes: part.bytes,
      rawBytes: part.rawBytes,
      patientCount: part.patientCount,
      firstPatientId: part.firstPatientId,
      lastPatientId: part.lastPatientId,
      patientIds: part.patientIds
    }))
  };

  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  if (removeSourceShards) {
    for (const fileName of patientFiles) {
      await rm(path.join(patientsDir, fileName), { force: true });
    }
  }

  return {
    ok: true,
    patientsDir,
    patientCount: patientEntries.length,
    totalSourceBytes,
    totalCompressedBytes: manifest.totalCompressedBytes,
    partCount: parts.length,
    parts: manifest.parts
  };
}

function buildBundleParts(entries, generatedAt, maxBundleBytes, targetPartCount) {
  if (Number.isInteger(targetPartCount) && targetPartCount > 1) {
    const groups = partitionEntriesByTargetCount(entries, targetPartCount);
    const parts = groups.map((group) => createBundlePart(group, generatedAt));

    for (const part of parts) {
      if (part.bytes > maxBundleBytes) {
        throw new Error(`A fixed patient graph bundle part exceeded the ${maxBundleBytes} byte limit.`);
      }
    }

    return parts;
  }

  return splitBundleEntries(entries, generatedAt, maxBundleBytes);
}

function splitBundleEntries(entries, generatedAt, maxBundleBytes) {
  const part = createBundlePart(entries, generatedAt);

  if (part.bytes <= maxBundleBytes) {
    return [part];
  }

  if (entries.length <= 1) {
    throw new Error(`Patient graph bundle entry '${entries[0]?.patientId || "unknown"}' exceeds the ${maxBundleBytes} byte limit by itself.`);
  }

  const midpoint = Math.ceil(entries.length / 2);
  return [
    ...splitBundleEntries(entries.slice(0, midpoint), generatedAt, maxBundleBytes),
    ...splitBundleEntries(entries.slice(midpoint), generatedAt, maxBundleBytes)
  ];
}

function partitionEntriesByTargetCount(entries, requestedPartCount) {
  const targetPartCount = Math.max(1, Math.min(requestedPartCount, entries.length));
  const totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  const targetBytesPerPart = Math.ceil(totalBytes / targetPartCount);
  const groups = [];
  let currentGroup = [];
  let currentBytes = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const remainingEntries = entries.length - index;
    const remainingParts = targetPartCount - groups.length;

    if (
      currentGroup.length > 0
      && currentBytes >= targetBytesPerPart
      && remainingEntries >= remainingParts
    ) {
      groups.push(currentGroup);
      currentGroup = [];
      currentBytes = 0;
    }

    currentGroup.push(entry);
    currentBytes += entry.bytes;

    const remainingAfterThis = entries.length - index - 1;
    const groupsNeededAfterThis = targetPartCount - groups.length - 1;

    if (currentGroup.length > 0 && remainingAfterThis === groupsNeededAfterThis) {
      groups.push(currentGroup);
      currentGroup = [];
      currentBytes = 0;
    }
  }

  if (currentGroup.length) {
    groups.push(currentGroup);
  }

  return groups.filter((group) => group.length);
}

function createBundlePart(entries, generatedAt) {
  const patients = Object.fromEntries(entries.map((entry) => [entry.patientId, entry.payload]));
  const rawBuffer = Buffer.from(JSON.stringify({
    version: 1,
    generatedAt,
    patientCount: entries.length,
    patients
  }), "utf8");
  const buffer = gzipSync(rawBuffer, { level: 9 });

  return {
    buffer,
    bytes: buffer.length,
    rawBytes: rawBuffer.length,
    patientCount: entries.length,
    firstPatientId: entries[0]?.patientId || "",
    lastPatientId: entries.at(-1)?.patientId || "",
    patientIds: entries.map((entry) => entry.patientId)
  };
}

async function clearExistingBundleFiles(patientsDir) {
  const entries = await readdir(patientsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("_bundle.")) {
      continue;
    }

    await rm(path.join(patientsDir, entry.name), { force: true });
  }
}

const invokedAsMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMain) {
  const targetArg = process.argv[2];
  const targetRoot = targetArg
    ? path.resolve(process.cwd(), targetArg)
    : defaultRootDir;
  const result = await buildPatientGraphBundles({
    rootDir: defaultRootDir,
    targetRoot,
    targetPartCount: 11,
    removeSourceShards: true
  });

  if (result.skipped) {
    console.log(`Patient graph bundling skipped: ${result.reason}`);
  } else {
    console.log("Patient graph bundles built.");
    console.log(`Patients: ${result.patientCount}`);
    console.log(`Parts: ${result.partCount}`);
    console.log(`Compressed MB: ${(result.totalCompressedBytes / (1024 * 1024)).toFixed(2)}`);
  }
}
