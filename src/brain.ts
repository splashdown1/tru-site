import { STARTER_FACTS } from "./STARTER_FACTS";

export type Verdict = "TRUTH" | "GAP" | "UNKNOWN";

export interface BrainResult {
  answer: string;
  verdict: Verdict;
  score: number;
  nodes: string[];
  key: string;
}

const STOP = new Set([
  "a","an","the","is","are","was","were","be","been","being","do","does","did",
  "what","who","whom","whose","which","where","when","why","how",
  "i","you","he","she","it","we","they","me","him","her","us","them",
  "my","your","his","its","our","their","this","that","these","those",
  "to","of","in","on","at","for","with","about","into","from","by","as","and","or","but","if","so",
  "tell","me","about","explain","define","describe","say","says","said",
  "can","could","would","should","will","shall","may","might","must",
  "there","here","up","down","out","over","under",
  "not","no","yes",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t) && t.length > 1);
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// multi-word keys to try in order, longest first
const PHRASE_KEYS: { key: string; canonical: string }[] = Object.keys(STARTER_FACTS)
  .map((k) => ({ key: k, canonical: normalise(k) }))
  .sort((a, b) => b.canonical.length - a.canonical.length);

function lookupExact(q: string): string | null {
  const nq = normalise(q);
  for (const { key, canonical } of PHRASE_KEYS) {
    if (nq === canonical) return key;
    if (nq.includes(canonical) && canonical.length >= 4) return key;
  }
  return null;
}

function lookupTokenOverlap(q: string): { key: string; score: number } | null {
  const qt = new Set(tokenize(q));
  if (qt.size === 0) return null;
  let best: { key: string; score: number } | null = null;
  for (const { key, canonical } of PHRASE_KEYS) {
    const kt = new Set(tokenize(canonical));
    if (kt.size === 0) continue;
    let hit = 0;
    for (const t of qt) if (kt.has(t)) hit++;
    const score = hit / Math.max(qt.size, kt.size);
    if (score > 0 && (!best || score > best.score)) best = { key, score };
  }
  return best && best.score >= 0.5 ? best : null;
}

export function askBrain(rawQ: string): BrainResult {
  const q = rawQ.trim();
  if (!q) {
    return { answer: "Ask a question.", verdict: "GAP", score: 0, nodes: [], key: "" };
  }

  const exact = lookupExact(q);
  if (exact) {
    return {
      answer: STARTER_FACTS[exact],
      verdict: "TRUTH",
      score: 100,
      nodes: [`starter:${exact}`],
      key: exact,
    };
  }

  const overlap = lookupTokenOverlap(q);
  if (overlap) {
    const score = Math.round(overlap.score * 100);
    return {
      answer: STARTER_FACTS[overlap.key],
      verdict: "TRUTH",
      score,
      nodes: [`starter:${overlap.key}`],
      key: overlap.key,
    };
  }

  return {
    answer: "I don't have a grounded answer for that in my starter brain. Try a single word or short phrase — mercy, faith, logos, jesus money, the golden rule.",
    verdict: "GAP",
    score: 0,
    nodes: [],
    key: "",
  };
}

export const brain = {
  size: Object.keys(STARTER_FACTS).length,
  keys: Object.keys(STARTER_FACTS),
};
