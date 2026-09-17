import "server-only";
import { unstable_cache } from "next/cache";
import { connection } from "next/server";
import { enabledPlaces, getPlace } from "../data/catalog";
import { assessSnapshot, commonForecastTimes } from "../data/quality";
import { createRequestGate } from "../data/request-gate";
import type { Snapshot } from "../domain/types";
import { getServerConfig } from "./config";
import { requestSeoulPopulation } from "./integrations/seoul-population";

const requestGate = createRequestGate<Snapshot>();
const cacheConfig = getServerConfig().cache;
// Cache contains public normalized snapshots only. No key or private user input
// is used in cache arguments, tags, or returned data. Next retains the last good
// result if revalidation throws. Its serverless adapter awaits bounded revalidation.
async function loadSnapshot(placeId: string) {
  const place = getPlace(placeId);
  if (!place) throw new Error("unsupported_place");
  return requestGate(placeId, () => requestSeoulPopulation(place, getServerConfig().seoul));
}
// Next includes function.toString() in its cache key. A bound callable has a
// stable representation across separately minified page/API bundles. Identity
// is deliberately defined by namespace + schema version + public placeId args.
const cachedSnapshot = unstable_cache(loadSnapshot.bind(null),
  [cacheConfig.namespace, "population-normalized-v1"], { revalidate: cacheConfig.revalidateSeconds });

export async function getPopulationOverview() {
  // Render per request without force-dynamic's force-no-store override, so the
  // explicitly cached provider operation keeps its shared-cache semantics.
  await connection();
  const results = await Promise.allSettled(enabledPlaces.map(async place => {
    const snapshot = await cachedSnapshot(place.id);
    if (Date.now() - Date.parse(snapshot.fetchedAt) > cacheConfig.revalidateSeconds * 1000) {
      // Next normally returns the stale value before its revalidation completes.
      // For a decision, await that SAME bounded operation so a first visitor
      // after idle time does not get a needless "data unavailable" result.
      const refreshing = requestGate.existing(place.id);
      if (refreshing) {
        try { return await refreshing; } catch { /* Keep the last normal snapshot. */ }
      }
    }
    return snapshot;
  }));
  const checkedAt = new Date().toISOString();
  const nowMs = Date.parse(checkedAt);
  const rows = results.map((result, index) => {
    const place = enabledPlaces[index];
    if (result.status === "rejected") return { place, snapshot: null, quality: null };
    return { place, snapshot: result.value, quality: assessSnapshot(result.value, nowMs) };
  });
  const snapshots = rows.flatMap(row => row.snapshot ? [row.snapshot] : []);
  return {
    checkedAt, source: "서울특별시 실시간 인구데이터", rows,
    availableCount: snapshots.length,
    commonForecastTimes: snapshots.length === enabledPlaces.length ? commonForecastTimes(snapshots, nowMs) : [],
    comparisonReady: rows.every(row => row.quality?.usableForRecommendation) &&
      commonForecastTimes(snapshots, nowMs).length > 0,
  };
}

export type PopulationOverview = Awaited<ReturnType<typeof getPopulationOverview>>;
