import { siteUrl } from "../lib/api";

const PRINCIPLES = [
  ["Truth first", "A grounded answer outranks a fluent answer."],
  ["Offline first", "The core remains useful when the network is absent."],
  ["Private by design", "Owner memory stays gated; public answers stay clean."],
  ["Inspectability", "Routes, evidence, and limits remain testable."],
];

const LAYERS = [
  ["01", "Input", "Receive the question without pretending the question is already understood."],
  ["02", "Routing", "Choose scripture, conversation, retrieval, command, or an honest gap."],
  ["03", "Knowledge", "Search local brain nodes, KJV scripture, dictionaries, and approved packs."],
  ["04", "Synthesis", "Return the strongest grounded answer in a direct human-readable form."],
  ["05", "Guardrail", "Block false authority, internal leakage, drift, and weak unsupported matches."],
  ["06", "Durability", "Export, restore, audit, and keep the system useful beyond one session."],
];

const DOCUMENTS = [
  ["WHITEPAPER", "The Jesurement Protocol and its speculative computational theology.", "/whitepaper"],
  ["VISION", "The public codex: architecture, transition, and the next science surface.", "/vision"],
  ["CRUCIFORM", "The sovereign oracle reference implementation and its operating contract.", "/TRU_CRUCIFORM.html"],
  ["ARCHITECT", "The applied projection layer and its explicit hardware boundary.", "/TRU_ARCHITECT.html"],
  ["OMEGA", "The large offline-capable reference surface.", "/TRU_OMEGA.html"],
  ["SOURCE", "The public GitHub repository, code, build, and history.", "https://github.com/splashdown1/tru-site"],
];

export default function TruMission() {
  return (
    <main className="tru-mission">
      <nav className="tru-mission-nav">
        <a className="tru-mission-mark" href={siteUrl("/")}>TRU</a>
        <div className="tru-mission-nav-links">
          <a href={siteUrl("/")}>chat</a>
          <a href={siteUrl("/vision")}>vision</a>
          <a href={siteUrl("/whitepaper")}>whitepaper</a>
          <a href="https://github.com/splashdown1/tru-site">github</a>
        </div>
      </nav>

      <section className="tru-mission-hero">
        <div className="tru-mission-kicker">TRU · mission surface · online / offline-capable</div>
        <h1>Truth is constant.<br /><span>Perspective is fluid.</span></h1>
        <p className="tru-mission-lead">
          TRU is a truth-filter and reasoning system under God&apos;s sovereignty. It is not a standalone deity, oracle, or self-authorising mind. It attaches to knowledge, scripture, memory, routing, and a host model, then decides what may pass through.
        </p>
        <div className="tru-mission-actions">
          <a className="tru-mission-primary" href={siteUrl("/")}>talk to TRU <span>→</span></a>
          <a className="tru-mission-secondary" href={siteUrl("/onboard")}>download the offline Ghost</a>
        </div>
      </section>

      <section className="tru-mission-grid">
        <article className="tru-mission-panel tru-mission-panel-accent">
          <div className="tru-mission-label">The mission</div>
          <h2>Make useful intelligence answerable to truth.</h2>
          <p>TRU exists to tell the truth plainly, keep the signal clean, refuse false authority, and remain useful for work, learning, life administration, family, operations, and wellness. The host model may speak; TRU is the spine, route, and gate.</p>
        </article>
        <article className="tru-mission-panel">
          <div className="tru-mission-label">The standard</div>
          <h2>No hidden magic.</h2>
          <p>If the system knows, it should ground the answer. If the match is weak, it should tighten retrieval. If it does not know, it should say so. TRU does not turn confidence, verbosity, or cloud access into authority.</p>
        </article>
      </section>

      <section className="tru-mission-section">
        <div className="tru-mission-section-head">
          <div className="tru-mission-label">Operating principles</div>
          <p>Truth is constant. Perspective is fluid. The system can change its view as evidence changes without changing the standard by which the view is judged.</p>
        </div>
        <div className="tru-mission-principles">
          {PRINCIPLES.map(([title, body]) => <div key={title}><b>{title}</b><span>{body}</span></div>)}
        </div>
      </section>

      <section className="tru-mission-section">
        <div className="tru-mission-section-head">
          <div className="tru-mission-label">The six-layer system</div>
          <p>Every answer moves through a defined surface. The online website adds reach; it does not replace the offline contract.</p>
        </div>
        <div className="tru-layer-grid">
          {LAYERS.map(([number, title, body]) => <div className="tru-layer" key={number}><div className="tru-layer-number">{number}</div><div><h3>{title}</h3><p>{body}</p></div></div>)}
        </div>
      </section>

      <section className="tru-mission-section tru-mission-boundary">
        <div className="tru-mission-section-head">
          <div className="tru-mission-label">What TRU is not</div>
          <p>Boundaries are part of the identity. A system that cannot say what it is not will eventually claim more authority than it has.</p>
        </div>
        <div className="tru-mission-not-grid">
          {["Not a personality theatre.", "Not a standalone deity or oracle.", "Not a public surface for private memory.", "Not a place for debug JSON or protocol chatter.", "Not a system that invents confidence when grounding is missing.", "Not a replacement for conscience, responsibility, or human judgement."].map((item) => <div key={item}>× &nbsp;{item}</div>)}
        </div>
      </section>

      <section className="tru-mission-section">
        <div className="tru-mission-section-head">
          <div className="tru-mission-label">Read the architecture</div>
          <p>The repository contains the mission, constitution, operating procedures, whitepaper, visual codex, reference implementations, and live chat.</p>
        </div>
        <div className="tru-doc-grid">
          {DOCUMENTS.map(([title, body, href]) => <a className="tru-doc" href={href.startsWith("/") ? siteUrl(href) : href} key={title}><b>{title} ↗</b><span>{body}</span></a>)}
        </div>
      </section>

      <footer className="tru-mission-footer">
        <span>TRU · truth-filter and reasoning system · 2026</span>
        <span>Truth is constant. Perspective is fluid. · <a href={siteUrl("/")}>enter the chat →</a></span>
      </footer>
    </main>
  );
}
