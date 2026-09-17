import { cookies } from "next/headers";
import { AI_COOKIE, sessionHash } from "@/lib/server/ai-session";
import { readTransitToken } from "@/lib/server/transit";
import { enabledPlaces } from "@/lib/data/catalog";
import { ConditionsError, parseConditions } from "@/lib/domain/conditions";
import { recommend } from "@/lib/domain/recommend";
import { readJson } from "@/lib/server/read-json";
import { getPopulationOverview } from "@/lib/server/population";

export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  try {
    // Reject invalid conditions before fetching. User input is never cached or logged.
    const input = await readJson(request) as Record<string, unknown>;
    const conditions = parseConditions(input?.conditions ?? input, enabledPlaces);
    const transit = readTransitToken(input?.transitToken, input?.transitToken ? sessionHash((await cookies()).get(AI_COOKIE)?.value) : null);
    const overview = await getPopulationOverview();
    const snapshots = overview.rows.flatMap(row => row.snapshot ? [row.snapshot] : []);
    return json({ conditions, result: recommend(conditions, enabledPlaces, snapshots, Date.parse(overview.checkedAt), transit) });
  } catch (error) {
    if (error instanceof ConditionsError) return json({ error: error.message }, 400);
    return json({ error: "비교 결과를 가져오지 못했어요. 입력은 유지되니 다시 시도해주세요." }, 503);
  }
}
