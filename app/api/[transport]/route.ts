/**
 * MCP server over the same engine the UI uses — streamable HTTP, stateless
 * per call (the serverless-compatible transport; stdio is for local procs).
 *
 * The documented asymmetry: classify_use_case returns an UNGATED draft.
 * A synchronous MCP tool call cannot park on a human approval and resume
 * days later, so the human gate — the part Article 14 actually demands —
 * only exists in the web flow, where interrupt() + the Postgres checkpointer
 * make the pause durable. The tool says this in its own description and
 * stamps every response ungated_draft: true rather than pretending parity.
 */

import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { retrieve } from '@/lib/retrieval';
import { loadCorpus, citationToDocId, getDoc } from '@/lib/corpus';
import { buildGraph } from '@/lib/graph';
import { MemorySaver } from '@langchain/langgraph';
import { DISCLAIMER } from '@/lib/types';

export const maxDuration = 60;

const text = (data: unknown) => ({
  content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
});

const handler = createMcpHandler(
  (server) => {
    server.tool(
      'search_ai_act',
      'Hybrid search (BM25 + dense, RRF-fused) over the full text of the EU AI Act (Regulation (EU) 2024/1689). Returns matching provisions with canonical citation labels.',
      { query: z.string().describe('what to look for, plain language or legal terms'), k: z.number().int().min(1).max(15).optional().describe('number of chunks (default 6)') },
      async ({ query, k }) => {
        const r = await retrieve(query, { k: k ?? 6 });
        return text({
          retrievalMode: r.mode,
          corpusVersion: loadCorpus().version,
          results: r.chunks.map((c) => ({ label: c.label, title: c.title, text: c.text })),
        });
      },
    );

    server.tool(
      'get_provision',
      'Fetch the full text of an EU AI Act article or annex by citation, e.g. "Article 6", "Article 5(1)(a)", "Annex III".',
      { citation: z.string().describe('citation in canonical form') },
      async ({ citation }) => {
        const id = citationToDocId(citation);
        const doc = id ? getDoc(id) : undefined;
        if (!doc) return text({ error: `Citation "${citation}" does not resolve in corpus ${loadCorpus().version}.` });
        return text({ id: doc.id, title: doc.title, chapter: doc.chapter, sourceUrl: doc.sourceUrl, text: doc.text });
      },
    );

    server.tool(
      'classify_use_case',
      'Run the full triage pipeline (retrieval -> proposer -> adversarial critic) on an AI use-case description and return the draft risk tier with citations. IMPORTANT: this draft is UNGATED — the human-approval step that the web flow enforces cannot ride a synchronous tool call. Treat the result as triage input, not a decision.',
      { description: z.string().min(30).max(4000).describe('plain-language description of the AI system: what it does, where it is deployed, who it affects') },
      async ({ description }) => {
        if (!process.env.GOOGLE_API_KEY) {
          return text({ error: 'GOOGLE_API_KEY not configured on this deployment.' });
        }
        const graph = buildGraph().compile({ checkpointer: new MemorySaver() });
        const out = await graph.invoke(
          { description, hitlMode: 'ephemeral-memory' },
          { configurable: { thread_id: crypto.randomUUID(), auto_approve: true } },
        );
        if (out.guardFail) return text({ rejected: out.guardFail });
        const r = out.report!;
        return text({
          ungated_draft: true,
          tier: r.tier,
          tierLabel: r.tierLabel,
          reasoning: r.proposal.reasoning,
          citations: r.citations,
          critique: r.critique,
          obligations: r.obligations,
          corpusVersion: r.corpusVersion,
          cost_eur: r.cost.eur,
          disclaimer: DISCLAIMER,
        });
      },
    );
  },
  {},
  { basePath: '/api' },
);

export { handler as GET, handler as POST, handler as DELETE };
