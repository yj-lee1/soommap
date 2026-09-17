// Operator-only budget inspection/one-time initialization. Never reset a used budget.
process.loadEnvFile(".env.local");
const { redisCommand } = await import("../src/lib/server/ai-budget.ts");
const { TRANSIT_BUDGET_KEY } = await import("../src/lib/server/transit.ts");
try {
  const mode = process.argv[2];
  if (!["init", "status"].includes(mode)) throw new Error("mode");
  if (mode === "init") await redisCommand(["SET", TRANSIT_BUDGET_KEY, 0, "NX"]);
  const amount = await redisCommand(["GET", TRANSIT_BUDGET_KEY]);
  console.log(JSON.stringify({ initialized: amount !== null, reservedKrw: amount === null ? null : Number(amount), limitKrw: 5000,
    reservePerRequestKrw: 1, billingMode: process.env.TMAP_BILLING_MODE === "paid" ? "paid" : "free" }));
} catch { console.error("TMAP budget unavailable; no secrets logged."); process.exitCode = 1; }
