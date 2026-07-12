import { getModelHealthStatus } from "./localAiEngine.js";
import { evaluateFinalResponseGuardrails, refreshEnhancedFinalResponse } from "./healthEngine.js";
import { getOpenSourceParticipationPlan } from "./hybridModelRouter.js";
import {
  ensureLocalRuntimeProbeFresh,
  getLocalRuntimeGenerationStatus,
  normalizeChatCompletionsEndpoint,
  recordLocalRuntimeGenerationFailure,
  recordLocalRuntimeGenerationSuccess,
  resolveRuntimeRequestTimeout
} from "./openSourceLocalRuntime.js";
import { getConnectivityPolicy, isEndpointUsableForThisRun } from "./runtimeConnectivity.js";

const DEFAULT_ASSIST_TIMEOUT_MS = 25000;
const DEFAULT_SUPPORT_AGENT_PACKET_LIMIT = 4;
const ROUTE_ACTION_KEYS = {
  RAG_AGENT: ["safeActions", "checklist"],
  SPECIALIST_DOCTOR_AGENT: ["specialistActions", "checklist"],
  VITALS_AGENT: ["vitalActions", "checklist"],
  PHARMACY_AGENT: ["pharmacyActions", "nextSafeSteps", "checklist"],
  LABS_AGENT: ["labActions", "checklist"],
  LIFESTYLE_AGENT: ["lifestyleActions", "checklist"],
  WELLNESS_AGENT: ["supportPlan"],
  RECORDS_AGENT: ["nextActions", "checklist"],
  INSURANCE_AGENT: ["checklist"],
  SCHEDULING_AGENT: ["visitActions", "checklist"],
  ALERT_AGENT: ["safetyActions", "checklist"],
  CARE_TRANSITIONS_AGENT: ["checklist"],
  CLAIMS_OPS_AGENT: ["checklist"],
  UTILIZATION_AGENT: ["checklist"],
  GXP_QUALITY_AGENT: ["checklist"],
  MEDTECH_COMPLIANCE_AGENT: ["checklist"]
};
const ROUTE_QUESTION_KEYS = {
  RAG_AGENT: ["focusQuestions"],
  SPECIALIST_DOCTOR_AGENT: ["doctorQuestions"],
  VITALS_AGENT: ["clinicianQuestions"],
  PHARMACY_AGENT: ["pharmacistQuestions"],
  LABS_AGENT: ["doctorQuestions"],
  LIFESTYLE_AGENT: ["clinicianQuestions"],
  INSURANCE_AGENT: ["benefitQuestions"]
};
const ROUTE_MISSING_KEYS = {
  RAG_AGENT: ["missingContext", "missing"],
  SPECIALIST_DOCTOR_AGENT: ["specialistProfile.missingContext", "missing"],
  VITALS_AGENT: ["accuracyGaps", "missing"],
  PHARMACY_AGENT: ["reviewGaps", "missing"],
  LABS_AGENT: ["accuracyGaps", "missing"],
  LIFESTYLE_AGENT: ["missing"],
  WELLNESS_AGENT: ["missing"],
  RECORDS_AGENT: ["missingFields"],
  INSURANCE_AGENT: ["documentGaps.missing", "missing"],
  SCHEDULING_AGENT: ["readinessGaps", "missing"],
  ALERT_AGENT: ["missing"],
  CARE_TRANSITIONS_AGENT: ["missingFields", "missing"],
  CLAIMS_OPS_AGENT: ["missingFields", "missing"],
  UTILIZATION_AGENT: ["missingFields", "missing"],
  GXP_QUALITY_AGENT: ["missingFields", "missing"],
  MEDTECH_COMPLIANCE_AGENT: ["missingFields", "missing"]
};

export function getLocalReasoningAssistStatus(env = process.env, input = {}, result = {}) {
  const connectivity = getConnectivityPolicy(env);
  const modelHealth = getModelHealthStatus(env);
  const ensemble = getOpenSourceParticipationPlan({
    ...input,
    preferredAgent: input.preferredAgent || result?.plan?.singleAgent?.route || result?.plan?.responseOwner?.route || result?.requirementProfile?.expectedRoute || ""
  }, env);
  const configuredParticipants = (ensemble.participants || [])
    .map((model, index) => ({
      id: model.id,
      provider: model.id,
      displayName: model.displayName,
      model: model.model,
      endpoint: normalizeChatCompletionsEndpoint(model.endpoint),
      endpointHost: model.endpoint ? safeHost(normalizeChatCompletionsEndpoint(model.endpoint)) : "",
      runtimeFamily: cleanText(model.runtimeFamily || ""),
      apiKey: model.apiKey || "",
      apiKeyHeader: model.apiKeyHeader || "",
      authScheme: model.authScheme || "Bearer",
      role: index === 0 ? "reasoner" : index === 1 ? "verifier" : "responder"
    }))
    .filter((candidate) => candidate.endpoint && candidate.model);
  const participants = [];
  const blockedParticipants = [];

  for (const candidate of configuredParticipants) {
    if (isEndpointUsableForThisRun(candidate.endpoint, env, { connectivity })) {
      participants.push(candidate);
    } else {
      blockedParticipants.push(candidate);
    }
  }

  const fallbackCandidate = buildFallbackCandidate(modelHealth);
  const fallbackConfigured = Boolean(fallbackCandidate && modelHealth.healthCheck?.available);
  const fallbackBlocked = Boolean(fallbackConfigured && !isEndpointUsableForThisRun(fallbackCandidate.endpoint, env, { connectivity }));
  const fallbackEligible = Boolean(fallbackConfigured && !fallbackBlocked);
  const primaryParticipant = participants[0] || null;
  const featureEnabled = readBooleanDefault(env.CARE_NOVA_LOCAL_REASONING_ASSIST_ENABLED, true);
  const enabled = featureEnabled && (participants.length > 0 || fallbackEligible);
  const generationCooldownActive = Boolean(modelHealth.healthCheck?.generationCooldownActive);
  const timeoutMs = clampInteger(
    env.CARE_NOVA_LOCAL_REASONING_ASSIST_TIMEOUT_MS,
    2000,
    120000,
    modelHealth.timeoutMs || DEFAULT_ASSIST_TIMEOUT_MS
  );
  const configured = enabled && Boolean(participants.length || fallbackEligible);
  const endpoint = primaryParticipant?.endpoint || (fallbackEligible ? fallbackCandidate.endpoint : "");
  const status = !featureEnabled
    ? "disabled"
    : configured
      ? "ready"
      : generationCooldownActive
        ? "local-runtime-cooldown"
      : blockedParticipants.length || fallbackBlocked
        ? "offline-policy-blocked"
        : "missing-configuration";

  return {
    enabled,
    configured,
    featureEnabled,
    policyBlocked: status === "offline-policy-blocked",
    provider: primaryParticipant?.provider || (fallbackEligible ? fallbackCandidate.provider : modelHealth.provider),
    displayName: primaryParticipant?.displayName || (fallbackEligible ? fallbackCandidate.displayName : modelHealth.displayName),
    model: primaryParticipant?.model || (fallbackEligible ? fallbackCandidate.model : modelHealth.model),
    runtimeFamily: primaryParticipant?.runtimeFamily || (fallbackEligible ? fallbackCandidate.runtimeFamily : modelHealth.runtimeFamily),
    endpoint,
    endpointHost: primaryParticipant?.endpointHost || (fallbackEligible ? fallbackCandidate.endpointHost : (endpoint ? safeHost(endpoint) : "")),
    timeoutMs,
    participants,
    participantCount: participants.length,
    blockedParticipants,
    blockedParticipantCount: blockedParticipants.length + (fallbackBlocked ? 1 : 0),
    fallbackCandidate: fallbackEligible ? fallbackCandidate : null,
    fallbackCandidateBlocked: fallbackBlocked,
    status,
    connectivity: {
      forceOffline: connectivity.forceOffline,
      internetAvailable: connectivity.internetAvailable
    },
    reasoningMode: "route-aware-open-source-local-second-pass",
    fallback: "deterministic-local-agent-output",
    reason: buildLocalReasoningStatusReason({
      featureEnabled,
      configured,
      participants,
      blockedParticipants,
      fallbackEligible,
      fallbackBlocked,
      generationCooldownActive,
      connectivity
    })
  };
}

export async function tryEnhanceAnalyzeResultWithLocalReasoning({ payload = {}, result = {}, env = process.env } = {}) {
  let status = getLocalReasoningAssistStatus(env, payload, result);

  if (status.featureEnabled && !status.configured && status.status !== "local-runtime-cooldown") {
    await ensureLocalRuntimeProbeFresh(env, { probeTimeoutMs: 700 }).catch(() => {});
    status = getLocalReasoningAssistStatus(env, payload, result);
  }

  const execution = {
    ...status,
    attempted: false,
    applied: false,
    fallbackUsed: true,
    verifierApplied: false,
    verifier: null,
    candidateSequence: [],
    error: ""
  };
  const llmRefinedRoute = Array.isArray(result?.agentResults)
    ? result.agentResults.find((agent) => agent?.output?.llmAgentAssist?.applied)
    : null;

  if (!status.enabled || !status.configured || !result?.finalResponse) {
    return execution;
  }

  if (llmRefinedRoute) {
    return {
      ...execution,
      attempted: false,
      applied: false,
      fallbackUsed: false,
      reason: `Skipped redundant second-pass reasoning because ${cleanText(llmRefinedRoute?.name || llmRefinedRoute?.id || "the owner route")} already received grounded local LLM refinement.`
    };
  }

  const generalQuickSkipReason = getQuickGeneralSecondPassSkipReason({ payload, result });

  if (generalQuickSkipReason) {
    return {
      ...execution,
      attempted: false,
      applied: false,
      fallbackUsed: false,
      reason: generalQuickSkipReason
    };
  }

  execution.attempted = true;

  try {
    const review = await requestLocalReasoningReview({ payload, result, status, env });
    const merged = mergeLocalReasoningReviewIntoResult(result, review.review, {
      ...review.candidate,
      verificationCandidate: review.verificationCandidate,
      candidateSequence: review.candidateSequence
    });
    const refreshedResult = {
      ...result,
      finalResponse: merged.finalResponse,
      agentResults: merged.agentResults
    };

    refreshEnhancedFinalResponse({ result: refreshedResult });
    const guardrails = evaluateFinalResponseGuardrails(refreshedResult.finalResponse);

    if (!guardrails.passed) {
      throw new Error("Open-source local reasoning assist failed local safety guardrails.");
    }

    result.finalResponse = refreshedResult.finalResponse;
    result.guardrails = guardrails;
    result.agentResults = refreshedResult.agentResults;
    execution.applied = true;
    execution.fallbackUsed = false;
    execution.provider = review.candidate?.displayName || execution.provider;
    execution.displayName = review.candidate?.displayName || execution.displayName;
    execution.model = review.candidate?.model || execution.model;
    execution.endpointHost = review.candidate?.endpointHost || execution.endpointHost;
    execution.verifierApplied = review.verificationApplied === true;
    execution.verifier = review.verificationCandidate
      ? {
        displayName: review.verificationCandidate.displayName,
        model: review.verificationCandidate.model,
        endpointHost: review.verificationCandidate.endpointHost
      }
      : null;
    execution.candidateSequence = Array.isArray(review.candidateSequence) ? review.candidateSequence : [];
    return execution;
  } catch (error) {
    execution.error = cleanText(error.message).slice(0, 240);

    if (result?.finalResponse) {
      result.finalResponse.localReasoningAssist = {
        enabled: true,
        attempted: true,
        applied: false,
        provider: status.displayName || status.provider,
        model: status.model,
        endpointHost: status.endpointHost,
        participants: status.participants.map((candidate) => ({
          role: candidate.role,
          displayName: candidate.displayName,
          model: candidate.model
        })),
        fallbackUsed: true,
        error: execution.error
      };
    }

    return execution;
  }
}

function getQuickGeneralSecondPassSkipReason({ payload = {}, result = {} } = {}) {
  const finalResponse = result?.finalResponse && typeof result.finalResponse === "object"
    ? result.finalResponse
    : {};
  const primaryRoute = cleanText(
    finalResponse?.responseFocus?.primaryRoute
      || result?.plan?.responseOwner?.route
      || result?.plan?.singleAgent?.route
      || result?.requirementProfile?.expectedRoute
      || payload?.preferredAgent
      || payload?.context?.preferredAgent
      || ""
  ).toUpperCase();
  const answerMode = cleanText(
    result?.requirementProfile?.answerMode?.id
      || finalResponse?.responseFocus?.requirement?.answerMode
      || payload?.answerMode?.id
      || payload?.answerMode
      || "quick"
  ).toLowerCase();
  const riskLevel = cleanText(result?.risk?.level || "").toUpperCase();
  const activeRoutes = Array.isArray(result?.plan?.execute)
    ? result.plan.execute.map((route) => cleanText(route).toUpperCase()).filter(Boolean)
    : [];

  if (primaryRoute !== "RAG_AGENT") {
    return "";
  }

  if (["DEEP", "HANDOFF"].includes(answerMode)) {
    return "";
  }

  if (["CRITICAL", "HIGH"].includes(riskLevel)) {
    return "";
  }

  if (riskLevel && riskLevel !== "LOW") {
    return "";
  }

  if (activeRoutes.some((route) => route && route !== "RAG_AGENT")) {
    return "";
  }

  return "Skipped second-pass local reasoning for a quick General route because the deterministic local RAG answer already owns the response and the extra pass only adds latency.";
}

async function requestLocalReasoningReview({ payload, result, status, env }) {
  const candidates = Array.isArray(status.participants) && status.participants.length
    ? status.participants
    : status.fallbackCandidate
      ? [status.fallbackCandidate]
      : [{
        provider: status.provider,
        displayName: status.displayName,
        model: status.model,
        endpoint: status.endpoint,
        endpointHost: status.endpointHost,
        runtimeFamily: status.runtimeFamily,
        role: "reasoner"
      }];
  const errors = [];
  const candidateSequence = [];
  let primaryReview = null;

  for (const candidate of candidates) {
    const runtimeHealth = getLocalRuntimeGenerationStatus(candidate.endpoint, env);

    if (candidate.endpoint && runtimeHealth.endpointIsLocal && !runtimeHealth.ready) {
      errors.push(
        `${candidate.displayName || candidate.provider || "local"}: recent local runtime failure cooldown is still active`
      );
      continue;
    }

    try {
      primaryReview = {
        review: await requestCandidateReview({
          candidate,
          payload,
          result,
          env,
          timeoutMs: status.timeoutMs
        }),
        candidate
      };
      candidateSequence.push(`${candidate.role || "reasoner"}:${candidate.displayName || candidate.provider || candidate.model || "local"}`);
      break;
    } catch (error) {
      errors.push(`${candidate.displayName || candidate.provider || "local"}: ${cleanText(error.message).slice(0, 160)}`);
    }
  }

  if (!primaryReview) {
    throw new Error(
      errors.length
        ? `Open-source local reasoning chain failed. ${errors.join(" | ")}`
        : "Open-source local reasoning chain is not configured."
    );
  }

  const verificationCandidate = selectVerificationCandidate(candidates, primaryReview.candidate);

  if (!verificationCandidate) {
    return {
      ...primaryReview,
      verificationApplied: false,
      verificationCandidate: null,
      candidateSequence
    };
  }

  try {
    const verifiedReview = await requestCandidateReview({
      candidate: verificationCandidate,
      payload,
      result,
      env,
      timeoutMs: status.timeoutMs,
      messages: buildVerificationMessages({
        payload,
        result,
        draftReview: primaryReview.review,
        primaryCandidate: primaryReview.candidate,
        verifierCandidate: verificationCandidate
      })
    });
    candidateSequence.push(`${verificationCandidate.role || "verifier"}:${verificationCandidate.displayName || verificationCandidate.provider || verificationCandidate.model || "local"}`);

    return {
      review: verifiedReview,
      candidate: primaryReview.candidate,
      verificationApplied: true,
      verificationCandidate,
      candidateSequence
    };
  } catch (error) {
    return {
      ...primaryReview,
      verificationApplied: false,
      verificationCandidate: null,
      candidateSequence
    };
  }
}

function buildFallbackCandidate(modelHealth = {}) {
  const endpoint = normalizeChatCompletionsEndpoint(modelHealth.endpoint);

  if (!endpoint || !modelHealth.model) {
    return null;
  }

  return {
    provider: modelHealth.provider,
    displayName: modelHealth.displayName,
    model: modelHealth.model,
    endpoint,
    endpointHost: safeHost(endpoint),
    runtimeFamily: cleanText(modelHealth.runtimeFamily || ""),
    apiKey: modelHealth.apiKey || "",
    apiKeyHeader: modelHealth.apiKeyHeader || "",
    authScheme: modelHealth.authScheme || "Bearer",
    role: "reasoner"
  };
}

async function requestCandidateReview({
  candidate = {},
  payload = {},
  result = {},
  env = process.env,
  timeoutMs = DEFAULT_ASSIST_TIMEOUT_MS,
  messages = null
} = {}) {
  const requestTimeoutMs = resolveRuntimeRequestTimeout(candidate.endpoint, timeoutMs, env);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const request = buildRuntimeRequest({ candidate, payload, result, env, messages });
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`${candidate.displayName} returned ${response.status}.`);
    }

    const json = await response.json();
    const text = extractResponseText(json);

    if (!text) {
      throw new Error(`${candidate.displayName} returned an empty response.`);
    }

    const parsed = parseJsonObject(text);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${candidate.displayName} did not return valid JSON.`);
    }

    recordLocalRuntimeGenerationSuccess(candidate.endpoint, {
      latencyMs: Date.now() - startedAt
    });
    return parsed;
  } catch (error) {
    recordLocalRuntimeGenerationFailure(candidate.endpoint, error, env, {
      latencyMs: Date.now() - startedAt
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function selectVerificationCandidate(candidates = [], primaryCandidate = {}) {
  const primaryId = cleanText(primaryCandidate?.id || primaryCandidate?.model || primaryCandidate?.endpoint);
  const alternatives = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => cleanText(candidate?.id || candidate?.model || candidate?.endpoint) !== primaryId);

  return alternatives.find((candidate) => candidate.role === "verifier")
    || alternatives.find((candidate) => candidate.role === "responder")
    || alternatives[0]
    || null;
}

function buildRuntimeRequest({ candidate = {}, payload = {}, result = {}, env = process.env, messages = null } = {}) {
  const effectiveMessages = Array.isArray(messages) && messages.length ? messages : buildMessages({ payload, result });
  const runtimeFamily = cleanText(candidate.runtimeFamily).toLowerCase();
  const useOllamaNative = runtimeFamily === "ollama-compatible"
    || /localhost:11434|127\.0\.0\.1:11434/i.test(cleanText(candidate.endpoint));

  if (useOllamaNative) {
    return {
      url: toOllamaChatEndpoint(candidate.endpoint),
      headers: buildHeaders(env, candidate),
      body: {
        model: candidate.model,
        stream: false,
        format: buildReviewJsonSchema(),
        messages: effectiveMessages
      }
    };
  }

  return {
    url: candidate.endpoint,
    headers: buildHeaders(env, candidate),
    body: {
      model: candidate.model,
      temperature: 0.1,
      max_tokens: 520,
      messages: effectiveMessages
    }
  };
}

function toOllamaChatEndpoint(endpoint) {
  try {
    const parsed = new URL(normalizeChatCompletionsEndpoint(endpoint));
    return `${parsed.origin}/api/chat`;
  } catch {
    return endpoint;
  }
}

function buildReviewJsonSchema() {
  return {
    type: "object",
    properties: {
      summary_upgrade: { type: "string" },
      step_additions: {
        type: "array",
        items: { type: "string" }
      },
      warning_additions: {
        type: "array",
        items: { type: "string" }
      },
      missing_question: { type: "string" },
      missing_context: {
        type: "array",
        items: { type: "string" }
      },
      evidence_focus: {
        type: "array",
        items: { type: "string" }
      },
      confidence_label: { type: "string" },
      support_route_updates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            route: { type: "string" },
            summary_upgrade: { type: "string" },
            patient_answer_summary: { type: "string" },
            action_additions: {
              type: "array",
              items: { type: "string" }
            },
            question_additions: {
              type: "array",
              items: { type: "string" }
            },
            missing_context: {
              type: "array",
              items: { type: "string" }
            },
            evidence_focus: {
              type: "array",
              items: { type: "string" }
            },
            confidence_label: { type: "string" }
          },
          required: ["route"],
          additionalProperties: false
        }
      }
    },
    required: [
      "summary_upgrade",
      "step_additions",
      "warning_additions",
      "missing_question",
      "missing_context",
      "evidence_focus",
      "confidence_label",
      "support_route_updates"
    ],
    additionalProperties: false
  };
}

function buildLocalReasoningStatusReason({
  featureEnabled,
  configured,
  participants = [],
  blockedParticipants = [],
  fallbackEligible,
  fallbackBlocked,
  generationCooldownActive,
  connectivity
} = {}) {
  if (!featureEnabled) {
    return "Local reasoning assist is disabled.";
  }

  if (configured) {
    const activeParticipants = participants.map((candidate) => candidate.displayName).filter(Boolean);
    const readyBase = activeParticipants.length > 1
      ? `Open-source local reasoning chain is ready with ${activeParticipants.join(", ")}.`
      : activeParticipants.length === 1
        ? `Open-source local reasoning assist is ready with ${activeParticipants[0]}.`
        : fallbackEligible
          ? "Primary local reasoning assist is ready on the configured local endpoint."
          : "Open-source local reasoning assist is ready.";

    return blockedParticipants.length || fallbackBlocked
      ? `${readyBase} Remote-only participants were skipped for this offline-safe run.`
      : readyBase;
  }

  if (blockedParticipants.length || fallbackBlocked) {
    return connectivity?.forceOffline
      ? "Remote local reasoning participants are blocked by offline policy."
      : "Remote local reasoning participants are unavailable because internet is unavailable.";
  }

  if (generationCooldownActive) {
    return "Local reasoning assist is paused because the local runtime recently timed out or returned an unusable response. Deterministic local guidance remains active during cooldown.";
  }

  return "Open-source local reasoning assist is missing endpoint or model configuration.";
}

function buildReasoningPacket({ payload = {}, result = {} }) {
  const finalResponse = result.finalResponse || {};
  const primaryRoute = cleanText(finalResponse?.responseFocus?.primaryRoute || result?.plan?.responseOwner?.route || "RAG_AGENT");
  const primaryAgent = Array.isArray(result.agentResults)
    ? result.agentResults.find((agent) => agent.id === primaryRoute) || result.agentResults[0]
    : null;
  const supportAgents = buildSupportAgentPacket(result.agentResults, primaryRoute, {
    risk: result?.risk,
    plan: result?.plan,
    limit: DEFAULT_SUPPORT_AGENT_PACKET_LIMIT
  });
  const profile = result.memoryContext?.profile || payload.profile || {};
  const latestVitals = result.memoryContext?.latestVitals || payload.vitals || {};
  const evidence = Array.isArray(result.medicalKnowledge?.matches)
    ? result.medicalKnowledge.matches.slice(0, 4).map((match) => ({
      title: cleanText(match.title).slice(0, 120),
      category: cleanText(match.category).slice(0, 60),
      summary: cleanText(match.summary).slice(0, 240),
      safetyNotes: cleanText(match.safetyNotes).slice(0, 180),
      relevance: Number(match.relevance || 0)
    }))
    : [];

  return {
    route: primaryRoute,
    risk: cleanText(result.risk?.label || result.risk?.level || "LOW"),
    answerMode: cleanText(result.requirementProfile?.answerMode?.id || finalResponse?.responseFocus?.requirement?.answerMode || "quick"),
    message: cleanText(payload.message || "").slice(0, 320),
    routing: {
      responseOwner: cleanText(result?.plan?.responseOwner?.route),
      singleAgent: cleanText(result?.plan?.singleAgent?.route),
      activeRoutes: Array.isArray(result?.plan?.execute) ? result.plan.execute.map((route) => cleanText(route)).filter(Boolean).slice(0, 5) : [],
      routeReasons: normalizeStringList(result?.plan?.routeReasons?.[primaryRoute], 4, 180),
      processingMode: cleanText(result?.modelRouting?.generatedUsing || result?.modelRouting?.processingType || "")
    },
    context: {
      vitals: normalizeVitalsPacket(latestVitals),
      profile: {
        age: cleanText(profile.age).slice(0, 24),
        gender: cleanText(profile.gender).slice(0, 40),
        conditions: normalizeStringList(toArray(profile.conditions), 4, 80),
        medications: normalizeStringList(toArray(profile.medications), 4, 80),
        allergies: normalizeStringList(toArray(profile.allergies), 4, 80)
      },
      memory: {
        recentTurns: Number(result.memoryContext?.recentTurnCount || 0),
        recentRisks: normalizeStringList(result.memoryContext?.recentRisks, 3, 40),
        recentMessages: normalizeStringList(result.memoryContext?.recentMessages, 2, 120)
      }
    },
    precision: {
      confidence: Number(finalResponse?.precision?.confidence || finalResponse?.precision?.score || 0),
      missing: normalizeStringList(finalResponse?.precision?.missing, 4, 160),
      confidenceLabel: cleanText(finalResponse?.precision?.confidenceLabel || finalResponse?.precision?.label || "")
    },
    retrieval: {
      coverageScore: Number(result.medicalKnowledge?.coverageScore || 0),
      evidenceCount: evidence.length,
      ambiguityPenalty: Number(result.medicalKnowledge?.localAi?.rankingDiagnostics?.ambiguityPenalty || 0),
      topMatchMargin: Number(result.medicalKnowledge?.localAi?.rankingDiagnostics?.topMatchMargin || 0),
      trainingHints: normalizeStringList(result.medicalKnowledge?.queryProfile?.trainingHints, 3, 160),
      trainingHintRoutes: normalizeStringList(result.medicalKnowledge?.queryProfile?.trainingHintRoutes, 3, 60),
      trainingSignalSources: normalizeStringList(result.medicalKnowledge?.queryProfile?.trainingSignalSources, 4, 40),
      weightedCategories: normalizeStringList(
        (result.medicalKnowledge?.queryProfile?.weightedCategories || [])
          .map((entry) => entry?.category && Number.isFinite(Number(entry?.score))
            ? `${entry.category} ${Math.round(Number(entry.score) * 100)}`
            : entry?.category),
        4,
        60
      )
    },
    learning: {
      trainingEnabled: Boolean(result.model?.cognitiveCore?.training?.enabled),
      exampleCount: Number(result.model?.cognitiveCore?.training?.exampleCount || 0),
      modelVersion: cleanText(result.model?.cognitiveCore?.training?.modelVersion || "")
    },
    evidence,
    primaryAgent: primaryAgent
      ? {
        id: primaryAgent.id,
        name: cleanText(primaryAgent.name),
        summary: cleanText(primaryAgent.output?.summary || "").slice(0, 360),
        patientAnswerSummary: cleanText(primaryAgent.output?.patientAnswerSummary || "").slice(0, 260),
        actions: collectAgentActionItems(primaryAgent.output || {}),
        questions: collectAgentQuestionItems(primaryRoute, primaryAgent.output || {}),
        checklist: normalizeStringList(primaryAgent.output?.checklist, 4, 180),
        missing: collectAgentMissingItems(primaryAgent.output || {})
      }
      : null,
    supportAgents,
    localAnswer: {
      title: cleanText(finalResponse.title).slice(0, 140),
      summary: cleanText(finalResponse.summary).slice(0, 520),
      steps: normalizeStringList(finalResponse.whatToDoNow, 4, 220),
      warnings: normalizeStringList(finalResponse.warningSigns, 4, 220),
      disclaimer: cleanText(finalResponse.disclaimer).slice(0, 200)
    }
  };
}

function buildVerificationMessages({
  payload = {},
  result = {},
  draftReview = {},
  primaryCandidate = {},
  verifierCandidate = {}
} = {}) {
  const packet = buildReasoningPacket({ payload, result });
  const compactDraft = {
    summary_upgrade: cleanText(draftReview.summary_upgrade || draftReview.summary || "").slice(0, 520),
    step_additions: normalizeStringList(draftReview.step_additions || draftReview.steps, 4, 220),
    warning_additions: normalizeStringList(draftReview.warning_additions || draftReview.warningSigns, 4, 220),
    missing_question: cleanText(draftReview.missing_question).slice(0, 220),
    missing_context: normalizeStringList(draftReview.missing_context || draftReview.missingContext, 4, 160),
    evidence_focus: normalizeStringList(draftReview.evidence_focus, 4, 180),
    confidence_label: cleanText(draftReview.confidence_label).slice(0, 80),
    support_route_updates: normalizeSupportRouteUpdates(draftReview.support_route_updates || draftReview.supportRouteUpdates)
  };

  return [
    {
      role: "system",
      content: [
        "You are the verification stage in a local healthcare reasoning chain.",
        "Review the grounded packet and the draft JSON from the first model.",
        "Keep only grounded improvements supported by the packet, evidence, vitals, memory, retrieval diagnostics, and agent outputs.",
        "Remove overreach, preserve uncertainty, and preserve urgent safety wording.",
        "Return the same strict JSON keys only:",
        "summary_upgrade, step_additions, warning_additions, missing_question, missing_context, evidence_focus, confidence_label, support_route_updates."
      ].join(" ")
    },
    {
      role: "user",
      content: `Verify and refine this grounded draft.\n${JSON.stringify({
        packet,
        draftReview: compactDraft,
        chain: {
          reasoner: primaryCandidate.displayName || primaryCandidate.provider || primaryCandidate.model || "local-reasoner",
          verifier: verifierCandidate.displayName || verifierCandidate.provider || verifierCandidate.model || "local-verifier"
        }
      })}`
    }
  ];
}

function buildMessages({ payload = {}, result = {} }) {
  const packet = buildReasoningPacket({ payload, result });

  return [
    {
      role: "system",
      content: [
        "You are a healthcare reasoning assistant for a local-first agent system.",
        "Improve accuracy only by grounding in the supplied evidence, vitals, profile, memory, retrieval diagnostics, and local agent output.",
        "Use support-route context only when it sharpens the same grounded answer.",
        "Do not add diagnosis, prescriptions, doses, or new medical claims.",
        "Preserve urgent safety wording and uncertainty.",
        "Return strict JSON with keys:",
        "summary_upgrade, step_additions, warning_additions, missing_question, missing_context, evidence_focus, confidence_label, support_route_updates.",
        "support_route_updates is optional, must use only routes already listed in supportAgents, and can contain up to 2 entries with route, summary_upgrade, patient_answer_summary, action_additions, question_additions, missing_context, evidence_focus, confidence_label."
      ].join(" ")
    },
    {
      role: "user",
      content: `Strengthen the local answer using this grounded packet.\n${JSON.stringify(packet)}`
    }
  ];
}

function buildSupportAgentPacket(agentResults = [], primaryRoute = "", options = {}) {
  const limit = Math.max(1, Number(options?.limit || DEFAULT_SUPPORT_AGENT_PACKET_LIMIT) || DEFAULT_SUPPORT_AGENT_PACKET_LIMIT);
  const activeRoutes = Array.isArray(options?.plan?.execute)
    ? options.plan.execute.map((route) => cleanText(route)).filter(Boolean)
    : [];
  const riskLevel = cleanText(options?.risk?.level || options?.risk?.label || "");

  return (Array.isArray(agentResults) ? agentResults : [])
    .filter((agent) => cleanText(agent?.id) && cleanText(agent?.id) !== primaryRoute)
    .map((agent) => {
      const output = agent?.output || {};
      const route = cleanText(agent?.id);
      const actions = collectAgentActionItems(output);
      const questions = collectAgentQuestionItems(route, output);
      const missing = collectAgentMissingItems(output);

      return {
        id: route,
        name: cleanText(agent?.name),
        summary: cleanText(output?.summary || "").slice(0, 260),
        patientAnswerSummary: cleanText(output?.patientAnswerSummary || "").slice(0, 220),
        actions,
        questions,
        missing,
        priorityScore: scoreSupportAgentPacketCandidate({
          route,
          primaryRoute,
          riskLevel,
          activeRoutes,
          actions,
          questions,
          missing
        }),
        confidenceLabel: cleanText(output?.reasoning?.label || output?.confidenceLabel || "").slice(0, 80)
      };
    })
    .sort((left, right) => (
      Number(right.priorityScore || 0) - Number(left.priorityScore || 0)
      || compareRouteOrder(left.id, right.id, activeRoutes)
    ))
    .slice(0, limit)
    .map(({ priorityScore, ...packet }) => packet);
}

function collectAgentActionItems(output = {}) {
  const actionKeys = [
    "checklist",
    "safeActions",
    "specialistActions",
    "vitalActions",
    "pharmacyActions",
    "visitActions",
    "safetyActions",
    "labActions",
    "lifestyleActions",
    "nextActions",
    "benefitQuestions"
  ];

  return dedupeItems(
    actionKeys.flatMap((key) => normalizeStringList(output?.[key], 2, 180))
  ).slice(0, 3);
}

function collectAgentQuestionItems(route = "", output = {}) {
  const genericQuestionKeys = [
    "focusQuestions",
    "doctorQuestions",
    "clinicianQuestions",
    "pharmacistQuestions",
    "benefitQuestions"
  ];
  const routeQuestionKeys = ROUTE_QUESTION_KEYS[route] || [];

  return dedupeItems(
    [...new Set([...routeQuestionKeys, ...genericQuestionKeys])]
      .flatMap((key) => normalizeStringList(output?.[key], 2, 180))
  ).slice(0, 3);
}

function collectAgentMissingItems(output = {}) {
  return dedupeItems([
    ...normalizeStringList(output?.missingContext, 2, 140),
    ...normalizeStringList(output?.missing, 2, 140),
    ...normalizeStringList(output?.accuracyGaps, 2, 140),
    ...normalizeStringList(output?.reviewGaps, 2, 140),
    ...normalizeStringList(output?.documentGaps?.missing, 2, 140),
    ...normalizeStringList(output?.specialistProfile?.missingContext, 2, 140),
    ...normalizeStringList(output?.structuredExtraction?.missingFields, 2, 140),
    ...normalizeStringList(output?.missingFields, 2, 140),
    ...normalizeStringList(output?.readinessGaps, 2, 140)
  ]).slice(0, 3);
}

function scoreSupportAgentPacketCandidate({
  route = "",
  primaryRoute = "",
  riskLevel = "",
  activeRoutes = [],
  actions = [],
  questions = [],
  missing = []
} = {}) {
  let score = routeSupportPriority(route);
  const routeIndex = activeRoutes.indexOf(route);
  const normalizedRisk = cleanText(riskLevel).toUpperCase();

  if (routeIndex >= 0) {
    score += Math.max(0, 24 - routeIndex * 3);
  }

  score += Math.min(actions.length, 3) * 8;
  score += Math.min(questions.length, 3) * 7;
  score += Math.min(missing.length, 3) * 6;

  if (route === "ALERT_AGENT" && (normalizedRisk === "HIGH" || normalizedRisk === "CRITICAL")) {
    score += 80;
  }

  if (primaryRoute === "SPECIALIST_DOCTOR_AGENT" && ["PHARMACY_AGENT", "LABS_AGENT", "VITALS_AGENT", "ALERT_AGENT"].includes(route)) {
    score += 18;
  }

  if (primaryRoute === "PHARMACY_AGENT" && ["VITALS_AGENT", "ALERT_AGENT", "SPECIALIST_DOCTOR_AGENT"].includes(route)) {
    score += 15;
  }

  if (primaryRoute === "LABS_AGENT" && ["SPECIALIST_DOCTOR_AGENT", "PHARMACY_AGENT", "ALERT_AGENT"].includes(route)) {
    score += 15;
  }

  if (primaryRoute === "RAG_AGENT" && ["ALERT_AGENT", "PHARMACY_AGENT", "VITALS_AGENT", "LABS_AGENT"].includes(route)) {
    score += 12;
  }

  return score;
}

function routeSupportPriority(route = "") {
  const priorities = {
    ALERT_AGENT: 120,
    SPECIALIST_DOCTOR_AGENT: 88,
    PHARMACY_AGENT: 82,
    VITALS_AGENT: 80,
    LABS_AGENT: 78,
    SCHEDULING_AGENT: 58,
    RECORDS_AGENT: 54,
    INSURANCE_AGENT: 52,
    LIFESTYLE_AGENT: 48,
    WELLNESS_AGENT: 48,
    CARE_TRANSITIONS_AGENT: 44,
    CLAIMS_OPS_AGENT: 44,
    UTILIZATION_AGENT: 44,
    GXP_QUALITY_AGENT: 40,
    MEDTECH_COMPLIANCE_AGENT: 40
  };

  return priorities[cleanText(route)] || 36;
}

function compareRouteOrder(leftRoute = "", rightRoute = "", activeRoutes = []) {
  const leftIndex = activeRoutes.indexOf(cleanText(leftRoute));
  const rightIndex = activeRoutes.indexOf(cleanText(rightRoute));

  if (leftIndex === -1 && rightIndex === -1) {
    return 0;
  }

  if (leftIndex === -1) {
    return 1;
  }

  if (rightIndex === -1) {
    return -1;
  }

  return leftIndex - rightIndex;
}

function normalizeSupportRouteUpdates(value, limit = 2) {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([route, update]) => ({
        route,
        ...(update && typeof update === "object" ? update : {})
      }))
      : [];

  return entries
    .map((entry) => normalizeSupportRouteUpdate(entry))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeSupportRouteUpdate(entry = {}) {
  const route = cleanText(entry?.route || entry?.id || entry?.agent || "");

  if (!route) {
    return null;
  }

  const questionItems = dedupeItems([
    ...normalizeStringList(entry?.questionAdditions || entry?.question_additions || entry?.questions, 3, 220),
    cleanText(entry?.question || entry?.doctorQuestion || entry?.doctor_question || "").slice(0, 220)
  ]).slice(0, 3);

  return {
    route,
    summary: cleanText(entry?.summary_upgrade || entry?.summary || "").slice(0, 360),
    patientAnswerSummary: cleanText(entry?.patient_answer_summary || entry?.patientAnswerSummary || "").slice(0, 260),
    actionItems: normalizePatientFacingActionList(entry?.action_additions || entry?.actionAdditions || entry?.step_additions || entry?.actions, 3, 220),
    questionItems,
    missingContext: normalizeStringList(entry?.missing_context || entry?.missingContext, 3, 160),
    evidenceFocus: normalizeStringList(entry?.evidence_focus || entry?.evidenceFocus, 3, 180),
    confidenceLabel: cleanText(entry?.confidence_label || entry?.confidenceLabel || "").slice(0, 80)
  };
}

function mergeLocalReasoningReviewIntoResult(result = {}, review = {}, candidate = {}) {
  const finalResponse = result.finalResponse || {};
  const groundedSummary = cleanText(finalResponse.summary);
  const summaryUpgrade = cleanText(review.summary_upgrade || review.summary || "").slice(0, 520);
  const stepAdditions = normalizePatientFacingActionList(review.step_additions || review.steps, 3, 220);
  const warningAdditions = normalizeStringList(review.warning_additions || review.warningSigns, 3, 220);
  const missingContext = normalizeStringList(review.missing_context || review.missingContext, 4, 160);
  const evidenceFocus = normalizeStringList(review.evidence_focus, 4, 180);
  const missingQuestion = cleanText(review.missing_question).slice(0, 220);
  const confidenceLabel = cleanText(review.confidence_label).slice(0, 80);
  const supportRouteUpdates = normalizeSupportRouteUpdates(review.support_route_updates || review.supportRouteUpdates);
  const mergedSummary = summaryUpgrade || groundedSummary;
  const mergedFinalResponse = {
    ...finalResponse,
    summary: mergedSummary,
    whatToDoNow: dedupeItems([
      ...(Array.isArray(finalResponse.whatToDoNow) ? finalResponse.whatToDoNow : []),
      ...stepAdditions
    ]).filter(isPatientFacingActionItem).slice(0, 5),
    warningSigns: dedupeItems([
      ...(Array.isArray(finalResponse.warningSigns) ? finalResponse.warningSigns : []),
      ...warningAdditions
    ]).slice(0, 5),
    localReasoningAssist: {
      enabled: true,
      attempted: true,
      applied: true,
      provider: candidate.displayName || candidate.provider || "Local reasoning",
      model: candidate.model || "",
      verifier: candidate.verificationCandidate
        ? {
          displayName: candidate.verificationCandidate.displayName || candidate.verificationCandidate.provider || "",
          model: candidate.verificationCandidate.model || ""
        }
        : null,
      candidateSequence: Array.isArray(candidate.candidateSequence) ? candidate.candidateSequence : [],
      summaryUpgrade,
      evidenceFocus,
      missingContext,
      missingQuestion,
      confidenceLabel,
      supportRouteCount: supportRouteUpdates.length,
      supportRoutes: supportRouteUpdates.map((update) => update.route)
    }
  };
  const primaryRoute = cleanText(finalResponse?.responseFocus?.primaryRoute || result?.plan?.responseOwner?.route || "");
  const baseAgentResults = Array.isArray(result.agentResults)
    ? result.agentResults.map((agent) => {
        if (agent.id !== primaryRoute) {
          return agent;
        }

        return {
          ...agent,
          output: mergeRouteAssistOutput({
            route: primaryRoute,
            output: agent.output || {},
            summary: mergedSummary,
            patientAnswerSummary: mergedSummary,
            actionItems: stepAdditions,
            question: missingQuestion,
            missingItems: missingContext,
            warningItems: warningAdditions,
            confidenceLabel,
            metadataKey: "localReasoningAssist",
            metadata: {
              applied: true,
              provider: candidate.displayName || candidate.provider || "Local reasoning",
              model: candidate.model || "",
              verifier: candidate.verificationCandidate
                ? {
                  displayName: candidate.verificationCandidate.displayName || candidate.verificationCandidate.provider || "",
                  model: candidate.verificationCandidate.model || ""
                }
                : null,
              candidateSequence: Array.isArray(candidate.candidateSequence) ? candidate.candidateSequence : [],
              summaryUpgrade,
              evidenceFocus,
              missingContext,
              missingQuestion,
              confidenceLabel
            }
          })
        };
      })
    : result.agentResults;
  const mergedAgentResults = mergeSupportRouteAssistOutputs({
    agentResults: baseAgentResults,
    updates: supportRouteUpdates,
    primaryRoute,
    metadataKey: "localReasoningAssist",
    metadataBase: {
      applied: true,
      provider: candidate.displayName || candidate.provider || "Local reasoning",
      model: candidate.model || "",
      verifier: candidate.verificationCandidate
        ? {
          displayName: candidate.verificationCandidate.displayName || candidate.verificationCandidate.provider || "",
          model: candidate.verificationCandidate.model || ""
        }
        : null,
      candidateSequence: Array.isArray(candidate.candidateSequence) ? candidate.candidateSequence : []
    }
  });

  return {
    finalResponse: mergedFinalResponse,
    agentResults: mergedAgentResults
  };
}

function mergeSupportRouteAssistOutputs({
  agentResults = [],
  updates = [],
  primaryRoute = "",
  metadataKey = "",
  metadataBase = {}
} = {}) {
  if (!Array.isArray(agentResults) || !updates.length) {
    return agentResults;
  }

  return agentResults.map((agent) => {
    const route = cleanText(agent?.id);

    if (!route || route === primaryRoute) {
      return agent;
    }

    const update = updates.find((candidate) => candidate.route === route);

    if (!update) {
      return agent;
    }

    return {
      ...agent,
      output: mergeRouteAssistOutput({
        route,
        output: agent.output || {},
        summary: update.summary || update.patientAnswerSummary,
        patientAnswerSummary: update.patientAnswerSummary || update.summary,
        actionItems: update.actionItems,
        questionItems: update.questionItems,
        missingItems: update.missingContext,
        confidenceLabel: update.confidenceLabel,
        metadataKey,
        metadata: {
          ...metadataBase,
          supportRoute: true,
          route,
          evidenceFocus: update.evidenceFocus,
          missingContext: update.missingContext,
          questionAdditions: update.questionItems,
          actionAdditions: update.actionItems,
          summaryUpgrade: update.summary || "",
          patientAnswerSummary: update.patientAnswerSummary || "",
          confidenceLabel: update.confidenceLabel
        }
      })
    };
  });
}

function mergeRouteAssistOutput({
  route = "",
  output = {},
  summary = "",
  patientAnswerSummary = "",
  actionItems = [],
  question = "",
  questionItems = [],
  missingItems = [],
  warningItems = [],
  confidenceLabel = "",
  metadataKey = "",
  metadata = {}
} = {}) {
  let mergedOutput = {
    ...output,
    summary: summary || cleanText(output?.summary),
    patientAnswerSummary: patientAnswerSummary || cleanText(output?.patientAnswerSummary),
    confidenceLabel: confidenceLabel || cleanText(output?.confidenceLabel)
  };
  const routeActionItems = cleanText(route) === "ALERT_AGENT"
    ? dedupeItems([...(Array.isArray(actionItems) ? actionItems : []), ...(Array.isArray(warningItems) ? warningItems : [])])
    : Array.isArray(actionItems) ? actionItems : [];
  const routeQuestionItems = dedupeItems([
    ...(question ? [question] : []),
    ...(Array.isArray(questionItems) ? questionItems : [])
  ]).slice(0, 6);

  for (const key of ROUTE_ACTION_KEYS[route] || ["checklist"]) {
    mergedOutput[key] = mergeTextListField(mergedOutput[key], routeActionItems, 6, 220);
  }

  for (const key of ROUTE_QUESTION_KEYS[route] || []) {
    mergedOutput[key] = mergeTextListField(mergedOutput[key], routeQuestionItems, 6, 220);
  }

  for (const path of ROUTE_MISSING_KEYS[route] || ["missingContext"]) {
    mergedOutput = mergeNestedTextListField(mergedOutput, path, missingItems, 6, 160);
  }

  if (metadataKey) {
    mergedOutput[metadataKey] = metadata;
  }

  return mergedOutput;
}

function mergeTextListField(currentValue, additions = [], limit = 6, maxLength = 220) {
  return dedupeItems([
    ...normalizeStringList(currentValue, limit, maxLength),
    ...normalizeStringList(additions, limit, maxLength)
  ]).slice(0, limit);
}

function mergeNestedTextListField(target = {}, path = "", additions = [], limit = 6, maxLength = 220) {
  const safePath = cleanText(path);

  if (!safePath) {
    return target;
  }

  const parts = safePath.split(".").filter(Boolean);

  if (!parts.length) {
    return target;
  }

  const nextTarget = {
    ...(target && typeof target === "object" ? target : {})
  };
  let cursor = nextTarget;
  let sourceCursor = target && typeof target === "object" ? target : {};

  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const sourceValue = sourceCursor && typeof sourceCursor === "object" ? sourceCursor[key] : undefined;
    const clonedValue = sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue)
      ? { ...sourceValue }
      : {};

    cursor[key] = clonedValue;
    cursor = clonedValue;
    sourceCursor = sourceValue;
  }

  const finalKey = parts[parts.length - 1];
  const currentValue = sourceCursor && typeof sourceCursor === "object" ? sourceCursor[finalKey] : undefined;
  cursor[finalKey] = mergeTextListField(currentValue, additions, limit, maxLength);
  return nextTarget;
}

function buildHeaders(env, candidate = {}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8"
  };
  const apiKey = cleanText(candidate.apiKey || env.DEEPSEEK_API_KEY || env.LOCAL_LLM_API_KEY || env.CARE_NOVA_LLM_API_KEY);
  const apiKeyHeader = cleanText(candidate.apiKeyHeader || env.CARE_NOVA_LOCAL_REASONING_API_KEY_HEADER);
  const authScheme = cleanText(candidate.authScheme || env.CARE_NOVA_LOCAL_REASONING_API_AUTH_SCHEME || "Bearer");

  if (apiKey && apiKeyHeader) {
    headers[apiKeyHeader] = apiKey;
  } else if (apiKey) {
    headers.Authorization = `${authScheme} ${apiKey}`.trim();
  }

  return headers;
}

function normalizeVitalsPacket(vitals = {}) {
  const source = vitals && typeof vitals === "object" ? vitals : {};
  const allowed = ["systolic", "diastolic", "bloodSugar", "heartRate", "temperatureC", "oxygenSaturation", "weightKg", "heightCm"];
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key, value]) => allowed.includes(key) && value !== null && value !== undefined && cleanText(value))
      .slice(0, 8)
  );
}

function dedupeItems(items = []) {
  return Array.from(new Set((items || []).map((item) => cleanText(item)).filter(Boolean)));
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  const text = cleanText(value);
  return text ? text.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function normalizeStringList(value, limit, maxLength) {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeItems(
    value.map((item) => cleanText(item).slice(0, maxLength))
  ).slice(0, limit);
}

const internalActionPatterns = [
  /^(answer:|focus:|ask next:)/i,
  /^(restate|rewrite|summarize)\b/i,
  /\bbefore giving the next step\b/i,
  /\bbefore suggesting follow-up\b/i,
  /\buse the available\b.*\bcontext\b/i,
  /\bpatient context\b/i
];

function isPatientFacingActionItem(value = "") {
  const text = cleanText(value);

  if (!text) {
    return false;
  }

  return !internalActionPatterns.some((pattern) => pattern.test(text));
}

function normalizePatientFacingActionList(value, limit, maxLength) {
  return normalizeStringList(value, limit, maxLength)
    .filter(isPatientFacingActionItem)
    .slice(0, limit);
}

function extractResponseText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const ollamaMessage = payload.message?.content;

  if (typeof ollamaMessage === "string") {
    return ollamaMessage;
  }

  if (Array.isArray(ollamaMessage)) {
    return ollamaMessage
      .map((entry) => cleanText(entry?.text || entry?.content || ""))
      .filter(Boolean)
      .join("\n");
  }

  const message = payload.choices?.[0]?.message?.content;

  if (typeof message === "string") {
    return message;
  }

  if (Array.isArray(message)) {
    return message
      .map((entry) => cleanText(entry?.text || entry?.content || ""))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  return cleanText(payload.choices?.[0]?.text || "");
}

function parseJsonObject(text) {
  const source = String(text || "").trim();

  if (!source) {
    return null;
  }

  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");

    if (start === -1 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(source.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function safeHost(value) {
  const text = cleanText(value);

  if (!text) {
    return "";
  }

  try {
    return new URL(text).host || text;
  } catch {
    return text.replace(/\/.*$/, "");
  }
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(cleanText(value), 10);
  const number = Number.isInteger(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, number));
}

function readBooleanDefault(value, defaultValue = false) {
  const cleaned = cleanText(value);

  if (!cleaned) {
    return defaultValue;
  }

  return /^(1|true|yes|on)$/i.test(cleaned);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
