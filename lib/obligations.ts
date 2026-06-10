/**
 * Tier -> obligations checklist. Deterministic and citable on purpose:
 * the model decides the tier (with a human gate); the checklist that follows
 * from the tier is statute, not inference, so it is code, not a prompt.
 */

import type { Tier } from './types';

export const OBLIGATIONS: Record<Tier, { text: string; basis: string }[]> = {
  prohibited: [
    { text: 'Do not place on the market, put into service, or use this system in the EU. The practice is banned outright.', basis: 'Article 5' },
    { text: 'If a deployed system has drifted into this category, plan immediate withdrawal — penalties reach EUR 35M or 7% of worldwide annual turnover, whichever is higher.', basis: 'Article 99(3)' },
    { text: 'Re-scope the use case: most prohibited practices have adjacent, lawful designs (e.g. biometric verification instead of categorisation). Re-triage the redesign.', basis: 'Article 5' },
  ],
  high_risk: [
    { text: 'Establish a risk management system covering the full lifecycle.', basis: 'Article 9' },
    { text: 'Apply data governance: training/validation/test data must be relevant, representative, and as error-free as feasible.', basis: 'Article 10' },
    { text: 'Produce and maintain technical documentation before market placement.', basis: 'Article 11' },
    { text: 'Build in automatic event logging across the system lifetime.', basis: 'Article 12' },
    { text: 'Design for transparency: instructions for use that deployers can actually follow.', basis: 'Article 13' },
    { text: 'Design effective human oversight — including the ability to intervene, override, or interrupt.', basis: 'Article 14' },
    { text: 'Meet accuracy, robustness, and cybersecurity requirements appropriate to the purpose.', basis: 'Article 15' },
    { text: 'Run conformity assessment and affix CE marking before placing on the market; register in the EU database.', basis: 'Articles 43, 48, 49' },
    { text: 'If you deploy (rather than provide): assign trained human oversight, monitor operation, keep logs, and inform affected workers where relevant.', basis: 'Article 26' },
  ],
  limited: [
    { text: 'Inform people that they are interacting with an AI system, unless it is obvious from context.', basis: 'Article 50(1)' },
    { text: 'Mark synthetic audio/image/video/text content as artificially generated or manipulated, in a machine-readable way where feasible.', basis: 'Article 50(2)' },
    { text: 'If the system does emotion recognition or biometric categorisation: inform the exposed persons and handle their data under GDPR.', basis: 'Article 50(3)' },
    { text: 'If the content is a deepfake: disclose the artificial origin clearly.', basis: 'Article 50(4)' },
  ],
  minimal: [
    { text: 'No specific obligations under the Act for this use case. General law (GDPR, consumer protection, sector rules) still applies.', basis: 'Recital 165' },
    { text: 'Voluntary codes of conduct are encouraged — adopting transparency or oversight practices ahead of need is cheap insurance against scope drift.', basis: 'Article 95' },
    { text: 'Re-triage if the use case changes: minimal classifications are facts about today’s design, not permanent grants.', basis: 'Article 6' },
  ],
};
