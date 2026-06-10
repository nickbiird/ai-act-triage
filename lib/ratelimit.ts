/**
 * Per-IP daily cap for the public demo. In-memory on purpose: it protects the
 * API key budget, resets on cold start, and that is documented behaviour for a
 * free-tier demo — a durable limiter (Upstash/Postgres) is the production note
 * in the README, not silent scope.
 */

const hits = new Map<string, { day: string; count: number }>();

export function checkRateLimit(ip: string): { ok: boolean; remaining: number } {
  const limit = Number(process.env.RATE_LIMIT_PER_DAY ?? 10);
  if (!limit) return { ok: true, remaining: Infinity };
  const day = new Date().toISOString().slice(0, 10);
  const cur = hits.get(ip);
  if (!cur || cur.day !== day) {
    hits.set(ip, { day, count: 1 });
    return { ok: true, remaining: limit - 1 };
  }
  if (cur.count >= limit) return { ok: false, remaining: 0 };
  cur.count += 1;
  return { ok: true, remaining: limit - cur.count };
}
