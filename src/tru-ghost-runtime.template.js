// TRU · GHOST RUNTIME — injected into the clean sovereign shell.
// Pure inline JS. No fetch, no XMLHttpRequest, no external scripts,
// no telemetry. Runs from file://.
//
// Build-time placeholders (replaced by server before serving):
//   __BRAIN__   — JSON.stringify of the full brain array
//   __KJV__     — JSON.stringify of the KJV lookup object
//   __SESSION__ — JSON.stringify of merged user state (text, notes, uploads)
//   __META__    — JSON.stringify of { baked, brain, kjv, uploads }
(function () {
  "use strict";

  const BRAIN   = __BRAIN__;
  const KJV     = __KJV__;
  const SESSION = __SESSION__ || {};
  const META    = __META__ || {};

  const STOP = new Set([
    "the","a","an","and","or","but","in","on","at","to","for","of","with","by","from",
    "is","was","are","be","been","being","have","has","had","do","does","did","done",
    "will","would","could","should","may","might","must","can","shall",
    "not","no","nor","so","if","it","its","that","this","these","those",
    "i","you","your","we","they","he","she","him","her","them","us","my","our","their",
    "what","when","where","why","who","whom","how","all","some","any","each","every",
    "tell","me","about","explain","define","describe","say","says","said"
  ]);

  const BOOK = {
    genesis:"gen",ge:"gen",gn:"gen",
    exodus:"exo",ex:"exo",exo:"exo",
    leviticus:"lev",le:"lev",lev:"lev",lv:"lev",
    numbers:"num",nu:"num",num:"num",nb:"num",
    deuteronomy:"deu",deut:"deu",deu:"deu",dt:"deu",
    joshua:"jos",josh:"jos",jos:"jos",jsh:"jos",
    judges:"jdg",judg:"jdg",jdg:"jdg",jdgs:"jdg",
    ruth:"rut",rut:"rut",rth:"rut",
    "1samuel":"1sa","1sa":"1sa","1sam":"1sa",
    "2samuel":"2sa","2sa":"2sa","2sam":"2sa",
    "1kings":"1ki","1ki":"1ki",
    "2kings":"2ki","2ki":"2ki",
    "1chronicles":"1ch","1ch":"1ch","1chr":"1ch",
    "2chronicles":"2ch","2ch":"2ch","2chr":"2ch",
    ezra:"ezr",ezr:"ezr",
    nehemiah:"neh",neh:"neh",
    esther:"est",est:"est",esth:"est",
    job:"job",jb:"job",
    psalms:"ps",psalm:"ps",psa:"ps",ps:"ps",
    proverbs:"pro",prov:"pro",pro:"pro",pr:"pro",
    ecclesiastes:"ecc",ecc:"ecc",eccl:"ecc",ec:"ecc",qoh:"ecc",
    songofsolomon:"sng","songofsongs":"sng",songs:"sng",sng:"sng",sos:"sng",
    isaiah:"isa",isa:"isa",is:"isa",
    jeremiah:"jer",jer:"jer",jr:"jer",
    lamentations:"lam",lam:"lam",
    ezekiel:"ezk",ezek:"ezk",eze:"ezk",ezk:"ezk",
    daniel:"dan",dan:"dan",dn:"dan",
    hosea:"hos",hos:"hos",
    joel:"jol",jol:"jol",
    amos:"amo",amo:"amo",
    obadiah:"oba",oba:"oba",obad:"oba",
    jonah:"jon",jon:"jon",
    micah:"mic",mic:"mic",
    nahum:"nam",nah:"nam",nam:"nam",
    habakkuk:"hab",hab:"hab",
    zephaniah:"zep",zeph:"zep",zep:"zep",
    haggai:"hag",hag:"hag",
    zechariah:"zec",zech:"zec",zec:"zec",
    malachi:"mal",mal:"mal",
    matthew:"mt",matt:"mt",mt:"mt",
    mark:"mk",mk:"mk",mar:"mk",mr:"mk",
    luke:"lk",lk:"lk",lu:"lk",
    john:"jn",jn:"jn",jhn:"jn",
    acts:"ac",ac:"ac",act:"ac",
    romans:"rom",rom:"rom",rm:"rom",
    "1corinthians":"1co","1cor":"1co","1co":"1co",
    "2corinthians":"2co","2cor":"2co","2co":"2co",
    galatians:"gal",gal:"gal",ga:"gal",
    ephesians:"eph",eph:"eph",
    philippians:"phil",phil:"phil",php:"phil",
    colossians:"col",col:"col",
    "1thessalonians":"1th","1thes":"1th","1thess":"1th","1th":"1th",
    "2thessalonians":"2th","2thes":"2th","2thess":"2th","2th":"2th",
    "1timothy":"1ti","1tim":"1ti","1ti":"1ti",
    "2timothy":"2ti","2tim":"2ti","2ti":"2ti",
    titus:"tit",tit:"tit",
    philemon:"phm",phm:"phm",
    hebrews:"heb",heb:"heb",
    james:"jas",jas:"jas",jam:"jas",
    "1peter":"1pe","1pet":"1pe","1pe":"1pe",
    "2peter":"2pe","2pet":"2pe","2pe":"2pe",
    "1john":"1jn","1jhn":"1jn","1jn":"1jn",
    "2john":"2jn","2jhn":"2jn","2jn":"2jn",
    "3john":"3jn","3jhn":"3jn","3jn":"3jn",
    jude:"jud",jud:"jud",
    revelation:"rev",rev:"rev",ap:"rev"
  };

  const FRAME_KEYS = ["answer_style","human_conversation_rule","tru_mission","tru_personal_mode","tru_honesty","tru_voice","tru_identity"];
  const FRAME_SET = new Set(FRAME_KEYS);
  const TYPE_PRIORITY = {
    identity: 60,
    rule: 45,
    wisdom: 40,
    knowledge: 36,
    concept: 32,
    fact: 30,
    dilemma: 28,
    document: 24,
    primer: 22,
    christ_attestation: 20,
    greek_theology: 18,
    hebrew_theology: 18,
    garden: 16,
    survival: 16,
    interaction: 14,
    ghost: 12,
    bible: 4,
    lexicon: 4,
  };
  const SOURCE_PRIORITY = { TRU_CORE: 10, TRU_BRAIN: 8, CERTIFIED: 7, KNOWLEDGE_BANK: 7, MANIFESTO: 4, TRU_TRUTH: 4, STARTER: 2 };

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[\u2019'`_]/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(s) {
    return norm(s).split(" ").filter(function (t) { return t.length > 1 && !STOP.has(t); });
  }

  function firstSentence(text, limit) {
    limit = limit || 220;
    var clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    var match = clean.match(/^(.+?[.!?])(?:\s|$)/);
    var sentence = match && match[1] ? match[1] : clean;
    if (sentence.length <= limit) return sentence;
    return sentence.slice(0, limit - 1).trimEnd() + "…";
  }

  function parseVerse(q) {
    var m = String(q || "").toLowerCase().trim().match(/^([1-3]?\s?[a-z]+)\s+(\d+)\s*[:.]\s*(\d+)/i);
    if (!m) return null;
    var raw = m[1].replace(/\s+/g, "").toLowerCase();
    var book = BOOK[raw] || raw;
    var chapter = parseInt(m[2], 10);
    var verse = parseInt(m[3], 10);
    var ref1 = book + " " + chapter + ":" + verse;
    var ref2 = book + chapter + ":" + verse;
    if (KJV[ref1]) return { ref: ref1, text: KJV[ref1] };
    if (KJV[ref2]) return { ref: ref2, text: KJV[ref2] };
    return null;
  }

  function classifyQuery(q) {
    var n = norm(q);
    if (/\b(who are you|what are you|what is tru|who is tru|your mission|your style|how do you answer|how do you think|tell me about yourself)\b/.test(n)) return "identity";
    if (/^\s*(define|what is|what are|explain|describe|tell me about|how does|how do|why is|why are)\b/.test(n)) return "definition";
    if (/\b(should|ought|dilemma|tradeoff|trade-off|choose|risk|what if|conflict|cost)\b/.test(n)) return "dilemma";
    return "topic";
  }

  function typeBonus(t, queryClass) {
    var kind = String(t || "").toLowerCase();
    var bonus = TYPE_PRIORITY[kind] || 0;
    if (queryClass === "identity") {
      if (kind === "identity") bonus += 30;
      if (kind === "rule" || kind === "wisdom") bonus += 18;
    } else if (queryClass === "definition") {
      if (kind === "concept" || kind === "fact" || kind === "knowledge") bonus += 12;
    } else if (queryClass === "dilemma") {
      if (kind === "dilemma" || kind === "rule" || kind === "wisdom") bonus += 14;
    } else {
      if (kind === "knowledge" || kind === "concept" || kind === "fact" || kind === "wisdom") bonus += 8;
    }
    return bonus;
  }

  function sourceBonus(source) {
    return SOURCE_PRIORITY[String(source || "")] || 0;
  }

  function scoreCandidate(node, qNorm, qTokens, queryClass) {
    var keyNorm = norm(node.k || "");
    var valueNorm = norm(node.v || "");
    var refNorm = norm(node.ref || "");
    var score = 0;

    if (keyNorm === qNorm) score += 140;
    if (keyNorm && qNorm && keyNorm.indexOf(qNorm) !== -1 && qNorm.length >= 3) score += 70;
    if (valueNorm && qNorm && valueNorm.indexOf(qNorm) !== -1 && qNorm.length >= 4) score += 55;
    if (refNorm && qNorm && refNorm.indexOf(qNorm) !== -1 && qNorm.length >= 4) score += 35;
    if (FRAME_SET.has(keyNorm)) score += 60;

    if (qTokens.length > 0) {
      var hay = new Set(tokenize((node.k || "") + " " + (node.v || "") + " " + (node.ref || "")));
      var hits = 0;
      for (var i = 0; i < qTokens.length; i++) if (hay.has(qTokens[i])) hits += 1;
      if (hits > 0) {
        var coverage = hits / Math.max(qTokens.length, hay.size || 1);
        score += coverage * 80;
        score += hits * 2;
      }
    }

    score += typeBonus(node.t, queryClass);
    score += sourceBonus(node.source);
    return score;
  }

  function firstMatch(nodes, predicate, excluded) {
    excluded = excluded || {};
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (excluded[n.k]) continue;
      if (predicate(n)) return n;
    }
    return null;
  }

  function pickFramingNode(scored) {
    for (var i = 0; i < scored.length; i++) {
      if (FRAME_SET.has(norm(scored[i].node.k))) return scored[i].node;
    }
    for (var j = 0; j < scored.length; j++) {
      var kind = String(scored[j].node.t || "").toLowerCase();
      if (kind === "identity" || kind === "rule" || kind === "wisdom") return scored[j].node;
    }
    return null;
  }

  function buildSynthesis(query, queryClass, nodes) {
    var qNorm = norm(query);
    var qTokens = tokenize(query);
    var scored = nodes
      .map(function (node) { return { node: node, score: scoreCandidate(node, qNorm, qTokens, queryClass) }; })
      .filter(function (item) { return item.score > 0; })
      .sort(function (a, b) { return b.score - a.score || (Number(b.node.w || 0) - Number(a.node.w || 0)); });

    if (scored.length === 0) {
      return {
        ok: true,
        kind: "brain",
        k: "",
        v: `I do not have a grounded node for "${query}". Teach me with: remember: ${query} = <your answer>`,
        t: "GAP",
        source: "TRU_CORE",
        score: 0,
        nodes: []
      };
    }

    var best = scored[0].node;
    var bestScore = scored[0].score;
    var rest = scored.slice(1).map(function (item) { return item.node; });
    var frame = pickFramingNode(scored);

    var whatItWas = firstSentence(best.v, 220);

    // Extract labelled sub-clauses from the lead node's value text first,
    // so nodes that embed "The hidden engine: ..." or "Why it mattered: ..."
    // get the full synthesis without needing a neighbour.
    var bestVText = String(best.v || "");
    function extractClause(label) {
      var re = new RegExp(
        "(?:^|[\\s\\.;\\(\\)\\-])" + label + "\\s*:\\s*([^\\n;]+(?:[\\n;](?!\\s*(?:Lesson|See also|Why|What|Hidden|Failure|What it teaches|Source|Note)\\s*:)[^\\n;]+)*)",
        "i"
      );
      var m = bestVText.match(re);
      if (!m) return "";
      return firstSentence(m[1], 180);
    }
    var embeddedHidden = extractClause("The hidden engine");
    var embeddedWhy = extractClause("Why it mattered");

    var whyItMattered = embeddedWhy || firstSentence(
      firstMatch(rest, function (n) {
        var kind = String(n.t || "").toLowerCase();
        return kind === "knowledge" || kind === "concept" || kind === "fact" || kind === "wisdom";
      })?.v || (frame && frame.v) || "",
      180
    );
    var hiddenEngine = embeddedHidden || firstSentence(
      firstMatch(rest, function (n) {
        var kind = String(n.t || "").toLowerCase();
        return kind === "rule" || kind === "wisdom" || kind === "knowledge" || kind === "concept" || kind === "fact";
      })?.v || "",
      180
    );
    var failureMode = firstSentence(
      firstMatch(rest, function (n) { return String(n.t || "").toLowerCase() === "dilemma"; })?.v ||
        firstMatch(rest, function (n) {
          var kind = String(n.t || "").toLowerCase();
          return kind === "rule" || kind === "wisdom";
        })?.v ||
        "",
      180
    );
    var teachesNow = firstSentence(
      (frame && frame.v) ||
        firstMatch(rest, function (n) {
          var kind = String(n.t || "").toLowerCase();
          return kind === "identity" || kind === "rule" || kind === "wisdom";
        })?.v ||
        "",
      180
    );

    var text = "";
    if (queryClass === "identity") {
      text = teachesNow || whatItWas;
      var extra = [whyItMattered, hiddenEngine, failureMode].filter(Boolean);
      if (extra.length) text += "\nRelated: " + extra.join(" | ");
    } else if (bestScore >= 18) {
      var lines = [
        `What it was: ${whatItWas}`,
        whyItMattered ? `Why it mattered: ${whyItMattered}` : "",
        hiddenEngine ? `Hidden engine: ${hiddenEngine}` : "",
        failureMode ? `Failure mode: ${failureMode}` : "",
        teachesNow ? `What it teaches now: ${teachesNow}` : "",
      ].filter(Boolean);
      text = lines.join("\n");
    } else {
      var closests = scored.slice(0, 3).map(function (item) { return firstSentence(item.node.v, 120); }).filter(Boolean);
      text = `I do not have a grounded node for "${query}".`;
      if (closests.length) text += " Closest: " + closests.join(" · ");
      if (teachesNow) text += "\nFrame: " + teachesNow;
      text += `\nTeach me with: remember: ${query} = <your answer>`;
    }

    return {
      ok: true,
      kind: "brain",
      k: best.k,
      v: text,
      t: bestScore >= 18 ? String(best.t || "SYNTHESIS").toUpperCase() : "GAP",
      source: best.source || "TRU_CORE",
      score: Math.min(99, Math.round(bestScore)),
      nodes: scored.slice(0, 5).map(function (item) { return item.node.k + ":" + (item.node.t || ""); })
    };
  }

  function lookup(q) {
    if (!q) return null;
    var v = parseVerse(q);
    if (v) {
      return { kind: "scripture", text: v.text, ref: v.ref, score: 100 };
    }
    var queryClass = classifyQuery(q);
    return buildSynthesis(q, queryClass, BRAIN);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderAnswer(r) {
    if (!r) return "";
    if (r.kind === "scripture") {
      return '<div class="verdict scripture">SCRIPTURE · ' + r.score + '% · ' + esc(r.ref) + '</div>' +
             '<div class="answer">' + esc(r.text) + '<span class="src">KJV</span></div>';
    }
    if (r.kind === "brain") {
      return '<div class="verdict">' + esc(r.t || "TRUTH") + ' · ' + r.score + '%' +
             (r.source ? ' · ' + esc(r.source) : '') + '</div>' +
             '<div class="answer">' + esc(r.text) +
             (r.ref ? '<span class="src">ref: ' + esc(r.ref) + '</span>' : '') +
             '</div>';
    }
    return '<div class="verdict unknown">UNKNOWN</div>' +
           '<div class="answer">' + esc(r.text) + '</div>';
  }

  function renderNotes() {
    var panel = document.getElementById("notesPanel");
    var body  = document.getElementById("notesBody");
    var text  = (SESSION && (SESSION.notes || SESSION.text)) || "";
    if (!text) { panel.style.display = "none"; return; }
    panel.style.display = "";
    body.innerHTML = '<p>' + esc(text) + '</p>';
  }

  function renderUploads() {
    var uploads = (SESSION && Array.isArray(SESSION.uploads)) ? SESSION.uploads : [];
    var images  = uploads.filter(function (u) { return u.kind === "image"; });
    var files   = uploads.filter(function (u) { return u.kind === "file"; });

    var gPanel = document.getElementById("uploadsPanel");
    var gBody  = document.getElementById("galleryBody");
    if (images.length === 0) {
      gPanel.style.display = "none";
    } else {
      gPanel.style.display = "";
      gBody.innerHTML = '<div class="gallery-grid">' + images.map(function (img) {
        return '<figure>' +
                 '<img src="' + esc(img.data) + '" alt="' + esc(img.name) + '">' +
                 '<figcaption>' + esc(img.name) + '</figcaption>' +
               '</figure>';
      }).join("") + '</div>';
    }

    var fPanel = document.getElementById("filesPanel");
    var fBody  = document.getElementById("filesBody");
    if (files.length === 0) {
      fPanel.style.display = "none";
    } else {
      fPanel.style.display = "";
      fBody.innerHTML = '<ul>' + files.map(function (f) {
        var sz = (f.size != null) ? humanBytes(f.size) : '—';
        return '<li>' +
                 '<span class="nm">' + esc(f.name) + '</span>' +
                 '<span class="sz">' + esc(sz) + '</span>' +
                 '<a href="' + esc(f.data) + '" download="' + esc(f.name) + '">save</a>' +
               '</li>';
      }).join("") + '</ul>';
    }

    document.getElementById("statImg").textContent = String(images.length);
    document.getElementById("statFiles").textContent = String(files.length);
  }

  function humanBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function renderStats() {
    document.getElementById("statBrain").textContent = (BRAIN.length || 0).toLocaleString();
    document.getElementById("statKjv").textContent   = (Object.keys(KJV).length || 0).toLocaleString();
    document.getElementById("statImg").textContent    = "0";
    document.getElementById("statFiles").textContent  = "0";
    if (META.baked) document.getElementById("ts").textContent = "baked " + META.baked;
    var meta = document.getElementById("meta");
    if (meta) meta.textContent = "ghost · " + (META.uploads || 0) + " uploads · " + (BRAIN.length || 0) + " brain · " + (Object.keys(KJV).length || 0) + " kjv";
  }

  function ask() {
    var qEl = document.getElementById("q");
    var out = document.getElementById("out");
    var q = qEl.value.trim();
    if (!q) return;
    var r = lookup(q);
    if (!r) {
      out.innerHTML = '<div class="out unknown">' + renderAnswer({ kind: "unknown", text: "No match.", score: 0 }) + '</div>';
    } else {
      var klass = (r.kind === "scripture") ? "scripture" : (r.kind === "unknown" ? "unknown" : "");
      out.innerHTML = '<div class="out ' + klass + '">' + renderAnswer(r) + '</div>';
    }
    qEl.value = "";
    qEl.focus();
  }

  function boot() {
    renderStats();
    renderNotes();
    renderUploads();
    document.getElementById("askBtn").addEventListener("click", ask);
    document.getElementById("q").addEventListener("keydown", function (e) {
      if (e.key === "Enter") ask();
    });
    var qEl = document.getElementById("q");
    if (qEl) qEl.focus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
