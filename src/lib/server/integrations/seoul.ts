import "server-only";
import { getServerConfig } from "../config";

// Phase 0 connectivity probe only. Product normalization belongs to phase 1.
export async function probeSeoul() {
  const config = getServerConfig().seoul;
  if (!config.apiKey) return { ok: false, reason: "not_configured" };
  try {
    const base = new URL(config.baseUrl);
    if (base.hostname !== "openapi.seoul.go.kr" || base.username || base.password ||
      base.search || base.hash || base.pathname !== "/" ||
      !["http:", "https:"].includes(base.protocol)) {
      return { ok: false, reason: "invalid_provider_origin" };
    }
    const url = new URL(`/${encodeURIComponent(config.apiKey)}/json/citydata_ppltn/1/1/${encodeURIComponent("여의도한강공원")}`, base);
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return { ok: false, reason: "http_error", httpStatus: response.status };
    const body = await response.json();
    const row = body["SeoulRtd.citydata_ppltn"]?.[0];
    if (body.RESULT?.["RESULT.CODE"] !== "INFO-000" || row?.AREA_NM !== "여의도한강공원" ||
      typeof row.PPLTN_TIME !== "string" || typeof row.AREA_CONGEST_LVL !== "string") {
      return { ok: false, reason: "invalid_provider_response" };
    }
    return {
      ok: true, areaName: row.AREA_NM as string, areaCode: row.AREA_CD as string,
      observedAt: row.PPLTN_TIME as string, crowdLevel: row.AREA_CONGEST_LVL as string,
      forecastAvailable: row.FCST_YN === "Y",
      forecastCount: Array.isArray(row.FCST_PPLTN) ? row.FCST_PPLTN.length : 0,
    };
  } catch {
    // Seoul credentials are part of the URL; never log raw fetch errors.
    return { ok: false, reason: "connection_or_parse_error" };
  }
}
