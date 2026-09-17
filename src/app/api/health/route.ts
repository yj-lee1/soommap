export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      status: "ok",
      service: "soommap",
    stage: "recommendation-engine",
      checkedAt: new Date().toISOString(),
      integrationsVerified: false,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
