// Client-side exit hook for tru.
// POSTs state to /api/tru/export on tab close / hide / navigate.
// Uses navigator.sendBeacon so the request survives unload; falls back to fetch keepalive.

export interface TRUExportPayload {
  history?: unknown;
  prefs?: unknown;
  brain?: unknown;
  [k: string]: unknown;
}

export interface Exporter {
  flush: (reason: string) => void;
  destroy: () => void;
}

export function makeExporter(getState: () => TRUExportPayload): Exporter {
  let lastSent = 0;
  const minGap = 250;
  const endpoint = "/api/tru/export";

  const flush = (reason: string) => {
    const now = Date.now();
    if (now - lastSent < minGap) return;
    lastSent = now;
    let payload: TRUExportPayload;
    try {
      payload = getState();
    } catch {
      return;
    }
    const body = JSON.stringify({ ...payload, _reason: reason });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        const blob = new Blob([body], { type: "application/json" });
        const ok = navigator.sendBeacon(endpoint, blob);
        if (ok) return;
      } catch {
        // fall through to fetch
      }
    }
    if (typeof fetch === "function") {
      try {
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      } catch {
        // swallow
      }
    }
  };

  const onPageHide = () => flush("pagehide");
  const onBeforeUnload = () => flush("beforeunload");
  const onVisChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      flush("visibility:hidden");
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisChange);
  }

  return {
    flush,
    destroy: () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("beforeunload", onBeforeUnload);
        document.removeEventListener("visibilitychange", onVisChange);
      }
    },
  };
}
