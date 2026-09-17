import "server-only";
import { getServerConfig } from "../config";

export async function probeOpenAI() {
  const config = getServerConfig().ai;
  if (!config.apiKey || !config.model) return { ok: false, reason: "not_configured" };
  if (config.provider !== "openai" || config.model !== "gpt-5.6-terra") {
    return { ok: false, reason: "unapproved_provider_or_model" };
  }
  try {
    // Model lookup verifies authentication without generating billable tokens.
    const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(config.model)}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return { ok: false, reason: "http_error", httpStatus: response.status };
    const body = await response.json();
    return { ok: body.id === config.model, model: config.model, generatedTokens: false };
  } catch {
    return { ok: false, reason: "connection_or_parse_error" };
  }
}
