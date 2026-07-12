const CONTENT_TYPE_PROFILES = {
  general: {
    aliases: ["health question", "symptom guide", "plain language review"],
    relatedTerms: ["symptoms", "timing", "severity", "trigger", "reading", "medicine", "next step"],
    whatToTrack: [
      "When the symptom started and whether it is improving, staying the same, or worsening.",
      "Severity, location, triggers, and any related symptoms happening at the same time.",
      "Home readings, recent medicines, exposures, hydration, and effect on daily activity."
    ],
    careQuestions: [
      "What symptom pattern should be reviewed first for {{topic}}?",
      "Which readings, tests, or exam details would help clarify this concern?",
      "What warning signs would make this need urgent medical review?"
    ],
    precautions: [
      "Do not rely on education alone if symptoms are severe, sudden, or rapidly worsening.",
      "Use the information to prepare questions and timelines, not to diagnose yourself.",
      "Keep medicine, allergy, and home-reading context available for clinician review."
    ],
    redFlagTerms: ["chest pain", "breathing trouble", "fainting", "confusion", "one-sided weakness", "severe allergy"]
  },
  specialist: {
    aliases: ["specialist pathway", "condition review", "disease intelligence"],
    relatedTerms: ["condition", "disease", "monitoring", "follow-up", "lab trend", "risk factor", "comorbidity"],
    whatToTrack: [
      "Symptom pattern, duration, progression, and the effect on routine activities or sleep.",
      "Relevant readings, report values, medicine timing, and previous diagnosis context.",
      "Past flare patterns, hospital visits, triggers, and what has already been tried."
    ],
    careQuestions: [
      "Which specialist review points matter most for {{topic}} right now?",
      "What readings, reports, or exam findings help a clinician assess this condition?",
      "What follow-up plan or monitoring questions should be prepared?"
    ],
    precautions: [
      "Specialist review should not delay urgent care when major warning signs are present.",
      "Do not change treatment plans or medicine doses from condition education alone.",
      "Use trend data and clinician guidance instead of judging one number in isolation."
    ],
    redFlagTerms: ["chest pain", "breathing trouble", "stroke-like symptom", "seizure", "fainting", "rapid worsening"]
  },
  vitals: {
    aliases: ["reading review", "vital sign check", "trend review"],
    relatedTerms: ["blood pressure", "glucose", "pulse", "temperature", "oxygen", "weight", "bmi", "trend"],
    whatToTrack: [
      "The exact reading, the time it was taken, the device used, and whether it was repeated correctly.",
      "Symptoms present at the same time, recent food, caffeine, activity, medicines, or illness.",
      "How the reading compares with prior baseline values and other readings from the same day."
    ],
    careQuestions: [
      "What makes this reading more or less concerning in context?",
      "What repeat-check method or follow-up question should be used for {{topic}}?",
      "What urgent symptoms would change this from monitoring to immediate care?"
    ],
    precautions: [
      "One reading should be interpreted with symptoms, technique, and trend, not alone.",
      "Urgent symptoms override routine tracking or lifestyle review.",
      "Use clinician or pharmacist advice before changing medicines because of a reading."
    ],
    redFlagTerms: ["very high blood pressure", "low oxygen", "fainting", "chest pain", "breathing trouble", "confusion"]
  },
  medicine: {
    aliases: ["medicine guide", "pharmacy review", "label support"],
    relatedTerms: ["generic", "brand", "label", "side effect", "interaction", "storage", "missed dose", "allergy"],
    whatToTrack: [
      "Medicine name, strength, form, route, timing, and the reason it is being taken.",
      "Recent missed doses, side effects, new over-the-counter products, supplements, or alcohol use.",
      "Storage conditions, expiry date, refill status, and allergy or previous reaction history."
    ],
    careQuestions: [
      "How should the label, warnings, and common questions for {{topic}} be reviewed?",
      "Which interaction, storage, or side-effect details should be confirmed with a pharmacist?",
      "What symptoms would make a medicine concern urgent instead of routine?"
    ],
    precautions: [
      "The local library does not prescribe, approve, or calculate medicine doses.",
      "Do not double a missed dose unless a licensed clinician or pharmacist instructed it.",
      "Allergy signs, severe rash, breathing trouble, or fainting need urgent real-world review."
    ],
    redFlagTerms: ["severe allergy", "face swelling", "throat swelling", "breathing trouble", "fainting", "severe rash"]
  },
  labs: {
    aliases: ["lab guide", "report explanation", "test meaning"],
    relatedTerms: ["reference range", "trend", "value", "unit", "repeat test", "abnormal", "follow-up"],
    whatToTrack: [
      "The exact test name, result value, units, reference range, date, and whether the test was fasting.",
      "Symptoms present at the time of the test and whether this is a new or repeated result.",
      "Related conditions, medicines, hydration status, and previous trend values."
    ],
    careQuestions: [
      "What does {{topic}} mean in plain language and what context matters most?",
      "Which trend or comparison questions should be taken to the clinician?",
      "What symptoms or companion results would make this lab concern more urgent?"
    ],
    precautions: [
      "Lab results need patient context, trends, and clinician review before decisions are made.",
      "Do not diagnose or change treatment from a single report value alone.",
      "Critical symptoms or critical lab wording should be handled with prompt real-world care."
    ],
    redFlagTerms: ["critical lab", "confusion", "severe weakness", "bleeding", "dehydration", "breathing trouble"]
  },
  imaging: {
    aliases: ["imaging guide", "scan vocabulary", "report wording"],
    relatedTerms: ["finding", "impression", "comparison", "contrast", "report", "scan", "xray", "mri", "ct"],
    whatToTrack: [
      "The imaging test type, body area, report date, and whether contrast or comparison studies were used.",
      "The exact wording in findings and impression sections and any follow-up recommendation.",
      "Symptoms, duration, prior imaging, and clinician questions linked to the report wording."
    ],
    careQuestions: [
      "What does the report wording for {{topic}} usually mean in plain language?",
      "Which follow-up or comparison questions should be asked about this imaging result?",
      "What symptoms would make this scan discussion urgent rather than routine?"
    ],
    precautions: [
      "This library explains report language only and does not interpret images directly.",
      "Final diagnostic meaning must come from the official report and clinician review.",
      "Severe symptoms should not wait for routine imaging follow-up."
    ],
    redFlagTerms: ["sudden weakness", "breathing trouble", "chest pain", "severe headache", "confusion", "fainting"]
  },
  procedures: {
    aliases: ["procedure guide", "prep checklist", "recovery review"],
    relatedTerms: ["fasting", "consent", "allergy", "transport", "wound", "bleeding", "follow-up"],
    whatToTrack: [
      "The procedure name, scheduled date, pre-procedure instructions, allergies, and medicine questions.",
      "Who is escorting the patient, what fasting rules apply, and what post-procedure support is available.",
      "Bleeding, fever, pain, wound changes, vomiting, or other recovery concerns afterward."
    ],
    careQuestions: [
      "What preparation details matter most before {{topic}}?",
      "What recovery warning signs or follow-up instructions should be clarified?",
      "Which medicines or chronic conditions need a direct clinician question before the procedure?"
    ],
    precautions: [
      "Always follow the facility or clinician instructions over general education notes.",
      "Do not stop medicines for a procedure unless the licensed team instructed it.",
      "Bleeding, breathing trouble, fainting, or severe pain after a procedure needs prompt review."
    ],
    redFlagTerms: ["bleeding", "fever", "breathing trouble", "severe pain", "fainting", "wound infection"]
  },
  prevention: {
    aliases: ["prevention guide", "risk reduction plan", "screening support"],
    relatedTerms: ["screening", "vaccine", "diet", "sleep", "exercise", "tobacco", "alcohol", "risk factor"],
    whatToTrack: [
      "Age, risk factors, family history, chronic conditions, vaccines, and last screening dates.",
      "Diet, sleep, hydration, activity, stress, tobacco, and alcohol patterns that affect risk.",
      "Barriers to follow-up such as cost, transport, routine, or uncertainty about next steps."
    ],
    careQuestions: [
      "Which prevention goals are most relevant for {{topic}}?",
      "What screening, vaccine, or habit questions should be reviewed next?",
      "How can progress be tracked safely between routine care visits?"
    ],
    precautions: [
      "Prevention guidance supports routine care planning and does not replace clinician review.",
      "New or concerning symptoms should be handled as active medical issues, not prevention only.",
      "Risk reduction is most useful when baseline readings and follow-up dates are documented."
    ],
    redFlagTerms: ["chest pain", "breathing trouble", "fainting", "confusion", "rapid worsening", "severe weakness"]
  },
  records: {
    aliases: ["record vault", "care timeline", "doctor note builder"],
    relatedTerms: ["timeline", "summary", "visit note", "medicine list", "labs", "readings", "follow-up"],
    whatToTrack: [
      "Dates, symptoms, readings, medicines, labs, and clinician advice in a consistent order.",
      "Questions still unanswered, next appointments, and what changed since the last check.",
      "Which documents are available locally and which are still missing."
    ],
    careQuestions: [
      "What should be included in the next doctor-ready summary for {{topic}}?",
      "Which recent changes belong in the patient timeline or follow-up packet?",
      "What missing record details would make future reviews easier?"
    ],
    precautions: [
      "Records should stay factual and dated; avoid mixing guesses with confirmed events.",
      "Private patient information should stay in local storage unless explicitly exported.",
      "Urgent symptoms should be acted on first, then documented in the record."
    ],
    redFlagTerms: ["urgent symptom", "critical result", "hospital visit", "allergy", "fainting", "breathing trouble"]
  },
  insurance: {
    aliases: ["coverage guide", "claim support", "prior auth review"],
    relatedTerms: ["claim", "coverage", "eob", "appeal", "denial", "member id", "authorization", "billing"],
    whatToTrack: [
      "Insurer name, member ID, claim or authorization number, dates of service, and provider details.",
      "Documents already collected, missing paperwork, deadlines, and denial or appeal wording.",
      "Cost totals, what the plan paid, patient responsibility, and who is following up."
    ],
    careQuestions: [
      "Which documents or fields are required to organize {{topic}}?",
      "What should be clarified with the insurer, provider, or billing office next?",
      "Which dates, deadlines, or missing evidence could block the claim workflow?"
    ],
    precautions: [
      "This guidance organizes claims and questions; it does not decide coverage or provide legal advice.",
      "Keep copies of submitted documents, service dates, and any insurer reference numbers.",
      "Escalate time-sensitive deadlines early rather than waiting until an appeal window is almost closed."
    ],
    redFlagTerms: ["urgent deadline", "denial", "missing authorization", "coverage gap", "appeal deadline", "billing error"]
  },
  safety: {
    aliases: ["urgent safety", "warning sign review", "red flag check"],
    relatedTerms: ["urgent", "emergency", "warning sign", "rapid worsening", "severe allergy", "stroke", "breathing"],
    whatToTrack: [
      "Exactly what warning sign is happening now, when it started, and whether it is worsening.",
      "Who is with the patient, what readings are available, and whether the patient can speak, walk, or stay alert normally.",
      "Any high-risk conditions, pregnancy status, immune suppression, or medicine reaction context."
    ],
    careQuestions: [
      "What safety boundary does {{topic}} trigger right now?",
      "Which urgent details should be communicated first to real-world care teams?",
      "What key facts should be documented immediately after the safety event?"
    ],
    precautions: [
      "Urgent warning signs should override routine app workflows or education browsing.",
      "The app does not rule out emergencies or replace real-world medical evaluation.",
      "When danger signs are active, use local emergency or urgent-care pathways first."
    ],
    redFlagTerms: ["chest pain", "breathing trouble", "stroke sign", "fainting", "severe allergy", "confusion", "seizure"]
  },
  research: {
    aliases: ["research review", "evidence summary", "guideline update"],
    relatedTerms: ["study", "trial", "guideline", "evidence", "publication", "comparison", "citation"],
    whatToTrack: [
      "Study design, patient population, intervention, outcome, limitations, and publication date.",
      "Whether the source is a guideline, trial, review, registry, or educational summary.",
      "How the evidence applies to care questions without turning it into personal treatment advice."
    ],
    careQuestions: [
      "What does the evidence for {{topic}} support and what remains uncertain?",
      "Which guideline or publication questions should be confirmed with a clinician?",
      "What limitations or gaps matter before using this evidence in decision support?"
    ],
    precautions: [
      "Research summaries should not be turned directly into diagnosis or treatment instructions.",
      "Source quality, recency, and clinical relevance need review before policy or care use.",
      "When evidence is mixed or limited, the app should present uncertainty clearly."
    ],
    redFlagTerms: ["unsupported certainty", "outdated source", "population mismatch", "missing review", "safety concern"]
  }
};

const CONTENT_TYPE_HINTS = [
  { type: "medicine", pattern: /\b(medicine|medication|drug|tablet|pill|dosage|dose|label|interaction|pharmacy|side effect|missed dose)\b/ },
  { type: "labs", pattern: /\b(lab|cbc|hba1c|a1c|cholesterol|ldl|hdl|creatinine|egfr|tsh|wbc|platelet|bilirubin|potassium|sodium)\b/ },
  { type: "imaging", pattern: /\b(xray|x-ray|mri|ct|scan|ultrasound|ecg|ekg|imaging|contrast|finding|impression)\b/ },
  { type: "procedures", pattern: /\b(procedure|surgery|operation|endoscopy|colonoscopy|biopsy|recovery|wound|stitches)\b/ },
  { type: "insurance", pattern: /\b(claim|coverage|insurance|appeal|eob|prior auth|authorization|billing|member id)\b/ },
  { type: "records", pattern: /\b(record|summary|timeline|doctor note|visit note|profile|history)\b/ },
  { type: "safety", pattern: /\b(emergency|urgent|warning sign|red flag|stroke|fainting|severe allergy|seizure)\b/ },
  { type: "prevention", pattern: /\b(prevent|prevention|screening|vaccine|lifestyle|diet|exercise|sleep|hydration|risk reduction)\b/ },
  { type: "vitals", pattern: /\b(bp|blood pressure|pulse|heart rate|oxygen|spo2|temperature|weight|bmi|waist|glucose reading)\b/ },
  { type: "research", pattern: /\b(research|study|trial|guideline|publication|evidence)\b/ },
  { type: "specialist", pattern: /\b(hypertension|diabetes|asthma|copd|kidney|neurology|cardiology|endocrine|hepatology|gynecology|pediatrics)\b/ }
];

const CATEGORY_TYPE_HINTS = [
  { type: "medicine", pattern: /Medication/i },
  { type: "labs", pattern: /Lab/i },
  { type: "imaging", pattern: /Imaging/i },
  { type: "insurance", pattern: /Insurance/i },
  { type: "records", pattern: /Records|Care Transitions/i },
  { type: "safety", pattern: /Urgent Safety/i },
  { type: "prevention", pattern: /Prevention|Lifestyle/i },
  { type: "vitals", pattern: /Vitals/i },
  { type: "specialist", pattern: /Cardiology|Endocrinology|Pulmonology|Nephrology|Neurology|Hepatology|Gynecology|Pediatrics/i }
];

const TERM_EQUIVALENTS = [
  [["blood pressure", "bp", "hypertension"], ["systolic", "diastolic", "home reading", "repeat reading"]],
  [["blood sugar", "glucose", "a1c", "hba1c", "diabetes"], ["hyperglycemia", "hypoglycemia", "meal timing", "fasting"]],
  [["heart rate", "pulse", "palpitation"], ["bpm", "tachycardia", "bradycardia", "rhythm"]],
  [["oxygen", "spo2", "o2"], ["oxygen saturation", "breathing effort", "blue lips"]],
  [["temperature", "fever"], ["chills", "infection", "thermometer"]],
  [["kidney", "creatinine", "egfr"], ["urine", "hydration", "electrolyte"]],
  [["liver", "bilirubin", "alt", "ast"], ["jaundice", "dark urine", "abdominal swelling"]],
  [["cholesterol", "ldl", "hdl", "triglyceride"], ["heart risk", "lipid", "statin"]],
  [["thyroid", "tsh", "t4", "t3"], ["hormone", "fatigue", "weight change"]],
  [["allergy", "anaphylaxis", "hives"], ["swelling", "rash", "breathing trouble"]],
  [["stroke", "face droop", "arm weakness", "speech trouble"], ["last known well", "vision change", "one-sided weakness"]],
  [["pregnancy", "postpartum"], ["bleeding", "swelling", "baby movement", "severe headache"]],
  [["child", "infant", "baby", "pediatric"], ["feeding", "wet diaper", "sleepy", "caregiver"]],
  [["older adult", "frail", "geriatric"], ["fall risk", "balance", "walker", "confusion"]],
  [["claim", "coverage", "eob", "prior auth"], ["appeal", "denial", "member id", "provider bill"]]
];

const ROUTE_TAGS_BY_CONTENT_TYPE = {
  general: ["General"],
  specialist: ["Specialist"],
  vitals: ["Vitals"],
  medicine: ["Medication"],
  labs: ["Labs"],
  imaging: ["Labs"],
  procedures: ["Care Transitions"],
  prevention: ["Lifestyle"],
  records: ["Records", "Care Transitions"],
  insurance: ["Insurance", "Claims Operations", "Utilization Management"],
  safety: ["Urgent Safety"],
  research: ["General"]
};

const CLINICAL_DOMAIN_PROFILES = [
  { id: "cardiology", pattern: /\b(cardiology|cardiac|heart|hypertension|blood pressure|palpitation|heart failure|cholesterol|lipid|statin)\b/ },
  { id: "endocrinology", pattern: /\b(endocrinology|diabetes|glucose|a1c|hba1c|insulin|metformin|thyroid|levothyroxine|hormone)\b/ },
  { id: "pulmonology", pattern: /\b(pulmonology|asthma|copd|oxygen|spo2|wheeze|inhaler|respiratory)\b/ },
  { id: "nephrology", pattern: /\b(nephrology|kidney|renal|creatinine|egfr|protein urine|proteinuria|dialysis)\b/ },
  { id: "neurology", pattern: /\b(neurology|stroke|seizure|migraine|headache|vision change|numbness|weakness|speech)\b/ },
  { id: "hepatology", pattern: /\b(hepatology|liver|bilirubin|alt|ast|jaundice)\b/ },
  { id: "gynecology", pattern: /\b(gynecology|pelvic|period|menopause|pcos|breast|vaginal|bleeding)\b/ },
  { id: "pediatrics", pattern: /\b(pediatrics|pediatric|infant|newborn|child|caregiver)\b/ },
  { id: "gastrointestinal", pattern: /\b(gastrointestinal|digestive|reflux|abdominal|bowel|ibd|ulcer|colonoscopy)\b/ },
  { id: "maternal-health", pattern: /\b(maternal|pregnancy|postpartum|fetal|preeclampsia)\b/ },
  { id: "sleep-medicine", pattern: /\b(sleep medicine|sleep apnea|snoring|insomnia|daytime fatigue)\b/ },
  { id: "travel-health", pattern: /\b(travel health|travel|mosquito|altitude|jet lag)\b/ },
  { id: "bone-health", pattern: /\b(bone health|osteoporosis|fall prevention|fracture|calcium|vitamin d)\b/ }
];

export function cleanKnowledgeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeKnowledgeList(items = []) {
  return Array.isArray(items)
    ? items.map(cleanKnowledgeText).filter(Boolean)
    : cleanKnowledgeText(items)
      ? [cleanKnowledgeText(items)]
      : [];
}

export function dedupeKnowledgeList(items = [], limit = Infinity) {
  const unique = Array.from(new Set(items.map(cleanKnowledgeText).filter(Boolean)));
  return Number.isFinite(limit) ? unique.slice(0, limit) : unique;
}

export function inferKnowledgeContentType(record = {}) {
  const explicit = cleanKnowledgeText(record.contentType).toLowerCase();
  if (explicit && CONTENT_TYPE_PROFILES[explicit]) {
    return explicit;
  }

  const category = cleanKnowledgeText(record.category);
  for (const hint of CATEGORY_TYPE_HINTS) {
    if (hint.pattern.test(category)) {
      return hint.type;
    }
  }

  const text = normalizeSearchText([
    record.title,
    record.category,
    ...(Array.isArray(record.keywords) ? record.keywords : []),
    record.summary,
    record.safetyNotes,
    record.retrievalText
  ].join(" "));

  for (const hint of CONTENT_TYPE_HINTS) {
    if (hint.pattern.test(text)) {
      return hint.type;
    }
  }

  return "general";
}

export function enrichOfflineKnowledgeRecord(record = {}, options = {}) {
  const fallbackId = cleanKnowledgeText(options.fallbackId) || "offline-record";
  const title = cleanKnowledgeText(record.title) || "Offline Medical Reference";
  const category = cleanKnowledgeText(record.category) || "General";
  const contentType = inferKnowledgeContentType(record);
  const profile = CONTENT_TYPE_PROFILES[contentType] || CONTENT_TYPE_PROFILES.general;
  const summary = cleanKnowledgeText(record.summary);
  const safetyNotes = cleanKnowledgeText(record.safetyNotes) || profile.precautions[0];
  const keywords = dedupeKnowledgeList([
    ...normalizeKnowledgeList(record.keywords),
    category,
    contentType
  ], 18);
  const aliases = dedupeKnowledgeList([
    ...normalizeKnowledgeList(record.aliases),
    ...profile.aliases,
    title,
    ...keywords.filter((keyword) => keyword.includes(" ")).slice(0, 6),
    ...expandEquivalentTerms([title, category, ...keywords])
  ], 16);
  const relatedTerms = dedupeKnowledgeList([
    ...normalizeKnowledgeList(record.relatedTerms),
    ...profile.relatedTerms,
    ...expandEquivalentTerms([title, category, ...keywords]),
    ...keywords
  ], 24);
  const routeTags = dedupeKnowledgeList([
    ...normalizeKnowledgeList(record.routeTags),
    ...deriveRouteTags({
      title,
      category,
      contentType,
      keywords
    })
  ], 10);
  const clinicalDomains = dedupeKnowledgeList([
    ...normalizeKnowledgeList(record.clinicalDomains),
    ...inferClinicalDomains(title, category)
  ], 8);
  const populationTags = dedupeKnowledgeList([
    ...normalizeKnowledgeList(record.populationTags),
    ...inferPopulationTags([title, category, summary, safetyNotes, ...keywords].join(" "))
  ], 8);
  const redFlagTerms = dedupeKnowledgeList([
    ...normalizeKnowledgeList(record.redFlagTerms),
    ...profile.redFlagTerms,
    ...inferRedFlagTerms([title, summary, safetyNotes, ...keywords].join(" "))
  ], 10);
  const whatToTrack = dedupeKnowledgeList([
    ...normalizeKnowledgeList(record.whatToTrack),
    ...profile.whatToTrack
  ], 5);
  const careQuestions = dedupeKnowledgeList([
    ...normalizeKnowledgeList(record.careQuestions),
    ...profile.careQuestions.map((item) => applyTopicTemplate(item, title, category))
  ], 5);
  const precautions = dedupeKnowledgeList([
    ...normalizeKnowledgeList(record.precautions),
    safetyNotes,
    ...profile.precautions
  ], 5);
  const queryPrompts = dedupeKnowledgeList([
    ...normalizeKnowledgeList(record.queryPrompts),
    ...buildQueryPrompts({ title, category, contentType, careQuestions, whatToTrack })
  ], 5);
  const sourceReferences = dedupeKnowledgeList([
    ...normalizeKnowledgeList(record.sourceReferences),
    cleanKnowledgeText(record.source),
    cleanKnowledgeText(record.sourceFamily),
    cleanKnowledgeText(record.evidenceLevel),
    cleanKnowledgeText(record.verificationStatus)
  ], 10);
  const maintenanceTags = dedupeKnowledgeList([
    ...normalizeKnowledgeList(record.maintenanceTags),
    contentType,
    category.toLowerCase(),
    ...routeTags,
    ...clinicalDomains,
    ...populationTags,
    cleanKnowledgeText(record.sourceFamily)
  ], 10);
  const evidenceSignals = dedupeKnowledgeList([
    ...normalizeKnowledgeList(record.evidenceSignals),
    ...relatedTerms.slice(0, 8),
    ...redFlagTerms.slice(0, 4),
    ...keywords.slice(0, 6),
    ...routeTags.slice(0, 3),
    ...clinicalDomains.slice(0, 3)
  ], 14);
  const qualityScore = computeKnowledgeQualityScore({
    summary,
    keywords,
    aliases,
    relatedTerms,
    whatToTrack,
    careQuestions,
    precautions,
    sourceReferences,
    maintenanceTags,
    verificationStatus: cleanKnowledgeText(record.verificationStatus),
    evidenceLevel: cleanKnowledgeText(record.evidenceLevel)
  });
  const sections = {
    overview: summary || `${title} is handled as ${category.toLowerCase()} offline education with safety boundaries and clinician follow-up support.`,
    whatToTrack,
    careQuestions,
    precautions,
    sourceReferences
  };
  const retrievalText = buildKnowledgeRetrievalText({
    existing: record.retrievalText,
    title,
    category,
    contentType,
    keywords,
    aliases,
    relatedTerms,
    summary,
    safetyNotes,
    whatToTrack,
    careQuestions,
    precautions,
    redFlagTerms,
    queryPrompts,
    routeTags,
    clinicalDomains,
    populationTags,
    sourceReferences,
    maintenanceTags,
    evidenceSignals,
    qualityScore,
    source: cleanKnowledgeText(record.source),
    sourceFamily: cleanKnowledgeText(record.sourceFamily),
    evidenceLevel: cleanKnowledgeText(record.evidenceLevel),
    verificationStatus: cleanKnowledgeText(record.verificationStatus)
  });

  return {
    ...record,
    id: cleanKnowledgeText(record.id) || fallbackId,
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
    sections,
    source: cleanKnowledgeText(record.source) || "Offline medical database",
    sourceFamily: cleanKnowledgeText(record.sourceFamily),
    evidenceLevel: cleanKnowledgeText(record.evidenceLevel),
    verificationStatus: cleanKnowledgeText(record.verificationStatus),
    lastReviewed: cleanKnowledgeText(record.lastReviewed),
    updateCadence: cleanKnowledgeText(record.updateCadence),
    retrievalText
  };
}

function buildKnowledgeRetrievalText({
  existing,
  title,
  category,
  contentType,
  keywords,
  aliases,
  relatedTerms,
  summary,
  safetyNotes,
  whatToTrack,
  careQuestions,
  precautions,
  redFlagTerms,
  queryPrompts,
  routeTags,
  clinicalDomains,
  populationTags,
  sourceReferences,
  maintenanceTags,
  evidenceSignals,
  qualityScore,
  source,
  sourceFamily,
  evidenceLevel,
  verificationStatus
}) {
  return cleanKnowledgeText([
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
    `quality score ${qualityScore}`,
    source,
    sourceFamily,
    evidenceLevel,
    verificationStatus,
    cleanKnowledgeText(existing)
  ].join(" "));
}

function computeKnowledgeQualityScore({
  summary,
  keywords,
  aliases,
  relatedTerms,
  whatToTrack,
  careQuestions,
  precautions,
  sourceReferences,
  maintenanceTags,
  verificationStatus,
  evidenceLevel
}) {
  let score = 42;

  if (summary) score += 10;
  if ((keywords || []).length >= 6) score += 8;
  if ((aliases || []).length >= 4) score += 6;
  if ((relatedTerms || []).length >= 8) score += 6;
  if ((whatToTrack || []).length >= 2) score += 7;
  if ((careQuestions || []).length >= 2) score += 7;
  if ((precautions || []).length >= 2) score += 5;
  if ((sourceReferences || []).length >= 3) score += 5;
  if ((maintenanceTags || []).length >= 4) score += 4;
  if (/clinician-review-required|review/i.test(verificationStatus)) score += 3;
  if (/reference|guidance|governed/i.test(evidenceLevel)) score += 3;

  return Math.max(35, Math.min(96, score));
}

function buildQueryPrompts({ title, category, contentType, careQuestions, whatToTrack }) {
  const topic = cleanKnowledgeText(title || category || "this topic");
  return [
    `Explain ${topic} in plain language.`,
    `What should I track or monitor for ${topic}?`,
    careQuestions[0] || `What questions should I ask about ${topic}?`,
    whatToTrack[0] ? `How should I document ${topic}: ${whatToTrack[0]}` : `What safety steps matter for ${topic}?`,
    `When should ${topic} be reviewed urgently?`,
    contentType === "medicine" ? `What label, side-effect, and storage details matter for ${topic}?` : "",
    contentType === "labs" ? `How should ${topic} be compared with prior results or reference ranges?` : "",
    contentType === "insurance" ? `What documents or deadlines matter for ${topic}?` : ""
  ].map(cleanKnowledgeText).filter(Boolean);
}

function deriveRouteTags({ title, category, contentType, keywords = [] }) {
  const text = normalizeSearchText([
    title,
    category,
    contentType,
    ...keywords.slice(0, 4)
  ].join(" "));
  const tags = [...(ROUTE_TAGS_BY_CONTENT_TYPE[contentType] || [])];

  if (/\b(lab|imaging)\b/.test(text)) {
    tags.push("Labs");
  }
  if (/\b(medication|pharmacy)\b/.test(text)) {
    tags.push("Medication");
  }
  if (/\b(records|care transitions|caregiver support)\b/.test(text)) {
    tags.push("Records", "Care Transitions");
  }
  if (/\b(insurance)\b/.test(text)) {
    tags.push("Insurance", "Claims Operations", "Utilization Management");
  }
  if (/\b(prevention|lifestyle|travel health|bone health)\b/.test(text)) {
    tags.push("Lifestyle");
  }
  if (/\b(urgent safety)\b/.test(text) || contentType === "safety") {
    tags.push("Urgent Safety");
  }

  return dedupeKnowledgeList(tags, 10);
}

function inferClinicalDomains(title, category) {
  const normalized = normalizeSearchText([title, category].join(" "));

  return CLINICAL_DOMAIN_PROFILES
    .filter((profile) => profile.pattern.test(normalized))
    .map((profile) => profile.id);
}

function expandEquivalentTerms(values = []) {
  const text = normalizeSearchText(values.join(" "));
  const expansions = [];

  for (const [triggers, terms] of TERM_EQUIVALENTS) {
    const matched = triggers.some((trigger) => text.includes(normalizeSearchText(trigger)));
    if (matched) {
      expansions.push(...triggers, ...terms);
    }
  }

  return dedupeKnowledgeList(expansions, 18);
}

function inferPopulationTags(text) {
  const normalized = normalizeSearchText(text);
  const tags = [];

  if (/\b(child|infant|baby|pediatric|newborn)\b/.test(normalized)) tags.push("pediatric");
  if (/\b(pregnan\w*|postpartum|maternal)\b/.test(normalized)) tags.push("maternal");
  if (/\b(older adult|elderly|geriatric|frail)\b/.test(normalized)) tags.push("older-adult");
  if (/\b(cancer|oncology|chemo|chemotherapy)\b/.test(normalized)) tags.push("oncology");
  if (/\b(travel|mosquito|food safety)\b/.test(normalized)) tags.push("travel-health");
  if (/\b(caregiver|family support)\b/.test(normalized)) tags.push("caregiver-support");
  if (/\b(chronic|follow up|monitoring)\b/.test(normalized)) tags.push("longitudinal-care");

  return tags;
}

function inferRedFlagTerms(text) {
  const normalized = normalizeSearchText(text);
  const flags = [];

  if (/\b(chest pain|chest pressure|jaw pain|left arm)\b/.test(normalized)) flags.push("chest pain");
  if (/\b(shortness of breath|breathing trouble|blue lips|cannot speak)\b/.test(normalized)) flags.push("breathing trouble");
  if (/\b(fainting|collapse|loss of consciousness)\b/.test(normalized)) flags.push("fainting");
  if (/\b(one sided weakness|face droop|speech trouble|stroke)\b/.test(normalized)) flags.push("stroke-like sign");
  if (/\b(throat swelling|face swelling|anaphylaxis|severe allergy)\b/.test(normalized)) flags.push("severe allergy");
  if (/\b(confusion|seizure|unconscious)\b/.test(normalized)) flags.push("confusion or seizure");
  if (/\b(high fever|very high blood pressure|low oxygen|critical result)\b/.test(normalized)) flags.push("critical reading");

  return flags;
}

function applyTopicTemplate(template, title, category) {
  return cleanKnowledgeText(template
    .replace(/\{\{topic\}\}/g, title)
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{category\}\}/g, category.toLowerCase()));
}

function normalizeSearchText(value) {
  return cleanKnowledgeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/%.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
