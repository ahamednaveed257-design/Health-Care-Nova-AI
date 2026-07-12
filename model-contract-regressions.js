import assert from "node:assert/strict";
import { analyzeHealthQuery } from "../src/healthEngine.js";
import { rankLocalMedicalKnowledge } from "../src/localAiEngine.js";
import { getOfflineKnowledgeDatabase } from "../src/offlineMedicalDatabase.js";
import { getTrainingCalibration, scoreTrainingCalibrationRoutes } from "../src/trainingEngine.js";

const cases = [
  {
    name: "vitals concern contract",
    payload: {
      patientId: "contract-vitals",
      message: "My blood pressure is 168/102 and pulse 108. What should I do?",
      interfaceName: "vitals",
      singleAgentMode: true,
      preferredAgent: "VITALS_AGENT",
      answerMode: "deep",
      vitals: {
        systolic: "168",
        diastolic: "102",
        heartRate: "108"
      },
      context: {
        duration: "same-day",
        severity: "4",
        careGoal: "understand",
        redFlags: []
      }
    },
    verify(result, output) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "VITALS_AGENT");
      assert.ok(output.concernProfile, "vitals concern profile missing");
      assert.ok((result.finalResponse?.precision?.evidenceLanes || []).length >= 3, "vitals evidence lanes missing");
      assert.ok(!/Add Add/i.test(result.finalResponse?.precision?.nextQuestion || ""), "vitals next question duplicated Add");
      assert.ok(!/^Detailed review of|^Quick answer for/.test(result.finalResponse?.summary || ""), "vitals summary fell back to generic wording");
    }
  },
  {
    name: "pharmacy concern contract",
    payload: {
      patientId: "contract-pharmacy",
      message: "I missed my amlodipine dose and feel dizzy. What is the safe next step?",
      interfaceName: "medicine",
      singleAgentMode: true,
      preferredAgent: "PHARMACY_AGENT",
      answerMode: "deep",
      profile: {
        medications: ["Amlodipine"],
        conditions: ["Hypertension"]
      },
      context: {
        duration: "same-day",
        severity: "4",
        careGoal: "medicine-safety",
        redFlags: []
      }
    },
    verify(result, output) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "PHARMACY_AGENT");
      assert.ok(output.concernProfile, "pharmacy concern profile missing");
      assert.ok((result.finalResponse?.precision?.evidenceLanes || []).length >= 3, "pharmacy evidence lanes missing");
      assert.ok(!/Add Add/i.test(result.finalResponse?.precision?.nextQuestion || ""), "pharmacy next question duplicated Add");
      assert.equal(
        new Set((output.medicineSignals || []).map((item) => String(item).toLowerCase())).size,
        (output.medicineSignals || []).length,
        "pharmacy medicine signals should be case-insensitively unique"
      );
      assert.ok(!/^Detailed review of|^Quick answer for/.test(result.finalResponse?.summary || ""), "pharmacy summary fell back to generic wording");
    }
  },
  {
    name: "pharmacy missed-dose follow-up stays timing-first",
    payload: {
      patientId: "contract-pharmacy-missed-dose",
      message: "I forgot my amlodipine and now my blood pressure is 150/95 with a headache. Should I double the next dose?",
      interfaceName: "medicine",
      singleAgentMode: true,
      preferredAgent: "PHARMACY_AGENT",
      answerMode: "deep",
      profile: {
        medications: ["Amlodipine"],
        conditions: ["Hypertension"]
      },
      context: {
        duration: "same-day",
        severity: "4",
        careGoal: "medicine-safety",
        redFlags: []
      }
    },
    verify(result, output) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "PHARMACY_AGENT");
      assert.ok(output.concernProfile, "pharmacy missed-dose concern profile missing");
      assert.ok(
        !/(allergy history|strength or form from label)/i.test((result.finalResponse?.precision?.missing || []).join(" | ")),
        "pharmacy missed-dose follow-up should not lead with broad allergy or strength requests"
      );
      assert.ok(
        /last-taken time|scheduled label timing/i.test(result.finalResponse?.precision?.nextQuestion || ""),
        "pharmacy missed-dose follow-up should ask for timing-first clarification"
      );
      assert.ok(
        (result.finalResponse?.whatToDoNow || []).some((step) => /do not double/i.test(step)),
        "pharmacy missed-dose follow-up should preserve the no-doubling step"
      );
    }
  },
  {
    name: "offline memory relevance keeps older medicine context active",
    payload: {
      patientId: "contract-memory-focus",
      interfaceName: "advisor",
      answerMode: "deep",
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
      },
      conversationHistory: [
        {
          at: "2026-07-09T09:05:00.000Z",
          message: "I walked 4000 steps and otherwise feel okay today.",
          risk: "LOW",
          routes: ["WELLNESS_AGENT"],
          profile: {}
        },
        {
          at: "2026-07-09T09:04:00.000Z",
          message: "My appetite was normal today.",
          risk: "LOW",
          routes: ["RAG_AGENT"],
          profile: {}
        },
        {
          at: "2026-07-09T09:03:00.000Z",
          message: "I slept 5 hours last night.",
          risk: "LOW",
          routes: ["WELLNESS_AGENT"],
          profile: {}
        },
        {
          at: "2026-07-09T09:02:00.000Z",
          message: "I had mild dry skin earlier this week.",
          risk: "LOW",
          routes: ["RAG_AGENT"],
          profile: {}
        },
        {
          at: "2026-07-09T09:01:00.000Z",
          message: "I take amlodipine and feel dizzy when I stand up.",
          risk: "MEDIUM",
          routes: ["PHARMACY_AGENT"],
          intents: ["medication_safety"],
          profile: {
            conditions: ["Hypertension"],
            medications: ["Amlodipine"]
          },
          summary: "Review dizziness after taking amlodipine and standing up carefully.",
          signals: ["amlodipine", "standing dizziness", "high blood pressure"]
        }
      ]
    },
    verify(result) {
      assert.ok((result.memoryContext?.focusedTurnCount || 0) >= 1, "memory relevance contract should focus at least one prior turn");
      assert.ok(
        Array.isArray(result.memoryContext?.recentMessages)
          && result.memoryContext.recentMessages.some((item) => /amlodipine|dizzy when i stand up|standing dizziness/i.test(item)),
        "memory relevance contract should surface the older medicine-related turn in recentMessages"
      );
      assert.ok(
        Array.isArray(result.agentResults) && result.agentResults.some((agent) => agent.id === "PHARMACY_AGENT"),
        "memory relevance contract should keep the medication safety route active"
      );
      assert.ok(
        Array.isArray(result.finalResponse?.supportSections)
          && result.finalResponse.supportSections.some((section) => /medication context|precautions/i.test(section.title || "")),
        "memory relevance contract should carry the recalled medicine context into support sections"
      );
    }
  },
  {
    name: "lifestyle explicit-priority contract",
    payload: {
      patientId: "contract-lifestyle",
      message: "I need sleep, hydration, and routine improvement.",
      interfaceName: "lifestyle",
      singleAgentMode: true,
      preferredAgent: "LIFESTYLE_AGENT",
      answerMode: "deep",
      context: {
        duration: "more-than-3-days",
        severity: "3",
        careGoal: "wellness-plan",
        redFlags: [],
        wellnessProfile: {
          sleep: "poor",
          hydration: "low",
          activity: "low",
          stress: "medium"
        }
      }
    },
    verify(result, output) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "LIFESTYLE_AGENT");
      assert.ok(output.concernProfile, "lifestyle concern profile missing");
      assert.equal(output.priorityPillar, "Sleep", "lifestyle explicit query should prioritize sleep");
      assert.ok(/wake time|wind-down|caffeine|sleep/i.test((output.lifestyleActions || [])[0] || ""), "lifestyle first action should match sleep priority");
      assert.ok(!/^Detailed review of|^Quick answer for/.test(result.finalResponse?.summary || ""), "lifestyle summary fell back to generic wording");
    }
  },
  {
    name: "records concern contract",
    payload: {
      patientId: "contract-records",
      message: "Create a health summary I can share with my doctor.",
      interfaceName: "records",
      singleAgentMode: true,
      preferredAgent: "RECORDS_AGENT",
      answerMode: "deep",
      profile: {
        name: "Demo",
        age: "47",
        conditions: ["Hypertension"],
        medications: ["Amlodipine"]
      },
      context: {
        duration: "1-3 days",
        severity: "3",
        careGoal: "follow-up",
        redFlags: []
      }
    },
    verify(result, output) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "RECORDS_AGENT");
      assert.ok(output.concernProfile, "records concern profile missing");
      assert.ok((result.finalResponse?.precision?.evidenceLanes || []).length >= 3, "records evidence lanes missing");
      assert.ok(!/^Detailed review of|^Quick answer for|^Share-ready note for/.test(result.finalResponse?.summary || ""), "records summary fell back to generic wording");
    }
  },
  {
    name: "scheduling concern contract",
    payload: {
      patientId: "contract-scheduling",
      message: "Help me prepare a cardiology follow-up appointment for next week.",
      interfaceName: "appointments",
      singleAgentMode: true,
      preferredAgent: "SCHEDULING_AGENT",
      answerMode: "deep",
      context: {
        duration: "more-than-3-days",
        severity: "3",
        careGoal: "follow-up",
        redFlags: [],
        visitProfile: {
          department: "cardiology",
          type: "follow-up",
          dateWindow: "1-3-days",
          followupQuestion: "blood pressure follow-up",
          reason: "repeat BP review"
        }
      }
    },
    verify(result, output) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SCHEDULING_AGENT");
      assert.ok(output.concernProfile, "scheduling concern profile missing");
      assert.ok((result.finalResponse?.precision?.evidenceLanes || []).length >= 3, "scheduling evidence lanes missing");
      assert.ok(!/^Detailed review of|^Quick answer for/.test(result.finalResponse?.summary || ""), "scheduling summary fell back to generic wording");
    }
  },
  {
    name: "specialist sparse heart review stays focused",
    payload: {
      patientId: "contract-specialist-heart-sparse",
      message: "Specialist doctor review - heart and blood pressure: review my heart health",
      interfaceName: "specialist",
      singleAgentMode: true,
      preferredAgent: "SPECIALIST_DOCTOR_AGENT",
      answerMode: "deep",
      profile: {
        conditions: ["Hypertension"],
        medications: ["Amlodipine"]
      },
      context: {
        specialistFocus: "cardiology",
        specialistLens: "full-review",
        duration: "not-sure",
        severity: "4",
        careGoal: "understand",
        redFlags: []
      }
    },
    verify(result, output) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT");
      assert.ok(output.concernProfile, "specialist concern profile missing");
      assert.ok(
        /main heart goal|bp control|palpitations|chest symptoms|cholesterol risk|prevention/i.test((result.finalResponse?.whatToDoNow || [])[0] || ""),
        "specialist sparse heart review should start with a focused heart-goal action"
      );
      assert.ok(
        /main heart concern|bp control|palpitations|chest symptoms|cholesterol risk|prevention/i.test(result.finalResponse?.precision?.nextQuestion || ""),
        "specialist sparse heart review should ask for the main heart concern"
      );
    }
  },
  {
    name: "specialist current medicine list overrides stale local continuity",
    payload: {
      patientId: "contract-specialist-current-medicines",
      message: "I want a cardiology review of repeated high blood pressure, palpitations, diabetes, glucose 268, and what tests I should discuss. Current medicines: amlodipine, metformin, insulin.",
      interfaceName: "specialist",
      singleAgentMode: true,
      preferredAgent: "SPECIALIST_DOCTOR_AGENT",
      answerMode: "deep",
      profile: {
        conditions: ["Hypertension", "Type 2 diabetes"],
        medications: ["Amlodipine", "Metformin", "Insulin"]
      },
      context: {
        specialistFocus: "cardiology",
        specialistLens: "tests",
        duration: "more-than-3-days",
        severity: "5",
        careGoal: "follow-up",
        redFlags: []
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
      }
    },
    verify(result, output) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT");
      const qualityLanes = Array.isArray(output.specialistProfile?.qualityLanes) ? output.specialistProfile.qualityLanes : [];
      const evidenceLanes = Array.isArray(output.concernProfile?.evidenceLanes) ? output.concernProfile.evidenceLanes : [];
      const medicineLane = qualityLanes.find((lane) => String(lane?.label || "").toLowerCase() === "medicines");
      const supportLane = evidenceLanes.find((lane) => String(lane?.label || "").toLowerCase() === "medicine");

      assert.ok(medicineLane, "specialist current-medicine regression should expose the main medicine lane");
      assert.ok(supportLane, "specialist current-medicine regression should expose the support medicine lane");
      assert.ok(
        /amlodipine|metformin|insulin/i.test(String(medicineLane?.detail || "")),
        "specialist current-medicine regression should keep the explicit current medicines in the main specialist lane"
      );
      assert.ok(
        /amlodipine|metformin|insulin/i.test(String(supportLane?.detail || "")),
        "specialist current-medicine regression should keep the explicit current medicines in the support lane"
      );
      assert.doesNotMatch(
        String(medicineLane?.detail || ""),
        /losartan/i,
        "specialist current-medicine regression should not leak stale local losartan into the main specialist lane"
      );
      assert.doesNotMatch(
        String(supportLane?.detail || ""),
        /losartan/i,
        "specialist current-medicine regression should not leak stale local losartan into the support lane"
      );
    }
  },
  {
    name: "insurance coding denial appeal stays narrow",
    payload: {
      patientId: "contract-insurance-coding-denial",
      message: "My insurance denied an MRI claim from June 2 because the wrong code was used. What should I prepare for appeal?",
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
    verify(result, output) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "INSURANCE_AGENT");
      assert.ok(output.concernProfile, "insurance concern profile missing");
      assert.ok(
        (result.finalResponse?.whatToDoNow || []).some((step) => /exact code|corrected code|provider billing office/i.test(step)),
        "insurance coding-denial appeal should stay focused on code-specific packet steps"
      );
      assert.ok(
        /denial\/eob|exact code|wrong/i.test(result.finalResponse?.precision?.nextQuestion || ""),
        "insurance coding-denial appeal should ask for denial/EOB and exact code details"
      );
      assert.ok(
        Array.isArray(output.documentGaps?.required) && output.documentGaps.required.includes("code detail or corrected bill"),
        "insurance coding-denial appeal should require code detail or corrected bill"
      );
      assert.ok(
        !output.documentGaps?.missing?.includes("policy wording") && !output.documentGaps?.missing?.includes("reports"),
        "insurance coding-denial appeal should keep policy wording and reports as secondary, not first-order blockers"
      );
    }
  },
  {
    name: "mixed labs partial context stays specific",
    payload: {
      patientId: "contract-mixed-labs-partial",
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
    verify(result, output) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "LABS_AGENT");
      assert.ok(output.concernProfile, "labs concern profile missing");
      assert.ok(
        /reference range|report date/i.test(result.finalResponse?.precision?.nextQuestion || ""),
        "mixed labs partial-context review should ask for range/date first"
      );
      assert.ok(
        (result.finalResponse?.whatToDoNow || []).some((step) => /sugar control|kidney function|hydration|medicine review/i.test(step)),
        "mixed labs partial-context review should connect sugar and kidney follow-up logic"
      );
      assert.ok(
        (result.finalResponse?.precision?.score || 0) >= 74,
        "mixed labs partial-context review should get strong credit once quantified markers align into a coherent pattern"
      );
    }
  },
  {
    name: "quick ferritin query prefers labs specialist",
    payload: {
      patientId: "contract-ferritin-quick",
      message: "My ferritin is low. What does it mean?",
      interfaceName: "advisor",
      answerMode: "quick",
      context: {
        duration: "not-sure",
        severity: "2",
        careGoal: "understand",
        redFlags: []
      }
    },
    verify(result, output) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "LABS_AGENT");
      assert.ok(/ferritin|iron-store|iron store/i.test(result.finalResponse?.summary || ""), "quick ferritin summary should use lab-specific wording");
      assert.ok(/ferritin|reference range|exact value/i.test((result.finalResponse?.whatToDoNow || [])[0] || ""), "quick ferritin action should be lab-specific");
    }
  },
  {
    name: "missed BP dose keeps symptom-paired repeat step",
    payload: {
      patientId: "contract-missed-bp-dose",
      message: "I missed my BP tablet, now dizzy, BP 158 over 98, what should I do?",
      interfaceName: "advisor",
      answerMode: "quick",
      context: {
        duration: "same-day",
        severity: "5",
        careGoal: "next-step",
        redFlags: []
      }
    },
    verify(result, output) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "PHARMACY_AGENT");
      assert.ok(output.concernProfile, "pharmacy concern profile missing for missed BP dose");
      assert.ok(
        (result.finalResponse?.whatToDoNow || []).some((step) => /repeat the bp|same-day clinician review|headache or dizziness/i.test(step)),
        "missed BP dose quick response should keep a symptom-paired BP repeat step"
      );
    }
  }
];

const offlineRecords = getOfflineKnowledgeDatabase().records || [];
const trainingCalibration = await getTrainingCalibration();

const directChecks = [
  {
    name: "route calibration favors medicine over generic follow-up noise",
    run() {
      const scored = scoreTrainingCalibrationRoutes(
        "I take amlodipine and feel dizzy when I stand up. What should I watch for?",
        trainingCalibration
      ).rankedRoutes;

      assert.equal(scored[0]?.route, "PHARMACY_AGENT");
      assert.ok(
        Number(scored.find((item) => item.route === "PHARMACY_AGENT")?.score || 0)
          > Number(scored.find((item) => item.route === "SCHEDULING_AGENT")?.score || 0),
        "pharmacy route should outrank scheduling for standing dizziness on amlodipine"
      );
    }
  },
  {
    name: "kidney specialist evidence stays nephrology-first",
    run() {
      const ranked = rankLocalMedicalKnowledge({
        query: "kidney and urine health creatinine 1.6 egfr 48 ibuprofen what should kidney specialist focus on and what tests matter next",
        focusText: "kidney specialist focus tests matter next creatinine egfr ibuprofen",
        intents: [{ type: "SPECIALIST_DOCTOR", route: "SPECIALIST_DOCTOR_AGENT" }],
        routeCategories: new Set(["Specialist"]),
        primaryCategories: new Set(["Specialist"]),
        records: offlineRecords,
        maxMatches: 3
      });

      assert.ok(/kidney|nephrology/i.test(ranked.matches[0]?.title || ""));
      assert.ok(!/thyroid|stroke/i.test(ranked.matches[0]?.title || ""));
    }
  }
];

for (const directCheck of directChecks) {
  directCheck.run();
  console.log(`PASS ${directCheck.name}`);
}

for (const testCase of cases) {
  const result = await analyzeHealthQuery(testCase.payload);
  const route = result.finalResponse?.responseFocus?.primaryRoute;
  const output = (result.agentResults || []).find((agent) => agent.id === route)?.output || {};
  testCase.verify(result, output);
  console.log(`PASS ${testCase.name}`);
}

console.log("Model contract regressions passed.");
