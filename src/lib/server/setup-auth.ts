import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getServerConfig } from "./config";

export function isSetupAuthorized(request: Request): boolean {
  const expected = getServerConfig().setupToken;
  if (!expected || expected.length < 32) return false;

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;

  const supplied = Buffer.from(authorization.slice(7), "utf8");
  const actual = Buffer.from(expected, "utf8");
  return supplied.length === actual.length && timingSafeEqual(supplied, actual);
}
