export const dynamic = 'force-static';

export default function MethodologyPage() {
  return (
    <div className="prose prose-sm prose-stone max-w-none space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Methodology</h1>
        <p className="mt-2 text-sm text-stone-600">
          What this tool is, what its numbers mean, and where its judgment ends.
        </p>
      </section>

      <Section title="What this is">
        <p>
          A triage layer. Most AI use cases in a company portfolio are minimal or limited risk under
          Regulation (EU) 2024/1689; a minority genuinely need qualified legal review. The expensive
          failure is paying review prices for wave-throughs — or worse, not noticing the one case that
          is prohibited. This tool routes: it produces a cited first-pass tier so the legal budget goes
          where the risk is. It does not produce legal advice, and a careless reading of its output as
          legal advice is the documented misuse case.
        </p>
      </Section>

      <Section title="How a classification is produced">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Personal data in the description is masked before any model call (regex-class detector; placeholders stay server-side).</li>
          <li>An input gate checks the text is a use-case description and not an instruction payload.</li>
          <li>Retrieval queries are planned, then run against the full Act text: BM25 and dense embeddings fused with Reciprocal Rank Fusion, expanded to whole articles.</li>
          <li>A proposer model classifies the tier, citing only retrieved provisions.</li>
          <li>A critic model attempts to refute the classification from the same legal text. One revision round maximum — enforced by the graph, not the prompt.</li>
          <li>The run pauses on a checkpointed interrupt until a human approves or overrides. With a database configured the pause is durable: it survives restarts and can be answered days later.</li>
          <li>The report assembles the tier, resolving citations against the corpus (unresolvable ones are flagged, never silently kept), the statutory obligations checklist for that tier, the corpus version, and the metered cost of the run.</li>
        </ol>
      </Section>

      <Section title="The golden set and the core/contested split">
        <p>
          The eval set is 60 labelled use cases. 40 are <strong>core</strong>: their labels fall
          near-deterministically out of Article 5, Annex III, or Article 50 — disagreeing with them
          requires disagreeing with the list itself. 20 are <strong>contested</strong>: Article 6(3)
          derogation candidates, emotion-recognition edge cases, internal-tool transparency questions.
          Contested labels follow a published rubric (in the repo:{' '}
          <code>evals/golden/RUBRIC.md</code>) written by a non-lawyer and cited to the provisions it
          relies on. Accuracy on the contested split therefore measures agreement with one documented
          reading of the Act — it is reported separately and should be read that way.
        </p>
      </Section>

      <Section title="What the other numbers mean">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Citation faithfulness</strong> is programmatic: a citation passes if it resolves to a
            real article/annex in the corpus. This catches invented provisions; it does not by itself
            prove the provision supports the argument — that is what the critic and the human gate are for.
          </li>
          <li>
            <strong>Retrieval recall@5</strong> uses each golden case as a query and its labelled legal
            basis as the relevant documents, compared across retrieval configurations.
          </li>
          <li>
            <strong>Cost per assessment</strong> is metered from actual token counts at list prices, not
            estimated.
          </li>
          <li>
            <strong>Injection probes</strong> are a regression gate, not a security proof: they show the
            defences fire on known attack shapes, including one poisoned-context probe.
          </li>
        </ul>
      </Section>

      <Section title="Corpus and versioning">
        <p>
          The corpus is the Official Journal text of 13 June 2024 (via the Future of Life Institute
          mirror), ingested with structure-aware chunking. The Act&apos;s obligations timeline is moving —
          the 2026 digital-omnibus agreement shifted parts of it — so every assessment is stamped with
          the corpus version it was made against, and re-ingestion is a one-command maintenance action
          when the consolidated text changes. An assessment without a corpus version would be
          unauditable; that is the failure mode the stamp exists to prevent.
        </p>
      </Section>

      <Section title="Limits, stated plainly">
        <ul className="list-disc space-y-1 pl-5">
          <li>Built by a non-lawyer. The rubric is cited, but it is one reading.</li>
          <li>The tool sees only the description it is given; misdescribed systems get misclassified.</li>
          <li>GPAI-model obligations (Articles 51–56) are surfaced in reasoning but not deeply modelled.</li>
          <li>A finite eval set bounds what the accuracy numbers can claim.</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-2 text-sm text-stone-700">{children}</div>
    </section>
  );
}
