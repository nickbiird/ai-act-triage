/**
 * Loads .env for standalone scripts. The Next.js app loads .env automatically,
 * but `tsx scripts/foo.ts` does not — so without this a capture/eval script never
 * sees ANTHROPIC_API_KEY / GOOGLE_API_KEY / DATABASE_URL even when .env is present.
 *
 * Uses Node's built-in process.loadEnvFile() (Node 20.12+/22+), so it adds no
 * dependency. It is a no-op when .env is absent (e.g. CI), so the deterministic,
 * no-key gates are unaffected — a script that genuinely needs a key still
 * surfaces its own clear error.
 *
 * Import this FIRST in any entry script that may read process.env:
 *   import '../lib/loadenv';
 */
try {
  const load = (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile;
  if (typeof load === 'function') load(); // loads ./.env from cwd
} catch {
  // .env not found / unreadable — fine; key-optional scripts degrade, key-required ones error clearly.
}
