import "server-only";
import type { Place, Snapshot } from "../../domain/types.ts";
import { normalizeSeoulPopulation } from "../../data/normalize.ts";
import { DATA_POLICY } from "../../data/quality.ts";

export async function requestSeoulPopulation(
  place: Place, config: { apiKey?: string; baseUrl: string },
  fetcher: typeof fetch = fetch, clock: () => Date = () => new Date(),
): Promise<Snapshot> {
  if (!config.apiKey) throw new Error("seoul_not_configured");
  try {
    const base = new URL(config.baseUrl);
    if (base.hostname !== "openapi.seoul.go.kr" || base.username || base.password ||
      base.search || base.hash || base.pathname !== "/" ||
      !["http:", "https:"].includes(base.protocol) || !["", "8088", "443"].includes(base.port)) {
      throw new Error("invalid_origin");
    }
    // Only catalog places reach this function; no arbitrary user URL or name.
    const url = new URL(`/${encodeURIComponent(config.apiKey)}/json/citydata_ppltn/1/1/${encodeURIComponent(place.source.areaCode)}`, base);
    const response = await fetcher(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(DATA_POLICY.requestTimeoutMs) });
    if (!response.ok) throw new Error("provider_http_error");
    const text = await response.text();
    if (text.length > 512_000) throw new Error("provider_response_too_large");
    return normalizeSeoulPopulation(JSON.parse(text), place, clock().toISOString());
  } catch {
    // Both URL and nested error causes can contain the key. Throw only a fixed message.
    throw new Error("seoul_data_unavailable");
  }
}
