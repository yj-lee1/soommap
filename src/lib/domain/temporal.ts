import type { AlignmentGap, ArrivalAlignment, CongestionLevel, ForecastEvidence, ForecastTrend, Snapshot, VisitAssessment } from "./types.ts";

// Product policy, not an assertion that the provider guarantees hourly coverage.
export const MAX_ALIGNMENT_GAP_MINUTES = 60;
export const congestionOrder: Record<CongestionLevel, number> = { "여유": 0, "보통": 1, "약간 붐빔": 2, "붐빔": 3 };

function series(snapshot: Snapshot): ForecastEvidence[] {
  return snapshot.forecasts.map(p => ({ ...p, populationRange: p.populationRange ? { ...p.populationRange } : undefined,
    id: `${snapshot.id}#forecast:${p.at}` })).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
function trend(points: ForecastEvidence[]): ForecastTrend {
  if (!points.length) return "unknown";
  let rising = false, falling = false;
  for (let i = 1; i < points.length; i++) {
    const change = congestionOrder[points[i].congestion] - congestionOrder[points[i - 1].congestion];
    rising ||= change > 0; falling ||= change < 0;
  }
  return rising && falling ? "mixed" : rising ? "rising" : falling ? "falling" : "same";
}
function validRange(point: ForecastEvidence) {
  const r = point.populationRange;
  return r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.min >= 0 && r.max >= r.min ? r : null;
}

function align(points: ForecastEvidence[], at: string): ArrivalAlignment {
  const ms = Date.parse(at);
  const unavailable = (gap: AlignmentGap): ArrivalAlignment => ({ at, kind: "unavailable", evidence: [], trend: "unknown", gap, population: null });
  if (!points.length || !Number.isFinite(ms)) return unavailable("no-forecast");
  const exact = points.find(p => Date.parse(p.at) === ms);
  if (exact) {
    const r = validRange(exact);
    return { at, kind: "exact", evidence: [exact], trend: "same", gap: null,
      population: r ? { kind: "official", ...r, weight: null } : null };
  }
  const upperIndex = points.findIndex(p => Date.parse(p.at) > ms);
  if (upperIndex === 0) return unavailable("before-range");
  if (upperIndex < 0) return unavailable("after-range");
  const left = points[upperIndex - 1], right = points[upperIndex];
  const span = Date.parse(right.at) - Date.parse(left.at);
  if (span > MAX_ALIGNMENT_GAP_MINUTES * 60_000 || span <= 0) return unavailable("wide-gap");
  const weight = (ms - Date.parse(left.at)) / span;
  const lowerRange = validRange(left), upperRange = validRange(right);
  return { at, kind: "between", evidence: [left, right], trend: trend([left, right]), gap: null,
    population: lowerRange && upperRange ? { kind: "linear-estimate", weight,
      min: lowerRange.min * (1 - weight) + upperRange.min * weight,
      max: lowerRange.max * (1 - weight) + upperRange.max * weight } : null };
}

/** Uses a single normalized snapshot. Does not mix observations, snapshots, places or model outputs. */
export function alignArrival(snapshot: Snapshot, at: string): ArrivalAlignment {
  return align(series(snapshot), at);
}

/** Assess the closed visit interval and every supplied sample inside it.
 * Complete means bracketed by samples with gaps <= policy, not continuous observation.
 * Population interpolation is deliberately absent from preference/ranking decisions.
 */
export function assessVisit(snapshot: Snapshot, startAt: string, durationMinutes: number | null,
  maximum: CongestionLevel): VisitAssessment {
  const points = series(snapshot), startMs = Date.parse(startAt);
  const endMs = startMs + (durationMinutes ?? 0) * 60_000, endAt = new Date(endMs).toISOString();
  const scope = durationMinutes === null ? "arrival" : "stay";
  const evidence = new Map<string, ForecastEvidence>();
  const gaps: VisitAssessment["gaps"] = [];
  const add = (p: ForecastEvidence) => evidence.set(p.id, p);
  const inside = points.filter(p => Date.parse(p.at) >= startMs && Date.parse(p.at) <= endMs);
  inside.forEach(add);
  if (startMs === endMs) {
    const arrival = align(points, startAt);
    arrival.evidence.forEach(add);
    if (arrival.gap) gaps.push({ startAt, endAt, reason: arrival.gap });
  } else {
    // Splitting at every sample catches an interior peak even when the endpoints match.
    const cuts = [...new Set([startMs, ...inside.map(p => Date.parse(p.at)), endMs])].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const segment = align(points, new Date((cuts[i - 1] + cuts[i]) / 2).toISOString());
      segment.evidence.forEach(add);
      if (segment.gap) gaps.push({ startAt: new Date(cuts[i - 1]).toISOString(), endAt: new Date(cuts[i]).toISOString(), reason: segment.gap });
    }
  }
  const samples = [...evidence.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const coverage = !gaps.length ? "complete" : samples.length ? "partial" : "unavailable";
  const exceeds = (p: ForecastEvidence) => congestionOrder[p.congestion] > congestionOrder[maximum];
  let preference: VisitAssessment["preference"] = "unknown";
  if (coverage === "complete" && samples.length) {
    if (inside.some(exceeds) || samples.every(exceeds)) preference = "exceeds";
    else if (samples.some(exceeds)) preference = "uncertain";
    else preference = "supported";
  }
  const worst = samples.reduce<CongestionLevel | null>((value, p) => value === null || congestionOrder[p.congestion] > congestionOrder[value] ? p.congestion : value, null);
  return { scope, startAt, endAt, coverage, evidence: samples, gaps,
    trend: coverage === "complete" ? trend(samples) : "unknown", worstSampledCongestion: worst, preference };
}
