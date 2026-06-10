import { NextRequest } from 'next/server';
import { Command } from '@langchain/langgraph';
import { buildGraph } from '@/lib/graph';
import { getCheckpointer } from '@/lib/checkpointer';
import { sseResponse, type ResumePayload } from '@/lib/stream';
import { TIERS } from '@/lib/types';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Resumes a paused assessment with the human decision. With the Postgres
 * checkpointer this works as a completely fresh invocation — possibly days
 * later, possibly on a different serverless instance. With the in-memory
 * fallback it only works while the process that paused is still alive; the
 * UI surfaces which mode is active so a failed resume is explicable, not
 * mysterious.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { threadId?: string } & ResumePayload;
  if (!body.threadId || typeof body.approved !== 'boolean') {
    return Response.json({ error: 'threadId and approved are required.' }, { status: 400 });
  }
  if (body.tierOverride && !TIERS.includes(body.tierOverride)) {
    return Response.json({ error: 'Invalid tierOverride.' }, { status: 400 });
  }

  const { saver } = await getCheckpointer();
  const graph = buildGraph().compile({ checkpointer: saver });

  // verify the thread actually has a pending interrupt before resuming
  const state = await graph.getState({ configurable: { thread_id: body.threadId } });
  if (!state.next || state.next.length === 0) {
    return Response.json(
      { error: 'No pending approval for this thread. With in-memory checkpointing, pending approvals do not survive a restart — this is the documented degradation; set DATABASE_URL for durable approvals.' },
      { status: 410 },
    );
  }

  return sseResponse(
    body.threadId,
    () =>
      graph.stream(
        new Command({
          resume: {
            approved: body.approved,
            tierOverride: body.tierOverride ?? null,
            note: body.note ?? null,
          },
        }),
        { configurable: { thread_id: body.threadId }, streamMode: 'updates' },
      ) as unknown as Promise<AsyncIterable<Record<string, unknown>>>,
  );
}
