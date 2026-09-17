// An optimization per warm worker, never the only storage of a valid snapshot.
export function createRequestGate<T>(cooldownMs = 30_000, clock = Date.now, successGraceMs = 5_000) {
  const inFlight = new Map<string, Promise<T>>();
  const failedUntil = new Map<string, number>();
  const recent = new Map<string, { value: T; until: number }>();
  function run(key: string, load: () => Promise<T>): Promise<T> {
    const pending = inFlight.get(key);
    if (pending) return pending;
    // Bridge the gap between a very fast provider response and the framework's
    // asynchronous shared-cache write, including adjacent cold requests.
    const completed = recent.get(key);
    if (completed && completed.until > clock()) return Promise.resolve(completed.value);
    recent.delete(key);
    if ((failedUntil.get(key) ?? 0) > clock()) return Promise.reject(new Error("provider_cooldown"));
    const promise = Promise.resolve().then(load).then(result => {
      recent.set(key, { value: result, until: clock() + successGraceMs });
      failedUntil.delete(key); return result;
    }).catch(() => {
      failedUntil.set(key, clock() + cooldownMs);
      // Never propagate a provider error that might contain its credential URL.
      throw new Error("provider_unavailable");
    }).finally(() => { inFlight.delete(key); });
    inFlight.set(key, promise);
    return promise;
  }
  // Await an operation already started by shared-cache revalidation without
  // initiating another provider request. The grace result covers a fast finish.
  return Object.assign(run, { existing(key: string): Promise<T> | undefined {
    const pending = inFlight.get(key);
    if (pending) return pending;
    const value = recent.get(key);
    return value && value.until > clock() ? Promise.resolve(value.value) : undefined;
  } });
}
