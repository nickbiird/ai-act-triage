# Trust report

> Generated from the committed eval artifacts in `evals/results/` by `npx tsx evals/trust-report.ts`.
> Numbers appear here when a run produced them, and not before. Methodology: [/methodology](app/methodology/page.tsx) and [`evals/golden/RUBRIC.md`](evals/golden/RUBRIC.md).

## Classification accuracy

**Pending.** No recorded assessment run committed yet (`npm run evals -- --record` with `GOOGLE_API_KEY`).

## Citation faithfulness (programmatic)

**Pending** first recorded run.

## Retrieval scorecard

Run 2026-06-10T21:30:34.376Z · corpus `aia-oj-2024-06-13_ingested-2026-06-10` · query = each golden case description, relevant docs = its labelled legal basis.

| Config | Queries | Recall@5 | MRR |
|---|---|---|---|
| bm25-only | 60 | 25.0% | 0.154 |

Dense and hybrid configs appear after `npm run ingest:embed` generates the static embeddings (needs `GOOGLE_API_KEY`). The BM25-only number on raw paraphrase descriptions is the measured argument for the dense leg: product-lead language misses statute vocabulary.

## Injection probes

**Pending.** Run `npm run evals:probes -- --record` with `GOOGLE_API_KEY`.

## Cost and latency

**Pending** first recorded run.

## Where the human sits

Every interactive assessment pauses on a checkpointed `interrupt()` before the report exists. With `DATABASE_URL` set the pause is durable (Postgres checkpointer): it survives restarts, deploys, and fresh serverless invocations. Without it the gate degrades to in-memory and a restart loses the pending approval — the UI and this report say which mode is live rather than letting the degradation pass silently. Eval runs bypass the gate explicitly (`auto_approve`), because evals measure the model pipeline and the gate is process.
