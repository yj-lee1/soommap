"""Extract the five official WGS84 boundaries. Dev-only: pyshp and shapely."""
import io
import json
import sys
import zipfile
from pathlib import Path

import shapefile
from shapely.geometry import shape

NAMES = {
    "POI105": ("yeouido", "여의도한강공원"),
    "POI095": ("banpo", "반포한강공원"),
    "POI093": ("ttukseom", "뚝섬한강공원"),
    "POI094": ("mangwon", "망원한강공원"),
    "POI090": ("nanji", "난지한강공원"),
}
with zipfile.ZipFile(sys.argv[1]) as archive:
    projection = archive.read(next(n for n in archive.namelist() if n.endswith(".prj"))).decode()
    if 'GCS_WGS_1984' not in projection:
        raise ValueError("Check coordinate system before conversion")
    parts = {ext: io.BytesIO(archive.read(next(n for n in archive.namelist() if n.endswith('.' + ext))))
             for ext in ["shp", "shx", "dbf"]}
    reader = shapefile.Reader(**parts, encoding="utf-8")
    found = {}
    for item in reader.iterShapeRecords():
        record = item.record.as_dict()
        code = record["AREA_CD"]
        if code not in NAMES:
            continue
        place_id, name = NAMES[code]
        if record["AREA_NM"] != name:
            raise ValueError("Official name mismatch")
        geometry = item.shape.__geo_interface__
        polygon = shape(geometry)
        if not polygon.is_valid:
            raise ValueError("Invalid official geometry")
        point = polygon.representative_point()
        assert polygon.covers(point)
        found[code] = ({"type": "Feature", "id": code,
                       "properties": {"areaCode": code, "name": name, "placeId": place_id},
                       "geometry": geometry},
                      {"id": place_id, "name": name, "source": {"provider": "seoul-city", "areaCode": code},
                       "groupIds": ["hangang_walk"], "activities": ["walk"], "settings": ["riverside", "park"],
                       "displayCoordinate": {"latitude": point.y, "longitude": point.x},
                       "boundaryRef": "/data/hangang-boundaries.geojson#" + code, "enabled": True})
if set(found) != set(NAMES):
    raise ValueError("Expected five verified areas")
Path("public/data/hangang-boundaries.geojson").write_text(json.dumps(
    {"type": "FeatureCollection", "features": [found[code][0] for code in NAMES]}, ensure_ascii=False))
existing_places = {p["id"]: p for p in json.loads(Path("src/lib/data/places.json").read_text())}
for _, place in found.values():
    place["accessPoint"] = existing_places[place["id"]]["accessPoint"]
Path("src/lib/data/places.json").write_text(json.dumps([found[code][1] for code in NAMES], ensure_ascii=False, indent=2) + "\n")
print("Extracted 5 official boundaries and interior display points; no API calls.")
