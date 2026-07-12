import { createHash } from "node:crypto";
import { getHybridModelRouterStatus } from "./hybridModelRouter.js";
import { getConnectivityPolicy, isLocalEndpoint } from "./runtimeConnectivity.js";

export const LOCAL_AI_CORE_VERSION = "1.3.2";
export const PRIMARY_LLM_PROVIDER = "auto";
export const PRIMARY_LLM_MODEL = "local-open-source-auto";
export const PRIMARY_LLM_DISPLAY_NAME = "Auto Local Open-Source Ensemble";

const maxCorpusCacheEntries = 8;
const maxRankedQueryCacheEntries = 48;
const maxPreparedRecordTemplateCacheEntries = 1024;
const preparedCorpusByReference = new WeakMap();
const preparedCorpusBySignature = new Map();
const preparedRecordTemplateByReference = new WeakMap();
const preparedRecordTemplateBySignature = new Map();
const rankedQueryCache = new Map();
const knowledgeRecordSignatureCache = new WeakMap();

const stopWords = new Set([
  "a",
  "about",
  "after",
  "all",
  "also",
  "am",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "because",
  "before",
  "by",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "give",
  "had",
  "has",
  "have",
  "help",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "need",
  "of",
  "on",
  "or",
  "our",
  "please",
  "should",
  "tell",
  "the",
  "this",
  "to",
  "what",
  "when",
  "with",
  "you"
]);

const semanticFamilies = [
  {
    id: "cardio",
    label: "Cardio and blood pressure",
    terms: ["heart", "cardiac", "chest", "bp", "blood", "pressure", "pulse", "palpitation", "sweating", "jaw", "arm", "cholesterol"]
  },
  {
    id: "respiratory",
    label: "Breathing and lungs",
    terms: ["breathing", "breath", "cough", "wheeze", "asthma", "copd", "oxygen", "inhaler", "sputum", "choking"]
  },
  {
    id: "neuro",
    label: "Brain and nerves",
    terms: ["headache", "stroke", "weakness", "speech", "vision", "confusion", "seizure", "dizzy", "numbness"]
  },
  {
    id: "renal",
    label: "Kidney and fluid balance",
    terms: ["kidney", "renal", "creatinine", "egfr", "proteinuria", "protein", "urine", "potassium", "swelling", "fluid", "dialysis"]
  },
  {
    id: "hepatic",
    label: "Liver and jaundice",
    terms: ["liver", "bilirubin", "alt", "ast", "jaundice", "hepatitis", "dark", "urine", "abdominal", "swelling"]
  },
  {
    id: "digestive",
    label: "Digestive and bowel",
    terms: ["abdominal", "stomach", "digestive", "reflux", "vomiting", "diarrhea", "constipation", "bowel", "bloated", "stool"]
  },
  {
    id: "metabolic",
    label: "Diabetes and metabolism",
    terms: ["diabetes", "sugar", "glucose", "hba1c", "insulin", "metformin", "thirst", "urination", "thyroid"]
  },
  {
    id: "medicine",
    label: "Medicine safety",
    terms: ["medicine", "medication", "drug", "tablet", "pill", "dose", "interaction", "allergy", "rash", "swelling", "side"]
  },
  {
    id: "labs",
    label: "Labs and reports",
    terms: ["lab", "report", "cbc", "creatinine", "egfr", "ldl", "hdl", "cholesterol", "platelet", "hemoglobin", "scan", "ecg"]
  },
  {
    id: "urgent",
    label: "Urgent safety",
    terms: ["urgent", "emergency", "severe", "faint", "fainting", "bleeding", "blue", "confusion", "unable", "worst"]
  },
  {
    id: "maternal",
    label: "Pregnancy and maternal care",
    terms: ["pregnancy", "pregnant", "postpartum", "maternal", "baby", "fetal", "movement", "bleeding", "preeclampsia", "swelling"]
  },
  {
    id: "skin",
    label: "Skin and wound infection",
    terms: ["skin", "wound", "redness", "cellulitis", "drainage", "swelling", "rash", "warmth", "pus", "infection"]
  },
  {
    id: "sleep",
    label: "Sleep and recovery",
    terms: ["sleep", "snoring", "apnea", "fatigue", "daytime", "recovery", "routine", "cpap", "insomnia", "sleepiness"]
  },
  {
    id: "wellness",
    label: "Mental wellness and sleep",
    terms: ["stress", "stressed", "anxiety", "anxious", "panic", "mood", "sad", "depressed", "sleep", "insomnia", "routine", "calmer"]
  },
  {
    id: "followup",
    label: "Follow-up and care planning",
    terms: ["follow", "followup", "appointment", "visit", "schedule", "review", "monitor", "watch", "next", "plan"]
  },
  {
    id: "records",
    label: "Records and summaries",
    terms: ["record", "records", "summary", "handoff", "doctor", "note", "packet", "timeline", "share"]
  },
  {
    id: "insurance",
    label: "Insurance and claims",
    terms: ["insurance", "claim", "claims", "coverage", "eob", "bill", "billing", "authorization", "appeal", "denial", "policy"]
  }
];

const medicalEntityGroups = [
  {
    id: "blood_pressure",
    label: "Blood pressure and hypertension",
    triggers: ["bp", "blood pressure", "hypertension", "systolic", "diastolic"],
    expansions: ["bp", "blood", "pressure", "hypertension", "systolic", "diastolic", "heart", "cardio"],
    categories: ["Vitals", "General", "Urgent Safety", "Cardiology", "Nephrology"]
  },
  {
    id: "blood_sugar",
    label: "Blood sugar and diabetes",
    triggers: ["sugar", "blood sugar", "glucose", "diabetes", "hba1c", "a1c", "insulin", "metformin"],
    expansions: ["sugar", "glucose", "diabetes", "hba1c", "a1c", "insulin", "metformin", "metabolic"],
    categories: ["Vitals", "Labs", "Medication", "General", "Endocrinology"]
  },
  {
    id: "medicine_safety",
    label: "Medicine safety",
    triggers: ["medicine", "medication", "tablet", "pill", "dose", "missed", "side effect", "interaction", "allergy"],
    expansions: ["medicine", "medication", "drug", "tablet", "pill", "dose", "missed", "interaction", "allergy", "pharmacy"],
    categories: ["Medication", "Urgent Safety"]
  },
  {
    id: "lab_report",
    label: "Lab report and test values",
    triggers: ["lab", "report", "test", "cbc", "cholesterol", "ldl", "hdl", "creatinine", "egfr", "thyroid", "tsh"],
    expansions: ["lab", "report", "test", "cbc", "cholesterol", "ldl", "hdl", "creatinine", "egfr", "thyroid", "tsh"],
    categories: ["Labs", "Vitals"]
  },
  {
    id: "breathing_safety",
    label: "Breathing safety",
    triggers: ["breathing", "breathless", "shortness of breath", "wheeze", "asthma", "oxygen", "spo2", "cough"],
    expansions: ["breathing", "breath", "breathless", "wheeze", "asthma", "oxygen", "spo2", "cough", "respiratory"],
    categories: ["General", "Urgent Safety", "Vitals", "Pulmonology"]
  },
  {
    id: "neuro_safety",
    label: "Neurologic safety",
    triggers: ["headache", "stroke", "weakness", "speech", "vision", "confusion", "seizure", "numbness"],
    expansions: ["headache", "stroke", "weakness", "speech", "vision", "confusion", "seizure", "numbness", "neuro"],
    categories: ["General", "Urgent Safety", "Vitals", "Neurology"]
  },
  {
    id: "kidney_function",
    label: "Kidney function and swelling",
    triggers: ["kidney", "renal", "creatinine", "egfr", "protein urine", "foamy urine", "low urine", "potassium", "ankle swelling"],
    expansions: ["kidney", "renal", "creatinine", "egfr", "protein", "urine", "swelling", "potassium", "fluid", "nephrology"],
    categories: ["Nephrology", "Labs", "Vitals", "General"]
  },
  {
    id: "liver_function",
    label: "Liver function and jaundice",
    triggers: ["liver", "bilirubin", "alt", "ast", "jaundice", "dark urine"],
    expansions: ["liver", "bilirubin", "alt", "ast", "jaundice", "dark urine", "hepatology", "abdominal swelling"],
    categories: ["Hepatology", "Labs", "General"]
  },
  {
    id: "thyroid_hormone",
    label: "Thyroid and hormone follow-up",
    triggers: ["thyroid", "tsh", "t4", "t3", "levothyroxine", "hormone"],
    expansions: ["thyroid", "tsh", "t4", "t3", "levothyroxine", "hormone", "endocrinology", "palpitation", "fatigue"],
    categories: ["Endocrinology", "Labs", "Medication", "General"]
  },
  {
    id: "anemia_iron",
    label: "Anemia and iron studies",
    triggers: ["anemia", "hemoglobin", "ferritin", "iron", "mcv", "b12"],
    expansions: ["anemia", "hemoglobin", "ferritin", "iron", "mcv", "b12", "fatigue", "bleeding", "labs"],
    categories: ["Labs", "General", "Urgent Safety"]
  },
  {
    id: "pregnancy_maternal",
    label: "Pregnancy and maternal warning review",
    triggers: ["pregnancy", "pregnant", "postpartum", "baby movement", "maternal", "preeclampsia", "heavy bleeding", "vision change", "upper abdominal pain"],
    expansions: ["pregnancy", "pregnant", "postpartum", "maternal", "baby", "movement", "bleeding", "swelling", "headache", "vision", "obstetric"],
    categories: ["Gynecology", "Urgent Safety", "General", "Vitals"]
  },
  {
    id: "anticoagulant_bleeding",
    label: "Blood thinner and bleeding safety",
    triggers: ["blood thinner", "warfarin", "apixaban", "rivaroxaban", "bruise", "bleeding", "black stool"],
    expansions: ["blood thinner", "warfarin", "apixaban", "rivaroxaban", "bleeding", "bruise", "black stool", "anticoagulant", "pharmacy"],
    categories: ["Medication", "Urgent Safety", "General"]
  },
  {
    id: "sleep_breathing",
    label: "Sleep apnea and snoring",
    triggers: ["snoring", "sleep apnea", "cpap", "daytime sleepiness", "witnessed pauses"],
    expansions: ["snoring", "sleep apnea", "cpap", "sleepiness", "fatigue", "daytime", "sleep", "morning headache"],
    categories: ["Lifestyle", "General", "Vitals"]
  },
  {
    id: "skin_wound_infection",
    label: "Skin, wound, and infection review",
    triggers: ["cellulitis", "wound", "redness", "drainage", "pus", "warmth", "spreading rash"],
    expansions: ["cellulitis", "wound", "redness", "drainage", "pus", "warmth", "rash", "infection", "skin"],
    categories: ["General", "Urgent Safety"]
  },
  {
    id: "visit_followup",
    label: "Visit and follow-up planning",
    triggers: ["appointment", "follow up", "follow-up", "visit", "doctor", "clinic", "schedule", "discharge"],
    expansions: ["appointment", "follow", "visit", "doctor", "clinic", "schedule", "discharge", "transition"],
    categories: ["Follow-up", "Care Transitions", "Records"]
  },
  {
    id: "insurance_claim",
    label: "Insurance and claims",
    triggers: ["insurance", "claim", "coverage", "eob", "bill", "prior authorization", "appeal"],
    expansions: ["insurance", "claim", "claims", "coverage", "eob", "bill", "authorization", "appeal"],
    categories: ["Insurance", "Claims Operations", "Utilization Management"]
  },
  {
    id: "quality_compliance",
    label: "Life-science quality and compliance",
    triggers: ["batch record", "deviation", "gxp", "qms", "sop", "technical file", "complaint", "capa", "traceability"],
    expansions: ["batch", "record", "deviation", "gxp", "qms", "sop", "technical", "complaint", "capa", "traceability"],
    categories: ["GxP Quality", "MedTech Compliance"]
  }
];

const intentFocusTagsByIntent = {
  GENERAL: ["General"],
  SPECIALIST_DOCTOR: ["Specialist"],
  MEDICATION: ["Medication"],
  APPOINTMENT: ["Follow-up", "Care Transitions"],
  EMERGENCY: ["Urgent Safety"],
  VITALS_TRACKING: ["Vitals"],
  LAB_REPORT: ["Labs"],
  LIFESTYLE: ["Lifestyle"],
  MENTAL_WELLNESS: ["Mental Wellness", "Lifestyle"],
  HEALTH_RECORDS: ["Records", "Care Transitions"],
  INSURANCE_SUPPORT: ["Insurance", "Claims Operations", "Utilization Management"],
  CARE_TRANSITIONS: ["Care Transitions", "Records"],
  CLAIMS_OPERATIONS: ["Claims Operations", "Insurance"],
  UTILIZATION_MANAGEMENT: ["Utilization Management", "Insurance"],
  GXP_QUALITY: ["GxP Quality"],
  MEDTECH_COMPLIANCE: ["MedTech Compliance"]
};

const expectedContentTypesByIntent = {
  GENERAL: ["general", "prevention", "vitals", "safety"],
  SPECIALIST_DOCTOR: ["specialist", "labs", "medicine", "vitals", "safety", "general", "imaging", "procedures"],
  MEDICATION: ["medicine", "safety"],
  APPOINTMENT: ["records", "procedures"],
  EMERGENCY: ["safety", "general", "vitals"],
  VITALS_TRACKING: ["vitals", "general", "safety"],
  LAB_REPORT: ["labs", "specialist", "general", "imaging"],
  LIFESTYLE: ["prevention", "general"],
  MENTAL_WELLNESS: ["prevention", "general", "safety"],
  HEALTH_RECORDS: ["records"],
  INSURANCE_SUPPORT: ["insurance", "records"],
  CARE_TRANSITIONS: ["records", "procedures"],
  CLAIMS_OPERATIONS: ["insurance", "records"],
  UTILIZATION_MANAGEMENT: ["insurance", "records"],
  GXP_QUALITY: ["records"],
  MEDTECH_COMPLIANCE: ["records"]
};

const intentDrivenContentTypeBoosts = {
  SPECIALIST_DOCTOR: { specialist: 24, labs: 12, medicine: 10, vitals: 10, safety: 10, general: 6, imaging: 8, procedures: 6 },
  LAB_REPORT: { labs: 24, imaging: 12, specialist: 10, general: 6, vitals: 6 },
  MEDICATION: { medicine: 24, safety: 10, general: 6 },
  VITALS_TRACKING: { vitals: 24, general: 8, safety: 10, specialist: 8 },
  APPOINTMENT: { records: 22, procedures: 12, general: 6 },
  HEALTH_RECORDS: { records: 24, general: 6 },
  INSURANCE_SUPPORT: { insurance: 24, records: 10 },
  CARE_TRANSITIONS: { records: 20, procedures: 12, general: 6 },
  CLAIMS_OPERATIONS: { insurance: 24, records: 10 },
  UTILIZATION_MANAGEMENT: { insurance: 24, records: 10 },
  EMERGENCY: { safety: 24, general: 8, vitals: 8, specialist: 8 },
  GENERAL: { general: 18, prevention: 10, vitals: 8, safety: 8 }
};

const clinicalDomainSignals = [
  { id: "cardiology", terms: ["cardiology", "cardiac", "heart", "hypertension", "blood pressure", "palpitation", "heart failure", "cholesterol", "lipid", "statin"] },
  { id: "endocrinology", terms: ["endocrinology", "diabetes", "glucose", "a1c", "hba1c", "insulin", "metformin", "thyroid", "hormone"] },
  { id: "pulmonology", terms: ["pulmonology", "asthma", "copd", "oxygen", "spo2", "wheeze", "inhaler", "respiratory"] },
  { id: "nephrology", terms: ["nephrology", "kidney", "renal", "creatinine", "egfr", "protein urine", "dialysis"] },
  { id: "neurology", terms: ["neurology", "stroke", "seizure", "migraine", "headache", "vision change", "numbness", "speech"] },
  { id: "hepatology", terms: ["hepatology", "liver", "bilirubin", "alt", "ast", "jaundice"] },
  { id: "gynecology", terms: ["gynecology", "pelvic", "period", "menopause", "pcos", "breast", "bleeding"] },
  { id: "pediatrics", terms: ["pediatrics", "pediatric", "infant", "newborn", "child"] },
  { id: "gastrointestinal", terms: ["gastrointestinal", "digestive", "reflux", "abdominal", "bowel", "ibd", "ulcer"] },
  { id: "maternal-health", terms: ["maternal", "pregnancy", "pregnant", "postpartum", "fetal", "preeclampsia", "obstetric", "baby movement"] },
  { id: "sleep-medicine", terms: ["sleep medicine", "sleep apnea", "snoring", "insomnia"] },
  { id: "travel-health", terms: ["travel health", "travel", "mosquito", "jet lag", "altitude"] },
  { id: "bone-health", terms: ["bone health", "osteoporosis", "fracture", "fall prevention", "calcium", "vitamin d"] }
];

const explicitClinicalDomainAliases = {
  cardiology: ["cardiology", "cardiac", "heart specialist", "heart doctor"],
  endocrinology: ["endocrinology", "endocrine", "diabetes specialist", "thyroid specialist"],
  pulmonology: ["pulmonology", "pulmonary", "lung specialist", "respiratory specialist"],
  nephrology: ["nephrology", "renal specialist", "kidney specialist"],
  neurology: ["neurology", "neurologic specialist", "brain specialist"],
  hepatology: ["hepatology", "liver specialist"],
  gynecology: ["gynecology", "gynaecology", "obgyn", "ob-gyn"],
  pediatrics: ["pediatrics", "paediatrics", "pediatrician", "child specialist"],
  gastrointestinal: ["gastroenterology", "gastro", "digestive specialist"],
  "maternal-health": ["maternal health", "obstetric", "pregnancy specialist"],
  "sleep-medicine": ["sleep medicine", "sleep specialist"],
  "travel-health": ["travel health", "travel clinic"],
  "bone-health": ["bone health", "bone specialist", "osteoporosis specialist"]
};

const careTaskSignalDefinitions = [
  {
    id: "monitoring",
    queryTerms: ["track", "monitor", "recheck", "repeat", "trend", "reading", "readings", "home check", "what should i track"],
    recordTerms: ["what to track", "track", "monitor", "trend", "repeat reading", "home reading"]
  },
  {
    id: "precautions",
    queryTerms: ["watch for", "warning sign", "warning signs", "precaution", "precautions", "side effect", "side effects", "avoid", "urgent signs"],
    recordTerms: ["precaution", "warning sign", "urgent", "red flag", "avoid", "warning review"]
  },
  {
    id: "testing",
    queryTerms: ["test", "tests", "lab", "labs", "workup", "recheck", "follow up test", "which tests", "what tests matter"],
    recordTerms: ["test", "tests", "lab", "labs", "follow up", "doctor questions", "recheck", "reference range"]
  },
  {
    id: "explanation",
    queryTerms: ["explain", "meaning", "what does that mean", "what does it mean", "simple words", "plain language"],
    recordTerms: ["explain", "plain language", "overview", "what does it mean", "simple words"]
  },
  {
    id: "documentation",
    queryTerms: ["summary", "note", "record", "handoff", "report", "packet", "share with doctor"],
    recordTerms: ["summary", "doctor note", "handoff", "packet", "record", "share ready"]
  },
  {
    id: "prevention",
    queryTerms: ["prevent", "prevention", "reduce risk", "avoid again", "lifestyle"],
    recordTerms: ["prevent", "prevention", "risk reduction", "lifestyle"]
  }
];

const medicationFocusStopWords = new Set([
  "advice",
  "after",
  "allergy",
  "ankle",
  "blood",
  "breathing",
  "common",
  "dehydration",
  "diarrhea",
  "dizziness",
  "dizzy",
  "dose",
  "double",
  "effect",
  "fall",
  "food",
  "general",
  "glucose",
  "headache",
  "hydration",
  "interaction",
  "kidney",
  "lightheaded",
  "medicine",
  "medication",
  "missed",
  "nausea",
  "pain",
  "pharmacy",
  "pill",
  "possible",
  "postural",
  "precaution",
  "precautions",
  "pressure",
  "question",
  "review",
  "risk",
  "safe",
  "safety",
  "side",
  "stand",
  "standing",
  "stomach",
  "swelling",
  "symptom",
  "symptoms",
  "tablet",
  "taking",
  "timing",
  "vomiting",
  "watch",
  "worsening"
]);

const medicationActivationTerms = new Set([
  "amlodipine",
  "antibiotic",
  "apixaban",
  "atorvastatin",
  "capsule",
  "clopidogrel",
  "diclofenac",
  "dose",
  "dosing",
  "drug",
  "drugs",
  "gabapentin",
  "ibuprofen",
  "inhaler",
  "insulin",
  "interaction",
  "interactions",
  "losartan",
  "lisinopril",
  "medicine",
  "medication",
  "metformin",
  "missed",
  "naproxen",
  "nsaid",
  "pharmacist",
  "pharmacy",
  "pill",
  "prescription",
  "refill",
  "rosuvastatin",
  "sertraline",
  "sideeffect",
  "sideeffects",
  "statin",
  "steroid",
  "tablet",
  "warfarin"
]);

export function getModelHealthStatus(env = process.env) {
  const timeoutMs = Number.parseInt(cleanText(env.LOCAL_LLM_TIMEOUT_MS || env.CARE_NOVA_LLM_TIMEOUT_MS || "20000"), 10);
  const enabled = readBooleanDefault(env.LOCAL_LLM_ENABLED, true);
  const connectivity = getConnectivityPolicy(env);
  const router = getHybridModelRouterStatus(env);
  const configuredOpenSourceModels = router.localModels.filter((model) => model.id !== "care-nova-local-core" && model.configured);
  const availableOpenSourceModels = configuredOpenSourceModels.filter((model) => model.available);
  const compatibilityRuntimeModels = configuredOpenSourceModels.filter((model) => model.mockRuntimeDetected);
  const preferredProvider = cleanText(env.LOCAL_LLM_PROVIDER || env.CARE_NOVA_LLM_PROVIDER || PRIMARY_LLM_PROVIDER).toLowerCase();
  const preferredModel = availableOpenSourceModels.find((model) => model.selected)
    || availableOpenSourceModels[0]
    || configuredOpenSourceModels.find((model) => model.selected)
    || configuredOpenSourceModels[0]
    || null;
  const compatibilityRuntimeDetected = !availableOpenSourceModels.length && compatibilityRuntimeModels.length > 0;
  const provider = cleanText(preferredModel?.id || preferredProvider || PRIMARY_LLM_PROVIDER);
  const endpoint = cleanText(preferredModel?.endpoint);
  const model = cleanText(preferredModel?.model) || PRIMARY_LLM_MODEL;
  const endpointIsLocal = isLocalEndpoint(endpoint);
  const missing = Array.isArray(preferredModel?.missing) ? preferredModel.missing : [];
  const available = enabled && Boolean(preferredModel?.available);
  const generationCooldownActive = Boolean(preferredModel?.generationCooldownActive);
  const displayName = compatibilityRuntimeDetected
    ? "Local Compatibility Runtime"
    : preferredModel?.displayName || PRIMARY_LLM_DISPLAY_NAME;
  const reason = !enabled
    ? "Local LLM connector is disabled and the deterministic healthcare engine remains active."
    : availableOpenSourceModels.length
      ? `Open-source local ensemble is ready with ${availableOpenSourceModels.map((item) => item.displayName).join(", ")}.`
      : compatibilityRuntimeDetected
        ? "A Care Nova compatibility runtime is responding on localhost, but no native Ollama or LM Studio model runtime is installed. The deterministic local healthcare core remains primary."
      : generationCooldownActive
        ? "The local runtime recently timed out or returned an unusable response, so the deterministic local healthcare core remains primary until the cooldown expires."
      : configuredOpenSourceModels.length
        ? "Open-source local ensemble is configured and waiting for the local runtime to respond."
        : "No open-source local runtime is active yet; deterministic local core remains active.";

  return {
    provider,
    displayName,
    primary: Boolean(preferredModel),
    enabled,
    available,
    endpoint,
    endpointIsLocal,
    runtimeFamily: preferredModel?.runtimeFamily || (endpointIsLocal ? "local-openai-compatible" : "remote-openai-compatible"),
    mockRuntimeDetected: compatibilityRuntimeDetected,
    runtimeKind: compatibilityRuntimeDetected ? "compatibility-runtime" : endpointIsLocal ? "local-runtime" : "remote-runtime",
    nativeRuntimeDetected: available,
    internetRequired: Boolean(endpoint && !endpointIsLocal),
    model,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 20000,
    status: !enabled
      ? "disabled-safe-offline-fallback"
      : available
        ? "configured"
        : compatibilityRuntimeDetected
          ? "compatibility-runtime-detected"
        : generationCooldownActive
          ? "generation-cooldown"
        : configuredOpenSourceModels.length
          ? "configured-local-runtime-waiting"
          : missing.length
            ? "fallback-missing-configuration"
            : "fallback-no-local-runtime",
    missing,
    connectivity: {
      forceOffline: connectivity.forceOffline,
      internetAvailable: connectivity.internetAvailable,
      endpointIsLocal
    },
    healthCheck: {
      configured: Boolean(configuredOpenSourceModels.length),
      available,
      liveProbeRequired: Boolean(configuredOpenSourceModels.length && !available),
      generationCooldownActive,
      generationCooldownRemainingMs: Number(preferredModel?.generationCooldownRemainingMs || 0),
      generationCooldownUntil: cleanText(preferredModel?.generationCooldownUntil || ""),
      lastGenerationError: cleanText(preferredModel?.lastGenerationError || ""),
      lastGenerationFailureAt: cleanText(preferredModel?.lastGenerationFailureAt || ""),
      lastGenerationSuccessAt: cleanText(preferredModel?.lastGenerationSuccessAt || ""),
      lastCheckedAt: new Date().toISOString(),
      fallback: "local deterministic healthcare engine"
    },
    reason,
    apiKey: preferredModel?.apiKey || "",
    apiKeyHeader: preferredModel?.apiKeyHeader || "",
    authScheme: preferredModel?.authScheme || "Bearer",
    promptPolicy: {
      reasoning: "Use open-source local reasoning internally; never expose hidden chain-of-thought.",
      context: "Prefer compact patient memory, route decision, safety flags, evidence snippets, and report task data.",
      safety: "Medical safety guardrails and urgent-care override remain outside the LLM."
    }
  };
}

export function getLocalAiRuntimeStatus(env = process.env) {
  const modelHealth = getModelHealthStatus(env);
  const hybridRouter = getHybridModelRouterStatus(env);
  const connectivity = getConnectivityPolicy(env);
  const localLlmEnabled = modelHealth.enabled;
  const localLlmReady = modelHealth.available;
  const externalApiEnabled = readBoolean(env.CARE_NOVA_EXTERNAL_API_ENABLED) && Boolean(cleanText(env.CARE_NOVA_EXTERNAL_API_URL));
  const onlineModeEnabled = connectivity.networkAllowed && (readBoolean(env.CARE_NOVA_ONLINE_MODE) || externalApiEnabled);
  const mode = cleanText(env.CARE_NOVA_AI_MODE) || (localLlmReady ? "offline-plus-local-llm" : "offline-first");
  const localLlmUrl = modelHealth.endpoint;
  const localLlmModel = modelHealth.model;
  const openSourceParticipants = hybridRouter.localModels.filter((model) => model.available && model.id !== "care-nova-local-core");

  return {
    id: "CARE_NOVA_LOCAL_AI_CORE",
    version: LOCAL_AI_CORE_VERSION,
    mode,
    offlineReady: true,
    onlineReady: onlineModeEnabled,
    connectivity: {
      forceOffline: connectivity.forceOffline,
      internetAvailable: connectivity.internetAvailable
    },
    runtimeParity: {
      id: "ONLINE_OFFLINE_PARITY",
      sameCoreOnlineOffline: true,
      internetRequired: false,
      localServerRequired: true,
      onlinePath: "Same local Node API, local medical database, local evidence ranker, local memory, local records, and optional approved external API cache.",
      offlinePath: "Same local Node API, local medical database, local evidence ranker, local memory, and local records.",
      performanceModel: "Local CPU and local disk for the core engine; optional external API data is cached locally and never required for safe fallback.",
      dataStores: [
        "data/offline-medical-db.json",
        "data/offline-clinical-repository.json",
        "data/offline-knowledge-index.json",
        "data/offline-repository-manifest.json",
        "data/external/external-knowledge-cache.json",
        "data/memory/patient-memory.json",
        "data/records/patient-records.json",
        "browser localStorage for UI preferences and installed-app state"
      ],
      guarantee: "The core engine remains local. External API data is optional, de-identified, cached locally, and reused from disk for future requests."
    },
    runtime: "local-node-deterministic-ml",
    mlCore: {
      enabled: true,
      method: "TF-IDF style lexical retrieval, generated offline repository index, source-family filtering, synonym expansion, medical entity alignment, clinical-domain fit, task-intent alignment, content-type fit, numeric signal awareness, semantic family scoring, route-aware evidence weighting, confidence calibration, and safety gating",
      runsWithoutInternet: true,
      trainsFromPatientData: false,
      learningBoundary: "Patient conversations improve local context memory only; medical facts stay in the governed offline database."
    },
    localLlm: {
      enabled: localLlmEnabled,
      provider: modelHealth.provider,
      displayName: modelHealth.displayName,
      primary: modelHealth.primary,
      status: modelHealth.status,
      available: modelHealth.available,
      runtimeKind: modelHealth.runtimeKind,
      nativeRuntimeDetected: modelHealth.nativeRuntimeDetected,
      mockRuntimeDetected: modelHealth.mockRuntimeDetected,
      endpoint: localLlmUrl,
      model: localLlmModel,
      health: modelHealth.healthCheck,
      missing: modelHealth.missing,
      endpointIsLocal: modelHealth.endpointIsLocal,
      internetRequired: modelHealth.internetRequired,
      connectivity: modelHealth.connectivity,
      reason: modelHealth.reason,
      promptPolicy: modelHealth.promptPolicy,
      ensembleEnabled: openSourceParticipants.length > 0,
      participants: openSourceParticipants.map(({ id, displayName, model, performanceClass }) => ({
        id,
        displayName,
        model,
        performanceClass
      })),
      fallback: "If one open-source local LLM is unavailable, the router continues with the next configured free model or the deterministic local core.",
      adapter: "Route-aware open-source local ensemble with deterministic healthcare safety fallback; the safe runtime does not require provider access."
    },
    hybridRouter: {
      id: hybridRouter.id,
      version: hybridRouter.version,
      status: hybridRouter.status,
      mode: hybridRouter.mode,
      processingLabels: hybridRouter.processingLabels,
      summary: hybridRouter.summary,
      connectivity: hybridRouter.connectivity,
      costPolicy: hybridRouter.costPolicy,
      fallbackPolicy: hybridRouter.fallbackPolicy,
      localModels: hybridRouter.localModels.map(({ id, displayName, model, status, enabled, configured, available, selected, offlineCapable, costTier, performanceClass, endpoint, reason }) => ({
        id,
        displayName,
        model,
        status,
        enabled,
        configured,
        available,
        selected,
        offlineCapable,
        costTier,
        performanceClass,
        endpointHost: safeHost(endpoint),
        reason
      })),
      cloudModels: hybridRouter.cloudModels.map(({ id, displayName, model, status, enabled, configured, available, costTier, performanceClass, internetRequired, endpoint, reason }) => ({
        id,
        displayName,
        model,
        status,
        enabled,
        configured,
        available,
        costTier,
        performanceClass,
        internetRequired,
        endpointHost: safeHost(endpoint),
        reason
      }))
    },
    onlineConnector: {
      enabled: onlineModeEnabled,
      status: !connectivity.networkAllowed
        ? connectivity.forceOffline
          ? "offline-policy-blocked"
          : "internet-unavailable"
        : externalApiEnabled
          ? "external-api-cache-enabled"
          : onlineModeEnabled
            ? "allowed-by-env-for-verified-sources"
            : "disabled",
      internetAvailable: connectivity.internetAvailable,
      forceOffline: connectivity.forceOffline,
      boundary: "Online mode should only use licensed, clinician-reviewed, approved medical sources.",
      cacheFile: "data/external/external-knowledge-cache.json",
      futureRequestReuse: externalApiEnabled
    },
    safety: {
      noDiagnosis: true,
      noPrescribing: true,
      noDoseCalculation: true,
      urgentCareOverride: true,
      clinicianReviewRequiredForMedicalFactUpdates: true
    }
  };
}

export function rankLocalMedicalKnowledge({
  query,
  focusText = "",
  records = [],
  intents = [],
  risk = {},
  routeCategories = new Set(),
  primaryCategories = new Set(),
  categoryWeightMap = {},
  categoryMap = {},
  maxMatches = 5
} = {}) {
  const { preparedRecords, corpusStats, cacheHit: corpusCacheHit, signature } = getPreparedCorpus(records);
  const queryText = normalizeText(query);
  const baseQueryTokens = tokenize(query);
  const queryExpansion = expandQueryTokens(baseQueryTokens, queryText);
  const queryTokens = queryExpansion.tokens;
  const specificityText = normalizeText(focusText || query);
  const specificityTokens = tokenize(focusText || query);
  const normalizedCategoryWeights = normalizeCategoryWeightMap(categoryWeightMap);
  const queryCacheKey = buildRankedQueryCacheKey({
    signature,
    queryText,
    focusText: specificityText,
    intents,
    risk,
    routeCategories,
    primaryCategories,
    categoryWeightMap: normalizedCategoryWeights,
    maxMatches
  });
  const cachedRanking = rankedQueryCache.get(queryCacheKey);

  if (cachedRanking) {
    touchRankedQueryCacheEntry(queryCacheKey, cachedRanking);

    return {
      ...cachedRanking,
      cacheHit: true,
      corpusCacheHit,
      queryCacheHit: true,
      runtime: getLocalAiRuntimeStatus()
    };
  }

  const queryVector = buildVector(queryTokens, corpusStats.idf);
  const queryFamilies = matchSemanticFamilies(queryTokens);
  const queryEntities = detectMedicalQueryEntities(queryText, queryTokens);
  const queryPopulationTags = detectPopulationContext(queryText);
  const numericSignals = detectNumericClinicalSignals(queryText);
  const queryFocusTags = deriveIntentFocusTags({ intents, routeCategories, primaryCategories, risk });
  const querySupportTags = dedupe([...routeCategories, ...primaryCategories].map(cleanText).filter(Boolean));
  const queryFocusTagSet = new Set(queryFocusTags.map(normalizeText));
  const querySupportTagSet = new Set(querySupportTags.map(normalizeText));
  const queryClinicalDomains = detectClinicalQueryDomains(queryText, queryTokens);
  const queryClinicalDomainSet = new Set(queryClinicalDomains.map(normalizeText));
  const explicitQueryClinicalDomains = detectExplicitClinicalQueryDomains(queryText);
  const explicitQueryClinicalDomainSet = new Set(explicitQueryClinicalDomains.map(normalizeText));
  const expectedContentTypes = deriveExpectedContentTypes({
    intents,
    routeCategories,
    primaryCategories,
    queryEntities,
    numericSignals,
    queryText,
    queryTokens,
    risk
  });
  const expectedContentTypeSet = new Set(expectedContentTypes);
  const specialistFocusedQuery = queryFocusTagSet.has(normalizeText("Specialist"));
  const strictFocus = queryFocusTags.length > 0 && !queryFocusTags.includes("General");
  const nonspecificQueryTerms = new Set([
    "track",
    "monitor",
    "question",
    "questions",
    "warning",
    "warnings",
    "sign",
    "signs",
    "serious",
    "review",
    "follow",
    "followup",
    "watch",
    "matter",
    "matters",
    "safety",
    "safe",
    "urgent",
    "care",
    "step",
    "steps",
    "health",
    "specialist",
    "focus",
    "tests",
    "testing",
    "next",
    "help"
  ]);
  const specificityEntities = detectMedicalQueryEntities(specificityText, specificityTokens);
  const specificQueryTokens = dedupe([
    ...specificityTokens.filter((token) => token.length >= 5 && !nonspecificQueryTerms.has(token)),
    ...specificityEntities.flatMap((entity) => entity.terms || []).filter((term) => term.length >= 4)
  ]);
  const queryTaskSignals = detectCareTaskSignals(specificityText || queryText, dedupe([...queryTokens, ...specificityTokens]));
  const queryTaskSignalSet = new Set(queryTaskSignals);
  const medicationFocusTokens = extractMedicationFocusTokens({
    preparedRecords,
    specificityTokens,
    specificQueryTokens,
    queryFocusTags,
    routeCategories,
    primaryCategories,
    intents
  });
  const candidateSelection = selectCandidatePreparedRecords({
    preparedRecords,
    queryTokens,
    specificQueryTokens,
    queryFamilies,
    queryEntities,
    queryFocusTags,
    querySupportTags,
    queryClinicalDomains,
    queryTaskSignals,
    numericSignals,
    medicationFocusTokens,
    expectedContentTypeSet,
    normalizedCategoryWeights,
    strictFocus,
    intents,
    risk,
    maxMatches
  });
  const candidatePreparedRecords = candidateSelection.records;

  const ranked = candidatePreparedRecords
    .map((prepared) => {
      const cosine = cosineSimilarity(queryVector, prepared.vector);
      const phraseHits = findPhraseHits(queryText, prepared.keywordPhrases);
      const tokenHits = findTokenHits(queryTokens, prepared.keywordTokens);
      const specificTokenHits = specificQueryTokens.filter((token) => prepared.tokenSet.has(token) || prepared.keywordTokenSet.has(token));
      const titleTokenHits = specificQueryTokens.filter((token) => prepared.titleTokenSet.has(token));
      const medicationFocusHits = medicationFocusTokens.filter((token) => prepared.focusTokenSet.has(token) || prepared.keywordTokenSet.has(token));
      const familyHits = prepared.semanticFamilies.filter((family) => queryFamilies.some((item) => item.id === family.id));
      const entityHits = findEntityHits(queryEntities, prepared);
      const focusTagHits = prepared.routeTags.filter((tag) => queryFocusTagSet.has(normalizeText(tag)));
      const supportTagHits = prepared.routeTags.filter((tag) => !focusTagHits.includes(tag) && querySupportTagSet.has(normalizeText(tag)));
      const contentTypeHit = expectedContentTypeSet.has(prepared.contentTypeText);
      const intentContentTypeBoost = getIntentDrivenContentTypeBoost(intents, prepared.contentTypeText);
      const domainHits = prepared.clinicalDomains.filter((domain) => queryClinicalDomainSet.has(normalizeText(domain)));
      const explicitDomainCategoryHit = specialistFocusedQuery && explicitQueryClinicalDomainSet.has(normalizeText(prepared.category));
      const explicitSpecialistDomainRequest = specialistFocusedQuery && explicitQueryClinicalDomains.length > 0;
      const taskHits = Array.isArray(prepared.taskSignals)
        ? prepared.taskSignals.filter((task) => queryTaskSignalSet.has(task))
        : [];
      const populationHits = (prepared.source.populationTags || []).filter((tag) => queryPopulationTags.includes(tag));
      const numericHits = findNumericSignalHits(numericSignals, prepared);
      const intentCategoryBoost = intents.some((intent) => (categoryMap[intent.type] || []).includes(prepared.category)) || routeCategories.has(prepared.category) ? 10 : 0;
      const primaryCategoryBoost = primaryCategories.has(prepared.category) ? 8 : 0;
      const contentTypeBoost = contentTypeHit
        ? Math.max(intentContentTypeBoost, strictFocus ? 14 : 9)
        : intentContentTypeBoost;
      const urgentBoost = risk.level && risk.level !== "LOW" && /urgent|safety/i.test(prepared.category) ? 14 : 0;
      const exactTitleBoost = queryText && prepared.titleText.includes(queryText) ? 18 : 0;
      const phraseScore = phraseHits.length * 9;
      const tokenScore = tokenHits.length * 4;
      const familyScore = familyHits.length * 5;
      const entityScore = entityHits.length * 7;
      const focusScore = focusTagHits.length * 12;
      const supportScore = focusTagHits.length ? 0 : Math.min(supportTagHits.length * 3, 6);
      const categoryWeightSignal = getPreparedCategoryWeightSignal(prepared, normalizedCategoryWeights);
      const weightedCategoryScore = Math.round(
        categoryWeightSignal * (focusTagHits.length ? 18 : strictFocus ? 14 : 10)
      );
      const domainScore = domainHits.length * (focusTagHits.length ? 8 : strictFocus ? 3 : 6);
      const taskScore = taskHits.length * (strictFocus ? 7 : 6);
      const populationScore = populationHits.length * 6;
      const numericScore = numericHits.length * 6;
      const rawSpecificityScore = Math.round(specificTokenHits.reduce((total, token) => total + (corpusStats.idf.get(token) || 1), 0) * 8);
      const rawTitleSpecificityScore = Math.round(titleTokenHits.reduce((total, token) => total + (corpusStats.idf.get(token) || 1), 0) * 10);
      const specificityScore = specialistFocusedQuery
        ? clamp(rawSpecificityScore, 0, 176)
        : rawSpecificityScore;
      const titleSpecificityScore = specialistFocusedQuery
        ? clamp(rawTitleSpecificityScore, 0, 60)
        : rawTitleSpecificityScore;
      const medicationFocusScore = Math.round(medicationFocusHits.reduce((total, token) => total + (corpusStats.idf.get(token) || 1), 0) * 12);
      const qualityBoost = clamp(Math.round(Number(prepared.source.qualityScore || 0) / 12), 0, 8);
      const semanticScore = Math.round(cosine * 58);
      const specialistDomainBoost = specialistFocusedQuery && focusTagHits.length && prepared.contentTypeText === "specialist"
        ? (explicitSpecialistDomainRequest ? 54 : 18)
          + (domainHits.length * (explicitSpecialistDomainRequest ? 18 : 10))
          + (explicitDomainCategoryHit ? (explicitSpecialistDomainRequest ? 34 : 20) : 0)
        : 0;
      const localContextPenalty = shouldDeprioritizeLocalContextRecord(prepared, queryFocusTags, routeCategories, primaryCategories)
        ? strictFocus
          ? 56
          : 28
        : 0;
      const offFocusPenalty = strictFocus && !focusTagHits.length
        ? domainHits.length
          ? 4
          : risk.level && risk.level !== "LOW"
            ? 4
            : 8
        : 0;
      const domainMissPenalty = queryClinicalDomains.length && !domainHits.length
        ? strictFocus
          ? 14
          : 8
        : 0;
      const entityMissPenalty = queryEntities.length && !entityHits.length
        ? strictFocus || queryClinicalDomains.length
          ? 12
          : 7
        : 0;
      const taskPenalty = queryTaskSignals.length && !taskHits.length
        ? strictFocus
          ? 8
          : 5
        : 0;
      const populationMissPenalty = queryPopulationTags.length && !populationHits.length ? 6 : 0;
      const specificityPenalty = specificQueryTokens.length
        ? specificTokenHits.length === 0
          ? 18
          : specificTokenHits.length === 1 && specificQueryTokens.length >= 2
            ? 6
            : 0
        : 0;
      const specialistOffFocusPenalty = specialistFocusedQuery && !focusTagHits.length && prepared.contentTypeText !== "specialist"
        ? explicitSpecialistDomainRequest
          ? domainHits.length
            ? 92
            : 116
          : domainHits.length
            ? 36
            : 44
        : 0;
      const medicationFocusPenalty = medicationFocusTokens.length && isMedicationKnowledgeRecord(prepared)
        ? medicationFocusHits.length === 0
          ? 22
          : 0
        : 0;
      const weightedCategoryPenalty = strictFocus && Object.keys(normalizedCategoryWeights).length && categoryWeightSignal < 0.12
        ? 6
        : 0;
      const broadRouteBoost = intentCategoryBoost + primaryCategoryBoost;
      const routeAlignmentBoost = focusTagHits.length
        ? broadRouteBoost
        : strictFocus
          ? Math.round(broadRouteBoost * 0.25)
          : broadRouteBoost;
      const rawScore =
        semanticScore +
          phraseScore +
          tokenScore +
          familyScore +
          entityScore +
          focusScore +
          supportScore +
          weightedCategoryScore +
          domainScore +
          taskScore +
          populationScore +
          numericScore +
          specificityScore +
          titleSpecificityScore +
          medicationFocusScore +
          specialistDomainBoost +
          qualityBoost +
          routeAlignmentBoost +
          contentTypeBoost +
          urgentBoost +
          exactTitleBoost -
          offFocusPenalty -
          domainMissPenalty -
          entityMissPenalty -
          taskPenalty -
          populationMissPenalty -
          specificityPenalty -
          specialistOffFocusPenalty -
          localContextPenalty -
          medicationFocusPenalty -
          weightedCategoryPenalty;
      const relevance = clamp(rawScore, 0, 99);

      return {
        ...prepared.source,
        relevance,
        rankingScore: rawScore,
        matchedTerms: dedupe([...phraseHits, ...tokenHits, ...entityHits.map((entity) => entity.label), ...numericHits]).slice(0, 8),
        semanticFamilies: familyHits.map((family) => family.label),
        medicalEntities: entityHits.map((entity) => entity.label),
        routeTagHits: focusTagHits,
        clinicalDomainHits: domainHits,
        taskSignalHits: taskHits,
        contentTypeHit,
        populationMatches: populationHits,
        numericSignals: numericHits,
        evidenceGrade: relevance >= 82 ? "strong" : relevance >= 64 ? "good" : relevance >= 42 ? "supporting" : "weak",
        localModelScore: {
          semantic: semanticScore,
          phrases: phraseScore,
          tokens: tokenScore,
          family: familyScore,
          entity: entityScore,
          focus: focusScore,
          support: supportScore,
          routeWeighted: weightedCategoryScore,
          domain: domainScore,
          task: taskScore,
          population: populationScore,
          numeric: numericScore,
          specific: specificityScore,
          titleSpecific: titleSpecificityScore,
          medicationExact: medicationFocusScore,
          specialist: specialistDomainBoost,
          quality: qualityBoost,
          route: routeAlignmentBoost,
          contentType: contentTypeBoost,
          safety: urgentBoost,
          penalty: offFocusPenalty + domainMissPenalty + entityMissPenalty + taskPenalty + populationMissPenalty + specificityPenalty + specialistOffFocusPenalty + localContextPenalty + medicationFocusPenalty + weightedCategoryPenalty,
          raw: rawScore
        }
      };
    })
    .filter((record) => record.relevance > 0)
    .sort((left, right) =>
      (right.relevance - left.relevance)
      || ((right.rankingScore || 0) - (left.rankingScore || 0))
      || ((right.localModelScore?.focus || 0) - (left.localModelScore?.focus || 0))
      || ((right.routeTagHits?.length || 0) - (left.routeTagHits?.length || 0))
      || ((right.localModelScore?.task || 0) - (left.localModelScore?.task || 0))
      || ((right.localModelScore?.domain || 0) - (left.localModelScore?.domain || 0))
      || ((right.localModelScore?.specific || 0) - (left.localModelScore?.specific || 0))
      || ((right.localModelScore?.entity || 0) - (left.localModelScore?.entity || 0))
      || ((right.localModelScore?.titleSpecific || 0) - (left.localModelScore?.titleSpecific || 0))
      || ((right.localModelScore?.medicationExact || 0) - (left.localModelScore?.medicationExact || 0))
      || ((right.localModelScore?.phrases || 0) - (left.localModelScore?.phrases || 0))
      || ((right.clinicalDomainHits?.length || 0) - (left.clinicalDomainHits?.length || 0))
      || ((right.localModelScore?.tokens || 0) - (left.localModelScore?.tokens || 0))
      || ((right.populationMatches?.length || 0) - (left.populationMatches?.length || 0))
      || ((right.medicalEntities?.length || 0) - (left.medicalEntities?.length || 0))
      || (Number(right.qualityScore || 0) - Number(left.qualityScore || 0))
      || left.title.localeCompare(right.title)
    );

  const matches = ranked.slice(0, maxMatches);
  const topMatchMargin = matches.length > 1
    ? Math.max(0, Number(matches[0]?.rankingScore || matches[0]?.relevance || 0) - Number(matches[1]?.rankingScore || matches[1]?.relevance || 0))
    : Number(matches[0]?.rankingScore || matches[0]?.relevance || 0);
  const sourceFamilyDiversity = new Set(matches.map((match) => cleanText(match.sourceFamily || match.source))).size;
  const categoryDiversity = new Set(matches.map((match) => cleanText(match.category))).size;
  const topMatchScore = Number(matches[0]?.relevance || 0);
  let ambiguityPenalty = 0;

  if (matches.length > 1) {
    if (topMatchMargin <= 2) {
      ambiguityPenalty += 12;
    } else if (topMatchMargin <= 5) {
      ambiguityPenalty += 8;
    } else if (topMatchMargin <= 9) {
      ambiguityPenalty += 4;
    }
  }

  if (categoryDiversity >= 6) {
    ambiguityPenalty += 8;
  } else if (categoryDiversity >= 4) {
    ambiguityPenalty += 5;
  } else if (categoryDiversity >= 3) {
    ambiguityPenalty += 2;
  }

  if (sourceFamilyDiversity >= 3) {
    ambiguityPenalty += 4;
  } else if (sourceFamilyDiversity >= 2 && topMatchMargin <= 5) {
    ambiguityPenalty += 2;
  }

  if (topMatchScore > 0 && topMatchScore < 74) {
    ambiguityPenalty += 4;
  }

  ambiguityPenalty = clamp(ambiguityPenalty, 0, 24);

  const ambiguityAdjustedMax = matches.length
    ? Math.max(55, 99 - ambiguityPenalty)
    : 99;
  const coverageScore = matches.length
    ? clamp(
      Math.round(matches.reduce((total, item) => total + item.relevance, 0) / matches.length) + Math.min(matches.length * 5, 18) - ambiguityPenalty,
      35,
      ambiguityAdjustedMax
    )
    : 35;

  const result = {
    id: "LOCAL_CLINICAL_ML_RANKER",
    version: LOCAL_AI_CORE_VERSION,
    mode: "offline-tfidf-entity-semantic-route-ranker",
    queryFamilies: queryFamilies.map((family) => family.label),
    queryFocusTags,
    queryContentTypes: expectedContentTypes,
    queryClinicalDomains,
    queryExplicitClinicalDomains: explicitQueryClinicalDomains,
    queryEntities: queryEntities.map((entity) => entity.label),
    queryPopulationTags,
    queryTaskSignals,
    numericSignals,
    queryTokenCount: baseQueryTokens.length,
    expandedQueryTokenCount: queryTokens.length,
    synonymExpansions: queryExpansion.expandedFrom,
    rankingDiagnostics: {
      topMatchMargin,
      topMatchScore,
      sourceFamilyDiversity,
      categoryDiversity,
      ambiguityPenalty,
      ambiguousTopSet: ambiguityPenalty >= 10,
      weightedCategoryCount: Object.keys(normalizedCategoryWeights).length,
      candidateCount: candidatePreparedRecords.length,
      candidateShare: records.length ? Number((candidatePreparedRecords.length / records.length).toFixed(4)) : 1
    },
    corpusSize: records.length,
    candidateCount: candidatePreparedRecords.length,
    prefiltered: candidateSelection.reduced,
    candidateReduction: candidateSelection.reduction,
    cacheHit: corpusCacheHit,
    corpusCacheHit,
    queryCacheHit: false,
    coverageScore,
    matches,
      runtime: getLocalAiRuntimeStatus(),
    scoring: {
      method: "local lexical vector similarity + conservative route-focused candidate prefilter + phrase match + title specificity + synonym expansion + exact-query specificity + medical entity alignment + clinical-domain fit + task-intent alignment + population-context alignment + numeric vital/lab signal matching + semantic family match + weighted route-category boost + urgent-safety boost + ambiguity penalty for near-tied evidence",
      internetRequired: false,
      sameOnlineOfflineEngine: true,
      patientDataTraining: false
    }
  };

  rankedQueryCache.set(queryCacheKey, {
    ...result,
    runtime: null
  });
  pruneRankedQueryCache();

  return result;
}

export function warmLocalMedicalCorpus(records = []) {
  return getPreparedCorpus(records);
}

function getPreparedCorpus(records = []) {
  const referenceCached = preparedCorpusByReference.get(records);

  if (referenceCached) {
    return {
      ...referenceCached,
      cacheHit: true
    };
  }

  const signature = buildCorpusSignature(records);
  const signatureCached = preparedCorpusBySignature.get(signature);

  if (signatureCached) {
    preparedCorpusByReference.set(records, signatureCached);
    return {
      ...signatureCached,
      cacheHit: true
    };
  }

  const preparedRecords = records.map((record) => materializePreparedRecord(record));
  const corpusStats = buildCorpusStats(preparedRecords);
  const preparedCorpus = {
    preparedRecords,
    corpusStats,
    signature
  };

  preparedCorpusByReference.set(records, preparedCorpus);
  preparedCorpusBySignature.set(signature, preparedCorpus);
  prunePreparedCorpusCache();

  return {
    ...preparedCorpus,
    cacheHit: false
  };
}

function buildCorpusSignature(records = []) {
  const digest = createHash("sha1");

  for (const record of records) {
    digest.update(getKnowledgeRecordSignature(record));
    digest.update("\u001e");
  }

  return digest.digest("hex");
}

function materializePreparedRecord(record = {}) {
  return {
    ...getPreparedRecordTemplate(record),
    vector: null
  };
}

function getPreparedRecordTemplate(record = {}) {
  if (!record || typeof record !== "object") {
    return buildPreparedRecordTemplate({});
  }

  const referenceCached = preparedRecordTemplateByReference.get(record);

  if (referenceCached) {
    return referenceCached;
  }

  const signature = getKnowledgeRecordSignature(record);
  const signatureCached = preparedRecordTemplateBySignature.get(signature);

  if (signatureCached) {
    preparedRecordTemplateByReference.set(record, signatureCached);
    return signatureCached;
  }

  const template = buildPreparedRecordTemplate(record);

  preparedRecordTemplateByReference.set(record, template);
  preparedRecordTemplateBySignature.set(signature, template);
  prunePreparedRecordTemplateCache();

  return template;
}

function getKnowledgeRecordSignature(record = {}) {
  if (!record || typeof record !== "object") {
    return "";
  }

  const cached = knowledgeRecordSignatureCache.get(record);

  if (cached) {
    return cached;
  }

  const sharedSignatureParts = [
    cleanText(record?.title),
    cleanText(record?.category),
    cleanText(record?.contentType),
    Array.isArray(record?.keywords) ? record.keywords.map(cleanText).join(",") : "",
    Array.isArray(record?.aliases) ? record.aliases.map(cleanText).join(",") : "",
    Array.isArray(record?.relatedTerms) ? record.relatedTerms.map(cleanText).join(",") : "",
    Array.isArray(record?.routeTags) ? record.routeTags.map(cleanText).join(",") : "",
    Array.isArray(record?.clinicalDomains) ? record.clinicalDomains.map(cleanText).join(",") : "",
    Array.isArray(record?.populationTags) ? record.populationTags.map(cleanText).join(",") : "",
    cleanText(record?.summary),
    cleanText(record?.safetyNotes),
    Array.isArray(record?.whatToTrack) ? record.whatToTrack.map(cleanText).join(",") : "",
    Array.isArray(record?.careQuestions) ? record.careQuestions.map(cleanText).join(",") : "",
    Array.isArray(record?.precautions) ? record.precautions.map(cleanText).join(",") : "",
    Array.isArray(record?.redFlagTerms) ? record.redFlagTerms.map(cleanText).join(",") : "",
    Array.isArray(record?.queryPrompts) ? record.queryPrompts.map(cleanText).join(",") : "",
    Array.isArray(record?.sourceReferences) ? record.sourceReferences.map(cleanText).join(",") : "",
    Array.isArray(record?.maintenanceTags) ? record.maintenanceTags.map(cleanText).join(",") : "",
    Array.isArray(record?.evidenceSignals) ? record.evidenceSignals.map(cleanText).join(",") : "",
    cleanText(record?.qualityScore),
    cleanText(record?.sections?.overview),
    Array.isArray(record?.sections?.whatToTrack) ? record.sections.whatToTrack.map(cleanText).join(",") : "",
    Array.isArray(record?.sections?.careQuestions) ? record.sections.careQuestions.map(cleanText).join(",") : "",
    Array.isArray(record?.sections?.precautions) ? record.sections.precautions.map(cleanText).join(",") : "",
    Array.isArray(record?.sections?.sourceReferences) ? record.sections.sourceReferences.map(cleanText).join(",") : "",
    cleanText(record?.sourceFamily),
    cleanText(record?.sourceMode),
    cleanText(record?.evidenceLevel),
    cleanText(record?.verificationStatus),
    cleanText(record?.retrievalText)
  ];
  const signature = isLocalContextKnowledgeEntry(record)
    ? ["local-context", ...sharedSignatureParts].join("\u001f")
    : [cleanText(record?.id), ...sharedSignatureParts, cleanText(record?.source)].join("\u001f");

  knowledgeRecordSignatureCache.set(record, signature);
  return signature;
}

function buildRankedQueryCacheKey({ signature, queryText, focusText = "", intents, risk, routeCategories, primaryCategories, categoryWeightMap = {}, maxMatches }) {
  const intentSignature = [...(intents || [])]
    .map((intent) => [
      cleanText(intent?.type),
      cleanText(intent?.route),
      Math.round(Number(intent?.confidence || 0) * 100)
    ].join(":"))
    .sort()
    .join("|");
  const categoryWeightSignature = Object.entries(categoryWeightMap || {})
    .map(([category, score]) => `${cleanText(category)}:${Math.round(Number(score || 0) * 100)}`)
    .sort()
    .join("|");

  return [
    signature,
    queryText,
    cleanText(focusText),
    cleanText(risk?.level || "LOW"),
    Array.from(routeCategories || []).map(cleanText).sort().join("|"),
    Array.from(primaryCategories || []).map(cleanText).sort().join("|"),
    categoryWeightSignature,
    intentSignature,
    cleanText(maxMatches)
  ].join("\u001d");
}

function isMedicationKnowledgeRecord(prepared = {}) {
  const category = normalizeText(prepared.category);
  const routeTags = prepared.routeTagSet instanceof Set
    ? [...prepared.routeTagSet]
    : Array.isArray(prepared.routeTags)
      ? prepared.routeTags.map(normalizeText)
      : [];

  return category.includes("medication") || routeTags.some((tag) => tag.includes("medication"));
}

function isUrgentSafetyKnowledgeRecord(prepared = {}) {
  const category = normalizeText(prepared.category);
  return category.includes("urgent") || category.includes("safety") || prepared.routeTagSet?.has(normalizeText("Urgent Safety"));
}

function isLocalContextKnowledgeEntry(entry = {}) {
  const sourceMode = cleanText(entry?.sourceMode).toLowerCase();
  const sourceFamily = cleanText(entry?.sourceFamily).toLowerCase();
  return sourceMode.startsWith("offline-local-")
    || sourceFamily.startsWith("patient-")
    || sourceFamily === "local-context";
}

function shouldDeprioritizeLocalContextRecord(prepared = {}, queryFocusTags = [], routeCategories = new Set(), primaryCategories = new Set()) {
  if (!isLocalContextKnowledgeEntry(prepared.source || prepared)) {
    return false;
  }

  const allowedTags = new Set(["Records", "Care Transitions", "Follow-up", "Insurance", "Claims Operations", "Utilization Management"]);
  const focusAllowsLocalContext = queryFocusTags.some((tag) => allowedTags.has(tag))
    || [...routeCategories, ...primaryCategories].some((tag) => allowedTags.has(tag));

  if (focusAllowsLocalContext) {
    return false;
  }

  return !(primaryCategories.has("Vitals") && normalizeText(prepared.category) === normalizeText("Vitals"));
}

function extractMedicationFocusTokens({
  preparedRecords = [],
  specificityTokens = [],
  specificQueryTokens = [],
  queryFocusTags = [],
  routeCategories = new Set(),
  primaryCategories = new Set(),
  intents = []
} = {}) {
  const medicationIntentFocused = intents.some((intent) => intent?.type === "MEDICATION" || intent?.route === "PHARMACY_AGENT");
  const medicationRouteFocused = queryFocusTags.some((tag) => normalizeText(tag).includes("medication"))
    || [...primaryCategories].some((category) => normalizeText(category).includes("medication"));
  const lexicalMedicationFocused = specificityTokens.some((token) => medicationActivationTerms.has(token));
  const medicationFocusedQuery = medicationIntentFocused || (medicationRouteFocused && lexicalMedicationFocused);

  if (!medicationFocusedQuery) {
    return [];
  }

  const candidates = dedupe([...specificityTokens, ...specificQueryTokens])
    .filter((token) => token.length >= 4 && !medicationFocusStopWords.has(token));

  return candidates.filter((token) =>
    preparedRecords.some((record) => isMedicationKnowledgeRecord(record) && record.focusTokenSet?.has(token))
  );
}

function selectCandidatePreparedRecords({
  preparedRecords = [],
  queryTokens = [],
  specificQueryTokens = [],
  queryFamilies = [],
  queryEntities = [],
  queryFocusTags = [],
  querySupportTags = [],
  queryClinicalDomains = [],
  queryTaskSignals = [],
  numericSignals = [],
  medicationFocusTokens = [],
  expectedContentTypeSet = new Set(),
  normalizedCategoryWeights = {},
  strictFocus = false,
  intents = [],
  risk = {},
  maxMatches = 5
} = {}) {
  if (!preparedRecords.length) {
    return {
      records: [],
      reduced: false,
      reduction: 0
    };
  }

  const broadQuery = !strictFocus
    && !queryFamilies.length
    && !queryEntities.length
    && !queryClinicalDomains.length
    && !specificQueryTokens.length
    && !medicationFocusTokens.length;

  if (broadQuery) {
    return {
      records: preparedRecords,
      reduced: false,
      reduction: 0
    };
  }

  const focusTagSet = new Set(queryFocusTags.map(normalizeText).filter(Boolean));
  const supportTagSet = new Set(querySupportTags.map(normalizeText).filter(Boolean));
  const familyIdSet = new Set(queryFamilies.map((family) => cleanText(family?.id)).filter(Boolean));
  const clinicalDomainSet = new Set(queryClinicalDomains.map(normalizeText).filter(Boolean));
  const taskSignalSet = new Set(queryTaskSignals.map(cleanText).filter(Boolean));
  const queryTokenSet = new Set(queryTokens.map(cleanText).filter(Boolean));
  const highRisk = Boolean(risk?.level && risk.level !== "LOW");
  const minimumCandidateCount = Math.min(
    preparedRecords.length,
    strictFocus ? Math.max(maxMatches * 3, 24) : Math.max(maxMatches * 3, 15)
  );
  const maximumCandidateCount = Math.min(
    preparedRecords.length,
    strictFocus ? Math.max(maxMatches * 12, 64) : Math.max(maxMatches * 14, 42)
  );
  const signalRichness =
    queryEntities.length
    + queryClinicalDomains.length
    + queryFamilies.length
    + queryTaskSignals.length
    + Math.min(specificQueryTokens.length, 4)
    + Math.min(medicationFocusTokens.length, 2);
  const targetCandidateCount = clamp(
    minimumCandidateCount + signalRichness * (strictFocus ? 3 : 4),
    minimumCandidateCount,
    maximumCandidateCount
  );
  const evaluated = preparedRecords
    .map((prepared) => {
      const normalizedCategory = normalizeText(prepared.category);
      const focusTagHits = countSetIntersection(prepared.routeTagSet, focusTagSet) + (focusTagSet.has(normalizedCategory) ? 1 : 0);
      const supportTagHits = countSetIntersection(prepared.routeTagSet, supportTagSet) + (supportTagSet.has(normalizedCategory) ? 1 : 0);
      const familyHits = prepared.semanticFamilies.reduce((total, family) => total + (familyIdSet.has(cleanText(family?.id)) ? 1 : 0), 0);
      const entityHits = findEntityHits(queryEntities, prepared).length;
      const domainHits = countSetIntersection(prepared.clinicalDomainSet, clinicalDomainSet);
      const taskHits = countArrayIntersection(prepared.taskSignals, taskSignalSet);
      const specificHits = countPreparedTokenMatches(specificQueryTokens, prepared);
      const medicationHits = countPreparedTokenMatches(medicationFocusTokens, prepared, "focus");
      const tokenHits = countSetIntersection(prepared.keywordTokenSet, queryTokenSet);
      const contentTypeHit = expectedContentTypeSet.has(prepared.contentTypeText);
      const intentContentTypeBoost = getIntentDrivenContentTypeBoost(intents, prepared.contentTypeText);
      const numericHitCount = numericSignals.length ? findNumericSignalHits(numericSignals, prepared).length : 0;
      const categoryWeightSignal = getPreparedCategoryWeightSignal(prepared, normalizedCategoryWeights);
      const urgentBoost = highRisk && isUrgentSafetyKnowledgeRecord(prepared) ? 6 : 0;
      const contentTypeScore =
        (contentTypeHit ? (strictFocus ? 12 : 8) : 0)
        + intentContentTypeBoost;
      const candidateScore =
        (focusTagHits * 14)
        + (supportTagHits * 5)
        + (familyHits * 6)
        + (entityHits * 7)
        + (domainHits * 7)
        + (taskHits * 5)
        + Math.min(specificHits * 6, 18)
        + Math.min(medicationHits * 7, 14)
        + Math.min(tokenHits * 2, 8)
        + contentTypeScore
        + (numericHitCount * 4)
        + Math.round(categoryWeightSignal * 18)
        + urgentBoost
        + Math.min(Number(prepared.source?.qualityScore || 0) / 30, 3);
      const directSignal = Boolean(
        focusTagHits
        || supportTagHits
        || familyHits
        || entityHits
        || domainHits
        || taskHits
        || specificHits
        || medicationHits
        || contentTypeHit
        || intentContentTypeBoost
        || numericHitCount
        || categoryWeightSignal >= 0.18
      );

      return {
        prepared,
        candidateScore,
        directSignal,
        focusTagHits,
        entityHits,
        domainHits,
        taskHits,
        specificHits,
        contentTypeHit,
        intentContentTypeBoost,
        categoryWeightSignal
      };
    })
    .sort((left, right) =>
      (right.candidateScore - left.candidateScore)
      || ((right.focusTagHits || 0) - (left.focusTagHits || 0))
      || ((right.entityHits || 0) - (left.entityHits || 0))
      || ((right.domainHits || 0) - (left.domainHits || 0))
      || ((right.taskHits || 0) - (left.taskHits || 0))
      || ((right.specificHits || 0) - (left.specificHits || 0))
      || ((right.intentContentTypeBoost || 0) - (left.intentContentTypeBoost || 0))
      || (Number(right.contentTypeHit === true) - Number(left.contentTypeHit === true))
      || ((right.categoryWeightSignal || 0) - (left.categoryWeightSignal || 0))
      || (Number(right.prepared?.source?.qualityScore || 0) - Number(left.prepared?.source?.qualityScore || 0))
      || String(left.prepared?.source?.title || left.prepared?.titleText || "").localeCompare(
        String(right.prepared?.source?.title || right.prepared?.titleText || "")
      )
    );

  const strongestSignalScore = Number(evaluated[0]?.candidateScore || 0);

  if (strongestSignalScore <= 0) {
    return {
      records: preparedRecords,
      reduced: false,
      reduction: 0
    };
  }

  const directSignalCount = evaluated.filter((item) => item.directSignal).length;
  const effectiveTargetCount = Math.max(
    minimumCandidateCount,
    Math.min(
      maximumCandidateCount,
      directSignalCount > targetCandidateCount && directSignalCount <= maximumCandidateCount
        ? directSignalCount
        : targetCandidateCount
    )
  );
  const selected = evaluated.slice(0, effectiveTargetCount).map((item) => item.prepared);

  if (selected.length >= preparedRecords.length) {
    return {
      records: preparedRecords,
      reduced: false,
      reduction: 0
    };
  }

  return {
    records: selected,
    reduced: true,
    reduction: Number(((preparedRecords.length - selected.length) / preparedRecords.length).toFixed(4))
  };
}

function touchRankedQueryCacheEntry(key, value) {
  rankedQueryCache.delete(key);
  rankedQueryCache.set(key, value);
}

function prunePreparedCorpusCache() {
  while (preparedCorpusBySignature.size > maxCorpusCacheEntries) {
    const oldestKey = preparedCorpusBySignature.keys().next().value;
    preparedCorpusBySignature.delete(oldestKey);
  }
}

function prunePreparedRecordTemplateCache() {
  while (preparedRecordTemplateBySignature.size > maxPreparedRecordTemplateCacheEntries) {
    const oldestKey = preparedRecordTemplateBySignature.keys().next().value;
    preparedRecordTemplateBySignature.delete(oldestKey);
  }
}

function pruneRankedQueryCache() {
  while (rankedQueryCache.size > maxRankedQueryCacheEntries) {
    const oldestKey = rankedQueryCache.keys().next().value;
    rankedQueryCache.delete(oldestKey);
  }
}

function buildPreparedRecordTemplate(record = {}) {
  const title = cleanText(record.title);
  const category = cleanText(record.category);
  const contentType = cleanText(record.contentType);
  const keywords = Array.isArray(record.keywords) ? record.keywords.map(cleanText).filter(Boolean) : [];
  const aliases = Array.isArray(record.aliases) ? record.aliases.map(cleanText).filter(Boolean) : [];
  const relatedTerms = Array.isArray(record.relatedTerms) ? record.relatedTerms.map(cleanText).filter(Boolean) : [];
  const routeTags = Array.isArray(record.routeTags) ? record.routeTags.map(cleanText).filter(Boolean) : [];
  const clinicalDomains = Array.isArray(record.clinicalDomains) ? record.clinicalDomains.map(cleanText).filter(Boolean) : [];
  const populationTags = Array.isArray(record.populationTags) ? record.populationTags.map(cleanText).filter(Boolean) : [];
  const summary = cleanText(record.summary);
  const safetyNotes = cleanText(record.safetyNotes);
  const whatToTrack = Array.isArray(record.whatToTrack) ? record.whatToTrack.map(cleanText).filter(Boolean) : [];
  const careQuestions = Array.isArray(record.careQuestions) ? record.careQuestions.map(cleanText).filter(Boolean) : [];
  const precautions = Array.isArray(record.precautions) ? record.precautions.map(cleanText).filter(Boolean) : [];
  const redFlagTerms = Array.isArray(record.redFlagTerms) ? record.redFlagTerms.map(cleanText).filter(Boolean) : [];
  const queryPrompts = Array.isArray(record.queryPrompts) ? record.queryPrompts.map(cleanText).filter(Boolean) : [];
  const sourceReferences = Array.isArray(record.sourceReferences) ? record.sourceReferences.map(cleanText).filter(Boolean) : [];
  const maintenanceTags = Array.isArray(record.maintenanceTags) ? record.maintenanceTags.map(cleanText).filter(Boolean) : [];
  const evidenceSignals = Array.isArray(record.evidenceSignals) ? record.evidenceSignals.map(cleanText).filter(Boolean) : [];
  const qualityScore = Number.isFinite(Number(record.qualityScore)) ? Number(record.qualityScore) : 0;
  const sectionOverview = cleanText(record.sections?.overview);
  const sectionTracking = Array.isArray(record.sections?.whatToTrack) ? record.sections.whatToTrack.map(cleanText).filter(Boolean) : [];
  const sectionQuestions = Array.isArray(record.sections?.careQuestions) ? record.sections.careQuestions.map(cleanText).filter(Boolean) : [];
  const sectionPrecautions = Array.isArray(record.sections?.precautions) ? record.sections.precautions.map(cleanText).filter(Boolean) : [];
  const sectionSources = Array.isArray(record.sections?.sourceReferences) ? record.sections.sourceReferences.map(cleanText).filter(Boolean) : [];
  const retrievalText = cleanText(record.retrievalText);
  const sourceFamily = cleanText(record.sourceFamily);
  const evidenceLevel = cleanText(record.evidenceLevel);
  const verificationStatus = cleanText(record.verificationStatus);
  const titleTokens = tokenize(title);
  const source = {
    ...record,
    title,
    category,
    contentType,
    keywords,
    aliases,
    relatedTerms,
    routeTags,
    clinicalDomains,
    populationTags,
    summary,
    safetyNotes,
    whatToTrack,
    careQuestions,
    precautions,
    redFlagTerms,
    queryPrompts,
    sourceReferences,
    maintenanceTags,
    evidenceSignals,
    qualityScore,
    sections: {
      overview: sectionOverview,
      whatToTrack: sectionTracking,
      careQuestions: sectionQuestions,
      precautions: sectionPrecautions,
      sourceReferences: sectionSources
    },
    retrievalText,
    sourceFamily,
    evidenceLevel,
    verificationStatus
  };
  const text = normalizeText([
    title,
    category,
    contentType,
    keywords.join(" "),
    aliases.join(" "),
    relatedTerms.join(" "),
    routeTags.join(" "),
    clinicalDomains.join(" "),
    populationTags.join(" "),
    summary,
    safetyNotes,
    whatToTrack.join(" "),
    careQuestions.join(" "),
    precautions.join(" "),
    redFlagTerms.join(" "),
    queryPrompts.join(" "),
    sourceReferences.join(" "),
    maintenanceTags.join(" "),
    evidenceSignals.join(" "),
    String(qualityScore),
    sectionOverview,
    sectionTracking.join(" "),
    sectionQuestions.join(" "),
    sectionPrecautions.join(" "),
    sectionSources.join(" "),
    record.source,
    sourceFamily,
    evidenceLevel,
    verificationStatus,
    retrievalText
  ].join(" "));
  const tokens = tokenize(text);
  const focusTokens = dedupe([title, ...keywords, ...aliases, ...maintenanceTags].flatMap(tokenize));
  const keywordTokens = dedupe([...keywords, ...aliases, ...relatedTerms, ...routeTags, ...clinicalDomains, ...redFlagTerms, ...sourceReferences, ...maintenanceTags, ...evidenceSignals].flatMap(tokenize));
  const keywordPhrases = collectRecordKeywordPhrases({
    title,
    keywords,
    aliases,
    relatedTerms,
    redFlagTerms,
    queryPrompts,
    careQuestions,
    precautions,
    sectionOverview,
    sectionQuestions,
    sectionPrecautions
  });
  const taskSignals = detectRecordTaskSignals(source, text, tokens);

  return {
    source,
    titleText: normalizeText(title),
    titleTokens,
    titleTokenSet: new Set(titleTokens),
    category,
    contentTypeText: normalizeText(contentType),
    routeTags,
    routeTagSet: new Set(routeTags.map(normalizeText)),
    clinicalDomains,
    clinicalDomainSet: new Set(clinicalDomains.map(normalizeText)),
    text,
    tokens,
    tokenSet: new Set(tokens),
    focusTokenSet: new Set(focusTokens),
    keywordPhrases,
    keywordTokens,
    keywordTokenSet: new Set(keywordTokens),
    semanticFamilies: matchSemanticFamilies(tokens),
    taskSignals
  };
}

function collectRecordKeywordPhrases(fields = {}) {
  return dedupe(
    Object.values(fields)
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => normalizeText(value))
      .filter((phrase) => phrase.includes(" "))
      .filter((phrase) => phrase.length >= 7 && phrase.length <= 96)
  ).slice(0, 28);
}

function detectCareTaskSignals(queryText, queryTokens = []) {
  const tokenSet = new Set(queryTokens);

  return careTaskSignalDefinitions
    .filter((definition) => definition.queryTerms.some((term) => {
      const normalized = normalizeText(term);
      return normalized.includes(" ")
        ? queryText.includes(normalized)
        : tokenSet.has(normalized);
    }))
    .map((definition) => definition.id);
}

function detectRecordTaskSignals(source = {}, text = "", tokens = []) {
  const tokenSet = new Set(tokens);
  const structuralSignals = {
    monitoring: Boolean((source.whatToTrack || []).length || (source.sections?.whatToTrack || []).length),
    precautions: Boolean((source.precautions || []).length || (source.sections?.precautions || []).length || source.safetyNotes || (source.redFlagTerms || []).length),
    testing: Boolean((source.careQuestions || []).length || (source.queryPrompts || []).length),
    explanation: Boolean(source.summary || source.sections?.overview),
    documentation: /summary|doctor note|handoff|record|packet|share ready/i.test(text),
    prevention: /prevent|prevention|lifestyle|risk reduction/i.test(text)
  };

  return careTaskSignalDefinitions
    .filter((definition) => structuralSignals[definition.id] || definition.recordTerms.some((term) => {
      const normalized = normalizeText(term);
      return normalized.includes(" ")
        ? text.includes(normalized)
        : tokenSet.has(normalized);
    }))
    .map((definition) => definition.id);
}

function buildCorpusStats(records) {
  const documentFrequency = new Map();

  for (const record of records) {
    const uniqueTerms = new Set(record.tokens);
    for (const term of uniqueTerms) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  }

  const idf = new Map();
  const totalDocuments = Math.max(records.length, 1);

  for (const [term, count] of documentFrequency) {
    idf.set(term, Math.log((totalDocuments + 1) / (count + 1)) + 1);
  }

  for (const record of records) {
    record.vector = buildVector(record.tokens, idf);
  }

  return { idf };
}

function buildVector(tokens, idf) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  const vector = new Map();
  const length = Math.max(tokens.length, 1);

  for (const [token, count] of counts) {
    vector.set(token, (count / length) * (idf.get(token) || 1));
  }

  return vector;
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (const value of left.values()) {
    leftMagnitude += value * value;
  }

  for (const value of right.values()) {
    rightMagnitude += value * value;
  }

  for (const [term, value] of left) {
    dot += value * (right.get(term) || 0);
  }

  if (!leftMagnitude || !rightMagnitude) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function findPhraseHits(queryText, phrases) {
  return phrases.filter((phrase) => phrase && queryText.includes(phrase));
}

function findTokenHits(queryTokens, keywordTokens) {
  const querySet = new Set(queryTokens);
  return keywordTokens.filter((token) => querySet.has(token));
}

function matchSemanticFamilies(tokens) {
  const tokenSet = new Set(tokens);
  return semanticFamilies.filter((family) => family.terms.some((term) => tokenSet.has(term)));
}

function expandQueryTokens(tokens, queryText) {
  const tokenSet = new Set(tokens);
  const expandedFrom = [];

  for (const group of medicalEntityGroups) {
    const matched = group.triggers.some((trigger) => {
      const normalizedTrigger = normalizeText(trigger);
      return normalizedTrigger.includes(" ")
        ? queryText.includes(normalizedTrigger)
        : tokenSet.has(normalizedTrigger);
    });

    if (!matched) {
      continue;
    }

    expandedFrom.push(group.label);
    for (const token of group.expansions.flatMap(tokenize)) {
      tokenSet.add(token);
    }
  }

  return {
    tokens: Array.from(tokenSet),
    expandedFrom
  };
}

function detectMedicalQueryEntities(queryText, queryTokens) {
  const tokenSet = new Set(queryTokens);

  return medicalEntityGroups
    .map((group) => {
      const matchedTriggers = group.triggers.filter((trigger) => {
        const normalizedTrigger = normalizeText(trigger);
        return normalizedTrigger.includes(" ")
          ? queryText.includes(normalizedTrigger)
          : tokenSet.has(normalizedTrigger);
      });

      return matchedTriggers.length
        ? {
          id: group.id,
          label: group.label,
          categories: group.categories,
          terms: dedupe([...matchedTriggers, ...group.expansions.flatMap(tokenize)])
        }
        : null;
    })
    .filter(Boolean);
}

function findEntityHits(queryEntities, prepared) {
  return queryEntities.filter((entity) => {
    const categoryHit = entity.categories.some((category) =>
      category === prepared.category || prepared.routeTagSet.has(normalizeText(category))
    );
    const tokenHit = entity.terms.some((term) => prepared.tokenSet.has(term) || prepared.keywordTokenSet.has(term));

    return categoryHit || tokenHit;
  });
}

function deriveIntentFocusTags({ intents = [], routeCategories = new Set(), primaryCategories = new Set(), risk = {} }) {
  const focusTags = intents.flatMap((intent) => intentFocusTagsByIntent[intent.type] || []);
  const mentalWellnessFocused = intents.some((intent) => intent?.type === "MENTAL_WELLNESS");

  if (mentalWellnessFocused && risk.level && risk.level !== "LOW" && !focusTags.includes("Urgent Safety")) {
    focusTags.push("Urgent Safety");
  }

  if (!focusTags.length) {
    if (risk.level && risk.level !== "LOW") {
      focusTags.push("Urgent Safety");
    } else {
      for (const tag of [...primaryCategories, ...routeCategories]) {
        if ([
          "Specialist",
          "Labs",
          "Medication",
          "Vitals",
          "Lifestyle",
          "Mental Wellness",
          "Records",
          "Care Transitions",
          "Follow-up",
          "Insurance",
          "Claims Operations",
          "Utilization Management",
          "GxP Quality",
          "MedTech Compliance"
        ].includes(tag)) {
          focusTags.push(tag);
        }
      }
    }
  }

  return dedupe(focusTags.map(cleanText).filter(Boolean));
}

function detectClinicalQueryDomains(queryText, queryTokens) {
  const tokenSet = new Set(queryTokens);

  return clinicalDomainSignals
    .filter((domain) => domain.terms.some((term) => {
      const normalized = normalizeText(term);
      return normalized.includes(" ")
        ? queryText.includes(normalized)
        : tokenSet.has(normalized);
    }))
    .map((domain) => domain.id);
}

function detectExplicitClinicalQueryDomains(queryText = "") {
  return Object.entries(explicitClinicalDomainAliases)
    .filter(([, aliases]) => aliases.some((alias) => queryText.includes(normalizeText(alias))))
    .map(([domainId]) => domainId);
}

function detectNumericClinicalSignals(queryText) {
  const signals = [];

  if (/\b\d{2,3}\s*\/\s*\d{2,3}\b/.test(queryText) || /\bbp\b|\bblood pressure\b/.test(queryText)) {
    signals.push("blood pressure reading");
  }

  if (/\b(?:sugar|glucose|blood sugar|hba1c|a1c)\b/.test(queryText)) {
    signals.push("glucose or diabetes marker");
  }

  if (/\b(?:pulse|heart rate|hr)\b/.test(queryText)) {
    signals.push("heart rate reading");
  }

  if (/\b(?:oxygen|spo2|o2)\b/.test(queryText)) {
    signals.push("oxygen saturation reading");
  }

  if (/\b(?:temperature|temp|fever)\b/.test(queryText)) {
    signals.push("temperature reading");
  }

  if (/\b(?:bmi|weight|height|waist)\b/.test(queryText)) {
    signals.push("body composition metric");
  }

  if (/\b(?:ldl|hdl|cholesterol|creatinine|egfr|tsh|hemoglobin|platelet|wbc|alt|ast|bilirubin|potassium|sodium)\b/.test(queryText)) {
    signals.push("lab value marker");
  }

  return dedupe(signals);
}

function detectPopulationContext(queryText) {
  const signals = [];

  if (/\b(child|infant|baby|pediatric|newborn|toddler)\b/.test(queryText)) {
    signals.push("pediatric");
  }

  if (/\b(pregnan\w*|postpartum|maternal|fetal|baby movement)\b/.test(queryText)) {
    signals.push("maternal");
  }

  if (/\b(older adult|elderly|geriatric|frail|walker|balance issue)\b/.test(queryText)) {
    signals.push("older-adult");
  }

  if (/\b(cancer|oncology|chemo|chemotherapy|immune suppression)\b/.test(queryText)) {
    signals.push("oncology");
  }

  if (/\b(travel|airport|flight|mosquito|food safety abroad|international trip)\b/.test(queryText)) {
    signals.push("travel-health");
  }

  if (/\b(caregiver|caregiver support|family support|care partner)\b/.test(queryText)) {
    signals.push("caregiver-support");
  }

  if (/\b(chronic|follow up|monitoring|baseline|long-term)\b/.test(queryText)) {
    signals.push("longitudinal-care");
  }

  return dedupe(signals);
}

function inferContentTypeFromCategoryLabel(value = "") {
  const normalized = normalizeText(value);

  if (!normalized) {
    return "";
  }

  if (normalized.includes("medication")) return "medicine";
  if (normalized.includes("lab")) return "labs";
  if (normalized.includes("imaging")) return "imaging";
  if (normalized.includes("insurance") || normalized.includes("claim") || normalized.includes("utilization")) return "insurance";
  if (normalized.includes("records") || normalized.includes("care transitions") || normalized.includes("follow-up")) return "records";
  if (normalized.includes("urgent safety") || normalized.includes("safety")) return "safety";
  if (
    normalized.includes("prevention")
    || normalized.includes("lifestyle")
    || normalized.includes("mental wellness")
    || normalized.includes("sleep medicine")
    || normalized.includes("travel health")
    || normalized.includes("bone health")
  ) return "prevention";
  if (normalized.includes("vitals")) return "vitals";
  if (
    normalized.includes("cardiology")
    || normalized.includes("pulmonology")
    || normalized.includes("endocrinology")
    || normalized.includes("nephrology")
    || normalized.includes("neurology")
    || normalized.includes("hepatology")
    || normalized.includes("gynecology")
    || normalized.includes("pediatrics")
  ) return "specialist";
  if (normalized.includes("general")) return "general";

  return "";
}

function deriveExpectedContentTypes({
  intents = [],
  routeCategories = new Set(),
  primaryCategories = new Set(),
  queryEntities = [],
  numericSignals = [],
  queryText = "",
  queryTokens = [],
  risk = {}
} = {}) {
  const expected = new Set();
  const add = (value) => {
    const normalized = normalizeText(value);

    if (normalized) {
      expected.add(normalized);
    }
  };
  const addFromCategory = (value) => add(inferContentTypeFromCategoryLabel(value));

  for (const intent of intents) {
    for (const contentType of expectedContentTypesByIntent[intent?.type] || []) {
      add(contentType);
    }
  }

  for (const category of [...routeCategories, ...primaryCategories]) {
    addFromCategory(category);
  }

  for (const entity of queryEntities) {
    for (const category of entity?.categories || []) {
      addFromCategory(category);
    }
  }

  for (const signal of numericSignals) {
    if (/blood pressure|heart rate|oxygen|temperature|body composition/.test(signal)) {
      add("vitals");
    }

    if (/glucose|diabetes|lab value/.test(signal)) {
      add("labs");
      add("vitals");
    }
  }

  const queryJoined = ` ${normalizeText(queryText)} ${queryTokens.map(normalizeText).join(" ")} `;

  if (/\b(xray|x-ray|mri|ct|scan|ultrasound|imaging|contrast)\b/.test(queryJoined)) add("imaging");
  if (/\b(procedure|surgery|operation|colonoscopy|endoscopy|biopsy|recovery|discharge)\b/.test(queryJoined)) add("procedures");
  if (/\b(claim|coverage|insurance|eob|prior auth|authorization|appeal|billing)\b/.test(queryJoined)) add("insurance");
  if (/\b(summary|timeline|record|records|doctor note|visit note|share with doctor)\b/.test(queryJoined)) add("records");
  if (/\b(vaccine|diet|sleep|hydration|activity|stress|prevention|wellness)\b/.test(queryJoined)) add("prevention");
  if (/\b(chest pain|breathing trouble|fainting|confusion|severe allergy|stroke)\b/.test(queryJoined) || (risk?.level && risk.level !== "LOW")) add("safety");

  if (!expected.size) {
    add("general");
  }

  return Array.from(expected);
}

function getIntentDrivenContentTypeBoost(intents = [], contentType = "") {
  const normalizedContentType = normalizeText(contentType);

  if (!normalizedContentType) {
    return 0;
  }

  let strongestBoost = 0;

  for (const intent of Array.isArray(intents) ? intents : []) {
    const boosts = intentDrivenContentTypeBoosts[intent?.type] || {};
    strongestBoost = Math.max(strongestBoost, Number(boosts[normalizedContentType] || 0));
  }

  return strongestBoost;
}

function findNumericSignalHits(numericSignals, prepared) {
  if (!numericSignals.length) {
    return [];
  }

  return numericSignals.filter((signal) => {
    const routeTags = prepared.routeTagSet;

    if (/blood pressure|heart rate|oxygen|temperature|body composition/.test(signal)) {
      return ["Vitals", "Urgent Safety", "General"].some((tag) => routeTags.has(normalizeText(tag)) || prepared.category === tag);
    }

    if (/glucose|diabetes|lab value/.test(signal)) {
      return ["Vitals", "Labs", "Medication", "General"].some((tag) => routeTags.has(normalizeText(tag)) || prepared.category === tag);
    }

    return false;
  });
}

function countSetIntersection(left, right) {
  if (!(left instanceof Set) || !(right instanceof Set) || !left.size || !right.size) {
    return 0;
  }

  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let count = 0;

  for (const value of smaller) {
    if (larger.has(value)) {
      count += 1;
    }
  }

  return count;
}

function countArrayIntersection(items = [], valueSet = new Set()) {
  if (!Array.isArray(items) || !items.length || !(valueSet instanceof Set) || !valueSet.size) {
    return 0;
  }

  let count = 0;

  for (const item of items) {
    if (valueSet.has(cleanText(item))) {
      count += 1;
    }
  }

  return count;
}

function countPreparedTokenMatches(tokens = [], prepared = {}, mode = "broad") {
  if (!Array.isArray(tokens) || !tokens.length) {
    return 0;
  }

  const candidateSets = mode === "focus"
    ? [prepared.focusTokenSet, prepared.keywordTokenSet]
    : [prepared.titleTokenSet, prepared.focusTokenSet, prepared.keywordTokenSet, prepared.tokenSet];
  let count = 0;

  for (const token of new Set(tokens.map(cleanText).filter(Boolean))) {
    if (candidateSets.some((candidateSet) => candidateSet instanceof Set && candidateSet.has(token))) {
      count += 1;
    }
  }

  return count;
}

function getPreparedCategoryWeightSignal(prepared = {}, normalizedCategoryWeights = {}) {
  return Math.max(
    Number(normalizedCategoryWeights[normalizeText(prepared.category)] || 0),
    ...prepared.routeTags.map((tag) => Number(normalizedCategoryWeights[normalizeText(tag)] || 0))
  );
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/%.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function safeHost(value) {
  const endpoint = cleanText(value);

  if (!endpoint) {
    return "";
  }

  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

function dedupe(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

function normalizeCategoryWeightMap(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([category, score]) => [normalizeText(category), clamp(Number(score || 0), 0, 1)])
      .filter(([category, score]) => category && score > 0)
  );
}

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(cleanText(value));
}

function readBooleanDefault(value, defaultValue = false) {
  const cleaned = cleanText(value);
  if (!cleaned) {
    return defaultValue;
  }
  return /^(1|true|yes|on)$/i.test(cleaned);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
