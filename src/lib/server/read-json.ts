import "server-only";
import { ConditionsError } from "../domain/conditions.ts";

export async function readJson(request: Request, maximumBytes = 16_384): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ConditionsError("JSON 조건이 필요해요.");
  const reader = request.body?.getReader();
  if (!reader) throw new ConditionsError("조건을 입력해주세요.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) { await reader.cancel(); throw new ConditionsError("조건이 너무 길어요."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ConditionsError("조건 형식을 확인해주세요."); }
}
