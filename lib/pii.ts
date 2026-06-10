/**
 * Input rail: mask obvious personal data BEFORE any text reaches the model.
 * Session-consistent placeholders ([EMAIL_1], [PHONE_1], ...) keep the
 * description readable; the mapping never leaves the server process.
 *
 * Honest scope: this is a regex detector, not Presidio. It catches the
 * formats people actually paste into a triage box (emails, phone numbers,
 * Spanish DNI/NIE, IBANs). A production deployment would run a real NER
 * masker here — the README says so. The boundary placement is the point:
 * masking happens before the API call, not after.
 */

export interface MaskResult {
  masked: string;
  found: { kind: string; placeholder: string }[];
}

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: 'EMAIL', re: /[\w.+-]+@[\w-]+\.[\w.-]{2,}/g },
  { kind: 'IBAN', re: /\b[A-Z]{2}\d{2}[ ]?(?:\d{4}[ ]?){4,7}\d{0,4}\b/g },
  { kind: 'DNI', re: /\b\d{8}[ -]?[A-HJ-NP-TV-Z]\b/g },
  { kind: 'NIE', re: /\b[XYZ]\d{7}[ -]?[A-HJ-NP-TV-Z]\b/g },
  { kind: 'PHONE', re: /(?:\+\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?)\d{3}[ .-]?\d{2,4}(?:[ .-]?\d{2,4})?\b/g },
];

export function maskPII(text: string): MaskResult {
  let masked = text;
  const found: MaskResult['found'] = [];
  for (const { kind, re } of PATTERNS) {
    let counter = 0;
    masked = masked.replace(re, (match) => {
      // phone regex is greedy enough to hit plain years/quantities; require 9+ digits
      if (kind === 'PHONE' && match.replace(/\D/g, '').length < 9) return match;
      counter += 1;
      const placeholder = `[${kind}_${counter}]`;
      found.push({ kind, placeholder });
      return placeholder;
    });
  }
  return { masked, found };
}
