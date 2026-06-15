/**
 * Turns a LangGraph state stream into an SSE response. Each graph node update
 * becomes one event; an interrupt becomes an "awaiting_approval" event that
 * carries the thread id the client needs to resume.
 */

import type { Tier } from './types';

export interface SseEvent {
  type:
    | 'node'
    | 'awaiting_approval'
    | 'report'
    | 'guard_fail'
    | 'error'
    | 'meta';
  node?: string;
  data?: unknown;
  threadId?: string;
}

/**
 * Maps one LangGraph state-update object to the SSE events the client consumes.
 * Single source of truth: `sseResponse` (the live route) and the demo-capture
 * script (scripts/capture-demo.ts) both go through here, so a recorded demo is
 * byte-identical to a live stream.
 */
export function eventsForUpdate(update: Record<string, unknown>, threadId: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const [node, value] of Object.entries(update)) {
    if (node === '__interrupt__') {
      const interrupts = value as { value: unknown }[];
      out.push({ type: 'awaiting_approval', threadId, data: interrupts[0]?.value });
      continue;
    }
    const v = value as Record<string, unknown> | null;
    if (v && 'guardFail' in v && v.guardFail) {
      out.push({ type: 'guard_fail', node, data: v.guardFail });
    } else if (v && 'report' in v && v.report) {
      out.push({ type: 'report', node, data: v.report });
    } else {
      out.push({ type: 'node', node, data: summarize(node, v) });
    }
  }
  return out;
}

export function sseResponse(
  threadId: string,
  iterate: () => Promise<AsyncIterable<Record<string, unknown>>>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: SseEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        send({ type: 'meta', threadId });
        for await (const update of await iterate()) {
          for (const e of eventsForUpdate(update, threadId)) send(e);
        }
      } catch (err) {
        send({ type: 'error', data: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

/** Strip node outputs down to what the trace UI shows — full state stays server-side. */
function summarize(node: string, v: Record<string, unknown> | null): unknown {
  if (!v) return null;
  switch (node) {
    case 'guard':
      return { piiFound: v.piiFound ?? [] };
    case 'plan_queries':
      return { queries: v.queries };
    case 'retrieve': {
      const r = v.retrieval as { mode: string; parents: { id: string; title: string }[] } | null;
      return r ? { mode: r.mode, parents: r.parents.map((p) => p.title) } : null;
    }
    case 'propose':
      return v.proposal;
    case 'critic':
      return v.critique;
    case 'gate':
      return v.decision;
    default:
      return null;
  }
}

export interface ResumePayload {
  approved: boolean;
  tierOverride?: Tier | null;
  note?: string | null;
}
