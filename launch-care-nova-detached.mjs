import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");

function readArg(flag, fallback = "") {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && index + 1 < process.argv.length) {
    return String(process.argv[index + 1] || "").trim();
  }
  return String(fallback || "").trim();
}

function resolveNodeExecutable(candidate) {
  const normalized = String(candidate || "").trim();
  if (normalized && extname(normalized).toLowerCase() === ".exe") {
    return normalized;
  }
  return process.execPath;
}

const host = readArg("--host", process.env.HOST || "127.0.0.1") || "127.0.0.1";
const port = readArg("--port", process.env.PORT || "4173") || "4173";
const mode = readArg("--mode", "local") || "local";
const requestedNodeExe = readArg("--node", process.env.CARE_NOVA_NODE_EXE || process.execPath) || process.execPath;
const nodeExe = resolveNodeExecutable(requestedNodeExe);
const outPath = join(appDir, "server-4173.codex.out.log");
const errPath = join(appDir, "server-4173.codex.err.log");

const env = {
  ...process.env,
  HOST: host,
  PORT: port,
  CARE_NOVA_PRETTY_JSON: "false",
  CARE_NOVA_NODE_EXE: nodeExe
};

if (mode === "global") {
  env.NODE_ENV = "production";
  env.FRAME_ANCESTORS = "'self'";
} else {
  delete env.NODE_ENV;
  delete env.FRAME_ANCESTORS;
}

const outFd = openSync(outPath, "a");
const errFd = openSync(errPath, "a");

let child;
try {
  child = spawn(nodeExe, ["server.js"], {
    cwd: appDir,
    env,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", outFd, errFd]
  });
} catch (error) {
  closeSync(outFd);
  closeSync(errFd);
  throw error;
}

child.unref();
closeSync(outFd);
closeSync(errFd);

process.stdout.write(`${child.pid}\n`);
