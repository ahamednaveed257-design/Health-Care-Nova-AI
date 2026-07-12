import { once } from "node:events";
import { createServerApp } from "../server.js";
import { loadPatientKnowledgeGraph } from "../src/knowledgeGraphStore.js";
import { loadPatientMemory } from "../src/memoryStore.js";
import { loadPatientDataRecords, savePatientDataRecords } from "../src/recordStore.js";

const patientId = process.argv[2] || "demo-patient";

const profile = {
  name: "Naveed Ahamed",
  age: "52",
  conditions: "Hypertension, Type 2 diabetes, CKD stage 3a, Hyperlipidemia",
  medications: "Amlodipine, Losartan, Metformin, Rosuvastatin",
  allergies: "No known allergies",
  baselineBp: "130/85"
};

const seededRecords = [
  {
    id: "record-specialist-cardiology-followup-20260709",
    createdAt: "2026-07-09T08:10:00.000Z",
    updatedAt: "2026-07-09T08:10:00.000Z",
    patientName: "Naveed Ahamed",
    age: "52",
    type: "visit",
    date: "2026-07-09",
    episode: "Cardiology follow-up prep",
    tags: ["specialist", "cardiology", "blood-pressure", "follow-up"],
    source: "Specialist tab",
    documentCategory: "specialist-note",
    documentName: "Cardiology blood pressure follow-up summary",
    conditions: "Hypertension, Type 2 diabetes, CKD stage 3a, Hyperlipidemia",
    allergies: "No known allergies",
    medicines: "Amlodipine 5 mg daily; Losartan 50 mg nightly; Metformin 500 mg twice daily; Rosuvastatin 10 mg nightly",
    vitals: "Home BP AM 148/92 to 158/96; PM 154/94 to 164/98; Pulse 82-90; Weight 82 kg; Oxygen 97%",
    labs: "2026-07-09 Creatinine 1.6 mg/dL; eGFR 48 mL/min/1.73m2; Potassium 5.2 mmol/L; LDL 142 mg/dL; HbA1c 7.9%",
    notes: "Cardiology review focus: evening BP spikes, ankle swelling after standing, mild exertional breathlessness on stairs, no chest pain, no fainting. Risk modifiers: CKD stage 3a, diabetes, LDL above target, family history of heart disease. Pending tests: urine albumin/creatinine ratio and repeat metabolic panel. Visit question themes: BP target, kidney-safe pain options, swelling pattern, statin adherence, and referral for nutrition counseling.",
    followUp: "Bring BP log, medicine times, kidney labs, and swelling timeline to the cardiology visit on 2026-07-15."
  },
  {
    id: "record-lab-kidney-diabetes-trend-20260709",
    createdAt: "2026-07-09T08:25:00.000Z",
    updatedAt: "2026-07-09T08:25:00.000Z",
    patientName: "Naveed Ahamed",
    age: "52",
    type: "labs",
    date: "2026-07-09",
    episode: "Kidney and diabetes trend review",
    tags: ["labs", "kidney", "diabetes", "trend"],
    source: "Labs tab",
    documentCategory: "lab-report",
    documentName: "Kidney and diabetes trend - 2026-07-09",
    conditions: "Hypertension, Type 2 diabetes, CKD stage 3a, Hyperlipidemia",
    allergies: "No known allergies",
    medicines: "Amlodipine 5 mg daily; Losartan 50 mg nightly; Metformin 500 mg twice daily; Rosuvastatin 10 mg nightly",
    vitals: "BP 158/96; Pulse 88; Glucose 168; Weight 82 kg",
    labs: "Report date 2026-07-09\nCreatinine 1.6 mg/dL (0.6-1.3)\neGFR 48 mL/min/1.73m2 (>60)\nPotassium 5.2 mmol/L (3.5-5.1)\nUrine albumin/creatinine ratio 64 mg/g (<30)\nHbA1c 7.9 % (4.5-5.6)\nLDL 142 mg/dL (<100)\nPrior 2026-06-20 Creatinine 1.1 mg/dL; eGFR 78; HbA1c 8.2%; LDL 160",
    notes: "Trend packet for kidney, sugar, and lipid follow-up. Kidney markers worsened from the prior report, glucose remains above target, and LDL is still above the stated goal. Symptoms this week: ankle swelling after work, mild fatigue, and no vomiting or confusion.",
    followUp: "Repeat kidney panel and review diabetes, BP, and kidney-protection plan with the clinician."
  },
  {
    id: "record-insurance-prior-auth-stress-echo-20260709",
    createdAt: "2026-07-09T08:40:00.000Z",
    updatedAt: "2026-07-09T08:40:00.000Z",
    patientName: "Naveed Ahamed",
    age: "52",
    type: "insurance",
    date: "2026-07-09",
    episode: "Prior-authorization packet",
    tags: ["insurance", "prior-auth", "cardiology", "claim"],
    source: "Insurance tab",
    documentCategory: "prior-auth-packet",
    documentName: "Stress echocardiogram prior-authorization packet",
    conditions: "Hypertension, Type 2 diabetes, CKD stage 3a, Hyperlipidemia",
    allergies: "No known allergies",
    medicines: "Amlodipine 5 mg daily; Losartan 50 mg nightly; Metformin 500 mg twice daily; Rosuvastatin 10 mg nightly",
    vitals: "BP 158/96; Pulse 88",
    labs: "Recent abnormal reports: Creatinine 1.6 mg/dL, eGFR 48 mL/min/1.73m2, UACR 64 mg/g, LDL 142 mg/dL",
    notes: "Plan: HCL Care PPO. Service requested: stress echocardiogram for exertional breathlessness, ankle swelling, uncontrolled BP, diabetes, and CKD. Documents on hand: referral note, BP log, abnormal kidney panel, lipid report, and medicine list. Missing: insurer form copy, ordering code confirmation, facility tax ID, and appointment hold date. Submission target: before 2026-07-16.",
    followUp: "Confirm payer form, diagnosis code, CPT code, and clinician letter needs before submission."
  },
  {
    id: "record-vitals-home-log-20260709",
    createdAt: "2026-07-09T08:55:00.000Z",
    updatedAt: "2026-07-09T08:55:00.000Z",
    patientName: "Naveed Ahamed",
    age: "52",
    type: "vitals",
    date: "2026-07-09",
    episode: "7-day home monitoring log",
    tags: ["vitals", "home-log", "bp", "glucose"],
    source: "Vitals tab",
    documentCategory: "home-monitoring-log",
    documentName: "Home BP and glucose log - week of 2026-07-09",
    conditions: "Hypertension, Type 2 diabetes, CKD stage 3a, Hyperlipidemia",
    allergies: "No known allergies",
    medicines: "Amlodipine 5 mg daily; Losartan 50 mg nightly; Metformin 500 mg twice daily; Rosuvastatin 10 mg nightly",
    vitals: "2026-07-03 BP 148/92 pulse 82 glucose 162; 2026-07-05 BP 154/94 pulse 85 glucose 171; 2026-07-07 BP 160/98 pulse 88 glucose 176; 2026-07-09 BP 158/96 pulse 88 glucose 168",
    labs: "",
    notes: "Evening BP is usually higher than morning. Two workdays included ankle swelling after standing. No chest pain, no fainting, and no oxygen drop reported.",
    followUp: "Continue twice-daily BP log and note meal timing, salt intake, swelling, and missed doses."
  }
];

const scenarios = [
  {
    id: "specialist-cardiology-followup",
    payload: {
      patientId,
      interfaceName: "specialist",
      tab: "specialist",
      agentRoute: "SPECIALIST_DOCTOR_AGENT",
      preferredAgent: "SPECIALIST_DOCTOR_AGENT",
      message: "Specialist doctor review for heart and blood pressure. I have evening BP spikes, ankle swelling, and I want a focused cardiology follow-up summary.",
      profile,
      vitals: {
        systolic: 158,
        diastolic: 96,
        heartRate: 88,
        bloodSugar: 168,
        oxygenSaturation: 97,
        temperatureC: 37
      },
      context: {
        duration: "2 weeks",
        severity: 4,
        careGoal: "doctor-visit",
        supportNow: "with-family",
        redFlags: ["ankle swelling"],
        specialistFocus: "cardiology",
        specialistLens: "cardiology",
        lastMedicationTime: "Losartan taken at 9 PM yesterday; amlodipine taken this morning",
        riskModifiers: ["type-2-diabetes", "ckd-stage-3a", "high-ldl", "family-history-heart-disease"],
        wellnessProfile: {
          sleep: "5 to 6 hours",
          movement: "3200 steps per day",
          sodium: "restaurant food 4 days per week",
          stress: "high work stress"
        },
        visitProfile: {
          upcomingVisit: "Cardiology follow-up on 2026-07-15",
          pendingTests: "Urine albumin/creatinine ratio and repeat metabolic panel",
          insuranceConcern: "Referral and benefit check needed",
          careTeam: "Primary care and cardiology"
        }
      },
      reportText: "Specialist follow-up note\nVisit date: 2026-07-09\nCardiology referral for uncontrolled blood pressure, ankle swelling, and kidney-risk review.\nCurrent BP log 148/92 to 164/98.\nRecent labs: creatinine 1.6 mg/dL, eGFR 48 mL/min/1.73m2, LDL 142 mg/dL."
    }
  },
  {
    id: "labs-kidney-diabetes-trend",
    payload: {
      patientId,
      interfaceName: "labs",
      tab: "labs",
      agentRoute: "LABS_AGENT",
      preferredAgent: "LABS_AGENT",
      message: "Please explain my kidney and diabetes lab trend and prepare focused questions for my next visit.",
      profile,
      vitals: {
        systolic: 158,
        diastolic: 96,
        heartRate: 88,
        bloodSugar: 168
      },
      context: {
        duration: "current report",
        severity: 3,
        careGoal: "understand-trend",
        supportNow: "self",
        redFlags: [],
        specialistFocus: "kidney",
        specialistLens: "nephrology",
        lastMedicationTime: "Metformin and amlodipine taken today; losartan taken last night",
        riskModifiers: ["type-2-diabetes", "ckd-stage-3a", "persistent-high-bp"],
        wellnessProfile: {
          fasting: "not fasting at afternoon check",
          hydration: "about 5 cups water daily",
          meals: "late dinners 3 days this week"
        },
        visitProfile: {
          pendingVisit: "Primary-care review next week",
          pendingTests: "Repeat BMP and urine albumin/creatinine ratio",
          priorComparison: "2026-06-20 report available"
        }
      },
      reportText: "Patient: Naveed Ahamed\nReport date: 2026-07-09\nCreatinine 1.6 mg/dL (0.6-1.3)\neGFR 48 mL/min/1.73m2 (>60)\nPotassium 5.2 mmol/L (3.5-5.1)\nUrine albumin/creatinine ratio 64 mg/g (<30)\nHbA1c 7.9 % (4.5-5.6)\nLDL cholesterol 142 mg/dL (<100)\nPrior 2026-06-20: Creatinine 1.1 mg/dL, eGFR 78, HbA1c 8.2 %, LDL 160."
    }
  },
  {
    id: "insurance-prior-auth-packet",
    payload: {
      patientId,
      interfaceName: "insurance",
      tab: "insurance",
      agentRoute: "INSURANCE_AGENT",
      preferredAgent: "INSURANCE_AGENT",
      message: "My cardiology stress echo prior authorization needs clinical notes, abnormal labs, and a referral. Help me prepare the packet and missing documents.",
      profile,
      vitals: {
        systolic: 158,
        diastolic: 96,
        heartRate: 88
      },
      context: {
        duration: "this week",
        severity: 2,
        careGoal: "insurance-prep",
        supportNow: "with-family",
        redFlags: [],
        specialistFocus: "cardiology",
        specialistLens: "full-review",
        lastMedicationTime: "Current medicine list verified this morning",
        riskModifiers: ["ckd-stage-3a", "type-2-diabetes", "abnormal-kidney-report", "cardiology-referral"],
        wellnessProfile: {
          workImpact: "needs quick approval before travel",
          stress: "moderate due to deadline"
        },
        visitProfile: {
          requestedService: "Stress echocardiogram",
          referralDate: "2026-07-09",
          submissionDeadline: "2026-07-16",
          missingDocs: "payer form, CPT code, facility tax ID"
        }
      },
      reportText: "Prior authorization request\nService: Stress echocardiogram\nReason: exertional breathlessness, ankle swelling, uncontrolled blood pressure, diabetes, chronic kidney disease.\nDocuments attached: referral note, BP log, kidney panel, lipid report.\nMissing: payer form copy, ordering code confirmation, facility tax ID.\nSubmit before 2026-07-16."
    }
  }
];

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function mergeRecords(existingRecords = [], nextRecords = []) {
  const merged = new Map();

  for (const record of nextRecords) {
    merged.set(record.id, record);
  }

  for (const record of existingRecords) {
    if (!merged.has(record.id)) {
      merged.set(record.id, record);
    }
  }

  return [...merged.values()];
}

async function startServer() {
  const server = createServerApp();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine temporary server port.");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function stopServer(server) {
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

async function postAnalyze(baseUrl, payload) {
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();

  if (!response.ok || !result?.ok) {
    throw new Error(result?.message || `Analyze request failed with status ${response.status}.`);
  }

  return result;
}

function summarizeMemoryEntry(entry = {}) {
  return {
    message: String(entry.message || "").slice(0, 120),
    risk: entry.risk || "",
    route: Array.isArray(entry.routes) ? entry.routes[0] : "",
    specialistFocus: entry.specialistFocus || entry.context?.specialistFocus || "",
    documentType: entry.documentType || "",
    triageLevel: entry.triageLevel || "",
    evidenceTitles: Array.isArray(entry.evidenceTitles) ? entry.evidenceTitles.slice(0, 2) : []
  };
}

async function main() {
  const existingRecords = await loadPatientDataRecords(patientId);
  const mergedRecords = mergeRecords(existingRecords.records || [], seededRecords);

  await savePatientDataRecords({
    patientId,
    records: mergedRecords,
    selectedRecordId: existingRecords.selectedRecordId || "record-insurance-prior-auth-stress-echo-20260709"
  });

  const memoryBefore = await loadPatientMemory(patientId);
  const existingMessages = new Set((memoryBefore.history || []).map((entry) => normalizeText(entry.message)));
  const { server, baseUrl } = await startServer();
  const seededAnalyses = [];

  try {
    for (const scenario of scenarios) {
      if (existingMessages.has(normalizeText(scenario.payload.message))) {
        seededAnalyses.push({
          id: scenario.id,
          status: "skipped-existing-memory"
        });
        continue;
      }

      const result = await postAnalyze(baseUrl, scenario.payload);
      seededAnalyses.push({
        id: scenario.id,
        status: "saved",
        risk: result.risk?.level || "",
        route: result.finalResponse?.responseFocus?.primaryRoute || "",
        triageRoute: result.safetyTriage?.recommendedRoute || "",
        documentType: result.multimodalIntake?.documentType?.label || result.multimodalIntake?.documentType?.id || "",
        evidenceTitles: Array.isArray(result.evidenceCitations?.items)
          ? result.evidenceCitations.items.slice(0, 2).map((item) => item?.title || item?.label).filter(Boolean)
          : []
      });
    }
  } finally {
    await stopServer(server);
  }

  const memoryAfter = await loadPatientMemory(patientId);
  const graphAfter = await loadPatientKnowledgeGraph(patientId);
  const recordsAfter = await loadPatientDataRecords(patientId);
  const typeCounts = graphAfter.stats?.typeCounts || {};

  console.log(JSON.stringify({
    patientId,
    recordCount: Number(recordsAfter.recordCount || 0),
    memoryTurnCount: Array.isArray(memoryAfter.history) ? memoryAfter.history.length : 0,
    graphFactCount: Number(graphAfter.factCount || 0),
    seededRecordIds: seededRecords.map((record) => record.id),
    seededAnalyses,
    recentMemory: (memoryAfter.history || []).slice(0, 4).map(summarizeMemoryEntry),
    relevantGraphTypes: {
      specialistFocus: Number(typeCounts.specialistFocus || 0),
      specialistLens: Number(typeCounts.specialistLens || 0),
      riskModifier: Number(typeCounts.riskModifier || 0),
      wellness: Number(typeCounts.wellness || 0),
      visit: Number(typeCounts.visit || 0),
      triageRoute: Number(typeCounts.triageRoute || 0),
      documentType: Number(typeCounts.documentType || 0),
      documentMarker: Number(typeCounts.documentMarker || 0),
      evidenceTitle: Number(typeCounts.evidenceTitle || 0)
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
