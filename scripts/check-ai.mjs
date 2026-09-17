import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const model = process.env.AI_MODEL?.trim();
const key = process.env.AI_API_KEY?.trim();
const limit = Number(process.env.AI_BUDGET_USD);
const reservationUsd = 0.05;
if (process.env.AI_PROVIDER !== "openai" || model !== "gpt-5.6-terra" || !key ||
  !Number.isFinite(limit) || limit < reservationUsd || limit > 20) {
  console.error("Approved provider, exact model, key and budget (up to $20) are required.");
  process.exit(1);
}

// One fixed paid check, local only. An exclusive file prevents duplicate calls,
// including concurrent runs and uncertain retries. Carry this reservation into
// the shared durable budget in phase 3; never reset it on deployment.
mkdirSync(".local", { recursive: true, mode: 0o700 });
const receiptPath = ".local/ai-setup-check.json";
if (existsSync(receiptPath)) {
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  console.log(JSON.stringify({ alreadyAttempted: true, status: receipt.status,
    structuredOutputVerified: receipt.structuredOutputVerified === true,
    reservationUsd: receipt.reservationUsd, estimatedCostUsd: receipt.estimatedCostUsd,
  }, null, 2));
  if (!receipt.structuredOutputVerified) process.exitCode = 1;
} else {
  const receipt = { checkedAt: new Date().toISOString(), model, status: "reserved",
    reservationUsd, approvedTotalUsd: limit, structuredOutputVerified: false };
  try {
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
  } catch {
    console.error("Could not reserve the check. No request was sent.");
    process.exit(1);
  }
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(45_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, store: false, service_tier: "default",
        reasoning: { effort: "none" }, max_output_tokens: 512,
        input: [{ role: "developer", content: "Extract the outing place, activity and arrival hour. Do not recommend anything." },
          { role: "user", content: "오늘 17시에 여의도한강공원에서 산책하고 싶어." }],
        text: { format: { type: "json_schema", name: "setup_outing", strict: true,
          schema: { type: "object", additionalProperties: false,
            properties: { place: { type: "string", enum: ["여의도한강공원"] },
              activity: { type: "string", enum: ["walk"] }, hour: { type: "integer" } },
            required: ["place", "activity", "hour"] } } },
      }),
    });
    receipt.httpStatus = response.status;
    const body = await response.json();
    if (!response.ok) throw new Error("provider_error");
    const usage = body.usage;
    if (Number.isSafeInteger(usage?.input_tokens) && Number.isSafeInteger(usage?.output_tokens) &&
      usage.input_tokens >= 0 && usage.output_tokens >= 0) {
      receipt.usage = { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
      // Conservative: includes potential cache-write rate; does not claim invoice cost.
      receipt.estimatedCostUsd = (usage.input_tokens * 2.5 + usage.output_tokens * 12) / 1_000_000;
    }
    if (body.status !== "completed") throw new Error("incomplete_output");
    const output = body.output?.filter(item => item.type === "message")
      .flatMap(item => item.content ?? []).filter(item => item.type === "output_text")
      .map(item => item.text).join("");
    const parsed = JSON.parse(output);
    receipt.structuredOutputVerified = parsed.place === "여의도한강공원" &&
      parsed.activity === "walk" && parsed.hour === 17 && Object.keys(parsed).length === 3;
    receipt.status = receipt.structuredOutputVerified ? "verified" : "invalid_output";
  } catch {
    receipt.status = "failed_or_uncertain";
    // Keep the full reservation even when the provider outcome is unknown.
  }
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.structuredOutputVerified) process.exitCode = 1;
}
