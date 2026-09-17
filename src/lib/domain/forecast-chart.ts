import type { ForecastPoint } from "./types.ts";

/** Only supplied timestamps. Ordinal rows do not imply numerical distances or interpolation. */
export function forecastChart(points: ForecastPoint[], startAt: string, hours = 12) {
  const start = Date.parse(startAt), end = start + hours * 3_600_000;
  const samples = points.filter(p => Date.parse(p.at) >= start && Date.parse(p.at) <= end).sort((a, b) => a.at.localeCompare(b.at));
  const gaps = samples.flatMap((p, i) => i && Date.parse(p.at) - Date.parse(samples[i - 1].at) > 3_600_000
    ? [{ startAt: samples[i - 1].at, endAt: p.at }] : []);
  return { samples, gaps, start, end, position: (at: string) => (Date.parse(at) - start) / (end - start) };
}
