import "server-only";
import { redisCommand } from "./ai-budget.ts";
import { seal, unseal } from "./ai-flow-cache.ts";
import { callIdentity } from "./ai-session.ts";
import { ConditionsError } from "../domain/conditions.ts";
import type { Origin, TransitBundle, TransitContext, TransitRoute } from "../domain/mobility.ts";
import type { Place } from "../domain/types.ts";

export class TransitError extends Error {}
export const TRANSIT_BUDGET_KEY = "soommap:{transit-dev-review-v1}:reserved-krw";
const PREFIX = "soommap:{transit-dev-review-v1}:";
// Reserve before external requests. Failed or timed-out requests remain counted conservatively.
export const TRANSIT_RESERVE_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local count = tonumber(ARGV[1])
if redis.call('EXISTS', KEYS[4]) == 0 then return 'uninitialized' end
local total = tonumber(redis.call('GET', KEYS[4]))
if total + count > 5000 then return 'budget' end
if used + count > tonumber(ARGV[2]) then return 'quota' end
local user = tonumber(redis.call('GET', KEYS[2]) or '0')
local ip = tonumber(redis.call('GET', KEYS[3]) or '0')
if user >= 3 or ip >= 6 then return 'rate' end
redis.call('INCRBY', KEYS[4], count)
redis.call('INCRBY', KEYS[1], count); redis.call('EXPIRE', KEYS[1], 172800)
redis.call('INCR', KEYS[2]); redis.call('EXPIRE', KEYS[2], 60)
redis.call('INCR', KEYS[3]); redis.call('EXPIRE', KEYS[3], 60)
return 'ok'`;

export function parseTransitResponse(value: unknown, place: Place, departureMs: number, fetchedMs: number): TransitRoute {
  const v = value as { metaData?: { plan?: { itineraries?: unknown[] } } } | null;
  const itineraries = v?.metaData?.plan?.itineraries;
  if (!Array.isArray(itineraries)) throw new TransitError("대중교통 경로를 확인하지 못했어요. 가까운 출발역이나 직접 도착시각 모드를 이용해주세요.");
  const valid = itineraries.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const r = item as Record<string, unknown>;
    if (![1, 2, 3].includes(Number(r.pathType)) || !Number.isInteger(r.totalTime) || (r.totalTime as number) <= 0 || (r.totalTime as number) > 6 * 3600 ||
      !Number.isInteger(r.totalWalkTime) || (r.totalWalkTime as number) < 0 || (r.totalWalkTime as number) > (r.totalTime as number) ||
      !Number.isInteger(r.transferCount) || (r.transferCount as number) < 0 || (r.transferCount as number) > 20) return [];
    return [{ totalSeconds: r.totalTime as number, walkingSeconds: r.totalWalkTime as number, transfers: r.transferCount as number }];
  }).sort((a, b) => a.totalSeconds - b.totalSeconds || a.transfers - b.transfers || a.walkingSeconds - b.walkingSeconds);
  if (!valid[0]) throw new TransitError("사용 가능한 버스·지하철 경로를 확인하지 못했어요.");
  return { ...valid[0], placeId: place.id, accessPointId: place.accessPoint.id,
    arrivalAt: new Date(Math.ceil((departureMs + valid[0].totalSeconds * 1000) / 60_000) * 60_000).toISOString(), fetchedAt: new Date(fetchedMs).toISOString() };
}

export async function requestTransit(origin: Origin, place: Place, departureMs: number, apiKey: string, fetcher: typeof fetch = fetch): Promise<TransitRoute> {
  const end = place.accessPoint.coordinate;
  try {
    const response = await fetcher("https://apis.openapi.sk.com/transit/routes/sub", { method: "POST",
      headers: { "Content-Type": "application/json", appKey: apiKey }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ startX: String(origin.longitude), startY: String(origin.latitude), endX: String(end.longitude), endY: String(end.latitude), count: 10, format: "json" }) });
    if (!response.ok) throw new Error("provider_error");
    return parseTransitResponse(await response.json(), place, departureMs, Date.now());
  } catch (e) {
    if (e instanceof TransitError) throw e;
    throw new TransitError("이동시간 응답이 없거나 늦어졌어요. 이동시간을 0분으로 대체하지 않았습니다.");
  }
}

/** AES-GCM token binds trusted provider results to one signed browser session for five minutes. */
export function transitToken(context: TransitContext, session: string): string { return seal({ kind: "transit-v1", session, context }); }
export function readTransitToken(token: unknown, session: string | null, now = Date.now()): TransitContext | undefined {
  if (token === undefined || token === null) return undefined;
  if (!session || typeof token !== "string" || token.length > 10000) throw new ConditionsError("출발지 계산 세션을 다시 준비해주세요.");
  try {
    const p = unseal(token) as { kind: string; session: string; context: TransitContext };
    if (p.kind !== "transit-v1" || p.session !== session || !Number.isFinite(Date.parse(p.context.expiresAt)) ||
      Date.parse(p.context.expiresAt) <= now || Date.parse(p.context.departureAt) > now + 60_000) throw new Error("expired");
    return p.context;
  } catch { throw new ConditionsError("출발 기준이 만료되었거나 달라졌어요. ‘출발 기준 다시 계산’으로 새로 비교해주세요."); }
}

export async function calculateTransit(origin: Origin, places: Place[], session: string, ip: string,
  deps: { command?: typeof redisCommand; fetcher?: typeof fetch; now?: number; apiKey?: string; billingMode?: "free" | "paid" } = {}): Promise<TransitBundle> {
  const key = deps.apiKey ?? process.env.TMAP_API_KEY?.trim();
  if (!key) throw new TransitError("TMAP 연결 설정을 준비 중이에요. 출발지는 유지되며 ‘도착시각 직접 입력’으로 비교·길찾기를 이용할 수 있어요.");
  if (!places.length || places.length > 5) throw new ConditionsError("비교할 공원을 1~5곳 선택해주세요.");
  const now = deps.now ?? Date.now(), command = deps.command ?? redisCommand;
  const identity = callIdentity(session, JSON.stringify({ origin, places: places.map(p => [p.id, p.accessPoint]).sort() }), "transit");
  const cacheKey = `${PREFIX}cache:${identity}`, lockKey = `${PREFIX}lock:${identity}`;
  const cached = await command(["GET", cacheKey]);
  if (typeof cached === "string") {
    try { const context = unseal(cached) as TransitContext;
      if (Date.parse(context.expiresAt) > now) return { context, token: transitToken(context, session) };
    } catch { /* Invalid cache never permits a provider call without reservation below. */ }
  }
  if (await command(["SET", lockKey, "pending", "NX", "EX", 30]) !== "OK") throw new TransitError("같은 출발지의 이동시간을 확인하고 있어요. 잠시 후 다시 시도해주세요.");
  try {
    const day = new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
    const paid = (deps.billingMode ?? process.env.TMAP_BILLING_MODE) === "paid";
    const decision = await command(["EVAL", TRANSIT_RESERVE_SCRIPT, 4, `${PREFIX}day:${day}`, `${PREFIX}user:${session}`, `${PREFIX}ip:${ip}`, `${PREFIX}reserved-krw`, places.length, paid ? 1000 : 10]);
    if (decision === "uninitialized") throw new TransitError("TMAP 사용량 기록이 아직 준비되지 않아 호출을 멈췄어요.");
    if (decision !== "ok") throw new TransitError(decision === "budget" ? "TMAP 개발·검수 총 예산 5,000원 한도에 도달해 계산을 멈췄어요. 도착시각 직접 입력과 지도 길찾기는 이용할 수 있어요." : decision === "quota" ? `TMAP 일일 호출 한도(${paid ? 1000 : 10}건)에 도달했어요. 출발지를 유지한 채 ‘도착시각 직접 입력’으로 비교하고 지도 앱에서 상세 경로를 확인할 수 있어요.` : "이동시간 요청이 많아요. 잠시 후 다시 시도해주세요.");
    const responses = await Promise.allSettled(places.map(p => requestTransit(origin, p, now, key, deps.fetcher)));
    const context: TransitContext = { origin, departureAt: new Date(now).toISOString(), expiresAt: new Date(now + 5 * 60_000).toISOString(), routes: [], unavailable: [] };
    responses.forEach((r, i) => {
      if (r.status === "fulfilled") context.routes.push(r.value);
      else context.unavailable.push({ placeId: places[i].id, reason: r.reason instanceof TransitError ? r.reason.message : "이동시간을 확인하지 못했어요." });
    });
    // Includes failed outcomes to prevent retry storms. Cache is private, encrypted, and < 24h.
    await command(["SET", cacheKey, seal(context), "EX", 180]);
    return { context, token: transitToken(context, session) };
  } finally { await command(["DEL", lockKey]).catch(() => undefined); }
}
