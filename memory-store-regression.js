import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceModule = resolve(workspaceRoot, "src", "memoryStore.js");
const sourceSupportModules = [
  resolve(workspaceRoot, "src", "fileWriteLock.js")
];

function buildResult(message, at) {
  return {
    memoryPatch: {
      lastMessage: message,
      lastInteractionAt: at,
      latestRiskLevel: "LOW"
    },
    risk: {
      level: "LOW"
    },
    finalResponse: {
      summary: `${message} summary`
    },
    plan: {
      responseOwner: {
        route: "PHARMACY_AGENT"
      }
    }
  };
}

async function run() {
  const sandbox = await mkdtemp(join(tmpdir(), "care-nova-memory-regression-"));
  const modulePath = resolve(sandbox, "src", "memoryStore.js");
  const memoryPath = resolve(sandbox, "data", "memory", "patient-memory.json");

  try {
    await mkdir(dirname(modulePath), { recursive: true });
    await mkdir(dirname(memoryPath), { recursive: true });
    await copyFile(sourceModule, modulePath);
    for (const sourcePath of sourceSupportModules) {
      if (!existsSync(sourcePath)) {
        continue;
      }

      const targetPath = resolve(sandbox, "src", fileURLToPath(pathToFileURL(sourcePath)).split(/[/\\]/).pop());
      await copyFile(sourcePath, targetPath);
    }

    const memoryStore = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
    const patientId = "memory-store-regression";

    await memoryStore.clearPatientMemory(patientId);
    await memoryStore.appendPatientMemory({
      patientId,
      payload: {
        message: "Remember that I take amlodipine and feel dizzy when I stand up.",
        profile: {
          conditions: ["Hypertension"],
          medications: ["Amlodipine"]
        }
      },
      result: buildResult(
        "Remember that I take amlodipine and feel dizzy when I stand up.",
        "2026-07-11T10:00:00.000Z"
      )
    });

    const memoryBeforeCorruption = await memoryStore.loadPatientMemory(patientId);
    assert.equal(memoryBeforeCorruption.recentTurnCount, 1);

    await writeFile(memoryPath, "{ broken json", "utf8");

    await memoryStore.appendPatientMemory({
      patientId,
      payload: {
        message: "Does that standing dizziness still matter today?",
        profile: {
          age: "52"
        }
      },
      result: buildResult(
        "Does that standing dizziness still matter today?",
        "2026-07-11T10:05:00.000Z"
      )
    });

    const recoveredMemory = await memoryStore.loadPatientMemory(patientId);
    const recoveredStore = JSON.parse(await readFile(memoryPath, "utf8"));
    const recoveredPatient = recoveredStore.patients?.[patientId];

    assert.equal(
      recoveredMemory.recentTurnCount,
      2,
      "Memory store regression: a transient invalid JSON read must not drop earlier turns."
    );
    assert.ok(
      recoveredMemory.history.some((item) => /amlodipine/i.test(item.message)),
      "Memory store regression: the original medication turn should survive recovery."
    );
    assert.ok(
      recoveredMemory.history.some((item) => /standing dizziness/i.test(item.message)),
      "Memory store regression: the follow-up dizziness turn should still be saved."
    );
    assert.equal(
      Array.isArray(recoveredPatient?.history) ? recoveredPatient.history.length : 0,
      2,
      "Memory store regression: the repaired on-disk store should keep both turns."
    );

    await runCrossProcessWriteRegression({ sandbox, memoryPath });

    console.log("Memory store regression passed.");
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

async function runCrossProcessWriteRegression({ sandbox, memoryPath }) {
  const baseIds = [
    `cross-process-a-${Date.now()}`,
    `cross-process-b-${Date.now()}`
  ];
  const rounds = 10;
  const seededStore = buildSeededMemoryStore();
  const workerSource = `
    import { mergeImportedPatientMemory } from "./src/memoryStore.js";

    const patientId = process.argv[2];
    const at = process.argv[3];
    const message = process.argv[4];

    await mergeImportedPatientMemory({
      patientId,
      profile: {
        name: patientId
      },
      history: [
        {
          at,
          message,
          risk: "LOW",
          routes: ["GENERAL"]
        }
      ]
    });
  `;

  await writeFile(memoryPath, `${JSON.stringify(seededStore, null, 2)}\n`, "utf8");

  for (let round = 0; round < rounds; round += 1) {
    const at = new Date(Date.UTC(2026, 6, 11, 10, 0, round)).toISOString();
    await Promise.all(baseIds.map((baseId, index) => runConcurrentRegressionWorker({
      sandbox,
      source: workerSource,
      patientId: `${baseId}-${round}`,
      at,
      message: `Concurrent memory turn ${index + 1} for ${baseId}-${round}.`
    })));
  }

  const store = JSON.parse(await readFile(memoryPath, "utf8"));
  const keys = new Set(Object.keys(store?.patients || {}));
  const missing = [];

  for (let round = 0; round < rounds; round += 1) {
    for (const baseId of baseIds) {
      const patientId = `${baseId}-${round}`;
      if (!keys.has(patientId)) {
        missing.push(patientId);
      }
    }
  }

  assert.deepEqual(
    missing,
    [],
    `Memory store regression: concurrent process writes must not drop patient entries. Missing: ${missing.join(", ")}`
  );
}

function buildSeededMemoryStore() {
  const createdAt = "2026-07-01T00:00:00.000Z";
  const patients = {};

  for (let index = 0; index < 900; index += 1) {
    const patientId = `seeded-regression-${index}`;
    const at = new Date(Date.UTC(2026, 5, 1, 9, 0, index % 60)).toISOString();

    patients[patientId] = {
      patientId,
      createdAt,
      updatedAt: at,
      profile: {
        name: `Seeded ${index}`,
        age: "52",
        conditions: ["Hypertension"],
        medications: ["Amlodipine"],
        allergies: [],
        baselineBp: "",
        gender: "",
        notes: ""
      },
      history: [
        {
          id: `seed-${index}`,
          at,
          message: `Seeded memory turn ${index}.`,
          risk: "LOW",
          riskLabel: "",
          riskScore: null,
          intents: [],
          routes: ["GENERAL"],
          requirement: null,
          agents: [],
          vitals: {},
          context: {},
          profile: {
            name: `Seeded ${index}`,
            age: "52",
            conditions: ["Hypertension"],
            medications: ["Amlodipine"],
            allergies: [],
            baselineBp: "",
            gender: "",
            notes: ""
          },
          focusFamilies: [],
          signals: [],
          primaryIntent: "",
          primaryRoute: "",
          responseOwner: "",
          responseFocusLabel: "",
          specialistFocus: "",
          specialistLens: "",
          riskModifiers: [],
          wellnessSignals: [],
          visitSignals: [],
          actionItems: [],
          warningSigns: [],
          evidenceRefs: [],
          triageLevel: "",
          triageRoute: "",
          triageSignals: [],
          reviewReasons: [],
          doctorQuestions: [],
          preventionFocusAreas: [],
          evidenceTitles: [],
          documentType: "",
          documentMarkers: [],
          documentValueHints: [],
          routeSummary: "",
          continuitySummary: "",
          knowledgeSnapshot: null,
          summary: `Seeded summary ${index}.`,
          searchText: ""
        }
      ],
      lastMemoryPatch: null,
      stats: {
        totalTurns: 1,
        riskCounts: { LOW: 1 },
        routeCounts: { GENERAL: 1 },
        intentCounts: {},
        triageCounts: {},
        triageRouteCounts: {},
        latestRisk: "LOW",
        latestInteractionAt: at,
        latestRoutes: ["GENERAL"],
        latestIntents: [],
        latestResponseOwner: "",
        latestTriageLevel: "LOW",
        latestTriageRoute: "",
        activeConditions: ["Hypertension"],
        activeMedications: ["Amlodipine"],
        recentWarnings: [],
        recentActionItems: [],
        recentSpecialistFocuses: [],
        recentRiskModifiers: [],
        recentWellnessSignals: [],
        recentVisitSignals: [],
        recentTriageSignals: [],
        recentReviewReasons: [],
        recentDoctorQuestions: [],
        recentPreventionFocusAreas: [],
        evidenceRefs: [],
        recentEvidenceTitles: [],
        documentTypes: [],
        recentDocumentMarkers: []
      }
    };
  }

  return {
    version: 1,
    createdAt,
    updatedAt: createdAt,
    patients
  };
}

async function runConcurrentRegressionWorker({ sandbox, source, patientId, at, message }) {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-", patientId, at, message],
      {
        cwd: sandbox,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `Concurrent regression worker failed for ${patientId}.`));
    });
    child.stdin.end(source);
  });
}

await run();
