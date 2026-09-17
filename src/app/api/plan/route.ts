import { cookies } from "next/headers";
import { enabledPlaces } from "@/lib/data/catalog";
import { ConditionsError } from "@/lib/domain/conditions";
import { BudgetError, sharedBudgetLedger } from "@/lib/server/ai-budget";
import { planFromText, type AiPlan, type PlanInput } from "@/lib/server/ai-planner";
import { AI_COOKIE, callIdentity, createSession, privateRequestCache, requestIpHash, sessionHash } from "@/lib/server/ai-session";
import { sharedFlowCache } from "@/lib/server/ai-flow-cache";
import { getPopulationOverview } from "@/lib/server/population";

export const runtime = "nodejs";
export const maxDuration = 60;
const cached = privateRequestCache<AiPlan>();
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });

export async function GET(request: Request) {
  try {
    const jar = await cookies();
    if (!sessionHash(jar.get(AI_COOKIE)?.value)) jar.set(AI_COOKIE, createSession(), {
      httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: 7 * 24 * 3600,
    });
    return json({ ready: true });
  } catch { return json({ error: "AI 연결을 준비하지 못했어요. 아래 조건 입력으로 계속 비교할 수 있어요." }, 503); }
}

async function readInput(request: Request): Promise<PlanInput> {
  // Next may normalize request.url to localhost; Host preserves the actual browser origin.
  const origin = request.headers.get("origin"), host = request.headers.get("host");
  const protocol = new URL(request.url).protocol;
  if (!origin || !host || origin !== `${protocol}//${host}`) throw new ConditionsError("같은 숨맵 화면에서 다시 요청해주세요.");
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ConditionsError("JSON 조건이 필요해요.");
  const reader = request.body?.getReader();
  if (!reader) throw new ConditionsError("원하는 외출 계획을 입력해주세요.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) { await reader.cancel(); throw new ConditionsError("요청이 너무 길어요."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ConditionsError("요청 형식을 확인해주세요."); }
  if (!value || typeof value.text !== "string" || !value.text.trim() || value.text.length > 1200 ||
    !Number.isInteger(value.revision) || value.revision < 0 || value.revision > 1_000_000 ||
    typeof value.requestId !== "string" || !/^[a-f0-9-]{36}$/.test(value.requestId) || typeof value.allowDelayedForecasts !== "boolean") {
    throw new ConditionsError("외출 계획은 1~1,200자로 입력해주세요.");
  }
  return { text: value.text.trim(), revision: value.revision, requestId: value.requestId, allowDelayedForecasts: value.allowDelayedForecasts };
}

export async function POST(request: Request) {
  try {
    const input = await readInput(request);
    const session = sessionHash((await cookies()).get(AI_COOKIE)?.value);
    if (!session) return json({ error: "요청 세션을 준비한 뒤 다시 시도해주세요." }, 401);
    const identity = (stage: string) => callIdentity(session, input.requestId, stage);
    const fingerprint = callIdentity(session, JSON.stringify(input), "input");
    const result = await cached(identity("flow"), fingerprint, () => sharedFlowCache(identity("flow"), fingerprint,
      () => planFromText(input, enabledPlaces, Date.now(), session, identity,
      sharedBudgetLedger(requestIpHash(request.headers), identity("flow")), async () => {
        const overview = await getPopulationOverview();
        return { snapshots: overview.rows.flatMap(row => row.snapshot ? [row.snapshot] : []), checkedAt: overview.checkedAt };
      })));
    return json(result);
  } catch (error) {
    if (error instanceof ConditionsError) return json({ error: error.message }, 400);
    if (error instanceof BudgetError) {
      if (error.code === "duplicate") return json({ error: "같은 요청이 이미 처리됐거나 처리 중이에요. 잠시 기다리거나 아래 조건으로 비교해주세요." }, 409);
      if (error.code === "rate-limited") return json({ error: "짧은 시간에 요청이 많아요. 잠시 후 다시 시도하거나 아래 조건으로 비교해주세요." }, 429);
      if (error.code === "exhausted" || error.code === "warning") return json({ error: "개발·검수 AI 예산 한도에 도달했어요. 아래 조건 입력으로 비교할 수 있어요." }, 429);
      return json({ error: "AI 사용량 기록 연결이 준비되지 않아 호출을 멈췄어요. 아래 조건 입력은 사용할 수 있어요." }, 503);
    }
    return json({ error: "AI가 조건을 해석하지 못했어요. 입력은 유지했으니 표현을 구체화하거나 아래에서 조건을 직접 정해주세요." }, 503);
  }
}
