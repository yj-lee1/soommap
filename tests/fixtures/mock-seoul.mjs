// Run only via Node --import for a local fixture server. Never imported by app code.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
const prefix = process.env.FIXTURE_STATE_PREFIX;
if (!prefix || !process.env.DATA_CACHE_NAMESPACE?.startsWith("fixture-")) throw new Error("isolated_fixture_config_required");
const sample = JSON.parse(readFileSync(new URL("./seoul-population.json", import.meta.url), "utf8"));
const places = JSON.parse(readFileSync(new URL("../../src/lib/data/places.json", import.meta.url), "utf8"));
const toKst = ms => new Date(ms + 9 * 60 * 60_000).toISOString().slice(0, 16).replace("T", " ");
writeFileSync(prefix + ".calls", "");
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname !== "openapi.seoul.go.kr") throw new Error("fixture_external_network_forbidden");
  const areaCode = url.pathname.split("/").at(-1);
  appendFileSync(prefix + ".calls", areaCode + "\n");
  const state = JSON.parse(readFileSync(prefix + ".json", "utf8"));
  if (state.failAll || state.failCode === areaCode) throw new Error("fixture_provider_failure");
  const place = places.find(p => p.source.areaCode === areaCode);
  if (!place) return Response.json({ RESULT: { "RESULT.CODE": "INFO-200" } });
  const body = structuredClone(sample), row = body["SeoulRtd.citydata_ppltn"][0];
  row.AREA_CD = areaCode; row.AREA_NM = place.name;
  const now = Date.now();
  row.PPLTN_TIME = toKst(now - 5 * 60_000);
  row.FCST_PPLTN = row.FCST_PPLTN.map((p, i) => ({ ...p, FCST_TIME: toKst(now + (i + 1) * 60 * 60_000) }));
  return Response.json(body);
};
