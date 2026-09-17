// Seoul timestamps have no offset. Never let the server's local timezone decide.
export function parseSeoulTime(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) return null;
  const [year, month, day, hour, minute] = value.split(/[- :]/).map(Number);
  const utc = Date.UTC(year, month - 1, day, hour - 9, minute);
  const local = new Date(utc + 9 * 60 * 60 * 1000);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day || local.getUTCHours() !== hour || local.getUTCMinutes() !== minute) return null;
  return new Date(utc).toISOString();
}

export function formatSeoulTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "시각 확인 불가";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}

export function seoulInputTime(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
