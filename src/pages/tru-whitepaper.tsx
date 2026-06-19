import { useState, useEffect } from "react";
import { marked } from "https://esm.sh/marked@12.0.2";

export default function TruWhitepaper() {
  const [html, setHtml] = useState<string>("");
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    fetch("/TRU_WHITEPAPER.md")
      .then((r) => (r.ok ? r.text() : Promise.reject(`HTTP ${r.status}`)))
      .then((md) => setHtml(marked.parse(md, { breaks: true }) as string))
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <div className="min-h-screen bg-black text-white font-mono antialiased">
      <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-16">
          <span>TRU · Whitepaper</span>
          <a href="/" className="hover:text-neutral-300 transition-colors">← back</a>
        </div>

        {err ? (
          <div className="text-sm text-red-400">Failed to load: {err}</div>
        ) : html ? (
          <article
            className="prose-whitepaper"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="text-sm text-neutral-600 animate-pulse">Loading protocol…</div>
        )}

        <div className="mt-32 pt-8 border-t border-neutral-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-700">
            Speculative framework · not a patent
          </div>
          <a
            href="/vision"
            className="text-[10px] uppercase tracking-[0.3em] text-neutral-700 hover:text-white transition-colors"
          >
            see the codex →
          </a>
        </div>
      </div>

      <style>{`
        .prose-whitepaper h1 {
          font-size: 1.875rem; font-weight: 300; letter-spacing: -0.01em;
          line-height: 1.15; color: #e5e5e5; margin: 0 0 0.25rem;
        }
        .prose-whitepaper h3 {
          font-size: 0.75rem; font-weight: 400; letter-spacing: 0.3em;
          text-transform: uppercase; color: #6a6a82; margin: 0 0 0.5rem;
        }
        .prose-whitepaper p {
          font-size: 0.875rem; line-height: 1.75; color: #a3a3a3; margin: 1.1rem 0;
        }
        .prose-whitepaper h2 {
          font-size: 0.7rem; font-weight: 500; letter-spacing: 0.3em;
          text-transform: uppercase; color: #d8a657; margin: 2.5rem 0 0.75rem;
          padding-top: 1.5rem; border-top: 1px solid #1a1a1a;
        }
        .prose-whitepaper blockquote {
          border-left: 2px solid #d8a657; padding-left: 1rem; margin: 1.5rem 0;
          color: #c4b89a; font-style: italic; font-size: 0.875rem; line-height: 1.7;
        }
        .prose-whitepaper blockquote p { color: #c4b89a; margin: 0.5rem 0; }
        .prose-whitepaper code {
          display: block; background: #0a0a0a; border: 1px solid #1a1a1a;
          border-radius: 4px; padding: 1rem 1.25rem; margin: 1.25rem 0;
          font-size: 0.75rem; line-height: 1.6; color: #b0b0c0; overflow-x: auto;
          white-space: pre;
        }
        .prose-whitepaper table {
          width: 100%; border-collapse: collapse; margin: 1.25rem 0; font-size: 0.75rem;
        }
        .prose-whitepaper th, .prose-whitepaper td {
          border: 1px solid #1a1a1a; padding: 0.5rem 0.75rem; text-align: left;
        }
        .prose-whitepaper th { color: #d8a657; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.65rem; }
        .prose-whitepaper td { color: #a3a3a3; }
        .prose-whitepaper hr { border: none; border-top: 1px solid #1a1a1a; margin: 2rem 0; }
        .prose-whitepaper strong { color: #e5e5e5; font-weight: 500; }
        .prose-whitepaper ul { padding-left: 1.25rem; margin: 1rem 0; }
        .prose-whitepaper li { font-size: 0.875rem; line-height: 1.75; color: #a3a3a3; }
        .prose-whitepaper em { color: #888; }
      `}</style>
    </div>
  );
}
