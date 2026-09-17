import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const suppliedTarget = process.argv.slice(2).find(value => value !== "--probe") ?? "http://127.0.0.1:3000";
const probe = process.argv.includes("--probe");
let target;
try {
  target = new URL(suppliedTarget);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname);
  if (
    (target.protocol !== "https:" && !(local && target.protocol === "http:")) ||
    target.username || target.password || target.search || target.hash ||
    target.pathname !== "/"
  ) throw new Error("invalid_target");
} catch {
  console.error("Use the verified deployment origin (HTTPS) or localhost origin only.");
  process.exit(1);
}

const token = process.env.SETUP_CHECK_TOKEN?.trim();
if (!token || token.length < 32) {
  console.error("Set SETUP_CHECK_TOKEN in .env.local before checking setup.");
  process.exit(1);
}

try {
  const healthResponse = await fetch(new URL("/api/health", target), {
    redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  const response = await fetch(new URL("/api/setup/status", target), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!healthResponse.ok || !response.ok) {
    console.error(JSON.stringify({ healthStatus: healthResponse.status, setupStatus: response.status }));
    process.exit(1);
  }
  const payload = await response.json();
  const health = await healthResponse.json();
  if (health.status !== "ok" || health.service !== "soommap") throw new Error("invalid_health");
  // Keep output bounded even if a target returns an unexpected response.
  console.log(JSON.stringify({
    webServerReachable: true,
    authenticatedSetupReachable: true,
    configuration: Object.fromEntries(
      ["seoulApiKey", "aiProvider", "aiModel", "aiApiKey"].map(key => [key, payload.configuration?.[key] === true]),
    ),
    integrationsVerified: false,
  }, null, 2));
  if (probe) {
    const result = await fetch(new URL("/api/setup/probe", target), {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
      redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (!result.ok) throw new Error("probe_failed");
    const data = await result.json();
    console.log(JSON.stringify({
      seoulConnected: data.seoul?.ok === true,
      seoulArea: data.seoul?.areaName,
      seoulObservedAt: data.seoul?.observedAt,
      seoulForecastCount: data.seoul?.forecastCount,
      openaiModelAccessible: data.openai?.ok === true,
      integrationsVerified: data.integrationsVerified === true,
      aiGenerationVerified: false,
    }, null, 2));
    if (data.integrationsVerified !== true) process.exitCode = 1;
  }
} catch {
  // Raw network errors may contain request details. Do not print them.
  console.error("Setup check could not reach or validate the application response.");
  process.exit(1);
}
