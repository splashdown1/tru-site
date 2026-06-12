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

  // ────────────────────────────────────────────────────────────
  // DATA
  // ────────────────────────────────────────────────────────────
  const BRAIN   = __BRAIN__;
  const KJV     = __KJV__;
  const SESSION = __SESSION__ || {};
  const META    = __META__ || {};

  // ────────────────────────────────────────────────────────────
  // ROUTING (mirrors server /api/tru/ask)
  // ────────────────────────────────────────────────────────────
  const STOP = new Set([
    "the","a","an","and","or","but","in","on","at","to","for","of","with","by","from",
    "is","was","are","be","been","being","have","has","had","do","does","did","done",
    "will","would","could","should","may","might","must","can","shall",
    "not","no","nor","so","if","it","its","that","this","these","those",
    "i","you","your","we","they","he","she","him","her","them","us","my","our","their",
    "what","when","where","why","who","whom","how","all","some","any","each","every"
  ]);

  const BOOK = {
    // OT
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
    // NT
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

  function tok(s) {
    return (s || "").toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(function (w) { return w.length > 1 && !STOP.has(w); });
  }

  function parseVerse(q) {
    var m = (q || "").toLowerCase().trim().match(/^([1-3]?\s?[a-z]+)\s+(\d+)\s*[:.]\s*(\d+)/i);
    if (!m) return null;
    var raw = m[1].replace(/\s+/g, "").toLowerCase();
    var book = BOOK[raw] || raw;
    var chapter = parseInt(m[2], 10);
    var verse = parseInt(m[3], 10);
    var ref1 = book + " " + chapter + ":" + verse;
    var ref2 = book + chapter + ":" + verse; // kjv_lookup uses no space for digit-prefixed books
    if (KJV[ref1]) return { ref: ref1, text: KJV[ref1] };
    if (KJV[ref2]) return { ref: ref2, text: KJV[ref2] };
    // last-ditch: try compressing book code (e.g. "1jn" -> "1jn" already; some keys use shorter codes)
    return null;
  }

  function scoreBrain(node, queryTokens) {
    if (!queryTokens.length) return 0;
    var haystack = ((node.k || "") + " " + (node.v || "")).toLowerCase();
    var hits = 0;
    for (var i = 0; i < queryTokens.length; i++) {
      if (haystack.indexOf(queryTokens[i]) !== -1) hits++;
    }
    if (!hits) return 0;
    var coverage = hits / queryTokens.length;
    return coverage * (node.w || 0.5);
  }

  function lookup(q) {
    if (!q) return null;
    var ql = q.toLowerCase().trim();

    // 1. Scripture shortcut
    var v = parseVerse(ql);
    if (v) {
      return { kind: "scripture", text: v.text, ref: v.ref, score: 100 };
    }

    // 2. Exact key match
    for (var i = 0; i < BRAIN.length; i++) {
      if ((BRAIN[i].k || "").toLowerCase() === ql) {
        return {
          kind: "brain",
          text: BRAIN[i].v || "",
          t: BRAIN[i].t || "TRUTH",
          ref: BRAIN[i].ref,
          source: BRAIN[i].source,
          score: 95
        };
      }
    }

    // 3. Token-coverage ranking
    var qt = tok(ql);
    if (!qt.length) return null;
    var hits = [];
    for (var j = 0; j < BRAIN.length; j++) {
      var sc = scoreBrain(BRAIN[j], qt);
      if (sc > 0.05) hits.push({ n: BRAIN[j], s: sc });
    }
    hits.sort(function (a, b) { return b.s - a.s; });
    if (hits.length) {
      var top = hits[0];
      return {
        kind: "brain",
        text: top.n.v || "",
        t: top.n.t || "TRUTH",
        ref: top.n.ref,
        source: top.n.source,
        score: Math.round(Math.min(top.s * 100, 99))
      };
    }

    // 4. Session-memory fallback (user's own notes)
    if (SESSION.notes) {
      var noteLow = SESSION.notes.toLowerCase();
      var qLow = ql;
      if (noteLow.indexOf(qLow) !== -1 || qLow.length < 12) {
        return {
          kind: "brain",
          text: SESSION.notes,
          t: "NOTE",
          source: "session",
          score: 60
        };
      }
    }

    return { kind: "unknown", text: "No match. Ask differently, or teach: remember: " + q + " = <your answer>.", score: 0 };
  }

  // ────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────
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

    // Gallery
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

    // Files
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

    document.getElementById("statImg").textContent    = String(images.length);
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

  // ────────────────────────────────────────────────────────────
  // BOOT (file:// safe — no network)
  // ────────────────────────────────────────────────────────────
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
