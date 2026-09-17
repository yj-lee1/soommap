import { isSetupAuthorized } from "@/lib/server/setup-auth";
import { getServerConfig } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSetupAuthorized(request)) {
    return Response.json({ error: "not_found" }, { status: 404, headers });
  }

  // Only configuration presence is returned. No credential or value is exposed.
  const config = getServerConfig();
  return Response.json(
    {
      checkedAt: new Date().toISOString(),
      configuration: {
        seoulApiKey: Boolean(config.seoul.apiKey),
        aiProvider: Boolean(config.ai.provider),
        aiModel: Boolean(config.ai.model),
        aiApiKey: Boolean(config.ai.apiKey),
      },
      integrationsVerified: false,
      note: "Configuration presence only; no external API was called.",
    },
    { headers },
  );
}
