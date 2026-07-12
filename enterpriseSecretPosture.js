import { getEnterprisePatientAccessProfile } from "./enterprisePatientAccess.js";
import { isLocalEndpoint } from "./runtimeConnectivity.js";

function cleanText(value, maxLength = 160) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(cleanText(value, 32), 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function readBoolean(value) {
  return /^(1|true|yes|on)$/i.test(cleanText(value, 16));
}

function readBooleanDefault(value, defaultValue = false) {
  const cleaned = cleanText(value, 16);

  if (!cleaned) {
    return defaultValue;
  }

  return /^(1|true|yes|on)$/i.test(cleaned);
}

function buildSecretSlot(id, label, envKey, configured, required, purpose, category) {
  return {
    id,
    label,
    envKey,
    configured,
    required,
    category,
    purpose
  };
}

const cloudSecretDefinitions = Object.freeze([
  {
    id: "openai",
    label: "OpenAI API key",
    envKey: "OPENAI_API_KEY",
    enabledEnvKey: "CARE_NOVA_OPENAI_ENABLED",
    endpointEnvKey: "OPENAI_BASE_URL",
    allModelsEligible: true,
    purpose: "Supports optional cloud LLM augmentation.",
    category: "cloud-llm"
  },
  {
    id: "deepseek",
    label: "DeepSeek API key",
    envKey: "DEEPSEEK_API_KEY",
    enabledEnvKey: "CARE_NOVA_DEEPSEEK_ENABLED",
    endpointEnvKey: "DEEPSEEK_BASE_URL",
    allModelsEligible: false,
    purpose: "Supports optional external DeepSeek access.",
    category: "cloud-llm"
  },
  {
    id: "temp_cloud",
    label: "Temporary cloud API key",
    envKey: "CARE_NOVA_TEMP_CLOUD_API_KEY",
    enabledEnvKey: "CARE_NOVA_TEMP_CLOUD_RESPONSE_ENABLED",
    endpointEnvKey: "CARE_NOVA_TEMP_CLOUD_API_URL",
    allModelsEligible: false,
    purpose: "Supports temporary cloud response augmentation.",
    category: "cloud-llm"
  },
  {
    id: "azure_openai",
    label: "Azure OpenAI key",
    envKey: "AZURE_OPENAI_API_KEY",
    enabledEnvKey: "CARE_NOVA_AZURE_OPENAI_ENABLED",
    endpointEnvKey: "AZURE_OPENAI_ENDPOINT",
    allModelsEligible: true,
    purpose: "Supports optional Azure OpenAI enterprise routing.",
    category: "cloud-llm"
  },
  {
    id: "anthropic",
    label: "Anthropic API key",
    envKey: "ANTHROPIC_API_KEY",
    enabledEnvKey: "CARE_NOVA_ANTHROPIC_ENABLED",
    endpointEnvKey: "ANTHROPIC_BASE_URL",
    allModelsEligible: true,
    purpose: "Supports optional Anthropic provider routing.",
    category: "cloud-llm"
  },
  {
    id: "gemini",
    label: "Gemini API key",
    envKey: "GEMINI_API_KEY",
    enabledEnvKey: "CARE_NOVA_GEMINI_ENABLED",
    endpointEnvKey: "GEMINI_BASE_URL",
    allModelsEligible: true,
    purpose: "Supports optional Gemini provider routing.",
    category: "cloud-llm"
  },
  {
    id: "enterprise_ai",
    label: "Enterprise AI key",
    envKey: "ENTERPRISE_AI_API_KEY",
    enabledEnvKey: "CARE_NOVA_ENTERPRISE_AI_ENABLED",
    endpointEnvKey: "ENTERPRISE_AI_ENDPOINT",
    allModelsEligible: true,
    purpose: "Supports optional enterprise AI provider routing.",
    category: "cloud-llm"
  },
  {
    id: "external_api",
    label: "External reference API key",
    envKey: "CARE_NOVA_EXTERNAL_API_KEY",
    enabledEnvKey: "CARE_NOVA_EXTERNAL_API_ENABLED",
    endpointEnvKey: "CARE_NOVA_EXTERNAL_API_URL",
    allModelsEligible: false,
    purpose: "Supports approved external reference retrieval.",
    category: "external-reference"
  }
]);

function isProviderSlotEnabled(env, definition) {
  const defaultEnabled = Boolean(cleanText(env[definition.envKey], 4096) || cleanText(env[definition.endpointEnvKey], 4096));
  const enabledByAllModels = definition.allModelsEligible !== false && readBoolean(env.CARE_NOVA_ENABLE_ALL_MODELS);
  return enabledByAllModels || readBooleanDefault(env[definition.enabledEnvKey], defaultEnabled);
}

function hasRemoteProviderFootprint(env, definition) {
  const apiKeyConfigured = Boolean(cleanText(env[definition.envKey], 4096));
  const endpoint = cleanText(env[definition.endpointEnvKey], 4096);
  const remoteEndpointConfigured = Boolean(endpoint) && !isLocalEndpoint(endpoint);
  return apiKeyConfigured || remoteEndpointConfigured;
}

function isLocalAdapterOnlyProviderSlot(env, definition) {
  const providerEnabled = isProviderSlotEnabled(env, definition);
  const endpoint = cleanText(env[definition.endpointEnvKey], 4096);
  const localEndpointConfigured = Boolean(endpoint) && isLocalEndpoint(endpoint);
  return providerEnabled && !hasRemoteProviderFootprint(env, definition) && (
    localEndpointConfigured || readBoolean(env.CARE_NOVA_ENABLE_ALL_MODELS)
  );
}

export function getEnterpriseSecretPosture(env = process.env) {
  const publicDeployment = readBoolean(env.CARE_NOVA_PUBLIC_DEPLOYMENT);
  const adminAuthRequired = readBoolean(env.CARE_NOVA_ADMIN_AUTH_REQUIRED) || publicDeployment;
  const mutationProtectionRequired = readBoolean(env.CARE_NOVA_REQUIRE_ADMIN_FOR_MUTATIONS) || publicDeployment;
  const patientAccess = getEnterprisePatientAccessProfile(env);
  const provider = cleanText(env.CARE_NOVA_SECRET_PROVIDER, 64) || "local-env-file";
  const rotationMaxAgeDays = parsePositiveInteger(env.CARE_NOVA_SECRET_ROTATION_DAYS, 90);
  const lastRotatedAt = cleanText(env.CARE_NOVA_SECRET_LAST_ROTATED_AT, 80);
  const lastRotatedAtMs = lastRotatedAt ? Date.parse(lastRotatedAt) : Number.NaN;
  const daysSinceRotation = Number.isFinite(lastRotatedAtMs)
    ? Math.max(0, Math.floor((Date.now() - lastRotatedAtMs) / (24 * 60 * 60 * 1000)))
    : null;
  const usesCloudProviders = cloudSecretDefinitions.some((definition) => (
    definition.category === "cloud-llm"
      && isProviderSlotEnabled(env, definition)
      && hasRemoteProviderFootprint(env, definition)
  ));
  const localAdapterCloudProviderSlots = cloudSecretDefinitions.filter((definition) => (
    definition.category === "cloud-llm" && isLocalAdapterOnlyProviderSlot(env, definition)
  )).length;

  const slots = [
    buildSecretSlot(
      "admin_api_token",
      "Admin API token",
      "CARE_NOVA_ADMIN_API_TOKEN",
      Boolean(cleanText(env.CARE_NOVA_ADMIN_API_TOKEN, 4096)),
      adminAuthRequired || mutationProtectionRequired,
      "Protects enterprise mutations and privileged admin routes.",
      "platform-control"
    ),
    buildSecretSlot(
      "reviewer_api_token",
      "Reviewer API token",
      "CARE_NOVA_REVIEWER_API_TOKEN",
      Boolean(cleanText(env.CARE_NOVA_REVIEWER_API_TOKEN, 4096)),
      false,
      "Enables read-only reviewer access for protected governance routes.",
      "platform-control"
    ),
    buildSecretSlot(
      "admin_session_secret",
      "Admin session secret",
      "CARE_NOVA_ADMIN_SESSION_SECRET",
      Boolean(cleanText(env.CARE_NOVA_ADMIN_SESSION_SECRET, 4096)),
      adminAuthRequired,
      "Signs admin session cookies for enterprise reviewer/admin access.",
      "platform-control"
    ),
    buildSecretSlot(
      "patient_access_secret",
      "Patient access secret",
      "CARE_NOVA_PATIENT_ACCESS_SECRET",
      Boolean(cleanText(env.CARE_NOVA_PATIENT_ACCESS_SECRET, 4096)),
      patientAccess.required,
      "Signs patient-scoped access tokens for shared patient-data routes.",
      "platform-control"
    ),
    buildSecretSlot(
      "release_snapshot_secret",
      "Release snapshot signing secret",
      "CARE_NOVA_RELEASE_SNAPSHOT_SECRET",
      Boolean(cleanText(env.CARE_NOVA_RELEASE_SNAPSHOT_SECRET, 4096)),
      false,
      "Signs exported enterprise release snapshots independently from session cookies.",
      "governance"
    ),
    ...cloudSecretDefinitions.map((definition) => buildSecretSlot(
      definition.id,
      definition.label,
      definition.envKey,
      Boolean(cleanText(env[definition.envKey], 4096)),
      definition.category === "cloud-llm"
        && isProviderSlotEnabled(env, definition)
        && hasRemoteProviderFootprint(env, definition),
      definition.purpose,
      definition.category
    ))
  ];

  const requiredSlots = slots.filter((slot) => slot.required);
  const missingRequired = requiredSlots.filter((slot) => !slot.configured);
  const configuredSlots = slots.filter((slot) => slot.configured);
  const reviewPoints = [];

  if (publicDeployment && provider === "local-env-file") {
    reviewPoints.push("Move enterprise secrets into a managed secret store before public or shared deployment.");
  }

  if (!lastRotatedAt) {
    reviewPoints.push("Document the enterprise secret rotation date.");
  } else if (!Number.isFinite(lastRotatedAtMs)) {
    reviewPoints.push("CARE_NOVA_SECRET_LAST_ROTATED_AT is not a valid ISO timestamp.");
  } else if (daysSinceRotation > rotationMaxAgeDays) {
    reviewPoints.push(`Enterprise secrets are older than the ${rotationMaxAgeDays}-day rotation policy.`);
  }

  if (missingRequired.length) {
    reviewPoints.push(`Required enterprise secrets are missing: ${missingRequired.map((slot) => slot.envKey).join(", ")}.`);
  }

  if (usesCloudProviders && !configuredSlots.some((slot) => slot.category === "cloud-llm")) {
    reviewPoints.push("Cloud-provider mode is enabled but no cloud provider secret is configured.");
  }

  return {
    ok: true,
    status: reviewPoints.length ? "secret-posture-review-needed" : "secret-posture-ready",
    summary: {
      provider,
      publicDeployment,
      adminAuthRequired,
      mutationProtectionRequired,
      patientAccessRequired: patientAccess.required,
      patientAccessRequiredByPublicDeployment: patientAccess.requiredByPublicDeployment === true,
      trackedSecretSlots: slots.length,
      configuredSecretSlots: configuredSlots.length,
      requiredSecretSlots: requiredSlots.length,
      missingRequiredSecretSlots: missingRequired.length,
      usesCloudProviders,
      localAdapterCloudProviderSlots,
      rotationMaxAgeDays,
      lastRotatedAt,
      daysSinceRotation,
      releaseSnapshotIndependentlySigned: Boolean(cleanText(env.CARE_NOVA_RELEASE_SNAPSHOT_SECRET, 4096))
    },
    slots,
    reviewPoints,
    secretStoreRecommendations: [
      "Use a managed secret store or platform secret manager for shared deployment.",
      "Rotate platform-control secrets on a fixed schedule and record the rotation timestamp.",
      "Keep separate secrets for admin sessions and release-snapshot signing when governance requires separation of duties.",
      "Only enable cloud-provider keys for the providers that are intentionally active."
    ],
    boundary: "This endpoint reports secret posture, presence, and rotation metadata only. It never returns secret values.",
    timestamp: new Date().toISOString()
  };
}
