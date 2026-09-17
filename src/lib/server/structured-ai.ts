import "server-only";
import { getServerConfig } from "./config.ts";
import type { BudgetLedger } from "./ai-budget.ts";

export class AiResponseError extends Error {}
type Request = { name: string; schema: Record<string, unknown>; instructions: string; context: string; outputTokens: number;
  callId: string; sessionHash: string; optional?: boolean };

export async function structuredAI(request: Request, ledger: BudgetLedger, send: typeof fetch = fetch): Promise<unknown> {
  const config = getServerConfig().ai;
  if (!config.apiKey || config.provider !== "openai" || config.model !== "gpt-5.6-terra" || config.approvedBudgetUsd !== 20) throw new AiResponseError("not_configured");
  const body = JSON.stringify({ model: config.model, store: false, service_tier: "default", reasoning: { effort: "none" },
    max_output_tokens: request.outputTokens, input: [{ role: "developer", content: request.instructions }, { role: "user", content: request.context }],
    text: { format: { type: "json_schema", name: request.name, strict: true, schema: request.schema } } });
  // UTF-8 bytes plus an 8192-token safety allowance bound input cost under $0.15.
  // Output includes any reasoning tokens; no tools/extra services or automatic retry.
  if (Buffer.byteLength(body) > 32_768 || request.outputTokens > 2048 || request.outputTokens < 1) throw new AiResponseError("context_limit");
  await ledger.reserve(request.callId, request.sessionHash, request.optional === true);
  let payload: Record<string, unknown>;
  try {
    const response = await send("https://api.openai.com/v1/responses", { method: "POST", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(request.optional ? 8_000 : 20_000), headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, body });
    const raw = await response.text();
    if (raw.length > 200_000) throw new AiResponseError("response_limit");
    payload = JSON.parse(raw);
    const usage = payload.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (Number.isSafeInteger(usage?.input_tokens) && Number.isSafeInteger(usage?.output_tokens) && usage!.input_tokens! >= 0 && usage!.output_tokens! >= 0) {
      // Settlement failure retains the full reservation; do not replay generation.
      try { await ledger.settle(request.callId, usage!.input_tokens!, usage!.output_tokens!); } catch { /* conservative reservation stays */ }
    }
    if (!response.ok || payload.status !== "completed") throw new AiResponseError("provider_or_incomplete");
    const messages = Array.isArray(payload.output) ? payload.output : [];
    const contents = messages.filter(item => item?.type === "message").flatMap(item => item.content ?? []);
    if (contents.some(item => item.type === "refusal")) throw new AiResponseError("refusal");
    const text = contents.filter(item => item.type === "output_text").map(item => item.text).join("");
    return JSON.parse(text);
  } catch { throw new AiResponseError("generation_failed"); }
}
