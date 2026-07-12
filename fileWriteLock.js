import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const defaultAcquireTimeoutMs = 20_000;
const defaultStaleAfterMs = 15_000;
const defaultPollMs = 25;
const maxPollMs = 200;

export async function withFileWriteLock(targetFile, task, options = {}) {
  const lock = await acquireFileWriteLock(targetFile, options);

  try {
    return await task();
  } finally {
    await lock.release();
  }
}

export async function acquireFileWriteLock(targetFile, options = {}) {
  const lockPath = resolve(`${targetFile}.lock`);
  const acquireTimeoutMs = clampInteger(options.acquireTimeoutMs, defaultAcquireTimeoutMs, 1_000, 120_000);
  const staleAfterMs = clampInteger(options.staleAfterMs, defaultStaleAfterMs, 1_000, 300_000);
  const pollMs = clampInteger(options.pollMs, defaultPollMs, 10, maxPollMs);
  const token = buildLockToken();
  const deadline = Date.now() + acquireTimeoutMs;
  let attempt = 0;

  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    try {
      await writeFile(lockPath, JSON.stringify({
        pid: process.pid,
        token,
        createdAt: new Date().toISOString()
      }), {
        encoding: "utf8",
        flag: "wx"
      });

      return {
        lockPath,
        token,
        release: async () => {
          await releaseFileWriteLock(lockPath, token);
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      await clearStaleLock(lockPath, staleAfterMs);

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for the write lock on ${targetFile}.`);
      }

      await wait(Math.min(maxPollMs, pollMs + attempt * pollMs));
      attempt += 1;
    }
  }
}

async function clearStaleLock(lockPath, staleAfterMs) {
  const lockStats = await stat(lockPath).catch((error) => {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  });

  if (!lockStats) {
    return false;
  }

  const ageMs = Date.now() - Number(lockStats.mtimeMs || 0);

  if (!Number.isFinite(ageMs) || ageMs < staleAfterMs) {
    return false;
  }

  await rm(lockPath, { force: true }).catch((error) => {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  });

  return true;
}

async function releaseFileWriteLock(lockPath, token) {
  const metadata = await readLockMetadata(lockPath);

  if (metadata && metadata.token && metadata.token !== token) {
    return;
  }

  await rm(lockPath, { force: true }).catch((error) => {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  });
}

async function readLockMetadata(lockPath) {
  const raw = await readFile(lockPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return "";
    }

    throw error;
  });

  if (!raw.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function buildLockToken() {
  return `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
