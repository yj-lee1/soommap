import { cookies } from "next/headers";
import { enabledPlaces } from "@/lib/data/catalog";
import { parseOrigin } from "@/lib/domain/mobility";
import { ConditionsError } from "@/lib/domain/conditions";
import { readJson } from "@/lib/server/read-json";
import { AI_COOKIE, requestIpHash, sessionHash } from "@/lib/server/ai-session";
import { calculateTransit, TransitError } from "@/lib/server/transit";

export const runtime = "nodejs";
export const maxDuration = 30;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== `${new URL(request.url).protocol}//${request.headers.get("host")}`) throw new ConditionsError("같은 숨맵 화면에서 다시 요청해주세요.");
    const session = sessionHash((await cookies()).get(AI_COOKIE)?.value);
    if (!session) return json({ error: "출발지 확인 세션을 먼저 준비해주세요." }, 401);
    const input = await readJson(request) as { origin?: unknown; placeIds?: unknown };
    const origin = parseOrigin(input?.origin);
    if (!Array.isArray(input.placeIds) || !input.placeIds.length || input.placeIds.length > 5 ||
      new Set(input.placeIds).size !== input.placeIds.length || input.placeIds.some(id => !enabledPlaces.some(p => p.id === id))) throw new ConditionsError("비교할 장소를 확인해주세요.");
    return json(await calculateTransit(origin, enabledPlaces.filter(p => (input.placeIds as string[]).includes(p.id)), session, requestIpHash(request.headers)));
  } catch (e) {
    if (e instanceof ConditionsError) return json({ error: e.message }, 400);
    if (e instanceof TransitError) return json({ error: e.message }, 503);
    return json({ error: "이동시간 사용량 제어를 확인하지 못해 외부 호출을 멈췄어요. 출발지는 유지됩니다." }, 503);
  }
}
