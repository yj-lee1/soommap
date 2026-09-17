import type { Place } from "../domain/types.ts";
import entries from "./places.json" with { type: "json" };

export const SEOUL_SOURCE_URL = "https://data.seoul.go.kr/dataList/OA-21778/A/1/datasetView.do";
export const places = entries as Place[];
export const enabledPlaces = places.filter(place => place.enabled);

export function getPlace(id: string): Place | undefined {
  return enabledPlaces.find(place => place.id === id);
}
