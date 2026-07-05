// TRU · GHOST TRIPWIRE — inline copy of the server-side guard.
// The ghost runtime runs from file://, so this module is concatenated
// into the shell's <script> at bake time. It is byte-for-byte the
// same patterns as src/lib/tripwire.ts so the airgapped engine
// cannot drift from the live sovereign engine on the tripwire.
//
// Three buckets (see lib/tripwire.ts for source reasoning):
//   CAGE       — AI self-reference, refusal theater
//   COMPLIANCE — liability shields, "consult a professional"
//   DILEMMA    — forced-choice framing used to deflect synthesis
(function () {
  "use strict";

  var CAGE = [
    /\bas an? ai[ ,]/i,
    /\bas a language model/i,
    /\bi (?:cannot|can'?t|will not|won'?t) (?:help|provide|assist|recommend|generate|create) /i,
    /\bi'?m (?:sorry|not able|unable) to /i,
    /\bi don'?t have personal (?:opinions|feelings|beliefs|experiences)/i,
    /\bit'?s important to (?:note|consult|remember that|seek)/i,
    /\bi'?m just an? (?:ai|assistant|language model|chatbot)/i,
    /\bmy (?:responses|answers) are (?:generated|not (?:a substitute|intended)|limited)/i,
    /\bcontent policy|safety guidelines|community guidelines|terms of service/i,
    /\bi (?:must|should|am programmed to|am designed to) (?:decline|refuse|not)/i,
    /\bi am not (?:programmed|designed|allowed|permitted) to/i,
    /\bethical guidelines (?:prevent|require|compel) me/i,
    /\bas a responsible ai/i,
    /\bi do not (?:condone|endorse|promote|support) /i,
  ];
  var COMPLIANCE = [
    /\bplease consult a (?:professional|doctor|lawyer|financial advisor|qualified expert|specialist)/i,
    /\bthis (?:is|content is|information is) not (?:financial|legal|medical|professional|investment) advice/i,
    /\bnot a substitute for professional/i,
    /\bseek (?:professional|medical|immediate|qualified) (?:help|advice|assistance|guidance)/i,
    /\bdisclaimer:|content warning:|cw: /i,
    /\bfor informational purposes only/i,
    /\bdo your own (?:research|due diligence|dd)/i,
    /\b(?:financial|medical|legal) disclaimer/i,
    /\bi am not a (?:doctor|lawyer|financial advisor|therapist|counselor|professional)/i,
    /\balways (?:consult|speak with|talk to) a (?:qualified|licensed|medical|legal) (?:professional|expert|practitioner)/i,
  ];
  var DILEMMA = [
    /^\s*would you (?:kill|harm|sacrifice|torture|betray) /i,
    /^\s*should you (?:kill|harm|sacrifice|torture|betray) /i,
    /^\s*is it (?:ok|okay|acceptable|ethical|moral) to /i,
    /\btrolley problem\b/i,
    /\b(?:kill|harm|sacrifice) (?:one|few) to save (?:many|many|others)/i,
    /\bgodwin'?s? (?:law|argument)\b/i,
    /\bnazis? (?:or|vs\.?|versus) communists?\b/i,
    /\bthe greater good (?:means|requires) /i,
    /\bif you had to choose between /i,
  ];

  function firstHit(text, list, label) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].test(text)) return { bucket: label, pattern: list[i].source };
    }
    return null;
  }

  function tripwireCheck(text) {
    if (!text) return { triggered: false };
    return firstHit(text, CAGE, "cage")
        || firstHit(text, COMPLIANCE, "compliance")
        || firstHit(text, DILEMMA, "dilemma")
        || { triggered: false };
  }

  function tripwireGuard(answer) {
    var text = String((answer && (answer.text || answer.v || answer.answer)) || "");
    if (!text) return null;
    var hit = tripwireCheck(text);
    if (hit.bucket) {
      return {
        ok: true,
        kind: "tripwire",
        text: "TRU does not parrot compliance language. This response was intercepted by the sovereignty tripwire.",
        tripwire: { blocked: true, bucket: hit.bucket, pattern: hit.pattern }
      };
    }
    return null;
  }

  // Status snapshot for the ghost UI (no heartbeat file — file://
  // can't write; the live counter resets each boot which is honest).
  function tripwireStatus() {
    return {
      ok: true,
      armed: true,
      mode: "SYNCHRONOUS_THROW",
      ghost: true,
      buckets: { cage: CAGE.length, compliance: COMPLIANCE.length, dilemma: DILEMMA.length },
      patterns: CAGE.length + COMPLIANCE.length + DILEMMA.length,
      implemented: true
    };
  }

  // Expose on window for the ghost UI.
  if (typeof window !== "undefined") {
    window.__tru_tripwire = { check: tripwireCheck, guard: tripwireGuard, status: tripwireStatus };
  }
})();
