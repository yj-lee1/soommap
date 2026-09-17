import "server-only";

// Read at request time so the same build runs on Vercel or a regular Node host.
export function getServerConfig() {
  const read = (name: string) => process.env[name]?.trim() || undefined;
  const budget = Number(read("AI_BUDGET_USD"));
  const cacheSeconds = Number(read("DATA_CACHE_SECONDS") ?? 300);
  return {
    seoul: {
      apiKey: read("SEOUL_API_KEY"),
      baseUrl: read("SEOUL_API_BASE_URL") ?? "http://openapi.seoul.go.kr:8088",
    },
    ai: {
      provider: read("AI_PROVIDER"),
      model: read("AI_MODEL"),
      apiKey: read("AI_API_KEY"),
      approvedBudgetUsd: Number.isFinite(budget) && budget > 0 ? Math.min(budget, 20) : 0,
    },
    setupToken: read("SETUP_CHECK_TOKEN"),
    cache: {
      namespace: read("DATA_CACHE_NAMESPACE") ?? "soommap-seoul-live-v1",
      revalidateSeconds: Number.isFinite(cacheSeconds) ? Math.max(30, Math.min(300, cacheSeconds)) : 300,
    },
  };
}
