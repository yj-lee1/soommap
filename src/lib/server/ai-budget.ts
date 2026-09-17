import "server-only";

export const AI_BUDGET_KEY = "soommap:{ai-dev-review-v1}:ledger";
export const AI_LIMIT_MICROS = 20_000_000;
export const AI_WARNING_MICROS = 18_000_000;
export const AI_RESERVATION_MICROS = 150_000;

type BudgetCode = "unconfigured" | "uninitialized" | "unavailable" | "duplicate" | "rate-limited" | "exhausted" | "warning";
export class BudgetError extends Error {
  readonly code: BudgetCode;
  constructor(code: BudgetCode) {
    super(code); this.name = "BudgetError"; this.code = code;
  }
}

// One hash tag/one EVAL: admission, deduplication, rate limit and debit are atomic.
// Initialization is an explicit operator action, never an automatic request fallback.
export const RESERVE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {'uninitialized'} end
local cap = tonumber(redis.call('HGET', KEYS[1], 'limit'))
local committed = tonumber(redis.call('HGET', KEYS[1], 'committed'))
if not cap or not committed then return {'uninitialized'} end
if redis.call('HEXISTS', KEYS[1], 'r:' .. ARGV[1]) == 1 then return {'duplicate'} end
local amount = tonumber(ARGV[2])
if committed + amount > math.min(cap, 20000000) then return {'exhausted'} end
if ARGV[6] == 'optional' and committed + amount >= 18000000 then return {'warning'} end
local flow = 'f:' .. ARGV[7]
local count = tonumber(redis.call('HGET', KEYS[1], flow) or '0')
if (ARGV[6] == 'required' and count ~= 0) or (ARGV[6] == 'optional' and count ~= 1) then return {'duplicate'} end
if ARGV[6] == 'required' then
  local limits = {6, 30, 20, 100, 60}
  for i = 2, 6 do
    if tonumber(redis.call('GET', KEYS[i]) or '0') >= limits[i - 1] then return {'rate-limited'} end
  end
  for i = 2, 6 do
    redis.call('INCR', KEYS[i])
    redis.call('EXPIRE', KEYS[i], (i == 3 or i == 5) and 3700 or 70)
  end
end
redis.call('HINCRBY', KEYS[1], flow, 1)
redis.call('HSET', KEYS[1], 'r:' .. ARGV[1], amount)
local total = redis.call('HINCRBY', KEYS[1], 'committed', amount)
redis.call('HINCRBY', KEYS[1], 'attempts', 1)
return {'reserved', tostring(total)}
`;

export const SETTLE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {'uninitialized'} end
local reserved = tonumber(redis.call('HGET', KEYS[1], 'r:' .. ARGV[1]))
if not reserved then return {'unchanged'} end
local actual = tonumber(ARGV[2])
if actual < 0 or actual > reserved then return {'invalid-cost'} end
redis.call('HSET', KEYS[1], 'r:' .. ARGV[1], 'done:' .. actual)
local total = redis.call('HINCRBY', KEYS[1], 'committed', actual - reserved)
redis.call('HINCRBY', KEYS[1], 'estimated', actual)
redis.call('HINCRBY', KEYS[1], 'inputTokens', ARGV[3])
redis.call('HINCRBY', KEYS[1], 'outputTokens', ARGV[4])
return {'settled', tostring(total)}
`;

export interface BudgetLedger {
  reserve(callId: string, sessionHash: string, optional: boolean): Promise<void>;
  settle(callId: string, inputTokens: number, outputTokens: number): Promise<void>;
}
export function estimatedMicros(inputTokens: number, outputTokens: number) {
  // Includes the published 1.25x cache-write input rate, even for uncached tokens.
  return Math.ceil(inputTokens * 2.5 + outputTokens * 12);
}
export async function redisCommand(command: Array<string | number>): Promise<unknown> {
  const rawUrl = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!rawUrl || !token) throw new BudgetError("unconfigured");
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new BudgetError("unconfigured"); }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".upstash.io") || url.username || url.password || url.search || url.hash || url.port || !["", "/"].includes(url.pathname)) {
    throw new BudgetError("unconfigured");
  }
  try {
    const response = await fetch(url.origin, { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(command) });
    if (!response.ok) throw new Error("redis_http_error");
    const body = await response.json();
    if (body.error || !("result" in body)) throw new Error("redis_error");
    return body.result;
  } catch { throw new BudgetError("unavailable"); }
}
export function sharedBudgetLedger(ipHash: string, flowId: string): BudgetLedger {
  return {
    async reserve(callId, sessionHash, optional) {
      const now = Date.now();
      const minute = Math.floor(now / 60_000), hour = Math.floor(now / 3_600_000);
      const prefix = "soommap:{ai-dev-review-v1}:rate:";
      const result = await redisCommand(["EVAL", RESERVE_SCRIPT, 6, AI_BUDGET_KEY,
        `${prefix}session:${sessionHash}:${minute}`, `${prefix}session-hour:${sessionHash}:${hour}`,
        `${prefix}ip:${ipHash}:${minute}`, `${prefix}ip-hour:${ipHash}:${hour}`, `${prefix}global:${minute}`,
        callId, AI_RESERVATION_MICROS, sessionHash, minute, hour, optional ? "optional" : "required", flowId]);
      if (!Array.isArray(result) || result[0] !== "reserved") {
        const code = Array.isArray(result) ? result[0] : "unavailable";
        throw new BudgetError(["uninitialized", "duplicate", "rate-limited", "exhausted", "warning"].includes(code) ? code : "unavailable");
      }
    },
    async settle(callId, inputTokens, outputTokens) {
      const cost = estimatedMicros(inputTokens, outputTokens);
      const result = await redisCommand(["EVAL", SETTLE_SCRIPT, 1, AI_BUDGET_KEY, callId, cost, inputTokens, outputTokens]);
      if (!Array.isArray(result) || !["settled", "unchanged"].includes(result[0])) throw new BudgetError("unavailable");
    },
  };
}
