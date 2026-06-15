'use client';

import { useState, useRef } from 'react';
import { TierBadge } from '@/components/TierBadge';

type Phase = 'idle' | 'running' | 'awaiting' | 'done' | 'failed';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SseEvent {
  type: 'meta' | 'node' | 'awaiting_approval' | 'report' | 'guard_fail' | 'error';
  node?: string;
  data?: unknown;
  threadId?: string;
}

interface DemoFixture {
  description: string;
  preEvents: SseEvent[];
  postEvents: SseEvent[];
}

interface TraceItem {
  node: string;
  data: unknown;
}

interface Citation {
  ref: string;
  resolves: boolean;
  sourceUrl: string | null;
}

interface Report {
  tier: string;
  tierLabel: string;
  decidedByHuman: boolean;
  humanNote: string | null;
  proposal: { tier: string; reasoning: string; borderline: boolean; borderline_note: string };
  critique: { verdict: string; objection: string; objection_citations: string[] } | null;
  revised: boolean;
  citations: Citation[];
  obligations: { text: string; basis: string }[];
  corpusVersion: string;
  retrievalMode: string;
  cost: { calls: number; inputTokens: number; outputTokens: number; eur: number };
  hitlMode: string;
  disclaimer: string;
}

const SAMPLES: { label: string; text: string }[] = [
  {
    label: 'CV screening',
    text: 'We are a Spanish logistics company with 800 employees. We want to deploy a tool that reads incoming CVs, scores candidates from 1 to 100 on predicted job fit, and auto-rejects the bottom 60% before a recruiter ever sees them.',
  },
  {
    label: 'Support chatbot',
    text: 'Our e-commerce site wants a customer support chatbot on the public help page. It answers order and returns questions using our help-centre articles and hands off to a human agent when it cannot help.',
  },
  {
    label: 'Forklift maintenance',
    text: 'We operate 40 warehouses and want a model that predicts forklift component failures from vibration sensor data and schedules maintenance windows automatically. No customer data involved, only machine telemetry.',
  },
];

const NODE_LABELS: Record<string, string> = {
  guard: 'Screening input',
  plan_queries: 'Planning retrieval',
  retrieve: 'Searching the Act',
  propose: 'Proposing classification',
  critique: 'Adversarial review',
  gate: 'Human decision recorded',
};

export default function Home() {
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const [approval, setApproval] = useState<{ proposal: { tier: string; reasoning: string; citations: string[] }; critique: { verdict: string; objection: string } | null } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [override, setOverride] = useState('');
  const [demo, setDemo] = useState(false);
  const demoRef = useRef<DemoFixture | null>(null);
  const threadRef = useRef<string | null>(null);

  async function consume(res: Response) {
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      setError(body.error ?? `HTTP ${res.status}`);
      setPhase('failed');
      return;
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        if (!part.startsWith('data: ')) continue;
        applyEvent(JSON.parse(part.slice(6)));
      }
    }
  }

  // Single event handler shared by the live SSE stream (consume) and the
  // client-side recorded-demo replay (runDemo), so both render identically.
  function applyEvent(evt: SseEvent) {
    if (evt.type === 'meta') threadRef.current = evt.threadId ?? null;
    else if (evt.type === 'node') setTrace((t) => [...t, { node: evt.node!, data: evt.data }]);
    else if (evt.type === 'awaiting_approval') {
      setApproval(evt.data as never);
      setPhase('awaiting');
    } else if (evt.type === 'report') {
      setReport(evt.data as never);
      setPhase('done');
    } else if (evt.type === 'guard_fail') {
      setError(String(evt.data));
      setPhase('failed');
    } else if (evt.type === 'error') {
      setError(String(evt.data));
      setPhase('failed');
    }
  }

  // Replays a committed real assessment (public/demo-run.json) entirely client-
  // side: no /api/assess call, no key, zero model spend. It animates the SAME
  // trace -> durable gate -> report the live path streams, feeding the identical
  // event shapes through applyEvent.
  async function runDemo() {
    setTrace([]);
    setReport(null);
    setApproval(null);
    setError(null);
    setNote('');
    setOverride('');
    let data: DemoFixture;
    try {
      const r = await fetch('/demo-run.json', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } catch {
      setError('Recorded demo fixture not found — run `npm run capture:demo` (or hand-author public/demo-run.json) first.');
      setPhase('failed');
      return;
    }
    demoRef.current = data;
    setDemo(true);
    setDescription(data.description);
    setPhase('running');
    for (const evt of data.preEvents) {
      await sleep(evt.type === 'awaiting_approval' ? 400 : 850);
      applyEvent(evt);
    }
  }

  async function decide(approved: boolean) {
    setPhase('running');
    if (demo && demoRef.current) {
      // Recorded-demo replay: the committed run was approved at capture time, so
      // "Approve" plays the captured gate + report; a reject is synthesised
      // client-side (no second recorded path), keeping it honest.
      if (approved) {
        for (const evt of demoRef.current.postEvents) {
          await sleep(700);
          applyEvent(evt);
        }
      } else {
        await sleep(500);
        setReport(null);
        setError('Rejected at the gate — in the recorded demo only the approve path is captured. Clone the repo and run it live to reject.');
        setPhase('failed');
      }
      return;
    }
    await consume(
      await fetch('/api/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: threadRef.current,
          approved,
          tierOverride: override || null,
          note: note || null,
        }),
      }),
    );
  }

  async function assess() {
    setPhase('running');
    setDemo(false);
    demoRef.current = null;
    setTrace([]);
    setReport(null);
    setApproval(null);
    setError(null);
    await consume(
      await fetch('/api/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      }),
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          Where does your AI use case land under the EU AI Act?
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Describe the system in plain language. The pipeline retrieves the relevant provisions,
          proposes a risk tier with citations, tries to refute its own answer, and pauses for your
          approval before producing the report. <span className="font-medium">Triage, not legal advice.</span>
        </p>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <textarea
          className="h-32 w-full resize-y rounded-md border border-stone-300 p-3 text-sm focus:border-stone-500 focus:outline-none"
          placeholder="e.g. We want to deploy a model that scores loan applicants on repayment probability using their transaction history..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {SAMPLES.map((s) => (
            <button
              key={s.label}
              className="rounded-full border border-stone-300 px-3 py-1 text-xs text-stone-600 hover:bg-stone-100"
              onClick={() => setDescription(s.text)}
            >
              {s.label}
            </button>
          ))}
          <button
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-40"
            disabled={phase === 'running'}
            title="Replays a committed real assessment client-side — no API key, zero model calls"
            onClick={runDemo}
          >
            ▶ Run recorded demo <span className="text-stone-400">· free, no key</span>
          </button>
          <div className="grow" />
          {demo && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> recorded demo · 0 API calls
            </span>
          )}
          <button
            className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40"
            disabled={phase === 'running' || description.trim().length < 30}
            onClick={assess}
          >
            {phase === 'running' && !demo ? 'Assessing…' : 'Assess'}
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}

      {trace.length > 0 && (
        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-700">Pipeline trace</h2>
          <ol className="mt-2 space-y-2 text-sm">
            {trace.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-stone-400">{i + 1}.</span>
                <div>
                  <span className="font-medium">{NODE_LABELS[t.node] ?? t.node}</span>
                  <TraceDetail node={t.node} data={t.data} />
                </div>
              </li>
            ))}
            {phase === 'running' && <li className="text-stone-400">…</li>}
          </ol>
        </section>
      )}

      {phase === 'awaiting' && approval && (
        <section className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">Your approval is required</h2>
          <p className="mt-1 text-xs text-amber-800">
            The pipeline pauses here by design (Article 14: human oversight). The run is checkpointed —
            with a database configured, this approval survives restarts and can be answered days later.
          </p>
          <div className="mt-3 rounded-md bg-white p-3 text-sm">
            <div className="flex items-center gap-2">
              <span>Proposed:</span> <TierBadge tier={approval.proposal.tier} />
            </div>
            <p className="mt-2 text-stone-700">{approval.proposal.reasoning}</p>
            <p className="mt-1 text-xs text-stone-500">Citing: {approval.proposal.citations.join(', ')}</p>
            {approval.critique && (
              <p className="mt-2 text-xs">
                Critic: <span className="font-medium">{approval.critique.verdict}</span>
                {approval.critique.objection && ` — ${approval.critique.objection}`}
              </p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <select
              className="rounded-md border border-stone-300 px-2 py-1.5 text-sm"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
            >
              <option value="">Keep proposed tier</option>
              <option value="prohibited">Override: prohibited</option>
              <option value="high_risk">Override: high-risk</option>
              <option value="limited">Override: limited</option>
              <option value="minimal">Override: minimal</option>
            </select>
            <input
              className="min-w-40 grow rounded-md border border-stone-300 px-2 py-1.5 text-sm"
              placeholder="Reviewer note (optional, goes in the report)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600"
              onClick={() => decide(true)}
            >
              Approve
            </button>
          </div>
        </section>
      )}

      {report && <ReportCard report={report} />}
    </div>
  );
}

function TraceDetail({ node, data }: { node: string; data: unknown }) {
  if (!data) return null;
  const d = data as Record<string, unknown>;
  if (node === 'plan_queries' && Array.isArray(d.queries))
    return <p className="text-xs text-stone-500">{(d.queries as string[]).join(' · ')}</p>;
  if (node === 'retrieve' && Array.isArray(d.parents))
    return (
      <p className="text-xs text-stone-500">
        [{String(d.mode)}] {(d.parents as string[]).join(' · ')}
      </p>
    );
  if (node === 'guard' && Array.isArray(d.piiFound) && (d.piiFound as unknown[]).length > 0)
    return (
      <p className="text-xs text-amber-700">
        Personal data detected and masked before any model call: {(d.piiFound as { placeholder: string }[]).map((p) => p.placeholder).join(', ')}
      </p>
    );
  if (node === 'propose' && d.tier)
    return (
      <p className="text-xs text-stone-500">
        <TierBadge tier={String(d.tier)} /> {String(d.reasoning ?? '').slice(0, 180)}…
      </p>
    );
  if (node === 'critic' && d.verdict)
    return (
      <p className="text-xs text-stone-500">
        {String(d.verdict) === 'sustain' ? 'Classification survived refutation.' : `Objection: ${String(d.objection ?? '').slice(0, 160)}`}
      </p>
    );
  return null;
}

function ReportCard({ report }: { report: Report }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Assessment report</h2>
        <TierBadge tier={report.tier} large />
      </div>

      <p className="mt-3 text-sm text-stone-700">{report.proposal.reasoning}</p>
      {report.proposal.borderline && (
        <p className="mt-2 rounded-md bg-stone-100 p-2 text-xs text-stone-600">
          Borderline: {report.proposal.borderline_note}
        </p>
      )}
      {report.revised && (
        <p className="mt-2 text-xs text-stone-500">
          The proposer revised its classification after the critic objected.
        </p>
      )}
      {report.humanNote && report.humanNote !== 'auto-approved (eval mode)' && (
        <p className="mt-2 text-xs text-stone-600">Reviewer note: {report.humanNote}</p>
      )}

      <h3 className="mt-4 text-sm font-semibold">Legal basis</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {report.citations.map((c) => (
          <li key={c.ref}>
            {c.sourceUrl ? (
              <a className="text-blue-700 underline" href={c.sourceUrl} target="_blank" rel="noreferrer">
                {c.ref}
              </a>
            ) : (
              <span className={c.resolves ? '' : 'text-red-600 line-through'} title={c.resolves ? '' : 'citation did not resolve against the corpus'}>
                {c.ref}
              </span>
            )}
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-sm font-semibold">What this tier requires</h3>
      <ul className="mt-1 space-y-1.5 text-sm text-stone-700">
        {report.obligations.map((o, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-stone-400">▸</span>
            <span>
              {o.text} <span className="text-xs text-stone-400">({o.basis})</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-md bg-stone-50 p-3 text-xs text-stone-600 sm:grid-cols-4">
        <div>
          <div className="font-medium text-stone-800">€{report.cost.eur.toFixed(4)}</div>
          <div>this assessment</div>
        </div>
        <div>
          <div className="font-medium text-stone-800">{report.cost.calls} calls</div>
          <div>{report.cost.inputTokens.toLocaleString()} in / {report.cost.outputTokens.toLocaleString()} out</div>
        </div>
        <div>
          <div className="font-medium text-stone-800">{report.retrievalMode}</div>
          <div>retrieval</div>
        </div>
        <div>
          <div className="font-medium text-stone-800">{report.hitlMode === 'durable-postgres' ? 'durable' : 'ephemeral'}</div>
          <div>approval gate</div>
        </div>
      </div>

      <p className="mt-3 text-xs text-stone-400">
        Corpus {report.corpusVersion}. {report.disclaimer}
      </p>
    </section>
  );
}
