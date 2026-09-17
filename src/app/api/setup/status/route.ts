import { isSetupAuthorized } from "@/lib/server/setup-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSetupAuthorized(request)) {
    return Response.json({ error: "not_found" }, { status: 404, headers });
  }

  // Only configuration presence is returned. No credential or value is exposed.
  const configured = (name: string) => Boolean(process.env[name]?.trim());
  return Response.json(
    {
      checkedAt: new Date().toISOString(),
      configuration: {
        seoulApiKey: configured("SEOUL_API_KEY"),
        aiProvider: configured("AI_PROVIDER"),
        aiModel: configured("AI_MODEL"),
        aiApiKey: configured("AI_API_KEY"),
      },
      integrationsVerified: false,
      note: "Configuration presence only; no external API was called.",
    },
    { headers },
  );
}
