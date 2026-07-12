#!/usr/bin/env node
import assert from "node:assert/strict";

function applyScopedEnv(overrides = {}) {
  const originalValues = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    originalValues.set(
      key,
      Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined
    );

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
  const moduleUrl = new URL(`../server.js?enterprise-release-snapshot-check=${encodeURIComponent(label)}-${Date.now()}`, import.meta.url);
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

async function login(baseUrl, token) {
  const response = await fetch(`${baseUrl}/api/admin/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token })
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);

  return response.headers.get("set-cookie") || "";
}

await withServer(
  "local-release-snapshot",
  {},
  async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin-release-snapshot`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.status, "admin-release-snapshot-ready");
    assert.equal(payload.summary.localFirst, true);
    assert.equal(payload.releaseGate.command, "npm run release:check");
    assert.equal(payload.probes.auditEvents, "/api/audit-events");
    assert.equal(payload.probes.dataRetentionPolicy, "/api/data-retention-policy");
    assert.equal(payload.probes.incidentPosture, "/api/incident-posture");
    assert.equal(payload.probes.recoveryPosture, "/api/recovery-posture");
    assert.equal(payload.probes.adminSecretPosture, "/api/admin-secret-posture");
    assert.ok(["retention-policy-ready", "retention-policy-review-needed"].includes(payload.controls.dataRetention.status));
    assert.ok(["incident-posture-ready", "incident-posture-review-needed"].includes(payload.controls.incidentPosture.status));
    assert.ok(["recovery-posture-ready", "recovery-posture-review-needed"].includes(payload.controls.recoveryPosture.status));
    assert.ok(["secret-posture-ready", "secret-posture-review-needed"].includes(payload.controls.secretPosture.status));
    assert.ok(["sha256", "hmac-sha256"].includes(payload.signature.method));
  }
);

await withServer(
  "public-release-snapshot",
  {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    CARE_NOVA_PUBLIC_DEPLOYMENT: "true",
    ALLOWED_ORIGIN: "https://care.example",
    FRAME_ANCESTORS: "'self' https://care.example",
    ENABLE_HSTS: "true",
    CARE_NOVA_ACCESS_LOG: "true",
    CARE_NOVA_TRUST_PROXY: "true",
    CARE_NOVA_ADMIN_API_TOKEN: "release-admin-token",
    CARE_NOVA_REVIEWER_API_TOKEN: "release-reviewer-token",
    CARE_NOVA_ADMIN_SESSION_SECRET: "release-session-secret",
    CARE_NOVA_PATIENT_ACCESS_SECRET: "release-patient-secret"
  },
  async (baseUrl) => {
    const reviewerCookie = await login(baseUrl, "release-reviewer-token");

    const releaseResponse = await fetch(`${baseUrl}/api/admin-release-snapshot?download=true`, {
      headers: {
        Cookie: reviewerCookie
      }
    });
    const releaseSnapshot = await releaseResponse.json();

    assert.equal(releaseResponse.status, 200);
    assert.equal(releaseSnapshot.status, "admin-release-snapshot-ready");
    assert.equal(releaseSnapshot.summary.releaseApproved, true);
    assert.equal(releaseSnapshot.summary.signedSnapshot, true);
    assert.equal(releaseSnapshot.signature.method, "hmac-sha256");
    assert.ok(["retention-policy-ready", "retention-policy-review-needed"].includes(releaseSnapshot.controls.dataRetention.status));
    assert.ok(["incident-posture-ready", "incident-posture-review-needed"].includes(releaseSnapshot.controls.incidentPosture.status));
    assert.ok(["recovery-posture-ready", "recovery-posture-review-needed"].includes(releaseSnapshot.controls.recoveryPosture.status));
    assert.ok(["secret-posture-ready", "secret-posture-review-needed"].includes(releaseSnapshot.controls.secretPosture.status));
    assert.match(
      releaseResponse.headers.get("content-disposition") || "",
      /care-nova-release-snapshot-\d{4}-\d{2}-\d{2}\.json/i
    );

    const auditResponse = await fetch(`${baseUrl}/api/audit-events?limit=5&download=true`, {
      headers: {
        Cookie: reviewerCookie
      }
    });
    const auditPayload = await auditResponse.json();

    assert.equal(auditResponse.status, 200);
    assert.equal(auditPayload.status, "audit-log-ready");
    assert.match(
      auditResponse.headers.get("content-disposition") || "",
      /care-nova-audit-events-\d{4}-\d{2}-\d{2}\.json/i
    );
  }
);

console.log("Enterprise release snapshot checks passed.");
