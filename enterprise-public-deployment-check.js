import assert from "node:assert/strict";

import { buildEnterprisePatientAccessToken } from "../src/enterprisePatientAccess.js";

function applyScopedEnv(overrides = {}) {
  const originalValues = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    originalValues.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);

    if (value === undefined || value === null || value === "") {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  return () => {
    for (const [key, value] of originalValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function withServer(label, overrides, verify) {
  const restoreEnv = applyScopedEnv(overrides);
  const moduleUrl = new URL(`../server.js?enterprise-public-check=${encodeURIComponent(label)}-${Date.now()}`, import.meta.url);
  const { createServerApp } = await import(moduleUrl.href);
  const server = createServerApp();

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await verify(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    restoreEnv();
  }
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const payload = await response.json();
  return { response, payload };
}

await withServer(
  "public-deployment-missing-controls",
  {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    CARE_NOVA_PUBLIC_DEPLOYMENT: "true",
    ALLOWED_ORIGIN: "",
    FRAME_ANCESTORS: "'self'",
    ENABLE_HSTS: "false",
    CARE_NOVA_ACCESS_LOG: "false",
    CARE_NOVA_TRUST_PROXY: "false"
  },
  async (baseUrl) => {
    const { response: readyResponse, payload: ready } = await getJson(baseUrl, "/api/ready");
    assert.equal(readyResponse.status, 503);
    assert.equal(ready.ok, false);
    assert.equal(ready.status, "deployment-review-needed");
    assert.equal(ready.publicDeployment.enabled, true);
    assert.equal(ready.publicDeployment.publicShareReady, false);
    assert.ok(ready.publicDeployment.blockingChecks.includes("public_origin_policy"));
    assert.ok(ready.publicDeployment.blockingChecks.includes("public_https_transport"));
    assert.ok(ready.publicDeployment.blockingChecks.includes("public_proxy_identity"));
    assert.ok(ready.publicDeployment.blockingChecks.includes("public_access_logging"));
    assert.ok(ready.publicDeployment.blockingChecks.includes("public_admin_auth"));
    assert.ok(ready.publicDeployment.blockingChecks.includes("public_mutation_auth"));
    assert.ok(ready.publicDeployment.blockingChecks.includes("public_patient_access"));

    const { response: deploymentResponse, payload: deployment } = await getJson(baseUrl, "/api/deployment-readiness");
    assert.equal(deploymentResponse.status, 200);
    assert.equal(deployment.ok, true);
    assert.equal(deployment.status, "deployment-review-needed");
    assert.ok(deployment.score < 100);
    assert.equal(deployment.publicDeployment.enabled, true);
    assert.equal(deployment.publicDeployment.publicShareReady, false);
    assert.ok(deployment.checks.some((check) => check.id === "public_origin_policy" && check.status === "review"));
    assert.ok(deployment.checks.some((check) => check.id === "public_https_transport" && check.status === "review"));
    assert.ok(deployment.checks.some((check) => check.id === "public_proxy_identity" && check.status === "review"));
    assert.ok(deployment.checks.some((check) => check.id === "public_access_logging" && check.status === "review"));
    assert.ok(deployment.checks.some((check) => check.id === "public_admin_auth" && check.status === "review"));
    assert.ok(deployment.checks.some((check) => check.id === "public_mutation_auth" && check.status === "review"));
    assert.ok(deployment.checks.some((check) => check.id === "public_patient_access" && check.status === "review"));

    const adminPolicyResponse = await fetch(`${baseUrl}/api/admin-policy`);
    const adminPolicy = await adminPolicyResponse.json();
    assert.equal(adminPolicyResponse.status, 503);
    assert.equal(adminPolicy.code, "ADMIN_AUTH_NOT_CONFIGURED");

    const recordSaveResponse = await fetch(`${baseUrl}/api/records`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId: "public-check", records: [] })
    });
    const recordSave = await recordSaveResponse.json();
    assert.equal(recordSaveResponse.status, 503);
    assert.equal(recordSave.code, "ADMIN_TOKEN_NOT_CONFIGURED");

    const patientMemoryResponse = await fetch(`${baseUrl}/api/memory?patientId=public-check`);
    const patientMemory = await patientMemoryResponse.json();
    assert.equal(patientMemoryResponse.status, 503);
    assert.equal(patientMemory.code, "PATIENT_ACCESS_NOT_CONFIGURED");

    const disallowedOriginResponse = await fetch(`${baseUrl}/api/health`, {
      headers: {
        Origin: "https://wrong.example"
      }
    });
    const disallowedOrigin = await disallowedOriginResponse.json();
    assert.equal(disallowedOriginResponse.status, 403);
    assert.equal(disallowedOrigin.code, "ORIGIN_NOT_ALLOWED");
  }
);

await withServer(
  "public-deployment-controls-configured",
  {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    CARE_NOVA_PUBLIC_DEPLOYMENT: "true",
    ALLOWED_ORIGIN: "https://care.example",
    FRAME_ANCESTORS: "'self' https://care.example",
    ENABLE_HSTS: "true",
    CARE_NOVA_ACCESS_LOG: "true",
    CARE_NOVA_TRUST_PROXY: "true",
    CARE_NOVA_ADMIN_API_TOKEN: "public-deploy-admin",
    CARE_NOVA_ADMIN_SESSION_SECRET: "public-deploy-session-secret",
    CARE_NOVA_PATIENT_ACCESS_SECRET: "public-deploy-patient-secret",
    CARE_NOVA_PATIENT_HEADER: "X-Care-Nova-Patient-Token"
  },
  async (baseUrl) => {
    const { response: readyResponse, payload: ready } = await getJson(baseUrl, "/api/ready");
    assert.equal(readyResponse.status, 200);
    assert.equal(ready.ok, true);
    assert.equal(ready.status, "ready");
    assert.equal(ready.publicDeployment.enabled, true);
    assert.equal(ready.publicDeployment.publicShareReady, true);

    const { response: deploymentResponse, payload: deployment } = await getJson(baseUrl, "/api/deployment-readiness");
    assert.equal(deploymentResponse.status, 200);
    assert.equal(deployment.ok, true);
    assert.equal(deployment.status, "deployment-ready");
    assert.equal(deployment.score, 100);
    assert.equal(deployment.publicDeployment.enabled, true);
    assert.equal(deployment.publicDeployment.publicShareReady, true);
    assert.ok(deployment.checks.every((check) => check.status === "pass"));

    const adminPolicyResponse = await fetch(`${baseUrl}/api/admin-policy`);
    const adminPolicy = await adminPolicyResponse.json();
    assert.equal(adminPolicyResponse.status, 403);
    assert.equal(adminPolicy.code, "ADMIN_AUTH_REQUIRED");

    const recordSaveResponse = await fetch(`${baseUrl}/api/records`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ patientId: "public-check", records: [] })
    });
    const recordSave = await recordSaveResponse.json();
    assert.equal(recordSaveResponse.status, 403);
    assert.equal(recordSave.code, "ADMIN_AUTH_REQUIRED");

    const blockedPatientMemoryResponse = await fetch(`${baseUrl}/api/memory?patientId=public-check`);
    const blockedPatientMemory = await blockedPatientMemoryResponse.json();
    assert.equal(blockedPatientMemoryResponse.status, 403);
    assert.equal(blockedPatientMemory.code, "PATIENT_ACCESS_REQUIRED");

    const patientToken = buildEnterprisePatientAccessToken({
      patientId: "public-check",
      actorId: "public-check-user"
    });
    assert.equal(patientToken.ok, true);

    const allowedPatientMemoryResponse = await fetch(`${baseUrl}/api/memory?patientId=public-check`, {
      headers: {
        "X-Care-Nova-Patient-Token": patientToken.token
      }
    });
    const allowedPatientMemory = await allowedPatientMemoryResponse.json();
    assert.equal(allowedPatientMemoryResponse.status, 200);
    assert.equal(allowedPatientMemory.ok, true);

    const blockedAnalyzeResponse = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        patientId: "public-check",
        message: "Please review my blood pressure of 145 over 95.",
        profile: {
          name: "Public Check",
          age: "52",
          conditions: "Hypertension"
        },
        vitals: {
          systolic: "145",
          diastolic: "95"
        }
      })
    });
    const blockedAnalyze = await blockedAnalyzeResponse.json();
    assert.equal(blockedAnalyzeResponse.status, 403);
    assert.equal(blockedAnalyze.code, "PATIENT_ACCESS_REQUIRED");

    const allowedAnalyzeResponse = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Care-Nova-Patient-Token": patientToken.token
      },
      body: JSON.stringify({
        patientId: "public-check",
        message: "Please review my blood pressure of 145 over 95.",
        profile: {
          name: "Public Check",
          age: "52",
          conditions: "Hypertension"
        },
        vitals: {
          systolic: "145",
          diastolic: "95"
        }
      })
    });
    const allowedAnalyze = await allowedAnalyzeResponse.json();
    assert.equal(allowedAnalyzeResponse.status, 200);
    assert.equal(allowedAnalyze.ok, true);

    const allowedOriginResponse = await fetch(`${baseUrl}/api/health`, {
      headers: {
        Origin: "https://care.example"
      }
    });
    const allowedOrigin = await allowedOriginResponse.json();
    assert.equal(allowedOriginResponse.status, 200);
    assert.equal(allowedOrigin.ok, true);
    assert.equal(allowedOriginResponse.headers.get("access-control-allow-origin"), "https://care.example");

    const disallowedOriginResponse = await fetch(`${baseUrl}/api/health`, {
      headers: {
        Origin: "https://wrong.example"
      }
    });
    const disallowedOrigin = await disallowedOriginResponse.json();
    assert.equal(disallowedOriginResponse.status, 403);
    assert.equal(disallowedOrigin.code, "ORIGIN_NOT_ALLOWED");
  }
);

console.log("Enterprise public deployment checks passed.");
