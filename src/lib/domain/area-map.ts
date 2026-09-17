export interface AreaFeature {
  type: "Feature";
  properties: { placeId: string; name: string; areaCode: string };
  geometry: { type: "Polygon"; coordinates: number[][][] };
}
export function areaProjection(features: AreaFeature[], width = 720, height = 260) {
  const coordinates = features.flatMap(f => f.geometry.coordinates.flat());
  if (!coordinates.length || coordinates.some(p => p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) throw new Error("invalid_area_geometry");
  const minLat = Math.min(...coordinates.map(p => p[1])), maxLat = Math.max(...coordinates.map(p => p[1]));
  const cosLat = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
  const minLon = Math.min(...coordinates.map(p => p[0])), maxLon = Math.max(...coordinates.map(p => p[0]));
  const scale = Math.min((width - 80) / ((maxLon - minLon) * cosLat || 1), (height - 80) / (maxLat - minLat || 1));
  const centerLon = (minLon + maxLon) / 2, centerLat = (minLat + maxLat) / 2;
  return (longitude: number, latitude: number) => [width / 2 + (longitude - centerLon) * cosLat * scale, height / 2 - (latitude - centerLat) * scale];
}
