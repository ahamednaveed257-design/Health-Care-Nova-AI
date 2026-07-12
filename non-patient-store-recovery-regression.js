import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sandboxSourceFiles = [
  "src/enterpriseAuditStore.js",
  "src/enterpriseReviewHistoryStore.js",
  "src/externalKnowledgeStore.js",
  "src/fileWriteLock.js",
  "src/knowledgeGraphStore.js",
  "src/medicineLookupStore.js",
  "src/recordStore.js",
  "src/runtimeConnectivity.js"
];

function sha256(value) {
  return createHash("sha256").update(String(value ?? "").trim().toLowerCase()).digest("hex");
}

function buildTokens(value, limit = 24) {
  return Array.from(
    new Set(
      String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9/%.\s/-]/g, " ")
        .split(/[\s/,-]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2)
        .slice(0, limit)
    )
  );
}

async function copySandboxSource(sandboxRoot, relativePath) {
  const sourcePath = resolve(workspaceRoot, relativePath);
  const targetPath = resolve(sandboxRoot, relativePath);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

async function importSandboxModule(sandboxRoot, relativePath) {
  const modulePath = resolve(sandboxRoot, relativePath);
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

async function runAuditRecoveryRegression(sandboxRoot) {
  const audit = await importSandboxModule(sandboxRoot, "src/enterpriseAuditStore.js");
  const env = {
    CARE_NOVA_AUDIT_LOG_ENABLED: "true",
    CARE_NOVA_AUDIT_MAX_EVENTS: "10"
  };
  const auditFile = resolve(sandboxRoot, "data", "audit", "operational-audit-log.json");

  await audit.appendEnterpriseAuditEvent({
    action: "first-audit-regression",
    category: "runtime",
    status: "info",
    summary: "First audit event"
  }, env);

  const firstPass = await audit.loadEnterpriseAuditLog(env, { limit: 10 });
  assert.equal(firstPass.events.length, 1);

  await writeFile(auditFile, "{ broken json", "utf8");

  await audit.appendEnterpriseAuditEvent({
    action: "second-audit-regression",
    category: "runtime",
    status: "warning",
    summary: "Second audit event"
  }, env);

  const recovered = await audit.loadEnterpriseAuditLog(env, { limit: 10 });
  const repairedStore = JSON.parse(await readFile(auditFile, "utf8"));

  assert.equal(recovered.events.length, 2, "Audit store regression: invalid JSON should not erase earlier audit events.");
  assert.ok(recovered.events.some((event) => event.action === "first-audit-regression"));
  assert.ok(recovered.events.some((event) => event.action === "second-audit-regression"));
  assert.equal(Array.isArray(repairedStore.events) ? repairedStore.events.length : 0, 2);
}

async function runReviewHistoryRecoveryRegression(sandboxRoot) {
  const reviewHistory = await importSandboxModule(sandboxRoot, "src/enterpriseReviewHistoryStore.js");
  const env = {
    CARE_NOVA_REVIEW_HISTORY_ENABLED: "true",
    CARE_NOVA_REVIEW_HISTORY_MAX: "10"
  };
  const historyFile = resolve(sandboxRoot, "data", "audit", "admin-review-history.json");

  await reviewHistory.appendEnterpriseReviewHistoryEntry({
    title: "First review regression",
    decision: "approved",
    role: "admin"
  }, env);

  const firstPass = await reviewHistory.loadEnterpriseReviewHistory(env, { limit: 10 });
  assert.equal(firstPass.entries.length, 1);

  await writeFile(historyFile, "{ broken json", "utf8");

  await reviewHistory.appendEnterpriseReviewHistoryEntry({
    title: "Second review regression",
    decision: "needs_changes",
    role: "reviewer"
  }, env);

  const recovered = await reviewHistory.loadEnterpriseReviewHistory(env, { limit: 10 });
  const repairedStore = JSON.parse(await readFile(historyFile, "utf8"));

  assert.equal(recovered.entries.length, 2, "Review history regression: invalid JSON should not erase prior review entries.");
  assert.ok(recovered.entries.some((entry) => entry.title === "First review regression"));
  assert.ok(recovered.entries.some((entry) => entry.title === "Second review regression"));
  assert.equal(Array.isArray(repairedStore.entries) ? repairedStore.entries.length : 0, 2);
}

async function runKnowledgeGraphRecoveryRegression(sandboxRoot) {
  const graphStore = await importSandboxModule(sandboxRoot, "src/knowledgeGraphStore.js");
  const patientId = "graph-recovery-regression";
  const graphFile = resolve(sandboxRoot, "data", "graph", "patients", `${patientId}.json`);

  await graphStore.clearPatientKnowledgeGraph(patientId);
  await graphStore.upsertPatientKnowledgeGraph({
    patientId,
    payload: {
      message: "Remember that I take amlodipine and feel dizzy when I stand up.",
      profile: {
        conditions: ["Hypertension"],
        medications: ["Amlodipine"]
      }
    },
    result: {
      finalResponse: {
        summary: "Initial graph seed"
      },
      plan: {
        responseOwner: {
          route: "PHARMACY_AGENT"
        }
      }
    },
    records: []
  });

  const firstPass = await graphStore.loadPatientKnowledgeGraph(patientId);
  assert.ok(firstPass.facts.some((fact) => /amlodipine/i.test(fact.value)));

  await writeFile(graphFile, "{ broken json", "utf8");

  await graphStore.upsertPatientKnowledgeGraph({
    patientId,
    payload: {
      message: "Standing dizziness still matters today.",
      profile: {
        conditions: ["Hypertension"]
      }
    },
    result: {
      finalResponse: {
        summary: "Graph follow-up"
      },
      plan: {
        responseOwner: {
          route: "PHARMACY_AGENT"
        }
      }
    },
    records: []
  });

  const recovered = await graphStore.loadPatientKnowledgeGraph(patientId);
  const repairedStore = JSON.parse(await readFile(graphFile, "utf8"));

  assert.ok(
    recovered.facts.some((fact) => /amlodipine/i.test(fact.value)),
    "Knowledge graph regression: the earlier medication fact should survive shard recovery."
  );
  assert.ok(
    recovered.facts.some((fact) => /dizziness/i.test(fact.value)),
    "Knowledge graph regression: the later dizziness fact should be preserved after shard recovery."
  );
  assert.ok(
    Array.isArray(repairedStore.facts) && repairedStore.facts.some((fact) => /amlodipine/i.test(String(fact?.value || "")))
  );
  assert.ok(
    Array.isArray(repairedStore.facts) && repairedStore.facts.some((fact) => /dizziness/i.test(String(fact?.value || "")))
  );
}

async function runExternalKnowledgeRecoveryRegression(sandboxRoot) {
  const externalKnowledge = await importSandboxModule(sandboxRoot, "src/externalKnowledgeStore.js");
  const cacheFile = resolve(sandboxRoot, "data", "external", "external-knowledge-cache.json");
  const query = "kidney diet advice";
  const now = new Date().toISOString();
  const store = {
    version: 1,
    createdAt: now,
    updatedAt: now,
    entries: [
      {
        queryHash: sha256(query),
        query,
        queryTokens: buildTokens(query),
        endpointHost: "",
        createdAt: now,
        updatedAt: now,
        records: [
          {
            id: "external-cache-regression-1",
            title: "Kidney diet cache record",
            category: "guidance",
            keywords: ["kidney", "diet", "advice"],
            summary: "Local cache entry",
            safetyNotes: "Verify against approved local guidance.",
            source: "Local cache",
            sourceMode: "external-api-local-cache",
            cachedAt: now
          }
        ]
      }
    ]
  };

  await mkdir(dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");

  const firstPass = await externalKnowledge.getExternalKnowledgeForRequest(
    { message: query },
    { CARE_NOVA_EXTERNAL_API_ENABLED: "false" }
  );
  assert.equal(firstPass.cacheHit, true);
  assert.equal(firstPass.records[0]?.title, "Kidney diet cache record");

  await writeFile(cacheFile, "{ broken json", "utf8");

  const recovered = await externalKnowledge.getExternalKnowledgeForRequest(
    { message: query },
    { CARE_NOVA_EXTERNAL_API_ENABLED: "false" }
  );

  assert.equal(recovered.cacheHit, true, "External knowledge regression: cached references should survive invalid cache JSON.");
  assert.equal(recovered.records[0]?.title, "Kidney diet cache record");
}

async function runMedicineLookupRecoveryRegression(sandboxRoot) {
  const medicineLookup = await importSandboxModule(sandboxRoot, "src/medicineLookupStore.js");
  const cacheFile = resolve(sandboxRoot, "data", "external", "medicine-lookup-cache.json");
  const query = "Amlodipine";
  const now = new Date().toISOString();
  const store = {
    version: 1,
    createdAt: now,
    updatedAt: now,
    entries: [
      {
        id: sha256(query),
        query,
        queryTokens: buildTokens(query),
        createdAt: now,
        updatedAt: now,
        evidence: {
          query,
          rxNorm: {
            found: true,
            rxcui: "197361",
            name: "Amlodipine",
            synonym: "Amlodipine",
            tty: "IN",
            products: ["Amlodipine 5 MG Oral Tablet"],
            source: "RxNorm/RxNav"
          },
          openFda: {
            found: true,
            brandNames: ["Norvasc"],
            genericNames: ["amlodipine"],
            activeIngredients: ["amlodipine"],
            productTypes: ["HUMAN PRESCRIPTION DRUG"],
            manufacturer: ["Pfizer"],
            route: ["ORAL"],
            sections: ["Warnings and Precautions"],
            source: "openFDA drug labeling",
            labelId: "label-regression-1"
          },
          fetchedAt: now
        }
      }
    ]
  };

  await mkdir(dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");

  const firstPass = await medicineLookup.lookupMedicineEvidence(
    { query },
    { CARE_NOVA_MEDICINE_ONLINE_ENABLED: "false" }
  );
  assert.equal(firstPass.cacheHit, true);
  assert.equal(firstPass.evidence.rxNorm.found, true);

  await writeFile(cacheFile, "{ broken json", "utf8");

  const recovered = await medicineLookup.lookupMedicineEvidence(
    { query },
    { CARE_NOVA_MEDICINE_ONLINE_ENABLED: "false" }
  );

  assert.equal(recovered.cacheHit, true, "Medicine lookup regression: cached evidence should survive invalid cache JSON.");
  assert.equal(recovered.evidence.rxNorm.name, "Amlodipine");
}

async function run() {
  const sandboxRoot = await mkdtemp(join(tmpdir(), "care-nova-non-patient-regression-"));

  try {
    await writeFile(
      resolve(sandboxRoot, "package.json"),
      `${JSON.stringify({ type: "module" }, null, 2)}\n`,
      "utf8"
    );

    for (const relativePath of sandboxSourceFiles) {
      await copySandboxSource(sandboxRoot, relativePath);
    }

    await runAuditRecoveryRegression(sandboxRoot);
    await runReviewHistoryRecoveryRegression(sandboxRoot);
    await runKnowledgeGraphRecoveryRegression(sandboxRoot);
    await runExternalKnowledgeRecoveryRegression(sandboxRoot);
    await runMedicineLookupRecoveryRegression(sandboxRoot);

    console.log("Non-patient store recovery regression passed.");
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
}

await run();
