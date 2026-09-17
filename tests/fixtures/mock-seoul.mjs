// Run only via Node --import for a local fixture server. Never imported by app code.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
const prefix = process.env.FIXTURE_STATE_PREFIX;
if (!prefix || !process.env.DATA_CACHE_NAMESPACE?.startsWith("fixture-")) throw new Error("isolated_fixture_config_required");
const sample = JSON.parse(readFileSync(new URL("./seoul-population.json", import.meta.url), "utf8"));
const places = JSON.parse(readFileSync(new URL("../../src/lib/data/places.json", import.meta.url), "utf8"));
const toKst = ms => new Date(ms + 9 * 60 * 60_000).toISOString().slice(0, 16).replace("T", " ");
writeFileSync(prefix + ".calls", "");
const redis = new Map();
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  const state = JSON.parse(readFileSync(prefix + ".json", "utf8"));
  if (state.ai && url.hostname === "fixture.upstash.io") {
    const command = JSON.parse(options.body);
    if (command[0] === "GET") return Response.json({ result: redis.get(command[1]) ?? null });
    if (command[0] === "SET") {
      if (command.includes("NX") && redis.has(command[1])) return Response.json({ result: null });
      redis.set(command[1], command[2]); return Response.json({ result: "OK" });
    }
    if (command[0] === "DEL") return Response.json({ result: redis.delete(command[1]) ? 1 : 0 });
    // UI smoke only; actual atomic Lua is tested against isolated real Redis keys.
    if (command[0] === "EVAL") return Response.json({ result: command[1].includes("5000 then") ? (state.transitQuota ? "quota" : "ok") : [command[1].includes("local cap") ? "reserved" : "settled", "50000"] });
    throw new Error("unexpected_fixture_redis_command");
  }
  if (state.transit && url.hostname === "apis.openapi.sk.com") {
    appendFileSync(prefix + ".calls", "transit\n");
    if (state.transitDelayMs) await new Promise(resolve => setTimeout(resolve, Math.min(state.transitDelayMs, 3000)));
    if (state.transitFail) return Response.json({ result: { status: 14 } });
    const body = JSON.parse(options.body);
    const index = places.findIndex(p => String(p.accessPoint.coordinate.longitude) === body.endX);
    return Response.json({ metaData: { plan: { itineraries: [{ pathType: 3, totalTime: (state.transitMinutes ?? 70) * 60 + index * 120, totalWalkTime: 600, transferCount: 1 }] } } });
  }
  if (state.ai && url.hostname === "api.openai.com") {
    const body = JSON.parse(options.body), name = body.text.format.name;
    appendFileSync(prefix + ".calls", name + "\n");
    if (state.aiDelayMs) await new Promise(resolve => setTimeout(resolve, Math.min(state.aiDelayMs, 3000)));
    if (state.aiFail || name === "recommendation_evidence" && state.explainFail) throw new Error("fixture_ai_failure");
    const output = name === "outing_conditions" ? state.interpretation : { factIds: ["reason", "stay"] };
    return Response.json({ status: "completed", usage: { input_tokens: 100, output_tokens: 20 },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] });
  }
  if (url.hostname !== "openapi.seoul.go.kr") throw new Error("fixture_external_network_forbidden");
  const areaCode = url.pathname.split("/").at(-1);
  appendFileSync(prefix + ".calls", areaCode + "\n");
  if (state.delayMs) await new Promise(resolve => setTimeout(resolve, Math.min(state.delayMs, 1000)));
  if (state.failAll || state.failCode === areaCode) throw new Error("fixture_provider_failure");
  const place = places.find(p => p.source.areaCode === areaCode);
  if (!place) return Response.json({ RESULT: { "RESULT.CODE": "INFO-200" } });
  const body = structuredClone(sample), row = body["SeoulRtd.citydata_ppltn"][0];
  row.AREA_CD = areaCode; row.AREA_NM = place.name;
  const now = Date.now();
  row.PPLTN_TIME = toKst(now - (state.sourceAgeMinutes ?? 5) * 60_000);
  const firstForecast = Math.ceil((now + 60_000) / 3_600_000) * 3_600_000;
  row.FCST_PPLTN = row.FCST_PPLTN.map((p, i) => ({ ...p, FCST_TIME: toKst(firstForecast + i * 3_600_000),
    ...(state.planningScenario ? { FCST_CONGEST_LVL: areaCode === "POI105" ? (i === 0 ? "붐빔" : i === 1 ? "보통" : "여유") : (i === 0 ? "보통" : "여유") } : {}),
    ...(state.temporalScenario ? { FCST_CONGEST_LVL: areaCode === "POI105" ? (i === 0 ? "보통" : i === 1 ? "약간 붐빔" : "붐빔") : "보통",
      FCST_PPLTN_MIN: String(14_000 + i * 4_000), FCST_PPLTN_MAX: String(16_000 + i * 5_000) } : {}),
    ...(state.overrideCongestion ? { FCST_CONGEST_LVL: state.overrideCongestion } : {}) }));
  return Response.json(body);
};
