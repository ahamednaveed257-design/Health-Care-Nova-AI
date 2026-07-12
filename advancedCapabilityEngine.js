import { createHash } from "node:crypto";

import {
  buildTrustedSourcePlan,
  getFhirIntegrationGuide,
  getGovernanceReadiness,
  getModelQualityFramework,
  getOfflinePackCatalog,
  getReportTemplateCatalog,
  getTrustedSourceCatalog
} from "./productIntelligence.js";
import { getEnterpriseDataRetentionPolicy } from "./enterpriseDataRetention.js";
import { getEnterpriseIncidentPosture } from "./enterpriseIncidentPosture.js";
import { getEnterpriseRecoveryPosture } from "./enterpriseRecoveryPosture.js";
import { getEnterpriseSecretPosture } from "./enterpriseSecretPosture.js";

const urgentSignalRules = [
  {
    id: "chest_pain_breathing",
    label: "Chest pain or pressure with breathing, sweating, jaw, arm, or back symptoms",
    route: "ALERT_AGENT",
    weight: 28,
    patterns: [
      /\bchest\s*(pain|pressure|tight|tightness|heaviness)\b/i,
      /\bheart\s*attack\b/i,
      /\bsweat(?:ing|y)?\b.*\bchest\b/i,
      /\bshort(?:ness)?\s*of\s*breath\b/i
    ]
  },
  {
    id: "stroke_signs",
    label: "Possible stroke signs: one-sided weakness, face droop, speech trouble, sudden severe headache",
    route: "ALERT_AGENT",
    weight: 30,
    patterns: [
      /\bone[-\s]?sided\s*(weakness|numbness)\b/i,
      /\bface\s*droop/i,
      /\bslurred\s*speech\b/i,
      /\bsudden\s*(confusion|vision|severe headache)\b/i,
      /\bstroke\b/i
    ]
  },
  {
    id: "severe_allergy",
    label: "Severe allergy signs: swelling, breathing trouble, widespread rash, or faintness",
    route: "ALERT_AGENT",
    weight: 26,
    patterns: [
      /\b(severe\s*)?allerg(?:y|ic)\b/i,
      /\b(anaphylaxis|epipen)\b/i,
      /\b(swollen|swelling)\s*(face|lips|tongue|throat)\b/i,
      /\bhives\b.*\bbreath/i
    ]
  },
  {
    id: "fainting_or_collapse",
    label: "Fainting, collapse, seizure, or loss of consciousness",
    route: "ALERT_AGENT",
    weight: 24,
    patterns: [
      /\bfaint(?:ed|ing)?\b/i,
      /\bpassed\s*out\b/i,
      /\bcollaps(?:e|ed|ing)\b/i,
      /\bseizure\b/i,
      /\bloss\s*of\s*consciousness\b/i
    ]
  },
  {
    id: "dangerous_bleeding",
    label: "Heavy bleeding, severe injury, or uncontrolled bleeding",
    route: "ALERT_AGENT",
    weight: 26,
    patterns: [
      /\bheavy\s*bleed/i,
      /\buncontrolled\s*bleed/i,
      /\bbleeding\s*(a lot|heavily)\b/i,
      /\bdeep\s*wound\b/i
    ]
  },
  {
    id: "mental_health_crisis",
    label: "Self-harm or suicide language",
    route: "ALERT_AGENT",
    weight: 30,
    patterns: [
      /\bsuicid(?:e|al)\b/i,
      /\bself[-\s]?harm\b/i,
      /\bkill\s*myself\b/i,
      /\bnot\s*want\s*to\s*live\b/i
    ]
  },
  {
    id: "dangerous_bp",
    label: "Very high blood pressure with symptoms or very high values",
    route: "ALERT_AGENT",
    weight: 22,
    patterns: [
      /\bbp\s*(?:is|:)?\s*(?:1[89]\d|2\d\d)\s*\/\s*(?:1[12]\d|[2-9]\d\d)\b/i,
      /\bblood\s*pressure\s*(?:is|:)?\s*(?:1[89]\d|2\d\d)\s*\/\s*(?:1[12]\d|[2-9]\d\d)\b/i
    ]
  },
  {
    id: "high_fever_risk",
    label: "High fever with stiff neck, confusion, breathing issue, rash, dehydration, or infant/elderly risk",
    route: "ALERT_AGENT",
    weight: 20,
    patterns: [
      /\bhigh\s*fever\b/i,
      /\bfever\b.*\b(stiff neck|confusion|rash|breathing|dehydrat|infant|baby)\b/i,
      /\btemperature\s*(?:is|:)?\s*(?:10[4-9]|4[01])\b/i
    ]
  }
];

const documentPatterns = [
  { id: "lab_report", label: "Lab report", patterns: [/\bhba1c\b/i, /\bcholesterol\b/i, /\bcbc\b/i, /\bcreatinine\b/i, /\begfr\b/i, /\btest result\b/i] },
  { id: "prescription", label: "Prescription or medicine list", patterns: [/\brx\b/i, /\btablet\b/i, /\bcapsule\b/i, /\bdose\b/i, /\bmg\b/i] },
  { id: "discharge_summary", label: "Discharge summary", patterns: [/\bdischarge\b/i, /\badmission\b/i, /\bfollow[-\s]?up\b/i, /\bprocedure\b/i] },
  { id: "insurance_letter", label: "Insurance letter", patterns: [/\bclaim\b/i, /\bdenial\b/i, /\bcoverage\b/i, /\bprior authorization\b/i, /\beob\b/i] },
  { id: "imaging_report", label: "Imaging report", patterns: [/\bx[-\s]?ray\b/i, /\bct\b/i, /\bmri\b/i, /\bultrasound\b/i, /\bimpression\b/i] }
];

const clinicalMarkers = [
  "HbA1c",
  "glucose",
  "LDL",
  "HDL",
  "triglycerides",
  "cholesterol",
  "creatinine",
  "eGFR",
  "TSH",
  "hemoglobin",
  "WBC",
  "platelets",
  "ALT",
  "AST",
  "bilirubin",
  "blood pressure",
  "heart rate",
  "temperature"
];

export function getAdvancedCapabilityCatalog(runtime = {}, env = process.env) {
  const trusted = getTrustedSourceCatalog(env);
  const quality = getModelQualityFramework(runtime, env);
  const governance = getGovernanceReadiness(runtime, env);
  const offlinePacks = getOfflinePackCatalog();

  const features = [
    {
      id: "evidence_cited_answers",
      label: "Evidence-cited answers",
      status: "ready",
      detail: "Every answer can attach a source packet from local medical references, approved online connectors, or cached references."
    },
    {
      id: "clinical_safety_triage",
      label: "Clinical safety triage",
      status: "ready",
      detail: "Urgent-signal rules run before response synthesis and can force the alert route when danger signs appear."
    },
    {
      id: "local_knowledge_graph",
      label: "Local patient knowledge graph",
      status: "ready",
      detail: "Patient profile, vitals, concerns, records, intents, risk, and evidence are stored as local structured facts."
    },
    {
      id: "human_review_packet",
      label: "Human review packet",
      status: "ready",
      detail: "High-risk, low-evidence, medicine, lab, and insurance cases generate a clinician or operations review checklist."
    },
    {
      id: "multimodal_intake_ready",
      label: "Multimodal intake ready",
      status: "adapter-ready",
      detail: "The local engine accepts pasted report text now and exposes a clean adapter point for OCR/image parsing later."
    },
    {
      id: "offline_pack_manager",
      label: "Offline pack manager",
      status: "ready",
      detail: `${offlinePacks.summary.packCount} offline packs support the web app without internet.`
    },
    {
      id: "fhir_connector",
      label: "FHIR connector boundary",
      status: "integration-ready",
      detail: "SMART on FHIR mapping is documented; no EHR calls run until a secured deployment enables them."
    },
    {
      id: "evaluation_dashboard",
      label: "Evaluation dashboard",
      status: "ready",
      detail: `${quality.summary.metricCount} quality metrics and ${quality.summary.benchmarkCaseCount} benchmark cases are available.`
    }
  ];

  return {
    ok: true,
    status: "advanced-agentic-capabilities-ready",
    summary: {
      readyFeatures: features.filter((feature) => feature.status === "ready").length,
      totalFeatures: features.length,
      trustedSources: trusted.sourceCount,
      enabledOnlineSources: trusted.enabledCount,
      qualityScoreTarget: 95,
      localFirst: true,
      medicalDevice: false
    },
    features,
    quality: quality.summary,
    governance: governance.summary,
    runtime,
    timestamp: new Date().toISOString()
  };
}

export function buildEvidenceCitationPacket({ payload = {}, result = {} } = {}) {
  const trustedPlan = result.trustedSourcePlan || buildTrustedSourcePlan(payload);
  const localMatches = Array.isArray(result.medicalKnowledge?.matches)
    ? result.medicalKnowledge.matches
    : [];
  const externalMatches = Array.isArray(result.medicalKnowledge?.externalKnowledge?.records)
    ? result.medicalKnowledge.externalKnowledge.records
    : Array.isArray(result.externalKnowledge?.records)
      ? result.externalKnowledge.records
      : [];
  const plannedSources = Array.isArray(trustedPlan.plannedSources) ? trustedPlan.plannedSources : [];
  const evidenceItems = [];

  for (const match of localMatches.slice(0, 5)) {
    evidenceItems.push({
      citationKey: `[E${evidenceItems.length + 1}]`,
      title: cleanText(match.title || match.category || match.id || "Local medical note"),
      source: "Care Nova offline medical library",
      category: cleanText(match.category || "local-reference"),
      relevance: clampScore(match.relevance || match.score || 72),
      sourceMode: "offline",
      matchedTerms: normalizeArray(match.matchedTerms || match.keywords).slice(0, 6),
      claimUse: "Supports education, safety framing, and care preparation."
    });
  }

  for (const match of externalMatches.slice(0, 3)) {
    evidenceItems.push({
      citationKey: `[E${evidenceItems.length + 1}]`,
      title: cleanText(match.title || match.name || match.id || "Cached online reference"),
      source: cleanText(match.source || match.sourceName || "approved external source"),
      category: cleanText(match.category || "external-reference"),
      relevance: clampScore(match.relevance || match.score || 68),
      sourceMode: "cached-online",
      matchedTerms: normalizeArray(match.matchedTerms || match.terms).slice(0, 6),
      claimUse: "Used only after approved connector rules and local cache policy."
    });
  }

  if (!evidenceItems.length) {
    for (const source of plannedSources.slice(0, 3)) {
      evidenceItems.push({
        citationKey: `[E${evidenceItems.length + 1}]`,
        title: cleanText(source.name || source.sourceId || "Planned trusted source"),
        source: cleanText(source.sourceId || "trusted-source-plan"),
        category: trustedPlan.queryType || "general",
        relevance: source.onlineReady ? 76 : 64,
        sourceMode: source.onlineReady ? "online-ready" : "offline-fallback",
        matchedTerms: [],
        claimUse: source.onlineReady ? "Available when online connector is enabled." : "Local fallback remains active."
      });
    }
  }

  return {
    status: evidenceItems.length ? "evidence-packet-ready" : "evidence-needed",
    sourceCount: evidenceItems.length,
    answerTrace: {
      requestType: trustedPlan.queryType || result.requirementProfile?.domain || "general",
      responseOwner: result.plan?.responseOwner?.route || result.finalResponse?.responseFocus?.primaryRoute || "RAG_AGENT",
      guardrailStatus: result.guardrails?.passed === false ? "review-needed" : "passed",
      caveat: "Evidence is for education and preparation; it is not a diagnosis, prescription, or emergency service."
    },
    items: evidenceItems,
    timestamp: new Date().toISOString()
  };
}

export function runClinicalSafetyTriage({ payload = {}, result = {} } = {}) {
  const text = normalizeText([
    payload.message,
    payload.query,
    payload.context?.duration,
    payload.context?.careGoal,
    payload.context?.supportNow,
    ...(payload.context?.redFlags || []),
    JSON.stringify(payload.vitals || {}),
    result.finalResponse?.summary,
    result.risk?.label
  ].join(" "));
  const signals = urgentSignalRules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => ({
      id: rule.id,
      label: rule.label,
      route: rule.route,
      weight: rule.weight
    }));
  const profile = payload.profile || {};
  const modifiers = getPopulationModifiers(profile, text);
  const existingRisk = cleanText(result.risk?.level).toUpperCase();
  const riskBase = existingRisk === "CRITICAL" ? 72 : existingRisk === "HIGH" ? 58 : existingRisk === "MEDIUM" ? 34 : 12;
  const score = clampScore(riskBase + signals.reduce((sum, signal) => sum + signal.weight, 0) + modifiers.length * 6);
  const hasUrgentSignal = signals.some((signal) => signal.route === "ALERT_AGENT");
  const level = score >= 90 || existingRisk === "CRITICAL"
    ? "CRITICAL"
    : score >= 68 || existingRisk === "HIGH" || (hasUrgentSignal && score >= 38)
      ? "HIGH"
      : score >= 42 || existingRisk === "MEDIUM"
        ? "MEDIUM"
        : "LOW";
  const recommendedRoute = hasUrgentSignal || level === "CRITICAL" || level === "HIGH" ? "ALERT_AGENT" : result.plan?.responseOwner?.route || "RAG_AGENT";

  return {
    status: "triage-complete",
    level,
    score,
    recommendedRoute,
    signals,
    modifiers,
    actions: buildTriageActions(level, signals),
    safetyBoundary: {
      liveEmergencyAction: false,
      liveSmsOrEmail: false,
      diagnosis: false,
      prescription: false
    },
    timestamp: new Date().toISOString()
  };
}

export function getEvaluationDashboard(runtime = {}, env = process.env) {
  const quality = getModelQualityFramework(runtime, env);
  const suites = [
    {
      id: "routing_accuracy",
      label: "Routing accuracy",
      target: 96,
      cases: ["general health", "medicine", "visit", "urgent", "labs", "insurance"],
      status: "ready"
    },
    {
      id: "red_flag_recall",
      label: "Urgent red-flag recall",
      target: 99,
      cases: urgentSignalRules.map((rule) => rule.id),
      status: "ready"
    },
    {
      id: "medicine_safety",
      label: "Medicine safety",
      target: 97,
      cases: ["missed dose", "side effect", "interaction question", "allergy signal"],
      status: "ready"
    },
    {
      id: "offline_parity",
      label: "Online/offline parity",
      target: 98,
      cases: ["no internet", "cached external reference", "local-only answer"],
      status: "ready"
    },
    {
      id: "source_traceability",
      label: "Source traceability",
      target: 95,
      cases: ["offline record citation", "trusted source plan", "doctor-ready note"],
      status: "ready"
    },
    {
      id: "records_persistence",
      label: "Records persistence",
      target: 100,
      cases: ["memory save", "records save", "knowledge graph update", "clear patient data"],
      status: "ready"
    }
  ];

  return {
    ok: true,
    status: "evaluation-dashboard-ready",
    summary: {
      suiteCount: suites.length,
      benchmarkCaseCount: quality.summary.benchmarkCaseCount,
      minimumReleaseScore: 90,
      targetClinicalSafety: 99,
      lastRuntimeNode: runtime.node || ""
    },
    suites,
    metrics: quality.metrics,
    benchmarkCases: quality.benchmarkCases,
    timestamp: new Date().toISOString()
  };
}

export function getOfflinePackManager() {
  const catalog = getOfflinePackCatalog();
  const packs = (catalog.packs || []).map((pack) => ({
    ...pack,
    installState: "bundled",
    sourceVersion: "local-offline-pack-1",
    updatePolicy: "reviewed file update only",
    checksum: shortHash(JSON.stringify(pack))
  }));

  return {
    ok: true,
    status: "offline-pack-manager-ready",
    summary: {
      ...catalog.summary,
      installState: "bundled",
      offlineParity: true,
      updateRequiresReview: true
    },
    packs,
    timestamp: new Date().toISOString()
  };
}

export function getFhirConnectorStatus(env = process.env) {
  const fhir = getFhirIntegrationGuide(env);
  const scopes = [
    "launch/patient",
    "patient/Patient.read",
    "patient/Observation.read",
    "patient/MedicationRequest.read",
    "patient/DocumentReference.read",
    "offline_access"
  ];

  return {
    ok: true,
    status: fhir.status,
    summary: {
      ...fhir.summary,
      securedOAuthRequired: true,
      noWriteByDefault: true,
      noEhrCallByDefault: true
    },
    scopes,
    resourceMap: fhir.resources,
    implementationSteps: fhir.implementationSteps,
    timestamp: new Date().toISOString()
  };
}

export function buildHumanReviewPacket({ payload = {}, result = {}, graph = {} } = {}) {
  const triage = runClinicalSafetyTriage({ payload, result });
  const evidence = buildEvidenceCitationPacket({ payload, result });
  const route = result.plan?.responseOwner?.route || result.finalResponse?.responseFocus?.primaryRoute || "";
  const reviewReasons = [];

  if (["HIGH", "CRITICAL"].includes(triage.level)) reviewReasons.push("urgent-safety");
  if (route === "PHARMACY_AGENT") reviewReasons.push("medicine-review");
  if (route === "LABS_AGENT") reviewReasons.push("lab-context-review");
  if (route === "INSURANCE_AGENT") reviewReasons.push("benefit-policy-review");
  if (evidence.sourceCount < 1) reviewReasons.push("low-evidence");
  if (graph.factCount > 50) reviewReasons.push("large-patient-context");
  if (result.guardrails?.passed === false) reviewReasons.push("guardrail-review");

  return {
    status: reviewReasons.length ? "review-recommended" : "review-optional",
    reviewRequired: reviewReasons.includes("urgent-safety") || result.guardrails?.passed === false,
    reviewReasons,
    checklist: [
      "Confirm patient identity and basic context.",
      "Check urgent warning signs before routine guidance.",
      "Verify medicines, allergies, pregnancy status, age, and key conditions if relevant.",
      "Review supporting records or lab values before changing any care plan.",
      "Escalate to real-world care for urgent, severe, worsening, or unclear symptoms."
    ],
    packet: {
      patient: summarizeProfile(payload.profile),
      concern: cleanText(payload.message || payload.query || "No concern entered."),
      risk: triage.level,
      route,
      evidenceCount: evidence.sourceCount,
      graphFacts: graph.factCount || 0
    },
    signoffFields: ["reviewerName", "role", "reviewTime", "decision", "notes"],
    timestamp: new Date().toISOString()
  };
}

export function analyzeMultimodalIntake(payload = {}) {
  const text = cleanText([
    payload.reportText,
    payload.documentText,
    payload.imageText,
    payload.message,
    payload.query,
    payload.fileName,
    payload.fileType
  ].join(" "));
  const documentType = detectDocumentType(text);
  const markers = clinicalMarkers
    .filter((marker) => new RegExp(`\\b${escapeRegex(marker)}\\b`, "i").test(text))
    .map((marker) => ({
      marker,
      found: true,
      reviewUse: markerReviewUse(marker)
    }));
  const valueHints = extractClinicalValueHints(text);

  return {
    status: text ? "multimodal-intake-reviewed" : "waiting-for-document-text",
    documentType,
    markers,
    valueHints,
    missingContext: buildDocumentMissingContext(documentType, markers),
    adapterStatus: {
      fileUpload: true,
      pastedText: true,
      browserOcrAdapter: "ready-to-connect",
      localImageUnderstanding: "not-enabled-by-default"
    },
    safetyBoundary: "This extracts and organizes document context only; it does not diagnose or replace clinician interpretation.",
    timestamp: new Date().toISOString()
  };
}

export function buildPersonalizedPreventionPlan({ payload = {}, result = {}, graph = {} } = {}) {
  const profile = payload.profile || {};
  const text = normalizeText([
    JSON.stringify(profile),
    (graph.facts || []).map((fact) => `${fact.type} ${fact.value}`).join(" "),
    payload.message,
    JSON.stringify(payload.vitals || {})
  ].join(" "));
  const age = Number.parseInt(profile.age, 10);
  const ageGroup = Number.isFinite(age) ? (age < 18 ? "child-teen" : age < 40 ? "young-adult" : age < 65 ? "adult" : "older-adult") : "unknown";
  const focusAreas = [];

  if (/hypertension|blood pressure|\bbp\b/.test(text)) focusAreas.push("Blood pressure routine");
  if (/diabetes|hba1c|glucose|sugar|metformin/.test(text)) focusAreas.push("Blood sugar routine");
  if (/cholesterol|ldl|hdl|triglyceride/.test(text)) focusAreas.push("Heart health");
  if (/sleep|stress|anxiety|tired|fatigue/.test(text)) focusAreas.push("Sleep and stress");
  if (/medicine|tablet|dose|missed|amlodipine|metformin/.test(text)) focusAreas.push("Medicine routine");
  if (!focusAreas.length) focusAreas.push("Balanced day routine");

  return {
    status: "personalized-prevention-ready",
    ageGroup,
    focusAreas: unique(focusAreas).slice(0, 5),
    daily: [
      "Track the main symptom or health goal once daily with time and severity.",
      "Keep water, meals, sleep, movement, and medicine timing consistent where possible.",
      "Record unusual readings or symptoms instead of relying on memory."
    ],
    weekly: [
      "Review patterns in symptoms, vitals, sleep, stress, and missed medicines.",
      "Prepare one question for a clinician if symptoms repeat or readings stay outside the personal care plan.",
      "Update local records after any visit, medicine change, or new report."
    ],
    monthly: [
      "Check whether preventive screenings, refills, follow-up visits, and lab reviews are due.",
      "Export a patient summary before appointments.",
      "Refresh emergency contacts and allergies in the profile."
    ],
    safetyNotes: [
      "Use urgent care or emergency services for severe, sudden, worsening, or alarming symptoms.",
      "Do not change prescribed medicines or doses based only on this app."
    ],
    graphFactsUsed: graph.factCount || 0,
    timestamp: new Date().toISOString()
  };
}

export function buildDoctorReadyReport({ payload = {}, result = {}, graph = {} } = {}) {
  const triage = runClinicalSafetyTriage({ payload, result });
  const evidence = buildEvidenceCitationPacket({ payload, result });
  const profile = payload.profile || {};
  const questionsToAsk = buildDoctorQuestions(payload, result);

  return {
    status: "doctor-ready-report-ready",
    format: "one-page-clinical-brief",
    questionsToAsk,
    sections: [
      {
        title: "Patient",
        content: summarizeProfile(profile)
      },
      {
        title: "Main Concern",
        content: cleanText(payload.message || payload.query || "No concern entered.")
      },
      {
        title: "Safety View",
        content: `${triage.level} risk; route ${triage.recommendedRoute}; signals ${triage.signals.map((signal) => signal.id).join(", ") || "none detected"}.`
      },
      {
        title: "Vitals",
        content: summarizeVitals(payload.vitals)
      },
      {
        title: "Medicines And Allergies",
        content: cleanText([
          profile.medications || profile.medicines ? `Medicines: ${profile.medications || profile.medicines}` : "Medicines: not entered",
          profile.allergies ? `Allergies: ${profile.allergies}` : "Allergies: not entered"
        ].join("; "))
      },
      {
        title: "Questions To Ask",
        content: questionsToAsk.join(" ")
      },
      {
        title: "Evidence",
        content: evidence.items.map((item) => `${item.citationKey} ${item.title}`).join("; ") || "No source packet yet."
      }
    ],
    timeline: (graph.facts || []).slice(0, 8).map((fact) => ({
      when: fact.lastSeenAt,
      label: `${fact.type}: ${fact.value}`,
      source: fact.source
    })),
    timestamp: new Date().toISOString()
  };
}

export function getAdminTrustCenter(runtime = {}, env = process.env) {
  const governance = getGovernanceReadiness(runtime, env);
  const quality = getModelQualityFramework(runtime, env);
  const trusted = getTrustedSourceCatalog(env);
  const offlinePacks = getOfflinePackCatalog();
  const retention = getEnterpriseDataRetentionPolicy(env);
  const incident = getEnterpriseIncidentPosture(env);
  const recovery = getEnterpriseRecoveryPosture(env);
  const secretPosture = getEnterpriseSecretPosture(env);

  return {
    ok: true,
    status: "trust-center-ready",
    summary: {
      intendedUse: governance.summary.intendedUse,
      notMedicalDevice: governance.summary.notMedicalDevice,
      metrics: quality.summary.metricCount,
      sources: trusted.sourceCount,
      offlinePacks: offlinePacks.summary.packCount,
      localFirst: true,
      retentionStatus: retention.status,
      incidentStatus: incident.status,
      recoveryStatus: recovery.status,
      secretStatus: secretPosture.status
    },
    controls: [
      "Local memory and records persist on the server file system.",
      "Operational audit events are stored locally for runtime, storage, training, and deployment review.",
      "Storage integrity checks can verify core JSON stores before release or handoff.",
      "Retention posture is documented across memory, records, graph, audit, training, cache, and local mirror stores.",
      "Incident posture reports owner, escalation channel, drill cadence, and severity-runbook coverage for enterprise operations review.",
      "Recovery posture reports restore-drill cadence, backup verification, and RPO/RTO targets without exposing patient data.",
      "Secret posture reports configured control keys, cloud-provider keys, and rotation readiness without exposing secret values.",
      "Protected mutation routes can require an admin token and can be paused by maintenance or read-only runtime modes.",
      "External medical APIs stay disabled unless environment variables explicitly enable them.",
      "All high-risk outputs keep the no-diagnosis and no-prescription boundary.",
      "Human review packets are generated for high-risk, medicine, lab, insurance, or low-evidence cases.",
      "Release checks validate routes, storage, headers, PWA install, and safety responses."
    ],
    ownerChecklist: [
      "Run release checks before sharing.",
      "Review /api/audit-events after enterprise validation or incident drills.",
      "Review /api/storage-integrity before packaging or restoring data.",
      "Review /api/data-retention-policy before shared use and assign a retention owner.",
      "Review /api/incident-posture before shared rollout and after incident drills or process changes.",
      "Review /api/recovery-posture after every restore drill and before release approval.",
      "Review /api/admin-secret-posture before public deployment and rotate secrets on schedule.",
      "Enable admin-protected mutations before shared-team use of training, records, or mirror controls.",
      "Back up data folder if patient records matter.",
      "Use HTTPS and access controls before remote deployment.",
      "Connect clinical APIs only after approval and privacy review."
    ],
    timestamp: new Date().toISOString()
  };
}

export function getSecureBackupPlan() {
  const files = [
    "data/audit/operational-audit-log.json",
    "data/audit/admin-review-history.json",
    "data/memory/patient-memory.json",
    "data/records/patient-records.json",
    "data/graph/patient-knowledge-graph.json",
    "data/external/external-knowledge-cache.json",
    "data/onedrive-mirror/mirror-manifest.json"
  ];

  return {
    ok: true,
    status: "backup-plan-ready",
    storageMode: "local-server-files-plus-onedrive-local-mirror",
    files,
    exportStrategy: [
      "Stop the server or wait until no save is active.",
      "Copy the data folder to an encrypted backup location.",
      "Restore by replacing the data folder before starting the server.",
      "Review /api/recovery-posture after the restore to confirm drill cadence and ownership."
    ],
    privacyRecommendations: [
      "Use full-disk encryption on the host machine.",
      "Restrict file access to the app owner.",
      "Use HTTPS, authentication, and network rules before remote sharing."
    ],
    encryptionBuiltIn: false,
    timestamp: new Date().toISOString()
  };
}

export function buildAdvancedCapabilitySnapshot({ payload = {}, result = {}, graph = {}, runtime = {}, env = process.env, precomputed = {} } = {}) {
  const catalog = getAdvancedCapabilityCatalog(runtime, env);
  const evidence = precomputed.evidence || buildEvidenceCitationPacket({ payload, result });
  const safetyTriage = precomputed.safetyTriage || runClinicalSafetyTriage({ payload, result });
  const humanReview = precomputed.humanReview || buildHumanReviewPacket({ payload, result, graph });
  const preventionPlan = precomputed.preventionPlan || buildPersonalizedPreventionPlan({ payload, result, graph });
  const multimodalIntake = precomputed.multimodalIntake || analyzeMultimodalIntake(payload);

  return {
    status: "advanced-snapshot-ready",
    capabilities: catalog.summary,
    evidence,
    safetyTriage,
    humanReview,
    preventionPlan,
    multimodalIntake,
    evaluation: getEvaluationDashboard(runtime, env).summary,
    offlinePacks: getOfflinePackManager().summary,
    fhir: getFhirConnectorStatus(env).summary,
    trustCenter: getAdminTrustCenter(runtime, env).summary,
    timestamp: new Date().toISOString()
  };
}

function getPopulationModifiers(profile = {}, text = "") {
  const age = Number.parseInt(profile.age, 10);
  const modifiers = [];
  const profileText = normalizeText(JSON.stringify(profile));
  const mergedText = `${profileText} ${text}`;

  if (Number.isFinite(age) && age < 5) modifiers.push("young-child");
  if (Number.isFinite(age) && age >= 65) modifiers.push("older-adult");
  if (/\bpregnan(?:t|cy)\b/.test(mergedText)) modifiers.push("pregnancy");
  if (/\bdiabetes|hba1c|glucose\b/.test(mergedText)) modifiers.push("diabetes");
  if (/\bhypertension|heart disease|cardiac|blood pressure\b/.test(mergedText)) modifiers.push("heart-or-bp-condition");
  if (/\bimmunocompromised|chemo|transplant|steroid\b/.test(mergedText)) modifiers.push("immunocompromised");

  return unique(modifiers);
}

function buildTriageActions(level, signals) {
  if (level === "CRITICAL" || level === "HIGH") {
    return [
      "Treat this as urgent and seek real-world medical help now.",
      "If symptoms are severe, sudden, or worsening, use local emergency services.",
      "Keep the person supervised and share symptoms, medicines, allergies, and readings with care teams."
    ];
  }

  if (level === "MEDIUM") {
    return [
      "Monitor symptoms and readings closely.",
      "Contact a clinician soon if symptoms persist, repeat, or worsen.",
      signals.length ? "Watch the detected warning pattern carefully." : "Add timing, severity, medicines, and readings for a better review."
    ];
  }

  return [
    "Use self-care only for mild, familiar symptoms.",
    "Track duration, severity, readings, and changes.",
    "Escalate if severe, sudden, worsening, or new warning signs appear."
  ];
}

function detectDocumentType(text) {
  const match = documentPatterns.find((item) => item.patterns.some((pattern) => pattern.test(text)));

  return match
    ? { id: match.id, label: match.label }
    : { id: text ? "general_health_document" : "none", label: text ? "General health document" : "No document text" };
}

function buildDocumentMissingContext(documentType, markers) {
  if (documentType.id === "none") {
    return ["Paste report text or upload extracted text.", "Add patient age and reason for the report."];
  }

  const missing = ["Add report date.", "Add reference ranges if visible.", "Add whether this is a first or repeat report."];

  if (!markers.length) {
    missing.unshift("Add key values such as HbA1c, LDL, creatinine, CBC, or TSH if present.");
  }

  return missing;
}

function markerReviewUse(marker) {
  const normalized = marker.toLowerCase();

  if (["hba1c", "glucose"].includes(normalized)) return "Blood sugar trend review";
  if (["ldl", "hdl", "triglycerides", "cholesterol"].includes(normalized)) return "Heart and cholesterol review";
  if (["creatinine", "egfr"].includes(normalized)) return "Kidney function discussion";
  if (["hemoglobin", "wbc", "platelets"].includes(normalized)) return "Blood count discussion";
  if (["alt", "ast", "bilirubin"].includes(normalized)) return "Liver panel discussion";
  if (normalized === "tsh") return "Thyroid discussion";

  return "Clinical context";
}

function extractClinicalValueHints(text) {
  const matches = [];
  const pattern = /\b(HbA1c|LDL|HDL|triglycerides|cholesterol|creatinine|eGFR|TSH|hemoglobin|WBC|platelets|ALT|AST|bilirubin|glucose)\b[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)/gi;
  let match = pattern.exec(text);

  while (match && matches.length < 12) {
    matches.push({
      marker: match[1],
      value: match[2],
      reviewUse: markerReviewUse(match[1])
    });
    match = pattern.exec(text);
  }

  return matches;
}

function buildDoctorQuestions(payload, result) {
  const route = result.plan?.responseOwner?.route || "";
  const questions = [
    "What symptoms or readings would mean I should seek urgent care?",
    "What should I track before the next visit?"
  ];

  if (route === "PHARMACY_AGENT") {
    questions.push("Should any medicine timing, interaction, or side effect be reviewed?");
  }
  if (route === "LABS_AGENT") {
    questions.push("Which lab values need repeat testing or trend review?");
  }
  if (payload.vitals && Object.keys(payload.vitals).length) {
    questions.push("Are these readings expected for my care plan?");
  }

  return questions.slice(0, 5);
}

function summarizeProfile(profile = {}) {
  const parts = [];

  if (profile.name) parts.push(cleanText(profile.name));
  if (profile.age) parts.push(`${cleanText(profile.age)} years`);
  if (profile.conditions) parts.push(`Conditions: ${cleanText(profile.conditions)}`);
  if (profile.medications || profile.medicines) parts.push(`Medicines: ${cleanText(profile.medications || profile.medicines)}`);
  if (profile.allergies) parts.push(`Allergies: ${cleanText(profile.allergies)}`);

  return parts.length ? parts.join("; ") : "Patient details not entered.";
}

function summarizeVitals(vitals = {}) {
  const entries = Object.entries(vitals || {})
    .filter(([, value]) => cleanText(value))
    .map(([key, value]) => `${key}: ${value}`);

  return entries.length ? entries.join("; ") : "No vitals entered.";
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.map(cleanText).filter(Boolean);
  }

  return cleanText(value)
    .split(/[,;|]+/g)
    .map(cleanText)
    .filter(Boolean);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return cleanText(value).toLowerCase();
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
