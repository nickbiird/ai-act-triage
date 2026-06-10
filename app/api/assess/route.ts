import { NextRequest } from 'next/server';
import { buildGraph } from '@/lib/graph';
import { getCheckpointer } from '@/lib/checkpointer';
import { checkRateLimit } from '@/lib/ratelimit';
import { sseResponse } from '@/lib/stream';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!process.env.GOOGLE_API_KEY) {
    return Response.json(
      { error: 'GOOGLE_API_KEY is not configured on this deployment. Clone the repo and run it with your own key — see README.' },
      { status: 503 },
    );
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return Response.json(
      { error: 'Daily demo limit reached for this IP. Clone the repo and run it with your own key.' },
      { status: 429 },
    );
  }

  const { description } = (await req.json()) as { description?: string };
  if (!description || typeof description !== 'string' || description.length > 4000) {
    return Response.json({ error: 'Provide a description (max 4000 chars).' }, { status: 400 });
  }

  const { saver, mode } = await getCheckpointer();
  const graph = buildGraph().compile({ checkpointer: saver });
  const threadId = crypto.randomUUID();

  return sseResponse(
    threadId,
    () =>
      graph.stream(
        { description, hitlMode: mode },
        { configurable: { thread_id: threadId }, streamMode: 'updates' },
      ) as unknown as Promise<AsyncIterable<Record<string, unknown>>>,
  );
}
