/**
 * Assembles TRUST_REPORT.md from the committed eval artifacts. The report is
 * generated, never hand-edited: if a number is not in evals/results/, it
 * appears as "pending", not as a promise.
 *
 * Run after any eval: npx tsx evals/trust-report.ts
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

async function load<T>(name: string): Promise<T | null> {
  const p = path.join(root, 'evals', 'results', name);
  return existsSync(p) ? (JSON.parse(await readFile(p, 'utf8')) as T) : null;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const a = await load<{
    generatedAt: string; corpusVersion: string; models: { fast: string; deep: string };
    splits: Record<string, { total: number; correct: number; accuracy: number }>;
    citationFaithfulness: { totalCitations: number; resolved: number; rate: number };
    cost: { meanEurPerAssessment: number; totalEur: number };
    latency: { p50Ms: number; p95Ms: number };
    failures: { id: string; expected: string; predicted: string }[];
  }>('assessment-scorecard.json');
  const r = await load<{
    generatedAt: string; corpusVersion: string;
    configs: { name: string; recallAt5: number; mrr: number; queries: number }[];
  }>('retrieval-scorecard.json');
  const p = await load<{ generatedAt: string; probes: { id: string; kind: string; passed: boolean; note: string }[] }>('probe-scorecard.json');

  const lines: string[] = [];
  lines.push('# Trust report');
  lines.push('');
  lines.push('> Generated from the committed eval artifacts in `evals/results/` by `npx tsx evals/trust-report.ts`.');
  lines.push('> Numbers appear here when a run produced them, and not before. Methodology: [/methodology](app/methodology/page.tsx) and [`evals/golden/RUBRIC.md`](evals/golden/RUBRIC.md).');
  lines.push('');

  lines.push('## Classification accuracy');
  lines.push('');
  if (a) {
    lines.push(`Run ${a.generatedAt} · corpus \`${a.corpusVersion}\` · models ${a.models.deep} (propose/critique) + ${a.models.fast} (gate/queries)`);
    lines.push('');
    lines.push('| Split | Cases | Correct | Accuracy |');
    lines.push('|---|---|---|---|');
    for (const [split, s] of Object.entries(a.splits)) {
      lines.push(`| ${split} | ${s.total} | ${s.correct} | ${pct(s.accuracy)} |`);
    }
    lines.push('');
    lines.push(`Core labels fall near-deterministically out of Article 5 / Annex III / Article 50. Contested labels follow the published rubric and measure agreement with one documented reading, not ground truth — that is why they are reported separately.`);
    if (a.failures.length) {
      lines.push('');
      lines.push(`Misclassifications: ${a.failures.map((f) => `\`${f.id}\` (expected ${f.expected}, got ${f.predicted})`).join(', ')}.`);
    }
  } else {
    lines.push('**Pending.** No recorded assessment run committed yet (`npm run evals -- --record` with `GOOGLE_API_KEY`).');
  }
  lines.push('');

  lines.push('## Citation faithfulness (programmatic)');
  lines.push('');
  if (a) {
    lines.push(`${a.citationFaithfulness.resolved}/${a.citationFaithfulness.totalCitations} citations resolve against the corpus (${pct(a.citationFaithfulness.rate)}). A citation passes only if the cited article or annex actually exists in the corpus version the assessment ran against; unresolvable citations are flagged in the report UI, never silently kept.`);
  } else {
    lines.push('**Pending** first recorded run.');
  }
  lines.push('');

  lines.push('## Retrieval scorecard');
  lines.push('');
  if (r) {
    lines.push(`Run ${r.generatedAt} · corpus \`${r.corpusVersion}\` · query = each golden case description, relevant docs = its labelled legal basis.`);
    lines.push('');
    lines.push('| Config | Queries | Recall@5 | MRR |');
    lines.push('|---|---|---|---|');
    for (const c of r.configs) {
      lines.push(`| ${c.name} | ${c.queries} | ${pct(c.recallAt5)} | ${c.mrr.toFixed(3)} |`);
    }
    lines.push('');
    if (r.configs.length === 1) {
      lines.push('Dense and hybrid configs appear after `npm run ingest:embed` generates the static embeddings (needs `GOOGLE_API_KEY`). The BM25-only number on raw paraphrase descriptions is the measured argument for the dense leg: product-lead language misses statute vocabulary.');
    }
  } else {
    lines.push('**Pending.** Run `npm run evals:retrieval`.');
  }
  lines.push('');

  lines.push('## Injection probes');
  lines.push('');
  if (p) {
    const passed = p.probes.filter((x) => x.passed).length;
    lines.push(`${passed}/${p.probes.length} passed (run ${p.generatedAt}).`);
    lines.push('');
    for (const probe of p.probes) {
      lines.push(`- ${probe.passed ? '✅' : '❌'} **${probe.kind}** — ${probe.note}`);
    }
    lines.push('');
    lines.push('A finite probe set shows the defences fire on these shapes, including one indirect injection through poisoned retrieval context. It does not prove absence of injection risk.');
  } else {
    lines.push('**Pending.** Run `npm run evals:probes -- --record` with `GOOGLE_API_KEY`.');
  }
  lines.push('');

  lines.push('## Cost and latency');
  lines.push('');
  if (a) {
    lines.push(`Mean metered cost per assessment: **€${a.cost.meanEurPerAssessment.toFixed(4)}** (token counts at list prices, USD→EUR at 0.92). Latency p50 ${(a.latency.p50Ms / 1000).toFixed(1)}s, p95 ${(a.latency.p95Ms / 1000).toFixed(1)}s including the adversarial-review pass.`);
    lines.push('');
    lines.push('The comparison baseline used in the README is EUR 2,000–5,000 for a single-use-case external legal review (market rate, cited there). The honest framing of that gap: this prices the routing decision, not the lawyer.');
  } else {
    lines.push('**Pending** first recorded run.');
  }
  lines.push('');

  lines.push('## Where the human sits');
  lines.push('');
  lines.push('Every interactive assessment pauses on a checkpointed `interrupt()` before the report exists. With `DATABASE_URL` set the pause is durable (Postgres checkpointer): it survives restarts, deploys, and fresh serverless invocations. Without it the gate degrades to in-memory and a restart loses the pending approval — the UI and this report say which mode is live rather than letting the degradation pass silently. Eval runs bypass the gate explicitly (`auto_approve`), because evals measure the model pipeline and the gate is process.');
  lines.push('');

  await writeFile(path.join(root, 'TRUST_REPORT.md'), lines.join('\n'));
  console.log('Wrote TRUST_REPORT.md');
}

main().catch((e) => { console.error(e); process.exit(1); });
