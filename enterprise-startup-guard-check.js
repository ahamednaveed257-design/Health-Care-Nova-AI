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

async function importStartupGuard(label, overrides = {}) {
  const restoreEnv = applyScopedEnv(overrides);

  try {
    const moduleUrl = new URL(`../src/enterpriseStartupGuard.js?startup-guard-check=${encodeURIComponent(label)}-${Date.now()}`, import.meta.url);
    const module = await import(moduleUrl.href);
    return { module, restoreEnv };
  } catch (error) {
    restoreEnv();
    throw error;
  }
}

async function importServerModule(label, overrides = {}) {
  const restoreEnv = applyScopedEnv(overrides);

  try {
    const moduleUrl = new URL(`../server.js?startup-guard-check=${encodeURIComponent(label)}-${Date.now()}`, import.meta.url);
    const module = await import(moduleUrl.href);
    return { module, restoreEnv };
  } catch (error) {
    restoreEnv();
    throw error;
  }
}

async function expectStrictStartupBlock(label, overrides = {}) {
  const { module, restoreEnv } = await importServerModule(label, overrides);

  try {
    let thrown = null;

    try {
      const server = module.createServerApp();
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, "createServerApp should throw when strict startup guard blocks boot.");
    assert.equal(thrown.code, "STARTUP_GUARD_BLOCKED");
    assert.equal(thrown.statusCode, 503);
    assert.equal(thrown.startupReadiness?.status, "startup-blocked");
    assert.equal(thrown.startupReadiness?.summary?.strictGuardEnabled, true);
    assert.equal(thrown.startupReadiness?.summary?.shouldBlockStartup, true);
    assert.ok(Array.isArray(thrown.startupReadiness?.blockingChecks));
    assert.ok(thrown.startupReadiness.blockingChecks.some((check) => check.id === "public_origin_policy"));
    assert.ok(thrown.startupReadiness.blockingChecks.some((check) => check.id === "public_patient_access"));
  } finally {
    restoreEnv();
  }
}

async function withStrictStartupServer(label, overrides = {}, verify) {
  const { module, restoreEnv } = await importServerModule(label, overrides);
  const server = module.createServerApp();

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

async function loginAsAdmin(baseUrl, token) {
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

{
  const { module, restoreEnv } = await importStartupGuard("warn-only-review", {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    CARE_NOVA_PUBLIC_DEPLOYMENT: "true",
    CARE_NOVA_STRICT_STARTUP_GUARD: "false",
    ALLOWED_ORIGIN: "",
    ENABLE_HSTS: "false",
    CARE_NOVA_ACCESS_LOG: "false",
    CARE_NOVA_TRUST_PROXY: "false"
  });

  try {
    const readiness = module.getEnterpriseStartupReadiness(process.env, {
      nodeEnv: "production",
      host: "0.0.0.0",
      publicDeployment: true,
      port: 4173
    });

    assert.equal(readiness.status, "startup-review-needed");
    assert.equal(readiness.summary.strictGuardEnabled, false);
    assert.equal(readiness.summary.shouldBlockStartup, false);
    assert.ok(readiness.blockingChecks.some((check) => check.id === "public_origin_policy"));
    assert.ok(readiness.blockingChecks.some((check) => check.id === "public_patient_access"));
  } finally {
    restoreEnv();
  }
}

await expectStrictStartupBlock("strict-blocks-missing-public-controls", {
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  CARE_NOVA_PUBLIC_DEPLOYMENT: "true",
  CARE_NOVA_STRICT_STARTUP_GUARD: "true",
  ALLOWED_ORIGIN: "",
  ENABLE_HSTS: "false",
  CARE_NOVA_ACCESS_LOG: "false",
  CARE_NOVA_TRUST_PROXY: "false"
});

await withStrictStartupServer(
  "strict-startup-ready",
  {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    CARE_NOVA_PUBLIC_DEPLOYMENT: "true",
    CARE_NOVA_STRICT_STARTUP_GUARD: "true",
    ALLOWED_ORIGIN: "https://care.example",
    FRAME_ANCESTORS: "'self' https://care.example",
    ENABLE_HSTS: "true",
    CARE_NOVA_ACCESS_LOG: "true",
    CARE_NOVA_TRUST_PROXY: "true",
    CARE_NOVA_ADMIN_API_TOKEN: "startup-guard-admin",
    CARE_NOVA_ADMIN_SESSION_SECRET: "startup-guard-session-secret",
    CARE_NOVA_PATIENT_ACCESS_SECRET: "startup-guard-patient-secret"
  },
  async (baseUrl) => {
    const adminCookie = await loginAsAdmin(baseUrl, "startup-guard-admin");

    const response = await fetch(`${baseUrl}/api/startup-readiness`, {
      headers: {
        Cookie: adminCookie
      }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, "startup-ready");
    assert.equal(payload.summary.strictGuardEnabled, true);
    assert.equal(payload.summary.shouldBlockStartup, false);
    assert.equal(payload.summary.publicShareReady, true);
    assert.equal(payload.summary.criticalStorageReady, true);
  }
);

console.log("Enterprise startup guard checks passed.");
