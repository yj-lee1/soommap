import { cookies } from "next/headers";
import { AI_COOKIE, sessionHash } from "@/lib/server/ai-session";
import { readTransitToken } from "@/lib/server/transit";
import { enabledPlaces } from "@/lib/data/catalog";
import { ConditionsError, parseConditions } from "@/lib/domain/conditions";
import { parseChoice } from "@/lib/domain/selection";
import { checkChoice } from "@/lib/domain/recommend";
import { readJson } from "@/lib/server/read-json";
import { getPopulationOverview } from "@/lib/server/population";

export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  try {
    const input = await readJson(request);
    if (!input || typeof input !== "object" || !("conditions" in input) || !("choice" in input)) throw new ConditionsError("선택할 계획이 필요해요.");
    const conditions = parseConditions(input.conditions, enabledPlaces), choice = parseChoice(input.choice, enabledPlaces);
    const transit = readTransitToken("transitToken" in input ? input.transitToken : undefined, "transitToken" in input && input.transitToken ? sessionHash((await cookies()).get(AI_COOKIE)?.value) : null);
    const overview = await getPopulationOverview();
    return json(checkChoice(conditions, choice, enabledPlaces, overview.rows.flatMap(row => row.snapshot ? [row.snapshot] : []), Date.parse(overview.checkedAt), transit));
  } catch (error) {
    if (error instanceof ConditionsError) return json({ error: error.message }, 400);
    return json({ error: "선택한 계획의 자료를 확인하지 못했어요. 선택을 유지했으니 다시 확인해주세요." }, 503);
  }
}
