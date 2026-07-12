#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, cp, mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer as createNetServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = resolveArtifactDir(process.env.CARE_NOVA_UI_SMOKE_ARTIFACT_DIR || "");
const existingBaseUrl = cleanText(process.env.CARE_NOVA_UI_SMOKE_BASE_URL);
const patientProfile = {
  id: `ui-smoke-${Date.now().toString(36)}`,
  name: "UI Smoke Patient",
  age: "47",
  phone: "",
  conditions: "Hypertension, Type 2 diabetes",
  medications: "Amlodipine, Metformin",
  allergies: "None",
  baselineBp: "128/84",
  bloodGroup: "",
  gender: "",
  emergencyContact: "",
  primaryDoctor: "Care Nova QA",
  preferredLanguage: "English",
  notes: "Reserved for automated UI smoke validation."
};

const storageKeys = {
  profile: "healthAdvisor.profile",
  patientRecords: "healthAdvisor.patientRecords",
  activePatientId: "healthAdvisor.activePatientId",
  history: "healthAdvisor.history",
  activeInterface: "healthAdvisor.interface",
  workspaceDrafts: "healthAdvisor.workspaceDrafts",
  workspaceSections: "healthAdvisor.workspaceSections",
  medicineDraft: "healthAdvisor.medicineDraft",
  medicineVault: "healthAdvisor.medicineVault",
  medicineSideEffects: "healthAdvisor.medicineSideEffects",
  vitalsDraft: "healthAdvisor.vitalsDraft",
  vitalsTrendLog: "healthAdvisor.vitalsTrendLog",
  vitalsBaseline: "healthAdvisor.vitalsBaseline",
  wellnessDraft: "healthAdvisor.wellnessDraft",
  wellnessProgress: "healthAdvisor.wellnessProgress",
  labReportDraft: "healthAdvisor.labReportDraft",
  labReportContext: "healthAdvisor.labReportContext",
  labReportsVault: "healthAdvisor.labReportsVault",
  visitDraft: "healthAdvisor.visitDraft",
  visitQueue: "healthAdvisor.visitQueue",
  patientDataRecords: "healthAdvisor.patientDataRecords",
  selectedDataRecord: "healthAdvisor.selectedDataRecord",
  insuranceCases: "healthAdvisor.insuranceCases",
  selectedInsuranceCase: "healthAdvisor.selectedInsuranceCase",
  localPrivacyMode: "healthAdvisor.localPrivacyMode",
  safetyEvents: "healthAdvisor.safetyEvents",
  offlineSyncQueue: "healthAdvisor.offlineSyncQueue",
  cachedHealth: "healthAdvisor.cachedHealth",
  cachedReadiness: "healthAdvisor.cachedReadiness",
  cachedTrainingReadiness: "healthAdvisor.cachedTrainingReadiness",
  cachedKnowledge: "healthAdvisor.cachedKnowledge",
  cachedLocalAi: "healthAdvisor.cachedLocalAi"
};

const ignoredConsoleErrorPatterns = [
  /favicon/i,
  /manifest/i,
  /service worker/i,
  /ResizeObserver loop limit exceeded/i
];

async function main() {
  const { chromium } = await importPlaywright();
  const pageErrors = [];
  const consoleErrors = [];
  let sandboxDir = "";
  let baseUrl = existingBaseUrl;
  let serverHandle = null;
  let browser = null;

  if (artifactDir) {
    await mkdir(artifactDir, { recursive: true });
  }

  try {
    if (!baseUrl) {
      sandboxDir = await createSandbox();
      const port = await getFreePort();
      serverHandle = startServer(sandboxDir, port);
      baseUrl = `http://127.0.0.1:${port}`;
      await waitForServer(baseUrl, serverHandle);
    }

    browser = await launchBrowser(chromium);
    await runDesktopSmoke(browser, baseUrl, pageErrors, consoleErrors);
    await runMobileSmoke(browser, baseUrl, pageErrors, consoleErrors);
    assertNoClientErrors(pageErrors, consoleErrors);
    console.log("UI smoke tests passed.");
    console.log("Verified Specialist analyze, Labs save, Insurance guide/save, and mobile tab layout sweep.");
    if (artifactDir) {
      console.log(`Artifacts saved to ${artifactDir}.`);
    }
  } finally {
    await cleanupServerState(baseUrl, patientProfile.id);
    if (browser) {
      await browser.close().catch(() => {});
    }
    await stopServer(serverHandle);
    if (sandboxDir) {
      await rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function importPlaywright() {
  const explicitPlaywrightModule = cleanText(process.env.CARE_NOVA_UI_SMOKE_PLAYWRIGHT_MODULE || "");

  if (explicitPlaywrightModule) {
    const resolvedModule = path.resolve(
      explicitPlaywrightModule.match(/\.(c|m)?js$/i) ? explicitPlaywrightModule : path.join(explicitPlaywrightModule, "index.mjs")
    );
    if (!existsSync(resolvedModule)) {
      throw new Error(
        `CARE_NOVA_UI_SMOKE_PLAYWRIGHT_MODULE points to a missing file: ${resolvedModule}`
      );
    }

    try {
      return await import(pathToFileURL(resolvedModule).href);
    } catch (error) {
      throw new Error(
        `Unable to import Playwright from CARE_NOVA_UI_SMOKE_PLAYWRIGHT_MODULE=${resolvedModule}: ${error?.message || error}`
      );
    }
  }

  try {
    return await import("playwright");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" || /Cannot find package 'playwright'/i.test(error?.message || "")) {
      throw new Error(
        "Playwright is not installed. Run \"npm install --no-save playwright\" and \"npx playwright install chromium\" before running scripts/ui-smoke-test.js."
      );
    }

    throw error;
  }
}

function resolveArtifactDir(value) {
  const relative = cleanText(value);
  return relative ? path.resolve(rootDir, relative) : "";
}

async function createSandbox() {
  const sandboxDir = await mkdtemp(path.join(os.tmpdir(), "care-nova-ui-smoke-"));
  const nodeModulesPath = path.join(rootDir, "node_modules");

  if (!existsSync(nodeModulesPath)) {
    throw new Error("node_modules is missing from the workspace. Install project dependencies before running the UI smoke test.");
  }

  const dataFiles = [
    "README.md",
    "offline-medical-db.json",
    "offline-clinical-repository.json",
    "offline-knowledge-index.json",
    "offline-repository-manifest.json"
  ];
  const dataDirs = [
    "audit",
    "browser-state",
    "external",
    "graph",
    path.join("graph", "patients"),
    "memory",
    "onedrive-mirror",
    "records",
    "training"
  ];

  await Promise.all([
    copyFile(path.join(rootDir, "server.js"), path.join(sandboxDir, "server.js")),
    copyFile(path.join(rootDir, "package.json"), path.join(sandboxDir, "package.json")),
    copyFile(path.join(rootDir, "index.html"), path.join(sandboxDir, "index.html")),
    cp(path.join(rootDir, "public"), path.join(sandboxDir, "public"), { recursive: true, force: true }),
    cp(path.join(rootDir, "src"), path.join(sandboxDir, "src"), { recursive: true, force: true })
  ]);

  await mkdir(path.join(sandboxDir, "data"), { recursive: true });
  await Promise.all(dataDirs.map((relativeDir) => mkdir(path.join(sandboxDir, "data", relativeDir), { recursive: true })));

  await Promise.all(dataFiles.map(async (fileName) => {
    const sourcePath = path.join(rootDir, "data", fileName);
    if (existsSync(sourcePath)) {
      await copyFile(sourcePath, path.join(sandboxDir, "data", fileName));
    }
  }));

  await symlink(nodeModulesPath, path.join(sandboxDir, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  return sandboxDir;
}

async function getFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createNetServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolvePromise(port);
      });
    });
  });
}

function startServer(cwd, port) {
  const logs = [];
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      CARE_NOVA_BOOTSTRAP_LOCAL_RUNTIME: "false",
      CARE_NOVA_ONEDRIVE_MIRROR_ENABLED: "false",
      CARE_NOVA_ACCESS_LOG: "false",
      CARE_NOVA_TEMP_CLOUD_RESPONSE_ENABLED: "false",
      CARE_NOVA_SPECIALIST_LLM_CLOUD_ENABLED: "false",
      CARE_NOVA_OPENAI_ENABLED: "false",
      CARE_NOVA_PAID_MODELS_ENABLED: "false",
      CARE_NOVA_CLOUD_MODELS_ENABLED: "false",
      OPENAI_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout?.on("data", (chunk) => pushServerLog(logs, chunk));
  child.stderr?.on("data", (chunk) => pushServerLog(logs, chunk));

  return {
    child,
    logs
  };
}

function pushServerLog(logs, chunk) {
  const text = String(chunk || "").trim();

  if (!text) {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    logs.push(trimmed);

    if (logs.length > 80) {
      logs.splice(0, logs.length - 80);
    }
  }
}

async function waitForServer(baseUrl, serverHandle, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (serverHandle?.child?.exitCode !== null) {
      throw new Error(`UI smoke server exited early.\n${summarizeServerLogs(serverHandle)}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: {
          Accept: "application/json"
        }
      });

      if (response.ok) {
        return;
      }

      lastError = new Error(`Health probe returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await delay(400);
  }

  throw new Error(`Timed out waiting for ${baseUrl}.\n${lastError?.message || "No health response."}\n${summarizeServerLogs(serverHandle)}`);
}

async function stopServer(serverHandle) {
  const child = serverHandle?.child;

  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill();
  const start = Date.now();

  while (child.exitCode === null && Date.now() - start < 5000) {
    await delay(100);
  }

  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

function summarizeServerLogs(serverHandle) {
  const logs = Array.isArray(serverHandle?.logs) ? serverHandle.logs.slice(-20) : [];
  return logs.length ? `Recent server logs:\n${logs.join("\n")}` : "No server logs captured.";
}

async function launchBrowser(chromium) {
  const attempts = [
    { label: "bundled-playwright-browser", options: { headless: true } },
    { label: "google-chrome-channel", options: { headless: true, channel: "chrome" } },
    { label: "microsoft-edge-channel", options: { headless: true, channel: "msedge" } }
  ];
  const configuredChannel = cleanText(process.env.CARE_NOVA_UI_SMOKE_BROWSER_CHANNEL);

  if (configuredChannel) {
    attempts.unshift({
      label: `configured-channel:${configuredChannel}`,
      options: { headless: true, channel: configuredChannel }
    });
  }

  let lastError = null;

  for (const attempt of attempts) {
    try {
      return await chromium.launch(attempt.options);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to launch a browser for UI smoke validation. ${lastError?.message || "Browser launch failed."} Install browsers with "npx playwright install chromium" or set CARE_NOVA_UI_SMOKE_BROWSER_CHANNEL to a local browser channel.`
  );
}

async function runDesktopSmoke(browser, baseUrl, pageErrors, consoleErrors) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1024 }
  });
  const page = await context.newPage();

  try {
    await primePageState(page);
    attachDiagnostics(page, pageErrors, consoleErrors);
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await waitForWorkspace(page);
    await maybeCapture(page, "01-desktop-home");
    await runSpecialistFlow(page);
    await maybeCapture(page, "02-desktop-specialist");
    await runLabsFlow(page);
    await maybeCapture(page, "03-desktop-labs");
    await runInsuranceFlow(page);
    await maybeCapture(page, "04-desktop-insurance");
  } finally {
    await context.close();
  }
}

async function runMobileSmoke(browser, baseUrl, pageErrors, consoleErrors) {
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();

  try {
    await primePageState(page);
    attachDiagnostics(page, pageErrors, consoleErrors);
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await waitForWorkspace(page);
    await openInterface(page, "specialist");
    await assertNoViewportOverflow(page, "specialist mobile");
    await openInterface(page, "labs");
    await assertNoViewportOverflow(page, "labs mobile");
    await openInterface(page, "insurance");
    await assertNoViewportOverflow(page, "insurance mobile");
    await maybeCapture(page, "05-mobile-insurance");
  } finally {
    await context.close();
  }
}

async function primePageState(page) {
  const patientRecord = {
    ...patientProfile,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await page.addInitScript(({ keys, profile }) => {
    const patientKey = String(profile.id || "").trim().toLowerCase();
    const labVaultKey = `${keys.labReportsVault}.${patientKey}`;
    const recordsKey = `${keys.patientDataRecords}.${patientKey}`;
    const selectedRecordKey = `${keys.selectedDataRecord}.${patientKey}`;
    const vitalsDraftKey = `${keys.vitalsDraft}.${patientKey}`;
    const vitalsTrendKey = `${keys.vitalsTrendLog}.${patientKey}`;
    const vitalsBaselineKey = `${keys.vitalsBaseline}.${patientKey}`;
    const cleanupKeys = [
      keys.history,
      keys.workspaceDrafts,
      keys.workspaceSections,
      keys.medicineDraft,
      keys.medicineVault,
      keys.medicineSideEffects,
      keys.wellnessDraft,
      keys.wellnessProgress,
      keys.labReportDraft,
      keys.labReportContext,
      keys.visitDraft,
      keys.visitQueue,
      keys.insuranceCases,
      keys.selectedInsuranceCase,
      keys.safetyEvents,
      keys.offlineSyncQueue,
      keys.cachedHealth,
      keys.cachedReadiness,
      keys.cachedTrainingReadiness,
      keys.cachedKnowledge,
      keys.cachedLocalAi,
      labVaultKey,
      recordsKey,
      selectedRecordKey,
      vitalsDraftKey,
      vitalsTrendKey,
      vitalsBaselineKey
    ];

    sessionStorage.setItem("careNova.launchEntered", "true");

    for (const key of cleanupKeys) {
      localStorage.removeItem(key);
    }

    localStorage.setItem(keys.localPrivacyMode, JSON.stringify(true));
    localStorage.setItem(keys.profile, JSON.stringify(profile));
    localStorage.setItem(keys.patientRecords, JSON.stringify([profile]));
    localStorage.setItem(keys.activePatientId, JSON.stringify(profile.id));
    localStorage.setItem(keys.activeInterface, JSON.stringify("advisor"));
  }, {
    keys: storageKeys,
    profile: patientRecord
  });
}

function attachDiagnostics(page, pageErrors, consoleErrors) {
  page.on("pageerror", (error) => {
    const message = cleanText(error?.message || String(error));
    if (message) {
      pageErrors.push(message);
    }
  });

  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }

    const text = cleanText(message.text());

    if (!text || ignoredConsoleErrorPatterns.some((pattern) => pattern.test(text))) {
      return;
    }

    consoleErrors.push(text);
  });
}

async function waitForWorkspace(page) {
  await page.waitForFunction(() => {
    return document.body?.classList?.contains("launch-active") === false
      && document.querySelector('.interface-tab[data-interface="specialist"]')
      && document.querySelector("#advisorInterface")
      && !document.querySelector("#launchScreen:not([hidden])");
  }, null, { timeout: 30000 });

  const title = await page.title();
  assert.ok(/Care Nova/i.test(title), `Expected Care Nova page title, received "${title}".`);
}

async function openInterface(page, interfaceName) {
  const selector = `.interface-tab[data-interface="${interfaceName}"]`;
  await page.locator(selector).click();
  await page.waitForFunction((name) => {
    const bodyReady = document.body?.dataset?.activeInterface === name;
    const view = document.querySelector(`[data-interface-view="${name}"]`);
    return bodyReady && Boolean(view) && !view.hidden;
  }, interfaceName, { timeout: 15000 });
}

async function runSpecialistFlow(page) {
  await openInterface(page, "specialist");
  await assertNoViewportOverflow(page, "specialist desktop");
  await page.locator("#specialistExample").click();
  await waitForValue(page, "#specialistQuestion", (value) => value.length >= 40, "Expected specialist example prompt to load.");
  await page.locator("#specialistRun").click();
  await page.locator("#specialistResult .specialist-result-header").waitFor({ state: "visible", timeout: 60000 });

  const metricCount = await page.locator("#specialistResult .specialist-result-metric").count();
  const blockCount = await page.locator("#specialistResult .specialist-result-block").count();
  const readiness = cleanText(await page.locator("#specialistReadinessScore").textContent());
  const headline = cleanText(await page.locator("#specialistResult .specialist-result-header h3").textContent());

  assert.ok(metricCount >= 4, `Expected specialist metrics to render, received ${metricCount}.`);
  assert.ok(blockCount >= 6, `Expected specialist result blocks to render, received ${blockCount}.`);
  assert.ok(readiness !== "0%", `Expected specialist readiness to be populated, received "${readiness}".`);
  assert.ok(/review/i.test(headline), `Expected specialist review headline, received "${headline}".`);
}

async function runLabsFlow(page) {
  await openInterface(page, "labs");
  await assertNoViewportOverflow(page, "labs desktop");
  await page.locator('[data-lab-example="kidney"]').click();
  await waitForValue(page, "#labReportText", (value) => /creatinine|egfr/i.test(value), "Expected kidney sample report to load.");
  await page.locator("#labSaveReportButton").click();
  await page.waitForFunction(() => {
    const labs = document.querySelector("#labsInterface");
    return labs?.dataset?.activeWorkspaceSection === "vault";
  }, null, { timeout: 15000 });

  const visibleSavedReports = page.locator("#labSavedReports [data-open-lab-report]:visible");
  await visibleSavedReports.first().waitFor({ state: "visible", timeout: 20000 });

  const status = cleanText(await page.locator("#labFileStatus").textContent());
  const savedReports = await visibleSavedReports.count();

  assert.ok(/saved locally/i.test(status), `Expected saved lab status, received "${status}".`);
  assert.ok(savedReports >= 1, `Expected at least one saved lab report, received ${savedReports}.`);

  await visibleSavedReports.first().click();
  await page.waitForFunction(() => {
    const labs = document.querySelector("#labsInterface");
    const status = document.querySelector("#labFileStatus");
    return labs?.dataset?.activeWorkspaceSection === "findings"
      && status
      && /opened/i.test(status.textContent || "");
  }, null, { timeout: 10000 });
}

async function runInsuranceFlow(page) {
  await openInterface(page, "insurance");
  await assertNoViewportOverflow(page, "insurance desktop");
  await page.locator("#insuranceLoadExample").click();
  await waitForValue(page, "#insuranceCompany", (value) => value.length >= 3, "Expected insurance example to load.");
  await page.locator("#insuranceAnalyzeButton").click();
  await page.waitForFunction(() => {
    const score = document.querySelector("#insuranceReadinessScore");
    const path = document.querySelector("#insurancePathLabel");
    return Boolean(score && score.textContent && score.textContent !== "0%" && path && path.textContent && path.textContent !== "Start");
  }, null, { timeout: 15000 });

  await page.locator("#insuranceSaveButton").click();
  await page.locator("#insuranceCaseList [data-open-insurance-case]").first().waitFor({ state: "visible", timeout: 15000 });

  const savedCountText = cleanText(await page.locator("#insuranceSavedCount").textContent());
  const savedCount = Number.parseInt(savedCountText, 10);
  const pathLabel = cleanText(await page.locator("#insurancePathLabel").textContent());

  assert.ok(Number.isFinite(savedCount) && savedCount >= 1, `Expected saved insurance count >= 1, received "${savedCountText}".`);
  assert.notEqual(pathLabel, "Start", `Expected insurance path label to update, received "${pathLabel}".`);

  await page.locator("#insuranceCaseList [data-open-insurance-case]").first().click();
  await page.waitForFunction(() => {
    const root = document.querySelector("#insuranceInterface");
    return Boolean(root?.dataset?.selectedInsuranceCase);
  }, null, { timeout: 10000 });
}

async function waitForValue(page, selector, predicate, failureMessage) {
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    const value = await page.locator(selector).inputValue().catch(() => "");

    if (predicate(value)) {
      return value;
    }

    await delay(120);
  }

  assert.fail(failureMessage);
}

async function assertNoViewportOverflow(page, label, tolerance = 32) {
  const overflow = await page.evaluate(() => {
    return Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
  });

  assert.ok(overflow <= tolerance, `${label} overflowed horizontally by ${overflow}px.`);
}

async function maybeCapture(page, name) {
  if (!artifactDir) {
    return;
  }

  await page.screenshot({
    path: path.join(artifactDir, `${name}.png`),
    fullPage: false
  });
}

function assertNoClientErrors(pageErrors = [], consoleErrors = []) {
  if (!pageErrors.length && !consoleErrors.length) {
    return;
  }

  const details = [
    pageErrors.length ? `Page errors:\n${pageErrors.join("\n")}` : "",
    consoleErrors.length ? `Console errors:\n${consoleErrors.join("\n")}` : ""
  ].filter(Boolean).join("\n\n");

  throw new Error(`UI smoke captured client-side errors.\n${details}`);
}

async function cleanupServerState(baseUrl, patientId) {
  if (!cleanText(baseUrl)) {
    return;
  }

  const routes = [
    "/api/memory/clear",
    "/api/records/clear",
    "/api/knowledge-graph/clear"
  ];

  for (const route of routes) {
    try {
      await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ patientId })
      });
    } catch {
      // Cleanup stays best effort for shared local runs.
    }
  }
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
