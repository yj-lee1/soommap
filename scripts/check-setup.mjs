import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const suppliedTarget = process.argv[2] ?? "http://127.0.0.1:3000";
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
  // Keep output bounded even if a target returns an unexpected response.
  console.log(JSON.stringify({
    webServerReachable: true,
    authenticatedSetupReachable: true,
    configuration: Object.fromEntries(
      ["seoulApiKey", "aiProvider", "aiModel", "aiApiKey"].map(key => [key, payload.configuration?.[key] === true]),
    ),
    integrationsVerified: false,
  }, null, 2));
} catch {
  // Raw network errors may contain request details. Do not print them.
  console.error("Setup check could not reach or validate the application response.");
  process.exit(1);
}
