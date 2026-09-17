import { getPopulationOverview } from "@/lib/server/population";

export const runtime = "nodejs";

export async function GET() {
  const overview = await getPopulationOverview();
  return Response.json(overview, {
    status: overview.availableCount ? 200 : 503,
    // Public data only. Freshness is evaluated by source time; do not let CDN
    // hide changing quality labels. Upstream calls still use the shared data cache.
    headers: { "Cache-Control": "no-store" },
  });
}
