import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Act Triage — risk-tier triage for AI use cases',
  description:
    'Describe an AI use case in plain language; get a cited EU AI Act risk-tier classification, adversarially reviewed and human-approved. Triage, not legal advice.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-baseline justify-between px-4 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              AI Act Triage
            </Link>
            <nav className="flex gap-4 text-sm text-stone-600">
              <Link href="/evals" className="hover:text-stone-900">Evals</Link>
              <Link href="/methodology" className="hover:text-stone-900">Methodology</Link>
              <a href="https://github.com/nickbiird/ai-act-triage" className="hover:text-stone-900">GitHub</a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-3xl px-4 pb-10 text-xs text-stone-500">
          <p>
            Triage, not legal advice. Built by{' '}
            <a className="underline" href="https://github.com/nickbiird">Nicholas Bird</a>. Legal text:
            Regulation (EU) 2024/1689 via{' '}
            <a className="underline" href="https://artificialintelligenceact.eu">artificialintelligenceact.eu</a>{' '}
            (Future of Life Institute mirror of the Official Journal text).
          </p>
        </footer>
      </body>
    </html>
  );
}
