const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectDir = __dirname;
const outputDir = path.join(projectDir, "renders");
const guideVersion = "v24";
const outputFile = path.join(outputDir, `care-nova-ai-usage-guide-${guideVersion}.webm`);
const tempOutputFile = `${outputFile}.part`;
const narrationTextFile = path.join(outputDir, `care-nova-ai-usage-guide-${guideVersion}-narration.txt`);
const narrationAudioFile = path.join(outputDir, `care-nova-ai-usage-guide-${guideVersion}-narration.wav`);
const narrationScriptFile = path.join(outputDir, `care-nova-ai-usage-guide-${guideVersion}-narration.ps1`);
const narrationSegmentDir = path.join(outputDir, `care-nova-ai-usage-guide-${guideVersion}-segments`);
const chromePath = path.join(
  os.homedir(),
  ".cache",
  "hyperframes",
  "chrome",
  "chrome-headless-shell",
  "win64-131.0.6778.85",
  "chrome-headless-shell-win64",
  "chrome-headless-shell.exe"
);
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const fps = 24;
const baseWidth = 1280;
const baseHeight = 720;
const renderScale = 2;
const renderWidth = Math.round(baseWidth * renderScale);
const renderHeight = Math.round(baseHeight * renderScale);
const sceneDuration = 14.8;
const narrationLines = [
  "Start with the promise: Care Nova is a private health workspace for focused questions, organized records, and safer next steps.",
  "Set the trust layer first. Keep records local, confirm the OneDrive mirror, and choose what gets shared.",
  "Build the patient profile with age, conditions, medicines, allergies, baseline readings, care contacts, and preferences.",
  "Ask one focused question. Include timing, severity, readings, medicine context, recent changes, and warning signs.",
  "Watch the agent loop: memory loads, intent routes, one specialist answers, safety checks run, and useful details save.",
  "Use General for everyday symptoms, prevention, and a safe first step when the right tab is not obvious.",
  "Use Specialist for deeper review across chronic conditions and body systems when the question needs more clinical context.",
  "Use Atlas to learn conditions, tests, medicines, imaging, first aid, prevention, and urgent warning signs.",
  "Use Vitals to review blood pressure, sugar, pulse, oxygen, temperature, BMI, measurement quality, and trends.",
  "Use Medicine for plain-language education on names, uses, side effects, missed timing, interactions, storage, and pharmacist questions.",
  "Use Labs to extract markers, explain values, compare trends, identify gaps, and export a doctor-ready summary.",
  "Use Wellness to shape realistic routines for sleep, food, hydration, walking, stress, mental health, prevention, and habits.",
  "Use Visits to prepare appointment reason, specialty, urgency, questions, record packets, and follow-up notes.",
  "Use Safety first when red flags appear. It explains urgency, immediate safe actions, details to collect, and app limits.",
  "Use Insurance to organize claims, benefits, documents, prior authorization, EOBs, appeals, deadlines, and coverage questions.",
  "Use Records after meaningful checks so symptoms, vitals, labs, medicines, visits, claims, and summaries stay searchable.",
  "Use Summary before handoffs to review the current story, risk signals, trends, missing data, and doctor notes.",
  "Choose Guided for simple steps, Expert for evidence detail, and language controls for accessible use.",
  "Online mode can enrich approved references. Offline mode still uses saved records, cached guides, and local memory.",
  "Improve accuracy by saving useful answers, adding missing context, approving feedback, and letting calibration sharpen routing.",
  "Best daily flow: confirm profile, choose one tab, ask once, review safety, save, update records, then summarize.",
  "Keep the boundary clear: Care Nova educates, organizes, and prepares better questions; decisions belong to qualified care teams."
];
const examplePrompts = [
  "Watch the Guide once, then use the workflow cards as the operating manual for your first patient run.",
  "Open Records and confirm local storage plus OneDrive mirror before saving private details.",
  "Add age 52, hypertension, diabetes, allergies, medicines, usual BP, sugar, and doctor contact.",
  "Headache since morning, 4/10, BP 150/95, no fever, medicine taken. What should I watch for?",
  "Follow the route trace: memory loaded, intent chosen, one agent replies, safety checks, memory saves.",
  "I have cough and mild fever for two days, no breathing trouble. What safe next step should I take?",
  "Review diabetes and high BP together: risks, warning signs, tests, daily monitoring, and doctor questions.",
  "Search Atlas for asthma: symptoms, triggers, inhaler questions, tests, precautions, and urgent signs.",
  "BP 160/98 with headache after walking; pulse 92. Help me review readings, pattern, and next step.",
  "Amlodipine and metformin: uses, side effects to watch, missed timing, interactions, and pharmacist questions.",
  "HbA1c 8.2, LDL 160, creatinine normal. Explain the report and build doctor questions.",
  "Create a 7-day routine for age 52 with diabetes, sleep issues, stress, hydration, and walking goal.",
  "Plan a follow-up for high BP, headache, lab review, medicine questions, and preferred appointment mode.",
  "Check chest pain, breathing trouble, fainting, one-sided weakness, severe allergy, or rapid worsening.",
  "Organize a claim with insurer, policy ID, provider bill, doctor note, lab report, EOB, and deadline.",
  "Save this run with symptom, risk, readings, medicine context, answer, and follow-up task.",
  "Create a doctor-ready summary from recent symptoms, vitals, labs, medicines, claims, and missing data.",
  "Guided for quick patient steps; Expert for route trace, evidence, gaps, and deeper review.",
  "Use offline for records and cached guides; use online enrichment only from approved sources when available.",
  "Mark helpful, add missing details, save feedback, and let the next route become more precise.",
  "Daily loop: profile, one tab, one question, safety check, save output, update summary.",
  "Use Care Nova for education, organization, preparation, and better questions; urgent symptoms need real-world care."
];
const resultPreviews = [
  "A complete app map: what to open, what to enter, what to save, and when to use each tab.",
  "A private setup path with local records, OneDrive mirror, offline continuity, and user-controlled sharing.",
  "A reusable patient context that improves routing, summaries, safety checks, and doctor-ready notes.",
  "A precise answer with risk band, reason, next safe step, missing details, and save option.",
  "A visible route trace: memory, classifier, one specialist, guardrails, reply, and local memory update.",
  "A plain-language response with safety checks, follow-up question, and record-ready summary.",
  "Disease-focused review with risks, tests to discuss, prevention points, and specialist questions.",
  "Professional guide pages with overview, symptoms, tests, care options, prevention, and urgent signs.",
  "Vitals review with trend context, maintenance tips, BMI support, and warning-sign escalation.",
  "Medicine guidance with uses, side-effect signals, interaction questions, and safe pharmacist handoff.",
  "Lab interpretation with marker meaning, range context, trend clues, missing data, and downloadable report.",
  "Personal wellness plan with age group, lifestyle score, habit goals, and feedback loop.",
  "Hospital-ready visit prep: specialty, urgency, booking details, questions, and follow-up note.",
  "Safety guidance with red flags, urgency reason, information to collect, and real-care boundary.",
  "Claim navigator output with document gaps, benefits questions, deadlines, and appeal preparation.",
  "Searchable patient history stored locally with types, dates, reports, and OneDrive mirror.",
  "Current care story: key events, risk trend, missing context, doctor note, and readiness score.",
  "Two real views: beginner-safe Guided mode and detailed Expert mode for review and evidence.",
  "Same core offline, optional online enrichment, cached references, and local source of truth.",
  "Accuracy loop: saved answer, feedback, missing context, improved route fit, and better summaries.",
  "A repeatable workflow that keeps the model focused, safe, and easy for any user.",
  "Clear limits: education and organization only, with urgent symptoms directed to real care."
];
const masteryTips = [
  "Mastery: follow the same loop so memory stays clean.",
  "Mastery: keep sensitive records local unless you choose to share.",
  "Mastery: update profile before asking serious or repeated questions.",
  "Mastery: one concern plus timing gives a cleaner answer.",
  "Mastery: one routed agent keeps the response precise.",
  "Mastery: use General when you need the safest starting point.",
  "Mastery: name the disease area and what changed recently.",
  "Mastery: learn in Atlas, then use a tab for action planning.",
  "Mastery: compare repeat readings with symptoms and timing.",
  "Mastery: prepare pharmacist questions; do not self-adjust doses.",
  "Mastery: include units, reference ranges, date, and prior trend.",
  "Mastery: make plans realistic for age, routine, and conditions.",
  "Mastery: capture reason, urgency, specialty, and questions.",
  "Mastery: urgent signs override routine guidance.",
  "Mastery: clean evidence and deadlines improve claim readiness.",
  "Mastery: save after each meaningful check.",
  "Mastery: open Summary before a doctor visit or handoff.",
  "Mastery: Guided simplifies; Expert exposes deeper review.",
  "Mastery: offline stays usable; online only enriches.",
  "Mastery: mark what helped and what was missing.",
  "Mastery: profile, ask, review, save, summarize.",
  "Mastery: use Care Nova for preparation, not medical decisions."
];
const qualityChecks = [
  "Quality check: purpose, boundary, and tabs are understood.",
  "Quality check: local storage, mirror, and sharing choice are clear.",
  "Quality check: patient context is complete enough for routing.",
  "Quality check: symptom, timing, severity, readings, and red flags are present.",
  "Quality check: memory, route, agent, safety, reply, and save are visible.",
  "Quality check: one question receives one safe first step.",
  "Quality check: condition, recent change, risk factors, and questions are included.",
  "Quality check: overview, tracking, care options, and precautions are reviewed.",
  "Quality check: values include time, symptoms, medicine, and repeat context.",
  "Quality check: medicine name, timing, reaction, and interaction concern are entered.",
  "Quality check: report date, units, range, trend, and missing values are captured.",
  "Quality check: routine fits age, condition, schedule, and energy level.",
  "Quality check: visit reason, specialty, urgency, records, and questions are ready.",
  "Quality check: warning signs and escalation boundary are reviewed first.",
  "Quality check: policy, EOB, documents, dates, and appeal deadline are organized.",
  "Quality check: every saved record has patient, type, date, and source.",
  "Quality check: latest events, gaps, risk, and doctor note are visible.",
  "Quality check: Guided and Expert modes support different users.",
  "Quality check: online enrichment is optional and cached locally.",
  "Quality check: feedback improves route fit without changing medical facts.",
  "Quality check: repeatable workflow keeps the model focused.",
  "Quality check: final decisions stay with clinicians and real care teams."
];
const nextActions = [
  "Save: first run plan, active patient, and preferred workflow.",
  "Verify: local vault, OneDrive mirror, and sharing settings.",
  "Save: profile card, medicines, allergies, baseline readings, contacts.",
  "Verify: timing, severity, readings, medicine timing, and warning signs.",
  "Watch: memory, route, one agent, guardrails, reply, and save.",
  "Save: plain next step plus missing details to ask later.",
  "Save: disease focus, red flags, tests to discuss, and care questions.",
  "Bookmark: overview, symptoms, tests, prevention, precautions.",
  "Save: reading value, time, symptoms, medicine, repeat context.",
  "Save: medicine name, timing, concern, reaction, pharmacist questions.",
  "Download: report summary with marker, range, date, and questions.",
  "Save: weekly habit plan, age group, goals, and feedback.",
  "Prepare: booking reason, specialty, urgency, records, questions.",
  "Escalate: warning signs first; do not wait for perfect details.",
  "Track: claim type, policy, documents, deadlines, and appeal notes.",
  "Store: patient, record type, date, source, and follow-up task.",
  "Share: doctor-ready summary, latest risk, gaps, and timeline.",
  "Choose: Guided for simple use, Expert for evidence review.",
  "Cache: approved online references for future offline use.",
  "Train: approve helpful feedback and add missing context.",
  "Repeat: profile, tab, one question, safety, save, summary.",
  "Remember: education, organization, preparation, then real care."
];
const scenes = [
  {
    chapter: "01",
    section: "What it is",
    title: "Care Nova is a local-first health agent workspace.",
    explain: "Use it to organize health questions, records, vitals, medicines, labs, visits, safety checks, and insurance support.",
    useWhen: "Watch this before your first complete run.",
    bullets: [
      ["One workspace", "Each tab has a focused autonomous helper."],
      ["Local memory", "Patient context is reused from saved records."],
      ["Safe guidance", "Answers stay educational and next-step focused."]
    ],
    footer: "Think of it as a private health command center, not a medical device."
  },
  {
    chapter: "02",
    section: "Privacy setup",
    title: "Start with local data and the active patient.",
    explain: "Care Nova stores patient data on the local app server and can mirror records to the local OneDrive workspace.",
    useWhen: "Use this when setting up a new device.",
    bullets: [
      ["Localhost store", "Memory, records, and training stay on this machine."],
      ["OneDrive mirror", "A local copy helps protect against accidental loss."],
      ["No cloud by default", "The demo does not upload private records automatically."]
    ],
    footer: "Privacy-first workflow: save locally, review, then share only when needed."
  },
  {
    chapter: "03",
    section: "Profile",
    title: "The profile becomes the base memory for answers.",
    explain: "Add age, known conditions, medicines, allergies, baseline readings, doctor, caregiver, and emergency contact.",
    useWhen: "Do this before asking health questions.",
    bullets: [
      ["Patient details", "Name, age, conditions, allergies, and care team."],
      ["Medicine list", "Names, timing, reason used, and known reactions."],
      ["Baseline values", "Usual BP, sugar, pulse, weight, and important notes."]
    ],
    footer: "Better profile data means sharper routing and better summaries."
  },
  {
    chapter: "04",
    section: "Best input",
    title: "Ask one clear question with useful context.",
    explain: "A strong message includes the main concern, start time, severity, readings, medicine timing, and warning signs.",
    useWhen: "Use this format in every agent tab.",
    bullets: [
      ["Main concern", "Example: headache, cough, missed dose, high BP."],
      ["Timing", "Say when it started and whether it is improving."],
      ["Safety signs", "Mention chest pain, breathing trouble, fainting, or weakness."]
    ],
    footer: "Example: Headache since morning, 4/10, BP 150/95, no fever."
  },
  {
    chapter: "05",
    section: "Agentic flow",
    title: "Every request follows the same safe agent loop.",
    explain: "The system loads memory, classifies intent, routes to one agent, checks safety, writes a simple reply, then updates memory.",
    useWhen: "This is the model flow behind every tab.",
    bullets: [
      ["Memory store", "Loads prior symptoms, medicines, and records."],
      ["Intent route", "Chooses general, medicine, visit, or urgent bucket."],
      ["Guardrails", "Blocks diagnosis, prescriptions, and unsafe advice."]
    ],
    footer: "One tab, one route, one focused response."
  },
  {
    chapter: "06",
    section: "General tab",
    title: "General is your first-layer health question agent.",
    explain: "Use General when you are unsure where to start or need a plain-language next step for a symptom or question.",
    useWhen: "Start here for everyday health questions.",
    bullets: [
      ["Enter", "Symptom, timing, severity, readings, and goal."],
      ["It returns", "Risk level, reason, next step, and missing details."],
      ["Save", "Useful answers become part of local patient memory."]
    ],
    footer: "Best for: headache, cough, fatigue, prevention, and general concerns."
  },
  {
    chapter: "07",
    section: "Specialist tab",
    title: "Specialist reviews core disease areas in depth.",
    explain: "Use Specialist for heart, diabetes, kidney, asthma, thyroid, liver, neurological, digestive, and chronic disease questions.",
    useWhen: "Use it when the concern links to a condition.",
    bullets: [
      ["Choose area", "Pick the body system or condition being reviewed."],
      ["See reasoning", "Risk factors, tests to discuss, and red flags."],
      ["Prepare care", "Build doctor questions and follow-up points."]
    ],
    footer: "It explains possibilities to discuss, not a final diagnosis."
  },
  {
    chapter: "08",
    section: "Atlas tab",
    title: "Atlas is the built-in health learning library.",
    explain: "Search disease, symptom, medicine, test, prevention, imaging, first-aid, and warning-sign guides.",
    useWhen: "Use it when you want to learn before acting.",
    bullets: [
      ["Disease guides", "Overview, symptoms, tests, care options, and precautions."],
      ["Medicine topics", "Uses, safety signals, and pharmacist questions."],
      ["Prevention", "Daily habits, screening, monitoring, and safety tips."]
    ],
    footer: "Use Atlas for learning. Use Safety for urgent symptoms."
  },
  {
    chapter: "09",
    section: "Vitals tab",
    title: "Vitals turns readings into safer daily context.",
    explain: "Track BP, pulse, oxygen, sugar, temperature, BMI, sleep, hydration, activity, and measurement quality.",
    useWhen: "Use it for high BP, sugar review, fever, pulse, or BMI.",
    bullets: [
      ["Enter values", "Add date, time, meal, medicine, symptom, and repeat reading."],
      ["Get context", "See trend, risk band, maintenance tips, and alerts."],
      ["Save trend", "Keep readings in Records for future comparison."]
    ],
    footer: "Vitals helps patterns make sense. Urgent symptoms still need real care."
  },
  {
    chapter: "10",
    section: "Medicine tab",
    title: "Medicine guides safe medicine conversations.",
    explain: "Ask about generic or branded medicines, uses, side effects, missed timing, allergy signs, interactions, and storage.",
    useWhen: "Use it before changing anything yourself.",
    bullets: [
      ["Enter", "Medicine name, timing, reason used, and symptoms."],
      ["Check", "Side effects, duplicate ingredients, and interaction questions."],
      ["Output", "Pharmacist-ready questions and safety reminders."]
    ],
    footer: "It does not prescribe or calculate personal dosage."
  },
  {
    chapter: "11",
    section: "Labs tab",
    title: "Labs turns reports into clear review points.",
    explain: "Upload or paste report values so the agent can organize markers, explain ranges, flag trends, and prepare questions.",
    useWhen: "Use it for HbA1c, CBC, lipids, kidney, liver, or thyroid.",
    bullets: [
      ["Upload or paste", "Add report text, values, units, ranges, and date."],
      ["Understand", "Plain language meaning, missing context, and trend clues."],
      ["Download", "Create patient-specific report summaries."]
    ],
    footer: "Lab reports should be confirmed by a clinician."
  },
  {
    chapter: "12",
    section: "Wellness tab",
    title: "Wellness builds practical healthy-life plans.",
    explain: "Use Wellness for age-group guidance, sleep, diet, hydration, walking, stress, mental wellness, and habit tracking.",
    useWhen: "Use it for daily improvement, not urgent care.",
    bullets: [
      ["Age plan", "Children, adults, seniors, and chronic-care routines."],
      ["Habit score", "Food, sleep, activity, water, stress, and screen time."],
      ["Feedback", "Save what worked so future plans fit better."]
    ],
    footer: "Small routines make the system more useful over time."
  },
  {
    chapter: "13",
    section: "Visits tab",
    title: "Visits prepares appointment and follow-up work.",
    explain: "Use Visits to plan booking details, organize symptoms, create doctor questions, and draft follow-up notes.",
    useWhen: "Use before calling a clinic or after a visit.",
    bullets: [
      ["Booking details", "Reason, specialty, urgency, date, mode, and location."],
      ["Follow-up", "What changed, what helped, and what worsened."],
      ["Visit note", "A clean handoff for the care team."]
    ],
    footer: "The app prepares booking information; it does not book live appointments."
  },
  {
    chapter: "14",
    section: "Safety tab",
    title: "Safety separates urgent signs from routine advice.",
    explain: "Use Safety for chest pain, breathing trouble, fainting, severe allergy, stroke signs, confusion, or rapid worsening.",
    useWhen: "Use it whenever the situation may be urgent.",
    bullets: [
      ["Check signs", "Red flags, why flagged, and first safe action."],
      ["Prepare call", "Symptoms, time started, readings, medicines, and allergies."],
      ["Boundary", "No emergency calls or live alerts in this demo."]
    ],
    footer: "If danger signs are active, seek real-world care immediately."
  },
  {
    chapter: "15",
    section: "Insurance tab",
    title: "Insurance guides claims and coverage steps.",
    explain: "Use Insurance for claim method, benefits, required documents, prior authorization, EOB review, appeals, and plan-fit questions.",
    useWhen: "Use it before submitting or questioning a claim.",
    bullets: [
      ["Claim intake", "Insurer, member ID, provider, dates, issue, and documents."],
      ["Document list", "Policy card, doctor note, report, estimate, and proof."],
      ["Appeal prep", "Draft points, missing evidence, and next questions."]
    ],
    footer: "It organizes claims; it does not make legal or coverage decisions."
  },
  {
    chapter: "16",
    section: "Records tab",
    title: "Records stores the patient journey locally.",
    explain: "Use Records to collect symptoms, vitals, labs, medicines, visits, insurance cases, summaries, and downloaded reports.",
    useWhen: "Use after every meaningful check.",
    bullets: [
      ["Save records", "Keep patient-specific data organized by type."],
      ["Search history", "Find old checks, reports, and notes quickly."],
      ["Export", "Download reports for a specific patient."]
    ],
    footer: "Good records improve future memory and handoff quality."
  },
  {
    chapter: "17",
    section: "Summary tab",
    title: "Summary turns history into a usable care snapshot.",
    explain: "Use Summary to see what happened till now, helpful areas, risk trend, missing data, and doctor-ready share notes.",
    useWhen: "Use before a visit or after several checks.",
    bullets: [
      ["Today focus", "Main concern, recent checks, and next safe action."],
      ["Doctor note", "Short handoff with context and questions."],
      ["Readiness", "Shows missing profile, vitals, labs, or medicine details."]
    ],
    footer: "Summary is the fastest way to understand the patient story."
  },
  {
    chapter: "18",
    section: "Modes and language",
    title: "Use Guided for simple steps and Expert for depth.",
    explain: "Guided reduces clutter and shows beginner-friendly steps. Expert exposes more panels, evidence, and workflow detail.",
    useWhen: "Switch modes depending on user experience.",
    bullets: [
      ["Guided", "Best for patients, demos, and quick checks."],
      ["Expert", "Best for reviewers, deeper analysis, and complex records."],
      ["Language", "Change the interface language from the header."]
    ],
    footer: "The same agents work underneath both modes."
  },
  {
    chapter: "19",
    section: "Online and offline",
    title: "The app keeps working with a local-first core.",
    explain: "Core workflows use local data. When online, external knowledge can enrich answers and then be cached for later use.",
    useWhen: "Use installed mode for privacy and continuity.",
    bullets: [
      ["Offline", "App shell, memory, records, and local guides remain usable."],
      ["Online", "Optional enrichment can update cached references."],
      ["Sync style", "Local storage remains the primary trusted source."]
    ],
    footer: "Online improves freshness; offline protects continuity."
  },
  {
    chapter: "20",
    section: "Accuracy loop",
    title: "Improve precision with saved feedback.",
    explain: "After a useful answer, save it and approve feedback. The local training layer improves routing and response fit.",
    useWhen: "Use after reviewing any good result.",
    bullets: [
      ["Save answer", "Keep high-quality examples with the patient record."],
      ["Approve feedback", "Mark what was helpful and what was missing."],
      ["Better routing", "Future requests choose the right agent faster."]
    ],
    footer: "Feedback improves workflow behavior, not unsafe medical self-training."
  },
  {
    chapter: "21",
    section: "Best workflow",
    title: "Use the same loop every day.",
    explain: "The most effective pattern is profile, choose tab, ask one question, review safety, save useful output, then update records.",
    useWhen: "Use this for demo, daily care, or follow-up.",
    bullets: [
      ["Profile", "Confirm the active patient and context first."],
      ["Ask", "One tab, one focused question, one agent response."],
      ["Save", "Store the result so memory improves next time."]
    ],
    footer: "This prevents messy answers and keeps the model precise."
  },
  {
    chapter: "22",
    section: "Safe close",
    title: "Know exactly what Care Nova does not do.",
    explain: "Care Nova supports education, organization, and safe next steps. It does not diagnose, prescribe, dose, or replace care.",
    useWhen: "Remember this boundary in every tab.",
    bullets: [
      ["No diagnosis", "It explains possibilities and questions to discuss."],
      ["No prescriptions", "Medicine changes belong to qualified clinicians."],
      ["No emergency action", "Urgent symptoms need real-world medical help."]
    ],
    footer: "Care Nova AI - built by Naveed Ahamed for local-first agentic care."
  }
];

function resolvePuppeteerCore() {
  const npxRoot = path.join(os.homedir(), "AppData", "Local", "npm-cache", "_npx");
  const candidates = fs.existsSync(npxRoot)
    ? fs.readdirSync(npxRoot).map((name) => path.join(npxRoot, name, "node_modules"))
    : [];

  for (const candidate of candidates) {
    try {
      return require(require.resolve("puppeteer-core", { paths: [candidate] }));
    } catch {
      // Try the next npx cache folder.
    }
  }

  throw new Error("puppeteer-core was not found in the local npx cache.");
}

function buildNarrationText() {
  return buildTimedNarrationSegments()
    .map((segment) => `${segment.id} @ ${segment.startSeconds.toFixed(1)}s\r\n${segment.text}`)
    .join("\r\n\r\n");
}

function buildTimedNarrationSegments() {
  return narrationLines.map((line, index) => {
    const chapterNumber = index + 1;
    const prefix = index === 0
      ? "Welcome to Care Nova AI, built by Naveed Ahamed."
      : `Chapter ${chapterNumber}.`;

    return {
      id: `chapter-${String(chapterNumber).padStart(2, "0")}`,
      startSeconds: index * sceneDuration + (index === 0 ? 0.75 : 1.05),
      text: `${prefix} ${line}`
    };
  });
}

function parsePcmWav(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Generated narration is not a WAV file.");
  }

  let offset = 12;
  let format = null;
  let data = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;

    if (chunkEnd > buffer.length) {
      break;
    }

    if (chunkId === "fmt ") {
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14)
      };
    }

    if (chunkId === "data") {
      data = buffer.subarray(chunkStart, chunkEnd);
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (!format || !data || format.audioFormat !== 1) {
    throw new Error("Generated narration WAV must be PCM audio.");
  }

  return { format, data };
}

function buildPcmWav(format, data) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(format.byteRate, 28);
  header.writeUInt16LE(format.blockAlign, 32);
  header.writeUInt16LE(format.bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function polishPcmSegment(format, sourceData) {
  if (format.bitsPerSample !== 16 || format.audioFormat !== 1) {
    return sourceData;
  }

  const data = Buffer.from(sourceData);
  const channels = Math.max(1, format.channels);
  const sampleCount = Math.floor(data.length / 2);
  const frameCount = Math.floor(sampleCount / channels);
  let peak = 1;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    peak = Math.max(peak, Math.abs(data.readInt16LE(sampleIndex * 2)));
  }

  const targetPeak = Math.round(32767 * 0.86);
  const gain = Math.min(2.6, targetPeak / peak);
  const fadeFrames = Math.min(Math.floor(format.sampleRate * 0.024), Math.floor(frameCount / 4));

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    let envelope = 1;
    if (fadeFrames > 0) {
      envelope = Math.min(envelope, frameIndex / fadeFrames);
      envelope = Math.min(envelope, (frameCount - 1 - frameIndex) / fadeFrames);
      envelope = Math.max(0, Math.min(1, envelope));
    }

    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      const byteIndex = (frameIndex * channels + channelIndex) * 2;
      const value = data.readInt16LE(byteIndex);
      const scaled = Math.max(-32768, Math.min(32767, Math.round(value * gain * envelope)));
      data.writeInt16LE(scaled, byteIndex);
    }
  }

  return data;
}

function writeAlignedNarration(segments, segmentFiles) {
  const parsedSegments = segmentFiles.map((file) => parsePcmWav(fs.readFileSync(file)));
  const baseFormat = parsedSegments[0]?.format;

  if (!baseFormat) {
    throw new Error("No narration segments were generated.");
  }

  parsedSegments.forEach((segment) => {
    const sameFormat = segment.format.channels === baseFormat.channels
      && segment.format.sampleRate === baseFormat.sampleRate
      && segment.format.byteRate === baseFormat.byteRate
      && segment.format.blockAlign === baseFormat.blockAlign
      && segment.format.bitsPerSample === baseFormat.bitsPerSample;

    if (!sameFormat) {
      throw new Error("Narration segment formats do not match.");
    }
  });

  const totalDuration = scenes.length * sceneDuration;
  const totalBlocks = Math.ceil(totalDuration * baseFormat.byteRate / baseFormat.blockAlign);
  const timeline = Buffer.alloc(totalBlocks * baseFormat.blockAlign);

  parsedSegments.forEach((segment, index) => {
    const startBlocks = Math.max(0, Math.floor(segments[index].startSeconds * baseFormat.byteRate / baseFormat.blockAlign));
    const startByte = startBlocks * baseFormat.blockAlign;
    const maxBytes = Math.max(0, timeline.length - startByte);
    const polishedData = polishPcmSegment(baseFormat, segment.data);
    polishedData.copy(timeline, startByte, 0, Math.min(polishedData.length, maxBytes));
  });

  fs.writeFileSync(narrationAudioFile, buildPcmWav(baseFormat, timeline));
}

function ensureNarrationAudio() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(narrationSegmentDir, { recursive: true });
  fs.writeFileSync(narrationTextFile, buildNarrationText(), "utf8");

  fs.writeFileSync(narrationScriptFile, [
    "param([string]$TextPath, [string]$AudioPath)",
    "Add-Type -AssemblyName System.Speech",
    "$text = (Get-Content -LiteralPath $TextPath -Raw).Trim()",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "try { $s.SelectVoice('Microsoft Zira Desktop') } catch { }",
    "$s.Rate = -3",
    "$s.Volume = 100",
    "$s.SetOutputToWaveFile($AudioPath)",
    "$s.Speak($text)",
    "$s.Dispose()"
  ].join("\r\n"), "utf8");

  const segments = buildTimedNarrationSegments();
  const segmentFiles = [];

  segments.forEach((segment, index) => {
    const textPath = path.join(narrationSegmentDir, `${segment.id}.txt`);
    const audioPath = path.join(narrationSegmentDir, `${segment.id}.wav`);
    fs.writeFileSync(textPath, segment.text, "utf8");

    let result = null;
    let validWav = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }

      result = spawnSync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        narrationScriptFile,
        textPath,
        audioPath
      ], {
        encoding: "utf8",
        windowsHide: true
      });

      if (result.status === 0 && fs.existsSync(audioPath)) {
        const probe = fs.readFileSync(audioPath);
        validWav = probe.length > 44
          && probe.toString("ascii", 0, 4) === "RIFF"
          && probe.toString("ascii", 8, 12) === "WAVE";
      }

      if (validWav) break;
    }

    if (!validWav) {
      throw new Error(`Unable to generate narration chapter ${index + 1}: ${result?.stderr || result?.stdout || "invalid WAV output"}`);
    }

    segmentFiles.push(audioPath);
  });

  writeAlignedNarration(segments, segmentFiles);

  return fs.readFileSync(narrationAudioFile).toString("base64");
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const narrationAudioBase64 = ensureNarrationAudio();
  const puppeteer = resolvePuppeteerCore();
  const executablePath = fs.existsSync(chromePath) ? chromePath : edgePath;
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    protocolTimeout: 3600000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--allow-file-access-from-files"
    ]
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3600000);
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    fs.rmSync(tempOutputFile, { force: true });
    await page.exposeFunction("careNovaWriteVideoChunk", (chunkBase64) => {
      fs.appendFileSync(tempOutputFile, Buffer.from(chunkBase64, "base64"));
      return true;
    });
    await page.setContent(buildRecorderHtml(narrationAudioBase64), { waitUntil: "load" });
    const audit = await page.evaluate(() => window.auditCareNovaTutorial());

    if (audit.issues.length) {
      throw new Error(`Tutorial layout audit failed: ${JSON.stringify(audit.issues, null, 2)}`);
    }

    const result = await page.evaluate(() => window.renderCareNovaTutorial());
    if (result?.streamed === true) {
      fs.renameSync(tempOutputFile, outputFile);
    } else {
      fs.writeFileSync(outputFile, Buffer.from(result, "base64"));
    }
    console.log(JSON.stringify({
      ok: true,
      outputFile,
      bytes: fs.statSync(outputFile).size,
      scenes: scenes.length,
      durationSeconds: scenes.length * sceneDuration,
      audit
    }, null, 2));
  } finally {
    await browser.close();
  }
}

function buildRecorderHtml(narrationAudioBase64) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; width: ${baseWidth}px; height: ${baseHeight}px; overflow: hidden; background: #f4fbfc; }
    canvas { display: block; width: ${baseWidth}px; height: ${baseHeight}px; }
  </style>
</head>
<body>
  <canvas id="stage" width="${renderWidth}" height="${renderHeight}"></canvas>
  <script>
    const scenes = ${JSON.stringify(scenes)};
    const narrationLines = ${JSON.stringify(narrationLines)};
    const examplePrompts = ${JSON.stringify(examplePrompts)};
    const resultPreviews = ${JSON.stringify(resultPreviews)};
    const masteryTips = ${JSON.stringify(masteryTips)};
    const qualityChecks = ${JSON.stringify(qualityChecks)};
    const nextActions = ${JSON.stringify(nextActions)};
    const narrationAudioBase64 = ${JSON.stringify(narrationAudioBase64)};
    const fps = ${fps};
    const sceneDuration = ${sceneDuration};
    const renderScale = ${renderScale};
    const canvas = document.getElementById("stage");
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const W = ${baseWidth};
    const H = ${baseHeight};
    const colors = {
      bg: "#f5fbfc",
      bg2: "#eaf7f6",
      surface: "#ffffff",
      surfaceSoft: "#f8fdff",
      ink: "#102033",
      muted: "#53667d",
      navy: "#0b1b31",
      teal: "#078985",
      aqua: "#42c2bd",
      blue: "#1f6ecb",
      mint: "#e7fbf6",
      cream: "#fff4d6",
      gold: "#d79a2b",
      safety: "#d21f3c",
      line: "#cfe4e9",
      shadow: "rgba(12,35,55,0.16)"
    };
    const layout = {
      mainY: 124,
      panelH: 432,
      leftX: 48,
      leftW: 706,
      rightX: 790,
      rightW: 440,
      bottomY: 558,
      bottomH: 108,
      gutter: 36
    };

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function easeOutCubic(t) {
      return 1 - Math.pow(1 - clamp(t, 0, 1), 3);
    }

    function easeInOut(t) {
      t = clamp(t, 0, 1);
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function roundRect(ctx, x, y, w, h, r) {
      const radius = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      ctx.arcTo(x + w, y + h, x, y + h, radius);
      ctx.arcTo(x, y + h, x, y, radius);
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    }

    function fillRoundRect(ctx, x, y, w, h, r, fillStyle) {
      roundRect(ctx, x, y, w, h, r);
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }

    function strokeRoundRect(ctx, x, y, w, h, r, strokeStyle, lineWidth) {
      roundRect(ctx, x, y, w, h, r);
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    function drawElevatedPanel(x, y, w, h, r, fillStyle, strokeStyle) {
      ctx.save();
      ctx.shadowColor = colors.shadow;
      ctx.shadowBlur = 24;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 14;
      fillRoundRect(ctx, x, y, w, h, r, fillStyle);
      ctx.restore();

      const sheen = ctx.createLinearGradient(x, y, x, y + h);
      sheen.addColorStop(0, "rgba(255,255,255,0.38)");
      sheen.addColorStop(0.34, "rgba(255,255,255,0.12)");
      sheen.addColorStop(1, "rgba(255,255,255,0)");
      fillRoundRect(ctx, x, y, w, h, r, sheen);
      strokeRoundRect(ctx, x, y, w, h, r, strokeStyle, 1.6);
    }

    function drawWrappedText(text, x, y, maxWidth, options = {}) {
      const minSize = options.minSize || 18;
      let size = options.size || 26;
      const weight = options.weight || "700";
      const family = options.family || "Arial";
      const lineHeightRatio = options.lineHeight || 1.28;
      const maxHeight = options.maxHeight || 999;
      const color = options.color || colors.ink;
      const maxLines = options.maxLines || 99;
      let lines = [];
      let lineHeight = size * lineHeightRatio;

      function wrapAt(fontSize) {
        ctx.font = weight + " " + fontSize + "px " + family;
        const words = String(text || "").split(/\\s+/).filter(Boolean);
        const result = [];
        let line = "";

        for (const word of words) {
          const test = line ? line + " " + word : word;
          if (ctx.measureText(test).width <= maxWidth || !line) {
            line = test;
          } else {
            result.push(line);
            line = word;
          }
        }

        if (line) result.push(line);
        return result;
      }

      while (size >= minSize) {
        lines = wrapAt(size);
        lineHeight = size * lineHeightRatio;
        if (lines.length <= maxLines && lines.length * lineHeight <= maxHeight) break;
        size -= 1;
      }

      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        const last = lines[lines.length - 1] || "";
        lines[lines.length - 1] = last.length > 3 ? last.replace(/[,. ]*$/, "") + "..." : last;
      }

      ctx.fillStyle = color;
      ctx.font = weight + " " + size + "px " + family;
      ctx.textBaseline = "top";

      lines.forEach((line, index) => {
        ctx.fillText(line, x, y + index * lineHeight);
      });

      return { lines, size, lineHeight, height: lines.length * lineHeight, yEnd: y + lines.length * lineHeight };
    }

    function measureWrappedText(text, maxWidth, options = {}) {
      const probe = document.createElement("canvas").getContext("2d");
      const original = ctx;
      return drawWrappedText(text, -5000, -5000, maxWidth, options);
    }

    function drawLogo(x, y, size) {
      ctx.save();
      fillRoundRect(ctx, x, y, size, size, size * 0.22, colors.surface);
      strokeRoundRect(ctx, x, y, size, size, size * 0.22, "rgba(31,110,203,0.24)", 2);
      ctx.strokeStyle = colors.blue;
      ctx.lineWidth = Math.max(3, size * 0.055);
      ctx.beginPath();
      ctx.arc(x + size * 0.5, y + size * 0.5, size * 0.31, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = colors.teal;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x + size * 0.5, y + size * 0.26);
      ctx.lineTo(x + size * 0.5, y + size * 0.74);
      ctx.moveTo(x + size * 0.26, y + size * 0.5);
      ctx.lineTo(x + size * 0.74, y + size * 0.5);
      ctx.stroke();
      ctx.strokeStyle = colors.safety;
      ctx.lineWidth = Math.max(3, size * 0.045);
      ctx.beginPath();
      ctx.moveTo(x + size * 0.2, y + size * 0.37);
      ctx.lineTo(x + size * 0.35, y + size * 0.37);
      ctx.lineTo(x + size * 0.43, y + size * 0.25);
      ctx.lineTo(x + size * 0.56, y + size * 0.67);
      ctx.lineTo(x + size * 0.66, y + size * 0.45);
      ctx.lineTo(x + size * 0.82, y + size * 0.45);
      ctx.stroke();
      ctx.restore();
    }

    function drawStartupWorkflowStrip(x, y, w, h, phase) {
      const steps = [
        ["01", "Profile"],
        ["02", "Ask clearly"],
        ["03", "Review safety"],
        ["04", "Save locally"]
      ];
      const gap = 12;
      const stepW = (w - gap * (steps.length - 1)) / steps.length;

      fillRoundRect(ctx, x, y, w, h, 26, "rgba(255,255,255,0.10)");
      strokeRoundRect(ctx, x, y, w, h, 26, "rgba(255,255,255,0.28)", 1.4);

      steps.forEach((step, index) => {
        const reveal = clamp((phase - 0.22 - index * 0.16) / 0.42, 0, 1);
        const px = x + index * (stepW + gap);
        const active = reveal > 0.15;

        if (index > 0) {
          ctx.strokeStyle = "rgba(255,255,255," + (0.16 + reveal * 0.34) + ")";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px - gap + 4, y + h / 2);
          ctx.lineTo(px - 4, y + h / 2);
          ctx.stroke();
        }

        fillRoundRect(ctx, px, y + 10, stepW, h - 20, 18, active ? "rgba(231,251,246,0.94)" : "rgba(255,255,255,0.10)");
        strokeRoundRect(ctx, px, y + 10, stepW, h - 20, 18, active ? "rgba(255,255,255,0.48)" : "rgba(255,255,255,0.16)", 1.2);
        fillRoundRect(ctx, px + 12, y + 21, 34, 34, 999, active ? colors.teal : "rgba(255,255,255,0.16)");
        ctx.fillStyle = active ? "#ffffff" : "rgba(255,255,255,0.70)";
        ctx.font = "900 12px Consolas";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText(step[0], px + 29, y + 38);
        ctx.textAlign = "left";
        ctx.fillStyle = active ? colors.navy : "rgba(255,255,255,0.70)";
        drawWrappedText(step[1], px + 54, y + 29, stepW - 64, {
          size: 14,
          minSize: 11,
          maxHeight: 20,
          maxLines: 1,
          weight: "900",
          family: "Arial",
          color: active ? colors.navy : "rgba(255,255,255,0.70)",
          lineHeight: 1
        });
      });
    }

    function drawStepSignal(x, y, value, label, active) {
      fillRoundRect(ctx, x, y, 116, 40, 14, active ? "rgba(231,251,246,0.92)" : "rgba(255,255,255,0.72)");
      strokeRoundRect(ctx, x, y, 116, 40, 14, active ? "rgba(7,137,133,0.38)" : "rgba(83,102,125,0.18)", 1.2);
      ctx.fillStyle = active ? colors.teal : colors.muted;
      ctx.font = "900 10px Consolas";
      ctx.textBaseline = "top";
      ctx.fillText(value, x + 12, y + 7);
      drawWrappedText(label, x + 12, y + 21, 92, {
        size: 11,
        minSize: 9,
        maxHeight: 13,
        maxLines: 1,
        weight: "900",
        family: "Arial",
        color: colors.ink,
        lineHeight: 1
      });
    }

    function drawPulseHighlight(x, y, w, h, phase, color) {
      const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
      ctx.save();
      ctx.globalAlpha = 0.12 + pulse * 0.08;
      fillRoundRect(ctx, x - 5, y - 5, w + 10, h + 10, 20, color);
      ctx.globalAlpha = 0.44 + pulse * 0.22;
      strokeRoundRect(ctx, x - 7, y - 7, w + 14, h + 14, 22, color, 3);
      ctx.globalAlpha = 0.18;
      strokeRoundRect(ctx, x - 14 - pulse * 6, y - 14 - pulse * 6, w + 28 + pulse * 12, h + 28 + pulse * 12, 28, color, 2);
      ctx.restore();
    }

    function drawGuidedCursor(x, y, phase, label) {
      const bob = Math.sin(phase * Math.PI * 2) * 3;
      const cx = x;
      const cy = y + bob;

      ctx.save();
      ctx.shadowColor = "rgba(11,27,49,0.26)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = "rgba(255,255,255,0.98)";
      ctx.strokeStyle = colors.navy;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 2, cy + 42);
      ctx.lineTo(cx + 13, cy + 31);
      ctx.lineTo(cx + 24, cy + 56);
      ctx.lineTo(cx + 38, cy + 49);
      ctx.lineTo(cx + 27, cy + 26);
      ctx.lineTo(cx + 43, cy + 26);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.font = "900 15px Arial";
      const labelW = Math.max(118, Math.min(170, ctx.measureText(label).width + 56));
      const labelX = Math.min(W - labelW - 34, cx + 42);
      const labelY = Math.max(108, Math.min(H - 94, cy + 18));
      const grd = ctx.createLinearGradient(labelX, labelY, labelX + labelW, labelY);
      grd.addColorStop(0, colors.teal);
      grd.addColorStop(1, colors.blue);
      fillRoundRect(ctx, labelX, labelY, labelW, 44, 999, grd);
      strokeRoundRect(ctx, labelX, labelY, labelW, 44, 999, "rgba(255,255,255,0.55)", 1.4);
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(label, labelX + labelW / 2, labelY + 22);
      ctx.textAlign = "left";
      ctx.restore();
    }

    function drawGuidedActionLayer(localTime, targets) {
      if (localTime < 3.1) return;
      const phase = clamp((localTime - 3.1) / Math.max(1, sceneDuration - 4.35), 0, 1);
      const activeIndex = phase < 0.34 ? 0 : phase < 0.67 ? 1 : 2;
      const target = targets[activeIndex];
      const previous = targets[Math.max(0, activeIndex - 1)];
      const stepStart = activeIndex === 0 ? 0 : activeIndex === 1 ? 0.34 : 0.67;
      const stepEnd = activeIndex === 0 ? 0.34 : activeIndex === 1 ? 0.67 : 1;
      const stepProgress = easeInOut(clamp((phase - stepStart) / Math.max(0.01, stepEnd - stepStart), 0, 1));
      const cursorX = previous.cursorX + (target.cursorX - previous.cursorX) * stepProgress;
      const cursorY = previous.cursorY + (target.cursorY - previous.cursorY) * stepProgress;

      drawPulseHighlight(target.x, target.y, target.w, target.h, localTime * 0.72, target.color);
      drawGuidedCursor(cursorX, cursorY, localTime * 0.64, target.label);

      ctx.save();
      fillRoundRect(ctx, 420, 154, 304, 34, 999, "rgba(255,255,255,0.88)");
      strokeRoundRect(ctx, 420, 154, 304, 34, 999, "rgba(8,125,143,0.16)", 1.2);
      const labels = ["Type", "Route", "Save"];
      labels.forEach((item, index) => {
        const x = 434 + index * 96;
        const active = index <= activeIndex;
        fillRoundRect(ctx, x, 162, 18, 18, 999, active ? colors.teal : "rgba(83,102,125,0.18)");
        ctx.fillStyle = active ? colors.teal : colors.muted;
        ctx.font = "900 11px Arial";
        ctx.textBaseline = "middle";
        ctx.fillText(item, x + 26, 171);
      });
      ctx.restore();
    }

    function drawBackground(sceneIndex, progress) {
      const tintPalette = [
        ["rgba(7,137,133,0.18)", "rgba(31,110,203,0.10)"],
        ["rgba(31,110,203,0.17)", "rgba(7,137,133,0.09)"],
        ["rgba(215,154,43,0.14)", "rgba(7,137,133,0.08)"],
        ["rgba(210,31,60,0.10)", "rgba(31,110,203,0.09)"],
        ["rgba(66,194,189,0.17)", "rgba(215,154,43,0.08)"]
      ];
      const tint = tintPalette[Math.floor(sceneIndex / 5) % tintPalette.length];
      const base = ctx.createLinearGradient(0, 0, W, H);
      base.addColorStop(0, "#ffffff");
      base.addColorStop(0.42, colors.bg);
      base.addColorStop(1, colors.bg2);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, W, H);

      const topLight = ctx.createLinearGradient(0, 0, 0, 260);
      topLight.addColorStop(0, "rgba(255,255,255,0.96)");
      topLight.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = topLight;
      ctx.fillRect(0, 0, W, H);

      const keyLight = ctx.createRadialGradient(614, 312, 120, 614, 312, 720);
      keyLight.addColorStop(0, "rgba(255,255,255,0.66)");
      keyLight.addColorStop(0.46, "rgba(255,255,255,0.22)");
      keyLight.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = keyLight;
      ctx.fillRect(0, 0, W, H);

      const focusX = 256 + (sceneIndex % 5) * 30;
      const focusY = 198 + Math.sin(progress * Math.PI + sceneIndex * 0.35) * 12;
      const focus = ctx.createRadialGradient(focusX, focusY, 42, focusX, focusY, 560);
      focus.addColorStop(0, "rgba(255,255,255,0.72)");
      focus.addColorStop(0.42, "rgba(255,255,255,0.20)");
      focus.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = focus;
      ctx.fillRect(0, 0, W, H);

      const gradientA = ctx.createRadialGradient(1115, 112, 36, 1115, 112, 470);
      gradientA.addColorStop(0, "rgba(31,110,203,0.22)");
      gradientA.addColorStop(0.42, "rgba(66,194,189,0.10)");
      gradientA.addColorStop(1, "rgba(31,110,203,0)");
      ctx.fillStyle = gradientA;
      ctx.fillRect(0, 0, W, H);

      const gradientB = ctx.createRadialGradient(118, 676, 44, 118, 676, 430);
      gradientB.addColorStop(0, "rgba(7,137,133,0.20)");
      gradientB.addColorStop(0.5, "rgba(255,244,214,0.16)");
      gradientB.addColorStop(1, "rgba(7,137,133,0)");
      ctx.fillStyle = gradientB;
      ctx.fillRect(0, 0, W, H);

      const sectionGlow = ctx.createRadialGradient(742, 310, 46, 742, 310, 620);
      sectionGlow.addColorStop(0, tint[0]);
      sectionGlow.addColorStop(0.42, tint[1]);
      sectionGlow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sectionGlow;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.globalAlpha = 0.36;
      fillRoundRect(ctx, -86, 112, 882, 500, 46, "rgba(255,255,255,0.28)");
      strokeRoundRect(ctx, -86, 112, 882, 500, 46, "rgba(255,255,255,0.40)", 1);
      fillRoundRect(ctx, 818, 108, 512, 510, 46, "rgba(255,255,255,0.20)");
      strokeRoundRect(ctx, 818, 108, 512, 510, 46, "rgba(255,255,255,0.34)", 1);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.10;
      const scanY = 126 + (sceneIndex % 6) * 19 + Math.sin(progress * Math.PI) * 10;
      ctx.strokeStyle = sceneIndex % 2 === 0 ? "rgba(7,137,133,0.34)" : "rgba(31,110,203,0.30)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(48, scanY);
      ctx.lineTo(1232, scanY + 18);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.strokeStyle = "#9fc8d2";
      ctx.lineWidth = 1;
      for (let x = 68; x < W; x += 86) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 64; y < H; y += 72) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.055;
      ctx.fillStyle = "rgba(16,32,51,0.10)";
      ctx.font = "900 130px Georgia";
      ctx.fillText("CARE NOVA", 535, 665);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.055;
      for (let i = 0; i < 84; i += 1) {
        const dotX = (i * 73 + sceneIndex * 41) % W;
        const dotY = (i * 47 + 29) % H;
        ctx.fillStyle = i % 4 === 0 ? colors.blue : i % 3 === 0 ? colors.teal : colors.navy;
        ctx.beginPath();
        ctx.arc(dotX, dotY, i % 5 === 0 ? 1.3 : 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = "rgba(7,137,133,0.24)";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 12; i += 1) {
        const sx = 858 + i * 28;
        ctx.beginPath();
        ctx.moveTo(sx, 604 + Math.sin(progress * 2 + i) * 5);
        ctx.lineTo(sx + 18, 604 + Math.cos(progress * 2 + i) * 5);
        ctx.stroke();
      }
      ctx.restore();

      drawCornerDetail(30, 30, 1, 1);
      drawCornerDetail(W - 30, 30, -1, 1);
      drawCornerDetail(30, H - 30, 1, -1);
      drawCornerDetail(W - 30, H - 30, -1, -1);
    }

    function drawHeader(scene, sceneIndex) {
      drawLogo(50, 38, 58);
      ctx.fillStyle = colors.navy;
      ctx.font = "900 26px Georgia";
      ctx.textBaseline = "middle";
      ctx.fillText("Care Nova AI", 122, 58);
      ctx.fillStyle = colors.blue;
      ctx.fillText("Guide", 122, 86);

      const group = getChapterGroup(sceneIndex);
      fillRoundRect(ctx, 420, 42, 288, 40, 999, "rgba(255,255,255,0.76)");
      strokeRoundRect(ctx, 420, 42, 288, 40, 999, "rgba(7,137,133,0.18)", 1.4);
      ctx.fillStyle = colors.teal;
      ctx.font = "900 13px Consolas";
      ctx.textBaseline = "middle";
      ctx.fillText(group.kicker, 442, 62);
      ctx.fillStyle = colors.ink;
      ctx.font = "900 15px Arial";
      ctx.fillText(group.title, 536, 62);

      fillRoundRect(ctx, 730, 42, 246, 40, 999, "rgba(231,251,246,0.86)");
      strokeRoundRect(ctx, 730, 42, 246, 40, 999, "rgba(7,137,133,0.26)", 1.4);
      ctx.fillStyle = colors.teal;
      ctx.font = "900 12px Consolas";
      ctx.textBaseline = "middle";
      ctx.fillText("CLEAN VOICE MIX", 752, 62);
      ctx.strokeStyle = colors.blue;
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(898, 62);
      ctx.lineTo(898, 56);
      ctx.lineTo(906, 68);
      ctx.lineTo(916, 52);
      ctx.lineTo(926, 72);
      ctx.stroke();

      fillRoundRect(ctx, 1020, 36, 208, 54, 18, "rgba(255,255,255,0.86)");
      strokeRoundRect(ctx, 1020, 36, 208, 54, 18, "rgba(8,125,143,0.18)", 1.5);
      ctx.fillStyle = colors.teal;
      ctx.font = "900 14px Consolas";
      ctx.textBaseline = "top";
      ctx.fillText("CHAPTER " + scene.chapter + " / " + String(scenes.length).padStart(2, "0"), 1044, 48);
      ctx.fillStyle = colors.muted;
      drawWrappedText(scene.section.toUpperCase(), 1044, 68, 156, {
        size: 13,
        minSize: 10,
        maxHeight: 16,
        maxLines: 1,
        weight: "800",
        family: "Arial",
        color: colors.muted,
        lineHeight: 1
      });
    }

    function drawCornerDetail(x, y, flipX, flipY) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(flipX, flipY);
      ctx.strokeStyle = "rgba(7,137,133,0.32)";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, 28);
      ctx.lineTo(0, 0);
      ctx.lineTo(28, 0);
      ctx.stroke();
      ctx.strokeStyle = "rgba(31,110,203,0.22)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(10, 40);
      ctx.lineTo(10, 10);
      ctx.lineTo(40, 10);
      ctx.stroke();
      ctx.restore();
    }

    function drawFrameDetailRail(scene, sceneIndex, phase) {
      const group = getChapterGroup(sceneIndex);
      const y = 112;
      const pulse = 0.5 + 0.5 * Math.sin(phase * 1.6);
      ctx.save();
      fillRoundRect(ctx, 50, y, 1180, 12, 999, "rgba(255,255,255,0.62)");
      strokeRoundRect(ctx, 50, y, 1180, 12, 999, "rgba(8,125,143,0.16)", 1);
      const rail = ctx.createLinearGradient(68, y + 6, 1214, y + 6);
      rail.addColorStop(0, "rgba(7,137,133,0.64)");
      rail.addColorStop(0.48, "rgba(31,110,203,0.48)");
      rail.addColorStop(1, "rgba(215,154,43,0.52)");
      fillRoundRect(ctx, 68, y + 4, 1144, 4, 999, "rgba(83,102,125,0.10)");
      fillRoundRect(ctx, 68, y + 4, 1144 * ((sceneIndex + clamp(phase / sceneDuration, 0, 1)) / scenes.length), 4, 999, rail);

      const chips = [
        ["LOCAL AI", colors.teal],
        ["ONE AGENT", colors.blue],
        ["SAFETY", colors.teal],
        ["GUIDE V24", colors.gold]
      ];
      chips.forEach((chip, index) => {
        const chipX = 748 + index * 116;
        fillRoundRect(ctx, chipX, y - 18, 104, 20, 999, index === 3 ? "rgba(255,247,225,0.90)" : "rgba(231,251,246,0.88)");
        strokeRoundRect(ctx, chipX, y - 18, 104, 20, 999, index === 3 ? "rgba(215,154,43,0.35)" : "rgba(7,137,133,0.24)", 1);
        ctx.fillStyle = chip[1];
        ctx.font = "900 10px Consolas";
        ctx.textBaseline = "middle";
        ctx.fillText(chip[0], chipX + 12, y - 8);
      });

      for (let tick = 0; tick < 22; tick += 1) {
        const tx = 72 + tick * 52;
        ctx.fillStyle = tick <= sceneIndex ? (tick === sceneIndex ? colors.gold : colors.teal) : "rgba(83,102,125,0.24)";
        ctx.beginPath();
        ctx.arc(tx, y + 6, tick === sceneIndex ? 3.2 + pulse : 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    function drawSignalBars(x, y, phase) {
      ctx.save();
      const labels = ["context", "route", "guard"];
      labels.forEach((label, index) => {
        const value = 0.58 + 0.24 * Math.sin(phase * 1.1 + index);
        const px = x + index * 86;
        fillRoundRect(ctx, px, y, 72, 24, 999, "rgba(231,251,246,0.72)");
        strokeRoundRect(ctx, px, y, 72, 24, 999, "rgba(7,137,133,0.18)", 1);
        fillRoundRect(ctx, px + 8, y + 15, 56, 3, 999, "rgba(83,102,125,0.16)");
        fillRoundRect(ctx, px + 8, y + 15, 56 * value, 3, 999, index === 1 ? colors.blue : colors.teal);
        ctx.fillStyle = index === 1 ? colors.blue : colors.teal;
        ctx.font = "900 8px Consolas";
        ctx.textBaseline = "top";
        ctx.fillText(label.toUpperCase(), px + 8, y + 5);
      });
      ctx.restore();
    }

    function getChapterGroup(index) {
      if (index <= 4) return { kicker: "START", title: "Quick setup", range: "01-05", detail: "Private setup, profile memory, input quality, and the agent loop." };
      if (index <= 7) return { kicker: "CORE", title: "Agent routing", range: "06-08", detail: "General questions, specialist review, and the Atlas learning library." };
      if (index <= 12) return { kicker: "CLINICAL", title: "Review tools", range: "09-13", detail: "Vitals, medicine, labs, wellness, and visit preparation." };
      if (index <= 17) return { kicker: "WORKFLOW", title: "Care operations", range: "14-18", detail: "Safety, insurance, records, summary, modes, and language." };
      return { kicker: "MASTERY", title: "Accuracy loop", range: "19-22", detail: "Online/offline use, feedback, daily workflow, and safe boundaries." };
    }

    function isGroupStart(index) {
      return index === 0 || index === 5 || index === 8 || index === 13 || index === 18;
    }

    function drawChecklistIcon(x, y, color) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x, y + 7);
      ctx.lineTo(x + 7, y + 14);
      ctx.lineTo(x + 20, y);
      ctx.stroke();
      ctx.restore();
    }

    function drawBulletCard(x, y, w, h, index, title, text) {
      fillRoundRect(ctx, x, y, w, h, 16, colors.surface);
      strokeRoundRect(ctx, x, y, w, h, 16, "rgba(8,125,143,0.16)", 1.5);
      fillRoundRect(ctx, x + 16, y + 16, 38, 38, 12, index === 0 ? colors.teal : index === 1 ? colors.blue : colors.navy);
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 19px Consolas";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(String(index + 1), x + 35, y + 35);
      ctx.textAlign = "left";
      drawWrappedText(title, x + 68, y + 15, w - 86, {
        size: 21,
        minSize: 18,
        maxHeight: 28,
        maxLines: 1,
        weight: "900",
        family: "Arial",
        color: colors.ink,
        lineHeight: 1.16
      });
      drawWrappedText(text, x + 68, y + 47, w - 86, {
        size: 17,
        minSize: 14,
        maxHeight: h - 56,
        maxLines: 3,
        weight: "700",
        family: "Arial",
        color: colors.muted,
        lineHeight: 1.28
      });
    }

    function drawMiniFlow(x, y, w, step) {
      const labels = ["Input", "Memory", "Route", "Agent", "Safety", "Save"];
      const gap = 12;
      const itemW = (w - gap * (labels.length - 1)) / labels.length;
      ctx.save();
      ctx.strokeStyle = "rgba(7,137,133,0.22)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 7]);
      ctx.beginPath();
      ctx.moveTo(x + 16, y + 23);
      ctx.lineTo(x + w - 16, y + 23);
      ctx.stroke();
      ctx.setLineDash([]);
      labels.forEach((label, index) => {
        const px = x + index * (itemW + gap);
        fillRoundRect(ctx, px, y, itemW, 46, 14, index <= step ? colors.mint : "rgba(255,255,255,0.78)");
        strokeRoundRect(ctx, px, y, itemW, 46, 14, index <= step ? "rgba(7,137,133,0.42)" : "rgba(83,102,125,0.18)", 1.5);
        ctx.fillStyle = index <= step ? colors.teal : colors.muted;
        ctx.font = "900 13px Arial";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText(label, px + itemW / 2, y + 23);
      });
      ctx.textAlign = "left";
      ctx.restore();
    }

    function getSceneVisual(scene, index) {
      if (index === 0) {
        return {
          label: "Care workspace",
          sub: "One local-first place for health questions",
          route: ["Open", "Choose tab", "Save"],
          stats: ["Guide", "Local", "Safe"]
        };
      }

      const text = (scene.section + " " + scene.title + " " + scene.useWhen).toLowerCase();
      const defaults = {
        label: "Agent run",
        sub: "Focused local workflow",
        route: ["Input", "Memory", "Answer"],
        stats: ["Safe", "Local", "Clear"]
      };
      const matches = [
        [["profile", "privacy"], "Patient setup", "Identity, context, and local storage", ["Profile", "Memory", "Vault"], ["Private", "Reusable", "Secure"]],
        [["general", "best input"], "First-layer doctor", "Plain question to safe next step", ["Question", "Triage", "Reply"], ["Simple", "Fast", "Clear"]],
        [["specialist"], "Specialist reasoning", "Condition-focused review path", ["Disease", "Evidence", "Questions"], ["Depth", "Context", "Handoff"]],
        [["atlas"], "Knowledge library", "Ready guides for learning", ["Search", "Guide", "Precaution"], ["Disease", "Medicine", "Prevention"]],
        [["vitals"], "Vitals specialist", "Readings, patterns, and daily context", ["Reading", "Trend", "Maintain"], ["BP", "Sugar", "BMI"]],
        [["medicine"], "Pharmacy safety", "Medicine questions without unsafe dosing", ["Name", "Signals", "Pharmacist"], ["Use", "Side effect", "Interaction"]],
        [["labs"], "Report interpreter", "Lab values to clinician-ready questions", ["Upload", "Marker", "Summary"], ["Range", "Trend", "Download"]],
        [["wellness"], "Habit coach", "Age-aware healthy-life planning", ["Goal", "Routine", "Feedback"], ["Sleep", "Food", "Activity"]],
        [["visits"], "Visit planner", "Booking and follow-up preparation", ["Need", "Slot", "Note"], ["Clinic", "Question", "Follow-up"]],
        [["safety"], "Safety boundary", "Urgent signs and first safe action", ["Signal", "Reason", "Action"], ["Red flag", "Guarded", "Escalate"]],
        [["insurance"], "Claim navigator", "Documents, coverage, and appeal prep", ["Claim", "Docs", "Appeal"], ["Benefit", "Evidence", "Deadline"]],
        [["records"], "Local record vault", "Organized patient timeline", ["Save", "Search", "Export"], ["Patient", "Type", "Report"]],
        [["summary"], "Care snapshot", "What happened and what is missing", ["Timeline", "Risk", "Doctor note"], ["Focus", "Gaps", "Share"]],
        [["language", "modes"], "Adaptive interface", "Guided, Expert, and language views", ["Guided", "Expert", "Translate"], ["Beginner", "Detailed", "Global"]],
        [["online", "offline"], "Hybrid access", "Offline continuity plus online enrichment", ["Offline", "Online", "Cache"], ["Local", "Fresh", "Available"]],
        [["accuracy"], "Feedback loop", "Save, review, and improve routing", ["Answer", "Feedback", "Improve"], ["Precise", "Memory", "Better"]]
      ];

      for (const item of matches) {
        const keys = item[0];
        if (keys.some((key) => text.includes(key))) {
          return { label: item[1], sub: item[2], route: item[3], stats: item[4] };
        }
      }

      if (index === scenes.length - 1) {
        return { label: "Safe boundary", sub: "Know what the app will not do", route: ["Learn", "Organize", "Seek care"], stats: ["No diagnosis", "No dose", "No emergency"] };
      }

      return defaults;
    }

    function drawInsightDeck(x, y, w, h, scene, index, phase) {
      const visual = getSceneVisual(scene, index);
      const compact = h < 112;
      const pulse = 0.5 + 0.5 * Math.sin(phase * 2.2);
      fillRoundRect(ctx, x, y, w, h, 18, "rgba(231,251,246,0.72)");
      strokeRoundRect(ctx, x, y, w, h, 18, "rgba(7,137,133,0.22)", 1.5);

      fillRoundRect(ctx, x + 16, y + 16, 46, 46, 14, colors.surface);
      strokeRoundRect(ctx, x + 16, y + 16, 46, 46, 14, "rgba(7,137,133,0.24)", 1.5);
      ctx.strokeStyle = colors.teal;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(x + 39, y + 39, 12 + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 31, y + 39);
      ctx.lineTo(x + 47, y + 39);
      ctx.moveTo(x + 39, y + 31);
      ctx.lineTo(x + 39, y + 47);
      ctx.stroke();

      drawWrappedText(visual.label, x + 76, y + 14, w - 96, {
        size: compact ? 18 : 20,
        minSize: compact ? 15 : 17,
        maxHeight: 26,
        maxLines: 1,
        weight: "900",
        family: "Arial",
        color: colors.ink,
        lineHeight: 1.1
      });
      drawWrappedText(visual.sub, x + 76, y + 42, w - 96, {
        size: compact ? 13 : 15,
        minSize: 11,
        maxHeight: compact ? 18 : 34,
        maxLines: compact ? 1 : 2,
        weight: "800",
        family: "Arial",
        color: colors.muted,
        lineHeight: 1.16
      });

      const showStats = h >= 148;
      const nodeY = y + (compact ? 60 : showStats ? 86 : 78);
      const nodeH = compact ? 26 : 30;
      const nodeW = (w - 48) / 3;
      visual.route.forEach((label, nodeIndex) => {
        const nx = x + 16 + nodeIndex * nodeW;
        const active = nodeIndex <= Math.min(2, Math.floor(phase * 0.9) % 3);
        if (nodeIndex > 0) {
          ctx.strokeStyle = active ? "rgba(31,110,203,0.42)" : "rgba(83,102,125,0.18)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(nx - 14, nodeY + nodeH / 2);
          ctx.lineTo(nx + 4, nodeY + nodeH / 2);
          ctx.stroke();
        }
        fillRoundRect(ctx, nx, nodeY, nodeW - 12, nodeH, 999, active ? colors.surface : "rgba(255,255,255,0.62)");
        strokeRoundRect(ctx, nx, nodeY, nodeW - 12, nodeH, 999, active ? "rgba(31,110,203,0.36)" : "rgba(83,102,125,0.16)", 1.2);
        ctx.fillStyle = active ? colors.blue : colors.muted;
        ctx.font = "900 " + (compact ? 10 : 12) + "px Arial";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText(label, nx + (nodeW - 12) / 2, nodeY + nodeH / 2);
        ctx.textAlign = "left";
      });

      if (showStats) {
        visual.stats.forEach((label, statIndex) => {
          const sx = x + 16 + statIndex * ((w - 48) / 3);
          fillRoundRect(ctx, sx, y + h - 34, (w - 48) / 3 - 10, 24, 999, statIndex === 0 ? "rgba(7,137,133,0.12)" : "rgba(31,110,203,0.10)");
          ctx.fillStyle = statIndex === 0 ? colors.teal : colors.blue;
          ctx.font = "900 11px Arial";
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          ctx.fillText(label, sx + ((w - 48) / 3 - 10) / 2, y + h - 22);
          ctx.textAlign = "left";
        });
      }
    }

    function drawCompactBulletCard(x, y, w, h, index, title, text) {
      fillRoundRect(ctx, x, y, w, h, 15, colors.surface);
      strokeRoundRect(ctx, x, y, w, h, 15, "rgba(8,125,143,0.16)", 1.4);
      fillRoundRect(ctx, x + 12, y + 10, 30, 30, 10, index === 0 ? colors.teal : index === 1 ? colors.blue : colors.navy);
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 15px Consolas";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(String(index + 1), x + 27, y + 25);
      ctx.textAlign = "left";
      drawWrappedText(title, x + 54, y + 9, w - 72, {
        size: 16,
        minSize: 13,
        maxHeight: 19,
        maxLines: 1,
        weight: "900",
        family: "Arial",
        color: colors.ink,
        lineHeight: 1.1
      });
      drawWrappedText(text, x + 54, y + 29, w - 72, {
        size: 11.5,
        minSize: 9.5,
        maxHeight: h - 31,
        maxLines: 2,
        weight: "800",
        family: "Arial",
        color: colors.muted,
        lineHeight: 1.2
      });
    }

    function drawNextActionRibbon(x, y, w, h, index, phase) {
      const action = nextActions[index] || "Save the useful result and review Safety if anything feels urgent.";
      const glow = 0.5 + 0.5 * Math.sin(phase * 1.4);
      const bg = ctx.createLinearGradient(x, y, x + w, y);
      bg.addColorStop(0, "rgba(231,251,246,0.96)");
      bg.addColorStop(0.7, "rgba(255,255,255,0.92)");
      bg.addColorStop(1, "rgba(237,247,255,0.94)");
      fillRoundRect(ctx, x, y, w, h, 999, bg);
      strokeRoundRect(ctx, x, y, w, h, 999, "rgba(7,137,133,0.24)", 1.2);
      fillRoundRect(ctx, x + 12, y + 7, 62, h - 14, 999, "rgba(7,137,133," + (0.14 + glow * 0.08) + ")");
      ctx.fillStyle = colors.teal;
      ctx.font = "900 10.5px Consolas";
      ctx.textBaseline = "middle";
      ctx.fillText("NEXT", x + 24, y + h / 2 - 4);
      ctx.fillText("STEP", x + 24, y + h / 2 + 7);
      drawWrappedText(action, x + 88, y + 7, w - 110, {
        size: 13.5,
        minSize: 11,
        maxHeight: h - 10,
        maxLines: 2,
        weight: "900",
        family: "Arial",
        color: colors.ink,
        lineHeight: 1.08
      });
    }

    function drawNarrationBar(x, y, w, h, scene, index, phase) {
      const line = narrationLines[index] || scene.footer || "";
      const glow = 0.28 + 0.18 * Math.sin(phase * 1.5);
      const grd = ctx.createLinearGradient(x, y, x + w, y);
      grd.addColorStop(0, "rgba(11,27,49,0.97)");
      grd.addColorStop(0.54, "rgba(7,137,133,0.93)");
      grd.addColorStop(1, "rgba(31,110,203,0.94)");
      fillRoundRect(ctx, x, y, w, h, 24, grd);
      strokeRoundRect(ctx, x, y, w, h, 24, "rgba(255,255,255,0.46)", 1.4);

      fillRoundRect(ctx, x + 16, y + 14, 128, h - 28, 20, "rgba(255,255,255," + (0.15 + glow * 0.18) + ")");
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 11px Consolas";
      ctx.textBaseline = "top";
      ctx.fillText("CLEAR", x + 42, y + 22);
      ctx.fillText("VOICE", x + 42, y + 38);
      ctx.font = "900 10px Consolas";
      ctx.fillText("CH " + scene.chapter, x + 42, y + 56);
      ctx.strokeStyle = "rgba(255,255,255,0.82)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      for (let wave = 0; wave < 4; wave += 1) {
        const wx = x + 100 + wave * 8;
        const amp = 5 + Math.sin(phase * 2 + wave) * 3;
        ctx.beginPath();
        ctx.moveTo(wx, y + h / 2 - amp);
        ctx.lineTo(wx, y + h / 2 + amp);
        ctx.stroke();
      }

      fillRoundRect(ctx, x + 158, y + 14, 128, 22, 999, "rgba(255,255,255,0.12)");
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      ctx.font = "900 10px Consolas";
      ctx.textBaseline = "middle";
      ctx.fillText("KEY TAKEAWAY", x + 176, y + 25);

      drawWrappedText(line, x + 160, y + 40, w - 188, {
        size: 16,
        minSize: 11,
        maxHeight: h - 54,
        maxLines: 3,
        weight: "900",
        family: "Arial",
        color: "#ffffff",
        lineHeight: 1.2
      });

      const subtitleProgress = clamp(phase / sceneDuration, 0, 1);
      fillRoundRect(ctx, x + 18, y + h - 11, w - 36, 4, 999, "rgba(255,255,255,0.16)");
      fillRoundRect(ctx, x + 18, y + h - 11, (w - 36) * subtitleProgress, 4, 999, "rgba(255,255,255,0.72)");
    }

    function drawActionResultPills(x, y, w, scene, index, phase) {
      const visual = getSceneVisual(scene, index);
      const labels = [
        ["Enter", visual.route[0] || "Ask"],
        ["Check", visual.route[1] || "Review"],
        ["Receive", visual.route[2] || "Reply"]
      ];
      const gap = 10;
      const pillW = (w - gap * 2) / 3;
      labels.forEach((item, itemIndex) => {
        const px = x + itemIndex * (pillW + gap);
        const active = itemIndex <= Math.min(2, Math.floor(phase * 0.85) % 3);
        fillRoundRect(ctx, px, y, pillW, 38, 14, active ? "rgba(231,251,246,0.95)" : "rgba(255,255,255,0.72)");
        strokeRoundRect(ctx, px, y, pillW, 38, 14, active ? "rgba(7,137,133,0.42)" : "rgba(83,102,125,0.18)", 1.2);
        ctx.fillStyle = active ? colors.teal : colors.muted;
        ctx.font = "900 10px Consolas";
        ctx.textBaseline = "top";
        ctx.fillText(item[0].toUpperCase(), px + 12, y + 7);
        drawWrappedText(item[1], px + 12, y + 20, pillW - 24, {
          size: 12,
          minSize: 10,
          maxHeight: 14,
          maxLines: 1,
          weight: "900",
          family: "Arial",
          color: colors.ink,
          lineHeight: 1
        });
      });
    }

    function drawUseExampleCard(x, y, w, h, scene, index, phase) {
      const example = examplePrompts[index] || scene.useWhen || "";
      const shine = 0.45 + 0.25 * Math.sin(phase * 1.7);
      const reveal = clamp((phase - 1.05) / 2.25, 0, 1);
      const visibleCount = Math.max(reveal > 0 ? 6 : 0, Math.floor(example.length * reveal));
      const cursor = reveal > 0 && reveal < 1 && Math.floor(phase * 4) % 2 === 0 ? "|" : "";
      const visibleExample = visibleCount ? example.slice(0, visibleCount) + cursor : "Type one clear question or task...";
      fillRoundRect(ctx, x, y, w, h, 18, "rgba(231,251,246,0.88)");
      strokeRoundRect(ctx, x, y, w, h, 18, "rgba(7,137,133,0.22)", 1.5);

      drawChecklistIcon(x + 22, y + 17, colors.teal);
      drawWrappedText(scene.useWhen, x + 56, y + 13, w - 78, {
        size: 16,
        minSize: 13,
        maxHeight: 21,
        maxLines: 1,
        weight: "900",
        family: "Arial",
        color: colors.ink,
        lineHeight: 1.1
      });

      fillRoundRect(ctx, x + 18, y + 43, 66, 26, 999, "rgba(255,255,255," + (0.72 + shine * 0.2) + ")");
      ctx.fillStyle = colors.teal;
      ctx.font = "900 11px Consolas";
      ctx.textBaseline = "middle";
      ctx.fillText("TRY", x + 40, y + 56);

      drawWrappedText(visibleExample, x + 96, y + 41, w - 118, {
        size: 14,
        minSize: 11,
        maxHeight: 34,
        maxLines: 2,
        weight: "800",
        family: "Arial",
        color: colors.muted,
        lineHeight: 1.2
      });
    }

    function drawOutputPreviewCard(x, y, w, h, index, phase) {
      const text = resultPreviews[index] || "Focused, safe reply saved to local memory.";
      const tip = masteryTips[index] || "Use one focused input, review safety, then save the result.";
      const quality = qualityChecks[index] || "Quality check: answer is clear, safe, and record-ready.";
      const sweep = clamp((phase % 2.6) / 2.6, 0, 1);
      const reveal = clamp((phase - 3.05) / 1.2, 0, 1);
      const qualityText = quality.replace(/^Quality check:\s*/i, "");
      const tipText = tip.replace(/^Mastery:\s*/i, "");
      const masteryMode = phase > 6.3;
      const primaryLabel = masteryMode ? "MASTER" : "RESULT";
      const primaryText = masteryMode ? tipText : text;
      fillRoundRect(ctx, x, y, w, h, 16, "rgba(255,255,255,0.97)");
      strokeRoundRect(ctx, x, y, w, h, 16, "rgba(31,110,203,0.24)", 1.6);

      const stripe = ctx.createLinearGradient(x, y, x, y + h);
      stripe.addColorStop(0, colors.teal);
      stripe.addColorStop(1, colors.blue);
      fillRoundRect(ctx, x, y, 8, h, 16, stripe);

      fillRoundRect(ctx, x + 18, y + 12, 84, 24, 999, masteryMode ? "rgba(7,137,133,0.12)" : "rgba(31,110,203,0.10)");
      ctx.fillStyle = masteryMode ? colors.teal : colors.blue;
      ctx.font = "900 11px Consolas";
      ctx.textBaseline = "middle";
      ctx.fillText(primaryLabel, x + (masteryMode ? 34 : 36), y + 24);

      ctx.save();
      ctx.globalAlpha = 0.25 + 0.75 * reveal;
      drawWrappedText(reveal > 0.08 ? primaryText : "Waiting for agent response...", x + 114, y + 10, w - 136, {
        size: masteryMode ? 14.5 : 15,
        minSize: 12,
        maxHeight: 35,
        maxLines: 2,
        weight: "900",
        family: "Arial",
        color: colors.ink,
        lineHeight: 1.16
      });

      fillRoundRect(ctx, x + 18, y + h - 36, w - 36, 25, 999, "rgba(231,251,246,0.94)");
      fillRoundRect(ctx, x + 28, y + h - 31, 66, 15, 999, "rgba(7,137,133,0.13)");
      ctx.fillStyle = colors.teal;
      ctx.font = "900 8.5px Consolas";
      ctx.textBaseline = "middle";
      ctx.fillText("QUALITY", x + 39, y + h - 23.5);
      drawWrappedText(qualityText || tipText, x + 106, y + h - 31, w - 150, {
        size: 11.5,
        minSize: 9.5,
        maxHeight: 15,
        maxLines: 1,
        weight: "900",
        family: "Arial",
        color: colors.ink,
        lineHeight: 1
      });
      const meterX = x + w - 52;
      for (let bar = 0; bar < 3; bar += 1) {
        const active = reveal > 0.2 && bar <= Math.floor(sweep * 3);
        fillRoundRect(ctx, meterX + bar * 10, y + h - 29 + (2 - bar) * 3, 6, 14 + bar * 3, 999, active ? colors.teal : "rgba(83,102,125,0.18)");
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.26;
      ctx.fillStyle = colors.teal;
      fillRoundRect(ctx, x + 18, y + h - 7, (w - 36) * sweep, 3, 999, colors.teal);
      ctx.restore();

      if (phase > 4.65) {
        ctx.save();
        ctx.globalAlpha = clamp((phase - 4.65) / 0.5, 0, 1);
        fillRoundRect(ctx, x + w - 38, y + 13, 24, 24, 999, colors.surface);
        strokeRoundRect(ctx, x + w - 38, y + 13, 24, 24, 999, "rgba(7,137,133,0.32)", 1.2);
        drawChecklistIcon(x + w - 31, y + 19, colors.teal);
        ctx.restore();
      }
    }

    function drawChapterRail(index, phase) {
      const x = 1248;
      const y = 132;
      const h = 420;
      const count = scenes.length;
      ctx.save();
      ctx.strokeStyle = "rgba(83,102,125,0.16)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + h);
      ctx.stroke();

      const currentY = y + (h * index) / Math.max(1, count - 1);
      const progressY = y + (h * (index + clamp(phase / sceneDuration, 0, 1))) / count;
      ctx.strokeStyle = "rgba(7,137,133,0.72)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, Math.min(y + h, progressY));
      ctx.stroke();

      for (let i = 0; i < count; i += 3) {
        const dotY = y + (h * i) / Math.max(1, count - 1);
        ctx.fillStyle = i <= index ? colors.teal : "rgba(83,102,125,0.28)";
        ctx.beginPath();
        ctx.arc(x, dotY, i === index ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = colors.surface;
      ctx.beginPath();
      ctx.arc(x, currentY, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = colors.blue;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    function drawSectionBreak(index, localTime) {
      if (!isGroupStart(index)) return;
      const delay = index === 0 ? 3.7 : 0;
      const elapsed = localTime - delay;
      if (elapsed < 0 || elapsed > 2.15) return;
      const enter = easeOutCubic(elapsed / 0.58);
      const exit = 1 - easeOutCubic(Math.max(0, elapsed - 1.4) / 0.75);
      const alpha = clamp(Math.min(enter, exit), 0, 1);
      const group = getChapterGroup(index);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(11,27,49,0.90)";
      ctx.fillRect(0, 0, W, H);

      const grd = ctx.createLinearGradient(190, 210, 1090, 510);
      grd.addColorStop(0, "rgba(7,137,133,0.92)");
      grd.addColorStop(1, "rgba(31,110,203,0.92)");
      fillRoundRect(ctx, 164, 178, 952, 308, 34, grd);
      strokeRoundRect(ctx, 164, 178, 952, 308, 34, "rgba(255,255,255,0.42)", 1.6);

      drawLogo(206, 226, 82);
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 18px Consolas";
      ctx.textBaseline = "top";
      ctx.fillText("CHAPTERS " + group.range, 314, 224);
      ctx.font = "900 56px Georgia";
      ctx.fillText(group.kicker + "  " + group.title, 312, 262);
      drawWrappedText(group.detail, 314, 338, 700, {
        size: 23,
        minSize: 18,
        maxHeight: 70,
        maxLines: 2,
        weight: "800",
        family: "Arial",
        color: "rgba(255,255,255,0.90)",
        lineHeight: 1.25
      });

      const starts = [0, 5, 8, 13, 18];
      starts.forEach((start, dotIndex) => {
        const dx = 314 + dotIndex * 78;
        const active = start <= index;
        ctx.fillStyle = active ? "#ffffff" : "rgba(255,255,255,0.30)";
        ctx.beginPath();
        ctx.arc(dx, 438, active ? 8 : 6, 0, Math.PI * 2);
        ctx.fill();
        if (dotIndex < starts.length - 1) {
          ctx.strokeStyle = active ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0.24)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(dx + 14, 438);
          ctx.lineTo(dx + 64, 438);
          ctx.stroke();
        }
      });
      ctx.restore();
    }

    function drawScene(scene, index, localTime) {
      const intro = easeOutCubic(localTime / 1.1);
      drawBackground(index, intro);
      drawHeader(scene, index);
      drawFrameDetailRail(scene, index, localTime);
      drawChapterRail(index, localTime);

      ctx.save();
      ctx.globalAlpha = intro;
      const lift = (1 - intro) * 22;
      const bottomLift = (1 - intro) * 8;
      const mainY = layout.mainY;
      const leftX = layout.leftX;
      const rightX = layout.rightX;
      const bottomY = layout.bottomY + bottomLift;

      drawElevatedPanel(leftX, mainY + lift, layout.leftW, layout.panelH, 28, "rgba(255,255,255,0.94)", "rgba(8,125,143,0.18)");
      fillRoundRect(ctx, leftX + 28, mainY + 28 + lift, 224, 38, 999, colors.mint);
      drawWrappedText(scene.section.toUpperCase(), leftX + 48, mainY + 38 + lift, 184, {
        size: 16,
        minSize: 11,
        maxHeight: 18,
        maxLines: 1,
        weight: "900",
        family: "Consolas",
        color: colors.teal,
        lineHeight: 1
      });

      drawWrappedText(scene.title, leftX + 30, mainY + 92 + lift, layout.leftW - 80, {
        size: 47,
        minSize: 34,
        maxHeight: 126,
        maxLines: 3,
        weight: "900",
        family: "Georgia",
        color: colors.ink,
        lineHeight: 1.08
      });

      drawWrappedText(scene.explain, leftX + 32, mainY + 238 + lift, layout.leftW - 82, {
        size: 22,
        minSize: 18,
        maxHeight: 82,
        maxLines: 3,
        weight: "700",
        family: "Arial",
        color: colors.muted,
        lineHeight: 1.32
      });

      drawUseExampleCard(leftX + 30, mainY + 338 + lift, layout.leftW - 86, 84, scene, index, localTime);

      const panelX = rightX;
      drawElevatedPanel(panelX, mainY + lift, layout.rightW, layout.panelH, 28, "rgba(255,255,255,0.96)", "rgba(31,110,203,0.18)");
      const sceneVisual = getSceneVisual(scene, index);
      ctx.fillStyle = colors.navy;
      ctx.font = "900 24px Georgia";
      ctx.textBaseline = "top";
      ctx.fillText("Enter -> Check -> Receive", panelX + 28, mainY + 24 + lift);
      drawWrappedText(sceneVisual.sub, panelX + 28, mainY + 54 + lift, 356, {
        size: 15,
        minSize: 12,
        maxHeight: 20,
        maxLines: 1,
        weight: "800",
        family: "Arial",
        color: colors.muted,
        lineHeight: 1
      });

      drawActionResultPills(panelX + 24, mainY + 80 + lift, 392, scene, index, localTime);
      drawInsightDeck(panelX + 24, mainY + 128 + lift, 392, 88, scene, index, localTime);

      const cards = (scene.bullets || []).slice(0, 3);
      cards.forEach((item, cardIndex) => {
        drawCompactBulletCard(panelX + 24, mainY + 220 + lift + cardIndex * 45, 392, 42, cardIndex, item[0], item[1]);
      });
      drawOutputPreviewCard(panelX + 24, mainY + 346 + lift, 392, 84, index, localTime);

      fillRoundRect(ctx, 48, bottomY - 8, 1182, layout.bottomH + 14, 28, "rgba(255,255,255,0.62)");
      strokeRoundRect(ctx, 48, bottomY - 8, 1182, layout.bottomH + 14, 28, "rgba(8,125,143,0.16)", 1.2);
      drawNextActionRibbon(82, bottomY, 560, 42, index, localTime);
      drawMiniFlow(82, bottomY + 60, 560, Math.min(5, Math.floor(index / 3) + 1));
      drawNarrationBar(666, bottomY, 564, 106, scene, index, localTime);

      drawGuidedActionLayer(localTime, [
        {
          x: leftX + 30,
          y: mainY + 338 + lift,
          w: layout.leftW - 86,
          h: 84,
          cursorX: leftX + 58,
          cursorY: mainY + 364 + lift,
          label: "Read prompt",
          color: "rgba(7,137,133,0.74)"
        },
        {
          x: panelX + 24,
          y: mainY + 80 + lift,
          w: 392,
          h: 38,
          cursorX: panelX + 156,
          cursorY: mainY + 106 + lift,
          label: "Watch route",
          color: "rgba(31,110,203,0.72)"
        },
        {
          x: panelX + 24,
          y: mainY + 346 + lift,
          w: 392,
          h: 84,
          cursorX: panelX + 322,
          cursorY: mainY + 380 + lift,
          label: "Save result",
          color: "rgba(7,137,133,0.74)"
        }
      ]);

      ctx.restore();
    }

    function drawProgress(totalTime) {
      const totalDuration = scenes.length * sceneDuration;
      const p = clamp(totalTime / totalDuration, 0, 1);
      fillRoundRect(ctx, 50, 674, 1180, 12, 999, "rgba(83,102,125,0.16)");
      const grd = ctx.createLinearGradient(50, 674, 1230, 674);
      grd.addColorStop(0, colors.teal);
      grd.addColorStop(1, colors.blue);
      fillRoundRect(ctx, 50, 674, 1180 * p, 12, 999, grd);
      ctx.fillStyle = colors.muted;
      ctx.font = "800 13px Consolas";
      ctx.textBaseline = "top";
      ctx.fillText("Care Nova AI tutorial - high-detail guide", 50, 692);
      ctx.textAlign = "right";
      ctx.fillText("V24 / 1440p / 20 Mbps / " + Math.round(totalDuration) + " sec", 1230, 692);
      ctx.textAlign = "left";
    }

    function drawTransition(progress, index) {
      const p = easeInOut(progress);
      const w = W * p;
      const nextGroup = getChapterGroup(Math.min(index + 1, scenes.length - 1));
      const grd = ctx.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, colors.teal);
      grd.addColorStop(0.55, colors.aqua);
      grd.addColorStop(1, colors.blue);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, H);

      ctx.save();
      ctx.globalAlpha = 0.18 * p;
      ctx.strokeStyle = "rgba(255,255,255,0.48)";
      ctx.lineWidth = 1.4;
      for (let line = 0; line < 9; line += 1) {
        const lx = w - 260 + line * 34;
        ctx.beginPath();
        ctx.moveTo(lx, 0);
        ctx.lineTo(lx + 116, H);
        ctx.stroke();
      }
      const lens = ctx.createRadialGradient(w - 92, H / 2, 18, w - 92, H / 2, 220);
      lens.addColorStop(0, "rgba(255,255,255,0.58)");
      lens.addColorStop(0.36, "rgba(255,255,255,0.20)");
      lens.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = lens;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      const edgeX = clamp(w - 180, 0, W);
      const edge = ctx.createLinearGradient(edgeX, 0, Math.min(W, edgeX + 260), 0);
      edge.addColorStop(0, "rgba(255,255,255,0)");
      edge.addColorStop(0.45, "rgba(255,255,255,0.42)");
      edge.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = edge;
      ctx.fillRect(edgeX, 0, 260, H);

      ctx.fillStyle = "rgba(255,255,255," + (0.08 * Math.sin(p * Math.PI)) + ")";
      ctx.fillRect(0, 0, W, H);

      if (p > 0.18) {
        ctx.save();
        ctx.globalAlpha = clamp((p - 0.18) / 0.4, 0, 1);
        fillRoundRect(ctx, 70, H / 2 - 100, 836, 184, 28, "rgba(11,27,49,0.24)");
        strokeRoundRect(ctx, 70, H / 2 - 100, 836, 184, 28, "rgba(255,255,255,0.36)", 1.2);
        fillRoundRect(ctx, 92, H / 2 - 78, 106, 28, 999, "rgba(255,255,255,0.18)");
        ctx.fillStyle = "rgba(255,255,255,0.86)";
        ctx.font = "900 11px Consolas";
        ctx.textBaseline = "middle";
        ctx.fillText("NEXT MODULE", 112, H / 2 - 64);
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 48px Georgia";
        ctx.textBaseline = "middle";
        ctx.fillText(nextGroup.title, 92, H / 2 - 22);
        drawWrappedText(nextGroup.detail, 96, H / 2 + 22, 760, {
          size: 22,
          minSize: 18,
          maxHeight: 56,
          maxLines: 2,
          weight: "800",
          family: "Arial",
          color: "rgba(255,255,255,0.92)",
          lineHeight: 1.2
        });
        ctx.restore();
      }
    }

    function drawOpeningSplash(localTime) {
      if (localTime > 4.8) return;
      const fadeIn = easeOutCubic(localTime / 0.72);
      const fadeOut = 1 - easeOutCubic(Math.max(0, localTime - 3.55) / 1.25);
      const alpha = clamp(Math.min(fadeIn, fadeOut), 0, 1);
      const scale = 0.96 + 0.04 * fadeIn;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgb(11,27,49)";
      ctx.fillRect(0, 0, W, H);

      ctx.translate(W / 2, H / 2);
      ctx.scale(scale, scale);
      ctx.translate(-W / 2, -H / 2);

      const glow = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 360);
      glow.addColorStop(0, "rgba(7,137,133,0.36)");
      glow.addColorStop(1, "rgba(7,137,133,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      drawLogo(W / 2 - 54, 170, 108);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 58px Georgia";
      ctx.fillText("Care Nova AI", W / 2, 336);
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.font = "900 19px Arial";
      ctx.fillText("Built by Naveed Ahamed", W / 2, 386);

      const agenda = [
        ["Agent flow", "Memory, route, safety"],
        ["Every tab", "General to Summary"],
        ["Best use", "Ask, review, save"]
      ];
      agenda.forEach((item, index) => {
        const cardW = 238;
        const gap = 16;
        const ax = W / 2 - (cardW * 3 + gap * 2) / 2 + index * (cardW + gap);
        const reveal = clamp((localTime - 1.1 - index * 0.18) / 0.5, 0, 1);
        ctx.save();
        ctx.globalAlpha = reveal;
        fillRoundRect(ctx, ax, 414, cardW, 72, 22, "rgba(255,255,255,0.10)");
        strokeRoundRect(ctx, ax, 414, cardW, 72, 22, "rgba(231,251,246,0.30)", 1.2);
        fillRoundRect(ctx, ax + 18, 433, 34, 34, 999, index === 0 ? colors.teal : index === 1 ? colors.blue : "#e7fbf6");
        ctx.fillStyle = index === 2 ? colors.navy : "#ffffff";
        ctx.font = "900 14px Consolas";
        ctx.textAlign = "center";
        ctx.fillText(String(index + 1), ax + 35, 450);
        ctx.textAlign = "left";
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 16px Arial";
        ctx.fillText(item[0], ax + 66, 438);
        ctx.fillStyle = "rgba(255,255,255,0.72)";
        ctx.font = "800 12px Arial";
        ctx.fillText(item[1], ax + 66, 462);
        ctx.restore();
      });

      drawStartupWorkflowStrip(W / 2 - 360, 512, 720, 82, localTime);
      fillRoundRect(ctx, W / 2 - 224, 610, 448, 34, 999, "rgba(231,251,246,0.10)");
      strokeRoundRect(ctx, W / 2 - 224, 610, 448, 34, 999, "rgba(231,251,246,0.28)", 1);
      ctx.fillStyle = "rgba(231,251,246,0.90)";
      ctx.font = "900 13px Arial";
      ctx.textAlign = "center";
      ctx.fillText("V24 premium guide: clearer pacing, chapter actions, safety, and local memory", W / 2, 627);
      ctx.textAlign = "left";
      ctx.restore();
    }

    function drawClosingRecap(localTime) {
      const alpha = clamp((localTime - (sceneDuration - 3.0)) / 0.8, 0, 1);
      if (alpha <= 0) return;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgb(11,27,49)";
      ctx.fillRect(0, 0, W, H);

      const glow = ctx.createRadialGradient(W / 2, H / 2, 70, W / 2, H / 2, 520);
      glow.addColorStop(0, "rgba(7,137,133,0.34)");
      glow.addColorStop(0.45, "rgba(31,110,203,0.15)");
      glow.addColorStop(1, "rgba(11,27,49,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      drawLogo(W / 2 - 48, 82, 96);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 56px Georgia";
      ctx.fillText("Care Nova AI V24 Guide", W / 2, 230);
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.font = "900 22px Arial";
      ctx.fillText("Built by Naveed Ahamed", W / 2, 282);

      const steps = [
        ["1", "Profile", "Set context"],
        ["2", "Ask", "One clear concern"],
        ["3", "Route", "One agent"],
        ["4", "Safety", "Review risk"],
        ["5", "Save", "Update memory"]
      ];
      const cardW = 176;
      const gap = 18;
      const startX = W / 2 - ((cardW * steps.length + gap * (steps.length - 1)) / 2);
      steps.forEach((step, index) => {
        const x = startX + index * (cardW + gap);
        fillRoundRect(ctx, x, 344, cardW, 112, 24, "rgba(255,255,255,0.10)");
        strokeRoundRect(ctx, x, 344, cardW, 112, 24, "rgba(255,255,255,0.28)", 1.3);
        fillRoundRect(ctx, x + 22, 364, 42, 42, 999, index < 2 ? colors.teal : index < 4 ? colors.blue : "#e7fbf6");
        ctx.fillStyle = index === 4 ? colors.navy : "#ffffff";
        ctx.font = "900 17px Consolas";
        ctx.fillText(step[0], x + 43, 385);
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 18px Arial";
        ctx.fillText(step[1], x + cardW / 2, 423);
        ctx.fillStyle = "rgba(255,255,255,0.74)";
        ctx.font = "800 13px Arial";
        ctx.fillText(step[2], x + cardW / 2, 446);
      });

      fillRoundRect(ctx, W / 2 - 320, 500, 640, 54, 999, "rgba(231,251,246,0.12)");
      strokeRoundRect(ctx, W / 2 - 320, 500, 640, 54, 999, "rgba(231,251,246,0.32)", 1.2);
      ctx.fillStyle = "#e7fbf6";
      ctx.font = "900 18px Arial";
      ctx.fillText("Use safely. Store locally. Share only what matters.", W / 2, 527);
      ctx.textAlign = "left";
      ctx.restore();
    }

    function drawFrame(t) {
      ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
      const totalDuration = scenes.length * sceneDuration;
      const bounded = Math.min(t, totalDuration - 0.001);
      const index = Math.floor(bounded / sceneDuration);
      const local = bounded - index * sceneDuration;
      drawScene(scenes[index], index, local);
      drawProgress(bounded);

      const transitionDuration = 1.35;
      const transitionStart = sceneDuration - transitionDuration;
      if (local > transitionStart && index < scenes.length - 1) {
        drawTransition((local - transitionStart) / transitionDuration, index);
      }

      if (index === 0) {
        drawOpeningSplash(local);
      }

      drawSectionBreak(index, local);

      if (index === scenes.length - 1) {
        drawClosingRecap(local);
      }
    }

    window.auditCareNovaTutorial = function () {
      const issues = [];
      const titleMaxChars = 68;
      const explainMaxChars = 148;
      const bulletTitleMax = 32;
      const bulletTextMax = 96;

      scenes.forEach((scene, index) => {
        if (scene.title.length > titleMaxChars) {
          issues.push({ scene: index + 1, field: "title", length: scene.title.length });
        }
        if (scene.explain.length > explainMaxChars) {
          issues.push({ scene: index + 1, field: "explain", length: scene.explain.length });
        }
        (scene.bullets || []).forEach((bullet, bulletIndex) => {
          if (bullet[0].length > bulletTitleMax) {
            issues.push({ scene: index + 1, field: "bulletTitle", bullet: bulletIndex + 1, length: bullet[0].length });
          }
          if (bullet[1].length > bulletTextMax) {
            issues.push({ scene: index + 1, field: "bulletText", bullet: bulletIndex + 1, length: bullet[1].length });
          }
        });
      });

      return { ok: issues.length === 0, issues };
    };

    function base64ToArrayBuffer(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes.buffer;
    }

    function arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      let binary = "";
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
      }
      return btoa(binary);
    }

    async function createTutorialAudio(duration) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        return {
          stream: new MediaStream(),
          start: async () => {},
          stop: () => {}
        };
      }

      const audioContext = new AudioContextClass({ sampleRate: 48000 });
      const destination = audioContext.createMediaStreamDestination();
      const master = audioContext.createGain();
      const limiter = audioContext.createDynamicsCompressor();
      master.gain.value = 0.92;
      limiter.threshold.value = -9;
      limiter.knee.value = 8;
      limiter.ratio.value = 10;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.18;
      master.connect(limiter);
      limiter.connect(destination);

      let voiceSource = null;
      if (narrationAudioBase64) {
        const audioBuffer = await audioContext.decodeAudioData(base64ToArrayBuffer(narrationAudioBase64).slice(0));
        voiceSource = audioContext.createBufferSource();
        voiceSource.buffer = audioBuffer;
        const voiceHighpass = audioContext.createBiquadFilter();
        voiceHighpass.type = "highpass";
        voiceHighpass.frequency.value = 92;
        voiceHighpass.Q.value = 0.7;
        const voicePresence = audioContext.createBiquadFilter();
        voicePresence.type = "peaking";
        voicePresence.frequency.value = 3200;
        voicePresence.Q.value = 1.05;
        voicePresence.gain.value = 2.6;
        const voiceDeEsser = audioContext.createBiquadFilter();
        voiceDeEsser.type = "peaking";
        voiceDeEsser.frequency.value = 6600;
        voiceDeEsser.Q.value = 3.8;
        voiceDeEsser.gain.value = -3.4;
        const voiceCompressor = audioContext.createDynamicsCompressor();
        voiceCompressor.threshold.value = -24;
        voiceCompressor.knee.value = 14;
        voiceCompressor.ratio.value = 3.5;
        voiceCompressor.attack.value = 0.003;
        voiceCompressor.release.value = 0.2;
        const voiceGain = audioContext.createGain();
        voiceGain.gain.value = 1.08;
        voiceSource.connect(voiceHighpass);
        voiceHighpass.connect(voicePresence);
        voicePresence.connect(voiceDeEsser);
        voiceDeEsser.connect(voiceCompressor);
        voiceCompressor.connect(voiceGain);
        voiceGain.connect(master);
      }

      const padOscillator = audioContext.createOscillator();
      const padGain = audioContext.createGain();
      const padTarget = 0.0026;
      padOscillator.type = "sine";
      padOscillator.frequency.value = 138;
      padGain.gain.value = 0;
      padOscillator.connect(padGain);
      padGain.connect(master);

      const secondPad = audioContext.createOscillator();
      const secondGain = audioContext.createGain();
      const secondTarget = 0.0013;
      secondPad.type = "sine";
      secondPad.frequency.value = 207;
      secondGain.gain.value = 0;
      secondPad.connect(secondGain);
      secondGain.connect(master);

      const airPad = audioContext.createOscillator();
      const airGain = audioContext.createGain();
      const airTarget = 0.0007;
      airPad.type = "sine";
      airPad.frequency.value = 414;
      airGain.gain.value = 0;
      airPad.connect(airGain);
      airGain.connect(master);

      return {
        stream: destination.stream,
        start: async () => {
          if (audioContext.state === "suspended") {
            await audioContext.resume();
          }
          const startAt = audioContext.currentTime + 0.06;
          const fadeInEnd = startAt + 1.25;
          const fadeOutStart = startAt + Math.max(0, duration - 1.6);
          const fadeOutEnd = startAt + duration + 0.35;
          [
            [padGain.gain, padTarget],
            [secondGain.gain, secondTarget],
            [airGain.gain, airTarget]
          ].forEach(([gainParam, target]) => {
            gainParam.setValueAtTime(0, startAt);
            gainParam.linearRampToValueAtTime(target, fadeInEnd);
            gainParam.setValueAtTime(target, fadeOutStart);
            gainParam.linearRampToValueAtTime(0, fadeOutEnd);
          });
          if (voiceSource) voiceSource.start(startAt);
          padOscillator.start(startAt);
          secondPad.start(startAt);
          airPad.start(startAt);
          padOscillator.stop(startAt + duration + 0.5);
          secondPad.stop(startAt + duration + 0.5);
          airPad.stop(startAt + duration + 0.5);
        },
        stop: () => {
          try {
            if (voiceSource) voiceSource.stop();
          } catch {}
          try {
            audioContext.close();
          } catch {}
        }
      };
    };

    window.renderCareNovaTutorial = async function () {
      if (!window.MediaRecorder) {
        throw new Error("MediaRecorder is not available in this browser.");
      }

      const duration = scenes.length * sceneDuration;
      const videoStream = canvas.captureStream(fps);
      const tutorialAudio = await createTutorialAudio(duration);
      const stream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...tutorialAudio.stream.getAudioTracks()
      ]);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm";
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 20000000,
        videoKeyFrameIntervalDuration: 1000
      });
      const chunks = [];
      const chunkWrites = [];
      const streamChunksToNode = typeof window.careNovaWriteVideoChunk === "function";

      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;

        if (streamChunksToNode) {
          chunkWrites.push(
            event.data.arrayBuffer()
              .then((buffer) => window.careNovaWriteVideoChunk(arrayBufferToBase64(buffer)))
          );
          return;
        }

        chunks.push(event.data);
      };

      let exportTimeout = null;
      const done = new Promise((resolve, reject) => {
        let settled = false;
        const finish = (handler) => {
          if (settled) return;
          settled = true;
          if (exportTimeout) {
            clearTimeout(exportTimeout);
          }
          handler();
        };

        exportTimeout = setTimeout(() => {
          finish(() => reject(new Error("Timed out while exporting tutorial video from the browser recorder.")));
        }, 600000);

        recorder.onstop = async () => {
          try {
            await Promise.all(chunkWrites);
            if (streamChunksToNode) {
              finish(() => resolve({ streamed: true }));
              return;
            }

            const blob = new Blob(chunks, { type: mimeType });
            const reader = new FileReader();
            reader.onerror = () => finish(() => reject(new Error("Unable to export tutorial video.")));
            reader.onload = () => {
              const result = String(reader.result || "");
              finish(() => resolve(result.includes(",") ? result.split(",")[1] : result));
            };
            reader.readAsDataURL(blob);
          } catch (error) {
            finish(() => reject(error));
          }
        };
        recorder.onerror = (event) => {
          finish(() => reject(event.error || new Error("Tutorial video recorder failed.")));
        };
      });

      recorder.start(2000);
      await tutorialAudio.start();
      const start = performance.now();
      drawFrame(0);

      await new Promise((resolve, reject) => {
        const timer = setInterval(() => {
          try {
            const now = performance.now();
            const t = Math.min(duration, (now - start) / 1000);
            drawFrame(t);
            if (t >= duration) {
              clearInterval(timer);
              resolve();
            }
          } catch (error) {
            clearInterval(timer);
            reject(error);
          }
        }, 1000 / fps);
      });

      if (recorder.state === "recording") {
        try {
          recorder.requestData();
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 250));
        recorder.stop();
      }
      const exportedVideo = await done;
      tutorialAudio.stop();
      stream.getTracks().forEach((track) => track.stop());
      return exportedVideo;
    };

    drawFrame(0.5);
  </script>
</body>
</html>`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
