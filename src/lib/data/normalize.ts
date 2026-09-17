import type { CongestionLevel, ForecastPoint, Place, Snapshot } from "../domain/types.ts";
import { parseSeoulTime } from "./time.ts";

const levels: readonly string[] = ["여유", "보통", "약간 붐빔", "붐빔"];
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const level = (value: unknown): CongestionLevel | null =>
  typeof value === "string" && levels.includes(value) ? value as CongestionLevel : null;
function range(min: unknown, max: unknown) {
  const number = (v: unknown) => typeof v === "number" ? v :
    typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  const lower = number(min), upper = number(max);
  return Number.isSafeInteger(lower) && Number.isSafeInteger(upper) && lower >= 0 && upper >= lower
    ? { min: lower, max: upper } : undefined;
}

export class SeoulDataError extends Error {
  readonly code: string;
  constructor(code: "provider_error" | "place_mismatch" | "invalid_timestamp" | "empty_data") {
    super(code); this.name = "SeoulDataError"; this.code = code;
  }
}

export function normalizeSeoulPopulation(payload: unknown, place: Place, fetchedAt: string): Snapshot {
  const root = record(payload), result = record(root.RESULT);
  if (result["RESULT.CODE"] !== "INFO-000") throw new SeoulDataError("provider_error");
  const rows = root["SeoulRtd.citydata_ppltn"];
  if (!Array.isArray(rows) || rows.length !== 1) throw new SeoulDataError("empty_data");
  const row = record(rows[0]);
  if (row.AREA_CD !== place.source.areaCode || row.AREA_NM !== place.name) throw new SeoulDataError("place_mismatch");
  const sourceUpdatedAt = parseSeoulTime(row.PPLTN_TIME);
  const fetchedMs = Date.parse(fetchedAt);
  if (!sourceUpdatedAt || !Number.isFinite(fetchedMs) || Date.parse(sourceUpdatedAt) > fetchedMs + 120_000) {
    throw new SeoulDataError("invalid_timestamp");
  }
  const issues = new Set<string>();
  const current = level(row.AREA_CONGEST_LVL);
  if (!current) issues.add("observation_missing");
  const isReplacement = row.REPLACE_YN === "Y" ? true : row.REPLACE_YN === "N" ? false : null;
  if (isReplacement === true) issues.add("replacement_data");
  if (isReplacement === null) issues.add("replacement_unknown");
  const forecasts = new Map<string, ForecastPoint>();
  const conflicts = new Set<string>();
  if (row.FCST_YN === "Y" && Array.isArray(row.FCST_PPLTN)) {
    for (const raw of row.FCST_PPLTN.slice(0, 48)) {
      const point = record(raw), at = parseSeoulTime(point.FCST_TIME), congestion = level(point.FCST_CONGEST_LVL);
      if (!at || !congestion || Date.parse(at) <= Date.parse(sourceUpdatedAt) || Date.parse(at) > fetchedMs + 24 * 60 * 60 * 1000) {
        issues.add("forecast_partial"); continue;
      }
      const forecast = { at, congestion, populationRange: range(point.FCST_PPLTN_MIN, point.FCST_PPLTN_MAX) };
      const previous = forecasts.get(at);
      if (previous && JSON.stringify(previous) !== JSON.stringify(forecast)) {
        conflicts.add(at); issues.add("forecast_conflict");
      } else forecasts.set(at, forecast);
    }
    for (const at of conflicts) forecasts.delete(at);
  }
  if (row.FCST_YN !== "Y" || forecasts.size === 0) issues.add("forecast_missing");
  if (!current && forecasts.size === 0) throw new SeoulDataError("empty_data");
  return {
    id: `${place.id}:${sourceUpdatedAt}:${fetchedAt}`, placeId: place.id, sourceUpdatedAt, fetchedAt,
    observation: current ? { congestion: current, populationRange: range(row.AREA_PPLTN_MIN, row.AREA_PPLTN_MAX) } : null,
    isReplacement, forecastAvailable: row.FCST_YN === "Y" && forecasts.size > 0,
    forecasts: [...forecasts.values()].sort((a, b) => a.at.localeCompare(b.at)), issues: [...issues],
  };
}
