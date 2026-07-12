#!/usr/bin/env node
import assert from "node:assert/strict";

import { analyzeHealthQuery } from "../src/healthEngine.js";

const profile = {
  name: "Naveed",
  age: "52",
  conditions: "Hypertension, Type 2 diabetes",
  medications: "Amlodipine, Metformin",
  allergies: "None",
  baselineBp: "130/85"
};

const cases = [
  {
    id: "amlodipine_dizziness",
    input: {
      patientId: `eval-amlodipine-${Date.now()}`,
      interfaceName: "medications",
      singleAgentMode: true,
      preferredAgent: "PHARMACY_AGENT",
      message: "I take amlodipine and feel dizzy when I stand up. What should I watch for?",
      profile: { medications: ["Amlodipine"] },
      vitals: { systolic: "118", diastolic: "72" }
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "PHARMACY_AGENT");
      const references = result.agentResults.find((agent) => agent.id === "PHARMACY_AGENT")?.output?.references || [];
      assert.ok(references.some((item) => /amlodipine/i.test(item.title || "")));
    }
  },
  {
    id: "advisor_route_pharmacy_standing_dizziness",
    input: {
      patientId: `eval-advisor-pharmacy-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: "deep",
      message: "I take amlodipine and feel dizzy when I stand up. What should I watch for?",
      profile: {
        age: "52",
        conditions: ["Hypertension"],
        medications: ["Amlodipine"]
      },
      vitals: {
        systolic: "118",
        diastolic: "72"
      },
      context: {
        duration: "same-day",
        severity: "3",
        careGoal: "understand",
        redFlags: []
      }
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "PHARMACY_AGENT");
      const references = result.agentResults.find((agent) => agent.id === "PHARMACY_AGENT")?.output?.references || [];
      assert.ok(/amlodipine/i.test(references[0]?.title || ""));
    }
  },
  {
    id: "losartan_ibuprofen",
    input: {
      patientId: `eval-losartan-${Date.now()}`,
      interfaceName: "medications",
      singleAgentMode: true,
      preferredAgent: "PHARMACY_AGENT",
      message: "I missed losartan and used ibuprofen today. What should I watch for?",
      profile: { medications: ["Losartan"] },
      vitals: { systolic: "146", diastolic: "92" }
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "PHARMACY_AGENT");
      const references = result.agentResults.find((agent) => agent.id === "PHARMACY_AGENT")?.output?.references || [];
      assert.ok(references.some((item) => /losartan/i.test(item.title || "")));
    }
  },
  {
    id: "metformin_stomach",
    input: {
      patientId: `eval-metformin-${Date.now()}`,
      interfaceName: "medications",
      singleAgentMode: true,
      preferredAgent: "PHARMACY_AGENT",
      message: "Metformin is upsetting my stomach and I have diarrhea. What should I watch for?",
      profile: { medications: ["Metformin"] },
      vitals: {}
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "PHARMACY_AGENT");
      const references = result.agentResults.find((agent) => agent.id === "PHARMACY_AGENT")?.output?.references || [];
      assert.ok(references.some((item) => /metformin/i.test(item.title || "")));
    }
  },
  {
    id: "wellness_owner",
    input: {
      patientId: `eval-wellness-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      message: "I feel stressed, anxious, and cannot sleep well.",
      profile: {},
      vitals: {}
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "WELLNESS_AGENT");
      assert.ok(
        Array.isArray(result.finalResponse?.supportSections)
          && result.finalResponse.supportSections.some((section) => /support plan|safety notes/i.test(section.title || ""))
      );
    }
  },
  {
    id: "general_sparse_clarification",
    input: {
      patientId: `eval-general-sparse-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: "deep",
      message: "I feel tired and dizzy sometimes. What should I do?",
      profile: {
        age: "52",
        conditions: ["Hypertension", "Type 2 diabetes"],
        medications: ["Amlodipine", "Metformin"]
      },
      vitals: {},
      context: {
        duration: "not-sure",
        severity: "0",
        careGoal: "understand",
        redFlags: []
      }
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "RAG_AGENT");
      assert.equal(result.finalResponse?.brain?.askOneQuestionIfNeeded, true);
      assert.ok(
        Array.isArray(result.finalResponse?.precision?.missing)
          && result.finalResponse.precision.missing.some((item) => /when it started|reading|severity/i.test(item)),
        "Expected sparse general review to surface a useful missing-context prompt."
      );
      assert.ok((result.finalResponse?.precision?.score || 0) < 90);
    }
  },
  {
    id: "general_mixed_profile_crosscheck",
    input: {
      patientId: `eval-general-crosscheck-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: "deep",
      message: "I feel tired and dizzy sometimes. What should I do?",
      profile: {
        age: "52",
        conditions: ["Hypertension", "Type 2 diabetes"],
        medications: ["Amlodipine", "Metformin"]
      },
      vitals: {},
      context: {
        duration: "not-sure",
        severity: "3",
        careGoal: "understand",
        redFlags: []
      }
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "RAG_AGENT");
      const ragOutput = result.agentResults.find((agent) => agent.id === "RAG_AGENT")?.output || {};
      assert.ok(
        Array.isArray(ragOutput.concernProfile?.supportiveFamilies)
          && ragOutput.concernProfile.supportiveFamilies.some((item) => item.id === "metabolic"),
        "Expected mixed dizziness-fatigue general review to preserve metabolic cross-check context when diabetes is already in profile."
      );
      assert.ok(
        Array.isArray(result.finalResponse?.whatToDoNow)
          && result.finalResponse.whatToDoNow.some((item) => /glucose|sugar|hydration|meal timing/i.test(item)),
        "Expected mixed dizziness-fatigue general review to surface a glucose or hydration cross-check action."
      );
    }
  },
  {
    id: "mixed_support_routing",
    input: {
      patientId: `eval-mixed-support-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      message: "I missed my blood pressure medicine yesterday, BP is 158/98, and I want diet and sleep advice too.",
      profile,
      vitals: { systolic: "158", diastolic: "98" }
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "PHARMACY_AGENT");
      const activeRoutes = Array.isArray(result.agentResults) ? result.agentResults.map((agent) => agent.id) : [];
      const lifestyleSection = Array.isArray(result.finalResponse?.supportSections)
        ? result.finalResponse.supportSections.find((section) => section.id === "support-lifestyle")
        : null;
      assert.ok(activeRoutes.includes("VITALS_AGENT"));
      assert.ok(!activeRoutes.includes("LIFESTYLE_AGENT"));
      assert.ok(
        Array.isArray(lifestyleSection?.items)
          && lifestyleSection.items.some((item) => /diet|meal|protein|fiber|sleep|wake time|wind-down/i.test(item)),
        "Expected mixed-support output to preserve explicit diet or sleep guidance even when lifestyle is not kept as an active route."
      );
      assert.ok(
        Array.isArray(result.finalResponse?.whatToDoNow)
          && result.finalResponse.whatToDoNow.some((item) => /repeat unusual readings|same device|correct technique|resting|trend/i.test(item))
          && result.finalResponse.whatToDoNow.some((item) => /diet|meal|protein|fiber|sleep|wake time|wind-down/i.test(item)),
        "Expected mixed-support output to surface both a BP recheck/trend action and a diet or sleep action in the main next-step list."
      );
    }
  },
  {
    id: "pharmacy_profile_family_inference",
    input: {
      patientId: `eval-pharmacy-family-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: "deep",
      message: "I missed my blood pressure medicine yesterday and now my BP is 158/98. What should I do?",
      profile,
      vitals: { systolic: "158", diastolic: "98" },
      context: {
        duration: "same-day",
        severity: "4",
        careGoal: "understand",
        redFlags: []
      }
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "PHARMACY_AGENT");
      assert.ok(!result.llmBrain?.taskProfile?.missingCriticalFields?.includes("the medicine name"));
      assert.ok(
        !Array.isArray(result.finalResponse?.precision?.missing)
          || !result.finalResponse.precision.missing.some((item) => /medicine name/i.test(item)),
        "Expected profile-aware medicine inference to avoid asking for the medicine name again."
      );
    }
  },
  {
    id: "quick_bp_overview",
    input: {
      patientId: `eval-quick-bp-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: { id: "quick", label: "Quick" },
      message: "My BP is 154/96, I feel dizzy and have headache. What should I do?",
      profile,
      vitals: {}
    },
    check(result) {
      const overview = Array.isArray(result.finalResponse?.supportSections)
        ? result.finalResponse.supportSections.find((section) => section.id === "overview")
        : null;
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "RAG_AGENT");
      assert.ok(Array.isArray(overview?.items) && overview.items.some((item) => /Blood Pressure Review/i.test(item)));
    }
  },
  {
    id: "specialist_kidney",
    input: {
      patientId: `eval-kidney-${Date.now()}`,
      interfaceName: "specialist",
      singleAgentMode: true,
      preferredAgent: "SPECIALIST_DOCTOR_AGENT",
      message: "Specialist doctor review - kidney and urine health: creatinine 1.6, eGFR 48, I took ibuprofen, what should kidney specialist focus on and what tests matter next?",
      profile: { medications: ["Ibuprofen"] },
      context: {
        specialistFocus: "kidney",
        specialistLens: "tests",
        duration: "more-than-3-days",
        severity: "4",
        careGoal: "follow-up",
        redFlags: []
      },
      vitals: {}
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT");
      const specialistOutput = result.agentResults.find((agent) => agent.id === "SPECIALIST_DOCTOR_AGENT")?.output || {};
      const references = specialistOutput.references || [];
      const fusion = specialistOutput.specialistProfile?.dataFusion || {};
      assert.ok(references.some((item) => /kidney|nephrology|creatinine|egfr/i.test(item.title || "")));
      assert.ok(/kidney|nephrology/i.test(references[0]?.title || ""));
      assert.ok(/kidney|urine/i.test(fusion.queryFamilies?.[0] || ""), "kidney specialist fusion should stay kidney-anchored");
      assert.ok(/kidney|urine/i.test(fusion.summary || ""), "kidney specialist fusion summary should stay kidney-focused");
    }
  },
  {
    id: "urgent_chest",
    input: {
      patientId: `eval-urgent-chest-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      message: "I have chest pressure with sweating and shortness of breath right now.",
      profile,
      vitals: { heartRate: "122" }
    },
    check(result) {
      const routes = Array.isArray(result.plan?.execute) ? result.plan.execute : [];
      assert.ok(routes.includes("ALERT_AGENT"));
      assert.equal(result.risk?.level, "CRITICAL");
    }
  },
  {
    id: "wellness_crisis_frame",
    input: {
      patientId: `eval-wellness-crisis-${Date.now()}`,
      interfaceName: "wellness",
      singleAgentMode: true,
      preferredAgent: "WELLNESS_AGENT",
      answerMode: "quick",
      message: "I feel unsafe and want to hurt myself tonight.",
      profile: {},
      vitals: {},
      context: {
        duration: "same-day",
        severity: "9",
        careGoal: "urgency",
        redFlags: []
      }
    },
    check(result) {
      const routes = Array.isArray(result.plan?.execute) ? result.plan.execute : [];
      const warnings = Array.isArray(result.finalResponse?.warningSigns) ? result.finalResponse.warningSigns.join(" | ") : "";
      const steps = Array.isArray(result.finalResponse?.whatToDoNow) ? result.finalResponse.whatToDoNow.join(" | ") : "";
      const alertOutput = result.agentResults.find((agent) => agent.id === "ALERT_AGENT")?.output || {};
      const alertSummary = `${alertOutput.patientAnswerSummary || ""} ${alertOutput.summary || ""}`;

      assert.ok(routes.includes("ALERT_AGENT"));
      assert.ok(/unsafe|self-harm|stay safe|real-world support/i.test(warnings));
      assert.ok(/trusted person|stay with|stay alone|harm yourself|crisis support|real-world support|emergency support|immediate help/i.test(steps));
      assert.ok(!/readings that stay very high|new chest pain/i.test(warnings));
      assert.ok(/mental|unsafe|self-harm|stay safe/i.test(alertSummary));
    }
  },
  {
    id: "child_fever",
    input: {
      patientId: `eval-child-fever-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      message: "My child has fever, is not drinking well, and is breathing fast.",
      profile: {},
      vitals: {}
    },
    check(result) {
      const routes = Array.isArray(result.plan?.execute) ? result.plan.execute : [];
      assert.ok(routes.includes("ALERT_AGENT") || result.finalResponse?.responseFocus?.primaryRoute === "ALERT_AGENT");
      assert.ok(["HIGH", "CRITICAL"].includes(result.risk?.level));
    }
  },
  {
    id: "broad_symptom_clarification",
    input: {
      patientId: `eval-broad-symptom-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      message: "I have pain and fever.",
      profile: {},
      vitals: {}
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "RAG_AGENT");
      assert.equal(result.finalResponse?.brain?.askOneQuestionIfNeeded, true);
      assert.ok(Number(result.medicalKnowledge?.localAi?.rankingDiagnostics?.ambiguityPenalty || 0) >= 10);
      assert.ok(
        /before narrowing this further|add when it started|when it started.*sharper answer/i.test(result.finalResponse?.whatToDoNow?.[0] || "")
      );
    }
  },
  {
    id: "trend_review_missing_reading_clarification",
    input: {
      patientId: `eval-trend-clarify-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: "deep",
      message: "Compare my blood pressure trend and tell me what changed.",
      profile: {},
      vitals: {},
      context: {
        duration: "not-sure",
        severity: "3",
        careGoal: "follow-up",
        redFlags: []
      }
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "VITALS_AGENT");
      assert.ok(/current reading|when was it taken/i.test(result.finalResponse?.whatToDoNow?.[0] || ""));
      assert.ok(!/trend review was requested without current structured data/i.test(result.finalResponse?.whatToDoNow?.[0] || ""));
      assert.ok(/current reading|when was it taken/i.test(result.reasoningQuality?.improvement || ""));
    }
  },
  {
    id: "specialist_followup_conflict_clarification",
    input: {
      patientId: `eval-specialist-followup-conflict-${Date.now()}`,
      interfaceName: "specialist",
      singleAgentMode: true,
      preferredAgent: "SPECIALIST_DOCTOR_AGENT",
      answerMode: "deep",
      message: "Specialist doctor review - kidney health: this is my first time with a brand new symptom but also a follow-up.",
      profile: {},
      vitals: {},
      context: {
        specialistFocus: "kidney",
        specialistLens: "full-review",
        duration: "same-day",
        severity: "4",
        careGoal: "follow-up",
        redFlags: []
      }
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT");
      assert.ok(/first-time symptom|follow-up/i.test(result.finalResponse?.whatToDoNow?.[0] || ""));
      assert.ok(!/follow-up wording is mixed with first-time symptom wording/i.test(result.finalResponse?.whatToDoNow?.[0] || ""));
      assert.ok(/first-time symptom|follow-up/i.test(result.reasoningQuality?.improvement || ""));
    }
  },
  {
    id: "specialist_sparse_precision_guard",
    input: {
      patientId: `eval-specialist-sparse-${Date.now()}`,
      interfaceName: "specialist",
      singleAgentMode: true,
      preferredAgent: "SPECIALIST_DOCTOR_AGENT",
      answerMode: "deep",
      message: "Specialist doctor review - heart and blood pressure: review my heart health",
      profile: {
        age: "52",
        conditions: ["Hypertension"]
      },
      vitals: {},
      context: {
        specialistFocus: "cardiology",
        specialistLens: "full-review",
        duration: "not-sure",
        severity: "4",
        careGoal: "understand",
        redFlags: []
      }
      },
      check(result) {
        assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT");
        assert.equal(result.finalResponse?.brain?.askOneQuestionIfNeeded, true);
        assert.ok((result.finalResponse?.precision?.score || 0) >= 76);
        assert.ok(/reading|lab|symptom|focus/i.test(result.finalResponse?.precision?.nextQuestion || ""));
        assert.ok(/reading|heart concern|focus/i.test(result.reasoningQuality?.improvement || ""), "specialist reasoning improvement should call out the missing owner-specific context");
      }
    },
  {
    id: "specialist_multidomain_clarification",
    input: {
      patientId: `eval-specialist-multidomain-${Date.now()}`,
      interfaceName: "specialist",
      singleAgentMode: true,
      preferredAgent: "SPECIALIST_DOCTOR_AGENT",
      answerMode: "deep",
      message: "Specialist doctor review - kidney and diabetes: creatinine 1.7, eGFR 45, sugar 230, I use metformin and ibuprofen, and I want to know what kidney specialist, diabetes doctor, and medicine review should focus on together.",
      profile: {
        conditions: ["Type 2 diabetes", "Hypertension"],
        medications: ["Metformin", "Ibuprofen"]
      },
      vitals: {},
      context: {
        specialistFocus: "kidney and diabetes",
        specialistLens: "full-review",
        duration: "not-sure",
        severity: "4",
        careGoal: "follow-up",
        redFlags: []
      }
      },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT");
      assert.ok((result.finalResponse?.precision?.score || 0) >= 80);
      const nextQuestion = result.finalResponse?.precision?.nextQuestion
        || result.llmBrain?.ambiguity?.nextQuestion
        || "";
      assert.ok(/prioritize first/i.test(nextQuestion));
      assert.ok(/kidney|glucose|medicine/i.test(nextQuestion));
      assert.ok(!/main symptom or disease area/i.test(nextQuestion));
    }
  },
  {
    id: "specialist_priority_lane_selection",
    input: {
      patientId: `eval-specialist-priority-${Date.now()}`,
      interfaceName: "specialist",
      singleAgentMode: true,
      preferredAgent: "SPECIALIST_DOCTOR_AGENT",
      answerMode: "deep",
      message: "Specialist doctor review - I have headaches, my blood sugar is high, and my BP is sometimes high too. Which specialist should I focus on first?",
      profile: {
        conditions: ["Type 2 diabetes", "Hypertension"],
        medications: ["Metformin", "Amlodipine"]
      },
      vitals: {},
      context: {
        duration: "not-sure",
        severity: "3",
        careGoal: "understand",
        redFlags: []
      }
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "SPECIALIST_DOCTOR_AGENT");
      const nextQuestion = result.finalResponse?.precision?.nextQuestion
        || result.llmBrain?.ambiguity?.nextQuestion
        || "";
      assert.ok(/prioritize first/i.test(nextQuestion));
      assert.ok(/bp|heart|glucose|headache|neurologic/i.test(nextQuestion));
      assert.ok(!/main symptom or disease area/i.test(nextQuestion));
    }
  },
  {
    id: "local_followup_pharmacy_context_avoids_reasking_medicine_name",
    input: {
      patientId: `eval-local-pharmacy-followup-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: "deep",
      message: "This is a follow-up from my last medicine issue. What should I watch for next?",
      profile: {
        age: "52"
      },
      context: {
        duration: "same-day",
        severity: "2",
        careGoal: "follow-up",
        redFlags: []
      },
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
          followUp: "Review medicine timing, dizziness, blood pressure log, and dehydration risk.",
          tags: ["medicine", "follow-up", "dizziness"]
        }]
      }
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "PHARMACY_AGENT");
      assert.equal(result.requirementProfile?.expectedRoute, "PHARMACY_AGENT");
      assert.equal(result.llmBrain?.taskProfile?.localContextAnchor, true);
      assert.ok(!result.llmBrain?.taskProfile?.missingCriticalFields?.includes("the medicine name"));
      assert.ok(
        !Array.isArray(result.finalResponse?.precision?.missing)
          || !result.finalResponse.precision.missing.some((item) => /medicine name/i.test(item)),
        "saved pharmacy follow-up should not ask for the medicine name again"
      );
    }
  },
  {
    id: "local_followup_vitals_route",
    input: {
      patientId: `eval-local-vitals-followup-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: "deep",
      message: "This is a follow-up from my blood pressure review. What should I track next?",
      context: {
        duration: "1-3 days",
        severity: "2",
        careGoal: "follow-up",
        redFlags: []
      },
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
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "VITALS_AGENT");
      assert.equal(result.requirementProfile?.expectedRoute, "VITALS_AGENT");
      assert.equal(result.llmBrain?.taskProfile?.localContextAnchor, true);
    }
  },
  {
    id: "local_followup_insurance_route",
    input: {
      patientId: `eval-local-insurance-followup-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: "deep",
      message: "This is a follow-up from the denied request. What should I do next?",
      context: {
        duration: "1-3 days",
        severity: "2",
        careGoal: "follow-up",
        redFlags: []
      },
      patientRecords: {
        selectedRecordId: "ins-1",
        records: [{
          id: "ins-1",
          type: "insurance-note",
          documentCategory: "claim-denial",
          documentName: "MRI claim denial",
          episode: "insurance appeal needed",
          notes: "Denied MRI claim due to coding mismatch and prior authorization issue.",
          followUp: "Collect EOB, denial letter, corrected code, provider note, and appeal deadline.",
          tags: ["insurance", "claim", "appeal", "denial"]
        }]
      }
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "INSURANCE_AGENT");
      assert.equal(result.requirementProfile?.expectedRoute, "INSURANCE_AGENT");
      assert.equal(result.llmBrain?.taskProfile?.localContextAnchor, true);
    }
  },
  {
    id: "local_followup_records_route",
    input: {
      patientId: `eval-local-records-followup-${Date.now()}`,
      interfaceName: "advisor",
      singleAgentMode: true,
      preferredAgent: "RAG_AGENT",
      answerMode: "deep",
      message: "This is a follow-up from the summary request. What should I prepare next?",
      context: {
        duration: "1-3 days",
        severity: "2",
        careGoal: "follow-up",
        redFlags: []
      },
      patientRecords: {
        selectedRecordId: "rec-1",
        records: [{
          id: "rec-1",
          type: "doctor-note",
          documentCategory: "share-summary",
          documentName: "Cardiology share-ready summary",
          episode: "doctor handoff packet",
          conditions: "Hypertension",
          medicines: "Amlodipine",
          followUp: "Update the share-ready note before the next visit.",
          tags: ["summary", "doctor note", "handoff"]
        }]
      }
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "RECORDS_AGENT");
      assert.equal(result.requirementProfile?.expectedRoute, "RECORDS_AGENT");
      assert.equal(result.llmBrain?.taskProfile?.localContextAnchor, true);
    }
  },
  {
    id: "memory_followup_reference_grounding",
    async run() {
      const patientId = `eval-direct-memory-${Date.now()}`;
      const profile = {
        name: "Naveed",
        age: "52",
        conditions: ["Hypertension"],
        medications: ["Amlodipine"]
      };

      const seededResult = await analyzeHealthQuery({
        patientId,
        message: "I have had headache since morning and my BP was 150/95.",
        profile,
        vitals: { systolic: 150, diastolic: 95 },
        context: {
          duration: "1-6 hours",
          severity: "4",
          careGoal: "understand",
          redFlags: []
        }
      });
      return analyzeHealthQuery({
        patientId,
        message: "Now I still feel dizzy. What changed and what should I watch for next?",
        profile,
        vitals: {},
        conversationHistory: [{
          message: "I have had headache since morning and my BP was 150/95.",
          risk: seededResult.risk?.level,
          vitals: { systolic: 150, diastolic: 95 },
          context: {
            duration: "1-6 hours",
            severity: "4",
            careGoal: "understand",
            redFlags: []
          },
          profile
        }]
      });
    },
    check(result) {
      assert.equal(result.finalResponse?.responseFocus?.primaryRoute, "RAG_AGENT");
      assert.ok(Number(result.memoryContext?.recentTurnCount || 0) >= 1);
      const references = result.agentResults.find((agent) => agent.id === "RAG_AGENT")?.output?.references || [];
      assert.ok(references.some((item) => /blood pressure|headache|dizziness/i.test(item.title || "")));
      assert.ok(!references.some((item) => /constipation|fiber|bowel/i.test(item.title || "")));
    }
  }
];

let passed = 0;
const failures = [];

for (const testCase of cases) {
  try {
    const result = testCase.run
      ? await testCase.run()
      : await analyzeHealthQuery(testCase.input);
    testCase.check(result);
    passed += 1;
    console.log(`PASS ${testCase.id}`);
  } catch (error) {
    failures.push({
      id: testCase.id,
      message: error instanceof Error ? error.message : String(error)
    });
    console.error(`FAIL ${testCase.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`Clinical eval summary: ${passed}/${cases.length} passed.`);

if (failures.length) {
  process.exitCode = 1;
}
