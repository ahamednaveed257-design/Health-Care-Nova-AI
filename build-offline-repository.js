#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanKnowledgeText, dedupeKnowledgeList, enrichOfflineKnowledgeRecord } from "../src/offlineKnowledgeEnrichment.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(rootDir, "data");
const baseDbPath = path.join(dataDir, "offline-medical-db.json");
const repositoryPath = path.join(dataDir, "offline-clinical-repository.json");
const indexPath = path.join(dataDir, "offline-knowledge-index.json");
const manifestPath = path.join(dataDir, "offline-repository-manifest.json");
const sourcePackDir = path.join(dataDir, "offline-source-packs");

const sourceRegistry = [
  {
    id: "public-health-guidelines",
    name: "Public Health Guideline Pack",
    sourceTypes: ["WHO/CDC/NIH-style public-health guidance", "government patient education", "public-domain safety guidance"],
    contentTypes: ["prevention", "warning signs", "home-care boundaries", "screening questions"],
    updateCadence: "quarterly-or-when-source-changes",
    licensePolicy: "Use only open, public-domain, or organization-approved licensed content.",
    verificationGate: "source approval + clinician review + safety red-team before production use"
  },
  {
    id: "clinical-reference-pack",
    name: "Clinical Reference Pack",
    sourceTypes: ["licensed medical textbooks", "specialty society guidelines", "hospital protocols"],
    contentTypes: ["disease overview", "diagnostic workflow", "care pathway", "follow-up planning"],
    updateCadence: "source-versioned-release-cycle",
    licensePolicy: "Do not commit copyrighted full text. Store approved abstracts, metadata, and clinician-reviewed summaries only.",
    verificationGate: "license review + specialty review + rollback-ready release"
  },
  {
    id: "medicine-reference-pack",
    name: "Medicine Reference Pack",
    sourceTypes: ["RxNorm/RxNav", "openFDA labels", "formulary or pharmacy-approved references"],
    contentTypes: ["drug identity", "side-effect questions", "interaction questions", "storage and missed-dose safety boundaries"],
    updateCadence: "monthly-or-label-change",
    licensePolicy: "Store normalized medicine-name metadata and safety summaries, not prescribing decisions.",
    verificationGate: "pharmacy review + no-dose-calculation guardrail"
  },
  {
    id: "lab-imaging-reference-pack",
    name: "Lab and Imaging Reference Pack",
    sourceTypes: ["LOINC", "radiology report terminology references", "lab handbook summaries"],
    contentTypes: ["lab meaning", "trend questions", "imaging terminology", "procedure preparation"],
    updateCadence: "semiannual-or-local-lab-change",
    licensePolicy: "Store plain-language explanation and code metadata; do not interpret raw images as diagnosis.",
    verificationGate: "lab/radiology review + abnormal-critical-result escalation test"
  },
  {
    id: "operations-care-pack",
    name: "Healthcare Operations Pack",
    sourceTypes: ["FHIR implementation guides", "payer document workflows", "care-transition best practices"],
    contentTypes: ["records", "claims", "prior authorization", "visit preparation", "doctor-ready summary"],
    updateCadence: "semiannual-or-workflow-change",
    licensePolicy: "Store workflow checklists and non-PHI templates only.",
    verificationGate: "privacy review + document redaction + audit logging"
  }
];

const topicCatalog = [
  ["general", "Common Symptom Triage", "General", ["headache", "fever", "cough", "pain", "fatigue", "rash", "stomach pain"], "Organizes common symptoms by duration, severity, associated symptoms, medicines, readings, exposure, and warning signs before giving one safe next step."],
  ["general", "Respiratory Illness Review", "Respiratory", ["cough", "wheeze", "shortness of breath", "asthma", "pneumonia", "oxygen", "sputum"], "Reviews breathing symptoms, ability to speak, fever, oxygen wording, inhaler context, exposure, and when to seek real-world care."],
  ["general", "Digestive Health Review", "Gastrointestinal", ["nausea", "vomiting", "diarrhea", "constipation", "acid reflux", "abdominal pain", "blood in stool"], "Structures digestive concerns around hydration, blood, severe pain, fever, duration, medicines, food exposure, and clinician-ready questions."],
  ["general", "Skin and Allergy Review", "Dermatology", ["rash", "itching", "hives", "swelling", "allergy", "eczema", "infection"], "Separates mild skin questions from urgent allergic swelling, breathing trouble, spreading infection, fever, and medication reaction concerns."],
  ["general", "Pain and Injury Review", "Musculoskeletal", ["back pain", "joint pain", "sprain", "fall", "fracture", "swelling", "numbness"], "Helps organize injury timing, movement limits, swelling, deformity, numbness, fever, fall risk, and safe questions for medical review."],
  ["specialist", "Hypertension Care Pathway", "Cardiology", ["hypertension", "blood pressure", "bp", "systolic", "diastolic", "stroke risk", "heart risk"], "Connects BP readings with symptoms, repeat measurement technique, medication timing, lifestyle context, and urgent warning signs."],
  ["specialist", "Diabetes Care Pathway", "Endocrinology", ["diabetes", "blood sugar", "glucose", "hba1c", "insulin", "metformin", "hypoglycemia", "hyperglycemia"], "Supports glucose and HbA1c review, meal timing, hydration, medicines, sick-day context, foot care, and doctor-ready questions."],
  ["specialist", "Asthma and COPD Pathway", "Pulmonology", ["asthma", "copd", "inhaler", "wheeze", "oxygen", "breathless", "peak flow"], "Organizes respiratory control, triggers, inhaler availability, nighttime waking, oxygen symptoms, and escalation boundaries."],
  ["specialist", "Kidney Health Pathway", "Nephrology", ["kidney", "creatinine", "egfr", "urine protein", "potassium", "swelling", "dehydration"], "Connects kidney labs, hydration, BP, diabetes, swelling, urine changes, medicine-safety questions, and trend review."],
  ["specialist", "Neurology Warning Pathway", "Neurology", ["stroke", "seizure", "headache", "weakness", "speech", "vision", "confusion"], "Focuses on sudden neurologic changes, last-known-well timing, seizure context, headache red flags, and urgent safety routing."],
  ["specialist", "Cardiac Symptom Pathway", "Cardiology", ["chest pain", "palpitation", "sweating", "jaw pain", "left arm", "breathless", "fainting"], "Reviews chest symptoms, exertion, sweating, fainting, shortness of breath, cardiac risk, and immediate-care boundaries."],
  ["specialist", "Liver and Jaundice Pathway", "Hepatology", ["liver", "jaundice", "bilirubin", "alt", "ast", "hepatitis", "abdominal swelling"], "Organizes yellow eyes, dark urine, abdominal swelling, medication and alcohol context, liver labs, and urgent review signals."],
  ["specialist", "Women's Health Pathway", "Gynecology", ["pregnancy", "heavy period", "pelvic pain", "pcos", "menopause", "breast lump", "bleeding"], "Structures reproductive health questions around pregnancy possibility, bleeding severity, pain, fever, lumps, screening, and clinician review."],
  ["specialist", "Pediatric Safety Pathway", "Pediatrics", ["child", "infant", "newborn", "fever", "dehydration", "breathing", "rash"], "Uses age, feeding, wet diapers, breathing, fever, lethargy, rash, and caregiver observations to route pediatric questions safely."],
  ["vitals", "Blood Pressure Review", "Vitals", ["bp", "blood pressure", "systolic", "diastolic", "dizzy", "headache", "home reading"], "Checks reading technique, repeat measurements, symptoms, baseline, medicines, stress, caffeine, and safe escalation."],
  ["vitals", "Pulse and Rhythm Review", "Vitals", ["pulse", "heart rate", "palpitation", "fast pulse", "slow pulse", "irregular"], "Connects pulse readings with symptoms, activity, fever, dehydration, caffeine, medicines, chest symptoms, and fainting risk."],
  ["vitals", "Temperature and Fever Review", "Vitals", ["temperature", "fever", "chills", "sweating", "infection", "thermometer"], "Reviews fever duration, immune risk, hydration, breathing, confusion, rash, stiff neck, and when to seek care."],
  ["vitals", "Oxygen Saturation Review", "Vitals", ["oxygen", "spo2", "o2", "breathing", "blue lips", "shortness of breath"], "Organizes oxygen readings with device reliability, breathing effort, color change, confusion, and urgent-care thresholds."],
  ["vitals", "BMI and Metabolic Review", "Vitals", ["bmi", "weight", "height", "waist", "metabolic", "obesity", "underweight"], "Frames BMI as a screening metric and connects it with BP, glucose, cholesterol, sleep, joints, nutrition, and activity planning."],
  ["medicine", "Medicine Label Review", "Medication Safety", ["medicine label", "generic", "brand", "active ingredient", "directions", "warning"], "Explains how to read medicine labels, active ingredients, duplicate products, storage instructions, warnings, and pharmacist questions."],
  ["medicine", "Missed Medicine Safety", "Medication Safety", ["missed dose", "late dose", "double dose", "forgot medicine", "refill"], "Keeps missed-dose support inside safety boundaries and directs users to label, pharmacist, or clinician instead of calculating doses."],
  ["medicine", "Side Effect Review", "Medication Safety", ["side effect", "reaction", "rash", "swelling", "dizziness", "nausea", "allergy"], "Separates mild side-effect questions from severe allergy, breathing trouble, fainting, severe rash, and urgent symptoms."],
  ["medicine", "Interaction Question Builder", "Medication Safety", ["interaction", "otc", "supplement", "herbal", "alcohol", "antibiotic", "blood thinner"], "Builds pharmacist-ready questions for medicine combinations without approving or rejecting medicine use."],
  ["medicine", "Medicine Storage and Travel", "Medication Safety", ["storage", "expiry", "refrigeration", "insulin", "travel", "heat", "humidity"], "Organizes storage needs, refrigeration, heat exposure, travel supply, refills, and label-based safety questions."],
  ["labs", "CBC Report Review", "Lab Explanation", ["cbc", "hemoglobin", "wbc", "platelet", "anemia", "infection"], "Explains common CBC terms, trend context, symptoms, and clinician questions without diagnosing from one value."],
  ["labs", "Kidney Lab Review", "Lab Explanation", ["creatinine", "egfr", "urea", "bun", "urine protein", "potassium"], "Connects kidney labs with hydration, BP, diabetes, medicines, trends, and when abnormal results need review."],
  ["labs", "Liver Lab Review", "Lab Explanation", ["alt", "ast", "bilirubin", "alkaline phosphatase", "albumin", "liver"], "Organizes liver test terms, symptoms, medication/alcohol context, jaundice signs, and clinician follow-up questions."],
  ["labs", "Lipid and Heart Risk Review", "Lab Explanation", ["cholesterol", "ldl", "hdl", "triglycerides", "heart risk", "statin"], "Explains lipid terms, risk context, lifestyle questions, medicine discussion points, and follow-up planning."],
  ["labs", "Thyroid Lab Review", "Lab Explanation", ["tsh", "t3", "t4", "thyroid", "fatigue", "weight change"], "Connects thyroid terms with symptoms, medicine timing, pregnancy context, trend review, and clinician questions."],
  ["imaging", "Imaging Report Terms", "Imaging Knowledge", ["xray", "ct", "mri", "ultrasound", "impression", "findings", "contrast"], "Defines common imaging-report sections and prepares questions while avoiding image interpretation or diagnosis."],
  ["imaging", "Chest Imaging Vocabulary", "Imaging Knowledge", ["chest xray", "pneumonia", "opacity", "effusion", "nodule", "atelectasis"], "Explains common chest imaging words as discussion starters and flags urgent breathing or chest symptoms."],
  ["imaging", "Abdominal Imaging Vocabulary", "Imaging Knowledge", ["abdominal ultrasound", "gallbladder", "kidney stone", "appendix", "liver", "mass"], "Helps users understand report wording and organize symptoms, follow-up, and clinician questions."],
  ["procedures", "Procedure Preparation", "Procedures", ["procedure", "surgery", "endoscopy", "colonoscopy", "biopsy", "fasting", "consent"], "Organizes preparation instructions, medication questions, fasting, transport, allergies, and post-procedure warning signs."],
  ["procedures", "Post Procedure Recovery", "Care Transitions", ["after surgery", "wound", "bleeding", "infection", "pain", "follow up"], "Structures recovery questions around wound changes, fever, pain, bleeding, medicines, activity limits, and follow-up."],
  ["prevention", "Adult Prevention Planner", "Prevention", ["screening", "vaccines", "prevention", "blood pressure", "diabetes", "cancer screening"], "Organizes preventive care by age, risk factors, family history, smoking, pregnancy, chronic conditions, and last-test dates."],
  ["prevention", "Lifestyle Risk Reduction", "Prevention", ["diet", "sleep", "activity", "hydration", "stress", "smoking", "alcohol"], "Creates safe habit plans for sleep, diet, activity, hydration, stress, tobacco, alcohol, and follow-up questions."],
  ["prevention", "Infection Prevention", "Prevention", ["hand hygiene", "vaccine", "mask", "food safety", "travel", "mosquito"], "Provides prevention checklists for infection exposure, food safety, travel health, mosquito illness, vaccines, and high-risk contacts."],
  ["records", "Doctor-Ready Summary", "Records", ["summary", "doctor note", "records", "timeline", "medicines", "labs", "vitals"], "Builds a concise patient timeline using symptoms, readings, medicines, labs, visits, warning signs, and questions."],
  ["records", "Patient Record Vault", "Records", ["patient profile", "history", "allergies", "medicine list", "conditions", "reports"], "Defines local record categories and supports private localhost storage with OneDrive mirror eligibility."],
  ["insurance", "Claim Readiness Checklist", "Insurance", ["claim", "coverage", "eob", "prior authorization", "denial", "appeal"], "Organizes claim documents, insurer details, dates, provider charges, policy questions, and appeal readiness."],
  ["insurance", "Prior Authorization Packet", "Insurance", ["prior auth", "authorization", "medical necessity", "denial", "appeal", "provider"], "Prepares a non-legal, non-coverage-decision checklist for prior authorization and provider follow-up."],
  ["safety", "Urgent Symptom Boundary", "Urgent Safety", ["chest pain", "breathing trouble", "stroke", "fainting", "severe allergy", "confusion"], "Keeps critical symptoms on the safety path and avoids delaying real-world emergency care."],
  ["safety", "Medical Advice Guardrails", "Urgent Safety", ["diagnosis", "prescription", "dose", "emergency", "doctor", "clinician"], "Blocks diagnosis, prescribing, dose calculation, emergency dispatch claims, and unsupported certainty."],
  ["research", "Research Summary Boundary", "Research Publications", ["research", "study", "clinical trial", "publication", "evidence", "guideline"], "Summarizes research context cautiously and separates study findings from individual medical advice."],
  ["research", "Evidence Update Workflow", "Research Publications", ["update", "review", "source", "guideline", "version", "rollback"], "Defines how new sources enter the offline repository through license, de-identification, review, indexing, testing, and rollback."],
  ["general", "Sleep, Fatigue, and Recovery Review", "Sleep Medicine", ["sleep", "insomnia", "snoring", "fatigue", "tired", "sleep apnea", "daytime sleepiness"], "Organizes sleep and fatigue questions around bedtime routine, snoring, breathing pauses, medicines, caffeine, mood, and daytime function."],
  ["general", "Urinary Symptom and Hydration Review", "General", ["urine", "burning", "frequency", "urinary", "dehydration", "flank pain", "blood in urine"], "Structures urinary symptoms using timing, fever, hydration, pregnancy context, flank pain, blood, and follow-up questions."],
  ["specialist", "Thyroid and Hormone Pathway", "Endocrinology", ["thyroid", "tsh", "t4", "t3", "hormone", "weight change", "palpitation"], "Connects thyroid symptoms, hormone results, medicine timing, pregnancy context, and follow-up planning."],
  ["specialist", "Migraine and Headache Pathway", "Neurology", ["migraine", "headache", "aura", "light sensitivity", "nausea", "vision change", "neurology"], "Separates routine headache review from severe sudden headache, neurologic symptoms, vision changes, and urgent warning signs."],
  ["specialist", "Digestive Chronic Care Pathway", "Gastrointestinal", ["ibd", "ulcer", "reflux", "abdominal pain", "bowel change", "weight loss", "vomiting"], "Organizes ongoing digestive disease concerns around pain pattern, food triggers, bleeding, weight change, dehydration, and report trends."],
  ["vitals", "Hydration, Weight, and Daily Recovery Review", "Vitals", ["hydration", "weight", "water", "fatigue", "recovery", "steps", "sleep"], "Links hydration, weight change, sleep, activity, heat exposure, illness, and daily-recovery habits to home monitoring."],
  ["medicine", "Antibiotic and Infection Medicine Review", "Medication Safety", ["antibiotic", "infection", "course", "diarrhea", "rash", "dose timing", "missed dose"], "Organizes antibiotic label review, allergy history, course completion questions, side effects, and when to call a pharmacist or clinician."],
  ["medicine", "Blood Thinner and Bleeding Safety", "Medication Safety", ["blood thinner", "warfarin", "apixaban", "rivaroxaban", "bleeding", "bruising", "interaction"], "Helps organize anticoagulant safety questions, bleeding signs, procedure timing, medicine interactions, and urgent escalation boundaries."],
  ["labs", "Urine and Kidney Test Review", "Lab Explanation", ["urinalysis", "protein", "ketone", "blood in urine", "microalbumin", "kidney", "culture"], "Explains common urine and kidney-test wording and prepares follow-up questions around infection, diabetes, BP, and hydration."],
  ["imaging", "Brain and Neurologic Imaging Vocabulary", "Imaging Knowledge", ["brain mri", "ct head", "lesion", "infarct", "bleed", "mass effect", "ventricle"], "Explains common neurologic imaging terms as report-language support and keeps stroke or seizure symptoms on the urgent path."],
  ["procedures", "Injection, Vaccine, and Infusion Preparation", "Procedures", ["vaccine", "injection", "infusion", "allergy", "reaction", "hydration", "post observation"], "Prepares questions for vaccines, injections, and infusions using allergy history, prior reactions, hydration, and observation instructions."],
  ["prevention", "Travel Health and Exposure Planner", "Travel Health", ["travel", "mosquito", "food safety", "vaccine", "altitude", "jet lag", "dehydration"], "Builds travel-health prevention questions around destination risk, vaccines, food and water safety, medicines, and exposure symptoms."],
  ["prevention", "Bone, Fall, and Mobility Prevention", "Bone Health", ["bone", "vitamin d", "calcium", "fall prevention", "osteoporosis", "balance", "fracture"], "Organizes bone-health and mobility planning around fall risk, nutrition, strength, home safety, and routine follow-up."],
  ["records", "Discharge and Follow-up Handoff Packet", "Care Transitions", ["discharge", "follow up", "care plan", "summary", "medicines", "warning signs", "next appointment"], "Creates a clear care-transition checklist with discharge changes, medicines, warning signs, contact details, and next appointments."],
  ["insurance", "Benefit Match and Plan-Fit Review", "Insurance", ["benefit", "deductible", "network", "copay", "coinsurance", "plan fit", "out of pocket"], "Structures questions about benefits, network fit, likely documents, cost sharing, and the next call or appeal step."],
  ["safety", "Poison, Overdose, and Exposure Boundary", "Urgent Safety", ["poison", "overdose", "ingestion", "chemical exposure", "wrong medicine", "child swallowed"], "Keeps poison and overdose events on the urgent path and organizes what information must be ready for real-world help."],
  ["research", "Guideline Comparison Workflow", "Research Publications", ["guideline comparison", "society guideline", "version", "consensus", "evidence quality", "update"], "Explains how guideline updates, source recency, consensus, and evidence quality should be compared before knowledge is adopted locally."]
];

const safetyNoteByCategory = {
  "Urgent Safety": "Do not delay emergency or urgent real-world care for severe, sudden, or rapidly worsening symptoms.",
  "Medication Safety": "Do not start, stop, substitute, double, or calculate medicine doses from this offline repository.",
  "Lab Explanation": "Lab values require patient context, reference ranges, trends, and clinician review.",
  "Imaging Knowledge": "The system explains report wording only. It does not read images or replace radiology interpretation.",
  "Procedures": "Procedure preparation and recovery must follow the clinician or facility instructions.",
  "Insurance": "This supports claim organization only and does not decide coverage or provide legal advice."
};

const sourceFamilyByArea = {
  general: "public-health-guidelines",
  specialist: "clinical-reference-pack",
  vitals: "clinical-reference-pack",
  medicine: "medicine-reference-pack",
  labs: "lab-imaging-reference-pack",
  imaging: "lab-imaging-reference-pack",
  procedures: "clinical-reference-pack",
  prevention: "public-health-guidelines",
  records: "operations-care-pack",
  insurance: "operations-care-pack",
  safety: "public-health-guidelines",
  research: "clinical-reference-pack"
};

const stopWords = new Set(["a", "and", "are", "as", "by", "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "to", "with"]);

await mkdir(dataDir, { recursive: true });
await mkdir(sourcePackDir, { recursive: true });

const baseDb = JSON.parse(await readFile(baseDbPath, "utf8"));
const generatedAt = new Date().toISOString();
const repositoryRecords = topicCatalog.map(([area, title, category, keywords, summary], index) => {
  const sourceFamily = sourceFamilyByArea[area] || "clinical-reference-pack";
  const source = sourceRegistry.find((item) => item.id === sourceFamily);

  return enrichOfflineKnowledgeRecord({
    id: `repo-${area}-${slug(title)}`,
    title,
    category,
    contentType: area,
    keywords: dedupe([...keywords, category, area, title]),
    summary,
    safetyNotes: safetyNoteByCategory[category] || "Use this as educational support and care preparation only. Clinician review is required for diagnosis, treatment, prescriptions, or urgent decisions.",
    source: `${source?.name || "Care Nova governed source pack"} curated metadata seed`,
    sourceFamily,
    evidenceLevel: "governed-educational-reference",
    verificationStatus: "clinician-review-required-before-production",
    lastReviewed: generatedAt.slice(0, 10),
    updateCadence: source?.updateCadence || "source-versioned-release-cycle"
  }, {
    fallbackId: `repo-${area}-${slug(title)}`
  });
});

const baseRecords = Array.isArray(baseDb.records)
  ? baseDb.records.map((record, index) => enrichOfflineKnowledgeRecord(record, { fallbackId: `base-record-${index + 1}` }))
  : [];
const { packRecords, packSummaries, packIssues } = await loadSourcePacks({
  sourcePackDir,
  sourceRegistry,
  generatedAt
});

const allRecords = [
  ...baseRecords,
  ...repositoryRecords,
  ...packRecords
];

const searchIndex = buildSearchIndex(allRecords);
const repository = {
  name: "Care Nova Offline Clinical Repository",
  version: "2.3.0",
  generatedAt,
  mode: "offline-governed-retrieval-repository",
  repositoryPolicy: {
    intendedUse: "Offline patient education, care preparation, record organization, and safety-boundary support.",
    prohibitedUse: ["diagnosis", "prescribing", "dosage calculation", "emergency dispatch", "replacing clinician judgment"],
    copyrightedTextPolicy: "Do not store copyrighted textbooks, full guidelines, or proprietary protocols unless licensing allows it.",
    productionGate: "Every imported clinical source requires source approval, license review, PHI removal, clinician review, validation tests, and rollback metadata."
  },
  sourceRegistry,
  sourcePacks: packSummaries,
  recordCount: repositoryRecords.length + packRecords.length,
  records: [...repositoryRecords, ...packRecords]
};

const manifest = {
  name: "Care Nova Offline Repository Manifest",
  version: "2.3.0",
  generatedAt,
  databaseFiles: [
    "data/offline-medical-db.json",
    "data/offline-clinical-repository.json",
    "data/offline-knowledge-index.json",
    "data/offline-source-packs/*.json"
  ],
  sourceRegistry,
  sourcePacks: packSummaries,
  validation: {
    issueCount: packIssues.length,
    issues: packIssues
  },
  summary: {
    baseRecordCount: Array.isArray(baseDb.records) ? baseDb.records.length : 0,
    repositoryRecordCount: repositoryRecords.length,
    packRecordCount: packRecords.length,
    totalRetrievalRecords: allRecords.length,
    tokenCount: searchIndex.tokenCount,
    categoryCount: searchIndex.categories.length,
    contentTypeCount: searchIndex.contentTypes.length,
    populationSegmentCount: searchIndex.populationTags.length,
    structuredRecordCount: allRecords.filter((record) => Array.isArray(record.whatToTrack) && record.whatToTrack.length).length,
    sourceReferenceCount: searchIndex.sourceReferenceCount,
    maintenanceTagCount: allRecords.reduce((total, record) => total + (Array.isArray(record.maintenanceTags) ? record.maintenanceTags.length : 0), 0),
    averageQualityScore: allRecords.length ? Math.round(allRecords.reduce((total, record) => total + Number(record.qualityScore || 0), 0) / allRecords.length) : 0,
    validationIssueCount: packIssues.length,
    sourcePackCount: packSummaries.length,
    sourceFamilyCount: sourceRegistry.length,
    contentTypeDistribution: buildRecordDistribution(allRecords, (record) => record.contentType || inferContentType(record.category, record.keywords)),
    categoryDistribution: buildRecordDistribution(allRecords, (record) => record.category || "General"),
    sourceFamilyDistribution: buildRecordDistribution(allRecords, (record) => record.sourceFamily || inferSourceFamily(record.category)),
    populationDistribution: buildPopulationDistribution(allRecords),
    packDistribution: Object.fromEntries(packSummaries.map((pack) => [pack.id, pack.recordCount])),
    runsWithoutInternet: true,
    dependencyFree: true
  },
  maintenanceWorkflow: [
    "Collect source metadata and license status.",
    "Store modular local source packs in data/offline-source-packs with versioned record groups.",
    "Import only approved extracts, abstracts, tables, or clinician-authored summaries.",
    "Strip identifiers and reject patient PHI.",
    "Chunk into disease, medicine, lab, imaging, procedure, safety, operations, and research records.",
    "Generate lexical/vector-style index with term, category, source, and safety mappings.",
    "Run safety, retrieval, regression, and rollback checks before release.",
    "Version source manifests so old offline packs can be restored."
  ]
};

await writeFile(repositoryPath, `${JSON.stringify(repository, null, 2)}\n`, "utf8");
await writeFile(indexPath, `${JSON.stringify(searchIndex, null, 2)}\n`, "utf8");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log("Offline clinical repository built.");
console.log(`Base records: ${manifest.summary.baseRecordCount}`);
console.log(`Repository records: ${manifest.summary.repositoryRecordCount}`);
console.log(`Source-pack records: ${manifest.summary.packRecordCount}`);
console.log(`Total retrieval records: ${manifest.summary.totalRetrievalRecords}`);
console.log(`Index tokens: ${manifest.summary.tokenCount}`);

function buildSearchIndex(records) {
  const recordMap = new Map(records.map((record) => [cleanText(record.id), record]));
  const documents = records.map((record, index) => {
    const id = cleanText(record.id) || `record-${index + 1}`;
    const title = cleanText(record.title);
    const category = cleanText(record.category);
    const contentType = cleanText(record.contentType || inferContentType(category, record.keywords));
    const sourceFamily = cleanText(record.sourceFamily || inferSourceFamily(category));
    const text = [
      title,
      category,
      contentType,
      sourceFamily,
      Array.isArray(record.keywords) ? record.keywords.join(" ") : "",
      Array.isArray(record.aliases) ? record.aliases.join(" ") : "",
      Array.isArray(record.relatedTerms) ? record.relatedTerms.join(" ") : "",
      Array.isArray(record.routeTags) ? record.routeTags.join(" ") : "",
      Array.isArray(record.clinicalDomains) ? record.clinicalDomains.join(" ") : "",
      Array.isArray(record.populationTags) ? record.populationTags.join(" ") : "",
      record.summary,
      record.safetyNotes,
      Array.isArray(record.whatToTrack) ? record.whatToTrack.join(" ") : "",
      Array.isArray(record.careQuestions) ? record.careQuestions.join(" ") : "",
      Array.isArray(record.precautions) ? record.precautions.join(" ") : "",
      Array.isArray(record.redFlagTerms) ? record.redFlagTerms.join(" ") : "",
      Array.isArray(record.queryPrompts) ? record.queryPrompts.join(" ") : "",
      Array.isArray(record.sourceReferences) ? record.sourceReferences.join(" ") : "",
      Array.isArray(record.maintenanceTags) ? record.maintenanceTags.join(" ") : "",
      Array.isArray(record.evidenceSignals) ? record.evidenceSignals.join(" ") : "",
      String(record.qualityScore || ""),
      cleanText(record.sections?.overview),
      Array.isArray(record.sections?.whatToTrack) ? record.sections.whatToTrack.join(" ") : "",
      Array.isArray(record.sections?.careQuestions) ? record.sections.careQuestions.join(" ") : "",
      Array.isArray(record.sections?.precautions) ? record.sections.precautions.join(" ") : "",
      Array.isArray(record.sections?.sourceReferences) ? record.sections.sourceReferences.join(" ") : "",
      record.retrievalText
    ].join(" ");
    const tokens = tokenize(text);

    return {
      id,
      title,
      category,
      contentType,
      sourceFamily,
      populationTags: Array.isArray(record.populationTags) ? dedupeKnowledgeList(record.populationTags, 6) : [],
      tokenCount: tokens.length,
      topTerms: topTerms(tokens, 12)
    };
  });

  const termIndex = {};
  const categoryIndex = {};
  const contentTypeIndex = {};
  const sourceIndex = {};
  const populationIndex = {};
  let sourceReferenceCount = 0;

  for (const document of documents) {
    addToIndex(categoryIndex, document.category, document.id);
    addToIndex(contentTypeIndex, document.contentType, document.id);
    addToIndex(sourceIndex, document.sourceFamily, document.id);
    for (const tag of document.populationTags) {
      addToIndex(populationIndex, tag, document.id);
    }
    const sourceReferenceTerms = Array.isArray(recordMap.get(cleanText(document.id))?.sourceReferences)
      ? recordMap.get(cleanText(document.id)).sourceReferences
      : [];
    sourceReferenceCount += sourceReferenceTerms.length;

    for (const term of document.topTerms) {
      addToIndex(termIndex, term.term, {
        id: document.id,
        weight: term.weight
      });
    }
  }

  return {
    name: "Care Nova Offline Knowledge Retrieval Index",
    version: "2.3.0",
    generatedAt,
    mode: "dependency-free-local-lexical-vector-index",
    algorithm: "token normalization + enriched local sections + term frequency weights + category/content-type/source/population indexes + runtime TF-IDF semantic ranker",
    documentCount: documents.length,
    tokenCount: Object.keys(termIndex).length,
    sourceReferenceCount,
    categories: Object.keys(categoryIndex).sort(),
    contentTypes: Object.keys(contentTypeIndex).sort(),
    sourceFamilies: Object.keys(sourceIndex).sort(),
    populationTags: Object.keys(populationIndex).sort(),
    documents,
    termIndex,
    categoryIndex,
    contentTypeIndex,
    sourceIndex,
    populationIndex
  };
}

function tokenize(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/%.\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function topTerms(tokens, limit) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return Array.from(counts, ([term, count]) => ({
    term,
    weight: Number((count / Math.max(tokens.length, 1)).toFixed(4))
  }))
    .sort((left, right) => right.weight - left.weight || left.term.localeCompare(right.term))
    .slice(0, limit);
}

function addToIndex(index, key, value) {
  const normalizedKey = cleanText(key) || "uncategorized";
  index[normalizedKey] ||= [];
  index[normalizedKey].push(value);
}

function inferSourceFamily(category) {
  if (/medication/i.test(category)) return "medicine-reference-pack";
  if (/lab|imaging/i.test(category)) return "lab-imaging-reference-pack";
  if (/insurance|records/i.test(category)) return "operations-care-pack";
  if (/urgent|prevention/i.test(category)) return "public-health-guidelines";
  return "clinical-reference-pack";
}

function inferContentType(category, keywords = []) {
  const text = cleanText([category, ...(Array.isArray(keywords) ? keywords : [])].join(" ")).toLowerCase();
  if (/medication|tablet|pill|pharmacy|dose/.test(text)) return "medicine";
  if (/lab|cbc|a1c|cholesterol|creatinine|egfr|tsh|bilirubin/.test(text)) return "labs";
  if (/xray|x-ray|mri|ct|scan|ultrasound|imaging/.test(text)) return "imaging";
  if (/insurance|claim|eob|prior auth|authorization|billing/.test(text)) return "insurance";
  if (/records|timeline|summary|care transitions/.test(text)) return "records";
  if (/urgent|warning sign|stroke|fainting|severe allergy/.test(text)) return "safety";
  if (/prevention|vaccine|diet|sleep|hydration|activity|travel health|bone health/.test(text)) return "prevention";
  if (/vitals|blood pressure|pulse|oxygen|temperature|bmi|weight/.test(text)) return "vitals";
  if (/cardiology|endocrinology|pulmonology|neurology|nephrology|hepatology|gynecology|pediatrics/.test(text)) return "specialist";
  return "general";
}

async function loadSourcePacks({ sourcePackDir, sourceRegistry, generatedAt }) {
  let fileNames = [];

  try {
    fileNames = (await readdir(sourcePackDir))
      .filter((name) => name.toLowerCase().endsWith(".json"))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return { packRecords: [], packSummaries: [], packIssues: [] };
  }

  const packRecords = [];
  const packSummaries = [];
  const packIssues = [];

  for (const fileName of fileNames) {
    const filePath = path.join(sourcePackDir, fileName);

    try {
      const raw = JSON.parse(await readFile(filePath, "utf8"));
      const packId = cleanText(raw.id) || slug(fileName.replace(/\.json$/i, ""));
      const packName = cleanText(raw.name) || packId;
      const packVersion = cleanText(raw.version) || "1.0.0";
      const packSourceFamily = cleanText(raw.sourceFamily) || "clinical-reference-pack";
      const source = sourceRegistry.find((item) => item.id === packSourceFamily);
      const records = Array.isArray(raw.records) ? raw.records : [];
      const normalizedRecords = records
        .map((record, index) => {
          const fallbackId = `${packId}-${index + 1}`;
          return enrichOfflineKnowledgeRecord({
            ...record,
            id: cleanText(record.id) || fallbackId,
            source: cleanText(record.source) || `${packName} local source pack`,
            sourceFamily: cleanText(record.sourceFamily) || packSourceFamily,
            evidenceLevel: cleanText(record.evidenceLevel) || "governed-local-pack",
            verificationStatus: cleanText(record.verificationStatus) || "pack-review-required-before-production",
            lastReviewed: cleanText(record.lastReviewed) || generatedAt.slice(0, 10),
            updateCadence: cleanText(record.updateCadence) || cleanText(raw.updateCadence) || source?.updateCadence || "source-versioned-release-cycle",
            sourceReferences: dedupeKnowledgeList([
              ...(Array.isArray(record.sourceReferences) ? record.sourceReferences : []),
              packName,
              source?.name || "",
              cleanText(raw.description),
              cleanText(raw.reviewStatus)
            ], 10),
            maintenanceTags: dedupeKnowledgeList([
              ...(Array.isArray(record.maintenanceTags) ? record.maintenanceTags : []),
              "source-pack",
              packId
            ], 10)
          }, {
            fallbackId
          });
        })
        .filter((record) => record.summary && Array.isArray(record.keywords) && record.keywords.length);
      const recordQualityIssues = normalizedRecords.flatMap((record) =>
        validateSourcePackRecord(record).map((issue) => `${packId}/${record.id}: ${issue}`)
      );

      if (normalizedRecords.length !== records.length) {
        packIssues.push(`${packId}: ${records.length - normalizedRecords.length} record(s) were skipped because required summary/keyword fields were incomplete.`);
      }

      packIssues.push(...recordQualityIssues);

      packRecords.push(...normalizedRecords);
      packSummaries.push({
        id: packId,
        name: packName,
        version: packVersion,
        sourceFamily: packSourceFamily,
        recordCount: normalizedRecords.length,
        warningCount: recordQualityIssues.length,
        contentTypeDistribution: buildRecordDistribution(normalizedRecords, (record) => record.contentType || inferContentType(record.category, record.keywords)),
        categoryDistribution: buildRecordDistribution(normalizedRecords, (record) => record.category || "General"),
        description: cleanText(raw.description),
        reviewStatus: cleanText(raw.reviewStatus),
        updateCadence: cleanText(raw.updateCadence) || source?.updateCadence || ""
      });
    } catch (error) {
      packIssues.push(`${fileName}: ${error.message}`);
    }
  }

  return { packRecords, packSummaries, packIssues };
}

function validateSourcePackRecord(record = {}) {
  const issues = [];
  const qualityScore = Number(record.qualityScore || 0);
  const whatToTrackCount = Array.isArray(record.whatToTrack) ? record.whatToTrack.length : 0;
  const careQuestionsCount = Array.isArray(record.careQuestions) ? record.careQuestions.length : 0;
  const precautionsCount = Array.isArray(record.precautions) ? record.precautions.length : 0;
  const sourceReferenceCount = Array.isArray(record.sourceReferences) ? record.sourceReferences.length : 0;
  const routeTagCount = Array.isArray(record.routeTags) ? record.routeTags.length : 0;
  const summaryWordCount = cleanText(record.summary).split(/\s+/).filter(Boolean).length;
  const safetyNotes = cleanText(record.safetyNotes);
  const verificationStatus = cleanText(record.verificationStatus);

  if (qualityScore < 90) {
    issues.push(`qualityScore ${qualityScore || 0} is below the governed-pack floor of 90.`);
  }

  if (summaryWordCount < 12) {
    issues.push("summary is too short for dependable retrieval grounding.");
  }

  if (routeTagCount === 0) {
    issues.push("routeTags are missing, so route-specific retrieval may drift.");
  }

  if (whatToTrackCount < 2) {
    issues.push("whatToTrack should contain at least 2 concrete monitoring prompts.");
  }

  if (careQuestionsCount < 2) {
    issues.push("careQuestions should contain at least 2 clinician-ready questions.");
  }

  if (precautionsCount < 2) {
    issues.push("precautions should contain at least 2 safe-boundary reminders.");
  }

  if (sourceReferenceCount < 2) {
    issues.push("sourceReferences should include at least 2 provenance hints.");
  }

  if (!safetyNotes) {
    issues.push("safetyNotes are missing.");
  }

  if (!verificationStatus) {
    issues.push("verificationStatus is missing.");
  }

  return issues;
}

function slug(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function cleanText(value) {
  return cleanKnowledgeText(value);
}

function dedupe(items) {
  return Array.from(new Set(items.map(cleanText).filter(Boolean)));
}

function buildRecordDistribution(records, selector) {
  return buildValueDistribution(records.map((record) => selector(record)));
}

function buildPopulationDistribution(records) {
  return buildValueDistribution(records.flatMap((record) => Array.isArray(record.populationTags) ? record.populationTags : []));
}

function buildValueDistribution(values) {
  const counts = {};

  for (const value of values) {
    const key = cleanText(value) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  );
}
