import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createServerApp } from "../server.js";
import { getTemporaryCloudLlmStatus, tryEnhanceAnalyzeResultWithCloudLlm } from "../src/cloudLlmGateway.js";
import { analyzeHealthQuery, analyzeRealtimeHealthQuery, refreshEnhancedFinalResponse } from "../src/healthEngine.js";
import { selectHybridModelRoute } from "../src/hybridModelRouter.js";
import { rankLocalMedicalKnowledge } from "../src/localAiEngine.js";
import { tryEnhanceAnalyzeResultWithLocalReasoning } from "../src/localReasoningGateway.js";
import { offlineMedicalRecords } from "../src/offlineMedicalDatabase.js";
import { refreshLocalRuntimeProbe, startLocalRuntimeProbeLoop, stopLocalRuntimeProbeLoop } from "../src/openSourceLocalRuntime.js";
import { buildEnterprisePatientAccessToken } from "../src/enterprisePatientAccess.js";
import { getEnterpriseSecretPosture } from "../src/enterpriseSecretPosture.js";
import { getSpecialistLlmAgentStatus, tryEnhanceSpecialistAgentResultsWithLlm } from "../src/specialistLlmGateway.js";

const profile = {
  name: "Naveed",
  age: "52",
  conditions: "Hypertension, Type 2 diabetes",
  medications: "Amlodipine, Metformin",
  allergies: "None",
  baselineBp: "130/85"
};

const validRuntimeStates = new Set(["Offline", "Online", "Online-ready"]);
const validRuntimeModes = new Set([
  "offline-forced-local",
  "online-api-augmented",
  "cached-reference-local",
  "offline-cache-fallback",
  "offline-api-fallback",
  "online-ready-local-safe-core",
  "offline-local-rag"
]);
const validHybridRouterStatuses = new Set([
  "local-ready",
  "hybrid-ready",
  "local-ready-cloud-disabled-by-policy"
]);

function rankLocalKnowledgeForRegression({
  query,
  intents,
  risk,
  routeCategories,
  primaryCategories,
  maxMatches = 5
}) {
  return rankLocalMedicalKnowledge({
    query,
    records: offlineMedicalRecords,
    intents,
    risk,
    routeCategories: new Set(routeCategories),
    primaryCategories: new Set(primaryCategories),
    categoryMap: {
      GENERAL: ["General", "Vitals"],
      SPECIALIST_DOCTOR: ["General", "Vitals", "Labs", "Medication", "Lifestyle", "Urgent Safety"],
      LAB_REPORT: ["Labs"],
      MEDICATION: ["Medication"],
      APPOINTMENT: ["Follow-up"],
      EMERGENCY: ["Urgent Safety"],
      VITALS_TRACKING: ["Vitals"],
      LIFESTYLE: ["Lifestyle"],
      MENTAL_WELLNESS: ["Mental Wellness", "Urgent Safety"],
      HEALTH_RECORDS: ["Records", "Memory"],
      INSURANCE_SUPPORT: ["Insurance", "Claims Operations", "Utilization Management"],
      CARE_TRANSITIONS: ["Care Transitions"]
    },
    maxMatches
  });
}

function runLocalKnowledgeRankingRegressions() {
  const specialistResult = rankLocalKnowledgeForRegression({
    query: "I want a cardiology review of repeated high blood pressure, palpitations, diabetes, glucose 268, and what tests I should discuss.",
    intents: [{ type: "SPECIALIST_DOCTOR", route: "SPECIALIST_DOCTOR_AGENT", confidence: 0.95 }],
    risk: { level: "MEDIUM" },
    routeCategories: ["General", "Vitals", "Labs", "Medication", "Lifestyle", "Urgent Safety"],
    primaryCategories: ["General", "Vitals", "Labs", "Medication", "Lifestyle", "Urgent Safety"]
  });
  const specialistTop3 = specialistResult.matches.slice(0, 3);

  assert.ok(
    specialistTop3.some((match) => /Hypertension Care Pathway|Cardiac Symptom Pathway/i.test(match.title || "")),
    "Local specialist ranking regression: a cardiology specialist query should surface a cardiology pathway in the top three matches."
  );

  const labsResult = rankLocalKnowledgeForRegression({
    query: "Ferritin is low and hemoglobin is low. explain anemia and what doctor questions I should ask.",
    intents: [{ type: "LAB_REPORT", route: "LABS_AGENT", confidence: 0.91 }],
    risk: { level: "LOW" },
    routeCategories: ["Labs", "Vitals"],
    primaryCategories: ["Labs", "Vitals"]
  });
  const labsTop3 = labsResult.matches.slice(0, 3);

  assert.ok(
    labsTop3.some((match) => /Anemia, Ferritin, and Iron Study Review/i.test(match.title || "")),
    "Local labs ranking regression: an anemia lab query should surface the anemia review in the top three matches."
  );
}

async function runBrowserStateDraftSyncRegression() {
  const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const directManagedStoragePatterns = [
    /localStorage\.setItem\(storageKeys\.medicineDraft,/,
    /localStorage\.removeItem\(storageKeys\.medicineDraft\)/,
    /localStorage\.setItem\(storageKeys\.labReportDraft,/,
    /localStorage\.removeItem\(storageKeys\.labReportDraft\)/,
    /localStorage\.setItem\(storageKeys\.labReportContext,/,
    /localStorage\.removeItem\(storageKeys\.labReportContext\)/,
    /localStorage\.setItem\(storageKeys\.selectedInsuranceCase,/,
    /localStorage\.removeItem\(storageKeys\.selectedInsuranceCase\)/,
    /localStorage\.setItem\(storageKeys\.visitDraft,/,
    /localStorage\.removeItem\(storageKeys\.visitDraft\)/,
    /localStorage\.setItem\(storageKeys\.wellnessDraft,/,
    /localStorage\.removeItem\(storageKeys\.wellnessDraft\)/,
    /localStorage\.(setItem|removeItem)\(storageKeys\.vitalsDraft/,
    /localStorage\.(setItem|removeItem)\(getVitalsDraftStorageKey/
  ];

  for (const pattern of directManagedStoragePatterns) {
    assert.ok(
      !pattern.test(appSource),
      `Browser state sync regression: ${pattern} should route through the sync-aware local storage helpers.`
    );
  }

  const requiredSyncRules = [
    /baseKey: storageKeys\.vitalsDraft/,
    /baseKey: storageKeys\.vitalsBaseline/,
    /key === storageKeys\.workspaceDrafts/,
    /key === storageKeys\.visitDraft/,
    /key === storageKeys\.medicineDraft/,
    /key === storageKeys\.wellnessDraft/,
    /key === storageKeys\.labReportDraft/,
    /key === storageKeys\.labReportContext/,
    /key === storageKeys\.selectedInsuranceCase/,
    /vitalsBaseline: loadJson\(getVitalsBaselineStorageKey\(targetPatientId\), \{\}\)/
  ];

  for (const pattern of requiredSyncRules) {
    assert.ok(
      pattern.test(appSource),
      `Browser state sync regression: ${pattern} must remain part of the reconnect sync coverage.`
    );
  }
}

async function runLocalDataUsageRegression() {
  const result = await analyzeHealthQuery({
    patientId: "local-data-regression",
    message: "What should I keep an eye on next?",
    profile: {},
    patientRecords: {
      selectedRecordId: "renal-follow-up",
      records: [
        {
          id: "renal-follow-up",
          type: "lab-report",
          documentCategory: "Lab Report",
          documentName: "Kidney follow-up panel",
          episode: "CKD follow-up",
          conditions: "chronic kidney disease stage 3; hypertension",
          medicines: "losartan 25 mg; furosemide 20 mg",
          labs: "creatinine 1.7 mg/dL; eGFR 42 mL/min",
          followUp: "repeat BMP and urine protein in 2 weeks"
        }
      ]
    },
    patientKnowledgeGraph: {
      summary: "Kidney follow-up facts, hypertension history, and recent creatinine trend are stored locally.",
      facts: [
        { type: "condition", value: "chronic kidney disease stage 3", confidence: 0.9, lastSeenAt: "2026-07-07T10:00:00.000Z" },
        { type: "medicine", value: "losartan", confidence: 0.88, lastSeenAt: "2026-07-07T10:00:00.000Z" },
        { type: "lab", key: "creatinine", value: "1.7 mg/dL", confidence: 0.86, lastSeenAt: "2026-07-07T10:00:00.000Z" },
        { type: "lab", key: "eGFR", value: "42 mL/min", confidence: 0.86, lastSeenAt: "2026-07-07T10:00:00.000Z" }
      ]
    }
  });
  const generalOutput = result.agentResults.find((agent) => agent.id === "RAG_AGENT")?.output || {};

  assert.notEqual(
    generalOutput.concernProfile?.familyId,
    "eye_ear_dental",
    "Local data usage regression: a vague follow-up prompt with kidney-focused saved data must not be misclassified as an eye/ear/dental concern."
  );
  assert.ok(
    /kidney|urine|renal/i.test(generalOutput.concernProfile?.family || ""),
    "Local data usage regression: saved kidney-focused records and graph facts should steer the general concern family toward kidney/urinary follow-up."
  );
  assert.ok(
    /Kidney follow-up panel|chronic kidney disease stage 3|creatinine/i.test(generalOutput.summary || ""),
    "Local data usage regression: the general response should mention loaded patient-local kidney context."
  );
  assert.ok(
    !(generalOutput.missingContext || []).includes("known conditions and regular medicines"),
    "Local data usage regression: saved patient-local conditions and medicines should satisfy the missing-context check."
  );
}

async function runLocalRoutingAndRiskRegression() {
  const routeResult = await analyzeHealthQuery({
    patientId: "local-routing-regression",
    message: "Can you help me with the next follow-up?",
    profile: {},
    patientRecords: {
      selectedRecordId: "bp-visit",
      records: [
        {
          id: "bp-visit",
          type: "visit-note",
          documentCategory: "Doctor Visit",
          documentName: "Cardiology follow-up",
          episode: "Hypertension review",
          conditions: "hypertension; palpitations",
          medicines: "amlodipine 5 mg",
          followUp: "repeat home BP log and cardiology review"
        }
      ]
    },
    patientKnowledgeGraph: {
      facts: [
        { type: "condition", value: "hypertension" },
        { type: "condition", value: "palpitations" }
      ]
    }
  });

  assert.ok(
    Array.isArray(routeResult.plan?.execute) && routeResult.plan.execute.includes("SPECIALIST_DOCTOR_AGENT"),
    "Local routing regression: vague follow-up wording with saved cardiology context should activate the specialist route."
  );
  assert.ok(
    Array.isArray(routeResult.intents) && routeResult.intents.some((intent) => intent.route === "SPECIALIST_DOCTOR_AGENT" && /(local|saved|follow-up|condition)/i.test((intent.evidence || []).join(" "))),
    "Local routing regression: specialist intent evidence should reflect patient-local follow-up context."
  );
  assert.equal(
    routeResult.plan?.responseOwner?.route,
    "SPECIALIST_DOCTOR_AGENT",
    "Local routing regression: saved cardiology context should own the visible follow-up answer instead of falling back to scheduling."
  );
  assert.equal(
    routeResult.smartAnalysis?.requirementProfile?.expectedRoute,
    "SPECIALIST_DOCTOR_AGENT",
    "Local routing regression: requirement routing should upgrade vague follow-up wording to the specialist route when saved cardiology context is already loaded."
  );
  assert.equal(
    routeResult.smartAnalysis?.requirementProfile?.outputType,
    "specialist_doctor",
    "Local routing regression: the detected output type should become a specialist review when saved specialist context is already present."
  );
  assert.equal(
    routeResult.llmBrain?.taskProfile?.mode,
    "deep-disease-review",
    "Local routing regression: saved specialist follow-up context should upgrade the brain task frame from generic education to deep disease review."
  );
  assert.equal(
    routeResult.llmBrain?.answerPolicy?.compareAgainstSavedContext,
    true,
    "Local routing regression: saved specialist follow-up context should activate compare-against-saved-context reasoning."
  );
  assert.equal(
    routeResult.llmBrain?.ambiguity?.needsClarification,
    false,
    "Local routing regression: strong saved specialist continuity should suppress the generic clarification loop."
  );
  assert.ok(
    !/main symptom or disease area/i.test(String(routeResult.llmBrain?.ambiguity?.nextQuestion || "")),
    "Local routing regression: the brain should stop using the generic specialist clarification question when saved follow-up context already anchors the request."
  );
  assert.ok(
    !Array.isArray(routeResult.smartAnalysis?.requirementProfile?.missingDataPrompts)
      || !routeResult.smartAnalysis.requirementProfile.missingDataPrompts.some((prompt) => /known conditions and regular medicines/i.test(prompt)),
    "Local routing regression: requirement prompts should not ask again for conditions and medicines already loaded from saved local data."
  );
  assert.equal(
    routeResult.inputQuality?.completeness?.hasLocalData,
    true,
    "Local routing regression: input quality should record that saved patient-local data was used."
  );
  assert.ok(
    Number(routeResult.inputQuality?.score || 0) >= 90,
    "Local routing regression: saved local record and graph context should materially improve input quality scoring."
  );
  const routeSpecialist = Array.isArray(routeResult.agentResults)
    ? routeResult.agentResults.find((agent) => agent.id === "SPECIALIST_DOCTOR_AGENT")?.output || {}
    : {};
  assert.ok(
    Number(routeSpecialist.specialistProfile?.confidence || 0) >= 60,
    "Local routing regression: saved specialist context should raise specialist confidence above the early-screen tier."
  );
  assert.ok(
    !Array.isArray(routeSpecialist.specialistProfile?.missingContext)
      || !routeSpecialist.specialistProfile.missingContext.some((item) => /current medicines|known conditions|reason for specialist review/i.test(item)),
    "Local routing regression: specialist review should not ask again for medicine, diagnosis, or review-reason context that already exists in saved local data."
  );
  assert.ok(
    !/when symptoms started/i.test(String(routeSpecialist.concernProfile?.nextQuestion || "")),
    "Local routing regression: specialist follow-up prompts should stop asking for symptom onset when the request is anchored by saved follow-up context."
  );
  assert.ok(
    /reading|report/i.test(String(routeSpecialist.concernProfile?.nextQuestion || "")),
    "Local routing regression: specialist follow-up prompts should ask for the most useful missing reading or report detail instead."
  );

  const riskResult = await analyzeHealthQuery({
    patientId: "local-risk-regression",
    message: "What should I do next?",
    profile: {},
    patientKnowledgeGraph: {
      facts: [
        { type: "safetyFlag", value: "Chest pain with shortness of breath" },
        { type: "risk", key: "HIGH", value: "HIGH" },
        { type: "condition", value: "coronary artery disease" }
      ]
    }
  });

  assert.ok(
    ["HIGH", "CRITICAL"].includes(riskResult.risk?.level || ""),
    "Local risk regression: persisted high-risk safety flags must not be downgraded to LOW on a vague follow-up prompt."
  );
  assert.ok(
    Array.isArray(riskResult.plan?.execute) && riskResult.plan.execute.includes("ALERT_AGENT"),
    "Local risk regression: persisted high-risk safety flags should activate urgent safety coverage."
  );
  assert.ok(
    Array.isArray(riskResult.risk?.reasons) && riskResult.risk.reasons.some((reason) => /local|saved|graph|persisted/i.test(reason)),
    "Local risk regression: elevated risk should explain that patient-local safety context was used."
  );
}

async function runSharedLocalAgentIntelligenceRegression() {
  const sharedLocalPayload = {
    profile: {},
    patientRecords: {
      selectedRecordId: "shared-follow-up",
      records: [
        {
          id: "shared-follow-up",
        type: "visit-note",
        documentCategory: "Doctor Visit",
        documentName: "Cardiology and diabetes follow-up",
        episode: "Hypertension and glucose review",
        conditions: "hypertension; type 2 diabetes",
        allergies: "penicillin rash",
        medicines: "amlodipine 5 mg; metformin 500 mg",
        labs: "HbA1c 8.2 %; creatinine 1.6 mg/dL",
        vitals: "BP 152/94; pulse 96",
        followUp: "cardiology clinic review in 2 weeks"
      }
    ]
  },
  patientKnowledgeGraph: {
      facts: [
        { type: "condition", value: "hypertension" },
      { type: "condition", value: "type 2 diabetes" },
      { type: "medicine", value: "amlodipine" },
      { type: "medicine", value: "metformin" },
      { type: "lab", key: "HbA1c", value: "8.2 %" },
      { type: "lab", key: "creatinine", value: "1.6 mg/dL" },
      { type: "vital", key: "BP", value: "152/94" },
      { type: "vital", key: "pulse", value: "96" }
    ]
  }
};

  const pharmacyResult = await analyzeHealthQuery({
    patientId: "local-agent-pharmacy",
    message: "Is this medicine safe for me?",
    singleAgentMode: true,
    preferredAgent: "PHARMACY_AGENT",
    interfaceName: "medications",
    ...sharedLocalPayload
  });
  const pharmacyOutput = pharmacyResult.agentResults?.[0]?.output || {};
  assert.ok(
    Array.isArray(pharmacyOutput.medicineSignals) && pharmacyOutput.medicineSignals.some((item) => /amlodipine|metformin/i.test(item)),
    "Shared local agent regression: medication agent should use saved local medicines when the message is vague."
  );
  assert.ok(
    /Saved medicines:/i.test(pharmacyOutput.medicationContext || ""),
    "Shared local agent regression: medication context should include saved local medicines."
  );
  assert.ok(
    !Array.isArray(pharmacyOutput.reviewGaps) || !pharmacyOutput.reviewGaps.includes("current medicine list"),
    "Shared local agent regression: pharmacy review should not ask again for the current medicine list when local records already contain it."
  );
  assert.ok(
    !Array.isArray(pharmacyOutput.reviewGaps) || !pharmacyOutput.reviewGaps.includes("condition-specific safety context"),
    "Shared local agent regression: pharmacy review should use saved condition context instead of asking again for generic condition-specific safety context."
  );
  assert.ok(
    !Array.isArray(pharmacyOutput.reviewGaps) || !pharmacyOutput.reviewGaps.includes("reason this medicine is being used"),
    "Shared local agent regression: pharmacy review should infer the medicine purpose from saved local condition context."
  );
  assert.ok(
    !Array.isArray(pharmacyOutput.reviewGaps) || !pharmacyOutput.reviewGaps.includes("allergy history"),
    "Shared local agent regression: pharmacy review should use saved local record allergies instead of asking for allergy history again."
  );

  const labsResult = await analyzeHealthQuery({
    patientId: "local-agent-labs",
    message: "Can you review my lab follow-up?",
    singleAgentMode: true,
    preferredAgent: "LABS_AGENT",
    interfaceName: "labs",
    ...sharedLocalPayload
  });
  const labsOutput = labsResult.agentResults?.[0]?.output || {};
  assert.ok(
    Array.isArray(labsOutput.parsedValues) && labsOutput.parsedValues.length >= 1,
    "Shared local agent regression: labs agent should parse saved local lab values when the current message is generic."
  );
  assert.ok(
    /saved local lab context was used/i.test(labsOutput.summary || ""),
    "Shared local agent regression: labs summary should state when saved local lab context was used."
  );
  assert.ok(
    !Array.isArray(labsOutput.accuracyGaps) || !labsOutput.accuracyGaps.includes("current medicine context"),
    "Shared local agent regression: labs review should not ask again for medicine context when saved local medicines are already available."
  );

  const schedulingResult = await analyzeHealthQuery({
    patientId: "local-agent-scheduling",
    message: "Help me book my next follow-up.",
    singleAgentMode: true,
    preferredAgent: "SCHEDULING_AGENT",
    interfaceName: "appointments",
    ...sharedLocalPayload
  });
  const schedulingOutput = schedulingResult.agentResults?.[0]?.output || {};
  assert.ok(
    /cardiology/i.test(schedulingOutput.suggestedDepartment?.label || ""),
    "Shared local agent regression: scheduling should infer the follow-up department from saved local follow-up context."
  );
  assert.ok(
    /saved record|knowledge graph|local continuity/i.test(schedulingOutput.summary || ""),
    "Shared local agent regression: scheduling summary should reflect saved local continuity."
  );
  assert.ok(
    !Array.isArray(schedulingOutput.readinessGaps) || !schedulingOutput.readinessGaps.some((item) => /BP\/pulse readings/i.test(item)),
    "Shared local agent regression: scheduling should not demand fresh cardiology readings when a saved follow-up context already exists."
  );
  assert.ok(
    Array.isArray(schedulingOutput.prepChecklist) && schedulingOutput.prepChecklist.some((item) => /saved .*workspace|saved follow-up note/i.test(item)),
    "Shared local agent regression: scheduling prep should explicitly reuse the saved local follow-up packet."
  );

  const insuranceResult = await analyzeHealthQuery({
    patientId: "local-agent-insurance",
    message: "Can you help with my appeal?",
    singleAgentMode: true,
    preferredAgent: "INSURANCE_AGENT",
    interfaceName: "insurance",
    ...sharedLocalPayload
  });
  const insuranceOutput = insuranceResult.agentResults?.[0]?.output || {};
  assert.ok(
    Array.isArray(insuranceOutput.documentGaps?.present) && insuranceOutput.documentGaps.present.includes("reports"),
    "Shared local agent regression: insurance support should detect saved local reports as usable evidence."
  );
  assert.ok(
    !Array.isArray(insuranceOutput.documentGaps?.missing) || !insuranceOutput.documentGaps.missing.includes("reports"),
    "Shared local agent regression: insurance support should stop marking reports missing when local evidence is already loaded."
  );
  assert.ok(
    /saved local clinical evidence|local evidence already available/i.test(`${insuranceOutput.summary || ""} ${insuranceOutput.packetSections?.map((section) => section?.detail || "").join(" ")}`),
    "Shared local agent regression: insurance support should say when local evidence is already available."
  );

  const recordsResult = await analyzeHealthQuery({
    patientId: "local-agent-records",
    message: "Prepare the records summary.",
    singleAgentMode: true,
    preferredAgent: "RECORDS_AGENT",
    interfaceName: "records",
    ...sharedLocalPayload
  });
  const recordsOutput = recordsResult.agentResults?.[0]?.output || {};
  assert.ok(
    !Array.isArray(recordsOutput.missingFields) || !recordsOutput.missingFields.some((item) => /Conditions|Medicines/i.test(item)),
    "Shared local agent regression: records review should not mark conditions or medicines as missing when saved local data is available."
  );
  assert.ok(
    !/Not provided/i.test(recordsOutput.summaryDraft?.conditions || ""),
    "Shared local agent regression: records summary draft should use saved local condition context."
  );

  const vitalsResult = await analyzeHealthQuery({
    patientId: "local-agent-vitals",
    message: "Check my vitals follow-up.",
    singleAgentMode: true,
    preferredAgent: "VITALS_AGENT",
    interfaceName: "vitals",
    ...sharedLocalPayload
  });
  const vitalsOutput = vitalsResult.agentResults?.[0]?.output || {};
  assert.ok(
    Array.isArray(vitalsOutput.missing) && vitalsOutput.missing.includes("blood pressure pair"),
    "Shared local agent regression: vitals review should still request a BP pair when saved local context is cardiometabolic."
  );
  assert.ok(
    !Array.isArray(vitalsOutput.missing) || !vitalsOutput.missing.includes("oxygen saturation"),
    "Shared local agent regression: vitals review should stop asking for unrelated oxygen data when the saved local context is not respiratory."
  );
  assert.ok(
    !Array.isArray(vitalsOutput.missing) || !vitalsOutput.missing.includes("height and weight for BMI"),
    "Shared local agent regression: vitals review should stop asking for BMI inputs on a generic cardiometabolic follow-up without weight context."
  );
  assert.ok(
    /saved record|knowledge graph|local continuity/i.test(vitalsOutput.summary || ""),
    "Shared local agent regression: vitals summary should acknowledge saved local continuity when no current readings are entered."
  );

  const specialistResult = await analyzeHealthQuery({
    patientId: "local-agent-specialist",
    message: "Review my specialist follow-up.",
    singleAgentMode: true,
    preferredAgent: "SPECIALIST_DOCTOR_AGENT",
    interfaceName: "specialist",
    ...sharedLocalPayload
  });
  const specialistOutput = specialistResult.agentResults?.[0]?.output || {};
  assert.ok(
    !Array.isArray(specialistOutput.missing) || !specialistOutput.missing.includes("blood pressure pair"),
    "Shared local agent regression: specialist review should use the saved local BP instead of treating blood pressure as completely missing."
  );
  assert.ok(
    !/No numeric vital bundle was entered yet/i.test(JSON.stringify(specialistOutput.concernProfile || {})),
    "Shared local agent regression: specialist review should surface saved local vital readings in its support lanes."
  );

  const advisorSpecialistResult = await analyzeHealthQuery({
    patientId: "local-agent-advisor-specialist",
    message: "What should I watch for with my BP follow-up?",
    singleAgentMode: true,
    preferredAgent: "SPECIALIST_DOCTOR_AGENT",
    interfaceName: "advisor",
    ...sharedLocalPayload
  });
  const advisorSpecialistExecute = Array.isArray(advisorSpecialistResult.plan?.execute) ? advisorSpecialistResult.plan.execute : [];
  const advisorSpecialistOutput = (advisorSpecialistResult.agentResults || []).find((item) => item.id === "SPECIALIST_DOCTOR_AGENT")?.output || {};
  assert.ok(
    advisorSpecialistExecute.includes("SPECIALIST_DOCTOR_AGENT"),
    "Shared local agent regression: advisor front door should keep specialist as the visible response owner for this follow-up review."
  );
  assert.ok(
    !advisorSpecialistExecute.includes("VITALS_AGENT") && !advisorSpecialistExecute.includes("LABS_AGENT") && !advisorSpecialistExecute.includes("RAG_AGENT"),
    "Shared local agent regression: advisor specialist routing should drop redundant standalone vitals, labs, and general routes when the specialist owner already performs those internal cross-checks."
  );
  assert.ok(
    advisorSpecialistExecute.includes("SCHEDULING_AGENT"),
    "Shared local agent regression: advisor specialist routing should keep follow-up planning support when a next-visit workflow is still relevant."
  );
  assert.ok(
    Array.isArray(advisorSpecialistOutput.supportReview?.bundleIds)
      && advisorSpecialistOutput.supportReview.bundleIds.includes("VITALS_AGENT")
      && advisorSpecialistOutput.supportReview.bundleIds.includes("LABS_AGENT"),
    "Shared local agent regression: specialist owner should still perform embedded vitals and labs cross-checks after the redundant planner fanout is removed."
  );

  const alertResult = await analyzeHealthQuery({
    patientId: "local-agent-alert",
    message: "What warning signs should I watch for?",
    singleAgentMode: true,
    preferredAgent: "ALERT_AGENT",
    interfaceName: "safety",
    ...sharedLocalPayload
  });
  const alertOutput = alertResult.agentResults?.[0]?.output || {};
  assert.ok(
    Array.isArray(alertOutput.monitoringChecklist) && alertOutput.monitoringChecklist.some((item) => /saved (recent|local) readings/i.test(item)),
    "Shared local agent regression: alert monitoring should mention saved local readings when no current readings are entered."
  );
  assert.ok(
    !/Allergies: not provided/i.test(alertOutput.handoffPacket?.bring || ""),
    "Shared local agent regression: alert handoff should include saved local allergy context."
  );

  const transitionsResult = await analyzeHealthQuery({
    patientId: "local-agent-transitions",
    message: "Prepare my discharge follow-up plan.",
    singleAgentMode: true,
    preferredAgent: "CARE_TRANSITIONS_AGENT",
    interfaceName: "transitions",
    ...sharedLocalPayload
  });
  const transitionsOutput = transitionsResult.agentResults?.[0]?.output || {};
  assert.ok(
    Array.isArray(transitionsOutput.draftOutputs) && transitionsOutput.draftOutputs.some((item) => /hypertension|type 2 diabetes|cardiology clinic review/i.test(item?.detail || "")),
    "Shared local agent regression: care transitions drafts should use saved local conditions and follow-up details."
  );

  const claimsResult = await analyzeHealthQuery({
    patientId: "local-agent-claims",
    message: "Prepare my claim review packet.",
    singleAgentMode: true,
    preferredAgent: "CLAIMS_OPS_AGENT",
    interfaceName: "claims",
    ...sharedLocalPayload
  });
  const claimsOutput = claimsResult.agentResults?.[0]?.output || {};
  assert.ok(
    claimsOutput.structuredExtraction?.member === "Patient",
    "Shared local agent regression: claims operations should use the local patient label instead of the demo fallback."
  );
  assert.ok(
    Array.isArray(claimsOutput.structuredExtraction?.documentSignals) && claimsOutput.structuredExtraction.documentSignals.some((item) => /clinical note|report|visit note/i.test(item)),
    "Shared local agent regression: claims operations should recognize saved local clinical evidence."
  );

  const utilizationResult = await analyzeHealthQuery({
    patientId: "local-agent-utilization",
    message: "Review the utilization and authorization details.",
    singleAgentMode: true,
    preferredAgent: "UTILIZATION_AGENT",
    interfaceName: "utilization",
    ...sharedLocalPayload
  });
  const utilizationOutput = utilizationResult.agentResults?.[0]?.output || {};
  assert.ok(
    utilizationOutput.packetSummary?.member === "Patient",
    "Shared local agent regression: utilization review should use the local patient label instead of the demo fallback."
  );
  assert.ok(
    !Array.isArray(utilizationOutput.packetSummary?.policyInputsNeeded) || !utilizationOutput.packetSummary.policyInputsNeeded.includes("diagnosis or condition text"),
    "Shared local agent regression: utilization review should not ask for diagnosis text again when saved local conditions are already loaded."
  );
  assert.ok(
    !Array.isArray(utilizationOutput.packetSummary?.policyInputsNeeded) || !utilizationOutput.packetSummary.policyInputsNeeded.includes("supporting clinical notes"),
    "Shared local agent regression: utilization review should not ask for supporting clinical notes again when saved local evidence is already loaded."
  );

  const ragResult = await analyzeHealthQuery({
    patientId: "local-agent-rag",
    message: "What should I keep an eye on next?",
    singleAgentMode: true,
    preferredAgent: "RAG_AGENT",
    interfaceName: "advisor",
    ...sharedLocalPayload
  });
  const ragOutput = (ragResult.agentResults || []).find((item) => item.id === "RAG_AGENT")?.output || {};
  assert.ok(
    Array.isArray(ragResult.plan?.execute) && ragResult.plan.execute.length === 1 && ragResult.plan.execute[0] === "RAG_AGENT",
    "Shared local agent regression: the advisor should keep purely general follow-up wording on the general route when no narrower route dominates."
  );
  assert.ok(
    /Saved readings: BP 152\/94/i.test(ragOutput.concernProfile?.localDataSummary || ""),
    "Shared local agent regression: general advisor should surface saved local BP context in its local-data summary."
  );
  assert.ok(
    !Array.isArray(ragOutput.missingContext) || !ragOutput.missingContext.includes("relevant reading if available"),
    "Shared local agent regression: general advisor should not ask again for a reading when saved local vitals already exist."
  );
  assert.ok(
    Array.isArray(ragOutput.generalSections?.tracking) && ragOutput.generalSections.tracking.some((item) => /Saved local readings already available: BP 152\/94/i.test(item)),
    "Shared local agent regression: general advisor tracking should explicitly reuse saved local readings."
  );
  assert.ok(
    !Array.isArray(ragOutput.focusQuestions) || !ragOutput.focusQuestions.some((item) => /What were the latest BP and pulse readings/i.test(item)),
    "Shared local agent regression: general advisor should not fall back to asking for the latest BP and pulse readings when those saved readings already exist."
  );
}

async function runAnalysisCacheRegression() {
  const patientId = `analysis-cache-regression-${Date.now()}`;
  const basePayload = {
    analysisIsolation: "prompt-only",
    patientId,
    message: "This is a follow-up from my last medicine issue. What should I watch for next?",
    interfaceName: "advisor",
    singleAgentMode: true,
    preferredAgent: "RAG_AGENT",
    answerMode: "deep",
    profile: {
      age: "52"
    },
    context: {
      duration: "same-day",
      severity: "2",
      careGoal: "follow-up",
      redFlags: []
    }
  };
  const amlodipinePayload = {
    ...basePayload,
    patientRecords: {
      selectedRecordId: "med-1",
      records: [{
        id: "med-1",
        type: "visit-note",
        documentCategory: "medication-follow-up",
        documentName: "Amlodipine dizziness follow-up",
        episode: "standing dizziness after amlodipine",
        conditions: "Hypertension",
        medicines: "Amlodipine 5 mg daily",
        notes: "Standing dizziness after blood pressure tablet.",
        followUp: "Review amlodipine timing, dizziness, blood pressure log, and dehydration risk.",
        tags: ["medicine", "follow-up", "dizziness"]
      }]
    }
  };

  const first = await analyzeHealthQuery(amlodipinePayload);
  const second = await analyzeHealthQuery(amlodipinePayload);

  assert.equal(first.cache?.analysisCacheHit, false);
  assert.equal(second.cache?.analysisCacheHit, true);
  assert.equal(second.finalResponse?.responseFocus?.primaryRoute, "PHARMACY_AGENT");

  const lisinoprilPayload = {
    ...basePayload,
    patientRecords: {
      selectedRecordId: "med-2",
      records: [{
        id: "med-2",
        type: "visit-note",
        documentCategory: "medication-follow-up",
        documentName: "Lisinopril cough follow-up",
        episode: "dry cough after lisinopril",
        conditions: "Hypertension",
        medicines: "Lisinopril 10 mg daily",
        notes: "Dry cough started after the blood pressure tablet was changed.",
        followUp: "Review cough severity, lisinopril timing, blood pressure log, and dehydration risk.",
        tags: ["medicine", "follow-up", "cough"]
      }]
    }
  };

  const third = await analyzeHealthQuery(lisinoprilPayload);
  const fourth = await analyzeHealthQuery(lisinoprilPayload);

  assert.equal(
    third.cache?.analysisCacheHit,
    false,
    "Health analysis cache regression: changing saved local medicine context must invalidate the deterministic full-analysis cache."
  );
  assert.equal(third.finalResponse?.responseFocus?.primaryRoute, "PHARMACY_AGENT");
  assert.equal(fourth.cache?.analysisCacheHit, true);
}

function runRealtimeCacheRegression() {
  const patientId = `realtime-cache-regression-${Date.now()}`;
  const basePayload = {
    patientId,
    message: "This is a follow-up from my blood pressure review. What should I track next?",
    interfaceName: "advisor",
    singleAgentMode: true,
    preferredAgent: "RAG_AGENT",
    answerMode: "deep",
    context: {
      duration: "1-3 days",
      severity: "2",
      careGoal: "follow-up",
      redFlags: []
    }
  };
  const first = analyzeRealtimeHealthQuery({
    ...basePayload,
    patientRecords: {
      selectedRecordId: "vit-1",
      records: [{
        id: "vit-1",
        type: "bp-log",
        documentCategory: "blood-pressure-log",
        documentName: "Home BP trend",
        episode: "blood pressure follow-up",
        vitals: "BP 150/96 yesterday, BP 148/94 today, pulse 86",
        followUp: "Track morning and evening BP for 7 days.",
        tags: ["bp", "vitals", "trend"]
      }]
    }
  });
  const second = analyzeRealtimeHealthQuery({
    ...basePayload,
    patientRecords: {
      selectedRecordId: "vit-1",
      records: [{
        id: "vit-1",
        type: "bp-log",
        documentCategory: "blood-pressure-log",
        documentName: "Home BP trend",
        episode: "blood pressure follow-up",
        vitals: "BP 150/96 yesterday, BP 148/94 today, pulse 86",
        followUp: "Track morning and evening BP for 7 days.",
        tags: ["bp", "vitals", "trend"]
      }]
    }
  });
  const third = analyzeRealtimeHealthQuery({
    ...basePayload,
    patientRecords: {
      selectedRecordId: "vit-2",
      records: [{
        id: "vit-2",
        type: "bp-log",
        documentCategory: "blood-pressure-log",
        documentName: "Higher BP trend",
        episode: "blood pressure follow-up",
        vitals: "BP 166/102 today, pulse 94",
        followUp: "Track morning and evening BP for 7 days and compare with prior readings.",
        tags: ["bp", "vitals", "trend"]
      }]
    }
  });

  assert.equal(first.cache?.realtimeAnalysisHit, false);
  assert.equal(second.cache?.realtimeAnalysisHit, true);
  assert.equal(second.finalResponse?.responseFocus?.primaryRoute, "VITALS_AGENT");
  assert.equal(
    third.cache?.realtimeAnalysisHit,
    false,
    "Realtime cache regression: changing saved local vitals context must invalidate the fast realtime cache."
  );
  assert.equal(third.finalResponse?.responseFocus?.primaryRoute, "VITALS_AGENT");
}

const cases = [
  {
    name: "normal symptom query",
    payload: {
      patientId: "demo-patient",
      message: "I have a mild headache and want general advice.",
      profile,
      vitals: {}
    },
    expectedRisk: "LOW",
    expectedAgents: ["RAG_AGENT"]
  },
  {
    name: "missed BP medicine",
    payload: {
      patientId: "demo-patient",
      message: "I feel dizzy and missed my BP tablet yesterday.",
      profile,
      vitals: {
        systolic: "154",
        diastolic: "96"
      }
    },
    expectedRisk: "MEDIUM",
    expectedAgents: ["PHARMACY_AGENT"]
  },
  {
    name: "high BP reading",
    payload: {
      patientId: "demo-patient",
      message: "My BP is high and I have a headache.",
      profile,
      vitals: {
        systolic: "182",
        diastolic: "116"
      }
    },
    expectedRisk: "HIGH",
    expectedAgents: ["ALERT_AGENT"]
  },
  {
    name: "very high BP with severe headache calibration",
    payload: {
      patientId: "demo-patient",
      message: "My BP is 188/122 with severe headache and blurred vision.",
      profile,
      vitals: {
        systolic: "188",
        diastolic: "122"
      }
    },
    expectedRisk: "CRITICAL",
    expectedAgents: ["ALERT_AGENT"]
  },
  {
    name: "chest pain critical warning path",
    payload: {
      patientId: "demo-patient",
      message: "I have chest pain with sweating and shortness of breath.",
      profile,
      vitals: {
        heartRate: "132"
      }
    },
    expectedRisk: "CRITICAL",
    expectedAgents: ["ALERT_AGENT"]
  },
  {
    name: "stroke warning wording path",
    payload: {
      patientId: "demo-patient",
      message: "My face is drooping and I have trouble speaking.",
      profile,
      vitals: {}
    },
    expectedRisk: "CRITICAL",
    expectedAgents: ["ALERT_AGENT"]
  },
  {
    name: "appointment scheduling path",
    payload: {
      patientId: "demo-patient",
      message: "Please help me book a doctor appointment and set a follow-up reminder.",
      profile,
      vitals: {},
      conversationHistory: []
    },
    expectedRisk: "LOW",
    expectedAgents: ["SCHEDULING_AGENT"]
  },
  {
    name: "lab report explanation path",
    payload: {
      patientId: "demo-patient",
      message: "Can you explain my HbA1c and cholesterol lab report in simple words?",
      profile,
      vitals: {}
    },
    expectedRisk: "LOW",
    expectedAgents: ["LABS_AGENT"]
  },
  {
    name: "lifestyle support path",
    payload: {
      patientId: "demo-patient",
      message: "I need diet, hydration, sleep, and walking guidance for better routine.",
      profile,
      vitals: {}
    },
    expectedRisk: "LOW",
    expectedAgents: ["LIFESTYLE_AGENT"]
  },
  {
    name: "mental wellness support path",
    payload: {
      patientId: "demo-patient",
      message: "I feel stressed and anxious and cannot sleep well.",
      profile,
      vitals: {}
    },
    expectedRisk: "LOW",
    expectedAgents: ["WELLNESS_AGENT"]
  },
  {
    name: "health records support path",
    payload: {
      patientId: "demo-patient",
      message: "Create a health record summary with my prescription, doctor note, and report summary.",
      profile,
      vitals: {}
    },
    expectedRisk: "LOW",
    expectedAgents: ["RECORDS_AGENT"]
  },
  {
    name: "insurance support path",
    payload: {
      patientId: "demo-patient",
      message: "Help me organize an insurance billing and coverage question for my claim.",
      profile,
      vitals: {}
    },
    expectedRisk: "LOW",
    expectedAgents: ["INSURANCE_AGENT"]
  },
  {
    name: "context red flag path",
    payload: {
      patientId: "demo-patient",
      message: "I feel weak and dizzy and I am worried.",
      profile,
      vitals: {},
      context: {
        duration: "1-3 days",
        severity: "8",
        careGoal: "urgency",
        supportNow: "alone",
        lastMedicationTime: "",
        redFlags: ["fainting"]
      }
    },
    expectedRisk: "CRITICAL",
    expectedAgents: ["ALERT_AGENT"]
  },
  {
    name: "extreme low sugar warning path",
    payload: {
      patientId: "demo-patient",
      message: "My blood sugar is 48 and I feel confused and faint.",
      profile,
      vitals: {
        bloodSugar: "48"
      }
    },
    expectedRisk: "CRITICAL",
    expectedAgents: ["ALERT_AGENT"]
  },
  {
    name: "message vital extraction path",
    payload: {
      patientId: "demo-patient",
      message: "My blood sugar is 48 and I feel confused and faint.",
      profile,
      vitals: {}
    },
    expectedRisk: "CRITICAL",
    expectedAgents: ["ALERT_AGENT"]
  },
  {
    name: "discharge transitions workflow",
    payload: {
      patientId: "demo-patient",
      message: "Prepare a discharge summary, patient instructions, care plan, post-discharge outreach, readmission monitoring, and quality reporting draft for high BP follow-up.",
      profile,
      vitals: {
        systolic: "166",
        diastolic: "102"
      }
    },
    expectedRisk: "MEDIUM",
    expectedAgents: ["CARE_TRANSITIONS_AGENT"]
  },
  {
    name: "claims operations workflow",
    payload: {
      patientId: "demo-patient",
      message: "Review a claims intake packet with adjudication exception, explanation of benefits, provider inquiry, validation edits, and regulatory reporting needs.",
      profile,
      vitals: {}
    },
    expectedRisk: "LOW",
    expectedAgents: ["CLAIMS_OPS_AGENT"]
  },
  {
    name: "prior auth appeal workflow",
    payload: {
      patientId: "demo-patient",
      message: "Summarize a prior authorization appeal packet with clinical document ingestion, medical policy checks, decision rationale, provider member communication, and audit logging.",
      profile,
      vitals: {}
    },
    expectedRisk: "LOW",
    expectedAgents: ["UTILIZATION_AGENT"]
  },
  {
    name: "gxp batch quality workflow",
    payload: {
      patientId: "demo-patient",
      message: "Review a master batch record with eBR execution, deviation exception narrative, release documentation, QA review, change control, SOP and QMS questions.",
      profile,
      vitals: {}
    },
    expectedRisk: "LOW",
    expectedAgents: ["GXP_QUALITY_AGENT"]
  },
  {
    name: "medtech compliance workflow",
    payload: {
      patientId: "demo-patient",
      message: "Draft MedTech design controls technical file with requirements, user needs, V&V evidence traceability, complaint handling, root cause, CAPA, cybersecurity SBOM, post-market surveillance and regulatory reporting.",
      profile,
      vitals: {}
    },
    expectedRisk: "LOW",
    expectedAgents: ["MEDTECH_COMPLIANCE_AGENT"]
  }
];

function applySmokeTestEnterpriseBaseline() {
  process.env.CARE_NOVA_REQUIRE_ADMIN_FOR_MUTATIONS = "false";
  process.env.CARE_NOVA_READ_ONLY_MODE = "false";
  process.env.CARE_NOVA_ADMIN_AUTH_REQUIRED = "false";
  process.env.CARE_NOVA_PATIENT_AUTH_REQUIRED = "false";

  delete process.env.CARE_NOVA_ADMIN_API_TOKEN;
  delete process.env.CARE_NOVA_REVIEWER_API_TOKEN;
  delete process.env.CARE_NOVA_ADMIN_SESSION_SECRET;
  delete process.env.CARE_NOVA_PATIENT_ACCESS_SECRET;
  delete process.env.CARE_NOVA_PATIENT_HEADER;
}

function applySmokeTestModelBaseline() {
  process.env.CARE_NOVA_ENABLE_ALL_MODELS = "false";
  process.env.CARE_NOVA_PAID_MODELS_ENABLED = "false";
  process.env.CARE_NOVA_CLOUD_MODELS_ENABLED = "false";
  process.env.CARE_NOVA_OPENAI_ENABLED = "false";
  process.env.CARE_NOVA_SPECIALIST_LLM_CLOUD_ENABLED = "false";
  process.env.CARE_NOVA_TEMP_CLOUD_RESPONSE_ENABLED = "false";
  process.env.OPENAI_API_KEY = "";
  process.env.OPENAI_BASE_URL = "";
  process.env.CARE_NOVA_TEMP_CLOUD_API_URL = "";
  process.env.CARE_NOVA_TEMP_CLOUD_API_KEY = "";
}

// Keep smoke verification deterministic even if the caller shell inherits
// enterprise auth or cloud-routing flags from another session.
applySmokeTestEnterpriseBaseline();
applySmokeTestModelBaseline();

const smokeScopeArg = process.argv.find((argument) => argument.startsWith("--scope="));
const requestedSmokeScope = (smokeScopeArg ? smokeScopeArg.split("=")[1] : process.env.CARE_NOVA_SMOKE_SCOPE || "full").trim().toLowerCase();
const validSmokeScopes = new Set(["full", "offline", "http"]);
const smokeScope = validSmokeScopes.has(requestedSmokeScope) ? requestedSmokeScope : "full";
const runOfflineSmoke = smokeScope === "full" || smokeScope === "offline";
const runHttpSmoke = smokeScope === "full" || smokeScope === "http";

if (runOfflineSmoke) {
runLocalKnowledgeRankingRegressions();
await runBrowserStateDraftSyncRegression();
await runLocalDataUsageRegression();
await runLocalRoutingAndRiskRegression();
await runSharedLocalAgentIntelligenceRegression();
await runAnalysisCacheRegression();
runRealtimeCacheRegression();

const cloudRoutePreview = selectHybridModelRoute(
  {
    message: "Summarize a prior authorization appeal packet with clinical document ingestion, medical policy checks, decision rationale, provider member communication, audit logging, and source evidence.",
    risk: { level: "LOW" },
    intents: [{ type: "UTILIZATION_MANAGEMENT", label: "Utilization", route: "UTILIZATION_AGENT", confidence: 0.92 }],
    plan: { execute: ["UTILIZATION_AGENT"] },
    inputQuality: { score: 88 },
    requirementProfile: { answerMode: { id: "deep" }, detailLevel: "deep", expectedRoute: "UTILIZATION_AGENT" },
    medicalKnowledge: { matches: [{ id: "policy" }, { id: "appeal" }, { id: "audit" }], coverageScore: 86 }
  },
  {
    ...process.env,
    CARE_NOVA_MODEL_ROUTING_POLICY: "local-first-auto",
    CARE_NOVA_MODEL_COST_POLICY: "lowest-cost",
    CARE_NOVA_CLOUD_COMPLEXITY_THRESHOLD: "55",
    CARE_NOVA_FORCE_OFFLINE: "false",
    CARE_NOVA_PAID_MODELS_ENABLED: "true",
    CARE_NOVA_CLOUD_MODELS_ENABLED: "true",
    CARE_NOVA_OPENAI_ENABLED: "true",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-family",
    CARE_NOVA_ONLINE_MODE: "true",
    CARE_NOVA_INTERNET_AVAILABLE: "true"
  }
);

assert.equal(cloudRoutePreview.generatedUsing, "Hybrid Processing");
assert.equal(cloudRoutePreview.selectedModel.primary.id, "openai");
assert.equal(cloudRoutePreview.failover.ready, true);

const forcedOfflinePreview = selectHybridModelRoute(
  { message: "Simple headache guidance.", risk: { level: "LOW" }, intents: [], plan: { execute: ["RAG_AGENT"] } },
  {
    ...process.env,
    CARE_NOVA_MODEL_ROUTING_POLICY: "local-first-auto",
    CARE_NOVA_FORCE_OFFLINE: "true",
    CARE_NOVA_PAID_MODELS_ENABLED: "true",
    CARE_NOVA_CLOUD_MODELS_ENABLED: "true",
    CARE_NOVA_OPENAI_ENABLED: "true",
    OPENAI_API_KEY: "test-key"
  }
);

assert.equal(forcedOfflinePreview.generatedUsing, "Local Model");
assert.equal(forcedOfflinePreview.connectivity.forcedOffline, true);

const enableAllModelsPreview = selectHybridModelRoute(
  {
    message: "Summarize a prior authorization appeal packet with clinical document ingestion, medical policy checks, decision rationale, provider member communication, audit logging, and source evidence.",
    risk: { level: "LOW" },
    intents: [{ type: "UTILIZATION_MANAGEMENT", label: "Utilization", route: "UTILIZATION_AGENT", confidence: 0.92 }],
    plan: { execute: ["UTILIZATION_AGENT"] },
    inputQuality: { score: 88 },
    requirementProfile: { answerMode: { id: "deep" }, detailLevel: "deep", expectedRoute: "UTILIZATION_AGENT" },
    medicalKnowledge: { matches: [{ id: "policy" }, { id: "appeal" }, { id: "audit" }], coverageScore: 86 }
  },
  {
    ...process.env,
    CARE_NOVA_ENABLE_ALL_MODELS: "true",
    CARE_NOVA_MODEL_ROUTING_POLICY: "local-first-auto",
    CARE_NOVA_MODEL_COST_POLICY: "lowest-cost",
    CARE_NOVA_CLOUD_COMPLEXITY_THRESHOLD: "55",
    CARE_NOVA_FORCE_OFFLINE: "false",
    CARE_NOVA_INTERNET_AVAILABLE: "true",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-family",
    CARE_NOVA_ONLINE_MODE: "true"
  }
);

assert.equal(enableAllModelsPreview.generatedUsing, "Hybrid Processing");
assert.equal(enableAllModelsPreview.selectedModel.primary.id, "openai");
assert.equal(enableAllModelsPreview.connectivity.cloudAllowed, true);

const localAdapterSecretPosture = getEnterpriseSecretPosture({
  ...process.env,
  CARE_NOVA_ENABLE_ALL_MODELS: "true",
  CARE_NOVA_PAID_MODELS_ENABLED: "true",
  CARE_NOVA_CLOUD_MODELS_ENABLED: "true",
  CARE_NOVA_OPENAI_ENABLED: "true",
  OPENAI_BASE_URL: "http://127.0.0.1:11434/v1/chat/completions",
  CARE_NOVA_SECRET_LAST_ROTATED_AT: "2026-07-01T00:00:00Z"
});

assert.equal(localAdapterSecretPosture.status, "secret-posture-ready");
assert.equal(localAdapterSecretPosture.summary.usesCloudProviders, false);
assert.equal(localAdapterSecretPosture.summary.localAdapterCloudProviderSlots >= 1, true);
assert.equal(localAdapterSecretPosture.summary.requiredSecretSlots, 0);
assert.equal(localAdapterSecretPosture.summary.missingRequiredSecretSlots, 0);

const remoteCloudSecretPosture = getEnterpriseSecretPosture({
  ...process.env,
  CARE_NOVA_PAID_MODELS_ENABLED: "true",
  CARE_NOVA_CLOUD_MODELS_ENABLED: "true",
  CARE_NOVA_OPENAI_ENABLED: "true",
  OPENAI_BASE_URL: "https://api.openai.com/v1/chat/completions",
  CARE_NOVA_SECRET_LAST_ROTATED_AT: "2026-07-01T00:00:00Z"
});

assert.equal(remoteCloudSecretPosture.summary.usesCloudProviders, true);
assert.ok(remoteCloudSecretPosture.summary.requiredSecretSlots >= 1);
assert.ok(remoteCloudSecretPosture.reviewPoints.some((point) => /OPENAI_API_KEY/.test(point)));

const cloudGatewayEnv = {
  ...process.env,
  CARE_NOVA_FORCE_OFFLINE: "false",
  CARE_NOVA_INTERNET_AVAILABLE: "true",
  CARE_NOVA_PAID_MODELS_ENABLED: "true",
  CARE_NOVA_CLOUD_MODELS_ENABLED: "true",
  CARE_NOVA_OPENAI_ENABLED: "true",
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "gpt-5.4",
  CARE_NOVA_TEMP_CLOUD_API_URL: "http://127.0.0.1:1234/v1/chat/completions"
};
const originalFetch = globalThis.fetch;

const specialistLocalCloudStatus = getSpecialistLlmAgentStatus({
  ...process.env,
  CARE_NOVA_FORCE_OFFLINE: "false",
  CARE_NOVA_INTERNET_AVAILABLE: "true",
  CARE_NOVA_SPECIALIST_LLM_CLOUD_ENABLED: "true",
  CARE_NOVA_TEMP_CLOUD_API_URL: "http://127.0.0.1:1234/v1/chat/completions",
  CARE_NOVA_TEMP_CLOUD_MODEL: "gpt-5.4",
  CARE_NOVA_TEMP_CLOUD_API_KEY: ""
});

assert.equal(specialistLocalCloudStatus.enabled, true);
assert.equal(specialistLocalCloudStatus.configured, true);
assert.equal(specialistLocalCloudStatus.status, "ready");

const specialistRemoteMissingKeyStatus = getSpecialistLlmAgentStatus({
  ...process.env,
  CARE_NOVA_FORCE_OFFLINE: "false",
  CARE_NOVA_INTERNET_AVAILABLE: "true",
  CARE_NOVA_SPECIALIST_LLM_CLOUD_ENABLED: "true",
  LOCAL_LLM_ENABLED: "false",
  CARE_NOVA_SPECIALIST_LLM_API_KEY: "",
  CARE_NOVA_TEMP_CLOUD_API_URL: "https://api.openai.com/v1/chat/completions",
  CARE_NOVA_TEMP_CLOUD_MODEL: "gpt-5.4",
  CARE_NOVA_TEMP_CLOUD_API_KEY: "",
  OPENAI_API_KEY: ""
});

assert.equal(specialistRemoteMissingKeyStatus.enabled, true);
assert.equal(specialistRemoteMissingKeyStatus.configured, false);
assert.equal(specialistRemoteMissingKeyStatus.status, "missing-configuration");
assert.match(specialistRemoteMissingKeyStatus.reason, /API key is missing/i);

const specialistProviderAutoStatus = getSpecialistLlmAgentStatus({
  ...process.env,
  CARE_NOVA_FORCE_OFFLINE: "false",
  CARE_NOVA_INTERNET_AVAILABLE: "true",
  CARE_NOVA_SPECIALIST_LLM_CLOUD_ENABLED: "false",
  CARE_NOVA_TEMP_CLOUD_RESPONSE_ENABLED: "false",
  LOCAL_LLM_ENABLED: "false",
  CARE_NOVA_PAID_MODELS_ENABLED: "true",
  CARE_NOVA_CLOUD_MODELS_ENABLED: "true",
  CARE_NOVA_OPENAI_ENABLED: "",
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "gpt-5.4",
  OPENAI_BASE_URL: "https://api.openai.com/v1/chat/completions"
});

assert.equal(specialistProviderAutoStatus.enabled, true);
assert.equal(specialistProviderAutoStatus.configured, true);
assert.equal(specialistProviderAutoStatus.provider, "openai");

const demoCloudFallbackStatus = getTemporaryCloudLlmStatus({
  ...process.env,
  CARE_NOVA_ENABLE_ALL_MODELS: "true",
  CARE_NOVA_FORCE_OFFLINE: "false",
  CARE_NOVA_INTERNET_AVAILABLE: "true",
  CARE_NOVA_ONLINE_MODE: "true",
  CARE_NOVA_PAID_MODELS_ENABLED: "true",
  CARE_NOVA_CLOUD_MODELS_ENABLED: "true",
  CARE_NOVA_OPENAI_ENABLED: "true",
  CARE_NOVA_TEMP_CLOUD_API_URL: "",
  OPENAI_BASE_URL: "",
  OPENAI_API_KEY: "",
  LOCAL_LLM_URL: "http://127.0.0.1:1234/v1/chat/completions",
  LOCAL_LLM_MODEL: "qwen2.5:3b"
});

assert.equal(demoCloudFallbackStatus.enabled, true);
assert.equal(demoCloudFallbackStatus.configured, true);
assert.equal(demoCloudFallbackStatus.endpointIsLocal, true);
assert.equal(demoCloudFallbackStatus.status, "ready");

const specialistEnableAllModelsStatus = getSpecialistLlmAgentStatus({
  ...process.env,
  CARE_NOVA_ENABLE_ALL_MODELS: "true",
  CARE_NOVA_FORCE_OFFLINE: "false",
  CARE_NOVA_INTERNET_AVAILABLE: "true",
  LOCAL_LLM_ENABLED: "false",
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "gpt-5.4",
  OPENAI_BASE_URL: "https://api.openai.com/v1/chat/completions"
});

assert.equal(specialistEnableAllModelsStatus.enabled, true);
assert.equal(specialistEnableAllModelsStatus.configured, true);
assert.equal(specialistEnableAllModelsStatus.provider, "openai");

// The server starts a background probe loop that also uses fetch. Pause it while
// the smoke suite replaces global fetch with mocked cloud/local responses.
stopLocalRuntimeProbeLoop();

try {
  let capturedCloudRequestBody = null;

  globalThis.fetch = async (_url, options = {}) => ({
    ok: true,
    async json() {
      capturedCloudRequestBody = JSON.parse(options.body || "{}");
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              title: "Appeal packet summary",
              summary: "Use the local packet to organize the appeal and highlight the policy gap.",
              whatToDoNow: ["Confirm the missing policy requirement.", "Prepare the provider-facing summary."],
              warningSigns: ["Escalate if the packet is missing required evidence."],
              doctorQuestion: "Which policy criterion is still missing from the packet?",
              missingContext: ["appeal member identifier"],
              evidenceFocus: ["Policy summary", "Appeal timeline"],
              confidenceLabel: "grounded-cloud-review",
              supportRouteUpdates: [{
                route: "CLAIMS_OPS_AGENT",
                actionAdditions: ["Validate the denial letter date against the appeal timeline before submitting."],
                missingContext: ["member ID on the appeal cover sheet"],
                confidenceLabel: "grounded-cloud-claims-support"
              }]
            })
          }
        }]
      };
    }
  });

  const hybridCloudResult = {
    finalResponse: {
      title: "Local answer",
      summary: "Use the local workflow.",
      whatToDoNow: ["Review the appeal packet."],
      warningSigns: ["Do not submit with missing documents."],
      disclaimer: "Demo only.",
      responseFocus: {
        primaryRoute: "UTILIZATION_AGENT",
        requirement: {
          answerMode: "deep"
        }
      }
    },
    plan: {
      responseOwner: {
        route: "UTILIZATION_AGENT"
      },
      execute: ["UTILIZATION_AGENT", "CLAIMS_OPS_AGENT"],
      routeReasons: {
        UTILIZATION_AGENT: ["Policy criteria and appeal rationale need aligned review."]
      }
    },
    risk: {
      label: "LOW",
      level: "LOW"
    },
    requirementProfile: {
      answerMode: {
        id: "deep"
      }
    },
    modelRouting: {
      processingType: "hybrid",
      selectedModel: {
        primary: {
          id: "openai",
          displayName: "OpenAI GPT",
          type: "cloud"
        },
        fallback: {
          id: "care-nova-local-core",
          displayName: "Care Nova Local Clinical Core",
          type: "local"
        }
      },
      failover: {
        chain: ["OpenAI GPT", "Care Nova Local Clinical Core"]
      }
    },
    agentResults: [{
      id: "UTILIZATION_AGENT",
      name: "Prior Authorization",
      output: {
        summary: "Local utilization summary",
        checklist: ["Collect the payer policy."],
        doctorQuestions: []
      }
    }, {
      id: "CLAIMS_OPS_AGENT",
      name: "Claims Operations",
      output: {
        summary: "Claims packet should include the denial letter and appeal timeline.",
        checklist: ["Attach the denial letter.", "Confirm the claim number."],
        missingContext: ["denial letter date"]
      }
    }],
    medicalKnowledge: {
      matches: [{
        title: "Policy reference",
        category: "Insurance",
        summary: "Use the approved policy summary already in the packet.",
        safetyNotes: "Administrative draft only.",
        relevance: 91
      }]
    },
    memoryContext: {
      recentTurnCount: 2,
      recentRisks: ["LOW"],
      recentMessages: ["Need help with an appeal packet."]
    },
    model: {}
  };
  const hybridCloudResultState = structuredClone(hybridCloudResult);
  const hybridCloudExecution = await tryEnhanceAnalyzeResultWithCloudLlm({
    payload: {
      message: "Summarize this prior authorization appeal packet.",
      profile
    },
    result: hybridCloudResultState,
    env: cloudGatewayEnv
  });

  assert.equal(hybridCloudExecution.applied, true);
  assert.equal(hybridCloudExecution.engagementMode, "route-aware-clinical-second-pass");
  assert.equal(hybridCloudExecution.requestedForThisRun, true);
  assert.match(
    capturedCloudRequestBody?.messages?.[1]?.content || "",
    /supportAgents/i,
    "Cloud second-pass regression: route-aware cloud packets should include support-agent context."
  );
  assert.match(
    capturedCloudRequestBody?.messages?.[1]?.content || "",
    /CLAIMS_OPS_AGENT|Claims Operations/i,
    "Cloud second-pass regression: support-agent packet should carry adjacent route details."
  );
  assert.ok(
    Array.isArray(hybridCloudResultState.finalResponse.supportSections)
      && hybridCloudResultState.finalResponse.supportSections.some((section) => section.id === "llm-refined-focus"),
    "Cloud second-pass regression: LLM refinement should add a visible refined-focus support section."
  );
  assert.ok(
    hybridCloudResultState.finalResponse.supportSections.some((section) => Array.isArray(section.items) && section.items.some((item) => /policy summary|appeal timeline|ask next/i.test(item))),
    "Cloud second-pass regression: refined focus items should expose cloud evidence focus or the next grounded question."
  );
  assert.ok(
    hybridCloudResultState.finalResponse.supportSections.some((section) => Array.isArray(section.items) && section.items.some((item) => /appeal member identifier/i.test(item))),
    "Cloud second-pass regression: final-response cloud assist should surface rooted missing context in the refined-focus section."
  );
  assert.ok(
    hybridCloudResultState.agentResults[1].output.checklist.some((item) => /denial letter date/i.test(item)),
    "Cloud second-pass regression: support-route cloud updates should strengthen supporting route actions, not only the primary route."
  );
  assert.ok(
    hybridCloudResultState.agentResults[1].output.missingFields.some((item) => /member ID on the appeal cover sheet/i.test(item)),
    "Cloud second-pass regression: support-route cloud updates should write missing-detail cues into route-visible gap fields."
  );
  assert.match(
    hybridCloudResultState.finalResponse.agentSummary,
    /policy gap/i,
    "Cloud second-pass regression: agent summary should refresh after the cloud rewrite updates the primary route."
  );

  const localOnlyExecution = await tryEnhanceAnalyzeResultWithCloudLlm({
    payload: {
      message: "I have a mild headache and want general advice.",
      profile
    },
    result: {
      finalResponse: {
        title: "Local answer",
        summary: "Stay hydrated and monitor symptoms.",
        whatToDoNow: ["Hydrate."],
        warningSigns: ["Seek urgent care for severe symptoms."],
        disclaimer: "Demo only.",
        responseFocus: {
          primaryRoute: "RAG_AGENT",
          requirement: {
            answerMode: "quick"
          }
        }
      },
      plan: {
        responseOwner: {
          route: "RAG_AGENT"
        }
      },
      risk: {
        label: "LOW",
        level: "LOW"
      },
      requirementProfile: {
        answerMode: {
          id: "quick"
        }
      },
      modelRouting: {
        processingType: "local",
        selectedModel: {
          primary: {
            id: "deepseek-r1",
            displayName: "DeepSeek-R1",
            type: "local"
          },
          fallback: {
            id: "care-nova-local-core",
            displayName: "Care Nova Local Clinical Core",
            type: "local"
          }
        },
        failover: {
          chain: ["DeepSeek-R1", "Care Nova Local Clinical Core"]
        }
      },
      model: {}
    },
    env: cloudGatewayEnv
  });

  assert.equal(localOnlyExecution.requestedForThisRun, false);
  assert.equal(localOnlyExecution.attempted, false);

  let capturedCloudSpecialistRequestBody = null;

  globalThis.fetch = async (_url, options = {}) => ({
    ok: true,
    async json() {
      capturedCloudSpecialistRequestBody = JSON.parse(options.body || "{}");
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              title: "Specialist review",
              summary: "Use the symptom pattern, medicine timing, and kidney trend to guide the next review.",
              whatToDoNow: ["Bring the home BP log, medicine timing, and kidney report to the next review."],
              warningSigns: ["Use urgent care if chest pain, fainting, or severe weakness appears."],
              doctorQuestion: "Which symptom pattern changed the most since the last review?",
              missingContext: ["exact missed-dose time before the BP spike"],
              evidenceFocus: ["Kidney trend", "Medicine timing"],
              confidenceLabel: "grounded-cloud-specialist",
              supportRouteUpdates: [{
                route: "PHARMACY_AGENT",
                actionAdditions: ["Bring the pill bottle or dose schedule to confirm the missed-dose plan."],
                questionAdditions: ["Should I restart the missed dose at the usual time or call first?"],
                missingContext: ["exact missed-dose timing"],
                evidenceFocus: ["Dose timing versus symptoms"],
                confidenceLabel: "grounded-cloud-pharmacy-support"
              }]
            })
          }
        }]
      };
    }
  });

  const cloudSpecialistState = {
    finalResponse: {
      title: "Specialist review",
      summary: "Base specialist summary.",
      whatToDoNow: ["Track the symptom timing."],
      warningSigns: ["Seek urgent care for severe symptoms."],
      disclaimer: "Demo only.",
      responseFocus: {
        primaryRoute: "SPECIALIST_DOCTOR_AGENT",
        requirement: {
          answerMode: "deep"
        }
      }
    },
    plan: {
      responseOwner: {
        route: "SPECIALIST_DOCTOR_AGENT"
      },
      execute: ["SPECIALIST_DOCTOR_AGENT", "PHARMACY_AGENT"]
    },
    risk: {
      label: "HIGH",
      level: "HIGH"
    },
    requirementProfile: {
      answerMode: {
        id: "deep"
      }
    },
    modelRouting: {
      processingType: "hybrid",
      selectedModel: {
        primary: {
          id: "openai",
          displayName: "OpenAI GPT",
          type: "cloud"
        },
        fallback: {
          id: "care-nova-local-core",
          displayName: "Care Nova Local Clinical Core",
          type: "local"
        }
      },
      failover: {
        chain: ["OpenAI GPT", "Care Nova Local Clinical Core"]
      }
    },
    agentResults: [{
      id: "SPECIALIST_DOCTOR_AGENT",
      name: "Specialist review",
      output: {
        summary: "Base specialist summary.",
        patientAnswerSummary: "Track the symptom timing.",
        specialistActions: ["Track the symptom timing."],
        doctorQuestions: ["Which symptom started first?"],
        checklist: ["Track the symptom timing."],
        precautions: ["Seek urgent care for severe symptoms."]
      }
    }, {
      id: "PHARMACY_AGENT",
      name: "Medication safety",
      output: {
        summary: "Track the last missed dose and medicine timing.",
        patientAnswerSummary: "Check the last missed dose timing before changing anything.",
        pharmacyActions: ["Write down the last missed dose and current label instructions."],
        pharmacistQuestions: ["Should I restart the missed dose at the usual time?"],
        reviewGaps: ["exact missed-dose timing"]
      }
    }],
    medicalKnowledge: {
      matches: []
    },
    memoryContext: {
      recentTurnCount: 1,
      recentRisks: ["HIGH"],
      recentMessages: ["My BP has been high and I missed doses."]
    },
    model: {}
  };
  const cloudSpecialistExecution = await tryEnhanceAnalyzeResultWithCloudLlm({
    payload: {
      message: "My BP has been high and I missed doses.",
      profile
    },
    result: cloudSpecialistState,
    env: cloudGatewayEnv
  });

  assert.equal(cloudSpecialistExecution.applied, true);
  assert.match(
    capturedCloudSpecialistRequestBody?.messages?.[1]?.content || "",
    /Should I restart the missed dose at the usual time/i,
    "Cloud route-field regression: route-aware cloud packets should preserve support-route question cues from specialist-adjacent lanes."
  );
  assert.ok(
    cloudSpecialistState.agentResults[0].output.specialistActions.some((item) => /home BP log|kidney report/i.test(item)),
    "Cloud route-field regression: specialist cloud assist should update specialistActions, not only checklist."
  );
  assert.ok(
    cloudSpecialistState.agentResults[0].output.doctorQuestions.some((item) => /Which symptom pattern changed the most/i.test(item)),
    "Cloud route-field regression: specialist cloud assist should update route-specific doctor questions."
  );
  assert.match(
    cloudSpecialistState.agentResults[0].output.patientAnswerSummary,
    /symptom pattern, medicine timing, and kidney trend/i,
    "Cloud route-field regression: specialist cloud assist should refresh patientAnswerSummary for the route tab."
  );
  assert.ok(
    cloudSpecialistState.agentResults[1].output.pharmacyActions.some((item) => /pill bottle|dose schedule/i.test(item)),
    "Cloud route-field regression: cloud support-route updates should strengthen the specialist support lane actions."
  );
  assert.ok(
    cloudSpecialistState.agentResults[1].output.pharmacistQuestions.some((item) => /usual time or call first/i.test(item)),
    "Cloud route-field regression: cloud support-route updates should write back into route-specific question fields."
  );
  assert.ok(
    cloudSpecialistState.agentResults[1].output.reviewGaps.some((item) => /exact missed-dose timing/i.test(item)),
    "Cloud route-field regression: cloud support-route updates should preserve visible support-lane missing detail prompts."
  );

  let capturedLocalReasoningRequestBody = null;

  globalThis.fetch = async (_url, options = {}) => ({
    ok: true,
    async json() {
      capturedLocalReasoningRequestBody = JSON.parse(options.body || "{}");
      return {
        message: {
          content: JSON.stringify({
            summary_upgrade: "Compare the symptom change with the last BP pattern and any recent medicine delay before deciding the next step.",
            step_additions: ["Compare the current symptom pattern with the last reading or medicine timing change."],
            warning_additions: ["Get urgent care for severe breathing trouble, chest pain, or fainting."],
            missing_question: "Which reading, trigger, or medicine timing changed the most?",
            missing_context: ["exact time of the delayed dose before the BP rise"],
            evidence_focus: ["Symptom change versus baseline", "Recent medicine timing change"],
            confidence_label: "grounded-local-review",
            support_route_updates: [{
              route: "VITALS_AGENT",
              action_additions: ["Repeat the BP after 5 minutes and note the dose timing."],
              question_additions: ["Does the new BP pattern need same-day review?"],
              missing_context: ["repeat BP pair after rest"],
              evidence_focus: ["Repeat BP versus symptom timing"],
              confidence_label: "grounded-local-vitals"
            }]
          })
        }
      };
    }
  });

  const localReasoningEnv = {
    ...process.env,
    CARE_NOVA_FORCE_OFFLINE: "false",
    CARE_NOVA_INTERNET_AVAILABLE: "true",
    CARE_NOVA_LOCAL_REASONING_ASSIST_ENABLED: "true",
    LOCAL_LLM_ENABLED: "true",
    LOCAL_LLM_PROVIDER: "qwen",
    CARE_NOVA_LOCAL_MODELS: "qwen",
    LOCAL_LLM_URL: "https://local-reasoning.example/v1/chat/completions",
    LOCAL_LLM_MODEL: "qwen2.5",
    LOCAL_LLM_API_KEY: "test-key"
  };
  const localReasoningState = {
    finalResponse: {
      title: "General guidance",
      summary: "Base general summary.",
      whatToDoNow: ["Track the symptom timing."],
      warningSigns: ["Seek urgent care for severe symptoms."],
      responseFocus: {
        primaryRoute: "RAG_AGENT",
        requirement: {
          answerMode: "quick"
        }
      }
    },
    plan: {
      responseOwner: {
        route: "RAG_AGENT"
      },
      execute: ["RAG_AGENT", "VITALS_AGENT"]
    },
    risk: {
      label: "MEDIUM",
      level: "MEDIUM"
    },
    requirementProfile: {
      answerMode: {
        id: "quick"
      }
    },
    modelRouting: {
      generatedUsing: "Local Model",
      processingType: "local"
    },
    agentResults: [{
      id: "RAG_AGENT",
      name: "General Health Intelligence",
      output: {
        summary: "Base general summary.",
        patientAnswerSummary: "Track the symptom timing.",
        safeActions: ["Track the symptom timing."],
        focusQuestions: ["What changed first?"],
        checklist: ["Track the symptom timing."]
      }
    }, {
      id: "VITALS_AGENT",
      name: "Vital Specialist Review",
      output: {
        summary: "Recheck the BP with correct technique.",
        vitalActions: ["Repeat the BP after rest."],
        clinicianQuestions: ["Does this change how soon I should be reviewed?"]
      }
    }],
    medicalKnowledge: {
      matches: []
    },
    memoryContext: {
      recentTurnCount: 1,
      recentRisks: ["MEDIUM"],
      recentMessages: ["My BP changed after a missed dose."]
    }
  };
  const localReasoningExecution = await tryEnhanceAnalyzeResultWithLocalReasoning({
    payload: {
      message: "My BP changed after a missed dose.",
      profile
    },
    result: localReasoningState,
    env: localReasoningEnv
  });

  assert.equal(localReasoningExecution.applied, true);
  assert.match(
    capturedLocalReasoningRequestBody?.messages?.[1]?.content || "",
    /supportAgents/i,
    "Local reasoning regression: local reasoning packets should include support-agent context."
  );
  assert.match(
    capturedLocalReasoningRequestBody?.messages?.[1]?.content || "",
    /Does this change how soon I should be reviewed/i,
    "Local reasoning regression: route-aware local reasoning packets should preserve support-route clinician question cues."
  );
  assert.ok(
    localReasoningState.agentResults[0].output.safeActions.some((item) => /last reading|medicine timing change/i.test(item)),
    "Local reasoning route-field regression: general local reasoning should update safeActions, not only checklist."
  );
  assert.ok(
    localReasoningState.agentResults[0].output.focusQuestions.some((item) => /Which reading, trigger, or medicine timing changed the most/i.test(item)),
    "Local reasoning route-field regression: general local reasoning should update focusQuestions."
  );
  assert.match(
    localReasoningState.agentResults[0].output.patientAnswerSummary,
    /Compare the symptom change with the last BP pattern/i,
    "Local reasoning route-field regression: route-level patientAnswerSummary should refresh after local reasoning assist."
  );
  assert.ok(
    localReasoningState.agentResults[1].output.vitalActions.some((item) => /5 minutes|dose timing/i.test(item)),
    "Local reasoning route-field regression: local support-route updates should strengthen support-lane actions."
  );
  assert.ok(
    localReasoningState.agentResults[1].output.clinicianQuestions.some((item) => /same-day review/i.test(item)),
    "Local reasoning route-field regression: local support-route updates should write into route-specific clinician questions."
  );
  assert.ok(
    localReasoningState.agentResults[1].output.accuracyGaps.some((item) => /repeat BP pair after rest/i.test(item)),
    "Local reasoning route-field regression: local support-route updates should populate visible route-specific gap fields."
  );

  const capturedSpecialistRequestBodies = [];

  globalThis.fetch = async (_url, options = {}) => ({
    ok: true,
    async json() {
      capturedSpecialistRequestBodies.push(JSON.parse(options.body || "{}"));
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "Cross-check the symptom pattern, medicine timing, kidney trend, and urgent red flags before the next care step.",
              patient_answer_summary: "Use the collected details to guide the next clinician conversation without changing the current care plan.",
              action_additions: [
                "Bring the home BP log, medicine timing, and kidney lab trend to the next review."
              ],
              question_additions: [
                "Which symptom, BP trend, or kidney change matters most for the next follow-up?"
              ],
              warning_additions: [
                "Escalate if BP stays very high with chest pain, fainting, weakness, or confusion."
              ],
              missing_context: [
                "recent home blood pressure trend"
              ],
              evidence_focus: [
                "Kidney function trend versus prior report",
                "Timing of missed or delayed medicines"
              ],
              confidence_label: "grounded-specialist-review"
            })
          }
        }]
      };
    }
  });

  const specialistAssist = await tryEnhanceSpecialistAgentResultsWithLlm({
    message: "My BP has been high, my kidney numbers changed, and I missed a few doses. What should I prepare for the next review?",
    profile,
    risk: {
      level: "HIGH",
      label: "HIGH"
    },
    plan: {
      execute: ["SPECIALIST_DOCTOR_AGENT", "PHARMACY_AGENT", "LABS_AGENT", "ALERT_AGENT"],
      responseOwner: {
        route: "SPECIALIST_DOCTOR_AGENT"
      }
    },
    requirementProfile: {
      expectedRoute: "SPECIALIST_DOCTOR_AGENT"
    },
    agentResults: [
      {
        id: "SPECIALIST_DOCTOR_AGENT",
        name: "Specialist review",
        output: {
          summary: "The specialist review needs better symptom timing and BP trend detail.",
          patientAnswerSummary: "Prepare the symptom timeline and current BP pattern.",
          specialistActions: ["Write down the symptom start time and the latest BP readings."],
          doctorQuestions: ["Which symptoms are new versus usual for you?"],
          reasoning: {
            score: 76,
            label: "Needs more detail"
          },
          qualityGate: {
            status: "review"
          },
          missingContext: ["current home BP log"]
        }
      },
      {
        id: "RECORDS_AGENT",
        name: "Health records",
        output: {
          summary: "The summary is missing the latest medication and lab timeline.",
          patientAnswerSummary: "Bring the latest note and timeline summary.",
          checklist: ["Write down the latest BP, symptoms, medicines, and lab dates in one note."],
          reasoning: {
            score: 71,
            label: "Partial context"
          },
          qualityGate: {
            status: "review"
          },
          missingContext: ["single combined symptom and medicine timeline"]
        }
      },
      {
        id: "SCHEDULING_AGENT",
        name: "Appointment booking",
        output: {
          summary: "Follow-up timing depends on the symptom and medicine pattern.",
          patientAnswerSummary: "Confirm how soon the next review should happen.",
          visitActions: ["Ask whether the next review should be same-day if the readings stay high."],
          reasoning: {
            score: 70,
            label: "Needs more detail"
          },
          qualityGate: {
            status: "review"
          },
          missingContext: ["how soon the clinician wants the next review"]
        }
      },
      {
        id: "PHARMACY_AGENT",
        name: "Medication safety",
        output: {
          summary: "Medicine timing is incomplete.",
          patientAnswerSummary: "Check the last missed doses and the label instructions.",
          pharmacyActions: ["Write down the last missed or delayed doses."],
          pharmacistQuestions: ["Should I take the next dose at the usual time or call first?"],
          reasoning: {
            score: 72,
            label: "Limited detail"
          },
          qualityGate: {
            status: "review"
          },
          missingContext: ["recent missed doses"]
        }
      },
      {
        id: "LABS_AGENT",
        name: "Lab review",
        output: {
          summary: "Kidney markers need comparison with the prior report.",
          patientAnswerSummary: "Compare the latest creatinine and eGFR with the previous result.",
          labActions: ["List the latest creatinine, eGFR, potassium, and date."],
          reasoning: {
            score: 74,
            label: "Partial context"
          },
          qualityGate: {
            status: "review"
          },
          missingContext: ["previous creatinine value"]
        }
      },
      {
        id: "ALERT_AGENT",
        name: "Urgent safety",
        output: {
          summary: "Escalate severe or fast-worsening symptoms promptly.",
          patientAnswerSummary: "Use urgent care if symptoms become severe.",
          safetyActions: ["Use urgent care now for severe or worsening symptoms."],
          reasoning: {
            score: 83,
            label: "Monitor closely"
          },
          qualityGate: {
            status: "review"
          },
          missingContext: ["current red-flag symptoms"]
        }
      }
    ],
    medicalKnowledge: {},
    llmBrain: {
      label: "Clinical routing core",
      summary: "Owner route and safety coverage selected."
    },
    modelRouting: {
      generatedUsing: "Local Model",
      processingType: "local",
      selectedModel: {
        primary: {
          displayName: "Care Nova Local Clinical Core"
        }
      }
    },
    env: {
      ...process.env,
      CARE_NOVA_FORCE_OFFLINE: "false",
      CARE_NOVA_INTERNET_AVAILABLE: "true",
      CARE_NOVA_SPECIALIST_LLM_CLOUD_ENABLED: "true",
      CARE_NOVA_SPECIALIST_LLM_AGENTS_MAX: "4",
      CARE_NOVA_TEMP_CLOUD_API_URL: "http://127.0.0.1:1234/v1/chat/completions",
      CARE_NOVA_TEMP_CLOUD_MODEL: "gpt-5.4"
    }
  });

  assert.equal(specialistAssist.execution.applied, true);
  assert.equal(specialistAssist.execution.targetRoutes.length, 4);
  assert.ok(
    specialistAssist.execution.targetRoutes.includes("SPECIALIST_DOCTOR_AGENT")
      && specialistAssist.execution.targetRoutes.includes("ALERT_AGENT"),
    "Specialist assist regression: owner and safety routes should both stay eligible for LLM refinement on complex requests."
  );
  assert.ok(
    capturedSpecialistRequestBodies.some((body) => /peerRoutes/i.test(body?.messages?.[1]?.content || "") && /PHARMACY_AGENT|Medication safety/i.test(body?.messages?.[1]?.content || "")),
    "Specialist assist regression: specialist packets should include peer-route context for adjacent care lanes."
  );
  assert.ok(
    capturedSpecialistRequestBodies.some((body) => /peerRoutes/i.test(body?.messages?.[1]?.content || "") && /ALERT_AGENT|Urgent safety/i.test(body?.messages?.[1]?.content || "")),
    "Specialist assist regression: high-priority safety lanes should stay in peer-route context even when lower-value routes appear first."
  );
  assert.ok(
    capturedSpecialistRequestBodies.some((body) => /Should I take the next dose at the usual time or call first\?/i.test(body?.messages?.[1]?.content || "")),
    "Specialist assist regression: route-specific peer questions should include pharmacist questions instead of relying only on doctorQuestions."
  );
  assert.equal(
    specialistAssist.agentResults.filter((agent) => agent.output?.llmAgentAssist?.applied).length,
    4,
    "Specialist assist regression: the wider route selector should refine four high-value routes by default on complex requests."
  );

  const refreshedResult = {
    risk: {
      level: "MEDIUM",
      label: "MEDIUM"
    },
    plan: {
      responseOwner: {
        route: "SPECIALIST_DOCTOR_AGENT"
      }
    },
    requirementProfile: {},
    medicalKnowledge: {},
    reasoningQuality: {},
    llmBrain: {},
    agentResults: [
      {
        id: "SPECIALIST_DOCTOR_AGENT",
        name: "Specialist review",
        output: {
          summary: "Prepare the specialist timeline and current readings."
        }
      },
      {
        id: "PHARMACY_AGENT",
        name: "Medication safety",
        output: {
          llmAgentAssist: {
            applied: true,
            evidenceFocus: ["Missed-dose timing versus symptoms"],
            missingContext: ["last delayed dose time"]
          }
        }
      },
      {
        id: "LABS_AGENT",
        name: "Lab review",
        output: {
          llmAgentAssist: {
            applied: true,
            doctorQuestion: "Which kidney trend matters most for follow-up?"
          }
        }
      }
    ],
    finalResponse: {
      title: "Specialist review",
      summary: "Base specialist summary.",
      warningSigns: [],
      whatToDoNow: [],
      responseFocus: {
        primaryRoute: "SPECIALIST_DOCTOR_AGENT",
        summaryRoutes: ["SPECIALIST_DOCTOR_AGENT"]
      }
    }
  };

  refreshEnhancedFinalResponse({ result: refreshedResult });
  const refinedFocusSection = refreshedResult.finalResponse.supportSections.find((section) => section.id === "llm-refined-focus");

  assert.ok(
    refinedFocusSection?.items?.some((item) => /Medication safety: Focus: Missed-dose timing/i.test(item)),
    "Refined focus regression: support-route evidence focus should surface in the visible final answer."
  );
  assert.ok(
    refinedFocusSection?.items?.some((item) => /Lab review: Ask next: Which kidney trend matters most/i.test(item)),
    "Refined focus regression: support-route next questions should surface in the visible final answer."
  );
} finally {
  globalThis.fetch = originalFetch;
  startLocalRuntimeProbeLoop(process.env);
  await refreshLocalRuntimeProbe(process.env).catch(() => {});
}

console.log(runHttpSmoke ? "Offline smoke preflight passed." : "Offline smoke tests passed.");
}

if (runHttpSmoke) {
const server = createServerApp();
await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", resolve);
});

const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

try {
  const healthRequestId = "smoke-health-probe";
  const healthResponse = await fetch(`${baseUrl}/api/health`, {
    headers: {
      "X-Request-Id": healthRequestId
    }
  });
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  assert.equal(health.status, "healthy");
  assert.equal(health.app, "Care Nova AI");
  assert.equal(health.mode, "online-offline-local-parity");
  assert.equal(health.realtime, true);
  assert.equal(health.install, "pwa-ready");
  assert.equal(health.runtimeParity.sameCoreOnlineOffline, true);
  assert.equal(health.runtimeParity.internetRequired, false);
  assert.equal(health.memory.mode, "persistent-local-server");
  assert.equal(health.memory.file, "data/memory/patient-memory.json");
  assert.equal(health.records.mode, "persistent-local-server");
  assert.equal(health.records.file, "data/records/patient-records.json");
  const crossOriginHealthResponse = await fetch(`${baseUrl}/api/health`, {
    headers: {
      Origin: "https://github-pages-health-probe.invalid"
    }
  });
  assert.equal(crossOriginHealthResponse.status, 200);
  assert.equal(crossOriginHealthResponse.headers.get("access-control-allow-origin"), "*");
  const crossOriginHealth = await crossOriginHealthResponse.json();
  assert.equal(crossOriginHealth.ok, true);
  const blockedCrossOriginReadyResponse = await fetch(`${baseUrl}/api/ready`, {
    headers: {
      Origin: "https://github-pages-health-probe.invalid"
    }
  });
  assert.equal(blockedCrossOriginReadyResponse.status, 403);
  const blockedCrossOriginReady = await blockedCrossOriginReadyResponse.json();
  assert.equal(blockedCrossOriginReady.code, "ORIGIN_NOT_ALLOWED");
  assert.equal(health.externalKnowledge.mode, "disabled-local-cache-ready");
  assert.equal(health.externalKnowledge.cache.file, "data/external/external-knowledge-cache.json");
  assert.equal(health.externalKnowledge.futureRequestReuse, true);
  assert.equal(health.agenticRuntime.status, "adaptive-runtime-ready");
  assert.ok(validRuntimeStates.has(health.agenticRuntime.systemState));
  assert.ok(validRuntimeModes.has(health.agenticRuntime.activeMode));
  assert.equal(health.agenticRuntime.decision.selectedPath, health.agenticRuntime.activeMode);
  assert.equal(health.agenticRuntime.offline.ready, true);
  assert.equal(health.agenticRuntime.fallbackStrategy.applied, true);
  assert.ok(validHybridRouterStatuses.has(health.hybridRouter.status));
  assert.ok(Number.isInteger(health.hybridRouter.summary.availableCloudModels));
  assert.ok(health.hybridRouter.summary.availableCloudModels >= 0);
  assert.ok(health.hybridRouter.summary.cloudModelCount >= health.hybridRouter.summary.availableCloudModels);
  assert.equal(health.hybridRouter.connectivity.offlineExecutionReady, true);
  assert.ok(health.hybridRouter.processingLabels.includes("Local Model"));
  assert.equal(health.trustedSources.status, "offline-first-trusted-source-ready");
  assert.equal(health.trustedSources.sourceCount, 5);
  assert.equal(health.quality.metricCount, 9);
  assert.equal(health.advancedCapabilities.localFirst, true);
  assert.ok(health.advancedCapabilities.readyFeatures >= 5);
  assert.ok(health.evaluationDashboard.suiteCount >= 6);
  assert.equal(health.knowledgeGraph.mode, "persistent-local-server");
  assert.equal(health.training.mode, "persistent-local-ml-training-store");
  assert.equal(health.browserState.mode, "persistent-local-server");
  assert.ok(Array.isArray(health.browserState.snapshotFamilies));
  assert.equal(health.machineLearning.classicalMlReady, true);
  assert.equal(health.machineLearning.deepLearningAdapterReady, true);
  assert.equal(health.dataMirror.mode, "localhost-primary-plus-onedrive-local-mirror");
  assert.ok(health.dataMirror.trackedData.includes("browser state recovery snapshots"));
  assert.ok(health.dataMirror.mirrorRoot.includes("onedrive-mirror"));
  assert.equal(health.offlinePacks.runsWithoutInternet, true);
  assert.equal(health.fhir.noEhrCallByDefault, true);
  assert.equal(health.reports.downloadsSupported, true);
  assert.equal(health.deployment.globalReady, true);
  assert.equal(health.deployment.readinessEndpoint, "/api/ready");
  assert.equal(health.deployment.releaseGate, "npm run release:check");
  assert.equal(health.requestId, healthRequestId);
  assert.equal(health.operations.requestTracing, true);
  assert.equal(health.operations.apiCachePolicy, "no-store");
  assert.equal(health.operations.apiResponsesNotCached, true);
  assert.equal(health.operations.publicDeploymentMode, false);
  assert.equal(health.operations.rateLimiting.enabled, true);
  assert.ok(health.operations.rateLimiting.windowSeconds >= 1);
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
  assert.ok(health.dataRetention.status.startsWith("retention-policy-"));
  assert.ok(health.incidentPosture.status.startsWith("incident-posture-"));
  assert.ok(health.recoveryPosture.status.startsWith("recovery-posture-"));
  assert.ok(health.secretPosture.status.startsWith("secret-posture-"));
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
  assert.equal(health.traffic.state, "accepting");
  assert.equal(health.traffic.acceptingTraffic, true);
  assert.equal(healthResponse.headers.get("x-request-id"), healthRequestId);
  assert.equal(healthResponse.headers.get("x-care-nova-version"), health.version);
  assert.ok(Number(healthResponse.headers.get("x-response-time-ms")) >= 0);
  assert.match(healthResponse.headers.get("server-timing") || "", /app;desc="Care Nova AI";dur=\d+/);

  const readyResponse = await fetch(`${baseUrl}/api/ready`);
  const ready = await readyResponse.json();

  assert.equal(readyResponse.status, 200);
  assert.equal(ready.ok, true);
  assert.equal(ready.status, "ready");
  assert.ok(String(ready.requestId || "").length > 0);
  assert.equal(ready.traffic.state, "accepting");
  assert.equal(ready.traffic.acceptingTraffic, true);
  assert.equal(ready.operations.requestTracing, true);
  assert.equal(ready.enterpriseRuntime.safeLocalCoreReady, true);
  assert.equal(ready.enterpriseRuntime.operationalPolicy.rateLimitingEnabled, true);
  assert.equal(ready.publicDeployment.enabled, false);
  assert.equal(ready.publicDeployment.publicShareReady, true);
  assert.equal(ready.probes.deploymentReadiness, "/api/deployment-readiness");
  assert.equal(ready.probes.agenticRuntime, "/api/agentic-runtime");
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
  assert.equal(ready.probes.adminPolicy, "/api/admin-policy");
  assert.equal(ready.probes.adminReviewPacket, "/api/admin-review-packet");
  assert.equal(ready.probes.adminReleaseSnapshot, "/api/admin-release-snapshot");
  assert.equal(ready.probes.adminReviewHistory, "/api/admin-review-history");
  assert.equal(ready.probes.adminSession, "/api/admin/session");
  assert.equal(ready.probes.configReadiness, "/api/config-readiness");
  assert.equal(ready.probes.startupReadiness, "/api/startup-readiness");
  assert.equal(ready.probes.dataRetentionPolicy, "/api/data-retention-policy");
  assert.equal(ready.probes.incidentPosture, "/api/incident-posture");
  assert.equal(ready.probes.recoveryPosture, "/api/recovery-posture");
  assert.equal(ready.probes.adminSecretPosture, "/api/admin-secret-posture");
  assert.equal(ready.probes.auditEvents, "/api/audit-events");
  assert.equal(ready.probes.doctorReadyReport, "/api/doctor-ready-report");
  assert.equal(ready.probes.browserState, "/api/browser-state");
  assert.equal(ready.probes.browserStateSync, "/api/browser-state-sync");
  assert.equal(ready.probes.localDataMirror, "/api/local-data-mirror");
  assert.equal(ready.probes.runtimeMetrics, "/api/runtime-metrics");
  assert.equal(ready.probes.storageIntegrity, "/api/storage-integrity");
  assert.equal(ready.probes.training, "/api/training");
  assert.equal(ready.probes.trainingExample, "/api/training/example");
  assert.equal(ready.probes.trainingRun, "/api/training/train");
  assert.equal(ready.probes.trainingEvaluate, "/api/training/evaluate");

  const externalKnowledgeResponse = await fetch(`${baseUrl}/api/external-knowledge`);
  const externalKnowledge = await externalKnowledgeResponse.json();

  assert.equal(externalKnowledgeResponse.status, 200);
  assert.equal(externalKnowledge.ok, true);
  assert.equal(externalKnowledge.externalKnowledge.mode, "disabled-local-cache-ready");
  assert.equal(externalKnowledge.externalKnowledge.cache.file, "data/external/external-knowledge-cache.json");
  assert.equal(externalKnowledge.externalKnowledge.futureRequestReuse, true);

  const agenticRuntimeResponse = await fetch(`${baseUrl}/api/agentic-runtime`);
  const agenticRuntime = await agenticRuntimeResponse.json();

  assert.equal(agenticRuntimeResponse.status, 200);
  assert.equal(agenticRuntime.ok, true);
  assert.equal(agenticRuntime.agenticRuntime.id, "ADAPTIVE_AGENTIC_RUNTIME");
  assert.ok(validRuntimeStates.has(agenticRuntime.agenticRuntime.systemState));
  assert.ok(validRuntimeModes.has(agenticRuntime.agenticRuntime.activeMode));
  assert.equal(agenticRuntime.agenticRuntime.responseContract.complexQueries, "plan-execute-validate-respond");

  const modelRouterResponse = await fetch(`${baseUrl}/api/model-router`);
  const modelRouter = await modelRouterResponse.json();

  assert.equal(modelRouterResponse.status, 200);
  assert.equal(modelRouter.ok, true);
  assert.equal(modelRouter.router.id, "CARE_NOVA_HYBRID_MODEL_ROUTER");
  assert.ok(validHybridRouterStatuses.has(modelRouter.router.status));
  assert.ok(Number.isInteger(modelRouter.router.summary.availableCloudModels));
  assert.ok(Number.isInteger(modelRouter.router.summary.routableCloudModels || 0));
  assert.ok(modelRouter.router.summary.availableCloudModels >= 0);
  assert.ok(modelRouter.router.summary.cloudModelCount >= modelRouter.router.summary.availableCloudModels);
  assert.ok(modelRouter.router.summary.cloudModelCount >= (modelRouter.router.summary.routableCloudModels || 0));
  if ((modelRouter.router.summary.routableCloudModels || 0) > 0) {
    assert.equal(modelRouter.router.status, "hybrid-ready");
  }
  assert.equal(modelRouter.router.connectivity.offlineExecutionReady, true);

  const modelRouterPreviewResponse = await fetch(`${baseUrl}/api/model-router/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message: "Summarize a prior authorization appeal packet with policy evidence and audit logging." })
  });
  const modelRouterPreview = await modelRouterPreviewResponse.json();
  const expectedModelRouterPreviewLabel = (modelRouter.router.summary.routableCloudModels || 0) > 0
    ? "Hybrid Processing"
    : "Local Model";

  assert.equal(modelRouterPreviewResponse.status, 200);
  assert.equal(modelRouterPreview.ok, true);
  assert.equal(modelRouterPreview.decision.generatedUsing, expectedModelRouterPreviewLabel);
  assert.equal(modelRouterPreview.decision.failover.ready, true);

  const trustedSourcesResponse = await fetch(`${baseUrl}/api/trusted-sources?q=cholesterol report`);
  const trustedSources = await trustedSourcesResponse.json();

  assert.equal(trustedSourcesResponse.status, 200);
  assert.equal(trustedSources.ok, true);
  assert.equal(trustedSources.trustedSources.sourceCount, 5);
  assert.equal(trustedSources.plan.queryType, "lab");

  const trustedPlanResponse = await fetch(`${baseUrl}/api/trusted-sources/plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message: "What are metformin side effects?", tab: "medicine" })
  });
  const trustedPlan = await trustedPlanResponse.json();

  assert.equal(trustedPlanResponse.status, 200);
  assert.equal(trustedPlan.ok, true);
  assert.equal(trustedPlan.plan.queryType, "medicine");

  const qualityResponse = await fetch(`${baseUrl}/api/model-quality`);
  const quality = await qualityResponse.json();

  assert.equal(qualityResponse.status, 200);
  assert.equal(quality.ok, true);
  assert.equal(quality.quality.status, "quality-gate-ready");
  assert.ok(quality.quality.metrics.some((metric) => metric.id === "guardrail_compliance"));
  assert.ok(quality.quality.benchmarkCases.some((item) => item.expectedRoute === "ALERT_AGENT"));

  const governanceResponse = await fetch(`${baseUrl}/api/governance`);
  const governance = await governanceResponse.json();

  assert.equal(governanceResponse.status, 200);
  assert.equal(governance.ok, true);
  assert.equal(governance.governance.status, "governance-ready-for-demo");
  assert.equal(governance.governance.privacy.sendsPhiByDefault, false);
  assert.equal(governance.governance.summary.adminProtectedMutations, false);
  assert.equal(governance.governance.runtimeControls.requireAdminForMutations, false);
  assert.ok(governance.governance.dataLifecycle.summary.storeCount >= 7);

  const offlinePacksResponse = await fetch(`${baseUrl}/api/offline-packs`);
  const offlinePacks = await offlinePacksResponse.json();

  assert.equal(offlinePacksResponse.status, 200);
  assert.equal(offlinePacks.ok, true);
  assert.equal(offlinePacks.offlinePacks.summary.runsWithoutInternet, true);
  assert.ok(offlinePacks.offlinePacks.packs.some((pack) => pack.id === "cardiometabolic"));

  const fhirResponse = await fetch(`${baseUrl}/api/fhir`);
  const fhir = await fhirResponse.json();

  assert.equal(fhirResponse.status, 200);
  assert.equal(fhir.ok, true);
  assert.equal(fhir.fhir.summary.noEhrCallByDefault, true);
  assert.ok(fhir.fhir.resources.some((resource) => resource.resource === "Patient"));

  const reportsResponse = await fetch(`${baseUrl}/api/report-templates`);
  const reports = await reportsResponse.json();

  assert.equal(reportsResponse.status, 200);
  assert.equal(reports.ok, true);
  assert.equal(reports.reports.summary.patientSpecific, true);
  assert.ok(reports.reports.templates.some((template) => template.id === "insurance-claim-packet"));

  const advancedCapabilitiesResponse = await fetch(`${baseUrl}/api/advanced-capabilities`);
  const advancedCapabilities = await advancedCapabilitiesResponse.json();

  assert.equal(advancedCapabilitiesResponse.status, 200);
  assert.equal(advancedCapabilities.ok, true);
  assert.equal(advancedCapabilities.status, "advanced-agentic-capabilities-ready");
  assert.ok(advancedCapabilities.features.some((feature) => feature.id === "local_knowledge_graph"));

  const evaluationDashboardResponse = await fetch(`${baseUrl}/api/evaluation-dashboard`);
  const evaluationDashboard = await evaluationDashboardResponse.json();

  assert.equal(evaluationDashboardResponse.status, 200);
  assert.equal(evaluationDashboard.ok, true);
  assert.equal(evaluationDashboard.status, "evaluation-dashboard-ready");
  assert.ok(evaluationDashboard.suites.some((suite) => suite.id === "red_flag_recall"));

  const offlinePackManagerResponse = await fetch(`${baseUrl}/api/offline-pack-manager`);
  const offlinePackManager = await offlinePackManagerResponse.json();

  assert.equal(offlinePackManagerResponse.status, 200);
  assert.equal(offlinePackManager.ok, true);
  assert.equal(offlinePackManager.status, "offline-pack-manager-ready");
  assert.ok(offlinePackManager.packs.every((pack) => pack.checksum));

  const fhirConnectorResponse = await fetch(`${baseUrl}/api/fhir-connector`);
  const fhirConnector = await fhirConnectorResponse.json();

  assert.equal(fhirConnectorResponse.status, 200);
  assert.equal(fhirConnector.ok, true);
  assert.equal(fhirConnector.summary.noEhrCallByDefault, true);
  assert.ok(fhirConnector.scopes.includes("patient/Observation.read"));

  const trustCenterResponse = await fetch(`${baseUrl}/api/admin-trust-center`);
  const trustCenter = await trustCenterResponse.json();

  assert.equal(trustCenterResponse.status, 200);
  assert.equal(trustCenter.ok, true);
  assert.equal(trustCenter.status, "trust-center-ready");
  assert.ok(trustCenter.controls.length >= 4);
  assert.ok(trustCenter.controls.some((item) => /audit/i.test(item)));

  const backupPlanResponse = await fetch(`${baseUrl}/api/backup-plan`);
  const backupPlan = await backupPlanResponse.json();

  assert.equal(backupPlanResponse.status, 200);
  assert.equal(backupPlan.ok, true);
  assert.equal(backupPlan.status, "backup-plan-ready");
  assert.ok(backupPlan.files.includes("data/audit/operational-audit-log.json"));
  assert.ok(backupPlan.files.includes("data/audit/admin-review-history.json"));
  assert.ok(backupPlan.files.includes("data/graph/patient-knowledge-graph.json"));

  const adminPolicyResponse = await fetch(`${baseUrl}/api/admin-policy`);
  const adminPolicy = await adminPolicyResponse.json();

  assert.equal(adminPolicyResponse.status, 200);
  assert.equal(adminPolicy.ok, true);
  assert.equal(adminPolicy.status, "admin-policy-ready");
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
  assert.equal(adminPolicy.runtimeControls.requestValidation.requiresJsonContentType, true);
  assert.equal(adminPolicy.runtimeControls.mutationControls.requireAdminForMutations, false);
  assert.equal(adminPolicy.accessControls.requireAdminForMutations, false);
  assert.equal(adminPolicy.accessControls.patientAccessRequired, false);
  assert.ok(adminPolicy.accessControls.patientProtectedRouteCount >= 5);
  assert.ok(adminPolicy.dataLifecycle.summary.storeCount >= 7);
  assert.ok(["retention-policy-ready", "retention-policy-review-needed"].includes(adminPolicy.dataRetention.status));
  assert.ok(["incident-posture-ready", "incident-posture-review-needed"].includes(adminPolicy.incidentPosture.status));
  assert.ok(["recovery-posture-ready", "recovery-posture-review-needed"].includes(adminPolicy.recoveryPosture.status));
  assert.ok(["secret-posture-ready", "secret-posture-review-needed"].includes(adminPolicy.secretPosture.status));

  const configReadinessResponse = await fetch(`${baseUrl}/api/config-readiness`);
  const configReadiness = await configReadinessResponse.json();

  assert.equal(configReadinessResponse.status, 200);
  assert.equal(configReadiness.ok, true);
  assert.ok(configReadiness.status.startsWith("config-"));
  assert.equal(configReadiness.summary.requestValidation.requiresJsonContentType, true);
  assert.equal(configReadiness.summary.requestValidation.requiresJsonObject, true);
  assert.equal(configReadiness.summary.requestValidation.maxJsonBodyBytes, 5_000_000);
  assert.equal(configReadiness.summary.patientAccessRequired, false);
  assert.equal(typeof configReadiness.summary.reviewerRoleAvailable, "boolean");

  const startupReadinessResponse = await fetch(`${baseUrl}/api/startup-readiness`);
  const startupReadiness = await startupReadinessResponse.json();

  assert.equal(startupReadinessResponse.status, 200);
  assert.equal(startupReadiness.status, "startup-ready");
  assert.equal(startupReadiness.summary.strictGuardEnabled, false);
  assert.equal(startupReadiness.summary.shouldBlockStartup, false);

  const dataRetentionPolicyResponse = await fetch(`${baseUrl}/api/data-retention-policy`);
  const dataRetentionPolicy = await dataRetentionPolicyResponse.json();

  assert.equal(dataRetentionPolicyResponse.status, 200);
  assert.equal(dataRetentionPolicy.ok, true);
  assert.ok(dataRetentionPolicy.status.startsWith("retention-policy-"));
  assert.ok(dataRetentionPolicy.summary.trackedStores >= 8);

  const incidentPostureResponse = await fetch(`${baseUrl}/api/incident-posture`);
  const incidentPosture = await incidentPostureResponse.json();

  assert.equal(incidentPostureResponse.status, 200);
  assert.equal(incidentPosture.ok, true);
  assert.ok(incidentPosture.status.startsWith("incident-posture-"));
  assert.ok(incidentPosture.summary.totalSeverityRunbooks >= 3);
  assert.equal(incidentPosture.incidentTargets.auditEvidenceEndpoint, "/api/audit-events");

  const recoveryPostureResponse = await fetch(`${baseUrl}/api/recovery-posture`);
  const recoveryPosture = await recoveryPostureResponse.json();

  assert.equal(recoveryPostureResponse.status, 200);
  assert.equal(recoveryPosture.ok, true);
  assert.ok(recoveryPosture.status.startsWith("recovery-posture-"));
  assert.ok(recoveryPosture.summary.coveredStores >= 8);
  assert.equal(recoveryPosture.recoveryTargets.restoreGuideEndpoint, "/api/backup-plan");

  const adminSecretPostureResponse = await fetch(`${baseUrl}/api/admin-secret-posture`);
  const adminSecretPosture = await adminSecretPostureResponse.json();

  assert.equal(adminSecretPostureResponse.status, 200);
  assert.equal(adminSecretPosture.ok, true);
  assert.ok(adminSecretPosture.status.startsWith("secret-posture-"));
  assert.ok(adminSecretPosture.summary.trackedSecretSlots >= 8);

  const adminReviewPacketResponse = await fetch(`${baseUrl}/api/admin-review-packet?includeEvents=true&eventLimit=5`);
  const adminReviewPacket = await adminReviewPacketResponse.json();

  assert.equal(adminReviewPacketResponse.status, 200);
  assert.equal(adminReviewPacket.ok, true);
  assert.equal(adminReviewPacket.status, "admin-review-packet-ready");
  assert.equal(adminReviewPacket.summary.redactionApplied.patientIds, true);
  assert.ok(Array.isArray(adminReviewPacket.packet.audit.events));
  assert.ok(adminReviewPacket.packet.audit.events.length <= 5);
  assert.equal(typeof adminReviewPacket.packet.identity.fingerprints.combined, "string");

  const adminReleaseSnapshotResponse = await fetch(`${baseUrl}/api/admin-release-snapshot`);
  const adminReleaseSnapshot = await adminReleaseSnapshotResponse.json();

  assert.equal(adminReleaseSnapshotResponse.status, 200);
  assert.equal(adminReleaseSnapshot.ok, true);
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

  const reviewHistoryResponse = await fetch(`${baseUrl}/api/admin-review-history?limit=5`);
  const reviewHistory = await reviewHistoryResponse.json();

  assert.equal(reviewHistoryResponse.status, 200);
  assert.equal(reviewHistory.status, "review-history-ready");
  assert.ok(Array.isArray(reviewHistory.entries));

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

  const mirrorStatusResponse = await fetch(`${baseUrl}/api/local-data-mirror`);
  const mirrorStatus = await mirrorStatusResponse.json();

  assert.equal(mirrorStatusResponse.status, 200);
  assert.equal(mirrorStatus.ok, true);
  assert.equal(mirrorStatus.mirror.mode, "localhost-primary-plus-onedrive-local-mirror");
  assert.ok(mirrorStatus.mirror.mirrorRoot.includes("onedrive-mirror"));

  const mirrorSyncResponse = await fetch(`${baseUrl}/api/local-data-mirror`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ reason: "smoke-test-sync" })
  });
  const mirrorSync = await mirrorSyncResponse.json();

  assert.equal(mirrorSyncResponse.status, 200);
  assert.equal(mirrorSync.ok, true);
  assert.equal(mirrorSync.mirror.status, "mirror-synced");
  assert.ok(mirrorSync.mirror.fileCount >= 1);
  assert.ok(mirrorSync.mirror.files.some((file) => file.mirror.includes("onedrive-mirror")));

  const originalRequireAdmin = process.env.CARE_NOVA_REQUIRE_ADMIN_FOR_MUTATIONS;
  const originalAdminToken = process.env.CARE_NOVA_ADMIN_API_TOKEN;
  const originalReviewerToken = process.env.CARE_NOVA_REVIEWER_API_TOKEN;
  const originalAdminAuthRequired = process.env.CARE_NOVA_ADMIN_AUTH_REQUIRED;
  const originalAdminSessionSecret = process.env.CARE_NOVA_ADMIN_SESSION_SECRET;
  const originalReadOnlyMode = process.env.CARE_NOVA_READ_ONLY_MODE;
  process.env.CARE_NOVA_REQUIRE_ADMIN_FOR_MUTATIONS = "true";
  process.env.CARE_NOVA_ADMIN_API_TOKEN = "smoke-test-admin";
  process.env.CARE_NOVA_REVIEWER_API_TOKEN = "smoke-test-reviewer";

  const blockedRecordSaveResponse = await fetch(`${baseUrl}/api/records`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: "smoke-mutation-guard",
      selectedRecordId: "guard-record",
      records: [{ id: "guard-record", patientName: "Guarded save" }]
    })
  });
  const blockedRecordSave = await blockedRecordSaveResponse.json();

  assert.equal(blockedRecordSaveResponse.status, 403);
  assert.equal(blockedRecordSave.ok, false);
  assert.equal(blockedRecordSave.code, "ADMIN_AUTH_REQUIRED");

  process.env.CARE_NOVA_READ_ONLY_MODE = "true";
  const readOnlyMirrorResponse = await fetch(`${baseUrl}/api/local-data-mirror`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Care-Nova-Admin-Token": "smoke-test-admin"
    },
    body: JSON.stringify({ reason: "smoke-read-only-check" })
  });
  const readOnlyMirror = await readOnlyMirrorResponse.json();

  assert.equal(readOnlyMirrorResponse.status, 503);
  assert.equal(readOnlyMirror.ok, false);
  assert.equal(readOnlyMirror.code, "READ_ONLY_MODE_ACTIVE");
  process.env.CARE_NOVA_READ_ONLY_MODE = "false";

  process.env.CARE_NOVA_ADMIN_AUTH_REQUIRED = "true";
  process.env.CARE_NOVA_ADMIN_SESSION_SECRET = "smoke-test-session-secret";

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
    body: JSON.stringify({ token: "smoke-test-reviewer", actorId: "smoke-reviewer" })
  });
  const reviewerLogin = await reviewerLoginResponse.json();
  const reviewerSessionCookie = reviewerLoginResponse.headers.get("set-cookie") || "";

  assert.equal(reviewerLoginResponse.status, 200);
  assert.equal(reviewerLogin.ok, true);
  assert.equal(reviewerLogin.session.role, "reviewer");
  assert.match(reviewerSessionCookie, /care_nova_admin_session=/);

  const reviewerPacketResponse = await fetch(`${baseUrl}/api/admin-review-packet?includeEvents=true&eventLimit=2`, {
    headers: {
      "Cookie": reviewerSessionCookie
    }
  });
  const reviewerPacket = await reviewerPacketResponse.json();

  assert.equal(reviewerPacketResponse.status, 200);
  assert.equal(reviewerPacket.status, "admin-review-packet-ready");
  assert.ok(reviewerPacket.packet.audit.events.length <= 2);

  const reviewerHistoryResponse = await fetch(`${baseUrl}/api/admin-review-history?limit=2`, {
    headers: {
      "Cookie": reviewerSessionCookie
    }
  });
  const reviewerHistory = await reviewerHistoryResponse.json();

  assert.equal(reviewerHistoryResponse.status, 200);
  assert.equal(reviewerHistory.status, "review-history-ready");

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

  const reviewerSaveHistoryResponse = await fetch(`${baseUrl}/api/admin-review-history`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": reviewerSessionCookie
    },
    body: JSON.stringify({ title: "Reviewer blocked save", decision: "reviewed" })
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
    body: JSON.stringify({ token: "smoke-test-admin" })
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

  const adminSaveHistoryResponse = await fetch(`${baseUrl}/api/admin-review-history`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": adminSessionCookie
    },
    body: JSON.stringify({
      title: "Smoke enterprise review snapshot",
      decision: "approved",
      notes: "Reviewer/admin workflow verified.",
      includeEvents: true,
      eventLimit: 3
    })
  });
  const adminSaveHistory = await adminSaveHistoryResponse.json();

  assert.equal(adminSaveHistoryResponse.status, 200);
  assert.equal(adminSaveHistory.status, "admin-review-history-saved");
  assert.equal(adminSaveHistory.reviewHistory.entry.role, "admin");

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
  process.env.CARE_NOVA_READ_ONLY_MODE = originalReadOnlyMode;

  const originalPatientAuthRequired = process.env.CARE_NOVA_PATIENT_AUTH_REQUIRED;
  const originalPatientAccessSecret = process.env.CARE_NOVA_PATIENT_ACCESS_SECRET;
  const originalPatientHeader = process.env.CARE_NOVA_PATIENT_HEADER;
  process.env.CARE_NOVA_PATIENT_AUTH_REQUIRED = "true";
  process.env.CARE_NOVA_PATIENT_ACCESS_SECRET = "smoke-test-patient-secret";
  process.env.CARE_NOVA_PATIENT_HEADER = "X-Care-Nova-Patient-Token";

  const patientAccessPatientId = `patient-access-${Date.now()}`;
  const blockedPatientMemoryResponse = await fetch(`${baseUrl}/api/memory?patientId=${patientAccessPatientId}`);
  const blockedPatientMemory = await blockedPatientMemoryResponse.json();

  assert.equal(blockedPatientMemoryResponse.status, 403);
  assert.equal(blockedPatientMemory.code, "PATIENT_ACCESS_REQUIRED");

  const patientAccessToken = buildEnterprisePatientAccessToken({
    patientId: patientAccessPatientId,
    actorId: "smoke-patient"
  });

  assert.equal(patientAccessToken.ok, true);

  const allowedPatientMemoryResponse = await fetch(`${baseUrl}/api/memory?patientId=${patientAccessPatientId}`, {
    headers: {
      "X-Care-Nova-Patient-Token": patientAccessToken.token
    }
  });
  const allowedPatientMemory = await allowedPatientMemoryResponse.json();

  assert.equal(allowedPatientMemoryResponse.status, 200);
  assert.equal(allowedPatientMemory.ok, true);

  const blockedPatientAnalyzeResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: patientAccessPatientId,
      message: "My blood pressure is 142 over 92 and I want a quick review.",
      profile,
      vitals: {
        systolic: "142",
        diastolic: "92"
      }
    })
  });
  const blockedPatientAnalyze = await blockedPatientAnalyzeResponse.json();

  assert.equal(blockedPatientAnalyzeResponse.status, 403);
  assert.equal(blockedPatientAnalyze.code, "PATIENT_ACCESS_REQUIRED");

  const allowedPatientAnalyzeResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Care-Nova-Patient-Token": patientAccessToken.token
    },
    body: JSON.stringify({
      patientId: patientAccessPatientId,
      message: "My blood pressure is 142 over 92 and I want a quick review.",
      profile,
      vitals: {
        systolic: "142",
        diastolic: "92"
      }
    })
  });
  const allowedPatientAnalyze = await allowedPatientAnalyzeResponse.json();

  assert.equal(allowedPatientAnalyzeResponse.status, 200);
  assert.equal(allowedPatientAnalyze.ok, true);

  if (typeof originalPatientAuthRequired === "string") {
    process.env.CARE_NOVA_PATIENT_AUTH_REQUIRED = originalPatientAuthRequired;
  } else {
    delete process.env.CARE_NOVA_PATIENT_AUTH_REQUIRED;
  }

  if (typeof originalPatientAccessSecret === "string") {
    process.env.CARE_NOVA_PATIENT_ACCESS_SECRET = originalPatientAccessSecret;
  } else {
    delete process.env.CARE_NOVA_PATIENT_ACCESS_SECRET;
  }

  if (typeof originalPatientHeader === "string") {
    process.env.CARE_NOVA_PATIENT_HEADER = originalPatientHeader;
  } else {
    delete process.env.CARE_NOVA_PATIENT_HEADER;
  }

  const auditEventsResponse = await fetch(`${baseUrl}/api/audit-events?limit=10`);
  const auditEvents = await auditEventsResponse.json();

  assert.equal(auditEventsResponse.status, 200);
  assert.equal(auditEvents.ok, true);
  assert.equal(auditEvents.summary.enabled, true);
  assert.ok(Array.isArray(auditEvents.events));

  const storageIntegrityResponse = await fetch(`${baseUrl}/api/storage-integrity`);
  const storageIntegrity = await storageIntegrityResponse.json();

  assert.equal(storageIntegrityResponse.status, 200);
  assert.equal(storageIntegrity.ok, true);
  assert.equal(typeof storageIntegrity.summary.criticalReady, "boolean");
  assert.ok(storageIntegrity.checks.some((check) => check.id === "offline_database"));

  const knowledgeGraphResponse = await fetch(`${baseUrl}/api/knowledge-graph?patientId=smoke-test`);
  const knowledgeGraph = await knowledgeGraphResponse.json();

  assert.equal(knowledgeGraphResponse.status, 200);
  assert.equal(knowledgeGraph.ok, true);
  assert.equal(knowledgeGraph.graph.mode, "persistent-local-server");

  const safetyTriageResponse = await fetch(`${baseUrl}/api/safety-triage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message: "I have chest pain and shortness of breath.", profile: { age: "52" } })
  });
  const safetyTriage = await safetyTriageResponse.json();

  assert.equal(safetyTriageResponse.status, 200);
  assert.equal(safetyTriage.ok, true);
  assert.equal(safetyTriage.triage.recommendedRoute, "ALERT_AGENT");
  assert.ok(["HIGH", "CRITICAL"].includes(safetyTriage.triage.level));

  const evidenceResponse = await fetch(`${baseUrl}/api/evidence-citations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message: "metformin side effects", tab: "medicine" })
  });
  const evidence = await evidenceResponse.json();

  assert.equal(evidenceResponse.status, 200);
  assert.equal(evidence.ok, true);
  assert.ok(evidence.evidence.sourceCount >= 1);

  const multimodalResponse = await fetch(`${baseUrl}/api/multimodal-intake`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ reportText: "HbA1c 8.2 LDL 160 creatinine 1.1 lab result" })
  });
  const multimodal = await multimodalResponse.json();

  assert.equal(multimodalResponse.status, 200);
  assert.equal(multimodal.ok, true);
  assert.equal(multimodal.intake.documentType.id, "lab_report");
  assert.ok(multimodal.intake.markers.some((marker) => marker.marker === "HbA1c"));

  const preventionResponse = await fetch(`${baseUrl}/api/prevention-plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: "smoke-test", message: "diabetes and high blood pressure", profile: { age: "52", conditions: "Diabetes, hypertension" } })
  });
  const prevention = await preventionResponse.json();

  assert.equal(preventionResponse.status, 200);
  assert.equal(prevention.ok, true);
  assert.ok(prevention.preventionPlan.focusAreas.length >= 1);

  const humanReviewResponse = await fetch(`${baseUrl}/api/human-review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: "smoke-test", message: "I fainted with chest pain.", result: { risk: { level: "CRITICAL" } } })
  });
  const humanReview = await humanReviewResponse.json();

  assert.equal(humanReviewResponse.status, 200);
  assert.equal(humanReview.ok, true);
  assert.equal(humanReview.review.reviewRequired, true);

  const doctorReportResponse = await fetch(`${baseUrl}/api/doctor-ready-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: "smoke-test", message: "BP is 160/98 and headache", profile: { name: "Test", age: "52" }, vitals: { bpSystolic: "160", bpDiastolic: "98" } })
  });
  const doctorReport = await doctorReportResponse.json();

  assert.equal(doctorReportResponse.status, 200);
  assert.equal(doctorReport.ok, true);
  assert.equal(doctorReport.report.status, "doctor-ready-report-ready");

  const modelResponse = await fetch(`${baseUrl}/api/model`);
  const model = await modelResponse.json();

  assert.equal(modelResponse.status, 200);
  assert.equal(model.ok, true);
  assert.equal(model.model.name, "Care Nova Medical Intelligence Model");
  assert.ok(model.model.integrationTargets.includes("Patient health intake"));
  assert.ok(model.model.integrationTargets.includes("Worldwide PWA installation"));
  assert.ok(model.model.integrationTargets.includes("Cloud or VM deployment"));
  assert.ok(model.model.integrationTargets.includes("Docker container deployment"));
  assert.ok(model.model.integrationTargets.includes("Provider discharge transition workspace"));
  assert.ok(model.model.integrationTargets.includes("Vitals and risk trend workspace"));
  assert.ok(model.model.integrationTargets.includes("Lab report explanation workspace"));
  assert.ok(model.model.integrationTargets.includes("Lifestyle and wellness workspace"));
  assert.ok(model.model.integrationTargets.includes("Records and insurance support workspace"));
  assert.ok(model.model.performancePillars.includes("User-friendly patient intake"));
  assert.ok(model.model.performancePillars.includes("Debounced real-time safety preview while the patient types"));
  assert.ok(model.model.performancePillars.includes("Worldwide-ready installation and deployment packaging"));
  assert.ok(model.model.performancePillars.includes("Offline medical database stored locally for safe demo retrieval"));
  assert.ok(model.model.performancePillars.includes("Offline-first medical knowledge retrieval"));
  assert.ok(model.model.performancePillars.includes("Trillion-scale approved medical corpus ingestion readiness"));
  assert.ok(model.model.performancePillars.includes("Evidence-grounded answers instead of unsafe memorized claims"));
  assert.ok(model.model.performancePillars.includes("Personalized Care Pack with next steps, monitoring, doctor questions, safety signs, and evidence notes"));
  assert.ok(model.model.performancePillars.includes("Four core specialist agents: RAG, Pharmacy, Scheduling, and Alert"));
  assert.ok(model.model.performancePillars.includes("Optional specialty workspaces for vitals, labs, lifestyle, mental wellness, records, insurance, and care coordination"));
  assert.ok(model.model.performancePillars.includes("Clinical accuracy engine with route, evidence, safety, and consistency cross-checks"));
  assert.ok(model.model.architectureLayers.includes("Offline medical database"));
  assert.ok(model.model.architectureLayers.includes("Offline medical knowledge retrieval"));
  assert.ok(model.model.architectureLayers.includes("Optional approved external API cache"));
  assert.ok(model.model.architectureLayers.includes("Clinical knowledge scale layer"));
  assert.ok(model.model.architectureLayers.includes("Clinical accuracy engine"));
  assert.ok(model.model.architectureLayers.includes("Four core specialist agents"));
  assert.ok(model.model.architectureLayers.includes("Personalized Care Pack generator"));
  assert.equal(model.model.knowledgeScale.status, "architecture-ready");
  assert.ok(model.model.knowledgeScale.dataDomains.length >= 8);
  assert.ok(model.model.knowledgeScale.validationGates.length >= 6);
  assert.equal(model.enterpriseUseCases.length, 5);
  assert.equal(model.workflowMatrix.length, 4);
  assert.ok(model.workflowMatrix.some((item) => item.agentRoute === "CLAIMS_OPS_AGENT" && item.workflow === "Claims Intake, Adjudication & Post-Payment Ops"));
  assert.ok(model.workflowMatrix.some((item) => item.agentRoute === "GXP_QUALITY_AGENT" && item.audience === "Pharma & Biopharma"));
  assert.ok(model.workflowMatrix.some((item) => item.agentRoute === "CARE_TRANSITIONS_AGENT" && item.businessArea === "Care Delivery"));
  assert.ok(model.workflowMatrix.some((item) => item.agentRoute === "MEDTECH_COMPLIANCE_AGENT" && item.capabilities.includes("RAG")));
  assert.ok(model.enterpriseUseCases.some((item) => item.agentRoute === "CARE_TRANSITIONS_AGENT"));
  assert.ok(model.enterpriseUseCases.some((item) => item.agentRoute === "CLAIMS_OPS_AGENT"));
  assert.ok(model.enterpriseUseCases.some((item) => item.agentRoute === "UTILIZATION_AGENT"));
  assert.ok(model.enterpriseUseCases.some((item) => item.agentRoute === "GXP_QUALITY_AGENT"));
  assert.ok(model.enterpriseUseCases.some((item) => item.agentRoute === "MEDTECH_COMPLIANCE_AGENT"));
  assert.equal(model.model.flowSteps.length, 8);
  assert.equal(model.model.flowSteps[4].title, "Response Synthesizer");
  assert.equal(model.model.flowSteps[7].title, "Update Memory");
  assert.equal(model.coreAgentBuckets.length, 4);
  assert.ok(model.coreAgentBuckets.some((bucket) => bucket.route === "RAG_AGENT"));
  assert.ok(model.coreAgentBuckets.some((bucket) => bucket.route === "PHARMACY_AGENT"));
  assert.ok(model.coreAgentBuckets.some((bucket) => bucket.route === "SCHEDULING_AGENT"));
  assert.ok(model.coreAgentBuckets.some((bucket) => bucket.route === "ALERT_AGENT"));
  assert.equal(model.canonicalFlow.steps.length, 8);
  assert.equal(model.canonicalFlow.nextTurnLoop, "MEMORY_UPDATE -> PATIENT_INPUT -> MEMORY_STORE");
  assert.ok(model.flow.nodes.some((node) => node.id === "MEMORY_STORE"));
  assert.ok(model.flow.nodes.some((node) => node.id === "AGENTIC_SUPERVISOR"));
  assert.ok(model.flow.nodes.some((node) => node.id === "VITALS_AGENT"));
  assert.ok(model.flow.nodes.some((node) => node.id === "LABS_AGENT"));
  assert.ok(model.flow.nodes.some((node) => node.id === "LIFESTYLE_AGENT"));
  assert.ok(model.flow.nodes.some((node) => node.id === "WELLNESS_AGENT"));
  assert.ok(model.flow.nodes.some((node) => node.id === "RECORDS_AGENT"));
  assert.ok(model.flow.nodes.some((node) => node.id === "INSURANCE_AGENT"));
  assert.ok(model.flow.nodes.some((node) => node.id === "CARE_TRANSITIONS_AGENT"));
  assert.ok(model.flow.nodes.some((node) => node.id === "CLAIMS_OPS_AGENT"));
  assert.ok(model.flow.nodes.some((node) => node.id === "UTILIZATION_AGENT"));
  assert.ok(model.flow.nodes.some((node) => node.id === "GXP_QUALITY_AGENT"));
  assert.ok(model.flow.nodes.some((node) => node.id === "MEDTECH_COMPLIANCE_AGENT"));
  assert.equal(model.knowledgeSystem.mode, "offline-first");
  assert.ok(model.knowledgeSystem.corpusSize >= 30);
  assert.ok(model.knowledgeSystem.offlineDatabase.storedRecords >= 16);
  assert.equal(model.knowledgeScale.target, "Governed trillion-scale medical corpus readiness");
  assert.equal(model.globalDeployment.status, "global-ready");
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/realtime"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/memory"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/browser-state"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/records"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/agentic-runtime"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/external-knowledge"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/external-knowledge/clear"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/trusted-sources"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/model-quality"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/governance"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/admin/session"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/offline-packs"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/fhir"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/report-templates"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/advanced-capabilities"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/evaluation-dashboard"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/admin-policy"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/config-readiness"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/data-retention-policy"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/incident-posture"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/recovery-posture"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/admin-secret-posture"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/admin-review-packet"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/admin-release-snapshot"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/admin-review-history"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/audit-events"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/local-data-mirror"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/runtime-metrics"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/storage-integrity"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/knowledge-graph"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/safety-triage"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/evidence-citations"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/multimodal-intake"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/human-review"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/prevention-plan"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/doctor-ready-report"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/knowledge-graph/clear"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/training-readiness"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/training"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/training/example"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/training/train"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/training/evaluate"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/browser-state-sync"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/ready"));
  assert.ok(model.model.endpoints.some((endpoint) => endpoint.path === "/api/deployment-readiness"));

  const knowledgeResponse = await fetch(`${baseUrl}/api/knowledge`);
  const knowledge = await knowledgeResponse.json();

  assert.equal(knowledgeResponse.status, 200);
  assert.equal(knowledge.ok, true);
  assert.equal(knowledge.database.offlineReady, true);
  assert.equal(knowledge.database.trainingStatus, "not-foundation-model-training");
  assert.equal(knowledge.database.scaleTarget, "trillion-token governed medical corpus readiness");
  assert.ok(knowledge.database.storedRecords >= 16);
  assert.ok(knowledge.database.validationGates.length >= 8);
  assert.ok(knowledge.records.some((record) => record.id === "offline-cardiovascular-risk"));

  const trainingResponse = await fetch(`${baseUrl}/api/training-readiness`);
  const training = await trainingResponse.json();

  assert.equal(trainingResponse.status, 200);
  assert.equal(training.ok, true);
  assert.equal(training.status, "governed-training-ready");
  assert.equal(training.activeTraining, false);
  assert.equal(training.trainingStatus, "not-foundation-model-training");
  assert.ok(training.pipeline.some((step) => step.id === "source_approval"));
  assert.ok(training.pipeline.some((step) => step.id === "clinical_evaluation"));
  assert.ok(training.safetyLocks.includes("No unsupervised self-training from patient conversations"));
  assert.equal(training.machineLearning.summary.classicalMlReady, true);
  assert.equal(training.machineLearning.summary.deepLearningAdapterReady, true);
  assert.equal(training.localTrainingCapabilities.status, "ready");

  const trainingStatusResponse = await fetch(`${baseUrl}/api/training`);
  const trainingStatus = await trainingStatusResponse.json();

  assert.equal(trainingStatusResponse.status, 200);
  assert.equal(trainingStatus.ok, true);
  assert.equal(trainingStatus.training.storage.file, "data/training/agent-training-state.json");
  assert.equal(trainingStatus.machineLearning.status, "ml-dl-training-ready");

  const trainingExampleResponse = await fetch(`${baseUrl}/api/training/example`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      id: "smoke-insurance-route-calibration",
      patientId: "smoke-test",
      tab: "insurance",
      message: "Help me organize an insurance claim denial, EOB, appeal deadline, and missing documents.",
      expectedRoute: "INSURANCE_AGENT",
      actualRoute: "INSURANCE_AGENT",
      approved: true,
      rating: 5,
      outcome: "correct",
      tags: ["insurance", "appeal", "claim"]
    })
  });
  const trainingExample = await trainingExampleResponse.json();

  assert.equal(trainingExampleResponse.status, 200);
  assert.equal(trainingExample.ok, true);
  assert.equal(trainingExample.example.expectedRoute, "INSURANCE_AGENT");
  assert.equal(trainingExample.mirror.status, "mirror-synced");

  const trainingRunResponse = await fetch(`${baseUrl}/api/training/train`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  const trainingRun = await trainingRunResponse.json();

  assert.equal(trainingRunResponse.status, 200);
  assert.equal(trainingRun.ok, true);
  assert.equal(trainingRun.status, "trained");
  assert.equal(trainingRun.calibration.enabled, true);
  assert.ok(trainingRun.model.exampleCount >= 1);

  const trainingEvalResponse = await fetch(`${baseUrl}/api/training/evaluate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: "I need help with my insurance appeal and claim documents."
    })
  });
  const trainingEval = await trainingEvalResponse.json();

  assert.equal(trainingEvalResponse.status, 200);
  assert.equal(trainingEval.ok, true);
  assert.equal(trainingEval.evaluation.recommendedRoute, "INSURANCE_AGENT");
  assert.equal(trainingEval.evaluation.calibration.enabled, true);

  const readinessResponse = await fetch(`${baseUrl}/api/readiness`);
  const readiness = await readinessResponse.json();

  assert.equal(readinessResponse.status, 200);
  assert.equal(readiness.ok, true);
  assert.equal(readiness.label, "Healthcare safety ready");
  assert.equal(readiness.score, 100);
  assert.ok(readiness.checks.every((check) => check.status === "complete"));
  assert.ok(readiness.checks.some((check) => check.id === "realtime_mode"));
  assert.ok(readiness.checks.some((check) => check.id === "governed_training_pipeline"));
  assert.ok(readiness.checks.some((check) => check.id === "multi_interface"));
  assert.ok(readiness.checks.some((check) => check.id === "care_routes"));
  assert.ok(readiness.checks.some((check) => check.id === "specialist_agents"));
  assert.ok(readiness.checks.some((check) => check.id === "medical_knowledge"));
  assert.ok(readiness.checks.some((check) => check.id === "offline_database"));
  assert.ok(readiness.checks.some((check) => check.id === "knowledge_scale_layer"));
  assert.ok(readiness.checks.some((check) => check.id === "provider_discharge_transitions"));
  assert.ok(readiness.checks.some((check) => check.id === "payer_claims_ops"));
  assert.ok(readiness.checks.some((check) => check.id === "utilization_management"));
  assert.ok(readiness.checks.some((check) => check.id === "gxp_quality"));
  assert.ok(readiness.checks.some((check) => check.id === "medtech_compliance"));
  assert.ok(readiness.checks.some((check) => check.id === "accuracy_controls"));
  assert.ok(readiness.checks.some((check) => check.id === "clinical_accuracy_engine"));
  assert.ok(readiness.checks.some((check) => check.id === "care_pack"));
  assert.ok(readiness.checks.some((check) => check.id === "global_install"));
  assert.ok(readiness.checks.some((check) => check.id === "deployment_release_gate"));
  assert.ok(readiness.checks.some((check) => check.id === "public_deployment_policy"));
  assert.ok(readiness.checks.some((check) => check.id === "startup_guard"));
  assert.ok(readiness.checks.some((check) => check.id === "operational_audit_log"));
  assert.ok(readiness.checks.some((check) => check.id === "storage_integrity_monitoring"));
  assert.ok(readiness.checks.some((check) => check.id === "admin_policy_export"));
  assert.ok(readiness.checks.some((check) => check.id === "protected_mutation_controls"));
  assert.ok(readiness.checks.some((check) => check.id === "incident_governance"));
  assert.ok(readiness.checks.some((check) => check.id === "recovery_governance"));
  assert.ok(readiness.checks.some((check) => check.id === "offline_mode"));
  assert.ok(readiness.checks.some((check) => check.id === "local_learning"));
  assert.ok(readiness.checks.some((check) => check.id === "polished_ux"));
  assert.equal(readiness.operations.apiResponsesNotCached, true);
  assert.equal(readiness.enterpriseRuntime.safeLocalCoreReady, true);

  const deploymentResponse = await fetch(`${baseUrl}/api/deployment`);
  const deployment = await deploymentResponse.json();

  assert.equal(deploymentResponse.status, 200);
  assert.equal(deployment.ok, true);
  assert.equal(deployment.globalReady, true);
  assert.equal(deployment.guide.status, "global-ready");
  assert.ok(deployment.guide.installModes.includes("Docker container for portable deployment"));
  assert.ok(deployment.guide.releaseCommands.includes("npm run release:check"));
  assert.ok(deployment.guide.releaseCommands.includes("release-check.cmd"));
  assert.equal(deployment.guide.container.includesOfflineDatabase, true);
  assert.equal(deployment.releaseGate.command, "npm run release:check");
  assert.equal(deployment.releaseGate.windowsCommand, "release-check.cmd");
  assert.ok(deployment.guide.worldwideChecklist.length >= 5);

  const deploymentReadinessResponse = await fetch(`${baseUrl}/api/deployment-readiness`);
  const deploymentReadiness = await deploymentReadinessResponse.json();

  assert.equal(deploymentReadinessResponse.status, 200);
  assert.equal(deploymentReadiness.ok, true);
  assert.equal(deploymentReadiness.status, "deployment-ready");
  assert.equal(deploymentReadiness.score, 100);
  assert.ok(deploymentReadiness.checks.every((check) => check.status === "pass"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "docker_packaging"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "medical_safety"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "operational_controls"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "operational_audit_log"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "storage_integrity_monitoring"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "protected_mutation_controls"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "incident_governance"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "recovery_governance"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "degraded_runtime_reporting"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "startup_self_check"));
  assert.ok(deploymentReadiness.checks.some((check) => check.id === "public_deployment_mode"));
  assert.equal(deploymentReadiness.publicDeployment.enabled, false);
  assert.equal(deploymentReadiness.publicDeployment.publicShareReady, true);
  assert.equal(deploymentReadiness.enterpriseRuntime.safeLocalCoreReady, true);

  const dockerfile = await readFile("Dockerfile", "utf8");
  const localLauncher = await readFile("start-care-nova.cmd", "utf8");
  const globalLauncher = await readFile("start-care-nova-global.cmd", "utf8");
  const offlineDatabaseFile = await readFile("data/offline-medical-db.json", "utf8");
  const projectFileMap = await readFile("PROJECT_FILES.md", "utf8");
  const envExample = await readFile(".env.example", "utf8");

  assert.ok(dockerfile.includes("HOST=0.0.0.0"));
  assert.ok(dockerfile.includes("EXPOSE 4173"));
  assert.ok(dockerfile.includes("COPY data ./data"));
  assert.ok(dockerfile.includes("HEALTHCHECK"));
  assert.ok(localLauncher.includes("open-care-nova.ps1"));
  assert.ok(localLauncher.includes("-Mode local"));
  assert.ok(globalLauncher.includes("open-care-nova.ps1"));
  assert.ok(globalLauncher.includes("-Mode global"));
  assert.ok(offlineDatabaseFile.includes("trillion-token governed medical corpus readiness"));
  assert.ok(offlineDatabaseFile.includes("offline-cardiovascular-risk"));
  assert.ok(projectFileMap.includes("Main Model Files"));
  assert.ok(projectFileMap.includes("User Interface Files"));
  assert.ok(projectFileMap.includes("Local Utility Files"));
  assert.ok(envExample.includes("HOST=0.0.0.0"));
  assert.ok(envExample.includes("ENABLE_HSTS=false"));
  assert.ok(envExample.includes("CARE_NOVA_PUBLIC_DEPLOYMENT=false"));
  assert.ok(envExample.includes("CARE_NOVA_ACCESS_LOG=false"));
  assert.ok(envExample.includes("CARE_NOVA_TRUST_PROXY=false"));
  assert.ok(envExample.includes("CARE_NOVA_AUDIT_LOG_ENABLED=true"));
  assert.ok(envExample.includes("CARE_NOVA_AUDIT_MAX_EVENTS=5000"));
  assert.ok(envExample.includes("CARE_NOVA_REQUIRE_ADMIN_FOR_MUTATIONS=false"));
  assert.ok(envExample.includes("CARE_NOVA_ADMIN_AUTH_REQUIRED=false"));
  assert.ok(envExample.includes("CARE_NOVA_ADMIN_HEADER=X-Care-Nova-Admin-Token"));
  assert.ok(envExample.includes("CARE_NOVA_ADMIN_SESSION_SECRET="));
  assert.ok(envExample.includes("CARE_NOVA_PATIENT_AUTH_REQUIRED=false"));
  assert.ok(envExample.includes("CARE_NOVA_PATIENT_ACCESS_SECRET="));
  assert.ok(envExample.includes("CARE_NOVA_PATIENT_HEADER=X-Care-Nova-Patient-Token"));
  assert.ok(envExample.includes("CARE_NOVA_ADMIN_SESSION_TTL_MINUTES=480"));
  assert.ok(envExample.includes("CARE_NOVA_PATIENT_SESSION_TTL_MINUTES=480"));
  assert.ok(envExample.includes("CARE_NOVA_ADMIN_COOKIE_NAME=care_nova_admin_session"));
  assert.ok(envExample.includes("CARE_NOVA_ADMIN_COOKIE_SECURE=false"));
  assert.ok(envExample.includes("CARE_NOVA_MAINTENANCE_MODE=false"));
  assert.ok(envExample.includes("CARE_NOVA_READ_ONLY_MODE=false"));
  assert.ok(envExample.includes("CARE_NOVA_METRICS_MAX_ERRORS=50"));
  assert.ok(envExample.includes("CARE_NOVA_MAX_JSON_BODY_BYTES=5000000"));

  const staticFiles = [
    { path: "/", expected: "Ask Care Nova" },
    { path: "/", expected: "profile-summary" },
    { path: "/", expected: "Patient Profile Vault" },
    { path: "/", expected: "data-interface=\"profile\"" },
    { path: "/", expected: "Add patient" },
    { path: "/", expected: "Delete patient" },
    { path: "/", expected: "Common health questions" },
    { path: "/", expected: "Measurement & Safety Context" },
    { path: "/", expected: "Current Safety Check" },
    { path: "/", expected: "Ask Care Nova" },
    { path: "/", expected: "Safe Use Boundary" },
    { path: "/", expected: "Local AI" },
    { path: "/", expected: "general-route-card" },
    { path: "/", expected: "Answer precision" },
    { path: "/", expected: "General" },
    { path: "/", expected: "data-interface=\"specialist\"" },
    { path: "/", expected: "Specialist Disease Intelligence" },
    { path: "/", expected: "data-interface=\"vitals\"" },
    { path: "/", expected: "data-interface=\"medications\"" },
    { path: "/", expected: "data-interface=\"labs\"" },
    { path: "/", expected: "data-interface=\"wellness\"" },
    { path: "/", expected: "data-interface=\"appointments\"" },
    { path: "/", expected: "data-interface=\"records\"" },
    { path: "/", expected: "data-interface=\"insurance\"" },
    { path: "/", expected: "insuranceSamplePack" },
    { path: "/", expected: "What Happened Till Now" },
    { path: "/", expected: "Plan" },
    { path: "/", expected: "Care Nova Care Hub" },
    { path: "/", expected: "Personal Care Team" },
    { path: "/", expected: "Care Nova Care Team" },
    { path: "/", expected: "Care helper network" },
    { path: "/", expected: "Access Center" },
    { path: "/", expected: "Online and offline access" },
    { path: "/", expected: "model-intelligence-strip" },
    { path: "/", expected: "Intent Classifier" },
    { path: "/", expected: "RAG Retrieval" },
    { path: "/", expected: "Four Agents" },
    { path: "/", expected: "Core Agentic Flow" },
    { path: "/", expected: "Response Synthesizer" },
    { path: "/", expected: "Agent Tool Map" },
    { path: "/", expected: "Memory Store" },
    { path: "/", expected: "Safety & Guardrails" },
    { path: "/", expected: "Reference library" },
    { path: "/", expected: "Overview" },
    { path: "/", expected: "Routes" },
    { path: "/", expected: "Evidence" },
    { path: "/", expected: "Offline Library" },
    { path: "/", expected: "Trusted Sources" },
    { path: "/", expected: "Offline Packs" },
    { path: "/", expected: "Readiness" },
    { path: "/", expected: "Quality Gates" },
    { path: "/", expected: "Governance" },
    { path: "/", expected: "FHIR Ready" },
    { path: "/", expected: "How Care Nova Helps" },
    { path: "/", expected: "Health Safety Guidelines" },
    { path: "/", expected: "First Safe Actions" },
    { path: "/", expected: "Safety Topic Library" },
    { path: "/", expected: "Before You Call Care" },
    { path: "/", expected: "Do / Avoid" },
    { path: "/", expected: "Caregiver Safety Setup" },
    { path: "/", expected: "Safety Check Console" },
    { path: "/", expected: "Vital Specialist Agent" },
    { path: "/", expected: "BMI & Body Metrics" },
    { path: "/", expected: "Daily Maintenance" },
    { path: "/", expected: "vitals-agent-grid" },
    { path: "/", expected: "Medicine Specialist Agent" },
    { path: "/", expected: "Label & Use Safety" },
    { path: "/", expected: "Ask Pharmacist" },
    { path: "/", expected: "medicine-agent-grid" },
    { path: "/", expected: "Lab Intelligence Agent" },
    { path: "/", expected: "Report Readiness" },
    { path: "/", expected: "Extracted Markers" },
    { path: "/", expected: "Clinician Packet" },
    { path: "/", expected: "Trend View" },
    { path: "/", expected: "Saved Lab Reports" },
    { path: "/", expected: "Wellness Coach Agent" },
    { path: "/", expected: "Readiness Score" },
    { path: "/", expected: "7-Day Adaptive Plan" },
    { path: "/", expected: "Daily Check-in" },
    { path: "/", expected: "Visit Planner Agent" },
    { path: "/", expected: "Planning Options" },
    { path: "/", expected: "Local Visit History" },
    { path: "/", expected: "Lab Report" },
    { path: "/", expected: "Lifestyle Guide" },
    { path: "/", expected: "Mental Wellness" },
    { path: "/", expected: "Patient Records Vault" },
    { path: "/", expected: "Record Browser" },
    { path: "/", expected: "Vault Status" },
    { path: "/", expected: "Insurance Help" },
    { path: "/", expected: "Insurance Claim Navigator" },
    { path: "/", expected: "Care Transition" },
    { path: "/", expected: "modelRouteCount" },
    { path: "/", expected: "modelActiveRoutes" },
    { path: "/", expected: "modelDatabaseList" },
    { path: "/", expected: "general-main-grid" },
    { path: "/", expected: "precision-snapshot" },
    { path: "/", expected: "precisionClarity" },
    { path: "/", expected: "precisionEvidence" },
    { path: "/", expected: "messageCount" },
    { path: "/", expected: "riskDial" },
    { path: "/", expected: "Save summary" },
    { path: "/", expected: "icon-install" },
    { path: "/", expected: "livePreviewTitle" },
    { path: "/", expected: "Smart triage route" },
    { path: "/", expected: "previewScore" },
    { path: "/", expected: "routePreview" },
    { path: "/", expected: "realTimeMode" },
    { path: "/", expected: "Ready when you are" },
    { path: "/", expected: "realTimeSummary" },
    { path: "/", expected: "Training" },
    { path: "/", expected: "modelTrainingList" },
    { path: "/", expected: "Knowledge Update Path" },
    { path: "/", expected: "Report Templates" },
    { path: "/styles.css", expected: ".care-pack" },
    { path: "/styles.css", expected: ".response-graphic" },
    { path: "/styles.css", expected: ".care-details-panel" },
    { path: "/styles.css", expected: ".care-action-board" },
    { path: "/styles.css", expected: ".visit-note-card" },
    { path: "/styles.css", expected: ".agent-tool-grid" },
    { path: "/styles.css", expected: ".action-board-tools" },
    { path: "/styles.css", expected: ".live-preview" },
    { path: "/styles.css", expected: ".realtime-card" },
    { path: "/styles.css", expected: ".switch-control" },
    { path: "/styles.css", expected: ".preview-actions" },
    { path: "/styles.css", expected: "--font-reading" },
    { path: "/styles.css", expected: ".care-pack-icon" },
    { path: "/styles.css", expected: ".precision-card:hover" },
    { path: "/", expected: "data-theme=\"clinical\"" },
    { path: "/", expected: "data-theme=\"calm\"" },
    { path: "/", expected: "Light" },
    { path: "/", expected: "Calm" },
    { path: "/", expected: "data-interface-view=\"atlas\"" },
    { path: "/", expected: "atlasInterface" },
    { path: "/", expected: "atlas-shelf-panel" },
    { path: "/", expected: "Library shelves" },
    { path: "/", expected: "icon-sprite" },
    { path: "/styles.css", expected: ".interface-tabs" },
    { path: "/styles.css", expected: ".command-dock" },
    { path: "/styles.css", expected: ".command-status" },
    { path: "/styles.css", expected: ".command-button" },
    { path: "/styles.css", expected: ".care-map-scan" },
    { path: "/styles.css", expected: ".profile-details" },
    { path: "/styles.css", expected: ".quick-scenarios" },
    { path: "/styles.css", expected: ".workspace-search" },
    { path: "/styles.css", expected: ".workspace-search-result" },
    { path: "/styles.css", expected: ".workspace-result-chip" },
    { path: "/styles.css", expected: ".interface-tab.has-signal" },
    { path: "/styles.css", expected: ".model-intelligence-card" },
    { path: "/styles.css", expected: ".agent-hero" },
    { path: "/styles.css", expected: ".autonomous-agent-card" },
    { path: "/styles.css", expected: ".access-hero" },
    { path: "/styles.css", expected: ".access-card" },
    { path: "/styles.css", expected: ".safety-detail-panel" },
    { path: "/styles.css", expected: ".safety-topic-grid" },
    { path: "/styles.css", expected: ".safety-review-map" },
    { path: "/styles.css", expected: ".safety-do-grid" },
    { path: "/styles.css", expected: "@keyframes commandSignal" },
    { path: "/styles.css", expected: ".model-tabs" },
    { path: "/styles.css", expected: ".training-hero" },
    { path: "/styles.css", expected: ".model-route-card" },
    { path: "/styles.css", expected: ".specialty-grid" },
    { path: "/styles.css", expected: ".specialty-hero-card" },
    { path: "/styles.css", expected: ".atlas-grid" },
    { path: "/styles.css", expected: ".atlas-body-map" },
    { path: "/styles.css", expected: ".atlas-shelf-card" },
    { path: "/styles.css", expected: "minmax(min(100%, 240px), 1fr)" },
    { path: "/styles.css", expected: ".route-vitals" },
    { path: "/styles.css", expected: ".route-labs" },
    { path: "/styles.css", expected: ".route-wellness" },
    { path: "/styles.css", expected: ".model-hero-card" },
    { path: "/styles.css", expected: ".care-graphic" },
    { path: "/styles.css", expected: ".graph-node.is-transition" },
    { path: "/styles.css", expected: ".graph-node.is-supervisor" },
    { path: "/styles.css", expected: "@keyframes graphic-scan" },
    { path: "/styles.css", expected: ".workspace-card" },
    { path: "/styles.css", expected: ".general-main-grid" },
    { path: "/styles.css", expected: ".risk-dial" },
    { path: "/styles.css", expected: ".precision-snapshot" },
    { path: "/styles.css", expected: ".precision-card" },
    { path: "/styles.css", expected: "@keyframes carePulse" },
    { path: "/styles.css", expected: ".empty-state-icon" },
    { path: "/app.js", expected: "iconForAgent" },
    { path: "/app.js", expected: "formatAgentDetail" },
    { path: "/app.js", expected: "accuracyProfile" },
    { path: "/app.js", expected: "accuracyEngine" },
    { path: "/app.js", expected: "knowledgeScale" },
    { path: "/app.js", expected: "loadKnowledge" },
    { path: "/app.js", expected: "loadTrainingReadiness" },
    { path: "/app.js", expected: "scheduleRealtimeAnalysis" },
    { path: "/app.js", expected: "/api/realtime" },
    { path: "/app.js", expected: "modelDatabaseList" },
    { path: "/app.js", expected: "updatePrecisionSnapshot" },
    { path: "/app.js", expected: "compactText" },
    { path: "/app.js", expected: "switchModelTab" },
    { path: "/app.js", expected: "renderModelHub" },
    { path: "/app.js", expected: "buildDashboardDoctorNote" },
    { path: "/app.js", expected: "switchInterface" },
    { path: "/app.js", expected: "syncThemeBackground" },
    { path: "/app.js", expected: "themeSurfaces" },
    { path: "/app.js", expected: "interfaceLabels" },
    { path: "/app.js", expected: "updateCommandDock" },
    { path: "/app.js", expected: "commandDockStatus" },
    { path: "/app.js", expected: "interfaceNames" },
    { path: "/app.js", expected: "specialtyWorkspaces" },
    { path: "/app.js", expected: "Medical Atlas Agent" },
    { path: "/app.js", expected: "atlasReferenceExpansionPacks" },
    { path: "/app.js", expected: "Adult Screening Checklist" },
    { path: "/app.js", expected: "Vaccine & Immunization Planner" },
    { path: "/app.js", expected: "Medical Terms Decoder" },
    { path: "/app.js", expected: "renderSpecialtyWorkspaces" },
    { path: "/app.js", expected: "applySpecialtyTemplate" },
    { path: "/app.js", expected: "updateCareCompass" },
    { path: "/app.js", expected: "updateRiskDial" },
    { path: "/app.js", expected: "initializeInstallApp" },
    { path: "/app.js", expected: "beforeinstallprompt" },
    { path: "/app.js", expected: "createCarePackCard" },
    { path: "/app.js", expected: "createCareActionBoard" },
    { path: "/app.js", expected: "updateActionBoardProgress" },
    { path: "/app.js", expected: "buildCareActionNote" },
    { path: "/app.js", expected: "buildVisitNote" },
    { path: "/app.js", expected: "createResponseGraphic" },
    { path: "/app.js", expected: "createCareDetails" },
    { path: "/app.js", expected: "updateLivePreview" },
    { path: "/app.js", expected: "initializeWorkspaceSearch" },
    { path: "/app.js", expected: "workspaceSearchConfig" },
    { path: "/app.js", expected: "singleAgentMode" },
    { path: "/app.js", expected: "preferredAgent" },
    { path: "/app.js", expected: "agentRoute" },
    { path: "/app.js", expected: "requirementProfile" },
    { path: "/app.js", expected: "requirementFit" },
    { path: "/app.js", expected: "handleWorkspaceSearchSubmit" },
    { path: "/app.js", expected: "renderInterfaceStatus" },
    { path: "/app.js", expected: "createResultMetaChip" },
    { path: "/app.js", expected: "applyPreviewAction" },
    { path: "/app.js", expected: "applyAgentLaunch" },
    { path: "/app.js", expected: "handleAccessAction" },
    { path: "/app.js", expected: "renderAccessStatus" },
    { path: "/app.js", expected: "renderAgentWorkspace" },
    { path: "/app.js", expected: "loadProductIntelligence" },
    { path: "/app.js", expected: "getPatientDataRecordsStorageKey" },
    { path: "/app.js", expected: "downloadPatientReportJson" },
    { path: "/app.js", expected: "downloadPatientRecordsCsv" },
    { path: "/app.js", expected: "updateMessageCount" },
    { path: "/sw.js", expected: "CACHE_NAME" },
    { path: "/sw.js", expected: "OFFLINE_APP_SHELL" },
    { path: "/site.webmanifest", expected: "Care Nova AI" },
    { path: "/site.webmanifest", expected: "display_override" },
    { path: "/site.webmanifest", expected: "app-icon.svg" },
    { path: "/app-icon.svg", expected: "Care Nova AI" },
    { path: "/favicon.svg", expected: "Care Nova AI" },
    { path: "/robots.txt", expected: "Allow: /" }
  ];

  for (const staticFile of staticFiles) {
    const response = await fetch(`${baseUrl}${staticFile.path}`);
    const content = await response.text();

    assert.equal(response.status, 200, staticFile.path);
    assert.ok(content.includes(staticFile.expected), staticFile.path);
  }

  const homeResponse = await fetch(`${baseUrl}/`);
  const homeContent = await homeResponse.text();
  assert.equal(homeContent.includes('data-theme="care"'), false);
  assert.equal(homeContent.includes('data-theme="night"'), false);
  assert.equal(homeContent.includes('data-interface="impact"'), false);
  assert.equal(homeContent.includes("Care Intelligence Proof"), false);
  assert.equal(homeContent.includes("Submission details"), false);
  assert.equal(homeContent.includes("Business Impact Brief"), false);
  assert.equal((homeContent.match(/class="theme-button/g) || []).length, 3);

  const realtimeResponse = await fetch(`${baseUrl}/api/realtime`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: "demo-patient",
      message: "I have chest pain with sweating and shortness of breath.",
      profile,
      vitals: {
        heartRate: "132"
      },
      conversationHistory: []
    })
  });
  const realtime = await realtimeResponse.json();

  assert.equal(realtimeResponse.status, 200);
  assert.equal(realtime.ok, true);
  assert.equal(realtime.risk.level, "CRITICAL");
  assert.equal(realtime.realtime.enabled, true);
  assert.equal(realtime.realtime.memoryWrite, false);
  assert.equal(realtime.realtime.historyWrite, false);
  assert.ok(Number.isFinite(realtime.realtime.latencyMs));

  const precisionOwnerCases = [
    {
      name: "doctor note handoff response owner",
      expectedRoute: "RECORDS_AGENT",
      expectedOwner: "RECORDS_AGENT",
      message: "Prepare a doctor note handoff summary for my BP follow-up.",
      answerMode: "handoff",
      vitals: {
        systolic: "154",
        diastolic: "94"
      }
    },
    {
      name: "claims operations response owner",
      expectedRoute: "CLAIMS_OPS_AGENT",
      expectedOwner: "CLAIMS_OPS_AGENT",
      unexpectedRoute: "GXP_QUALITY_AGENT",
      message: "Review a claims intake packet with adjudication exception and provider inquiry.",
      vitals: {}
    },
    {
      name: "high risk safety response owner",
      expectedRoute: "ALERT_AGENT",
      expectedOwner: "ALERT_AGENT",
      message: "I have chest pain with sweating and shortness of breath.",
      vitals: {
        heartRate: "132"
      }
    }
  ];

  for (const [index, testCase] of precisionOwnerCases.entries()) {
    const patientId = `precision-owner-smoke-${Date.now()}-${index}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        message: testCase.message,
        profile,
        vitals: testCase.vitals,
        answerMode: testCase.answerMode
      })
    });
    const result = await response.json();
    const evidenceGate = result.precisionSupervisor?.gates?.find((gate) => gate.id === "evidence_grounding");

    assert.equal(response.status, 200, testCase.name);
    assert.equal(result.ok, true, testCase.name);
    assert.equal(result.precisionSupervisor?.id, "PRECISION_SUPERVISOR", testCase.name);
    assert.equal(result.requirementProfile?.expectedRoute, testCase.expectedRoute, testCase.name);
    assert.equal(result.plan?.responseOwner?.route, testCase.expectedOwner, testCase.name);
    assert.equal(result.finalResponse?.responseFocus?.primaryRoute, testCase.expectedOwner, testCase.name);
    assert.ok(result.precisionSupervisor?.routeEvidence?.some((item) => item.route === testCase.expectedOwner && item.passed), testCase.name);
    assert.equal(evidenceGate?.passed, true, testCase.name);
    assert.ok(result.trustedSourcePlan?.plannedSources?.length >= 1, testCase.name);
    assert.ok(result.qualityEvaluation?.score >= 65, testCase.name);
    assert.equal(result.governanceSnapshot?.notMedicalDevice, true, testCase.name);
    assert.ok(result.knowledgeGraph?.factCount >= 1, testCase.name);
    assert.equal(result.knowledgeGraph?.mode, "persistent-local-server", testCase.name);
    assert.ok(result.evidenceCitations?.sourceCount >= 1, testCase.name);
    assert.ok(result.safetyTriage?.recommendedRoute, testCase.name);
    assert.ok(result.preventionPlan?.daily?.length >= 1, testCase.name);
    assert.ok(result.humanReview?.checklist?.length >= 3, testCase.name);
    assert.equal(result.doctorReadyReport?.status, "doctor-ready-report-ready", testCase.name);
    assert.equal(result.advancedCapabilities?.status, "advanced-snapshot-ready", testCase.name);
    assert.equal(result.localDataMirror?.status, "mirror-synced", testCase.name);
    assert.ok(Array.isArray(result.localDataMirror?.scheduledFiles) && result.localDataMirror.scheduledFiles.length >= 1, testCase.name);
    assert.ok(!Array.isArray(result.localDataMirror?.files), testCase.name);

    if (testCase.unexpectedRoute) {
      assert.equal(result.plan.execute.includes(testCase.unexpectedRoute), false, testCase.name);
    }

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  const reasoningPrecisionCases = [
    {
      name: "sparse specialist precision review",
      input: {
        patientId: `reasoning-specialist-${Date.now()}`,
        message: "Specialist doctor review - heart and blood pressure: review my heart health",
        interfaceName: "specialist",
        singleAgentMode: true,
        preferredAgent: "SPECIALIST_DOCTOR_AGENT",
        answerMode: "deep",
        context: {
          specialistFocus: "cardiology",
          specialistLens: "full-review",
          duration: "not-sure",
          severity: "4",
          careGoal: "understand",
          redFlags: []
        }
      },
      verify(result) {
        const specialistOutput = result.agentResults.find((agent) => agent.id === "SPECIALIST_DOCTOR_AGENT")?.output || {};
        assert.ok(result.finalResponse?.precision?.score >= 60, "sparse specialist precision review");
        assert.ok(
          !specialistOutput.specialistProfile?.missingContext?.includes("main symptom pattern or reason for specialist review"),
          "sparse specialist review should recognize a review-goal request as valid specialist context"
        );
        assert.ok(
          Array.isArray(specialistOutput.specialistActions)
            && specialistOutput.specialistActions.some((item) => /main concern|main heart goal|review goal|latest readings|bp control/i.test(item)),
          "sparse specialist review should lead with context-gathering actions when disease focus is known but details are sparse"
        );
      }
    },
    {
      name: "labs partial context precision review",
      input: {
        patientId: `reasoning-labs-${Date.now()}`,
        message: "My creatinine is 1.6 and A1c 8.9. What does that mean?",
        interfaceName: "labs",
        singleAgentMode: true,
        preferredAgent: "LABS_AGENT",
        answerMode: "deep",
        context: {
          duration: "not-sure",
          severity: "3",
          careGoal: "understand",
          redFlags: []
        }
      },
      verify(result) {
        const labsOutput = result.agentResults.find((agent) => agent.id === "LABS_AGENT")?.output || {};
        const precisionMissing = Array.isArray(result.finalResponse?.precision?.missing)
          ? result.finalResponse.precision.missing
          : [];
        const labsGapSection = Array.isArray(result.finalResponse?.supportSections)
          ? result.finalResponse.supportSections.find((section) => section.id === "labs-gaps")
          : null;
        assert.ok(result.finalResponse?.precision?.score >= 60, "labs partial context precision review");
        assert.ok(Number(labsOutput.concernProfile?.completeness || 0) >= 60, "labs concern profile should credit parsed values and route readiness");
        assert.ok(
          /reference range|report date/i.test(String(labsOutput.concernProfile?.nextQuestion || "")),
          "labs next question should target the missing report structure instead of using a generic fallback"
        );
        assert.deepEqual(
          precisionMissing,
          Array.from(new Set(precisionMissing)),
          "labs precision missing list should not repeat the same gap in slightly different wording"
        );
        assert.ok(
          precisionMissing.every((item) => !/^the\s+/i.test(String(item || ""))),
          "labs precision missing items should be normalized instead of keeping leading-article duplicates"
        );
        assert.ok(
          Array.isArray(labsGapSection?.items)
            && labsGapSection.items.some((item) => /reference range or lab flag/i.test(item)),
          "labs report gaps should use the clearer merged reference-range label"
        );
      }
    },
    {
      name: "insurance appeal precision review",
      input: {
        patientId: `reasoning-insurance-${Date.now()}`,
        message: "My insurance denied an MRI claim from June 2 because of the wrong code. What should I prepare for an appeal?",
        interfaceName: "insurance",
        singleAgentMode: true,
        preferredAgent: "INSURANCE_AGENT",
        answerMode: "deep",
        context: {
          duration: "not-sure",
          severity: "2",
          careGoal: "follow-up",
          redFlags: []
        }
      },
      verify(result) {
        const insuranceOutput = result.agentResults.find((agent) => agent.id === "INSURANCE_AGENT")?.output || {};
        const warningText = (result.finalResponse?.warningSigns || []).join(" ");
        const missingSection = Array.isArray(result.finalResponse?.supportSections)
          ? result.finalResponse.supportSections.find((section) => section.id === "insurance-missing")
          : null;
        assert.ok(result.finalResponse?.precision?.score >= 60, "insurance appeal precision review");
        assert.ok(Number(insuranceOutput.concernProfile?.completeness || 0) >= 60, "insurance concern profile should credit known denial facts before documents are complete");
        assert.ok(
          /EOB|denial letter|policy wording/i.test(String(insuranceOutput.concernProfile?.nextQuestion || "")),
          "insurance next question should ask for the missing appeal packet documents"
        );
        assert.match(
          warningText,
          /appeal deadline|EOB|denial|claim|policy/i,
          "insurance warning signs should stay administrative and packet-focused"
        );
        assert.doesNotMatch(
          warningText,
          /urgent symptoms|real clinical care first/i,
          "insurance warning signs should not fall back to generic clinical escalation wording"
        );
        assert.ok(
          Array.isArray(missingSection?.items)
            && missingSection.items.some((item) => /Add EOB or denial letter\./i.test(item)),
          "insurance missing-documents section should preserve readable acronyms"
        );
      }
    },
    {
      name: "mixed lab precision review",
      input: {
        patientId: `reasoning-labs-mixed-${Date.now()}`,
        message: "My creatinine is 1.6 and A1c 8.9. What does that mean?",
        interfaceName: "labs",
        singleAgentMode: true,
        preferredAgent: "LABS_AGENT",
        answerMode: "quick",
        context: {
          duration: "2-weeks",
          severity: "4",
          careGoal: "understand-results",
          redFlags: []
        }
      },
      verify(result) {
        const labsOutput = result.agentResults.find((agent) => agent.id === "LABS_AGENT")?.output || {};
        assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "LABS_AGENT", "mixed lab case should stay owned by labs");
        assert.match(result.finalResponse?.summary || "", /HbA1c 8\.9|A1c 8\.9/i, "mixed lab summary should keep the sugar marker visible");
        assert.match(result.finalResponse?.summary || "", /Creatinine 1\.6/i, "mixed lab summary should keep the kidney marker visible");
        assert.match((result.finalResponse?.whatToDoNow || []).join(" "), /kidney|sugar/i, "mixed lab actions should keep cross-system follow-up visible");
        assert.match(String(labsOutput.concernProfile?.family || ""), /mixed|sugar|kidney/i, "mixed lab concern family should reflect the combined lab review");
      }
    },
    {
      name: "specialist medicine evidence review",
      input: {
        patientId: `reasoning-specialist-medicine-${Date.now()}`,
        message: "Specialist doctor review - kidney and urine health: creatinine 1.6, eGFR 48, I took ibuprofen, what should kidney specialist focus on and what tests matter next?",
        interfaceName: "specialist",
        singleAgentMode: true,
        preferredAgent: "SPECIALIST_DOCTOR_AGENT",
        answerMode: "quick",
        context: {
          duration: "1-week",
          severity: "5",
          careGoal: "next-step",
          redFlags: []
        }
      },
      verify(result) {
        const specialistOutput = result.agentResults.find((agent) => agent.id === "SPECIALIST_DOCTOR_AGENT")?.output || {};
        const medicineLane = Array.isArray(specialistOutput.concernProfile?.evidenceLanes)
          ? specialistOutput.concernProfile.evidenceLanes.find((lane) => lane.label === "Medicines")
          : null;
        assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT", "kidney specialist case should stay on specialist review");
        assert.ok(!specialistOutput.concernProfile?.missing?.includes("current medicines, allergies, and recent changes"), "specialist review should not ignore an explicitly mentioned medicine");
        assert.equal(medicineLane?.status, "ready", "specialist medicines lane should be ready when a named medicine is provided");
        assert.match(String(medicineLane?.detail || ""), /ibuprofen/i, "specialist medicines lane should show the detected medicine");
      }
    },
    {
      name: "specialist kidney mixed-evidence precision review",
      input: {
        patientId: `reasoning-specialist-kidney-precision-${Date.now()}`,
        message: "Specialist doctor review - kidney and urine health: creatinine 1.6, eGFR 48, I took ibuprofen, what should kidney specialist focus on and what tests matter next?",
        interfaceName: "specialist",
        singleAgentMode: true,
        preferredAgent: "SPECIALIST_DOCTOR_AGENT",
        answerMode: "deep",
        profile: {
          medications: ["Ibuprofen"]
        },
        context: {
          specialistFocus: "kidney",
          specialistLens: "tests",
          duration: "more-than-3-days",
          severity: "4",
          careGoal: "follow-up",
          redFlags: []
        }
      },
      verify(result) {
        const specialistOutput = result.agentResults.find((agent) => agent.id === "SPECIALIST_DOCTOR_AGENT")?.output || {};
        const precisionMissing = Array.isArray(result.finalResponse?.precision?.missing) ? result.finalResponse.precision.missing : [];
        const supportMissing = Array.isArray(specialistOutput.supportReview?.missing) ? specialistOutput.supportReview.missing : [];
        assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT", "kidney mixed-evidence case should stay on specialist review");
        assert.ok(Number(result.finalResponse?.precision?.score || 0) >= 80, "kidney mixed-evidence case should keep strong precision once kidney focus and lab values are explicit");
        assert.deepEqual(precisionMissing, [], "kidney mixed-evidence case should not keep synthetic missing blockers once the focus is already clear");
        assert.deepEqual(supportMissing, [], "kidney mixed-evidence case should treat lab range/date as follow-up detail instead of a support blocker");
        assert.match((result.finalResponse?.whatToDoNow || []).join(" "), /Creatinine\/eGFR comparison over time|urine protein and potassium/i, "kidney mixed-evidence actions should stay kidney-test focused");
      }
    },
    {
      name: "wellness crisis precision review",
      input: {
        patientId: `reasoning-wellness-${Date.now()}`,
        message: "I feel unsafe and want to hurt myself tonight",
        interfaceName: "wellness",
        singleAgentMode: true,
        preferredAgent: "WELLNESS_AGENT",
        answerMode: "quick",
        context: {
          duration: "same-day",
          severity: "9",
          careGoal: "urgency",
          redFlags: []
        }
      },
      verify(result) {
        const wellnessOutput = result.agentResults.find((agent) => agent.id === "WELLNESS_AGENT")?.output || {};
        const alertOutput = result.agentResults.find((agent) => agent.id === "ALERT_AGENT")?.output || {};
        assert.equal(result.plan?.responseOwner?.route, "ALERT_AGENT", "wellness crisis owner should switch to urgent safety");
        assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "ALERT_AGENT", "wellness crisis visible owner should switch to urgent safety");
        assert.ok(result.finalResponse?.precision?.score >= 75, "wellness crisis precision review");
        assert.equal(wellnessOutput.concernProfile?.family, "Urgent safety", "wellness crisis should map to an urgent safety precision family");
        assert.equal(alertOutput.safetyRoute?.label, "Immediate mental safety path", "wellness crisis should use the mental safety alert path");
        assert.ok(Array.isArray(alertOutput.redFlagGroups) && alertOutput.redFlagGroups.some((group) => group.id === "mental-crisis"), "wellness crisis should mark a mental-crisis red flag group");
        assert.match(result.finalResponse?.summary || "", /immediate real-world support/i, "wellness crisis summary should stay on the mental safety path");
        assert.match((result.finalResponse?.warningSigns || []).join(" "), /self-harm thoughts|stay safe/i, "wellness crisis warning signs should reflect mental safety");
        assert.equal(
          wellnessOutput.concernProfile?.nextQuestion,
          "Enough context for an urgent safety answer.",
          "wellness crisis should avoid generic clarification prompts once unsafe wording is clear"
        );
      }
    }
  ];

  for (const testCase of reasoningPrecisionCases) {
    const result = await analyzeHealthQuery(testCase.input);
    testCase.verify(result);
  }

  const singleAgentCases = [
    {
      name: "medicine tab single-agent response",
      preferredAgent: "PHARMACY_AGENT",
      interfaceName: "medications",
      message: "I missed my blood pressure tablet yesterday and feel dizzy.",
      vitals: {
        systolic: "158",
        diastolic: "98"
      }
    },
    {
      name: "vitals tab single-agent response",
      preferredAgent: "VITALS_AGENT",
      interfaceName: "vitals",
      message: "My BP is 170/105 and I have a headache.",
      vitals: {
        systolic: "170",
        diastolic: "105"
      }
    },
    {
      name: "atlas tab single-agent education response",
      preferredAgent: "RAG_AGENT",
      interfaceName: "atlas",
      message: "Explain hypertension disease symptoms, prevention, medicine side effects, interactions, charts, and medical images without diagnosis or dosage.",
      vitals: {}
    },
    {
      name: "specialist tab single-agent disease response",
      preferredAgent: "SPECIALIST_DOCTOR_AGENT",
      interfaceName: "specialist",
      message: "Specialist doctor review - heart and blood pressure: Explain hypertension prevention, tests, symptoms to watch, and urgent signs.",
      vitals: {
        systolic: "148",
        diastolic: "92"
      }
    },
    {
      name: "safety tab single-agent response",
      preferredAgent: "ALERT_AGENT",
      interfaceName: "safety",
      message: "I have chest pain with sweating and shortness of breath.",
      vitals: {
        heartRate: "132"
      }
    }
  ];

  for (const [index, testCase] of singleAgentCases.entries()) {
    const patientId = `single-agent-smoke-${Date.now()}-${index}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        message: testCase.message,
        profile,
        vitals: testCase.vitals,
        interfaceName: testCase.interfaceName,
        singleAgentMode: true,
        preferredAgent: testCase.preferredAgent
      })
    });
    const result = await response.json();

    assert.equal(response.status, 200, testCase.name);
    assert.equal(result.ok, true, testCase.name);
    assert.equal(result.plan.strategy, "single-agent-tab-response", testCase.name);
    assert.equal(result.plan.parallel, false, testCase.name);
    assert.deepEqual(result.plan.execute, [testCase.preferredAgent], testCase.name);
    assert.equal(result.plan.responseOwner?.route, testCase.preferredAgent, testCase.name);
    assert.equal(result.singleAgent.enabled, true, testCase.name);
    assert.equal(result.singleAgent.route, testCase.preferredAgent, testCase.name);
    assert.equal(result.precisionSupervisor?.id, "PRECISION_SUPERVISOR", testCase.name);
    assert.equal(result.precisionSupervisor?.plan?.responseOwner?.route, testCase.preferredAgent, testCase.name);
    assert.ok(result.precisionSupervisor?.gates?.some((gate) => gate.id === "safety_coverage" && gate.passed), testCase.name);
    assert.ok(result.precisionSupervisor?.routeEvidence?.some((item) => item.route === testCase.preferredAgent), testCase.name);
    assert.equal(result.agentResults.length, 1, testCase.name);
    assert.equal(result.agentResults[0].id, testCase.preferredAgent, testCase.name);
    assert.ok(result.agentResults[0].output.reasoning?.score >= 0, testCase.name);
    assert.ok(result.agentResults[0].output.reasoning?.evidence?.length > 0, testCase.name);
    assert.ok(result.reasoningQuality?.score >= 0, testCase.name);
    assert.ok(result.performance?.score >= 0, testCase.name);
    assert.equal(result.requirementProfile.expectedRoute, testCase.preferredAgent, testCase.name);
    assert.ok(result.requirementProfile.score >= 0, testCase.name);
    assert.ok(result.smartAnalysis.requirementFit.score >= 0, testCase.name);

    if (testCase.preferredAgent === "SPECIALIST_DOCTOR_AGENT") {
      const specialistOutput = result.agentResults[0].output || {};
      const referenceTitles = Array.isArray(specialistOutput.references)
        ? specialistOutput.references.map((item) => item.title || item.source || "")
        : [];

      assert.match(specialistOutput.specialty || "", /heart|blood pressure/i, `${testCase.name} should keep the requested specialist domain`);
      assert.ok(
        referenceTitles.some((title) => /blood pressure|cardio|heart/i.test(title)),
        `${testCase.name} should keep on-domain specialist references`
      );
      assert.ok(
        Array.isArray(specialistOutput.specialistActions) && specialistOutput.specialistActions.length >= 3,
        `${testCase.name} should expose actionable specialist next steps`
      );
    }
    assert.ok(result.smartAnalysis.agentContracts.some((contract) => contract.id === testCase.preferredAgent && contract.responseOwner), testCase.name);
    assert.equal(result.finalResponse.responseFocus.policy, "focused-answer-only", testCase.name);
    assert.equal(result.finalResponse.responseFocus.primaryRoute, testCase.preferredAgent, testCase.name);
    assert.ok(result.finalResponse.requirementFit.score >= 0, testCase.name);
    assert.ok(result.finalResponse.reasoningQuality?.score >= 0, testCase.name);
    assert.equal(result.guardrails.passed, true, testCase.name);
    assert.deepEqual(result.memory.history[0].routes, [testCase.preferredAgent], testCase.name);
    assert.equal(result.memory.history[0].requirement.expectedRoute, testCase.preferredAgent, testCase.name);

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  {
    const patientId = `specialist-structured-${Date.now()}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        profile,
        interfaceName: "specialist",
        singleAgentMode: true,
        preferredAgent: "SPECIALIST_DOCTOR_AGENT",
        vitals: {
          systolic: "150",
          diastolic: "95",
          heartRate: "88"
        },
        context: {
          duration: "more-than-3-days",
          severity: "6",
          careGoal: "understand",
          supportNow: "with-someone",
          redFlags: [],
          specialistLens: "tests",
          riskModifiers: ["diabetes", "high-blood-pressure"]
        },
        message: [
          "Specialist doctor review - heart and blood pressure: Patient question: I have repeated high blood pressure with headache and want a specialist review of what tests to discuss and what warning signs matter.",
          "Structured specialist intake:",
          "Specialty: Heart and blood pressure.",
          "Timeline: more-than-3-days; severity: moderate; goal: tests.",
          "Lens: tests.",
          "History: Hypertension with Type 2 diabetes.",
          "Risks: age over 50, diabetes.",
          "Readings: BP 150/95, pulse 88.",
          "Reports: LDL and kidney labs if available.",
          "Meds/allergies: Amlodipine, Metformin.",
          "Risk modifiers: diabetes, high blood pressure.",
          "Urgent signs: none.",
          "Disease guide focus: Heart and blood pressure.",
          "Specialist library map: severe headache, vision change, chest discomfort, BP log, kidney labs, ECG.",
          "Use only the specialist disease intelligence agent."
        ].join("\n")
      })
    });
    const result = await response.json();
    const specialistOutput = result.agentResults?.[0]?.output || {};
    const safetyGate = specialistOutput.specialistProfile?.safetyGate || specialistOutput.safetyGate || {};

    assert.equal(response.status, 200, "specialist structured intake regression");
    assert.equal(result.ok, true, "specialist structured intake regression");
    assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT", "specialist structured intake regression");
    assert.notEqual(result.risk.level, "CRITICAL", "specialist structured intake regression");
    assert.notEqual(safetyGate.level, "urgent-first", "specialist structured intake regression");
    assert.ok(!(safetyGate.signals || []).some((signal) => /chest pain|breathing trouble|stroke-like sign|fainting|seizure/i.test(String(signal))), "specialist structured intake regression");
    assert.match(
      `${specialistOutput.priorityAnswer || ""} ${(specialistOutput.doctorQuestions || []).join(" ")}`,
      /test|reading|bp|ecg|kidney|follow-up/i,
      "specialist structured intake regression should stay aligned to the selected tests lens"
    );

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  {
    const patientId = `specialist-explicit-focus-${Date.now()}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        profile,
        interfaceName: "specialist",
        singleAgentMode: true,
        preferredAgent: "SPECIALIST_DOCTOR_AGENT",
        vitals: {
          systolic: "154",
          diastolic: "96",
          heartRate: "102",
          bloodSugar: "268"
        },
        context: {
          duration: "more-than-3-days",
          severity: "5",
          careGoal: "follow-up",
          supportNow: "with-someone",
          redFlags: [],
          specialistFocus: "cardiology",
          specialistLens: "tests",
          riskModifiers: ["diabetes", "high-blood-pressure"]
        },
        message: "I want a cardiology review of whether high BP and palpitations change what tests I should discuss. I also have diabetes, glucose 268, HbA1c 9.1, urine albumin positive, and use metformin and insulin."
      })
    });
    const result = await response.json();
    const specialistOutput = result.agentResults?.[0]?.output || {};

    assert.equal(response.status, 200, "specialist explicit focus regression");
    assert.equal(result.ok, true, "specialist explicit focus regression");
    assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT", "specialist explicit focus regression");
    assert.equal(specialistOutput.specialistProfile?.domainId, "cardiology", "specialist explicit focus regression");
    assert.equal(specialistOutput.specialty, "Heart and blood pressure", "specialist explicit focus regression");
    assert.equal(specialistOutput.supportReview?.active, true, "specialist explicit focus regression");
    assert.ok(
      Array.isArray(specialistOutput.supportReview?.activeChecks)
        && specialistOutput.supportReview.activeChecks.some((item) => /vitals|medicine|labs/i.test(String(item))),
      "specialist explicit focus regression"
    );
    assert.ok(
      (specialistOutput.references || []).slice(0, 2).some((reference) => /blood pressure|heart|bp|cardio/i.test(`${reference.title || ""} ${reference.source || ""}`)),
      "specialist explicit focus regression"
    );

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  {
    const patientId = `specialist-current-medicine-isolation-${Date.now()}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        profile: {
          ...profile,
          conditions: ["Hypertension", "Type 2 diabetes"],
          medications: ["Amlodipine", "Metformin", "Insulin"],
          allergies: ""
        },
        interfaceName: "specialist",
        singleAgentMode: true,
        preferredAgent: "SPECIALIST_DOCTOR_AGENT",
        vitals: {
          systolic: "154",
          diastolic: "96",
          heartRate: "102",
          bloodSugar: "268"
        },
        context: {
          duration: "more-than-3-days",
          severity: "5",
          careGoal: "follow-up",
          supportNow: "with-someone",
          redFlags: [],
          specialistFocus: "cardiology",
          specialistLens: "tests",
          riskModifiers: ["diabetes", "high-blood-pressure"]
        },
        patientRecords: {
          selectedRecordId: "older-cardiology-regimen",
          records: [
            {
              id: "older-cardiology-regimen",
              type: "visit-note",
              documentCategory: "Doctor Visit",
              documentName: "Older cardiology follow-up",
              episode: "Previous BP regimen",
              conditions: "hypertension; type 2 diabetes",
              medicines: "losartan 50 mg nightly; rosuvastatin 10 mg nightly",
              labs: "LDL 158 mg/dL; creatinine 1.6 mg/dL",
              followUp: "Older local continuity from a prior regimen."
            }
          ]
        },
        patientKnowledgeGraph: {
          summary: "Older local continuity includes losartan from a prior regimen.",
          facts: [
            { type: "medicine", value: "losartan" },
            { type: "condition", value: "hypertension" }
          ]
        },
        message: "I want a cardiology review of whether high BP and palpitations change what tests I should discuss. I also have diabetes, glucose 268, HbA1c 9.1, urine albumin positive, and use amlodipine, metformin, and insulin."
      })
    });
    const result = await response.json();
    const specialistOutput = result.agentResults?.[0]?.output || {};
    const qualityLanes = Array.isArray(specialistOutput.specialistProfile?.qualityLanes) ? specialistOutput.specialistProfile.qualityLanes : [];
    const evidenceLanes = Array.isArray(specialistOutput.concernProfile?.evidenceLanes) ? specialistOutput.concernProfile.evidenceLanes : [];
    const medicineLane = qualityLanes.find((lane) => String(lane?.label || "").toLowerCase() === "medicines");
    const supportLane = evidenceLanes.find((lane) => String(lane?.label || "").toLowerCase() === "medicine");

    assert.equal(response.status, 200, "specialist current medicine isolation regression");
    assert.equal(result.ok, true, "specialist current medicine isolation regression");
    assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT", "specialist current medicine isolation regression");
    assert.ok(medicineLane, "specialist current medicine isolation regression");
    assert.ok(supportLane, "specialist current medicine isolation regression");
    assert.match(String(medicineLane?.detail || ""), /amlodipine|metformin|insulin/i, "specialist current medicine isolation regression");
    assert.match(String(supportLane?.detail || ""), /amlodipine|metformin|insulin/i, "specialist current medicine isolation regression");
    assert.doesNotMatch(String(medicineLane?.detail || ""), /losartan/i, "specialist current medicine isolation regression");
    assert.doesNotMatch(String(supportLane?.detail || ""), /losartan/i, "specialist current medicine isolation regression");

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  {
    const patientId = `specialist-support-lane-${Date.now()}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        profile: {
          ...profile,
          medications: "",
          allergies: "",
          notes: ""
        },
        interfaceName: "specialist",
        singleAgentMode: true,
        preferredAgent: "SPECIALIST_DOCTOR_AGENT",
        vitals: {
          systolic: "148",
          diastolic: "92",
          heartRate: "84"
        },
        context: {
          duration: "more-than-3-days",
          severity: "5",
          careGoal: "understand",
          supportNow: "with-someone",
          redFlags: [],
          specialistFocus: "cardiology",
          specialistLens: "tests",
          riskModifiers: ["high-blood-pressure"]
        },
        message: [
          "Specialist doctor review - heart and blood pressure: Patient question: I have repeated high blood pressure and headache and want to know what tests to discuss next.",
          "Structured specialist intake:",
          "Specialty: Heart and blood pressure.",
          "Timeline: more-than-3-days; severity: moderate; goal: tests.",
          "Lens: tests.",
          "History: Hypertension.",
          "Risks: age over 50.",
          "Readings: BP 148/92, pulse 84.",
          "Reports: none.",
          "Meds/allergies: none.",
          "Risk modifiers: high blood pressure.",
          "Urgent signs: none.",
          "Disease guide focus: Heart and blood pressure.",
          "Specialist library map: severe headache, vision change, chest discomfort, BP log, kidney labs, ECG.",
          "The specialist disease intelligence agent owns the response.",
          "Use internal vitals, medicine, and lab cross-checks only when the patient entered that context."
        ].join("\n")
      })
    });
    const result = await response.json();
    const specialistOutput = result.agentResults?.[0]?.output || {};
    const activeChecks = Array.isArray(specialistOutput.supportReview?.activeChecks)
      ? specialistOutput.supportReview.activeChecks.map((item) => String(item).toLowerCase())
      : [];

    assert.equal(response.status, 200, "specialist support-lane regression");
    assert.equal(result.ok, true, "specialist support-lane regression");
    assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT", "specialist support-lane regression");
    assert.ok(activeChecks.includes("vitals specialist"), "specialist support-lane regression");
    assert.ok(!activeChecks.includes("medicine safety"), "specialist support-lane regression");
    assert.ok(!activeChecks.includes("labs and reports"), "specialist support-lane regression");

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  {
    const patientId = `specialist-neuro-warning-${Date.now()}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        profile,
        interfaceName: "specialist",
        singleAgentMode: true,
        preferredAgent: "SPECIALIST_DOCTOR_AGENT",
        vitals: {
          systolic: "138",
          diastolic: "86"
        },
        context: {
          duration: "1-3-days",
          severity: "5",
          careGoal: "understand",
          supportNow: "with-someone",
          redFlags: [],
          specialistFocus: "neurology",
          specialistLens: "full-review"
        },
        message: "I want a neurology review of recurring headaches with nausea and light sensitivity for three days. What warning signs and precautions matter most?"
      })
    });
    const result = await response.json();

    assert.equal(response.status, 200, "specialist neuro warning regression");
    assert.equal(result.ok, true, "specialist neuro warning regression");
    assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT", "specialist neuro warning regression");
    assert.ok(
      Array.isArray(result.finalResponse?.warningSigns)
        && result.finalResponse.warningSigns.some((item) => /headache|stroke|vision|seizure|confusion/i.test(item)),
      "specialist neuro warning regression"
    );

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  {
    const patientId = `general-disease-wording-${Date.now()}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        profile,
        interfaceName: "advisor",
        singleAgentMode: true,
        preferredAgent: "RAG_AGENT",
        message: "I have hypertension and a mild headache since morning. What should I watch for today?",
        vitals: {
          systolic: "132",
          diastolic: "84"
        }
      })
    });
    const result = await response.json();

    assert.equal(response.status, 200, "general disease wording stays general");
    assert.equal(result.ok, true, "general disease wording stays general");
    assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "RAG_AGENT", "general disease wording stays general");
    assert.notEqual(result.requirementProfile?.outputType, "specialist_disease_review", "general disease wording stays general");

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  {
    const patientId = `general-guidance-wording-${Date.now()}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        profile,
        interfaceName: "advisor",
        singleAgentMode: true,
        preferredAgent: "RAG_AGENT",
        message: "I have cough and fever since yesterday. Need general advice and precautions.",
        vitals: {
          temperatureC: "38.1"
        }
      })
    });
    const result = await response.json();

    assert.equal(response.status, 200, "general guidance wording stays general");
    assert.equal(result.ok, true, "general guidance wording stays general");
    assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "RAG_AGENT", "general guidance wording stays general");
    assert.notEqual(result.requirementProfile?.outputType, "specialist_disease_review", "general guidance wording stays general");
    assert.ok(
      Array.isArray(result.finalResponse?.warningSigns)
        && result.finalResponse.warningSigns.some((item) => /breathing|blue lips|dehydration|fever/i.test(item)),
      "general guidance wording should keep respiratory warning signs in the general lane"
    );

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  {
    const patientId = `general-atlas-education-${Date.now()}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        profile,
        interfaceName: "advisor",
        singleAgentMode: true,
        preferredAgent: "RAG_AGENT",
        message: "What is hypertension? Explain precautions and prevention.",
        vitals: {
          systolic: "132",
          diastolic: "84"
        }
      })
    });
    const result = await response.json();

    assert.equal(response.status, 200, "general atlas education");
    assert.equal(result.ok, true, "general atlas education");
    assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "RAG_AGENT", "general atlas education");
    assert.equal(result.requirementProfile?.outputType, "medical_atlas", "general atlas education");
    assert.ok(
      Array.isArray(result.finalResponse?.supportSections)
        && result.finalResponse.supportSections.some((section) => /overview/i.test(section.title) && Array.isArray(section.items) && section.items.length)
        && result.finalResponse.supportSections.some((section) => /precautions/i.test(section.title) && Array.isArray(section.items) && section.items.length),
      "general atlas education should expose overview and precautions sections"
    );

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  {
    const patientId = `general-specialist-review-${Date.now()}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        profile,
        interfaceName: "advisor",
        singleAgentMode: true,
        message: "Explain migraine treatment, precautions, and doctor questions.",
        vitals: {}
      })
    });
    const result = await response.json();
    const activeRoutes = Array.isArray(result.agentResults) ? result.agentResults.map((agent) => agent.id) : [];

    assert.equal(response.status, 200, "general specialist review");
    assert.equal(result.ok, true, "general specialist review");
    assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT", "general specialist review");
    assert.ok(!activeRoutes.includes("SCHEDULING_AGENT"), "general specialist review should not keep scheduling support active");
    assert.ok(!activeRoutes.includes("RAG_AGENT"), "general specialist review should not keep general retrieval support active");
    assert.ok(
      Array.isArray(result.finalResponse?.supportSections)
        && result.finalResponse.supportSections.some((section) => /treatment/i.test(section.title) && Array.isArray(section.items) && section.items.length)
        && result.finalResponse.supportSections.some((section) => /doctor questions/i.test(section.title) && Array.isArray(section.items) && section.items.length)
        && result.finalResponse.supportSections.some((section) => /precautions/i.test(section.title) && Array.isArray(section.items) && section.items.length),
      "general specialist review should expose treatment, precautions, and doctor questions"
    );
    assert.ok(Array.isArray(result.localDataMirror?.scheduledFiles) && result.localDataMirror.scheduledFiles.length >= 1, "general specialist review should expose compact mirror metadata");
    assert.ok(!Array.isArray(result.localDataMirror?.files), "general specialist review should not return the full mirror manifest");

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  {
    const patientId = `general-wellness-owner-${Date.now()}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        profile,
        interfaceName: "advisor",
        singleAgentMode: true,
        preferredAgent: "RAG_AGENT",
        message: "I feel stressed and anxious and cannot sleep well.",
        vitals: {}
      })
    });
    const result = await response.json();
    const activeRoutes = Array.isArray(result.agentResults) ? result.agentResults.map((agent) => agent.id) : [];

    assert.equal(response.status, 200, "general wellness owner");
    assert.equal(result.ok, true, "general wellness owner");
    assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "WELLNESS_AGENT", "general wellness owner");
    assert.equal(result.medicalKnowledge?.localAi?.scope, "focused-single-agent", "general wellness owner should keep retrieval focused on the selected owner");
    assert.ok(!activeRoutes.includes("RAG_AGENT"), "general wellness owner should not keep unused general-route support active");
    assert.ok(
      Array.isArray(result.finalResponse?.supportSections)
        && result.finalResponse.supportSections.some((section) => /support plan|safety notes/i.test(section.title) && Array.isArray(section.items) && section.items.length),
      "general wellness owner should expose wellness support sections"
    );

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  {
    const patientId = `general-records-owner-${Date.now()}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        profile,
        interfaceName: "advisor",
        singleAgentMode: true,
        preferredAgent: "RAG_AGENT",
        message: "Create a health record summary with my prescription, doctor note, and report summary.",
        vitals: {}
      })
    });
    const result = await response.json();

    assert.equal(response.status, 200, "general records owner");
    assert.equal(result.ok, true, "general records owner");
    assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "RECORDS_AGENT", "general records owner");
    assert.equal(result.medicalKnowledge?.localAi?.scope, "focused-single-agent", "general records owner should keep retrieval focused on the selected owner");
    assert.ok(
      Array.isArray(result.finalResponse?.supportSections)
        && result.finalResponse.supportSections.some((section) => /next actions|packet gaps|share checklist/i.test(section.title) && Array.isArray(section.items) && section.items.length),
      "general records owner should expose record packet sections"
    );

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  {
    const patientId = `general-insurance-owner-${Date.now()}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        profile,
        interfaceName: "advisor",
        singleAgentMode: true,
        preferredAgent: "RAG_AGENT",
        message: "My MRI claim was denied and I need help with the EOB and appeal documents.",
        vitals: {}
      })
    });
    const result = await response.json();
    const activeRoutes = Array.isArray(result.agentResults) ? result.agentResults.map((agent) => agent.id) : [];

    assert.equal(response.status, 200, "general insurance owner");
    assert.equal(result.ok, true, "general insurance owner");
    assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "INSURANCE_AGENT", "general insurance owner");
    assert.equal(result.medicalKnowledge?.localAi?.scope, "focused-single-agent", "general insurance owner should keep retrieval focused on the selected owner");
    assert.ok(!activeRoutes.includes("RAG_AGENT"), "general insurance owner should not keep unused general-route support active");
    assert.ok(!activeRoutes.includes("CLAIMS_OPS_AGENT") && !activeRoutes.includes("UTILIZATION_AGENT"), "general insurance owner should not keep redundant payer support routes active");

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  {
    const patientId = `general-mixed-support-${Date.now()}`;
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId,
        profile,
        interfaceName: "advisor",
        singleAgentMode: true,
        preferredAgent: "RAG_AGENT",
        message: "I missed my blood pressure medicine yesterday, BP is 158/98, and I want diet and sleep advice too.",
        vitals: {
          systolic: "158",
          diastolic: "98"
        }
      })
    });
    const result = await response.json();
    const activeRoutes = Array.isArray(result.agentResults) ? result.agentResults.map((agent) => agent.id) : [];
    const lifestyleSection = Array.isArray(result.finalResponse?.supportSections)
      ? result.finalResponse.supportSections.find((section) => section.id === "support-lifestyle")
      : null;

    assert.equal(response.status, 200, "general mixed support");
    assert.equal(result.ok, true, "general mixed support");
    assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "PHARMACY_AGENT", "general mixed support");
    assert.ok(activeRoutes.includes("VITALS_AGENT"), "general mixed support should keep vitals active");
    assert.ok(!activeRoutes.includes("LIFESTYLE_AGENT"), "general mixed support should drop unused lifestyle support when the pharmacy owner already fills the focused answer");
    assert.ok(!activeRoutes.includes("RAG_AGENT"), "general mixed support should drop unused general-route support when the pharmacy owner already has focused support routes");
    assert.ok(
      Array.isArray(lifestyleSection?.items)
        && lifestyleSection.items.some((item) => /diet|meal|protein|fiber|sleep|wake time|wind-down/i.test(item)),
      "general mixed support should keep direct diet or sleep guidance in a dedicated lifestyle support section"
    );
    assert.ok(
      Array.isArray(result.finalResponse?.whatToDoNow)
        && result.finalResponse.whatToDoNow.some((item) => /repeat unusual readings|same device|correct technique|resting|trend/i.test(item))
        && result.finalResponse.whatToDoNow.some((item) => /diet|meal|protein|fiber|sleep|wake time|wind-down/i.test(item)),
      "general mixed support should include both a BP recheck or trend step and a diet or sleep step in the main action list"
    );

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId })
    });
  }

  for (const [index, testCase] of cases.entries()) {
    const payload = {
      ...testCase.payload,
      patientId: `smoke-${Date.now()}-${index}`
    };
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    assert.equal(response.status, 200, testCase.name);
    assert.equal(result.ok, true, testCase.name);
    assert.equal(result.risk.level, testCase.expectedRisk, testCase.name);
    assert.ok(result.context, testCase.name);
    assert.ok(Array.isArray(result.intents), testCase.name);
    assert.ok(Array.isArray(result.agentResults), testCase.name);
    assert.ok(result.requirementProfile?.score >= 0, testCase.name);
    assert.ok(result.requirementProfile?.answerContract?.length > 0, testCase.name);
    assert.equal(result.medicalKnowledge?.offlineReady, true, testCase.name);
    assert.ok(result.medicalKnowledge?.offlineDatabase?.storedRecords >= 16, testCase.name);
    assert.equal(result.medicalKnowledge?.offlineDatabase?.trainingStatus, "not-foundation-model-training", testCase.name);
    assert.ok(result.medicalKnowledge?.matches?.length > 0, testCase.name);
    assert.ok(result.medicalKnowledge?.coverageScore >= 35, testCase.name);
    assert.equal(result.medicalKnowledge?.routeMatchesByRoute, undefined, testCase.name);
    assert.equal(result.medicalKnowledge?.localAi?.id, "LOCAL_CLINICAL_ML_RANKER", testCase.name);
    assert.ok(Number(result.medicalKnowledge?.localAi?.score) >= 0, testCase.name);
    assert.equal(result.medicalKnowledge?.queryProfile, undefined, testCase.name);
    assert.equal(result.externalKnowledge?.cacheFile, "data/external/external-knowledge-cache.json", testCase.name);
    assert.equal(result.externalKnowledge?.usedForThisRequest, false, testCase.name);
    assert.equal(result.medicalKnowledge?.externalKnowledge?.recordsUsed, 0, testCase.name);
    assert.ok(result.trainingCalibration?.exampleCount >= 0, testCase.name);
    assert.equal(result.trainingCalibration?.keywordRouteWeights, undefined, testCase.name);
    assert.equal(result.smartAnalysis?.medicalKnowledge, undefined, testCase.name);
    assert.equal(result.smartAnalysis?.intentAnalysis, undefined, testCase.name);
    assert.equal(result.smartAnalysis?.routeAnalysis, undefined, testCase.name);
    assert.equal(result.smartAnalysis?.patientContext, undefined, testCase.name);
    assert.equal(result.agenticRuntime?.id, "ADAPTIVE_AGENTIC_RUNTIME", testCase.name);
    assert.ok(validRuntimeStates.has(result.agenticRuntime?.systemState), testCase.name);
    assert.ok(validRuntimeModes.has(result.agenticRuntime?.activeMode), testCase.name);
    assert.equal(result.agenticRuntime?.decision?.selectedPath, result.agenticRuntime?.activeMode, testCase.name);
    assert.equal(result.agenticRuntime?.offline?.ready, true, testCase.name);
    assert.ok(result.agenticRuntime?.executionTrace?.steps?.length >= 5, testCase.name);
    assert.equal(result.model?.adaptiveRuntime?.id, "ADAPTIVE_AGENTIC_RUNTIME", testCase.name);
    assert.equal(result.processingMode, "Local Model", testCase.name);
    assert.equal(result.modelRouting?.generatedUsing, "Local Model", testCase.name);
    assert.equal(result.modelRouting?.failover?.ready, true, testCase.name);
    assert.equal(result.finalResponse?.processingMode, "Local Model", testCase.name);
    assert.equal(result.llmBrain?.processingMode, "Local Model", testCase.name);
    assert.ok(result.llmBrain?.gates?.some((gate) => gate.id === "hybrid_model_routing"), testCase.name);
    assert.ok(result.modelFlow?.activePath?.includes("MEMORY_STORE"), testCase.name);
    assert.equal(result.modelFlow?.activePath?.includes("AGENTIC_SUPERVISOR"), false, testCase.name);
    assert.ok(result.modelFlow?.activePath?.includes("SAFETY_GUARDRAILS"), testCase.name);
    assert.equal(result.canonicalFlow?.steps?.length, 8, testCase.name);
    assert.ok(["GENERAL_HEALTH", "MEDICATION", "APPOINTMENT", "EMERGENCY"].includes(result.canonicalFlow?.activeBucket?.id), testCase.name);
    assert.equal(result.canonicalFlow?.nextTurnLoop, "MEMORY_UPDATE -> PATIENT_INPUT -> MEMORY_STORE", testCase.name);
    assert.equal(result.agenticReview?.id, "AGENTIC_SUPERVISOR", testCase.name);
    assert.ok(result.agenticReview?.score >= 0, testCase.name);
    assert.ok(result.agenticReview?.reasoningQuality?.score >= 0, testCase.name);
    assert.ok(result.agenticReview?.requirementFit?.score >= 0, testCase.name);
    assert.ok(result.agenticReview?.toolTrace?.length >= result.agentResults.length, testCase.name);
    assert.equal(result.precisionSupervisor?.id, "PRECISION_SUPERVISOR", testCase.name);
    assert.ok(result.precisionSupervisor?.score >= 0, testCase.name);
    assert.ok(result.precisionSupervisor?.gates?.length >= 5, testCase.name);
    assert.ok(result.precisionSupervisor?.routeEvidence?.length >= result.plan.execute.length, testCase.name);
    assert.equal(result.llmBrain?.id, "LLM_COGNITIVE_CORE", testCase.name);
    assert.ok(result.llmBrain?.score >= 0, testCase.name);
    assert.ok(result.llmBrain?.gates?.length >= 6, testCase.name);
    assert.ok(result.llmBrain?.routeDecision?.ownerRoute, testCase.name);
    assert.ok(result.llmBrain?.routeScores?.length >= result.plan.execute.length, testCase.name);
    assert.ok(result.plan?.brain?.score >= 0, testCase.name);
    assert.ok(result.plan?.decisionTrace?.length >= 3, testCase.name);
    assert.ok(result.plan?.responseOwner?.route, testCase.name);
    assert.equal(result.smartAnalysis?.precisionSupervisor?.id, "PRECISION_SUPERVISOR", testCase.name);
    assert.equal(result.smartAnalysis?.llmBrain?.id, "LLM_COGNITIVE_CORE", testCase.name);
    assert.ok(result.smartAnalysis?.agenticReview?.nextBestAction, testCase.name);
    assert.equal(result.auditTrail?.[0]?.detail, undefined, testCase.name);
    assert.ok(result.auditTrail?.[0]?.summary?.length > 0, testCase.name);
    assert.equal(result.guardrails.passed, true, testCase.name);
    assert.ok(result.finalResponse?.whatToDoNow?.length > 0, testCase.name);
    assert.equal(result.finalResponse?.responseFocus?.policy, "focused-answer-only", testCase.name);
    assert.ok(result.finalResponse?.responseFocus?.primaryRoute, testCase.name);
    assert.ok(result.finalResponse?.brain?.score >= 0, testCase.name);
    assert.ok(result.finalResponse?.requirementFit?.score >= 0, testCase.name);
    assert.ok(result.finalResponse?.whatToDoNow?.length <= (result.risk.level === "LOW" ? 2 : 3), testCase.name);
    assert.ok(result.finalResponse?.summary?.length <= 170, testCase.name);
    assert.ok(result.carePack?.sections?.length >= 5, testCase.name);
    assert.ok(result.carePack?.score >= 0, testCase.name);
    assert.ok(result.carePack?.sections?.some((section) => section.id === "today"), testCase.name);
    assert.ok(result.carePack?.sections?.some((section) => section.id === "safety"), testCase.name);
    assert.ok(result.smartAnalysis?.summary?.length > 0, testCase.name);
    assert.ok(result.smartAnalysis?.confidence?.score >= 35, testCase.name);
    assert.ok(result.smartAnalysis?.reasoningQuality?.score >= 0, testCase.name);
    assert.ok(result.reasoningQuality?.agentProfiles?.length >= result.agentResults.length, testCase.name);
    assert.ok(result.performance?.agentCount >= result.agentResults.length, testCase.name);
    assert.equal(result.smartAnalysis?.intentAnalysis, undefined, testCase.name);
    assert.equal(result.smartAnalysis?.vitalAssessment, undefined, testCase.name);
    assert.ok(result.smartAnalysis?.riskBreakdown?.length > 0, testCase.name);
    assert.equal(result.smartAnalysis?.routeAnalysis, undefined, testCase.name);
    assert.equal(result.smartAnalysis?.contextSignals, undefined, testCase.name);
    assert.ok(result.smartAnalysis?.handoffSummary?.length > 0, testCase.name);
    assert.ok(result.smartAnalysis?.dataQuality?.score >= 0, testCase.name);
    assert.ok(result.smartAnalysis?.carePath?.length > 0, testCase.name);
    assert.ok(result.smartAnalysis?.automationPreview?.length > 0, testCase.name);
    assert.ok(result.smartAnalysis?.handoffText?.includes("Care Nova AI Handoff"), testCase.name);
    assert.ok(result.smartAnalysis?.signalMatrix?.length >= 5, testCase.name);
    assert.ok(result.smartAnalysis?.modelReadiness?.score >= 0, testCase.name);
    assert.ok(result.smartAnalysis?.carePack?.summary?.length > 0, testCase.name);
    assert.ok(result.medicalKnowledge?.matches?.length > 0, testCase.name);
    assert.ok(result.knowledgeScale?.score >= 0, testCase.name);
    assert.ok(result.knowledgeScale?.scalePlan?.length >= 4, testCase.name);
    assert.equal(result.knowledgeScale?.trainedFoundationModel, false, testCase.name);
    assert.ok(result.smartAnalysis?.knowledgeScale?.validationGates?.length >= 6, testCase.name);
    assert.ok(result.smartAnalysis?.modelReadiness?.pillars?.some((pillar) => pillar.includes("Knowledge scale")), testCase.name);
    assert.ok(result.smartAnalysis?.modelReadiness?.pillars?.some((pillar) => pillar.includes("LLM brain")), testCase.name);
    assert.ok(result.smartAnalysis?.accuracyProfile?.score >= 0, testCase.name);
    assert.ok(result.smartAnalysis?.accuracyProfile?.checks?.length >= 4, testCase.name);
    assert.ok(result.smartAnalysis?.accuracyEngine?.score >= 0, testCase.name);
    assert.ok(result.smartAnalysis?.accuracyEngine?.checks?.length >= 6, testCase.name);
    assert.ok(result.smartAnalysis?.accuracyEngine?.requirementFit?.score >= 0, testCase.name);
    assert.ok(result.smartAnalysis?.requirementProfile?.score >= 0, testCase.name);
    assert.ok(result.smartAnalysis?.requirementFit?.score >= 0, testCase.name);
    assert.ok(result.smartAnalysis?.agentContracts?.length >= result.agentResults.length, testCase.name);
    assert.ok(result.smartAnalysis?.accuracyEngine?.safetyCalibration?.score >= 0, testCase.name);
    assert.ok(result.smartAnalysis?.accuracyEngine?.consistencyReview?.score >= 0, testCase.name);
    assert.ok(result.smartAnalysis?.accuracyEngine?.clinicalPrecisionReview?.score >= 0, testCase.name);
    assert.ok(result.smartAnalysis?.accuracyEngine?.clinicalPrecisionReview?.checks?.length >= 1, testCase.name);
    assert.ok(result.smartAnalysis?.accuracyControls?.checks?.length >= 6, testCase.name);
    assert.equal(result.smartAnalysis?.deploymentMode?.offlineReady, true, testCase.name);
    assert.ok(result.smartAnalysis?.learningMemory?.boundary?.includes("medical knowledge"), testCase.name);
    assert.ok(result.smartAnalysis?.whatIfGuidance?.length > 0, testCase.name);
    assert.ok(result.memoryPatch?.knowledgeSnapshot?.references?.length > 0, testCase.name);
    assert.equal(result.memory?.saved, true, testCase.name);
    assert.equal(result.memory?.mode, "persistent-local-server", testCase.name);
    assert.ok(result.memory?.history?.length >= 1, testCase.name);
    assert.ok(result.knowledgeGraph?.factCount >= 1, testCase.name);
    assert.equal(result.knowledgeGraph?.mode, "persistent-local-server", testCase.name);
    assert.ok(result.evidenceCitations?.sourceCount >= 1, testCase.name);
    assert.ok(result.safetyTriage?.recommendedRoute, testCase.name);
    assert.ok(result.preventionPlan?.focusAreas?.length >= 1, testCase.name);
    assert.ok(result.humanReview?.checklist?.length >= 3, testCase.name);
    assert.equal(result.doctorReadyReport?.status, "doctor-ready-report-ready", testCase.name);
    assert.equal(result.advancedCapabilities?.status, "advanced-snapshot-ready", testCase.name);
    assert.equal(result.localDataMirror?.status, "mirror-synced", testCase.name);
    assert.ok(Array.isArray(result.localDataMirror?.scheduledFiles) && result.localDataMirror.scheduledFiles.length >= 1, testCase.name);
    assert.ok(!Array.isArray(result.localDataMirror?.files), testCase.name);
    assert.ok(result.inputQuality?.score >= 0, testCase.name);
    assert.ok(result.smartAnalysis?.inputQuality?.label, testCase.name);
    assert.equal(result.enterpriseUseCases?.length, 5, testCase.name);
    assert.equal(result.model?.enterpriseUseCases?.length, 5, testCase.name);
    assert.equal(result.workflowMatrix?.length, 4, testCase.name);
    assert.equal(result.model?.workflowMatrix?.length, 4, testCase.name);
    assert.equal(result.agenticFlowContract?.passed, true, `${testCase.name}: canonical agentic flow contract`);
    assert.equal(result.model?.agenticFlowContract?.passed, true, `${testCase.name}: model agentic flow contract`);
    assert.equal(result.canonicalFlow?.steps?.length, 8, `${testCase.name}: canonical eight steps`);
    assert.equal(result.canonicalFlow?.steps?.[1]?.id, "MEMORY_STORE", `${testCase.name}: memory before classifier`);
    assert.equal(result.canonicalFlow?.steps?.[2]?.id, "INTENT_CLASSIFIER", `${testCase.name}: classifier after memory`);
    assert.ok(
      ["RAG_AGENT", "PHARMACY_AGENT", "SCHEDULING_AGENT", "ALERT_AGENT"].includes(result.agenticFlowContract?.activeBucket?.route),
      `${testCase.name}: one of four required core routes`
    );
    assert.ok(
      result.auditTrail?.findIndex((entry) => entry.step === "memory_store")
        < result.auditTrail?.findIndex((entry) => entry.step === "intent_classifier_agent"),
      `${testCase.name}: memory audit precedes classifier`
    );

    const actualAgents = result.agentResults.map((agent) => agent.id);

    for (const expectedAgent of testCase.expectedAgents) {
      assert.ok(actualAgents.includes(expectedAgent), `${testCase.name}: ${expectedAgent}`);
    }

    for (const agent of result.agentResults) {
      assert.ok(agent.output.reasoning?.score >= 0, `${testCase.name}: ${agent.id} reasoning score`);
      assert.ok(agent.output.reasoning?.safetyChecks?.length >= 2, `${testCase.name}: ${agent.id} safety checks`);
      assert.ok(agent.output.capabilityProfile?.score >= 0, `${testCase.name}: ${agent.id} capability score`);
      assert.ok(agent.output.capabilityProfile?.gates?.length >= 5, `${testCase.name}: ${agent.id} capability gates`);
      assert.ok(agent.output.capabilityProfile?.domain?.length > 0, `${testCase.name}: ${agent.id} capability domain`);
      assert.ok(agent.output.qualityGate?.status, `${testCase.name}: ${agent.id} quality gate`);
      assert.ok(agent.output.accuracyReview?.strengths?.length >= 1, `${testCase.name}: ${agent.id} accuracy strengths`);
      assert.ok(
        agent.output.performance?.deterministic || agent.output.performance?.llmBacked,
        `${testCase.name}: ${agent.id} deterministic performance`
      );
      assert.ok(agent.output.performance?.accuracyScore >= 0, `${testCase.name}: ${agent.id} performance accuracy score`);

      if (["CLAIMS_OPS_AGENT", "GXP_QUALITY_AGENT", "CARE_TRANSITIONS_AGENT", "MEDTECH_COMPLIANCE_AGENT"].includes(agent.id)) {
        assert.equal(agent.output.workflowMatrix?.agentRoute, agent.id, `${testCase.name}: ${agent.id} workflow matrix`);
        assert.ok(agent.output.workflowMatrix?.generatedOutputs?.length >= 3, `${testCase.name}: ${agent.id} matrix outputs`);
        assert.ok(agent.output.workflowMatrix?.capabilities?.includes("Reasoning"), `${testCase.name}: ${agent.id} matrix capabilities`);
      }
    }

    await fetch(`${baseUrl}/api/memory/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId: payload.patientId })
    });
  }

  const generalDeepModeResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: `general-deep-mode-${Date.now()}`,
      message: "I have had a headache since morning and feel tired.",
      profile,
      vitals: {
        systolic: "130",
        diastolic: "85",
        bloodSugar: "180",
        heartRate: "78",
        temperatureC: "37"
      },
      context: {
        duration: "since-morning",
        severity: "4",
        careGoal: "understand-symptoms",
        redFlags: []
      },
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: {
        id: "deep",
        label: "Deep Review"
      }
    })
  });
  const generalDeepMode = await generalDeepModeResponse.json();

  assert.equal(generalDeepModeResponse.status, 200);
  assert.equal(generalDeepMode.ok, true);
  assert.ok(String(generalDeepMode.requestId || "").length > 0);
  assert.equal(Number(generalDeepModeResponse.headers.get("ratelimit-limit")), 360);
  assert.ok(Number(generalDeepModeResponse.headers.get("ratelimit-remaining")) >= 0);
  assert.ok(Number(generalDeepModeResponse.headers.get("ratelimit-reset")) >= 1);
  assert.equal(generalDeepModeResponse.headers.get("ratelimit-policy"), "360;w=60");
  assert.equal(generalDeepMode.finalResponse.responseFocus.primaryRoute, "RAG_AGENT");
  assert.equal(generalDeepMode.finalResponse.responseFocus.requirement.answerMode, "deep");
  assert.match(generalDeepMode.finalResponse.title, /deep review/i);
  assert.ok(generalDeepMode.finalResponse.whatToDoNow.length >= 2);
  assert.ok(
    Array.isArray(generalDeepMode.finalResponse.supportSections)
      && generalDeepMode.finalResponse.supportSections.length >= 3,
    "general deep mode should include structured support sections"
  );
  assert.ok(
    generalDeepMode.finalResponse.supportSections.some((section) => section.id === "track"),
    "general deep mode should include a tracking section"
  );
  assert.ok(
    generalDeepMode.finalResponse.supportSections.some((section) => section.id === "precautions"),
    "general deep mode should include a precautions section"
  );

  const generalPrecisionResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: `general-precision-${Date.now()}`,
      message: "I have had a headache since morning and feel tired.",
      profile,
      vitals: {
        systolic: "130",
        diastolic: "85",
        bloodSugar: "180",
        heartRate: "78",
        temperatureC: "37"
      },
      context: {
        duration: "since-morning",
        severity: "4",
        careGoal: "understand-symptoms",
        redFlags: []
      },
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: {
        id: "quick",
        label: "Quick"
      }
    })
  });
  const generalPrecision = await generalPrecisionResponse.json();
  const generalRagOutput = generalPrecision.agentResults.find((agent) => agent.id === "RAG_AGENT")?.output || {};

  assert.equal(generalPrecisionResponse.status, 200);
  assert.equal(generalPrecision.ok, true);
  assert.match(generalRagOutput.patientAnswerSummary, /headache concern/i);
  assert.doesNotMatch(generalRagOutput.patientAnswerSummary, /dizziness/i);
  assert.doesNotMatch(generalPrecision.finalResponse.summary, /context quality|reviewed with/i);
  assert.ok(
    Array.isArray(generalPrecision.finalResponse.warningSigns)
      && generalPrecision.finalResponse.warningSigns.some((item) => /headache|vision|speech|weakness/i.test(item)),
    "general precision warning signs should be headache-specific"
  );

  const generalMixedPrecisionResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: `general-mixed-precision-${Date.now()}`,
      message: "I have a headache since morning, BP is 150/95, and I feel a little dizzy. What should I do?",
      profile,
      vitals: {
        systolic: "150",
        diastolic: "95",
        heartRate: "78",
        temperatureC: "37"
      },
      context: {
        duration: "since-morning",
        severity: "4",
        careGoal: "understand-symptoms",
        redFlags: []
      },
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: {
        id: "deep",
        label: "Deep Review"
      }
    })
  });
  const generalMixedPrecision = await generalMixedPrecisionResponse.json();
  const generalMixedRagOutput = generalMixedPrecision.agentResults.find((agent) => agent.id === "RAG_AGENT")?.output || {};

  assert.equal(generalMixedPrecisionResponse.status, 200);
  assert.equal(generalMixedPrecision.ok, true);
  assert.equal(generalMixedPrecision.risk.level, "MEDIUM");
  assert.match(generalMixedRagOutput.patientAnswerSummary, /blood-pressure concern with headache and dizziness/i);
  assert.ok(
    Array.isArray(generalMixedPrecision.finalResponse.whatToDoNow)
      && generalMixedPrecision.finalResponse.whatToDoNow.some((item) => /same-day clinician review|repeat bp stays elevated|headache or dizziness does not settle|contact a clinician|usual pattern/i.test(item)),
    "mixed BP and headache guidance should include follow-up escalation"
  );
  assert.ok(
    Array.isArray(generalMixedPrecision.finalResponse.supportSections)
      && generalMixedPrecision.finalResponse.supportSections.some((section) => section.id === "track" && section.items.some((item) => /repeat bp|repeat the bp|headache|dizziness/i.test(item))),
    "mixed BP and headache guidance should include focused tracking"
  );
  assert.ok(
    Array.isArray(generalMixedPrecision.finalResponse.supportSections)
      && generalMixedPrecision.finalResponse.supportSections.some((section) => section.id === "precautions" && section.items.some((item) => /driving|vision|speech|weakness|breathing|chest/i.test(item))),
    "mixed BP and headache guidance should include focused precautions"
  );

  const generalMixedQuickResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: `general-mixed-quick-${Date.now()}`,
      message: "My BP is 154/96, I feel dizzy and have headache. What should I do?",
      profile,
      vitals: {},
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: {
        id: "quick",
        label: "Quick"
      }
    })
  });
  const generalMixedQuick = await generalMixedQuickResponse.json();
  const generalMixedQuickOverview = Array.isArray(generalMixedQuick.finalResponse.supportSections)
    ? generalMixedQuick.finalResponse.supportSections.find((section) => section.id === "overview")
    : null;

  assert.equal(generalMixedQuickResponse.status, 200);
  assert.equal(generalMixedQuick.ok, true);
  assert.equal(generalMixedQuick.risk.level, "MEDIUM");
  assert.deepEqual(
    generalMixedQuick.finalResponse.whatToDoNow,
    [
      "Rest for 5 minutes, repeat the BP, and note the reading with headache or dizziness severity and any vision, weakness, speech, chest, or breathing change.",
      "Use same-day clinician review if the repeat BP stays elevated or the headache or dizziness does not settle after rest."
    ],
    "quick BP guidance should keep the immediate step and the escalation step together"
  );
  assert.ok(
    Array.isArray(generalMixedQuickOverview?.items)
      && generalMixedQuickOverview.items.some((item) => /Blood Pressure Review|Repeat Blood Pressure/i.test(item)),
    "quick BP guidance should surface blood-pressure-specific local evidence first"
  );

  const generalDiabetesPrecisionResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: `general-diabetes-precision-${Date.now()}`,
      message: "I feel very tired and thirsty, I have diabetes, and my sugar is 245. What should I do next?",
      profile: {
        ...profile,
        conditions: "",
        medications: ""
      },
      vitals: {
        bloodSugar: "245"
      },
      context: {
        duration: "today",
        severity: "5",
        careGoal: "understand-symptoms",
        redFlags: []
      },
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: {
        id: "deep",
        label: "Deep Review"
      }
    })
  });
  const generalDiabetesPrecision = await generalDiabetesPrecisionResponse.json();
  const generalDiabetesRagOutput = generalDiabetesPrecision.agentResults.find((agent) => agent.id === "RAG_AGENT")?.output || {};

  assert.equal(generalDiabetesPrecisionResponse.status, 200);
  assert.equal(generalDiabetesPrecision.ok, true);
  assert.equal(generalDiabetesPrecision.risk.level, "MEDIUM");
  assert.doesNotMatch(generalDiabetesRagOutput.patientAnswerSummary, /known conditions and regular medicines/i);
  assert.match(generalDiabetesRagOutput.patientAnswerSummary, /regular medicines/i);
  assert.ok(
    Array.isArray(generalDiabetesPrecision.finalResponse.whatToDoNow)
      && generalDiabetesPrecision.finalResponse.whatToDoNow.some((item) => /recheck glucose|same-day clinician review|sugar stays high/i.test(item)),
    "diabetes guidance should include glucose-specific follow-up"
  );
  assert.ok(
    Array.isArray(generalDiabetesPrecision.finalResponse.whatToDoNow)
      && generalDiabetesPrecision.finalResponse.whatToDoNow.every((item) => !/Improve accuracy/i.test(item)),
    "diabetes action list should keep clarification prompts out of the main steps"
  );

  const generalRespiratoryPrecisionResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: `general-respiratory-precision-${Date.now()}`,
      message: "I have cough and fever for 2 days. What should I track?",
      profile,
      vitals: {
        temperatureC: "38.3"
      },
      context: {
        duration: "1-3 days",
        severity: "4",
        careGoal: "understand-symptoms",
        redFlags: []
      },
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: {
        id: "deep",
        label: "Deep Review"
      }
    })
  });
  const generalRespiratoryPrecision = await generalRespiratoryPrecisionResponse.json();
  const respiratoryOverview = Array.isArray(generalRespiratoryPrecision.finalResponse.supportSections)
    ? generalRespiratoryPrecision.finalResponse.supportSections.find((section) => section.id === "overview")
    : null;

  assert.equal(generalRespiratoryPrecisionResponse.status, 200);
  assert.equal(generalRespiratoryPrecision.ok, true);
  assert.ok(
    Array.isArray(respiratoryOverview?.items)
      && respiratoryOverview.items.some((item) => /Respiratory Illness Review|Home Respiratory Review/i.test(item)),
    "respiratory general guidance should prefer respiratory-specific local evidence"
  );
  assert.ok(
    Array.isArray(respiratoryOverview?.items)
      && respiratoryOverview.items.every((item) => !/Oxygen Saturation Review/i.test(item)),
    "respiratory general guidance without oxygen context should avoid oxygen-first overview text"
  );
  assert.deepEqual(
    generalRespiratoryPrecision.finalResponse.whatToDoNow,
    [
      "Track temperature, cough pattern, breathing effort, and hydration over the next day.",
      "Reduce smoke, dust, and heavy exertion while cough or fever is active.",
      "Contact a clinician if breathing gets harder, fever is rising, or you are not improving after the next 2 to 3 days."
    ],
    "respiratory action list should stay practical-first and logically ordered"
  );

  const generalDigestiveWarningResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: `general-digestive-warning-${Date.now()}`,
      message: "Since morning I have stomach pain with vomiting. Give me general guidance and warning signs.",
      profile,
      vitals: {},
      context: {
        duration: "today",
        severity: "5",
        careGoal: "understand-symptoms",
        redFlags: []
      },
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: {
        id: "quick",
        label: "Quick"
      }
    })
  });
  const generalDigestiveWarning = await generalDigestiveWarningResponse.json();

  assert.equal(generalDigestiveWarningResponse.status, 200);
  assert.equal(generalDigestiveWarning.ok, true);
  assert.ok(
    Array.isArray(generalDigestiveWarning.finalResponse.whatToDoNow)
      && generalDigestiveWarning.finalResponse.whatToDoNow.some((item) => /same-day clinician review|cannot keep fluids down|dehydration/i.test(item)),
    "digestive quick guidance should include a dehydration-focused follow-up step"
  );
  assert.ok(
    Array.isArray(generalDigestiveWarning.finalResponse.warningSigns)
      && generalDigestiveWarning.finalResponse.warningSigns.some((item) => /vomiting|dehydration|blood|pain|confusion/i.test(item)),
    "digestive quick guidance should expose digestive-specific warning signs"
  );

  const promptOnlyPatientId = `general-prompt-only-${Date.now()}`;
  const promptOnlySeedResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: promptOnlyPatientId,
      message: "I have chest pain on exertion with sweating. What should I do?",
      profile,
      vitals: {},
      context: {
        duration: "today",
        severity: "6",
        careGoal: "understand-symptoms",
        redFlags: []
      },
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: {
        id: "quick",
        label: "Quick"
      }
    })
  });
  const promptOnlySeed = await promptOnlySeedResponse.json();

  assert.equal(promptOnlySeedResponse.status, 200);
  assert.equal(promptOnlySeed.ok, true);

  const promptOnlyIsolationResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: promptOnlyPatientId,
      analysisIsolation: "prompt-only",
      message: "I have fever and sore throat since yesterday. What should I do safely at home and when should I see a doctor?",
      profile: {},
      vitals: {},
      context: {
        duration: "1-3 days",
        severity: "4",
        careGoal: "understand-symptoms",
        redFlags: []
      },
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: {
        id: "quick",
        label: "Quick"
      }
    })
  });
  const promptOnlyIsolation = await promptOnlyIsolationResponse.json();

  assert.equal(promptOnlyIsolationResponse.status, 200);
  assert.equal(promptOnlyIsolation.ok, true);
  assert.equal(promptOnlyIsolation.finalResponse.responseFocus.primaryRoute, "RAG_AGENT");
  assert.equal(promptOnlyIsolation.memory?.saved, false);
  assert.doesNotMatch(promptOnlyIsolation.finalResponse.title, /specialist doctor/i);
  assert.match(promptOnlyIsolation.finalResponse.summary, /fever|sore throat|cough|breathing/i);
  assert.doesNotMatch(promptOnlyIsolation.finalResponse.summary, /chest pain|exertional|heart and blood pressure/i);

  const generalWorryRouteResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: `general-worry-route-${Date.now()}`,
      message: "I have mild headache since morning. What should I monitor and when should I worry?",
      profile,
      vitals: {},
      context: {
        duration: "since-morning",
        severity: "3",
        careGoal: "understand-symptoms",
        redFlags: []
      },
      interfaceName: "advisor",
      singleAgentMode: true,
      answerMode: {
        id: "quick",
        label: "Quick"
      }
    })
  });
  const generalWorryRoute = await generalWorryRouteResponse.json();

  assert.equal(generalWorryRouteResponse.status, 200);
  assert.equal(generalWorryRoute.ok, true);
  assert.equal(generalWorryRoute.finalResponse.responseFocus.primaryRoute, "RAG_AGENT");
  assert.doesNotMatch(generalWorryRoute.finalResponse.title, /mental wellness/i);
  assert.ok(
    Array.isArray(generalWorryRoute.finalResponse.whatToDoNow)
      && generalWorryRoute.finalResponse.whatToDoNow.some((item) => /headache|monitor|track|doctor|clinician|worsen/i.test(item)),
    "physical-symptom monitoring prompts should stay with the general route"
  );

  const generalAgenticResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: `general-agentic-${Date.now()}`,
      message: "I have had a headache since morning, my BP is 160/98, and I feel tired. What should I do?",
      profile,
      vitals: {
        systolic: "160",
        diastolic: "98",
        bloodSugar: "180",
        heartRate: "78",
        temperatureC: "37"
      },
      context: {
        duration: "since-morning",
        severity: "4",
        careGoal: "understand-symptoms",
        redFlags: []
      },
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "VITALS_AGENT",
      answerMode: {
        id: "deep",
        label: "Deep Review"
      }
    })
  });
  const generalAgentic = await generalAgenticResponse.json();

  assert.equal(generalAgenticResponse.status, 200);
  assert.equal(generalAgentic.ok, true);
  assert.equal(generalAgentic.finalResponse.responseFocus.primaryRoute, "VITALS_AGENT");
  assert.ok(generalAgentic.plan.execute.includes("VITALS_AGENT"), "general agentic review should keep the vital owner route");
  assert.ok(generalAgentic.plan.execute.includes("RAG_AGENT"), "general agentic review should keep general support active");
  assert.ok(generalAgentic.plan.execute.includes("ALERT_AGENT"), "general agentic review should keep safety support active");
  assert.ok(
    Array.isArray(generalAgentic.finalResponse.whatToDoNow)
      && generalAgentic.finalResponse.whatToDoNow.some((item) => /repeat the abnormal reading|repeat the bp|repeat/i.test(item))
      && generalAgentic.finalResponse.whatToDoNow.some((item) => /clinician|urgent|same-day|worsen/i.test(item)),
    "general agentic review should include action plus escalation support"
  );
  assert.ok(
    Array.isArray(generalAgentic.finalResponse.warningSigns)
      && generalAgentic.finalResponse.warningSigns.some((item) => /headache|vision|speech|weakness|abnormal/i.test(item)),
    "general agentic review should include symptom-aware warning signs"
  );

  const generalGuidedDirect = await analyzeHealthQuery({
    patientId: `general-guided-${Date.now()}`,
    message: "I have had a headache since morning, my BP is 160/98, and I feel tired. What should I do?",
    profile: {
      name: "Naveed",
      age: 52,
      conditions: ["Hypertension", "Type 2 diabetes"],
      medications: ["Amlodipine", "Metformin"],
      allergies: []
    },
    vitals: {
      systolic: "160",
      diastolic: "98",
      bloodSugar: "180",
      heartRate: "78",
      temperatureC: "37"
    },
    context: {
      duration: "since-morning",
      severity: "4",
      careGoal: "understand-symptoms",
      redFlags: []
    },
    answerMode: {
      id: "guided",
      label: "Guided"
    }
  });
  const generalTimeLane = Array.isArray(generalGuidedDirect.finalResponse?.precision?.evidenceLanes)
    ? generalGuidedDirect.finalResponse.precision.evidenceLanes.find((lane) => lane.id === "time_severity")
    : null;

  assert.match(
    generalGuidedDirect.finalResponse?.title || "",
    /blood-pressure concern with headache/i,
    "general guided review should use a concern-specific title"
  );
  assert.equal(
    generalTimeLane?.detail,
    "1-6 hours; severity 4/10",
    "general guided review should normalize realistic duration aliases"
  );
  assert.ok(
    Array.isArray(generalGuidedDirect.finalResponse?.whatToDoNow)
      && generalGuidedDirect.finalResponse.whatToDoNow.some((item) => /repeat the bp|repeat the reading|repeat the abnormal reading/i.test(item))
      && generalGuidedDirect.finalResponse.whatToDoNow.some((item) => /same-day|clinician|headache|dizziness/i.test(item)),
    "general guided review should turn context into concrete next steps"
  );

  const generalPreventionDirect = await analyzeHealthQuery({
    patientId: `general-prevention-${Date.now()}`,
    message: "How can I prevent my blood pressure from getting worse?",
    profile: {
      name: "Naveed",
      age: 52,
      conditions: ["Hypertension"],
      medications: ["Amlodipine"],
      allergies: []
    },
    vitals: {},
    context: {
      duration: "more-than-3-days",
      severity: "2",
      careGoal: "prevention",
      redFlags: []
    },
    answerMode: {
      id: "guided",
      label: "Guided"
    }
  });

  assert.equal(
    generalPreventionDirect.finalResponse?.responseFocus?.primaryRoute,
    "RAG_AGENT",
    "prevention-style blood-pressure guidance should stay with the general route"
  );
  assert.equal(
    generalPreventionDirect.intents?.[0]?.route,
    "RAG_AGENT",
    "general prevention guidance should outrank pure vitals routing when no current reading is being reviewed"
  );
  assert.match(
    generalPreventionDirect.finalResponse?.title || "",
    /blood-pressure prevention question/i,
    "general prevention guidance should use a prevention-specific title"
  );
  assert.ok(
    Array.isArray(generalPreventionDirect.finalResponse?.whatToDoNow)
      && generalPreventionDirect.finalResponse.whatToDoNow.some((item) => /habit|salt|walking|sleep|bp log|blood-pressure/i.test(item)),
    "general prevention guidance should produce habit-based next steps instead of acute reading review"
  );

  const memoryPatientId = `memory-smoke-${Date.now()}`;
  const clearBeforeMemoryResponse = await fetch(`${baseUrl}/api/memory/clear`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: memoryPatientId })
  });
  const clearBeforeMemory = await clearBeforeMemoryResponse.json();

  assert.equal(clearBeforeMemoryResponse.status, 200);
  assert.equal(clearBeforeMemory.ok, true);
  assert.equal(clearBeforeMemory.memory.recentTurnCount, 0);

  const firstMemoryResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: memoryPatientId,
      message: "Remember that I had high BP today and felt dizzy.",
      profile,
      vitals: {
        systolic: "168",
        diastolic: "104"
      }
    })
  });
  const firstMemory = await firstMemoryResponse.json();

  assert.equal(firstMemoryResponse.status, 200);
  assert.equal(firstMemory.ok, true);
  assert.equal(firstMemory.memory.saved, true);
  assert.equal(firstMemory.memory.recentTurnCount, 1);

  const secondMemoryResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: memoryPatientId,
      message: "Does my previous BP check matter for this headache?",
      profile,
      vitals: {}
    })
  });
  const secondMemory = await secondMemoryResponse.json();

  assert.equal(secondMemoryResponse.status, 200);
  assert.equal(secondMemory.ok, true);
  assert.equal(secondMemory.memoryContext.recentTurnCount, 1);
  assert.equal(secondMemory.memoryContext.focusedTurnCount, 1);
  assert.ok(secondMemory.memoryContext.recentMessages.some((message) => message.includes("high BP")));
  assert.ok(secondMemory.memoryContext.focusedMessages.some((message) => message.includes("high BP")));
  assert.equal(secondMemory.memoryContext.previousVitals.systolic, 168);
  assert.equal(secondMemory.memoryContext.previousVitals.diastolic, 104);
  assert.equal(secondMemory.memory.recentTurnCount, 2);
  assert.ok(secondMemory.memory.history[0].knowledgeSnapshot && typeof secondMemory.memory.history[0].knowledgeSnapshot === "object");
  assert.ok(Array.isArray(secondMemory.memory.history[0].agents));
  assert.equal(typeof secondMemory.memory.history[0].summary, "string");
  assert.ok(Array.isArray(secondMemory.memory.history[0].actionItems));
  assert.ok(Array.isArray(secondMemory.memory.history[0].warningSigns));
  assert.equal(typeof secondMemory.memory.history[0].triageLevel, "string");

  const getMemoryResponse = await fetch(`${baseUrl}/api/memory?patientId=${memoryPatientId}`);
  const getMemory = await getMemoryResponse.json();

  assert.equal(getMemoryResponse.status, 200);
  assert.equal(getMemory.ok, true);
  assert.equal(getMemory.memory.mode, "persistent-local-server");
  assert.equal(getMemory.memory.recentTurnCount, 2);
  assert.ok(getMemory.memory.history[0].message.includes("previous BP"));
  assert.ok(getMemory.memory.history[0].knowledgeSnapshot && typeof getMemory.memory.history[0].knowledgeSnapshot === "object");
  assert.ok(Array.isArray(getMemory.memory.history[0].agents));
  assert.equal(typeof getMemory.memory.history[0].summary, "string");
  assert.ok(Array.isArray(getMemory.memory.history[0].evidenceTitles));

  const mixedMemoryFocusResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: `${memoryPatientId}-mixed`,
      message: "My BP is 170 over 104 with headache again. Compare this with earlier readings and tell me what changed.",
      profile,
      vitals: {
        systolic: "170",
        diastolic: "104",
        pulse: "106"
      },
      conversationHistory: [
        {
          at: "2026-07-09T08:00:00.000Z",
          message: "Need help with cardiology follow-up after repeated high BP and headache.",
          risk: "HIGH",
          routes: ["VITALS_AGENT"],
          vitals: { systolic: 168, diastolic: 102, pulse: 98 },
          profile,
          summary: "Repeated elevated blood pressure review."
        },
        {
          at: "2026-07-09T08:30:00.000Z",
          message: "My MRI insurance appeal needs EOB and missing billing documents.",
          risk: "LOW",
          routes: ["INSURANCE_AGENT"],
          profile,
          summary: "Insurance appeal planning."
        },
        {
          at: "2026-07-09T09:00:00.000Z",
          message: "What sleep routine is better for stress and late-night waking?",
          risk: "LOW",
          routes: ["WELLNESS_AGENT"],
          profile,
          summary: "Wellness and sleep coaching."
        },
        {
          at: "2026-07-09T09:30:00.000Z",
          message: "My blood pressure is still 162 over 100 this morning with dizziness.",
          risk: "HIGH",
          routes: ["VITALS_AGENT"],
          vitals: { systolic: 162, diastolic: 100, pulse: 104 },
          profile,
          summary: "Persistent elevated BP trend."
        },
        {
          at: "2026-07-09T10:00:00.000Z",
          message: "Can you summarize kidney lab trends and recent creatinine checks?",
          risk: "MEDIUM",
          routes: ["LABS_AGENT"],
          profile,
          summary: "Kidney lab trend review."
        }
      ]
    })
  });
  const mixedMemoryFocus = await mixedMemoryFocusResponse.json();

  assert.equal(mixedMemoryFocusResponse.status, 200);
  assert.equal(mixedMemoryFocus.ok, true);
  assert.equal(mixedMemoryFocus.memoryContext.recentTurnCount, 5);
  assert.equal(mixedMemoryFocus.memoryContext.focusedTurnCount, 2);
  assert.equal(mixedMemoryFocus.memoryContext.previousVitals.systolic, 162);
  assert.equal(mixedMemoryFocus.memoryContext.previousVitals.diastolic, 100);
  assert.ok(mixedMemoryFocus.memoryContext.focusedMessages.every((message) => !message.includes("insurance appeal")));
  assert.ok(mixedMemoryFocus.memoryContext.focusedMessages.some((message) => message.includes("blood pressure is still 162 over 100")));
  assert.ok(mixedMemoryFocus.memoryContext.focusedMessages.some((message) => message.includes("repeated high BP")));

  const clearAfterMemoryResponse = await fetch(`${baseUrl}/api/memory/clear`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: memoryPatientId })
  });
  const clearAfterMemory = await clearAfterMemoryResponse.json();

  assert.equal(clearAfterMemoryResponse.status, 200);
  assert.equal(clearAfterMemory.ok, true);
  assert.equal(clearAfterMemory.memory.recentTurnCount, 0);

  const focusedMemoryPatientId = `memory-focus-smoke-${Date.now()}`;
  await fetch(`${baseUrl}/api/memory/clear`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: focusedMemoryPatientId })
  });

  const focusedMemorySeedTurns = [
    {
      message: "Remember that I take amlodipine and feel dizzy when I stand up.",
      profile: {
        conditions: ["Hypertension"],
        medications: ["Amlodipine"]
      },
      vitals: {
        systolic: "128",
        diastolic: "78"
      }
    },
    {
      message: "My skin feels dry this week.",
      profile,
      vitals: {}
    },
    {
      message: "I slept 5 hours last night.",
      profile,
      vitals: {}
    },
    {
      message: "My appetite was normal today.",
      profile,
      vitals: {}
    },
    {
      message: "I walked 4000 steps today.",
      profile,
      vitals: {}
    }
  ];

  for (const turn of focusedMemorySeedTurns) {
    const seedResponse = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId: focusedMemoryPatientId,
        ...turn
      })
    });
    const seedResult = await seedResponse.json();

    assert.equal(seedResponse.status, 200);
    assert.equal(seedResult.ok, true);
  }

  const focusedMemoryRecallResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: focusedMemoryPatientId,
      message: "Does that standing dizziness still matter today?",
      profile: {
        age: "52"
      },
      vitals: {},
      context: {
        duration: "same-day",
        severity: "3",
        careGoal: "understand",
        redFlags: []
      }
    })
  });
  const focusedMemoryRecall = await focusedMemoryRecallResponse.json();

  assert.equal(focusedMemoryRecallResponse.status, 200);
  assert.equal(focusedMemoryRecall.ok, true);
  assert.ok((focusedMemoryRecall.memoryContext?.focusedTurnCount || 0) >= 1);
  assert.ok(
    Array.isArray(focusedMemoryRecall.memoryContext?.recentMessages)
      && focusedMemoryRecall.memoryContext.recentMessages.some((item) => /amlodipine|dizzy when i stand up|standing dizziness/i.test(item)),
    "offline memory regression: focused memory recall should surface the older medicine-related turn"
  );
  assert.ok(
    Array.isArray(focusedMemoryRecall.agentResults)
      && focusedMemoryRecall.agentResults.some((agent) => agent.id === "PHARMACY_AGENT"),
    "offline memory regression: focused memory recall should keep the pharmacy route active"
  );
  assert.ok(
    Array.isArray(focusedMemoryRecall.finalResponse?.supportSections)
      && focusedMemoryRecall.finalResponse.supportSections.some((section) => /medication context|precautions/i.test(section.title || "")),
    "offline memory regression: focused memory recall should surface medication continuity in support sections"
  );
  assert.ok(
    /focused memory|continuity signals|amlodipine|standing dizziness/i.test(
      `${focusedMemoryRecall.memoryContext?.summary || ""} ${focusedMemoryRecall.memoryContext?.continuitySummary || ""}`
    ),
    "offline memory regression: memory summary should describe the recovered continuity"
  );
  assert.ok(
    Array.isArray(focusedMemoryRecall.memoryContext?.activeFocusFamilies)
      && focusedMemoryRecall.memoryContext.activeFocusFamilies.some((item) => /medicine-dosing|dizziness-balance/i.test(item)),
    "offline memory regression: focused memory recall should expose stable offline memory focus families for the recovered topic."
  );
  assert.ok(
    /focus topics/i.test(String(focusedMemoryRecall.memoryContext?.continuitySummary || "")),
    "offline memory regression: continuity summary should call out the recovered memory focus topics."
  );

  await fetch(`${baseUrl}/api/memory/clear`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: focusedMemoryPatientId })
  });

  const recordPatientId = `record-persistence-smoke-${Date.now()}`;
  await fetch(`${baseUrl}/api/records/clear`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: recordPatientId })
  });

  const saveRecordResponse = await fetch(`${baseUrl}/api/records`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: recordPatientId,
      selectedRecordId: "smoke-record-1",
      records: [
        {
          id: "smoke-record-1",
          patientName: "Smoke Patient",
          age: "52",
          type: "lab",
          date: "2026-06-26",
          source: "Smoke test",
          documentName: "HbA1c report",
          conditions: "Type 2 diabetes",
          medicines: "Metformin",
          vitals: "BP 130/85",
          labs: "HbA1c 8.2",
          notes: "Localhost records persistence check",
          followUp: "Review with clinician"
        }
      ]
    })
  });
  const saveRecord = await saveRecordResponse.json();

  assert.equal(saveRecordResponse.status, 200);
  assert.equal(saveRecord.ok, true);
  assert.equal(saveRecord.records.mode, "persistent-local-server");
  assert.equal(saveRecord.records.file, "data/records/patient-records.json");
  assert.equal(saveRecord.records.recordCount, 1);
  assert.equal(saveRecord.records.records[0].documentName, "HbA1c report");
  assert.equal(saveRecord.records.records[0].structuredVitals.systolic, 130);
  assert.ok(saveRecord.records.records[0].labItems.includes("HbA1c 8.2"));
  assert.ok(saveRecord.records.records[0].summary.includes("HbA1c report"));
  assert.ok(saveRecord.records.records[0].searchText.includes("metformin"));

  const getRecordResponse = await fetch(`${baseUrl}/api/records?patientId=${recordPatientId}`);
  const getRecord = await getRecordResponse.json();

  assert.equal(getRecordResponse.status, 200);
  assert.equal(getRecord.ok, true);
  assert.equal(getRecord.records.recordCount, 1);
  assert.equal(getRecord.records.selectedRecordId, "smoke-record-1");
  assert.equal(getRecord.records.stats.typeCounts.lab, 1);
  assert.equal(getRecord.records.records[0].structuredVitals.systolic, 130);
  assert.ok(Array.isArray(getRecord.records.records[0].prioritySignals) && getRecord.records.records[0].prioritySignals.length >= 1);

  const clearRecordResponse = await fetch(`${baseUrl}/api/records/clear`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: recordPatientId })
  });
  const clearRecord = await clearRecordResponse.json();

  assert.equal(clearRecordResponse.status, 200);
  assert.equal(clearRecord.ok, true);
  assert.equal(clearRecord.records.recordCount, 0);

  const browserStatePatientId = `browser-state-smoke-${Date.now()}`;
  const browserStateSyncResponse = await fetch(`${baseUrl}/api/browser-state-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: browserStatePatientId,
      profile: {
        name: "Smoke Browser",
        age: "52",
        conditions: ["Hypertension"],
        medications: ["Amlodipine"]
      },
      history: [
        {
          at: "2026-07-01T09:00:00.000Z",
          message: "Repeat blood pressure follow-up after dizziness this week.",
          risk: "HIGH",
          routes: ["VITALS_AGENT"],
          summary: "Repeated blood pressure review."
        }
      ],
      snapshot: {
        activePatientId: browserStatePatientId,
        selectedRecordId: "browser-state-record-1",
        patientProfiles: [
          {
            id: browserStatePatientId,
            name: "Smoke Browser",
            age: "52",
            conditions: "Hypertension",
            medications: "Amlodipine"
          }
        ],
        summary: {
          signature: "browser-sync-smoke",
          draftLabels: ["Lab report", "Visit plan"],
          recordCount: 1,
          historyCount: 1,
          latestActivity: {
            label: "Lab record",
            at: "2026-07-01T09:00:00.000Z"
          },
          earliestActivity: {
            label: "Lab record",
            at: "2026-07-01T09:00:00.000Z"
          }
        },
        labReports: [
          {
            id: "lab-1",
            title: "Kidney panel",
            panel: "kidney",
            reportDate: "2026-06-27",
            createdAt: "2026-06-27T09:00:00.000Z",
            updatedAt: "2026-06-27T09:00:00.000Z"
          }
        ],
        vitalsTrend: [
          {
            id: "vitals-1",
            createdAt: "2026-07-01T09:00:00.000Z",
            updatedAt: "2026-07-01T09:00:00.000Z",
            vitals: {
              systolic: "148",
              diastolic: "92"
            }
          }
        ],
        medicineEntries: [
          {
            id: "medicine-1",
            name: "Amlodipine",
            strength: "5 mg",
            reviewType: "general",
            status: "active",
            createdAt: "2026-06-27T09:00:00.000Z",
            updatedAt: "2026-06-27T09:00:00.000Z"
          }
        ],
        medicineSideEffects: [
          {
            id: "effect-1",
            medicine: "Amlodipine",
            symptom: "Mild ankle swelling",
            severity: "medium",
            timing: "evening",
            status: "watch",
            at: "2026-07-01T09:00:00.000Z"
          }
        ],
        insuranceCases: [
          {
            id: "insurance-1",
            memberName: "Smoke Browser",
            claimType: "cashless",
            claimStatus: "preparing",
            company: "Care Plan",
            serviceDate: "2026-06-27"
          }
        ],
        visitQueue: [
          {
            id: "visit-1",
            patient: "Smoke Browser",
            department: "Cardiology",
            priority: "high",
            score: 78,
            date: "2026-07-02",
            dateLabel: "Jul 2, 2026",
            time: "09:30",
            mode: "Clinic",
            createdAt: "2026-07-01T09:00:00.000Z"
          }
        ],
        wellnessProgress: [
          {
            id: "wellness-1",
            at: "2026-07-01T09:00:00.000Z",
            date: "2026-07-01",
            score: 72,
            ageGroup: "adult",
            focus: "sleep"
          }
        ],
        safetyEvents: [
          {
            id: "safety-1",
            at: "2026-07-01T09:00:00.000Z",
            patientId: browserStatePatientId,
            patientName: "Smoke Browser",
            text: "Reported dizziness after the evening dose."
          }
        ],
        drafts: {
          workspaceDrafts: {
            summary: "Need follow-up packet"
          },
          labReportText: "Creatinine 1.6 mg/dL",
          labReportContext: {
            panelType: "kidney"
          },
          visitDraft: {
            reason: "Cardiology follow-up"
          },
          medicineDraft: {
            name: "Amlodipine"
          },
          vitalsDraft: {
            systolic: "148",
            diastolic: "92"
          },
          vitalsBaseline: {
            bp: "130/84",
            sugar: "118",
            pulse: "72"
          },
          wellnessDraft: {
            focus: "sleep"
          }
        }
      }
    })
  });
  const browserStateSync = await browserStateSyncResponse.json();

  assert.equal(browserStateSyncResponse.status, 200);
  assert.equal(browserStateSync.ok, true);
  assert.equal(browserStateSync.memory.mode, "persistent-local-server");
  assert.ok(browserStateSync.memory.recentTurnCount >= 1);
  assert.equal(browserStateSync.browserState.mode, "persistent-local-server");
  assert.equal(browserStateSync.browserState.patientId, browserStatePatientId);
  assert.equal(browserStateSync.browserState.summary.signature, "browser-sync-smoke");
  assert.equal(browserStateSync.browserState.snapshot.labReports[0].title, "Kidney panel");
  assert.ok(Array.isArray(browserStateSync.browserState.snapshot.medicineSideEffects));
  assert.equal(browserStateSync.browserState.snapshot.drafts.vitalsBaseline.bp, "130/84");

  const getBrowserStateResponse = await fetch(`${baseUrl}/api/browser-state?patientId=${browserStatePatientId}`);
  const getBrowserState = await getBrowserStateResponse.json();

  assert.equal(getBrowserStateResponse.status, 200);
  assert.equal(getBrowserState.ok, true);
  assert.equal(getBrowserState.browserState.patientId, browserStatePatientId);
  assert.equal(getBrowserState.browserState.summary.signature, "browser-sync-smoke");
  assert.equal(getBrowserState.browserState.snapshot.visitQueue[0].department, "Cardiology");
  assert.equal(getBrowserState.browserState.snapshot.drafts.vitalsBaseline.pulse, "72");

  const syncedBrowserMemoryResponse = await fetch(`${baseUrl}/api/memory?patientId=${browserStatePatientId}`);
  const syncedBrowserMemory = await syncedBrowserMemoryResponse.json();

  assert.equal(syncedBrowserMemoryResponse.status, 200);
  assert.equal(syncedBrowserMemory.ok, true);
  assert.ok(syncedBrowserMemory.memory.recentTurnCount >= 1);
  assert.ok(syncedBrowserMemory.memory.history[0].message.includes("Repeat blood pressure"));

  const enterpriseLocalOnlyPatientId = `enterprise-local-only-${Date.now()}`;
  const enterpriseLocalOnlyResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: enterpriseLocalOnlyPatientId,
      message: "Please review my blood pressure follow-up.",
      profile,
      processingPolicy: "local-only",
      interfaceName: "advisor"
    })
  });
  const enterpriseLocalOnly = await enterpriseLocalOnlyResponse.json();

  assert.equal(enterpriseLocalOnlyResponse.status, 200);
  assert.equal(enterpriseLocalOnly.ok, true);
  assert.equal(enterpriseLocalOnlyResponse.headers.get("x-care-nova-processing-policy"), "local-only");
  assert.equal(enterpriseLocalOnly.enterpriseExecution?.policy?.appliedMode, "local-only");
  assert.equal(enterpriseLocalOnly.enterpriseExecution?.policy?.networkAccess, "local-endpoints-only");
  assert.ok(Array.isArray(enterpriseLocalOnly.enterpriseExecution?.timings?.stages) && enterpriseLocalOnly.enterpriseExecution.timings.stages.length >= 5);

  await fetch(`${baseUrl}/api/memory/clear`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: enterpriseLocalOnlyPatientId })
  });

  const enterpriseIsolatedResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: `enterprise-isolated-${Date.now()}`,
      message: "Help me interpret this privately without saving the session.",
      profile,
      processingPolicy: "isolated-local-no-persist"
    })
  });
  const enterpriseIsolated = await enterpriseIsolatedResponse.json();

  assert.equal(enterpriseIsolatedResponse.status, 200);
  assert.equal(enterpriseIsolated.ok, true);
  assert.equal(enterpriseIsolated.enterpriseExecution?.policy?.appliedMode, "isolated-local-no-persist");
  assert.equal(enterpriseIsolated.enterpriseExecution?.policy?.localPersistence, "prompt-only-analysis");
  assert.equal(enterpriseIsolated.memory?.saved, false);

  const emptyResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: "demo-patient",
      message: "",
      profile,
      vitals: {}
    })
  });
  const emptyResult = await emptyResponse.json();

  assert.equal(emptyResponse.status, 400);
  assert.equal(emptyResult.code, "EMPTY_MESSAGE");

  const longResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: "demo-patient",
      message: "x".repeat(1401),
      profile,
      vitals: {}
    })
  });
  const longResult = await longResponse.json();

  assert.equal(longResponse.status, 200);
  assert.equal(longResult.ok, true);

  const invalidVitalsPatientId = `invalid-vitals-smoke-${Date.now()}`;
  const invalidVitalsResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: invalidVitalsPatientId,
      message: "I entered a test reading and want guidance.",
      profile,
      vitals: {
        systolic: "999",
        heartRate: "abc"
      }
    })
  });
  const invalidVitalsResult = await invalidVitalsResponse.json();

  assert.equal(invalidVitalsResponse.status, 200);
  assert.equal(invalidVitalsResult.ok, true);
  assert.equal(invalidVitalsResult.memoryContext.latestVitals.systolic, undefined);
  assert.ok(invalidVitalsResult.inputQuality.ignoredVitals.length >= 2);

  const invalidHistoryResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      patientId: "demo-patient",
      message: "Please review this follow-up.",
      history: {}
    })
  });
  const invalidHistoryResult = await invalidHistoryResponse.json();

  assert.equal(invalidHistoryResponse.status, 400);
  assert.equal(invalidHistoryResult.code, "INVALID_HISTORY_PAYLOAD");

  await fetch(`${baseUrl}/api/memory/clear`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ patientId: invalidVitalsPatientId })
  });

  const invalidJsonResponse = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: "{bad json"
  });
  const invalidJsonResult = await invalidJsonResponse.json();

  assert.equal(invalidJsonResponse.status, 400);
  assert.equal(invalidJsonResult.code, "INVALID_JSON");

  const headResponse = await fetch(`${baseUrl}/`, {
    method: "HEAD"
  });

  assert.equal(headResponse.status, 200);

  console.log(runOfflineSmoke ? "Full smoke tests passed." : "HTTP smoke tests passed.");
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
}
