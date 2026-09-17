export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      status: "ok",
      service: "soommap",
      stage: "setup",
      checkedAt: new Date().toISOString(),
      integrationsVerified: false,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
