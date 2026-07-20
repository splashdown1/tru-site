import { useState, useRef, useCallback } from "react";
import { apiUrl, siteUrl } from "../lib/api";

type Upload = {
  name: string;
  mime: string;
  size: number;
  kind: "image" | "file";
  data: string; // data URI
};

const MAX_FILE_BYTES = 12 * 1024 * 1024; // 12 MB per file ceiling
const MAX_TOTAL_BYTES = 32 * 1024 * 1024; // 32 MB total ceiling
const ALLOWED_IMAGE = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i;
const ALLOWED_FILE = /^(application|text)\//i;

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function TruOnboard() {
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "capturing" | "baking" | "downloading" | "done" | "error">("idle");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastBytes, setLastBytes] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalBytes = uploads.reduce((a, u) => a + u.size, 0);
  const imageCount = uploads.filter((u) => u.kind === "image").length;
  const fileCount = uploads.filter((u) => u.kind === "file").length;

  const push = useCallback((line: string) => {
    setLog((prev) => [`[${new Date().toISOString()}] ${line}`, ...prev].slice(0, 60));
  }, []);

  const addFiles = useCallback(
    async (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      const accepted: Upload[] = [];
      let skipped = 0;
      let runningTotal = totalBytes;
      for (const f of list) {
        if (f.size > MAX_FILE_BYTES) {
          skipped++;
          continue;
        }
        if (runningTotal + f.size > MAX_TOTAL_BYTES) {
          skipped++;
          continue;
        }
        try {
          const data = await readAsDataURL(f);
          if (ALLOWED_IMAGE.test(f.type)) {
            accepted.push({ name: f.name, mime: f.type, size: f.size, kind: "image", data });
            runningTotal += f.size;
          } else if (ALLOWED_FILE.test(f.type) || f.type === "") {
            accepted.push({ name: f.name, mime: f.type || "application/octet-stream", size: f.size, kind: "file", data });
            runningTotal += f.size;
          } else {
            skipped++;
          }
        } catch {
          skipped++;
        }
      }
      if (accepted.length) {
        setUploads((prev) => [...prev, ...accepted]);
        push(`ADD · ${accepted.length} accepted${skipped ? `, ${skipped} skipped` : ""}`);
      } else if (skipped) {
        push(`ADD · ${skipped} skipped (size/limit)`);
      }
    },
    [push, totalBytes]
  );

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const removeUpload = (idx: number) => {
    setUploads((prev) => prev.filter((_, i) => i !== idx));
  };

  const capture = useCallback(async () => {
    setPhase("capturing");
    setError(null);
    push("CAPTURE · bundling uploads + notes + text");
    const payload = {
      text,
      notes,
      uploads,
      _capturedAt: new Date().toISOString(),
    };
    const size = JSON.stringify(payload).length;
    push(`CAPTURE · bundle=${formatBytes(size)} · images=${imageCount} · files=${fileCount}`);
    setPhase("baking");
    push("BAKE · POST /api/tru/ghost?download=1 …");
    try {
      const r = await fetch(apiUrl("/api/tru/ghost?download=1"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      setLastBytes(blob.size);
      push(`BAKE · ${formatBytes(blob.size)} ready · triggering download`);
      setPhase("downloading");
      const cd = r.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="?([^"]+)"?/);
      const filename = m?.[1] || `TRU_GHOST_${Date.now()}.html`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      push(`DOWNLOAD · ${filename} · ${formatBytes(blob.size)}`);
      setPhase("done");
    } catch (e) {
      setError(String(e));
      push(`ERROR · ${String(e)}`);
      setPhase("error");
    }
  }, [text, notes, uploads, imageCount, fileCount, push]);

  const ready =
    !busy &&
    (text.trim().length > 0 ||
      notes.trim().length > 0 ||
      uploads.length > 0);

  return (
    <div className="min-h-screen bg-black text-neutral-100 font-mono antialiased">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-center justify-between border-b border-neutral-900 pb-4 mb-10">
          <div className="flex items-center gap-3">
            <span className="text-[11px] uppercase tracking-[0.4em] text-emerald-300">TRU · GHOST</span>
            <span className="text-[10px] uppercase tracking-[0.3em] text-neutral-600">capture → bake → download</span>
          </div>
          <a href={siteUrl("/")} className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 hover:text-emerald-400">
            ← public
          </a>
        </div>

        <h1 className="text-2xl font-light leading-tight tracking-tight">
          Build your offline copy.
        </h1>
        <p className="mt-3 text-sm text-neutral-500 max-w-prose leading-relaxed">
          Anything you add here gets baked into a single self-contained{" "}
          <span className="text-emerald-300">.html</span> file. The result has
          the active brain, all scripture, your notes, your images, your files —
          and zero network calls. Open it from <span className="text-emerald-300">file://</span> anywhere.
        </p>

        {/* TEXT */}
        <section className="mt-10 border border-neutral-900 bg-neutral-950/40 p-5">
          <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-2">Text</div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="A short statement. A definition. A seed thought."
            rows={3}
            className="w-full bg-transparent border border-neutral-800 focus:border-emerald-500 outline-none p-3 text-sm text-neutral-100 placeholder:text-neutral-700 resize-y"
          />
        </section>

        {/* NOTES */}
        <section className="mt-6 border border-neutral-900 bg-neutral-950/40 p-5">
          <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-2">Notes</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Longer passages. Quotes. Anything you want the brain to remember."
            rows={6}
            className="w-full bg-transparent border border-neutral-800 focus:border-emerald-500 outline-none p-3 text-sm text-neutral-100 placeholder:text-neutral-700 resize-y"
          />
        </section>

        {/* UPLOADS */}
        <section
          className="mt-6 border border-dashed border-neutral-800 bg-neutral-950/40 p-5"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600">Uploads</div>
            <div className="text-[10px] text-neutral-600">
              {uploads.length} file{uploads.length === 1 ? "" : "s"} · {formatBytes(totalBytes)} / {formatBytes(MAX_TOTAL_BYTES)}
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={onFileInput}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-xs uppercase tracking-[0.2em] text-emerald-300 border border-emerald-700 hover:bg-emerald-500 hover:text-black transition-colors px-4 py-2"
          >
            + Add files
          </button>
          <span className="ml-3 text-[10px] text-neutral-600">…or drag &amp; drop</span>

          {uploads.length > 0 && (
            <ul className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {uploads.map((u, i) => (
                <li key={i} className="border border-neutral-800 bg-neutral-950/60 p-2 text-[11px]">
                  <div className="aspect-square bg-neutral-900 mb-2 overflow-hidden flex items-center justify-center">
                    {u.kind === "image" ? (
                      <img src={u.data} alt={u.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[9px] text-neutral-600 uppercase tracking-[0.2em]">{u.mime.split("/")[1] || "file"}</span>
                    )}
                  </div>
                  <div className="truncate text-neutral-200" title={u.name}>{u.name}</div>
                  <div className="flex items-center justify-between text-neutral-600 mt-1">
                    <span>{formatBytes(u.size)}</span>
                    <button
                      onClick={() => removeUpload(i)}
                      className="text-[9px] uppercase tracking-[0.2em] text-red-400 hover:text-red-300"
                    >
                      remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ACTION */}
        <div className="mt-10 flex items-center justify-between gap-4 flex-wrap">
          <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600">
            {phase === "idle" && "ready when you are"}
            {phase === "capturing" && "capturing state…"}
            {phase === "baking" && "baking monolith…"}
            {phase === "downloading" && "downloading…"}
            {phase === "done" && (lastBytes ? `ghost ready · ${formatBytes(lastBytes)}` : "ghost ready")}
            {phase === "error" && (error ? `error · ${error}` : "error")}
          </div>
          <button
            onClick={capture}
            disabled={!ready}
            className={`relative px-6 py-3 text-xs uppercase tracking-[0.3em] border-2 transition-all ${
              !ready
                ? "border-neutral-800 text-neutral-700 cursor-not-allowed"
                : phase === "done"
                  ? "border-emerald-300 text-emerald-200 hover:bg-emerald-300 hover:text-black"
                  : "border-emerald-500 text-emerald-300 hover:bg-emerald-500 hover:text-black active:scale-95"
            }`}
          >
            {phase === "capturing" || phase === "baking" || phase === "downloading"
              ? "BAKING…"
              : phase === "done"
                ? "▼ BAKE ANOTHER"
                : "▶ BAKE & DOWNLOAD GHOST"}
          </button>
        </div>

        {/* LOG */}
        {log.length > 0 && (
          <section className="mt-10 border border-neutral-900 bg-neutral-950/40 p-4">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-2">Activity</div>
            <div className="text-[11px] space-y-1 max-h-64 overflow-y-auto">
              {log.map((l, i) => (
                <div key={i} className="text-neutral-400 tabular-nums">{l}</div>
              ))}
            </div>
          </section>
        )}

        <div className="mt-12 pt-4 border-t border-neutral-900 text-[10px] uppercase tracking-[0.3em] text-neutral-700 text-center">
          TRU · sovereign · airgapped
        </div>
      </div>
    </div>
  );
}
