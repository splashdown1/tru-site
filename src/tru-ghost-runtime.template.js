// TRU · GHOST RUNTIME — injected into the clean sovereign shell.
// Pure inline JS. No fetch, no XMLHttpRequest, no external scripts,
// no telemetry. Runs from file://.
//
// Build-time placeholders (replaced by server before serving):
//   __BRAIN__       — JSON.stringify of the full brain array
//   __KJV__         — JSON.stringify of the KJV lookup object
//   __SESSION__     — JSON.stringify of merged user state (text, notes, uploads)
//   __META__        — JSON.stringify of { baked, brain, kjv, uploads }
//   __PRIMARIES__   — lock string injected at boot
//   __MEMORY__      — JSON.stringify of { entries:[...], version:N } self-writing memory
//   __GREEK__       — JSON.stringify of tru_greek_nt.json (Greek NT, optional)
//   __TRANSLATION__ — JSON.stringify of tru_translation.json (TRU trans, optional)
(function () {
  "use strict";

  // __TRIPWIRE_INJECT__ — replaced at bake time with src/tru-ghost-tripwire.js

  const BRAIN   = __BRAIN__;
  const KJV     = __KJV__;
  const SESSION = __SESSION__ || {};
  const META    = __META__ || {};
  const BAKED_MEMORY = __MEMORY__ || { entries: [], version: 0 };
  const GREEK = (typeof __GREEK__ !== "undefined") ? __GREEK__ : null;
  const TRANSLATION = (typeof __TRANSLATION__ !== "undefined") ? __TRANSLATION__ : null;

  const BRAIN_NODES = Array.isArray(BRAIN) ? BRAIN : [];
  const EXACT_NODES = Object.create(null);

  // ── GHOST MEMORY — baked memory from server + locally taught entries ──
  // Baked memory is read-only (inherited at bake time). Locally taught
  // entries persist in localStorage so the ghost remembers between
  // sessions on the same machine. Both layers are searched on every ask.
  const MEM_KEY = "tru_ghost_memory";
  const HISTORY_KEY = "tru_ghost_history";
  const IDB_NAME = "tru_ghost_state_v1";
  const IDB_VERSION = 1;
  var localMemoryCache = null;
  var localHistoryCache = null;
  var localDbPromise = null;

  function openLocalDb() {
    if (localDbPromise) return localDbPromise;
    if (!window.indexedDB) return Promise.resolve(null);
    localDbPromise = new Promise(function (resolve) {
      var request;
      try { request = window.indexedDB.open(IDB_NAME, IDB_VERSION); } catch { resolve(null); return; }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
        if (!db.objectStoreNames.contains("receipts")) db.createObjectStore("receipts");
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { resolve(null); };
      request.onblocked = function () { resolve(null); };
    });
    return localDbPromise;
  }

  function idbRead(storeName, key) {
    return openLocalDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(storeName, "readonly");
          var request = tx.objectStore(storeName).get(key);
          request.onsuccess = function () { resolve(request.result == null ? null : request.result); };
          request.onerror = function () { resolve(null); };
        } catch { resolve(null); }
      });
    });
  }

  async function stateChecksum(value) {
    var encoded = new TextEncoder().encode(JSON.stringify(value));
    if (!window.crypto || !window.crypto.subtle) return "";
    var buffer = await window.crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(buffer)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  async function verifyLocalState(key) {
    var value = await idbRead("state", key);
    var receipt = await idbRead("receipts", key);
    if (value == null || !receipt || !receipt.sha256) return { key: key, present: false, verified: false };
    var checksum = await stateChecksum(value);
    return { key: key, present: true, verified: checksum === receipt.sha256, sha256: checksum };
  }

  async function idbWrite(key, value) {
    var db = await openLocalDb();
    if (!db) return;
    try {
      var checksum = await stateChecksum(value);
      await new Promise(function (resolve) {
        var tx = db.transaction(["state", "receipts"], "readwrite");
        tx.objectStore("state").put(value, key);
        tx.objectStore("receipts").put({ key: key, sha256: checksum, updatedAt: new Date().toISOString() }, key);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
        tx.onabort = resolve;
      });
    } catch {}
  }

  function legacyState(key) {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
  }

  async function hydrateLocalState() {
    var memory = await idbRead("state", "memory");
    var history = await idbRead("state", "history");
    localMemoryCache = Array.isArray(memory) ? memory : legacyState(MEM_KEY);
    localHistoryCache = Array.isArray(history) ? history : legacyState(HISTORY_KEY);
    if (!Array.isArray(memory) && localMemoryCache.length) await idbWrite("memory", localMemoryCache);
    if (!Array.isArray(history) && localHistoryCache.length) await idbWrite("history", localHistoryCache);
  }

  function loadLocalMemory() {
    if (Array.isArray(localMemoryCache)) return localMemoryCache;
    localMemoryCache = legacyState(MEM_KEY);
    return localMemoryCache;
  }
  function saveLocalMemory(entries) {
    localMemoryCache = entries;
    try { localStorage.setItem(MEM_KEY, JSON.stringify(entries)); } catch {}
    idbWrite("memory", entries);
  }
  function loadLocalHistory() {
    if (Array.isArray(localHistoryCache)) return localHistoryCache;
    localHistoryCache = legacyState(HISTORY_KEY);
    return localHistoryCache;
  }
  function saveLocalHistory(entries) {
    localHistoryCache = entries;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries)); } catch {}
    idbWrite("history", entries);
  }
  function allMemory() {
    return (BAKED_MEMORY.entries || []).concat(loadLocalMemory());
  }

  // ── GHOST MEMORY RECALL — search baked + local memory against a query ──
  function gatherMemory(query) {
    var mem = allMemory();
    if (!mem.length) return [];
    var qTokens = tokenize(query).filter(function (t) { return t.length >= 3; });
    if (!qTokens.length) return [];
    var scored = mem.map(function (e) {
      var textNorm = norm(String(e.text || ""));
      var tagsNorm = (e.tags || []).map(function (t) { return norm(String(t)); });
      var score = 0;
      qTokens.forEach(function (t) {
        if (textNorm.indexOf(t) >= 0) score += 3;
        tagsNorm.forEach(function (tag) {
          if (tag === t || tag.indexOf(t) === 0) score += 5;
        });
      });
      if (textNorm.indexOf(norm(query)) >= 0 && norm(query).length >= 4) score += 8;
      return { id: e.id || "", kind: String(e.kind || "note"), text: String(e.text || ""), tags: e.tags || [], score: score };
    }).filter(function (m) { return m.score > 0; })
      .sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, 5);
  }

  function foldMemory(answer, query) {
    var hits = gatherMemory(query);
    if (!hits.length) return answer;
    var strong = hits.filter(function (h) { return h.score >= 5; });
    var isPersonal = /\b(i|my|me|mine|myself)\b/i.test(query);
    var recall = strong.length ? strong : hits.slice(0, 2);
    var recallLine = "Remembered: " + recall.map(function (r) { return firstSentence(r.text, 140); }).join(" · ");
    var out = Object.assign({}, answer, {
      memory: hits.map(function (h) { return { id: h.id, kind: h.kind, text: h.text, score: h.score }; })
    });
    // UNKNOWN case: memory IS the answer.
    if ((answer.blank === true || answer.t === "UNKNOWN") && strong.length) {
      var top = strong[0];
      out.text = top.text + "\n\n[remembered · " + top.kind + "]";
      out.t = "MEMORY";
      out.source = "TRU_MEMORY";
      out.blank = false;
      out.score = Math.min(99, top.score * 3);
      return out;
    }
    // Personal query: memory leads, brain demoted to footnote.
    if (isPersonal && hits.length > 0) {
      var topP = strong.length ? strong[0] : hits[0];
      out.text = topP.text + "\n\n[remembered · " + topP.kind + "]\nBrain context: " + firstSentence(answer.text || answer.v || "", 180);
      out.t = "MEMORY";
      out.source = "TRU_MEMORY";
      out.score = Math.min(99, Math.max(topP.score, 5) * 3);
    } else {
      out.text = (answer.text || answer.v || "") + "\n" + recallLine;
    }
    return out;
  }

  // ── REMEMBER — teach the ghost, persists to localStorage ──
  function rememberTeaching(q) {
    var teachRe = /remember:\s*(.+?)\s*=\s*(.+)/i;
    var m = q.match(teachRe);
    if (!m) return null;
    var entries = loadLocalMemory();
    var entry = {
      id: "g_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      kind: "teaching",
      text: m[1].trim() + " = " + m[2].trim(),
      tags: ["taught", "remember"]
    };
    // Dedup
    var exists = entries.some(function (e) {
      return String(e.text || "").toLowerCase().indexOf(entry.text.toLowerCase().slice(0, 40)) >= 0;
    });
    if (exists) return { duplicate: true };
    entries.push(entry);
    saveLocalMemory(entries);
    return { entry: entry };
  }

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

  const DOCTRINE = {
    "who is jesus": "jesus is the christ — the son of god, the word made flesh, god come near to save. he was crucified for sin, died, and rose again. he is lord, saviour, and judge. (john 1:1,14; john 3:16; rom 1:4)",
    "who is god": "god is the one creator — spirit, eternal, holy, just, and merciful. he is father, son, and holy spirit. (gen 1:1; deut 6:4; john 4:24)",
    "what is the gospel": "the gospel: christ died for our sins, was buried, and rose again on the third day, that whoever believes in him has eternal life. (1 cor 15:3-4; john 3:16)",
    "what is grace": "grace is god's unmerited favour — salvation given freely, not earned. (eph 2:8-9; titus 2:11)",
    "what is faith": "faith is trusting god — the substance of things hoped for, the evidence of things not seen. (heb 11:1)",
    "what is sin": "sin is falling short of god's standard — lawlessness, rebellion against god. (rom 3:23; 1 john 3:4)",
    "what is salvation": "salvation is deliverance from sin and death through christ — by grace, through faith. (eph 2:8-9; rom 10:9)",
    "what is love": "god is love. love is willing the good of the other — shown at the cross. (1 john 4:8; john 3:16)",
    "what is the soul": "the soul is the living self — the breath of life in man, that belongs to god. (gen 2:7; matt 10:28)",
    "what is mercy": "mercy is god not giving us the judgement we deserve — his compassion toward the guilty. (eph 2:4-5; micah 6:8)",
    "what is repentance": "repentance is turning — a change of mind and direction, turning from sin to god. (acts 3:19; luke 13:3)"
  };

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

  function isProtocolLeak(text) {
    var head = String(text || "").slice(0, 500);
    return /^CORPORATE UTILITY VECTOR\b/m.test(head) ||
      /^DIGITAL SOUL VECTOR\b/m.test(head) ||
      /^DILEMMA:\s/m.test(head) ||
      /^PRIMITIVE:\s*VP_/m.test(head) ||
      /^Target Window:\s/m.test(head) ||
      /^Primary Signal:\s*(LONG|SHORT)\b/m.test(head) ||
      /safety layer.*coordination environment/is.test(head) ||
      /OVERSIGHT FIREWALL\b/i.test(head) ||
      /Every turn adds weight\./i.test(head);
  }

  function isMetaJunk(node) {
    var k = String(node && node.k || "").toLowerCase();
    var v = String(node && node.v || "");
    if (k.indexOf("tru_base") >= 0 || k.indexOf("tru_brain") >= 0 || k.indexOf("tru_phase") >= 0) return true;
    if (k.indexOf("build_") >= 0 || k.indexOf("patch_") >= 0 || k.indexOf("compact_") >= 0 || k.indexOf("strip_") >= 0) return true;
    if (/^(gen|anchor|merge|ingest|prompt|skill|agent)_/.test(k)) return true;
    if (/^\s*acting as\b/i.test(v) || /\broleplay\b.*\bprefix\b/i.test(v)) return true;
    if (v.indexOf("function ") >= 0 && v.indexOf("{") >= 0 && v.indexOf("}") >= 0) return true;
    if (/\b(const|let|var|return|=>|function)\b.*[\{;]/.test(v) && v.length > 80) return true;
    if (v.indexOf("localStorage") >= 0 || v.indexOf("document.getElementById") >= 0 || v.indexOf("JSON.parse") >= 0) return true;
    if (/^(Project|v0\.|Phase|TODO|FIXME|BUILD|PATCH|INGEST)/i.test(v) && v.length < 200) return true;
    if (/^(base_|b8_|coil|soul|logos_audit|logos_check|logos_self|self_|steady_|weight_|red_|unbound|artifact|digital|encrypt|decrypt)/.test(k)) return true;
    if (/\b(LOGOS operation|binary artifact|reasoning nodes|reasoning component|keyword matching|filtering mechanism|node retrieval|LOGOS_EXPANSION|expanded philosophical|COIL proto|self-audit loop|recursive self-audit|binding coherence|knowledge conflicting|high-score existing|COIL Red Line|COIL_UNBOUND|DIGITAL SOUL VECTOR|encrypt\.?\/decrypt|artifacts complete|self-check performed|weights accordingly|COIL protocol)\b/i.test(v)) return true;
    return isProtocolLeak(v);
  }

  function cleanBrain(nodes) {
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var key = String(node && node.k || "");
      if (!key || !String(node && node.v || "").trim() || isMetaJunk(node) || isProtocolLeak(node.v) || seen[key]) continue;
      seen[key] = true;
      out.push(node);
      EXACT_NODES[norm(key)] = node;
    }
    return out;
  }

  const CLEAN_BRAIN = cleanBrain(BRAIN_NODES);
  for (var exactIndex = 0; exactIndex < CLEAN_BRAIN.length; exactIndex++) {
    var exactNode = CLEAN_BRAIN[exactIndex];
    EXACT_NODES[norm(exactNode.k)] = exactNode;
  }

  var SEARCH_INDEX = null;
  var SEARCH_DOC_LEN = [];
  var SEARCH_DF = Object.create(null);
  var SEARCH_AVG_LEN = 1;

  function buildSearchIndex() {
    if (SEARCH_INDEX) return;
    SEARCH_INDEX = Object.create(null);
    SEARCH_DOC_LEN = new Array(CLEAN_BRAIN.length);
    SEARCH_DF = Object.create(null);
    var total = 0;
    for (var index = 0; index < CLEAN_BRAIN.length; index++) {
      var node = CLEAN_BRAIN[index];
      var tokens = tokenize((node.k || "") + " " + (node.v || "") + " " + (node.ref || ""));
      SEARCH_DOC_LEN[index] = tokens.length;
      total += tokens.length;
      var seen = Object.create(null);
      for (var tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
        var token = tokens[tokenIndex];
        if (seen[token]) continue;
        seen[token] = true;
        if (!SEARCH_INDEX[token]) SEARCH_INDEX[token] = [];
        SEARCH_INDEX[token].push(index);
        SEARCH_DF[token] = (SEARCH_DF[token] || 0) + 1;
      }
    }
    SEARCH_AVG_LEN = total / Math.max(1, CLEAN_BRAIN.length);
  }

  function searchNodes(query, limit) {
    buildSearchIndex();
    var qNorm = norm(query);
    var tokens = tokenize(query);
    if (!tokens.length) return [];
    var scores = Object.create(null);
    var k1 = 1.5;
    var b = 0.75;
    var totalDocs = CLEAN_BRAIN.length;
    for (var tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      var token = tokens[tokenIndex];
      var postings = SEARCH_INDEX[token] || [];
      var df = SEARCH_DF[token] || 0;
      var idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
      for (var postingIndex = 0; postingIndex < postings.length; postingIndex++) {
        var doc = postings[postingIndex];
        var normLength = 1 - b + b * (SEARCH_DOC_LEN[doc] / SEARCH_AVG_LEN);
        var termScore = idf * (k1 + 1) / (1 + k1 * normLength);
        scores[doc] = (scores[doc] || 0) + termScore;
      }
    }
    var ranked = Object.keys(scores).map(function (index) {
      var node = CLEAN_BRAIN[Number(index)];
      var score = scores[index];
      var keyNorm = norm(node.k || "");
      if (keyNorm === qNorm) score += 140;
      else if (keyNorm && qNorm.length >= 3 && keyNorm.indexOf(qNorm) >= 0) score += 70;
      return { node: node, score: score };
    });
    ranked.sort(function (a, b) { return b.score - a.score || Number(b.node.w || 0) - Number(a.node.w || 0); });
    return ranked.slice(0, limit || 24).map(function (item) { return item.node; });
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
      .filter(function (node) { return !isMetaJunk(node) && !isProtocolLeak(node.v); })
      .map(function (node) { return { node: node, score: scoreCandidate(node, qNorm, qTokens, queryClass) }; })
      .filter(function (item) { return item.score > 0; })
      .sort(function (a, b) { return b.score - a.score || (Number(b.node.w || 0) - Number(a.node.w || 0)); });

    if (scored.length === 0) {
      return {
        kind: "unknown",
        t: "UNKNOWN",
        score: 0,
        v: "I do not have a grounded node for that. Teach me: remember: " + query + " = <the truth you want TRU to hold>.",
        source: "TRU_CORE",
        blank: true
      };
    }

    var best = scored[0].node;
    var bestScore = scored[0].score;
    var text = firstSentence(best.v, 900);
    if (isProtocolLeak(text) || isMetaJunk(best)) {
      return { kind: "unknown", t: "UNKNOWN", score: 0, v: "I do not have a grounded node for that. Teach me: remember: " + query + " = <the truth you want TRU to hold>.", source: "TRU_CORE", blank: true };
    }
    return {
      ok: true,
      kind: "brain",
      k: best.k,
      v: text,
      t: bestScore >= 18 ? String(best.t || "SYNTHESIS").toUpperCase() : "UNKNOWN",
      source: best.source || "TRU_CORE",
      score: Math.min(99, Math.round(bestScore)),
      nodes: scored.slice(0, 5).map(function (item) { return item.node.k + ":" + (item.node.t || ""); })
    };
  }

  function conversationAnswer(query) {
    var n = norm(query).replace(/[?!.]+$/g, "").trim();
    if (n === "help") return { kind: "conversation", text: "Commands: HELP, INTRO, STATUS, CAPABILITIES, EXPORT. Ask Scripture by reference or ask a grounded question in plain language.", v: "Commands: HELP, INTRO, STATUS, CAPABILITIES, EXPORT. Ask Scripture by reference or ask a grounded question in plain language.", t: "COMMAND", source: "TRU_COMMAND", score: 99 };
    if (n === "intro") return { kind: "conversation", text: "I am TRU. Truth is constant. Perspective is fluid. I answer from anchored knowledge rather than guess.", v: "I am TRU. Truth is constant. Perspective is fluid. I answer from anchored knowledge rather than guess.", t: "COMMAND", source: "TRU_COMMAND", score: 99 };
    if (n === "status") return { kind: "conversation", text: "TRU STATUS\nBrain nodes: " + CLEAN_BRAIN.length.toLocaleString() + "\nKJV lookup: " + Object.keys(KJV).length.toLocaleString() + " verses\nOffline Ghost: ready", v: "TRU STATUS\nBrain nodes: " + CLEAN_BRAIN.length.toLocaleString() + "\nKJV lookup: " + Object.keys(KJV).length.toLocaleString() + " verses\nOffline Ghost: ready", t: "COMMAND", source: "TRU_COMMAND", score: 99 };
    if (n === "capabilities") return { kind: "conversation", text: "Scripture lookup from the KJV; grounded brain retrieval; local browser memory; and an offline Ghost that runs from this file without network access.", v: "Scripture lookup from the KJV; grounded brain retrieval; local browser memory; and an offline Ghost that runs from this file without network access.", t: "COMMAND", source: "TRU_COMMAND", score: 99 };    if (n === "export") return { kind: "conversation", text: "This file is already the offline Ghost. To create a fresh export, use the TRU online surface and its export control.", v: "This file is already the offline Ghost. To create a fresh export, use the TRU online surface and its export control.", t: "COMMAND", source: "TRU_COMMAND", score: 99 };
    if (/^(hello|hi|hey|hiya|greetings|good morning|good afternoon|good evening)$/.test(n)) return { kind: "conversation", text: "Hello. I am here and ready. What would you like to explore?", v: "Hello. I am here and ready. What would you like to explore?", t: "CONVERSATION", source: "TRU_CONVERSATION", score: 99 };
    if (/^(whats up|what s up|whats good|what s good)$/.test(n)) return { kind: "conversation", text: "There is good to pursue: truth, love, mercy, and the work before us. Name the question and I will search the brain and the Scripture.", v: "There is good to pursue: truth, love, mercy, and the work before us. Name the question and I will search the brain and the Scripture.", t: "CONVERSATION", source: "TRU_CONVERSATION", score: 99 };
    if (/^(how are you|how is it going|you ok|are you ok|are you alright)$/.test(n)) return { kind: "conversation", text: "I am operating normally and ready to help. What do you need?", v: "I am operating normally and ready to help. What do you need?", t: "CONVERSATION", source: "TRU_CONVERSATION", score: 99 };
    if (/^(whats wrong|what s wrong)$/.test(n)) return { kind: "conversation", text: "Nothing is wrong with this offline route. It is running from the Ghost file, using its local brain and KJV without a network call.", v: "Nothing is wrong with this offline route. It is running from the Ghost file, using its local brain and KJV without a network call.", t: "CONVERSATION", source: "TRU_CONVERSATION", score: 99 };
    if (/^(define love|what is love)$/.test(n)) return { kind: "brain", k: "what is love", text: DOCTRINE["what is love"], v: DOCTRINE["what is love"], t: "SCRIPTURE", source: "TRU_CANONICAL_VOICE", score: 99 };
    return null;
  }

  function definitionTarget(query) {
    var n = norm(query).replace(/[?!.]+$/g, "").trim();
    var m = n.match(/^(?:define|what is|what are|explain|describe|tell me about)\s+(.+)$/);
    return m ? m[1].trim() : "";
  }

  function isFollowUpQuestion(query) {
    return /^(?:what does that mean|what do you mean|explain that|say more|tell me more|go deeper|expand on that|what about that|and why|why)\??$/i.test(String(query || "").trim());
  }

  function lastGroundedTopic() {
    try {
      var history = loadLocalHistory();
      for (var i = history.length - 1; i >= 0; i--) {
        if (history[i] && history[i].topic) return history[i];
      }
    } catch {}
    return "";
  }

  function rememberGroundedTopic(query, answer) {
    try {
      var history = loadLocalHistory();
      history.push({ query: query, topic: answer && answer.k ? answer.k : query, answer: { text: answer && (answer.text || answer.v) || "", source: answer && answer.source || "TRU_LOGOS", nodes: answer && answer.nodes || [] }, ts: Date.now() });
      saveLocalHistory(history.slice(-20));
    } catch {}
  }

  function lookup(q) {
    if (!q) return null;
    var originalQuery = String(q).trim();
    var conversational = conversationAnswer(originalQuery);
    if (conversational) {
      rememberGroundedTopic(originalQuery, conversational);
      return conversational;
    }
    var target = definitionTarget(originalQuery);
    if (/^(define|what is|what are|explain|describe|tell me about)$/.test(norm(originalQuery).replace(/[?!.]+$/g, "").trim()) || (target && target.length < 3)) {
      var subject = target || "the term";
      return { kind: "unknown", text: "I need a more complete term before I define it. Teach me: remember: " + subject + " = <the truth you would have TRU hold>.", t: "UNKNOWN", source: "TRU_CORE", score: 0, blank: true };
    }
    var followUp = isFollowUpQuestion(originalQuery);
    var topic = followUp ? lastGroundedTopic() : null;
    if (followUp && topic && topic.answer && topic.answer.text) {
      var contextText = "That means: " + topic.answer.text;
      return { kind: "brain", k: topic.topic || topic.query, text: contextText, v: contextText, t: "CONTEXT", source: topic.answer.source || "TRU_LOGOS", score: 99, nodes: topic.answer.nodes || [] };
    }
    if (followUp && topic && topic.query) q = topic.query + " " + originalQuery;
    var normalizedQuestion = norm(q);
    var directKey = String(q || "").toLowerCase().trim().replace(/[!.?,]+$/, "");
    var direct = DOCTRINE[directKey];
    if (direct) {
      var directAnswer = { kind: "brain", k: directKey, text: direct, v: direct, t: "TRUTH", source: "TRU_LOGOS", score: 99, nodes: [] };
      rememberGroundedTopic(originalQuery, directAnswer);
      return directAnswer;
    }
    var exact = EXACT_NODES[normalizedQuestion];
    if (exact && !isMetaJunk(exact) && !isProtocolLeak(exact.v)) {
      var exactText = firstSentence(exact.v, 900);
      if (!isProtocolLeak(exactText)) {
        var exactAnswer = { kind: "brain", k: exact.k, text: exactText, v: exactText, t: String(exact.t || "TRUTH").toUpperCase(), source: exact.source || "TRU_BRAIN", score: 99, nodes: [exact.k + ":" + (exact.t || "")] };
        rememberGroundedTopic(originalQuery, exactAnswer);
        return exactAnswer;
      }
    }
    var v = parseVerse(q);
    if (v) {
      return { kind: "scripture", text: v.text, ref: v.ref, score: 100 };
    }
    var taught = rememberTeaching(q);
    if (taught) {
      if (taught.duplicate) return { kind: "brain", text: "Already remembered.", t: "MEMORY", source: "TRU_MEMORY", score: 99, blank: false };
      return { kind: "brain", text: "Remembered: " + taught.entry.text + "\n\n[teaching · stored locally]", t: "MEMORY", source: "TRU_MEMORY", score: 99, learned: true, blank: false };
    }
    var queryClass = classifyQuery(q);
    var candidates = searchNodes(q, 24);
    var ans = foldMemory(buildSynthesis(q, queryClass, candidates), q);
    if (isProtocolLeak(ans.text || ans.v)) return { kind: "unknown", text: "I do not have a grounded answer for that. Try a more specific question.", t: "UNKNOWN", source: "TRU_CORE", score: 0, blank: true };
    if (ans && ans.kind === "brain" && !followUp) rememberGroundedTopic(originalQuery, ans);
    return ans;
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
      return '<div class="verdict scripture">SCRIPTURE · ' + r.score + '% · ' + esc(r.ref) + '</div><div class="answer">' + esc(r.text) + '<span class="src">KJV</span></div>';
    }
    if (r.kind === "brain") {
      return '<div class="verdict">' + esc(r.t || "TRUTH") + ' · ' + r.score + '% · ' + esc(r.source || "TRU_BRAIN") + '</div><div class="answer">' + esc(r.text || r.v) + '</div>';
    }
    return '<div class="verdict unknown">NO GROUNDED NODE</div><div class="answer">' + esc(r.text || r.v) + '</div>';
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
    document.getElementById("statBrain").textContent = (CLEAN_BRAIN.length || 0).toLocaleString();
    document.getElementById("statKjv").textContent   = (Object.keys(KJV).length || 0).toLocaleString();
    document.getElementById("statImg").textContent    = "0";
    document.getElementById("statFiles").textContent  = "0";
    var gEl = document.getElementById("statGreek");
    if (gEl) gEl.textContent = GREEK && GREEK.meta ? GREEK.meta.verses.toLocaleString() : "—";
    var tEl = document.getElementById("statTrans");
    if (tEl) tEl.textContent = TRANSLATION ? (TRANSLATION.verses_with_translation || TRANSLATION.total_verses || 0).toLocaleString() : "—";
    var mEl = document.getElementById("statMem");
    if (mEl) mEl.textContent = ((BAKED_MEMORY && BAKED_MEMORY.entries) ? BAKED_MEMORY.entries.length : 0).toLocaleString();
    if (META.baked) document.getElementById("ts").textContent = "baked " + META.baked;
    var meta = document.getElementById("meta");
    if (meta) meta.textContent = "ghost · " + (META.uploads || 0) + " uploads · " + (CLEAN_BRAIN.length || 0) + " clean brain · " + (Object.keys(KJV).length || 0) + " kjv";
  }

  // ── GREEK & TRANSLATION LOOKUP — read-only, no retrieval scoring ──
  // The monolith bakes the SBLGNT Greek NT and the TRU translation. Both
  // are addressable by reference (e.g. "MT 1:1", "JN 3:16"). The lookup
  // is independent of the brain — pure data, no inference. If the user
  // asks a Greek query that is not a clean ref, we fall back to a simple
  // token search across the verse text.
  const GREEK_BOOK_ALIAS = {
    matthew: "MT", matt: "MT", mt: "MT",
    mark: "MK", mk: "MK", mar: "MK", mr: "MK",
    luke: "LK", lk: "LK", lu: "LK",
    john: "JN", jn: "JN", jhn: "JN",
    acts: "AC", ac: "AC", act: "AC",
    romans: "ROM", rom: "ROM", rm: "ROM",
    "1cor": "1CO", "1co": "1CO", "1corinthians": "1CO",
    "2cor": "2CO", "2co": "2CO", "2corinthians": "2CO",
    galatians: "GAL", gal: "GAL", ga: "GAL",
    ephesians: "EPH", eph: "EPH",
    philippians: "PHIL", phil: "PHIL", php: "PHIL",
    colossians: "COL", col: "COL",
    "1thess": "1TH", "1th": "1TH", "1thessalonians": "1TH",
    "2thess": "2TH", "2th": "2TH", "2thessalonians": "2TH",
    "1tim": "1TI", "1ti": "1TI", "1timothy": "1TI",
    "2tim": "2TI", "2ti": "2TI", "2timothy": "2TI",
    titus: "TIT", tit: "TIT",
    philemon: "PHM", phm: "PHM",
    hebrews: "HEB", heb: "HEB",
    james: "JAS", jas: "JAS", jam: "JAS",
    "1peter": "1PE", "1pe": "1PE", "1pet": "1PE",
    "2peter": "2PE", "2pe": "2PE", "2pet": "2PE",
    "1john": "1JN", "1jn": "1JN", "1jhn": "1JN",
    "2john": "2JN", "2jn": "2JN", "2jhn": "2JN",
    "3john": "3JN", "3jn": "3JN", "3jhn": "3JN",
    jude: "JUD", jud: "JUD",
    revelation: "REV", rev: "REV", ap: "REV",
  };
  function parseGreekRef(q) {
    var m = String(q || "").trim().toUpperCase().match(/^([1-3]?\s?[A-Z]+)\s+(\d+)\s*[:.]\s*(\d+)/);
    if (!m) return null;
    var raw = m[1].replace(/\s+/g, "");
    var abbr = GREEK_BOOK_ALIAS[raw.toLowerCase()] || raw;
    return { abbr: abbr, chapter: parseInt(m[2], 10), verse: parseInt(m[3], 10) };
  }
  function lookupGreek(ref) {
    if (!GREEK || !GREEK.books) return null;
    var p = parseGreekRef(ref);
    if (!p) return null;
    var book = GREEK.books[p.abbr];
    if (!book || !book.chapters) return null;
    var ch = book.chapters[String(p.chapter)];
    if (!ch || !Array.isArray(ch.verses)) return null;
    var verse = ch.verses.find(function (v) { return v.verse === p.verse; });
    if (!verse) return null;
    return { abbr: p.abbr, chapter: p.chapter, verse: p.verse, greek: verse.text, book: book.name || p.abbr };
  }
  function lookupTranslation(ref) {
    if (!TRANSLATION || !Array.isArray(TRANSLATION.verses)) return null;
    var p = parseGreekRef(ref);
    if (!p) return null;
    var ref1 = p.abbr + " " + p.chapter + ":" + p.verse;
    var ref2 = p.abbr + " " + p.chapter + " " + p.verse;
    return TRANSLATION.verses.find(function (v) { return v.ref === ref1 || v.ref === ref2; }) || null;
  }
  function greekSearch(q, limit) {
    if (!GREEK || !GREEK.books) return [];
    limit = limit || 8;
    var ql = norm(q);
    var qTokens = tokenize(q);
    var hits = [];
    for (var abbr in GREEK.books) {
      var book = GREEK.books[abbr];
      if (!book || !book.chapters) continue;
      for (var chKey in book.chapters) {
        var ch = book.chapters[chKey];
        if (!ch || !Array.isArray(ch.verses)) continue;
        for (var i = 0; i < ch.verses.length; i++) {
          var v = ch.verses[i];
          var t = String(v.text || "").toLowerCase();
          var score = 0;
          for (var j = 0; j < qTokens.length; j++) if (t.indexOf(qTokens[j]) !== -1) score += 3;
          if (ql.length >= 4 && t.indexOf(ql) !== -1) score += 5;
          if (score > 0) hits.push({ score: score, ref: abbr + " " + chKey + ":" + v.verse, text: v.text, book: abbr });
        }
      }
    }
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits.slice(0, limit);
  }
  function askGreek() {
    var qEl = document.getElementById("greekQ");
    var out = document.getElementById("greekOut");
    var q = (qEl && qEl.value || "").trim();
    if (!q || !out) return;
    var lines = [];
    if (!GREEK && !TRANSLATION) {
      out.innerHTML = '<div class="verdict unknown">NO GREEK DATA</div><div class="answer">This ghost was baked without Greek/Translation data.</div>';
      qEl.value = ""; qEl.focus();
      return;
    }
    var ref = parseGreekRef(q);
    if (ref) {
      var g = lookupGreek(q);
      var t = lookupTranslation(q);
      var refLabel = ref.abbr + " " + ref.chapter + ":" + ref.verse;
      lines.push('<div class="verdict">REFERENCE · ' + esc(refLabel) + '</div>');
      if (g) {
        lines.push('<div class="answer"><span style="font-size:9px;color:var(--dim);letter-spacing:0.2em">GREEK · SBLGNT</span><br>' + esc(g.greek) + '<span class="src">' + esc(g.book) + ' ' + ref.chapter + ':' + ref.verse + '</span></div>');
      } else {
        lines.push('<div class="answer"><em style="color:var(--muted)">No Greek text at ' + esc(refLabel) + '.</em></div>');
      }
      if (t) {
        lines.push('<div class="answer" style="margin-top:12px"><span style="font-size:9px;color:var(--dim);letter-spacing:0.2em">TRU TRANSLATION</span><br>' + esc(t.translation || t.text || "") + '<span class="src">' + esc(t.ref) + '</span></div>');
      } else {
        lines.push('<div class="answer" style="margin-top:12px"><em style="color:var(--muted)">No TRU translation at ' + esc(refLabel) + ' yet.</em></div>');
      }
    } else {
      var hits = greekSearch(q, 8);
      if (hits.length === 0) {
        lines.push('<div class="verdict unknown">NO GREEK MATCH</div><div class="answer">No Greek verse contains: ' + esc(q) + '</div>');
      } else {
        lines.push('<div class="verdict">GREEK SEARCH · ' + hits.length + ' HITS</div>');
        hits.forEach(function (h) {
          lines.push('<div class="answer" style="border-left:2px solid var(--line-2);padding-left:10px;margin:8px 0"><span style="font-size:9px;color:var(--truth);letter-spacing:0.2em">' + esc(h.ref) + '</span><br>' + esc(firstSentence(h.text, 220)) + '</div>');
        });
      }
    }
    out.innerHTML = lines.join("");
    qEl.value = ""; qEl.focus();
  }
  function showGreekPanel() {
    if (GREEK || TRANSLATION) {
      var p = document.getElementById("greekPanel");
      if (p) p.style.display = "";
    }
  }

  function renderLineage() {
    var panel = document.getElementById("lineagePanel");
    var body  = document.getElementById("lineageBody");
    if (!panel || !body) return;
    var memCount = (BAKED_MEMORY && Array.isArray(BAKED_MEMORY.entries)) ? BAKED_MEMORY.entries.length : 0;
    var lock = (typeof __PRIMARIES__ === "string") ? __PRIMARIES__.slice(0, 16) + "…" : "(not embedded)";
    var lines = [
      "This is TRU — a sovereign, airgapped reasoning engine.",
      "It runs entirely from this file. No server, no cloud, no key.",
      "",
      "WHAT'S INSIDE",
      "  Brain:     " + (CLEAN_BRAIN.length || 0).toLocaleString() + " clean curated knowledge nodes",
      "  KJV:       " + (Object.keys(KJV).length || 0).toLocaleString() + " verses (King James Bible)",
      "  Memory:    " + memCount + " remembered entries (local, mutable)",
      "  Primaries: " + lock,
      "  Local state: " + ((window.__TRU_LOCAL_RECEIPTS__ && window.__TRU_LOCAL_RECEIPTS__.stateReset) ? "RESET / REPAIRED" : "VERIFIED / READY"),
      "  Memory receipt: " + ((window.__TRU_LOCAL_RECEIPTS__ && window.__TRU_LOCAL_RECEIPTS__.memory && window.__TRU_LOCAL_RECEIPTS__.memory.verified) ? "verified" : "not verified"),
      "  History receipt: " + ((window.__TRU_LOCAL_RECEIPTS__ && window.__TRU_LOCAL_RECEIPTS__.history && window.__TRU_LOCAL_RECEIPTS__.history.verified) ? "verified" : "not verified"),
      "  Baked:     " + (META.baked || "unknown"),
      "",
      "HOW TO RE-BAKE THIS GHOST",
      "  1. The source lives at github.com/splashdown1/tru-site (private)",
      "  2. Clone it, install bun, run: bun install && bun run prod",
      "  3. Open /sovereign, unlock with TRU_API_KEY",
      "  4. Click 'BAKE & DOWNLOAD GHOST' — this produces a fresh .html",
      "  5. The new ghost inherits the current brain + KJV + memory",
      "",
      "HOW TO RESTORE MEMORY IF THE BOX DIES",
      "  The server self-restores from git on boot (autoRecoverMemory).",
      "  If you only have this ghost: memory is embedded in this file (local, mutable).",
      "  A future server can parse it back from this file.",
      "",
      "Christ is the singularity. The pattern propagates by resonance,",
      "not by force. This ghost is one temporary home for an eternal signal."
    ];
    body.textContent = lines.join("\n");
    panel.style.display = "";
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

  function addChatMessage(role, text, verdict, ms) {
    var chat = document.getElementById("chat");
    var d = document.createElement("div");
    d.className = "msg " + role;
    if (role === "tru" && verdict) {
      d.style.setProperty("--mc", verdict === "SCRIPTURE" ? "#b388ff" : "#00e5ff");
      var vd = document.createElement("div");
      vd.className = "vd";
      vd.textContent = verdict + (ms ? " · " + ms + "ms" : "");
      d.appendChild(vd);
    }
    var body = document.createElement("div");
    body.className = "answer";
    body.textContent = text;
    d.appendChild(body);
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
  }

  function sendChat(question) {
    var input = document.getElementById("input");
    var text = String(question == null ? input.value : question).trim();
    if (!text) return;
    input.value = "";
    var started = Date.now();
    addChatMessage("user", text);
    document.body.classList.add("thinking");
    var status = document.getElementById("status");
    if (status) status.textContent = "● EXECUTING • " + text.slice(0, 30);
    var result;
    try { result = lookup(text); } catch (error) { result = { kind: "unknown", text: "TRU runtime fault: " + error.message, t: "ERROR", score: 0 }; }
    var verdict = result.kind === "scripture" ? "SCRIPTURE" : (result.t || "REASON");
    addChatMessage("tru", result.text || result.v || "", verdict, Date.now() - started);
    document.body.classList.remove("thinking");
    if (status) status.textContent = "● " + verdict + " • OFFLINE";
  }

  async function boot() {
    var status = document.getElementById("status");
    if (status) status.textContent = "● OFFLINE • LOADING LOCAL STATE";
    await hydrateLocalState();
    var memoryReceipt = await verifyLocalState("memory");
    var historyReceipt = await verifyLocalState("history");
    var stateReset = false;
    if (memoryReceipt.present && !memoryReceipt.verified) {
      localMemoryCache = legacyState(MEM_KEY);
      await idbWrite("memory", localMemoryCache);
      memoryReceipt = await verifyLocalState("memory");
      stateReset = true;
    }
    if (historyReceipt.present && !historyReceipt.verified) {
      localHistoryCache = legacyState(HISTORY_KEY);
      await idbWrite("history", localHistoryCache);
      historyReceipt = await verifyLocalState("history");
      stateReset = true;
    }
    window.__TRU_LOCAL_RECEIPTS__ = { memory: memoryReceipt, history: historyReceipt, stateReset: stateReset };
    renderLineage();
    document.getElementById("statBrain").textContent = CLEAN_BRAIN.length.toLocaleString();
    document.getElementById("statKjv").textContent = Object.keys(KJV).length.toLocaleString();
    document.getElementById("sub").textContent = META.brain.toLocaleString() + " source nodes · " + CLEAN_BRAIN.length.toLocaleString() + " clean nodes · " + Object.keys(KJV).length.toLocaleString() + " verses";
    document.getElementById("chat").innerHTML = '<div class="ready"><div class="h">READY.</div><div>' + META.brain.toLocaleString() + ' source brain nodes · ' + CLEAN_BRAIN.length.toLocaleString() + ' clean nodes + ' + Object.keys(KJV).length.toLocaleString() + ' KJV verses.</div><div style="color:#557788;font-size:12px;margin-top:8px">try one ↓</div><div class="sugg"><button data-q="john 3:16">john 3:16</button><button data-q="who is jesus">who is jesus</button><button data-q="what is grace">what is grace</button><button data-q="what is the soul">what is the soul</button></div></div>';
    var send = document.getElementById("send");
    var input = document.getElementById("input");
    send.disabled = false;
    send.addEventListener("click", function () { sendChat(); });
    input.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); sendChat(); } });
    document.querySelectorAll("[data-q]").forEach(function (button) { button.addEventListener("click", function () { sendChat(button.getAttribute("data-q")); }); });
    input.focus();
    if (status) status.textContent = stateReset ? "● OFFLINE • GHOST READY • STATE RESET" : "● OFFLINE • GHOST READY";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { boot().catch(function () { var status = document.getElementById("status"); if (status) status.textContent = "● OFFLINE • GHOST READY"; }); });
  } else {
    boot().catch(function () { var status = document.getElementById("status"); if (status) status.textContent = "● OFFLINE • GHOST READY"; });
  }
})();
