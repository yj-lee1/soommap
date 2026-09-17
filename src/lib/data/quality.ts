import type { Snapshot } from "../domain/types.ts";

export const DATA_POLICY = { revalidateSeconds: 300, requestTimeoutMs: 8_000,
  freshMinutes: 30, displayMaxMinutes: 60, cacheGraceMinutes: 10 } as const;

export function assessSnapshot(snapshot: Snapshot, nowMs: number) {
  const sourceAgeMinutes = Math.max(0, (nowMs - Date.parse(snapshot.sourceUpdatedAt)) / 60_000);
  const cacheAgeMinutes = Math.max(0, (nowMs - Date.parse(snapshot.fetchedAt)) / 60_000);
  const freshness = sourceAgeMinutes <= DATA_POLICY.freshMinutes ? "fresh" :
    sourceAgeMinutes <= DATA_POLICY.displayMaxMinutes ? "delayed" : "stale";
  const futureForecasts = snapshot.forecasts.filter(point => Date.parse(point.at) >= nowMs);
  const refreshOverdue = cacheAgeMinutes > DATA_POLICY.cacheGraceMinutes;
  return { freshness, sourceAgeMinutes: Math.floor(sourceAgeMinutes), cacheAgeMinutes: Math.floor(cacheAgeMinutes),
    refreshOverdue, futureForecasts,
    usableForRecommendation: freshness === "fresh" && !refreshOverdue && snapshot.isReplacement === false && futureForecasts.length > 0,
  };
}

// Observation freshness and permission to compare provided future estimates are
// separate. Delayed estimates require explicit user opt-in; never call them live.
export function forecastUse(snapshot: Snapshot, nowMs: number): "fresh" | "delayed" | "blocked" {
  const quality = assessSnapshot(snapshot, nowMs);
  if (quality.refreshOverdue || quality.freshness === "stale" || snapshot.isReplacement !== false ||
    !snapshot.forecastAvailable || !quality.futureForecasts.length) return "blocked";
  return quality.freshness === "fresh" ? "fresh" : "delayed";
}

export function commonForecastTimes(snapshots: Snapshot[], nowMs: number): string[] {
  if (!snapshots.length) return [];
  const sets = snapshots.map(snapshot => new Set(assessSnapshot(snapshot, nowMs).futureForecasts.map(p => p.at)));
  return [...sets[0]].filter(at => sets.every(set => set.has(at))).sort();
}
