import { enabledPlaces } from "@/lib/data/catalog";
import { ConditionsError, parseConditions } from "@/lib/domain/conditions";
import { recommend } from "@/lib/domain/recommend";
import { getPopulationOverview } from "@/lib/server/population";

export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function readConditions(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ConditionsError("JSON 조건이 필요해요.");
  const reader = request.body?.getReader();
  if (!reader) throw new ConditionsError("조건을 입력해주세요.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) { await reader.cancel(); throw new ConditionsError("조건이 너무 길어요."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ConditionsError("조건 형식을 확인해주세요."); }
  return parseConditions(value, enabledPlaces);
}

export async function POST(request: Request) {
  try {
    // Reject invalid conditions before fetching. User input is never cached or logged.
    const conditions = await readConditions(request);
    const overview = await getPopulationOverview();
    const snapshots = overview.rows.flatMap(row => row.snapshot ? [row.snapshot] : []);
    return json({ conditions, result: recommend(conditions, enabledPlaces, snapshots, Date.parse(overview.checkedAt)) });
  } catch (error) {
    if (error instanceof ConditionsError) return json({ error: error.message }, 400);
    return json({ error: "비교 결과를 가져오지 못했어요. 입력은 유지되니 다시 시도해주세요." }, 503);
  }
}
