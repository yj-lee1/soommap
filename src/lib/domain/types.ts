/** Shared product contracts, independent of hosting and API response formats. */
export type PlaceId = string;
export type IsoDateTime = string;
export type CongestionLevel = "여유" | "보통" | "약간 붐빔" | "붐빔";
export type Activity = "walk";
export type PlaceSetting = "riverside" | "park";

export interface Place {
  id: PlaceId;
  name: string;
  source: { provider: "seoul-city"; areaCode: string };
  groupIds: string[];
  activities: Activity[];
  settings: PlaceSetting[];
  displayCoordinate: { latitude: number; longitude: number };
  accessPoint: { id: string; name: string; coordinate: { latitude: number; longitude: number }; sourceUrl: string; verifiedAt: string };
  boundaryRef: string;
  enabled: boolean;
}

export interface ForecastPoint {
  at: IsoDateTime;
  congestion: CongestionLevel;
  populationRange?: { min: number; max: number };
}

export interface ForecastEvidence extends ForecastPoint { id: string }
export type ForecastTrend = "same" | "rising" | "falling" | "mixed" | "unknown";
export type AlignmentGap = "no-forecast" | "before-range" | "after-range" | "wide-gap";
export interface ArrivalAlignment {
  at: IsoDateTime;
  kind: "exact" | "between" | "unavailable";
  evidence: ForecastEvidence[];
  trend: ForecastTrend;
  gap: AlignmentGap | null;
  population: {
    kind: "official" | "linear-estimate";
    min: number;
    max: number;
    weight: number | null;
  } | null;
}
export interface VisitAssessment {
  scope: "arrival" | "stay";
  startAt: IsoDateTime;
  endAt: IsoDateTime;
  coverage: "complete" | "partial" | "unavailable";
  evidence: ForecastEvidence[];
  gaps: Array<{ startAt: IsoDateTime; endAt: IsoDateTime; reason: AlignmentGap }>;
  trend: ForecastTrend;
  // An ordinal comparison of supplied samples, never an interpolated category.
  worstSampledCongestion: CongestionLevel | null;
  preference: "supported" | "uncertain" | "exceeds" | "unknown";
}

export interface Snapshot {
  id: string;
  placeId: PlaceId;
  sourceUpdatedAt: IsoDateTime;
  fetchedAt: IsoDateTime;
  observation: {
    congestion: CongestionLevel;
    populationRange?: { min: number; max: number };
  } | null;
  isReplacement: boolean | null;
  forecastAvailable: boolean;
  forecasts: ForecastPoint[];
  issues: string[];
}

export interface PlanReference {
  placeId: PlaceId | null;
  preferredArrivalAt: IsoDateTime | null;
  durationMinutes: number | null;
}

export interface ArrivalWindow {
  timeZone: "Asia/Seoul";
  localDate: string;
  notBefore: IsoDateTime | null;
  notAfter: IsoDateTime | null;
}

export interface Conditions {
  revision: number;
  activity: Activity;
  originalPlan: PlanReference;
  hard: {
    requiredSettings: PlaceSetting[];
    // null = permission unresolved; [] = no permitted candidates.
    allowedPlaceIds: PlaceId[] | null;
    excludedPlaceIds: PlaceId[];
    arrivalWindow: ArrivalWindow;
    pinnedPlaceId: PlaceId | null;
    pinnedArrivalAt: IsoDateTime | null;
  };
  soft: {
    maximumPreferredCongestion: CongestionLevel;
    ranking: "minimum-change" | "less-crowded";
  };
  dataPolicy: { allowDelayedForecasts: boolean };
}

export interface Candidate {
  travel?: import("./mobility.ts").TransitRoute & { departureAt: string; expiresAt: string };
  id: string;
  placeId: PlaceId;
  arrivalAt: IsoDateTime;
  arrival: ArrivalAlignment;
  visit: VisitAssessment;
  snapshotId: string;
  evidenceIds: string[];
  sourceUpdatedAt: IsoDateTime;
  fetchedAt: IsoDateTime;
  dataConfidence: "fresh" | "delayed" | "blocked";
  meetsPreference: boolean;
  change: {
    placeChanged: boolean | null;
    arrivalDeltaMinutes: number | null;
  };
}

export interface Recommendation {
  checkedAt: IsoDateTime;
  conditionsRevision: number;
  snapshotIds: string[];
  status: "ready" | "preference-uncertain" | "preference-unmet" | "needs-clarification" | "no-candidates" | "data-unavailable" | "forecast-unavailable";
  message: string;
  recommendedCandidateId: string | null;
  alternativeCandidateIds: string[];
  candidates: Candidate[];
  explanation: { reason: string; tradeoff: string; evidenceIds: string[] } | null;
  limitations: string[];
  options: Array<{
    role: "recommended" | "alternative" | "original";
    candidate: Candidate | null;
    eligible: boolean;
    reasons: string[];
  }>;
  excludedPlaces: Array<{ placeId: PlaceId; reasons: string[] }>;
  availableForecastTimes: IsoDateTime[];
  eligibleCount: number;
}
