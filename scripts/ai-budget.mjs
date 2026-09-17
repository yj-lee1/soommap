// Run: node --conditions=react-server scripts/ai-budget.mjs [--initialize]
// Initialization is explicit, create-only and never resets an existing ledger.
process.loadEnvFile(".env.local");
const { redisCommand, AI_BUDGET_KEY } = await import("../src/lib/server/ai-budget.ts");
const initialize = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 'already-exists' end
redis.call('HSET', KEYS[1], 'limit', 20000000, 'committed', 50000, 'estimated', 616,
 'attempts', 1, 'inputTokens', 112, 'outputTokens', 28, 'setupAllowance', 50000, 'version', 1)
return 'initialized'
`;
try {
  if (process.argv.includes("--initialize")) console.log({ initialization: await redisCommand(["EVAL", initialize, 1, AI_BUDGET_KEY]) });
  const values = await redisCommand(["HMGET", AI_BUDGET_KEY, "limit", "committed", "estimated", "attempts", "inputTokens", "outputTokens"]);
  if (!Array.isArray(values) || values[0] === null) throw new Error("uninitialized");
  console.log({ limitUsd: Number(values[0]) / 1e6, committedUsd: Number(values[1]) / 1e6,
    estimatedUsd: Number(values[2]) / 1e6, attempts: Number(values[3]), inputTokens: Number(values[4]), outputTokens: Number(values[5]) });
} catch { console.error("Budget ledger unavailable or not initialized; no keys or provider responses logged."); process.exitCode = 1; }
