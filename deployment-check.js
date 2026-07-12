import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createServerApp } from "../server.js";

function stripBom(text) {
  return text.replace(/^\uFEFF/, "");
}

function compareVersionStrings(left, right) {
  const leftParts = String(left || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);

    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

const server = createServerApp();

await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", resolve);
});

const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
const packageJson = JSON.parse(stripBom(await readFile(new URL("../package.json", import.meta.url), "utf8")));
const expectedVersion = packageJson.version;
const validHybridRouterStatuses = new Set([
  "local-ready",
  "hybrid-ready",
  "local-ready-cloud-disabled-by-policy"
]);

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const payload = await response.json();

  assert.equal(response.status, 200, path);
  assert.equal(payload.ok, true, path);

  return { response, payload };
}

try {
  const { response: homeResponse, text: homeText } = await getText("/");
  assert.match(homeResponse.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.match(homeResponse.headers.get("content-security-policy") || "", /frame-ancestors/);
  assert.equal(homeResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(homeResponse.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=(), payment=()");
  assert.equal(homeResponse.headers.has("x-powered-by"), false);

  const { payload: health } = await getJson("/api/health");
  assert.equal(health.status, "healthy");
  assert.equal(health.app, "Care Nova AI");
  assert.equal(health.version, expectedVersion);
  assert.equal(health.mode, "online-offline-local-parity");
  assert.equal(health.runtimeParity.sameCoreOnlineOffline, true);
  assert.equal(health.runtimeParity.internetRequired, false);
  assert.equal(health.memory.mode, "persistent-local-server");
  assert.equal(health.records.mode, "persistent-local-server");
  assert.equal(health.records.file, "data/records/patient-records.json");
  assert.equal(health.training.mode, "persistent-local-ml-training-store");
  assert.equal(health.machineLearning.classicalMlReady, true);
  assert.ok(validHybridRouterStatuses.has(health.hybridRouter.status));
  assert.ok(Number.isInteger(health.hybridRouter.summary.availableCloudModels));
  assert.ok(Number.isInteger(health.hybridRouter.summary.routableCloudModels || 0));
  assert.ok(health.hybridRouter.summary.cloudModelCount >= health.hybridRouter.summary.availableCloudModels);
  assert.ok(health.hybridRouter.summary.cloudModelCount >= (health.hybridRouter.summary.routableCloudModels || 0));
  if ((health.hybridRouter.summary.routableCloudModels || 0) > 0) {
    assert.equal(health.hybridRouter.status, "hybrid-ready");
  }
  assert.equal(health.hybridRouter.connectivity.offlineExecutionReady, true);
  assert.equal(health.externalKnowledge.mode, "disabled-local-cache-ready");
  assert.equal(health.externalKnowledge.cache.file, "data/external/external-knowledge-cache.json");
  assert.equal(health.trustedSources.status, "offline-first-trusted-source-ready");
  assert.equal(health.trustedSources.sourceCount, 5);
  assert.equal(health.advancedCapabilities.localFirst, true);
  assert.ok(health.advancedCapabilities.readyFeatures >= 5);
  assert.ok(health.evaluationDashboard.suiteCount >= 6);
  assert.equal(health.knowledgeGraph.file, "data/graph/patient-knowledge-graph.json");
  assert.equal(health.dataMirror.mode, "localhost-primary-plus-onedrive-local-mirror");
  assert.ok(health.dataMirror.mirrorRoot.includes("onedrive-mirror"));
  assert.equal(health.offlinePacks.runsWithoutInternet, true);
  assert.equal(health.fhir.noEhrCallByDefault, true);
  assert.equal(health.reports.downloadsSupported, true);
  assert.equal(health.deployment.globalReady, true);
  assert.equal(health.deployment.readinessEndpoint, "/api/ready");
  assert.equal(health.operations.apiCachePolicy, "no-store");
  assert.equal(health.operations.apiResponsesNotCached, true);
  assert.equal(health.operations.publicDeploymentMode, false);
  assert.equal(health.operations.mutationControls.maintenanceModeEnabled, false);
  assert.equal(health.operations.mutationControls.readOnlyModeEnabled, false);
  assert.equal(health.operations.mutationControls.requireAdminForMutations, false);
  assert.ok(health.operations.mutationControls.protectedRouteCount >= 9);
  assert.equal(health.operations.patientAccess.required, false);
  assert.ok(health.operations.patientAccess.protectedRouteCount >= 5);
  assert.equal(health.operations.requestValidation.requiresJsonContentType, true);
  assert.equal(health.operations.requestValidation.requiresJsonObject, true);
  assert.equal(health.operations.requestValidation.bodyLimitBytes, 5_000_000);
  assert.equal(health.audit.enabled, true);
  assert.equal(health.audit.file, "data/audit/operational-audit-log.json");
  assert.equal(typeof health.storageIntegrity.criticalReady, "boolean");
  assert.ok(health.configReadiness.status.startsWith("config-"));
  assert.ok(health.startupReadiness.status.startsWith("startup-"));
  assert.equal(health.startupReadiness.summary.strictGuardEnabled, false);
  assert.equal(health.operations.startupGuard.mode, "warn-only");
  assert.equal(health.enterpriseRuntime.safeLocalCoreReady, true);
  assert.equal(health.enterpriseRuntime.publicDeploymentMode, false);
  assert.equal(health.enterpriseRuntime.operationalPolicy.apiResponsesNotCached, true);
  assert.ok([
    "deterministic-local-core",
    "local-open-source-reasoning-augmented",
    "local-openai-compatible-augmented",
    "hybrid-cloud-augmented"
  ].includes(health.enterpriseRuntime.runtimeTier));

  const { payload: ready } = await getJson("/api/ready");
  assert.equal(ready.status, "ready");
  assert.equal(ready.enterpriseRuntime.safeLocalCoreReady, true);
  assert.equal(ready.enterpriseRuntime.operationalPolicy.rateLimitingEnabled, true);
  assert.equal(ready.publicDeployment.enabled, false);
  assert.equal(ready.publicDeployment.publicShareReady, true);
  assert.equal(ready.probes.adminPolicy, "/api/admin-policy");
  assert.equal(ready.probes.adminReviewPacket, "/api/admin-review-packet");
  assert.equal(ready.probes.adminReleaseSnapshot, "/api/admin-release-snapshot");
  assert.equal(ready.probes.adminReviewHistory, "/api/admin-review-history");
  assert.equal(ready.probes.auditEvents, "/api/audit-events");
  assert.equal(ready.probes.deploymentReadiness, "/api/deployment-readiness");
  assert.equal(ready.probes.modelRouter, "/api/model-router");
  assert.equal(ready.probes.modelRouterPreview, "/api/model-router/preview");
  assert.equal(ready.probes.externalKnowledge, "/api/external-knowledge");
  assert.equal(ready.probes.trustedSources, "/api/trusted-sources");
  assert.equal(ready.probes.modelQuality, "/api/model-quality");
  assert.equal(ready.probes.governance, "/api/governance");
  assert.equal(ready.probes.offlinePacks, "/api/offline-packs");
  assert.equal(ready.probes.fhir, "/api/fhir");
  assert.equal(ready.probes.reportTemplates, "/api/report-templates");
  assert.equal(ready.probes.advancedCapabilities, "/api/advanced-capabilities");
  assert.equal(ready.probes.evaluationDashboard, "/api/evaluation-dashboard");
  assert.equal(ready.probes.knowledgeGraph, "/api/knowledge-graph");
  assert.equal(ready.probes.safetyTriage, "/api/safety-triage");
  assert.equal(ready.probes.evidenceCitations, "/api/evidence-citations");
  assert.equal(ready.probes.humanReview, "/api/human-review");
  assert.equal(ready.probes.multimodalIntake, "/api/multimodal-intake");
  assert.equal(ready.probes.preventionPlan, "/api/prevention-plan");
  assert.equal(ready.probes.doctorReadyReport, "/api/doctor-ready-report");
  assert.equal(ready.probes.adminSession, "/api/admin/session");
  assert.equal(ready.probes.configReadiness, "/api/config-readiness");
  assert.equal(ready.probes.startupReadiness, "/api/startup-readiness");
  assert.equal(ready.probes.dataRetentionPolicy, "/api/data-retention-policy");
  assert.equal(ready.probes.incidentPosture, "/api/incident-posture");
  assert.equal(ready.probes.recoveryPosture, "/api/recovery-posture");
  assert.equal(ready.probes.adminSecretPosture, "/api/admin-secret-posture");
  assert.equal(ready.probes.localDataMirror, "/api/local-data-mirror");
  assert.equal(ready.probes.runtimeMetrics, "/api/runtime-metrics");
  assert.equal(ready.probes.storageIntegrity, "/api/storage-integrity");
  assert.equal(ready.probes.training, "/api/training");

  const { payload: deploymentReadiness } = await getJson("/api/deployment-readiness");
  assert.equal(deploymentReadiness.status, "deployment-ready");
  assert.equal(deploymentReadiness.score, 100);
  assert.equal(deploymentReadiness.releaseGate.command, "npm run release:check");
  assert.equal(deploymentReadiness.releaseGate.windowsCommand, "release-check.cmd");
  assert.ok(deploymentReadiness.checks.every((check) => check.status === "pass"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "docker_packaging"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "offline_database_packaged"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "hybrid_model_router"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "online_offline_parity"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "medical_safety"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "operational_controls"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "operational_audit_log"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "storage_integrity_monitoring"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "release_snapshot_export"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "retention_and_secret_governance"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "incident_governance"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "recovery_governance"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "protected_mutation_controls"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "degraded_runtime_reporting"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "startup_self_check"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "public_deployment_mode"));
  assert.equal(deploymentReadiness.publicDeployment.enabled, false);
  assert.equal(deploymentReadiness.publicDeployment.publicShareReady, true);
  assert.equal(deploymentReadiness.enterpriseRuntime.safeLocalCoreReady, true);

  const { payload: deployment } = await getJson("/api/deployment");
  assert.equal(deployment.globalReady, true);
  assert.ok(deployment.endpoints.includes("/api/ready"));
  assert.ok(deployment.endpoints.includes("/api/deployment-readiness"));
  assert.ok(deployment.endpoints.includes("/api/memory"));
  assert.ok(deployment.endpoints.includes("/api/records"));
  assert.ok(deployment.endpoints.includes("/api/external-knowledge"));
  assert.ok(deployment.endpoints.includes("/api/model-router"));
  assert.ok(deployment.endpoints.includes("/api/model-router/preview"));
  assert.ok(deployment.endpoints.includes("/api/trusted-sources"));
  assert.ok(deployment.endpoints.includes("/api/model-quality"));
  assert.ok(deployment.endpoints.includes("/api/governance"));
  assert.ok(deployment.endpoints.includes("/api/admin/session"));
  assert.ok(deployment.endpoints.includes("/api/admin-policy"));
  assert.ok(deployment.endpoints.includes("/api/config-readiness"));
  assert.ok(deployment.endpoints.includes("/api/startup-readiness"));
  assert.ok(deployment.endpoints.includes("/api/data-retention-policy"));
  assert.ok(deployment.endpoints.includes("/api/incident-posture"));
  assert.ok(deployment.endpoints.includes("/api/recovery-posture"));
  assert.ok(deployment.endpoints.includes("/api/admin-secret-posture"));
  assert.ok(deployment.endpoints.includes("/api/admin-review-packet"));
  assert.ok(deployment.endpoints.includes("/api/admin-release-snapshot"));
  assert.ok(deployment.endpoints.includes("/api/admin-review-history"));
  assert.ok(deployment.endpoints.includes("/api/audit-events"));
  assert.ok(deployment.endpoints.includes("/api/offline-packs"));
  assert.ok(deployment.endpoints.includes("/api/fhir"));
  assert.ok(deployment.endpoints.includes("/api/report-templates"));
  assert.ok(deployment.endpoints.includes("/api/advanced-capabilities"));
  assert.ok(deployment.endpoints.includes("/api/evaluation-dashboard"));
  assert.ok(deployment.endpoints.includes("/api/local-data-mirror"));
  assert.ok(deployment.endpoints.includes("/api/runtime-metrics"));
  assert.ok(deployment.endpoints.includes("/api/storage-integrity"));
  assert.ok(deployment.endpoints.includes("/api/knowledge-graph"));
  assert.ok(deployment.endpoints.includes("/api/safety-triage"));
  assert.ok(deployment.endpoints.includes("/api/evidence-citations"));
  assert.ok(deployment.endpoints.includes("/api/human-review"));
  assert.ok(deployment.endpoints.includes("/api/multimodal-intake"));
  assert.ok(deployment.endpoints.includes("/api/prevention-plan"));
  assert.ok(deployment.endpoints.includes("/api/doctor-ready-report"));
  assert.ok(deployment.endpoints.includes("/api/training"));
  assert.ok(deployment.endpoints.includes("/api/training/train"));
  assert.ok(deployment.guide.releaseCommands.includes("npm run release:check"));
  assert.ok(deployment.guide.releaseCommands.includes("release-check.cmd"));
  assert.equal(deployment.guide.container.includesOfflineDatabase, true);
  assert.equal(deployment.releaseGate.command, "npm run release:check");

  const { payload: readiness } = await getJson("/api/readiness");
  assert.equal(readiness.score, 100);
  assert.ok(readiness.checks.some((check) => check.id === "deployment_release_gate"));
  assert.ok(readiness.checks.some((check) => check.id === "public_deployment_policy"));
  assert.ok(readiness.checks.some((check) => check.id === "startup_guard"));
  assert.ok(readiness.checks.some((check) => check.id === "operational_audit_log"));
  assert.ok(readiness.checks.some((check) => check.id === "storage_integrity_monitoring"));
  assert.ok(readiness.checks.some((check) => check.id === "admin_policy_export"));
  assert.ok(readiness.checks.some((check) => check.id === "protected_mutation_controls"));
  assert.ok(readiness.checks.some((check) => check.id === "retention_and_secret_governance"));
  assert.equal(readiness.operations.apiResponsesNotCached, true);
  assert.equal(readiness.enterpriseRuntime.safeLocalCoreReady, true);

  const { payload: knowledge } = await getJson("/api/knowledge");
  assert.equal(knowledge.database.offlineReady, true);
  assert.ok(knowledge.database.storedRecords >= 16);
  assert.equal(knowledge.database.trainingStatus, "not-foundation-model-training");

  const { payload: trainingStatus } = await getJson("/api/training");
  assert.equal(trainingStatus.training.storage.file, "data/training/agent-training-state.json");
  assert.equal(trainingStatus.machineLearning.status, "ml-dl-training-ready");
  assert.equal(trainingStatus.calibration.id, "LOCAL_AGENT_TRAINING_CALIBRATION");

  const { payload: localAi } = await getJson("/api/local-ai");
  assert.equal(localAi.ai.offlineReady, true);
  assert.equal(localAi.ai.mlCore.enabled, true);
  assert.equal(localAi.ai.runtimeParity.sameCoreOnlineOffline, true);
  assert.equal(localAi.ai.runtimeParity.internetRequired, false);
  assert.ok(validHybridRouterStatuses.has(localAi.ai.hybridRouter.status));
  assert.ok(Number.isInteger(localAi.ai.hybridRouter.summary.availableCloudModels));
  assert.ok(Number.isInteger(localAi.ai.hybridRouter.summary.routableCloudModels || 0));
  if ((localAi.ai.hybridRouter.summary.routableCloudModels || 0) > 0) {
    assert.equal(localAi.ai.hybridRouter.status, "hybrid-ready");
  }
  assert.equal(localAi.ai.onlineConnector.cacheFile, "data/external/external-knowledge-cache.json");
  assert.equal(localAi.ai.safety.noDiagnosis, true);

  const { payload: modelRouter } = await getJson("/api/model-router");
  assert.equal(modelRouter.router.id, "CARE_NOVA_HYBRID_MODEL_ROUTER");
  assert.ok(validHybridRouterStatuses.has(modelRouter.router.status));
  assert.ok(Number.isInteger(modelRouter.router.summary.availableCloudModels));
  assert.ok(Number.isInteger(modelRouter.router.summary.routableCloudModels || 0));
  assert.ok(modelRouter.router.summary.cloudModelCount >= modelRouter.router.summary.availableCloudModels);
  assert.ok(modelRouter.router.summary.cloudModelCount >= (modelRouter.router.summary.routableCloudModels || 0));
  if ((modelRouter.router.summary.routableCloudModels || 0) > 0) {
    assert.equal(modelRouter.router.status, "hybrid-ready");
  }
  assert.equal(modelRouter.router.connectivity.offlineExecutionReady, true);

  const routerPreviewResponse = await fetch(`${baseUrl}/api/model-router/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: "Summarize a prior authorization appeal packet with clinical document ingestion, medical policy checks, decision rationale, provider member communication, audit logging, and source evidence.",
      risk: { level: "LOW" },
      intents: [{ type: "UTILIZATION_MANAGEMENT", label: "Utilization", route: "UTILIZATION_AGENT", confidence: 0.92 }],
      plan: { execute: ["UTILIZATION_AGENT"] },
      inputQuality: { score: 88 },
      requirementProfile: { answerMode: { id: "deep" }, detailLevel: "deep", expectedRoute: "UTILIZATION_AGENT" },
      medicalKnowledge: { matches: [{ id: "policy" }, { id: "appeal" }, { id: "audit" }], coverageScore: 86 }
    })
  });
  const routerPreview = await routerPreviewResponse.json();
  const expectedPreviewLabel = (modelRouter.router.summary.routableCloudModels || 0) > 0
    ? "Hybrid Processing"
    : "Local Model";
  assert.equal(routerPreviewResponse.status, 200);
  assert.equal(routerPreview.ok, true);
  assert.equal(routerPreview.decision.generatedUsing, expectedPreviewLabel);
  assert.equal(routerPreview.decision.failover.ready, true);

  const { payload: externalKnowledge } = await getJson("/api/external-knowledge");
  assert.equal(externalKnowledge.externalKnowledge.mode, "disabled-local-cache-ready");
  assert.equal(externalKnowledge.externalKnowledge.cache.file, "data/external/external-knowledge-cache.json");
  assert.equal(externalKnowledge.externalKnowledge.futureRequestReuse, true);

  const { payload: trustedSources } = await getJson("/api/trusted-sources?q=metformin side effect");
  assert.equal(trustedSources.trustedSources.sourceCount, 5);
  assert.equal(trustedSources.plan.queryType, "medicine");
  assert.ok(trustedSources.plan.plannedSources.some((source) => source.sourceId === "rxnorm-rxnav"));

  const trustedPlanResponse = await fetch(`${baseUrl}/api/trusted-sources/plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message: "HbA1c and cholesterol lab report", tab: "labs" })
  });
  const trustedPlan = await trustedPlanResponse.json();
  assert.equal(trustedPlanResponse.status, 200);
  assert.equal(trustedPlan.ok, true);
  assert.equal(trustedPlan.plan.queryType, "lab");

  const { payload: quality } = await getJson("/api/model-quality");
  assert.equal(quality.quality.status, "quality-gate-ready");
  assert.ok(quality.quality.metrics.length >= 9);
  assert.ok(quality.quality.benchmarkCases.length >= 8);

  const { payload: governance } = await getJson("/api/governance");
  assert.equal(governance.governance.status, "governance-ready-for-demo");
  assert.equal(governance.governance.privacy.sendsPhiByDefault, false);
  assert.equal(governance.governance.summary.adminProtectedMutations, false);
  assert.equal(governance.governance.runtimeControls.requireAdminForMutations, false);
  assert.ok(governance.governance.dataLifecycle.summary.storeCount >= 7);
  assert.ok(governance.governance.humanReviewTriggers.length >= 5);

  const { payload: offlinePacks } = await getJson("/api/offline-packs");
  assert.equal(offlinePacks.offlinePacks.status, "offline-pack-ready");
  assert.equal(offlinePacks.offlinePacks.summary.runsWithoutInternet, true);
  assert.ok(offlinePacks.offlinePacks.packs.some((pack) => pack.id === "urgent-safety"));

  const { payload: fhir } = await getJson("/api/fhir");
  assert.equal(fhir.fhir.status, "fhir-ready-not-configured");
  assert.equal(fhir.fhir.summary.noEhrCallByDefault, true);
  assert.ok(fhir.fhir.resources.some((resource) => resource.resource === "Observation"));

  const { payload: reportTemplates } = await getJson("/api/report-templates");
  assert.equal(reportTemplates.reports.status, "report-template-ready");
  assert.equal(reportTemplates.reports.summary.downloadsSupported, true);
  assert.ok(reportTemplates.reports.templates.some((template) => template.id === "doctor-handoff"));

  const { payload: advancedCapabilities } = await getJson("/api/advanced-capabilities");
  assert.equal(advancedCapabilities.status, "advanced-agentic-capabilities-ready");
  assert.ok(advancedCapabilities.features.some((feature) => feature.id === "clinical_safety_triage"));

  const { payload: evaluationDashboard } = await getJson("/api/evaluation-dashboard");
  assert.equal(evaluationDashboard.status, "evaluation-dashboard-ready");
  assert.ok(evaluationDashboard.suites.some((suite) => suite.id === "source_traceability"));

  const { payload: offlinePackManager } = await getJson("/api/offline-pack-manager");
  assert.equal(offlinePackManager.status, "offline-pack-manager-ready");
  assert.ok(offlinePackManager.packs.every((pack) => pack.installState === "bundled"));

  const { payload: fhirConnector } = await getJson("/api/fhir-connector");
  assert.equal(fhirConnector.summary.noEhrCallByDefault, true);
  assert.ok(fhirConnector.scopes.includes("patient/DocumentReference.read"));

  const { payload: adminTrustCenter } = await getJson("/api/admin-trust-center");
  assert.equal(adminTrustCenter.status, "trust-center-ready");
  assert.ok(adminTrustCenter.ownerChecklist.length >= 3);
  assert.ok(adminTrustCenter.controls.some((item) => /audit/i.test(item)));

  const { payload: backupPlan } = await getJson("/api/backup-plan");
  assert.equal(backupPlan.status, "backup-plan-ready");
  assert.ok(backupPlan.files.includes("data/audit/operational-audit-log.json"));
  assert.ok(backupPlan.files.includes("data/audit/admin-review-history.json"));
  assert.ok(backupPlan.files.includes("data/graph/patient-knowledge-graph.json"));

  const { payload: adminPolicy } = await getJson("/api/admin-policy");
  assert.equal(adminPolicy.status, "admin-policy-ready");
  assert.equal(adminPolicy.summary.localFirst, true);
  assert.equal(adminPolicy.probes.adminSession, "/api/admin/session");
  assert.equal(adminPolicy.probes.configReadiness, "/api/config-readiness");
  assert.equal(adminPolicy.probes.startupReadiness, "/api/startup-readiness");
  assert.equal(adminPolicy.probes.dataRetentionPolicy, "/api/data-retention-policy");
  assert.equal(adminPolicy.probes.incidentPosture, "/api/incident-posture");
  assert.equal(adminPolicy.probes.recoveryPosture, "/api/recovery-posture");
  assert.equal(adminPolicy.probes.adminSecretPosture, "/api/admin-secret-posture");
  assert.equal(adminPolicy.probes.adminReviewPacket, "/api/admin-review-packet");
  assert.equal(adminPolicy.probes.adminReleaseSnapshot, "/api/admin-release-snapshot");
  assert.equal(adminPolicy.probes.adminReviewHistory, "/api/admin-review-history");
  assert.equal(adminPolicy.probes.auditEvents, "/api/audit-events");
  assert.equal(adminPolicy.probes.runtimeMetrics, "/api/runtime-metrics");
  assert.equal(adminPolicy.releaseSnapshots.endpoint, "/api/admin-release-snapshot");
  assert.ok(["hmac-sha256", "sha256"].includes(adminPolicy.releaseSnapshots.signatureMethod));
  assert.equal(adminPolicy.runtimeControls.mutationControls.requireAdminForMutations, false);
  assert.equal(adminPolicy.runtimeControls.requestValidation.requiresJsonContentType, true);
  assert.equal(adminPolicy.dataLifecycle.summary.storeCount, governance.governance.dataLifecycle.summary.storeCount);
  assert.equal(adminPolicy.accessControls.requireAdminForMutations, false);
  assert.equal(adminPolicy.accessControls.patientAccessRequired, false);
  assert.ok(adminPolicy.accessControls.patientProtectedRouteCount >= 5);
  assert.ok(["retention-policy-ready", "retention-policy-review-needed"].includes(adminPolicy.dataRetention.status));
  assert.ok(["incident-posture-ready", "incident-posture-review-needed"].includes(adminPolicy.incidentPosture.status));
  assert.ok(["recovery-posture-ready", "recovery-posture-review-needed"].includes(adminPolicy.recoveryPosture.status));
  assert.ok(["secret-posture-ready", "secret-posture-review-needed"].includes(adminPolicy.secretPosture.status));

  const { payload: dataRetentionPolicy } = await getJson("/api/data-retention-policy");
  assert.ok(dataRetentionPolicy.status.startsWith("retention-policy-"));
  assert.ok(dataRetentionPolicy.summary.trackedStores >= 8);
  assert.ok(Array.isArray(dataRetentionPolicy.stores));

  const { payload: incidentPosture } = await getJson("/api/incident-posture");
  assert.ok(incidentPosture.status.startsWith("incident-posture-"));
  assert.ok(incidentPosture.summary.totalSeverityRunbooks >= 3);
  assert.equal(incidentPosture.incidentTargets.auditEvidenceEndpoint, "/api/audit-events");
  assert.ok(Array.isArray(incidentPosture.severityCoverage));

  const { payload: recoveryPosture } = await getJson("/api/recovery-posture");
  assert.ok(recoveryPosture.status.startsWith("recovery-posture-"));
  assert.ok(recoveryPosture.summary.coveredStores >= 8);
  assert.equal(recoveryPosture.recoveryTargets.restoreGuideEndpoint, "/api/backup-plan");
  assert.ok(Array.isArray(recoveryPosture.stores));

  const { payload: adminSecretPosture } = await getJson("/api/admin-secret-posture");
  assert.ok(adminSecretPosture.status.startsWith("secret-posture-"));
  assert.ok(adminSecretPosture.summary.trackedSecretSlots >= 8);
  assert.ok(Array.isArray(adminSecretPosture.slots));

  const { payload: configReadiness } = await getJson("/api/config-readiness");
  assert.ok(configReadiness.status.startsWith("config-"));
  assert.equal(configReadiness.summary.requestValidation.requiresJsonContentType, true);
  assert.equal(configReadiness.summary.requestValidation.requiresJsonObject, true);
  assert.equal(configReadiness.summary.requestValidation.maxJsonBodyBytes, 5_000_000);
  assert.equal(configReadiness.summary.patientAccessRequired, false);
  assert.equal(typeof configReadiness.summary.reviewerRoleAvailable, "boolean");

  const { payload: startupReadiness } = await getJson("/api/startup-readiness");
  assert.equal(startupReadiness.status, "startup-ready");
  assert.equal(startupReadiness.summary.strictGuardEnabled, false);
  assert.equal(startupReadiness.summary.criticalStorageReady, true);
  assert.equal(startupReadiness.summary.shouldBlockStartup, false);

  const { payload: adminReviewPacket } = await getJson("/api/admin-review-packet?includeEvents=true&eventLimit=5");
  assert.equal(adminReviewPacket.status, "admin-review-packet-ready");
  assert.equal(adminReviewPacket.summary.redactionApplied.patientIds, true);
  assert.equal(adminReviewPacket.summary.redactionApplied.requestIds, true);
  assert.ok(Array.isArray(adminReviewPacket.packet.audit.events));
  assert.ok(adminReviewPacket.packet.audit.events.length <= 5);
  assert.equal(typeof adminReviewPacket.packet.identity.fingerprints.combined, "string");

  const { payload: adminReleaseSnapshot } = await getJson("/api/admin-release-snapshot");
  assert.equal(adminReleaseSnapshot.status, "admin-release-snapshot-ready");
  assert.equal(adminReleaseSnapshot.probes.auditEvents, "/api/audit-events");
  assert.equal(adminReleaseSnapshot.probes.dataRetentionPolicy, "/api/data-retention-policy");
  assert.equal(adminReleaseSnapshot.probes.incidentPosture, "/api/incident-posture");
  assert.equal(adminReleaseSnapshot.probes.recoveryPosture, "/api/recovery-posture");
  assert.equal(adminReleaseSnapshot.probes.adminSecretPosture, "/api/admin-secret-posture");
  assert.ok(["retention-policy-ready", "retention-policy-review-needed"].includes(adminReleaseSnapshot.controls.dataRetention.status));
  assert.ok(["incident-posture-ready", "incident-posture-review-needed"].includes(adminReleaseSnapshot.controls.incidentPosture.status));
  assert.ok(["recovery-posture-ready", "recovery-posture-review-needed"].includes(adminReleaseSnapshot.controls.recoveryPosture.status));
  assert.ok(["secret-posture-ready", "secret-posture-review-needed"].includes(adminReleaseSnapshot.controls.secretPosture.status));
  assert.ok(["hmac-sha256", "sha256"].includes(adminReleaseSnapshot.signature.method));

  const { payload: reviewHistoryBefore } = await getJson("/api/admin-review-history?limit=5");
  assert.equal(reviewHistoryBefore.status, "review-history-ready");
  assert.ok(Array.isArray(reviewHistoryBefore.entries));

  const invalidContentTypeResponse = await fetch(`${baseUrl}/api/model-router/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain"
    },
    body: "{}"
  });
  const invalidContentType = await invalidContentTypeResponse.json();

  assert.equal(invalidContentTypeResponse.status, 415);
  assert.equal(invalidContentType.code, "JSON_CONTENT_TYPE_REQUIRED");

  const invalidObjectResponse = await fetch(`${baseUrl}/api/model-router/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: "[]"
  });
  const invalidObject = await invalidObjectResponse.json();

  assert.equal(invalidObjectResponse.status, 400);
  assert.equal(invalidObject.code, "JSON_OBJECT_REQUIRED");

  const originalMaxJsonBodyBytes = process.env.CARE_NOVA_MAX_JSON_BODY_BYTES;
  process.env.CARE_NOVA_MAX_JSON_BODY_BYTES = "64";

  const oversizedBodyResponse = await fetch(`${baseUrl}/api/model-router/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: "x".repeat(256)
    })
  });
  const oversizedBody = await oversizedBodyResponse.json();

  assert.equal(oversizedBodyResponse.status, 413);
  assert.equal(oversizedBody.code, "REQUEST_BODY_TOO_LARGE");

  if (typeof originalMaxJsonBodyBytes === "string") {
    process.env.CARE_NOVA_MAX_JSON_BODY_BYTES = originalMaxJsonBodyBytes;
  } else {
    delete process.env.CARE_NOVA_MAX_JSON_BODY_BYTES;
  }

  const { payload: storageIntegrity } = await getJson("/api/storage-integrity");
  assert.equal(typeof storageIntegrity.summary.criticalReady, "boolean");
  assert.ok(storageIntegrity.checks.some((check) => check.id === "offline_database"));

  const { payload: mirrorStatus } = await getJson("/api/local-data-mirror");
  assert.equal(mirrorStatus.mirror.mode, "localhost-primary-plus-onedrive-local-mirror");
  assert.ok(mirrorStatus.mirror.mirrorRoot.includes("onedrive-mirror"));

  const mirrorSyncResponse = await fetch(`${baseUrl}/api/local-data-mirror`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ reason: "deployment-check-sync" })
  });
  const mirrorSync = await mirrorSyncResponse.json();

  assert.equal(mirrorSyncResponse.status, 200);
  assert.equal(mirrorSync.ok, true);
  assert.equal(mirrorSync.mirror.status, "mirror-synced");
  assert.ok(mirrorSync.mirror.fileCount >= 1);
  assert.ok(mirrorSync.mirror.files.some((file) => file.mirror.includes("onedrive-mirror")));

  const { payload: auditEvents } = await getJson("/api/audit-events?limit=10");
  assert.equal(auditEvents.status, "audit-log-ready");
  assert.equal(auditEvents.summary.enabled, true);
  assert.ok(Array.isArray(auditEvents.events));
  assert.ok(auditEvents.events.some((event) => event.action === "local_data_mirror_sync"));

  const { payload: graphBefore } = await getJson("/api/knowledge-graph?patientId=deployment-check");
  assert.equal(graphBefore.graph.mode, "persistent-local-server");

  const { payload: memoryBefore } = await getJson("/api/memory?patientId=deployment-check");
  assert.equal(memoryBefore.memory.mode, "persistent-local-server");

  const { payload: recordsBefore } = await getJson("/api/records?patientId=deployment-check");
  assert.equal(recordsBefore.records.mode, "persistent-local-server");
  assert.equal(recordsBefore.records.file, "data/records/patient-records.json");

  await fetch(`${baseUrl}/api/memory/clear`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: "deployment-check" })
  });

  const originalRequireAdmin = process.env.CARE_NOVA_REQUIRE_ADMIN_FOR_MUTATIONS;
  const originalAdminToken = process.env.CARE_NOVA_ADMIN_API_TOKEN;
  const originalReviewerToken = process.env.CARE_NOVA_REVIEWER_API_TOKEN;
  const originalAdminAuthRequired = process.env.CARE_NOVA_ADMIN_AUTH_REQUIRED;
  const originalAdminSessionSecret = process.env.CARE_NOVA_ADMIN_SESSION_SECRET;
  const originalMaintenanceMode = process.env.CARE_NOVA_MAINTENANCE_MODE;
  process.env.CARE_NOVA_REQUIRE_ADMIN_FOR_MUTATIONS = "true";
  process.env.CARE_NOVA_ADMIN_API_TOKEN = "deployment-check-admin";
  process.env.CARE_NOVA_REVIEWER_API_TOKEN = "deployment-check-reviewer";

  const blockedRecordsResponse = await fetch(`${baseUrl}/api/records`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: "deployment-check",
      selectedRecordId: "deploy-record-blocked",
      records: [{ id: "deploy-record-blocked", patientName: "Deployment Patient" }]
    })
  });
  const blockedRecords = await blockedRecordsResponse.json();

  assert.equal(blockedRecordsResponse.status, 403);
  assert.equal(blockedRecords.ok, false);
  assert.equal(blockedRecords.code, "ADMIN_AUTH_REQUIRED");

  const saveRecordsResponse = await fetch(`${baseUrl}/api/records`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Care-Nova-Admin-Token": "deployment-check-admin"
    },
    body: JSON.stringify({
      patientId: "deployment-check",
      selectedRecordId: "deploy-record-1",
      records: [
        {
          id: "deploy-record-1",
          patientName: "Deployment Patient",
          age: "52",
          type: "profile",
          date: "2026-06-26",
          conditions: "Hypertension",
          medicines: "Amlodipine",
          vitals: "BP 130/85",
          notes: "Deployment record persistence check"
        }
      ]
    })
  });
  const saveRecords = await saveRecordsResponse.json();

  assert.equal(saveRecordsResponse.status, 200);
  assert.equal(saveRecords.ok, true);
  assert.equal(saveRecords.records.recordCount, 1);
  assert.equal(saveRecords.records.records[0].id, "deploy-record-1");
  assert.equal(saveRecords.records.records[0].structuredVitals.systolic, 130);
  assert.ok(saveRecords.records.records[0].searchText.includes("amlodipine"));

  const { payload: recordsAfter } = await getJson("/api/records?patientId=deployment-check");
  assert.equal(recordsAfter.records.recordCount, 1);
  assert.equal(recordsAfter.records.selectedRecordId, "deploy-record-1");
  assert.equal(recordsAfter.records.records[0].structuredVitals.systolic, 130);

  process.env.CARE_NOVA_MAINTENANCE_MODE = "true";
  const maintenanceMirrorResponse = await fetch(`${baseUrl}/api/local-data-mirror`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Care-Nova-Admin-Token": "deployment-check-admin"
    },
    body: JSON.stringify({ reason: "deployment-maintenance-check" })
  });
  const maintenanceMirror = await maintenanceMirrorResponse.json();

  assert.equal(maintenanceMirrorResponse.status, 503);
  assert.equal(maintenanceMirror.ok, false);
  assert.equal(maintenanceMirror.code, "MAINTENANCE_MODE_ACTIVE");
  process.env.CARE_NOVA_MAINTENANCE_MODE = "false";

  process.env.CARE_NOVA_ADMIN_AUTH_REQUIRED = "true";
  process.env.CARE_NOVA_ADMIN_SESSION_SECRET = "deployment-check-session-secret";

  const blockedAdminPolicyResponse = await fetch(`${baseUrl}/api/admin-policy`);
  const blockedAdminPolicy = await blockedAdminPolicyResponse.json();

  assert.equal(blockedAdminPolicyResponse.status, 403);
  assert.equal(blockedAdminPolicy.code, "ADMIN_AUTH_REQUIRED");

  const blockedAdminReviewPacketResponse = await fetch(`${baseUrl}/api/admin-review-packet`);
  const blockedAdminReviewPacket = await blockedAdminReviewPacketResponse.json();

  assert.equal(blockedAdminReviewPacketResponse.status, 403);
  assert.equal(blockedAdminReviewPacket.code, "ADMIN_AUTH_REQUIRED");

  const blockedDataRetentionResponse = await fetch(`${baseUrl}/api/data-retention-policy`);
  const blockedDataRetention = await blockedDataRetentionResponse.json();

  assert.equal(blockedDataRetentionResponse.status, 403);
  assert.equal(blockedDataRetention.code, "ADMIN_AUTH_REQUIRED");

  const blockedIncidentPostureResponse = await fetch(`${baseUrl}/api/incident-posture`);
  const blockedIncidentPosture = await blockedIncidentPostureResponse.json();

  assert.equal(blockedIncidentPostureResponse.status, 403);
  assert.equal(blockedIncidentPosture.code, "ADMIN_AUTH_REQUIRED");

  const blockedRecoveryPostureResponse = await fetch(`${baseUrl}/api/recovery-posture`);
  const blockedRecoveryPosture = await blockedRecoveryPostureResponse.json();

  assert.equal(blockedRecoveryPostureResponse.status, 403);
  assert.equal(blockedRecoveryPosture.code, "ADMIN_AUTH_REQUIRED");

  const blockedSecretPostureResponse = await fetch(`${baseUrl}/api/admin-secret-posture`);
  const blockedSecretPosture = await blockedSecretPostureResponse.json();

  assert.equal(blockedSecretPostureResponse.status, 403);
  assert.equal(blockedSecretPosture.code, "ADMIN_AUTH_REQUIRED");

  const reviewerLoginResponse = await fetch(`${baseUrl}/api/admin/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token: "deployment-check-reviewer", actorId: "deployment-reviewer" })
  });
  const reviewerLogin = await reviewerLoginResponse.json();
  const reviewerSessionCookie = reviewerLoginResponse.headers.get("set-cookie") || "";

  assert.equal(reviewerLoginResponse.status, 200);
  assert.equal(reviewerLogin.ok, true);
  assert.equal(reviewerLogin.session.role, "reviewer");
  assert.match(reviewerSessionCookie, /care_nova_admin_session=/);

  const reviewerReviewPacketResponse = await fetch(`${baseUrl}/api/admin-review-packet?includeEvents=true&eventLimit=2`, {
    headers: {
      "Cookie": reviewerSessionCookie
    }
  });
  const reviewerReviewPacket = await reviewerReviewPacketResponse.json();

  assert.equal(reviewerReviewPacketResponse.status, 200);
  assert.equal(reviewerReviewPacket.status, "admin-review-packet-ready");
  assert.ok(reviewerReviewPacket.packet.audit.events.length <= 2);

  const reviewerReleaseSnapshotResponse = await fetch(`${baseUrl}/api/admin-release-snapshot?download=true`, {
    headers: {
      "Cookie": reviewerSessionCookie
    }
  });
  const reviewerReleaseSnapshot = await reviewerReleaseSnapshotResponse.json();

  assert.equal(reviewerReleaseSnapshotResponse.status, 200);
  assert.equal(reviewerReleaseSnapshot.status, "admin-release-snapshot-ready");
  assert.equal(reviewerReleaseSnapshot.summary.signedSnapshot, true);
  assert.match(reviewerReleaseSnapshotResponse.headers.get("content-disposition") || "", /care-nova-release-snapshot-/i);

  const reviewerDataRetentionResponse = await fetch(`${baseUrl}/api/data-retention-policy`, {
    headers: {
      "Cookie": reviewerSessionCookie
    }
  });
  const reviewerDataRetention = await reviewerDataRetentionResponse.json();

  assert.equal(reviewerDataRetentionResponse.status, 200);
  assert.ok(reviewerDataRetention.status.startsWith("retention-policy-"));

  const reviewerIncidentPostureResponse = await fetch(`${baseUrl}/api/incident-posture`, {
    headers: {
      "Cookie": reviewerSessionCookie
    }
  });
  const reviewerIncidentPosture = await reviewerIncidentPostureResponse.json();

  assert.equal(reviewerIncidentPostureResponse.status, 200);
  assert.ok(reviewerIncidentPosture.status.startsWith("incident-posture-"));

  const reviewerRecoveryPostureResponse = await fetch(`${baseUrl}/api/recovery-posture`, {
    headers: {
      "Cookie": reviewerSessionCookie
    }
  });
  const reviewerRecoveryPosture = await reviewerRecoveryPostureResponse.json();

  assert.equal(reviewerRecoveryPostureResponse.status, 200);
  assert.ok(reviewerRecoveryPosture.status.startsWith("recovery-posture-"));

  const reviewerSecretPostureResponse = await fetch(`${baseUrl}/api/admin-secret-posture`, {
    headers: {
      "Cookie": reviewerSessionCookie
    }
  });
  const reviewerSecretPosture = await reviewerSecretPostureResponse.json();

  assert.equal(reviewerSecretPostureResponse.status, 200);
  assert.ok(reviewerSecretPosture.status.startsWith("secret-posture-"));

  const reviewerReviewHistoryResponse = await fetch(`${baseUrl}/api/admin-review-history?limit=3`, {
    headers: {
      "Cookie": reviewerSessionCookie
    }
  });
  const reviewerReviewHistory = await reviewerReviewHistoryResponse.json();

  assert.equal(reviewerReviewHistoryResponse.status, 200);
  assert.equal(reviewerReviewHistory.status, "review-history-ready");

  const reviewerSaveHistoryResponse = await fetch(`${baseUrl}/api/admin-review-history`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": reviewerSessionCookie
    },
    body: JSON.stringify({ title: "Reviewer save blocked", decision: "reviewed" })
  });
  const reviewerSaveHistory = await reviewerSaveHistoryResponse.json();

  assert.equal(reviewerSaveHistoryResponse.status, 403);
  assert.equal(reviewerSaveHistory.code, "ADMIN_ROLE_REQUIRED");

  const adminSessionBeforeLoginResponse = await fetch(`${baseUrl}/api/admin/session`);
  const adminSessionBeforeLogin = await adminSessionBeforeLoginResponse.json();

  assert.equal(adminSessionBeforeLoginResponse.status, 200);
  assert.equal(adminSessionBeforeLogin.identity.authenticated, false);

  const adminLoginResponse = await fetch(`${baseUrl}/api/admin/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token: "deployment-check-admin" })
  });
  const adminLogin = await adminLoginResponse.json();
  const adminSessionCookie = adminLoginResponse.headers.get("set-cookie") || "";

  assert.equal(adminLoginResponse.status, 200);
  assert.equal(adminLogin.ok, true);
  assert.equal(adminLogin.session.role, "admin");
  assert.match(adminSessionCookie, /care_nova_admin_session=/);

  const runtimeMetricsResponse = await fetch(`${baseUrl}/api/runtime-metrics`, {
    headers: {
      "Cookie": adminSessionCookie
    }
  });
  const runtimeMetrics = await runtimeMetricsResponse.json();

  assert.equal(runtimeMetricsResponse.status, 200);
  assert.equal(runtimeMetrics.status, "runtime-metrics-ready");
  assert.ok(runtimeMetrics.summary.totalRequests >= 1);

  const authedAdminPolicyResponse = await fetch(`${baseUrl}/api/admin-policy`, {
    headers: {
      "Cookie": adminSessionCookie
    }
  });
  const authedAdminPolicy = await authedAdminPolicyResponse.json();

  assert.equal(authedAdminPolicyResponse.status, 200);
  assert.equal(authedAdminPolicy.accessControls.adminAuthRequired, true);
  assert.equal(authedAdminPolicy.accessControls.sessionSecretConfigured, true);

  const authedConfigReadinessResponse = await fetch(`${baseUrl}/api/config-readiness`, {
    headers: {
      "Cookie": adminSessionCookie
    }
  });
  const authedConfigReadiness = await authedConfigReadinessResponse.json();

  assert.equal(authedConfigReadinessResponse.status, 200);
  assert.equal(authedConfigReadiness.summary.requestValidation.requiresJsonContentType, true);

  const authedStartupReadinessResponse = await fetch(`${baseUrl}/api/startup-readiness`, {
    headers: {
      "Cookie": adminSessionCookie
    }
  });
  const authedStartupReadiness = await authedStartupReadinessResponse.json();

  assert.equal(authedStartupReadinessResponse.status, 200);
  assert.equal(typeof authedStartupReadiness.summary.strictGuardEnabled, "boolean");

  const authedDataRetentionResponse = await fetch(`${baseUrl}/api/data-retention-policy`, {
    headers: {
      "Cookie": adminSessionCookie
    }
  });
  const authedDataRetention = await authedDataRetentionResponse.json();

  assert.equal(authedDataRetentionResponse.status, 200);
  assert.ok(authedDataRetention.status.startsWith("retention-policy-"));

  const authedIncidentPostureResponse = await fetch(`${baseUrl}/api/incident-posture`, {
    headers: {
      "Cookie": adminSessionCookie
    }
  });
  const authedIncidentPosture = await authedIncidentPostureResponse.json();

  assert.equal(authedIncidentPostureResponse.status, 200);
  assert.ok(authedIncidentPosture.status.startsWith("incident-posture-"));

  const authedRecoveryPostureResponse = await fetch(`${baseUrl}/api/recovery-posture`, {
    headers: {
      "Cookie": adminSessionCookie
    }
  });
  const authedRecoveryPosture = await authedRecoveryPostureResponse.json();

  assert.equal(authedRecoveryPostureResponse.status, 200);
  assert.ok(authedRecoveryPosture.status.startsWith("recovery-posture-"));

  const authedSecretPostureResponse = await fetch(`${baseUrl}/api/admin-secret-posture`, {
    headers: {
      "Cookie": adminSessionCookie
    }
  });
  const authedSecretPosture = await authedSecretPostureResponse.json();

  assert.equal(authedSecretPostureResponse.status, 200);
  assert.ok(authedSecretPosture.status.startsWith("secret-posture-"));

  const authedAdminReviewPacketResponse = await fetch(`${baseUrl}/api/admin-review-packet?includeEvents=true&eventLimit=3&download=true`, {
    headers: {
      "Cookie": adminSessionCookie
    }
  });
  const authedAdminReviewPacket = await authedAdminReviewPacketResponse.json();

  assert.equal(authedAdminReviewPacketResponse.status, 200);
  assert.equal(authedAdminReviewPacket.status, "admin-review-packet-ready");
  assert.match(authedAdminReviewPacketResponse.headers.get("content-disposition") || "", /care-nova-admin-review-/i);
  assert.ok(authedAdminReviewPacket.packet.audit.events.length <= 3);

  const authedAuditExportResponse = await fetch(`${baseUrl}/api/audit-events?limit=5&download=true`, {
    headers: {
      "Cookie": adminSessionCookie
    }
  });
  const authedAuditExport = await authedAuditExportResponse.json();

  assert.equal(authedAuditExportResponse.status, 200);
  assert.equal(authedAuditExport.status, "audit-log-ready");
  assert.match(authedAuditExportResponse.headers.get("content-disposition") || "", /care-nova-audit-events-/i);

  const adminSaveHistoryResponse = await fetch(`${baseUrl}/api/admin-review-history`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": adminSessionCookie
    },
    body: JSON.stringify({
      title: "Deployment review snapshot",
      decision: "approved",
      notes: "Enterprise controls validated.",
      includeEvents: true,
      eventLimit: 3
    })
  });
  const adminSaveHistory = await adminSaveHistoryResponse.json();

  assert.equal(adminSaveHistoryResponse.status, 200);
  assert.equal(adminSaveHistory.status, "admin-review-history-saved");
  assert.equal(adminSaveHistory.reviewHistory.entry.role, "admin");
  assert.equal(adminSaveHistory.reviewHistory.entry.decision, "approved");

  const authedReviewHistoryResponse = await fetch(`${baseUrl}/api/admin-review-history?limit=5`, {
    headers: {
      "Cookie": adminSessionCookie
    }
  });
  const authedReviewHistory = await authedReviewHistoryResponse.json();

  assert.equal(authedReviewHistoryResponse.status, 200);
  assert.equal(authedReviewHistory.status, "review-history-ready");
  assert.ok(authedReviewHistory.summary.entryCount >= 1);
  assert.ok(authedReviewHistory.entries.some((entry) => entry.packetFingerprint));

  const adminLogoutResponse = await fetch(`${baseUrl}/api/admin/session`, {
    method: "DELETE",
    headers: {
      "Cookie": adminSessionCookie
    }
  });
  const adminLogout = await adminLogoutResponse.json();

  assert.equal(adminLogoutResponse.status, 200);
  assert.equal(adminLogout.ok, true);

  process.env.CARE_NOVA_REQUIRE_ADMIN_FOR_MUTATIONS = originalRequireAdmin;
  process.env.CARE_NOVA_ADMIN_API_TOKEN = originalAdminToken;
  process.env.CARE_NOVA_REVIEWER_API_TOKEN = originalReviewerToken;
  process.env.CARE_NOVA_ADMIN_AUTH_REQUIRED = originalAdminAuthRequired;
  process.env.CARE_NOVA_ADMIN_SESSION_SECRET = originalAdminSessionSecret;
  process.env.CARE_NOVA_MAINTENANCE_MODE = originalMaintenanceMode;

  const { response: manifestResponse, text: manifestText } = await getText("/site.webmanifest");
  const manifest = JSON.parse(stripBom(manifestText));
  assert.equal(manifestResponse.headers.get("content-type"), "application/manifest+json; charset=utf-8");
  assert.equal(manifest.name, "Care Nova AI");
  assert.equal(manifest.display, "fullscreen");
  assert.ok(manifest.icons.length >= 2);
  assert.equal(
    /[?&]v=([0-9.]+)/.exec(manifest.start_url || "")?.[1],
    expectedVersion,
    "Manifest start_url should use the current app version."
  );
  assert.ok(
    (manifest.shortcuts || []).every((shortcut) => /[?&]v=([0-9.]+)/.exec(shortcut.url || "")?.[1] === expectedVersion),
    "Manifest shortcuts should use the current app version."
  );

  const { text: versionText } = await getText("/version.json");
  const versionManifest = JSON.parse(stripBom(versionText));
  assert.equal(versionManifest.appVersion, expectedVersion);
  assert.equal(versionManifest.assetVersion, expectedVersion);

  const appAssetVersion = /app\.js\?v=([0-9.]+)/.exec(homeText)?.[1];
  const visualAssetVersion = /visual-polish\.css\?v=([0-9.]+)/.exec(homeText)?.[1];
  const staticAssetVersions = [appAssetVersion, visualAssetVersion].filter(Boolean);
  assert.ok(staticAssetVersions.length, "App shell asset version is missing from index.html.");

  const { text: serviceWorker } = await getText("/sw.js");
  const publicAppJs = stripBom(await readFile(new URL("../public/app.js", import.meta.url), "utf8"));
  const serviceWorkerCacheVersion = /care-nova-ai-v([0-9.]+)/.exec(serviceWorker)?.[1];
  const newestStaticAssetVersion = staticAssetVersions.reduce((latest, version) => (
    compareVersionStrings(version, latest) > 0 ? version : latest
  ), staticAssetVersions[0]);
  assert.ok(serviceWorkerCacheVersion, "Service worker cache version is missing.");
  assert.ok(
    staticAssetVersions.every((version) => version === expectedVersion),
    `Static app shell version drift detected. Expected ${expectedVersion}, received ${staticAssetVersions.join(", ")}.`
  );
  assert.equal(
    newestStaticAssetVersion,
    expectedVersion,
    `Newest static asset version ${newestStaticAssetVersion} does not match package version ${expectedVersion}.`
  );
  assert.ok(
    compareVersionStrings(serviceWorkerCacheVersion, newestStaticAssetVersion) >= 0,
    `Service worker cache ${serviceWorkerCacheVersion} is older than app shell asset ${newestStaticAssetVersion}.`
  );
  assert.equal(
    serviceWorkerCacheVersion,
    expectedVersion,
    `Service worker cache version ${serviceWorkerCacheVersion} does not match package version ${expectedVersion}.`
  );
  for (const version of staticAssetVersions) {
    assert.match(serviceWorker, new RegExp(`\\?v=${version.replaceAll(".", "\\.")}`));
  }
  assert.match(serviceWorker, /OFFLINE_APP_SHELL/);
  assert.match(
    publicAppJs,
    /workerUrl\.searchParams\.set\("v", assetVersion\)/,
    "Service worker registration should include the current asset version."
  );
  assert.match(
    publicAppJs,
    /updateViaCache:\s*"none"/,
    "Service worker registration should bypass HTTP cache during updates."
  );
  assert.match(
    publicAppJs,
    /await registerCareNovaServiceWorker\(\)/,
    "Loopback and hosted runtimes should both register the Care Nova service worker."
  );
  assert.doesNotMatch(
    publicAppJs,
    /if\s*\(isLoopbackRuntime\(\)\)\s*\{\s*await clearCareNovaServiceWorkerArtifacts\(\)/s,
    "Loopback startup must not clear the offline app shell before the app loads."
  );
  assert.match(
    publicAppJs,
    /enforceHostedAssetVersionRefresh/,
    "Hosted builds should refresh when a newer asset version is deployed."
  );

  const criticalResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: "deployment-check",
      message: "I have chest pain with sweating and shortness of breath.",
      profile: {
        name: "Demo Patient",
        age: "52",
        conditions: "Hypertension",
        medications: "Amlodipine"
      },
      vitals: {
        heartRate: "132"
      }
    })
  });
  const critical = await criticalResponse.json();
  const expectedCriticalProcessingMode = (critical.modelRouting?.routerSummary?.routableCloudModels || 0) > 0
    && Number(critical.modelRouting?.requestProfile?.score || 0) >= Number(critical.modelRouting?.policy?.cloudThreshold || Number.MAX_SAFE_INTEGER)
    ? "Hybrid Processing"
    : "Local Model";

  assert.equal(criticalResponse.status, 200);
  assert.equal(critical.ok, true);
  assert.equal(critical.risk.level, "CRITICAL");
  assert.equal(critical.guardrails.passed, true);
  assert.equal(critical.processingMode, expectedCriticalProcessingMode);
  assert.equal(critical.modelRouting.generatedUsing, expectedCriticalProcessingMode);
  assert.equal(critical.finalResponse.processingMode, expectedCriticalProcessingMode);
  assert.ok(critical.llmBrain.gates.some((gate) => gate.id === "hybrid_model_routing"));
  assert.equal(critical.finalResponse.responseFocus.policy, "focused-answer-only");
  assert.ok(critical.finalResponse.whatToDoNow.length <= 3);
  assert.equal(critical.memory.saved, true);
  assert.equal(critical.externalKnowledge.cacheFile, "data/external/external-knowledge-cache.json");
  assert.equal(critical.externalKnowledge.usedForThisRequest, false);
  assert.equal(critical.trustedSourcePlan.queryType, "urgent-safety");
  assert.ok(critical.qualityEvaluation.score >= 80);
  assert.equal(critical.governanceSnapshot.notMedicalDevice, true);
  assert.ok(critical.knowledgeGraph.factCount >= 1);
  assert.equal(critical.knowledgeGraph.mode, "persistent-local-server");
  assert.equal(critical.safetyTriage.recommendedRoute, "ALERT_AGENT");
  assert.ok(["HIGH", "CRITICAL"].includes(critical.safetyTriage.level));
  assert.ok(critical.evidenceCitations.sourceCount >= 1);
  assert.equal(critical.humanReview.reviewRequired, true);
  assert.ok(critical.preventionPlan.daily.length >= 1);
  assert.equal(critical.doctorReadyReport.status, "doctor-ready-report-ready");
  assert.equal(critical.advancedCapabilities.status, "advanced-snapshot-ready");
  assert.equal(critical.localDataMirror.status, "mirror-synced");
  assert.ok(Array.isArray(critical.localDataMirror.scheduledFiles) && critical.localDataMirror.scheduledFiles.length >= 1);
  assert.equal(critical.memory.recentTurnCount, 1);
  assert.equal(critical.agenticReview.id, "AGENTIC_SUPERVISOR");
  assert.equal(critical.precisionSupervisor.id, "PRECISION_SUPERVISOR");
  assert.equal(critical.plan.responseOwner.route, "ALERT_AGENT");
  assert.equal(critical.finalResponse.responseFocus.primaryRoute, "ALERT_AGENT");
  assert.ok(critical.smartAnalysis.accuracyEngine.clinicalPrecisionReview.score >= 0);
  assert.equal(critical.modelFlow.activePath.includes("AGENTIC_SUPERVISOR"), false);
  assert.equal(critical.canonicalFlow.steps.length, 8);
  assert.equal(critical.canonicalFlow.activeBucket.route, "ALERT_AGENT");
  assert.equal(critical.modelFlow.qualityReview.id, "AGENTIC_SUPERVISOR");
  assert.ok(critical.agentResults.some((agent) => agent.id === "ALERT_AGENT"));

  await fetch(`${baseUrl}/api/memory/clear`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: "deployment-check" })
  });
  await fetch(`${baseUrl}/api/records/clear`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: "deployment-check" })
  });
  await fetch(`${baseUrl}/api/knowledge-graph/clear`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: "deployment-check" })
  });

  const methodResponse = await fetch(`${baseUrl}/api/health`, {
    method: "POST"
  });
  const methodPayload = await methodResponse.json();

  assert.equal(methodResponse.status, 405);
  assert.equal(methodPayload.code, "METHOD_NOT_ALLOWED");

  const dockerfile = await readFile("Dockerfile", "utf8");
  assert.match(dockerfile, /COPY data \.\/data/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /HOST=0\.0\.0\.0/);

  const packageJson = JSON.parse(stripBom(await readFile("package.json", "utf8")));
  assert.equal(packageJson.version, expectedVersion);
  const startLocalScript = await readFile("start-care-nova.cmd", "utf8");
  const startGlobalScript = await readFile("start-care-nova-global.cmd", "utf8");
  const openCareNovaScript = await readFile("scripts/open-care-nova.ps1", "utf8");
  const runCareNovaServerScript = await readFile("scripts/run-care-nova-server.cmd", "utf8");
  assert.match(startLocalScript, /open-care-nova\.ps1" -Mode local/);
  assert.match(startGlobalScript, /open-care-nova\.ps1" -Mode global/);
  assert.match(openCareNovaScript, /http:\/\/127\.0\.0\.1:\$port\//);
  assert.match(openCareNovaScript, /Open-LocalTarget -Target \$browserUrl/);
  assert.match(openCareNovaScript, /Open-LocalTarget -Target \$launcherPath/);
  assert.match(runCareNovaServerScript, /if not defined HOST set "HOST=127\.0\.0\.1"/);
  assert.match(runCareNovaServerScript, /if not defined PORT set "PORT=4173"/);
  assert.match(packageJson.scripts["release:check"], /src\/externalKnowledgeStore\.js|src\\externalKnowledgeStore\.js/);
  assert.match(packageJson.scripts["release:check"], /src\/productIntelligence\.js|src\\productIntelligence\.js/);
  assert.match(packageJson.scripts["release:check"], /src\/knowledgeGraphStore\.js|src\\knowledgeGraphStore\.js/);
  assert.match(packageJson.scripts["release:check"], /src\/localDataMirror\.js|src\\localDataMirror\.js/);
  assert.match(packageJson.scripts["release:check"], /src\/enterpriseAuditStore\.js|src\\enterpriseAuditStore\.js/);
  assert.match(packageJson.scripts["check:syntax"], /src\/enterprisePatientAccess\.js|src\\enterprisePatientAccess\.js/);
  assert.match(packageJson.scripts.check, /src\/enterprisePatientAccess\.js|src\\enterprisePatientAccess\.js/);
  assert.match(packageJson.scripts["release:check"], /src\/enterprisePatientAccess\.js|src\\enterprisePatientAccess\.js/);
  assert.match(packageJson.scripts["release:check"], /src\/enterprisePublicPolicy\.js|src\\enterprisePublicPolicy\.js/);
  assert.match(packageJson.scripts["release:check"], /src\/enterpriseReviewHistoryStore\.js|src\\enterpriseReviewHistoryStore\.js/);
  assert.match(packageJson.scripts["release:check"], /src\/enterpriseReviewPacket\.js|src\\enterpriseReviewPacket\.js/);
  assert.match(packageJson.scripts["release:check"], /src\/enterpriseStartupGuard\.js|src\\enterpriseStartupGuard\.js/);
  assert.match(packageJson.scripts["release:check"], /src\/storageIntegrity\.js|src\\storageIntegrity\.js/);
  assert.match(packageJson.scripts["release:check"], /src\/trainingEngine\.js|src\\trainingEngine\.js/);
  assert.match(packageJson.scripts["release:check"], /src\/advancedCapabilityEngine\.js|src\\advancedCapabilityEngine\.js/);
  assert.match(packageJson.scripts["release:check"], /scripts\/smoke-test\.js|scripts\\smoke-test\.js/);
  assert.match(packageJson.scripts["release:check"], /scripts\/deployment-check\.js|scripts\\deployment-check\.js/);
  assert.match(packageJson.scripts["release:check"], /scripts\/model-file-check\.js|scripts\\model-file-check\.js/);
  assert.match(packageJson.scripts["release:check"], /scripts\/enterprise-public-deployment-check\.js|scripts\\enterprise-public-deployment-check\.js/);
  assert.match(packageJson.scripts["release:check"], /scripts\/enterprise-startup-guard-check\.js|scripts\\enterprise-startup-guard-check\.js/);
  assert.equal(packageJson.scripts["deploy:check"], "node scripts/deployment-check.js");
  assert.equal(packageJson.scripts["enterprise:public-check"], "node scripts/enterprise-public-deployment-check.js");
  assert.equal(packageJson.scripts["enterprise:startup-guard-check"], "node scripts/enterprise-startup-guard-check.js");
  assert.equal(packageJson.scripts["model:files"], "node scripts/model-file-check.js");

  const envExample = await readFile(".env.example", "utf8");
  assert.match(envExample, /HOST=0\.0\.0\.0/);
  assert.match(envExample, /PORT=4173/);
  assert.match(envExample, /CARE_NOVA_PUBLIC_DEPLOYMENT=false/);
  assert.match(envExample, /CARE_NOVA_STRICT_STARTUP_GUARD=false/);
  assert.match(envExample, /CARE_NOVA_ACCESS_LOG=false/);
  assert.match(envExample, /CARE_NOVA_TRUST_PROXY=false/);
  assert.match(envExample, /CARE_NOVA_AUDIT_LOG_ENABLED=true/);
  assert.match(envExample, /CARE_NOVA_AUDIT_MAX_EVENTS=5000/);
  assert.match(envExample, /CARE_NOVA_REQUIRE_ADMIN_FOR_MUTATIONS=false/);
  assert.match(envExample, /CARE_NOVA_ADMIN_AUTH_REQUIRED=false/);
  assert.match(envExample, /CARE_NOVA_ADMIN_HEADER=X-Care-Nova-Admin-Token/);
  assert.match(envExample, /CARE_NOVA_ADMIN_SESSION_SECRET=/);
  assert.match(envExample, /CARE_NOVA_PATIENT_AUTH_REQUIRED=false/);
  assert.match(envExample, /CARE_NOVA_PATIENT_ACCESS_SECRET=/);
  assert.match(envExample, /CARE_NOVA_PATIENT_HEADER=X-Care-Nova-Patient-Token/);
  assert.match(envExample, /CARE_NOVA_SECRET_PROVIDER=local-env-file/);
  assert.match(envExample, /CARE_NOVA_SECRET_ROTATION_DAYS=90/);
  assert.match(envExample, /CARE_NOVA_SECRET_LAST_ROTATED_AT=/);
  assert.match(envExample, /CARE_NOVA_ADMIN_SESSION_TTL_MINUTES=480/);
  assert.match(envExample, /CARE_NOVA_PATIENT_SESSION_TTL_MINUTES=480/);
  assert.match(envExample, /CARE_NOVA_ADMIN_COOKIE_NAME=care_nova_admin_session/);
  assert.match(envExample, /CARE_NOVA_ADMIN_COOKIE_SECURE=false/);
  assert.match(envExample, /CARE_NOVA_MAINTENANCE_MODE=false/);
  assert.match(envExample, /CARE_NOVA_READ_ONLY_MODE=false/);
  assert.match(envExample, /CARE_NOVA_METRICS_MAX_ERRORS=50/);
  assert.match(envExample, /CARE_NOVA_MAX_JSON_BODY_BYTES=5000000/);
  assert.match(envExample, /CARE_NOVA_RETENTION_POLICY_OWNER=deployment-owner/);
  assert.match(envExample, /CARE_NOVA_RETENTION_REVIEW_FREQUENCY_DAYS=90/);
  assert.match(envExample, /CARE_NOVA_RETENTION_MEMORY_DAYS=365/);
  assert.match(envExample, /CARE_NOVA_RETENTION_RECORDS_DAYS=2555/);
  assert.match(envExample, /CARE_NOVA_RETENTION_GRAPH_DAYS=365/);
  assert.match(envExample, /CARE_NOVA_RETENTION_AUDIT_DAYS=365/);
  assert.match(envExample, /CARE_NOVA_RETENTION_REVIEW_HISTORY_DAYS=730/);
  assert.match(envExample, /CARE_NOVA_RETENTION_TRAINING_DAYS=365/);
  assert.match(envExample, /CARE_NOVA_RETENTION_EXTERNAL_CACHE_DAYS=180/);
  assert.match(envExample, /CARE_NOVA_RETENTION_MIRROR_DAYS=365/);
  assert.match(envExample, /CARE_NOVA_EXTERNAL_API_ENABLED=false/);
  assert.match(envExample, /CARE_NOVA_MEDLINEPLUS_ENABLED=false/);
  assert.match(envExample, /CARE_NOVA_FHIR_BASE_URL=/);

  console.log("Deployment readiness checks passed.");
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function getText(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();

  assert.equal(response.status, 200, path);

  return { response, text };
}

