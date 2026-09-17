import { isSetupAuthorized } from "@/lib/server/setup-auth";
import { probeSeoul } from "@/lib/server/integrations/seoul";
import { probeOpenAI } from "@/lib/server/integrations/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSetupAuthorized(request)) {
    return Response.json({ error: "not_found" }, { status: 404, headers });
  }
  const [seoul, openai] = await Promise.all([probeSeoul(), probeOpenAI()]);
  return Response.json({ checkedAt: new Date().toISOString(), seoul, openai,
    integrationsVerified: seoul.ok && openai.ok, aiGenerationVerified: false,
  }, { headers });
}
