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
  displayPoint: { latitude: number; longitude: number };
  boundaryRef: string;
  enabled: boolean;
}

export interface ForecastPoint {
  at: IsoDateTime;
  congestion: CongestionLevel;
  populationRange?: { min: number; max: number };
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
}

export interface Candidate {
  id: string;
  placeId: PlaceId;
  arrivalAt: IsoDateTime;
  congestion: CongestionLevel;
  snapshotId: string;
  evidenceIds: string[];
  change: {
    placeChanged: boolean | null;
    arrivalDeltaMinutes: number | null;
  };
}

export interface Recommendation {
  conditionsRevision: number;
  snapshotIds: string[];
  status: "ready" | "needs-clarification" | "no-candidates" | "data-unavailable";
  recommendedCandidateId: string | null;
  alternativeCandidateIds: string[];
  candidates: Candidate[];
  explanation: { reason: string; tradeoff: string; evidenceIds: string[] } | null;
  limitations: string[];
}
