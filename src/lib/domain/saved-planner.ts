import { parseConditions } from "./conditions.ts";
import { parseOrigin, type Origin } from "./mobility.ts";
import { effectiveConditions, type Replanning } from "./replanning.ts";
import { parseChoice } from "./selection.ts";
import type { ManualDraft } from "./manual.ts";
import type { Conditions, Place } from "./types.ts";

export const PLANNER_STORAGE_KEY = "soommap.planner.v1";
export const SAVED_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export interface SavedChoice {
  choice: { placeId: string; arrivalAt: string };
  conditions: Conditions;
  confirmedAt: string | null;
}
export interface SavedPlanner {
  version: 1;
  savedAt: string;
  draft: ManualDraft;
  text: string;
  origin: Origin | null;
  automatic: boolean;
  replanning: Replanning | null;
  selection: SavedChoice | null;
}
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("invalid_saved_state");
  return v as Record<string, unknown>;
};
const boolean = (v: unknown) => { if (typeof v !== "boolean") throw new Error("invalid_boolean"); return v; };
const string = (v: unknown, max: number) => { if (typeof v !== "string" || v.length > max) throw new Error("invalid_string"); return v; };
const instant = (v: unknown) => { const s = string(v, 30); if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s) throw new Error("invalid_time"); return s; };

/** Treat browser storage as untrusted. Rebuild an allowlist; never persist provider responses or tokens. */
export function parseSavedPlanner(value: unknown, places: Place[], now: number): SavedPlanner {
  const v = record(value);
  if (v.version !== 1) throw new Error("unsupported_saved_version");
  const savedAt = instant(v.savedAt), age = now - Date.parse(savedAt);
  if (age < -60_000 || age > SAVED_MAX_AGE_MS) throw new Error("expired_saved_state");
  const ids = new Set(places.map(p => p.id));
  const id = (v: unknown): string => { const s = string(v, 80); if (!ids.has(s)) throw new Error("unknown_place"); return s; };
  const list = (v: unknown): string[] => {
    if (!Array.isArray(v) || v.length > ids.size) throw new Error("invalid_places");
    const values = v.map(id); if (new Set(values).size !== values.length) throw new Error("duplicate_places"); return values;
  };
  const d = record(v.draft);
  // Drafts may be incomplete (e.g. an empty date field); full conditions are validated only on compare.
  const time = (v: unknown) => { const s = string(v, 16); if (s && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) throw new Error("invalid_draft_time"); return s; };
  const duration = string(d.duration, 4);
  if (duration && !/^\d{1,4}$/.test(duration)) throw new Error("invalid_duration");
  if (!["fixed", "later-60", "later-120", "custom"].includes(String(d.timeMode)) ||
      !["여유", "보통", "약간 붐빔", "붐빔"].includes(String(d.maximumCongestion)) ||
      !["minimum-change", "less-crowded"].includes(String(d.ranking))) throw new Error("invalid_draft_enum");
  const draft: ManualDraft = { placeId: d.placeId === "" ? "" : id(d.placeId), arrival: time(d.arrival), duration,
    allowPlaceChange: boolean(d.allowPlaceChange), allowedPlaceIds: list(d.allowedPlaceIds), excludedPlaceIds: list(d.excludedPlaceIds ?? []),
    timeMode: d.timeMode as ManualDraft["timeMode"], windowStart: time(d.windowStart), windowEnd: time(d.windowEnd),
    maximumCongestion: d.maximumCongestion as ManualDraft["maximumCongestion"], ranking: d.ranking as ManualDraft["ranking"],
    allowDelayedForecasts: boolean(d.allowDelayedForecasts) };
  let replanning: Replanning | null = null;
  if (v.replanning !== null) {
    const r = record(v.replanning);
    replanning = { base: parseConditions(r.base, places), placePin: r.placePin === null ? null : id(r.placePin),
      timePin: r.timePin === null ? null : instant(r.timePin), excludedPlaceIds: list(r.excludedPlaceIds), laterOnly: boolean(r.laterOnly) };
    effectiveConditions(replanning, 0, places);
  }
  let selection: SavedChoice | null = null;
  if (v.selection !== null) {
    const s = record(v.selection);
    selection = { choice: parseChoice(s.choice, places), conditions: parseConditions(s.conditions, places),
      confirmedAt: s.confirmedAt === null ? null : instant(s.confirmedAt) };
  }
  return { version: 1, savedAt, draft, text: string(v.text, 1200), origin: v.origin === null ? null : parseOrigin(v.origin),
    automatic: boolean(v.automatic), replanning, selection };
}

export function readSavedPlanner(storage: Pick<Storage, "getItem" | "removeItem">, places: Place[], now: number) {
  let raw: string | null;
  try { raw = storage.getItem(PLANNER_STORAGE_KEY); } catch { return { state: null, status: "unavailable" as const }; }
  if (!raw) return { state: null, status: "empty" as const };
  try {
    if (raw.length > 40_000) throw new Error("oversize_saved_state");
    return { state: parseSavedPlanner(JSON.parse(raw), places, now), status: "restored" as const };
  } catch {
    try { storage.removeItem(PLANNER_STORAGE_KEY); } catch { /* Keep the working form available. */ }
    return { state: null, status: "discarded" as const };
  }
}
