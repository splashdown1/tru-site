type ChatRole = "system" | "user" | "assistant" | "tool";

type ChatMessage = {
  role: ChatRole;
  content: string | Array<Record<string, unknown>>;
  name?: string;
  tool_call_id?: string;
};

export type ChatCompletionRequest = {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  response_format?: Record<string, unknown>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  stream?: boolean;
};

type KeyState = {
  key: string;
  index: number;
  cooldownUntil: number;
  uses: number;
  rateLimits: number;
  failures: number;
};

export class GatewayError extends Error {
  status: number;
  detail: unknown;
  retryAfter?: number;

  constructor(message: string, status: number, detail?: unknown, retryAfter?: number) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.detail = detail;
    this.retryAfter = retryAfter;
  }
}

const endpoint = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions";
const defaultModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
const keyCooldownMs = Number(process.env.LLM_KEY_COOLDOWN_MS || 60_000);
const maxAttempts = Math.max(0, Number(process.env.LLM_MAX_KEY_ATTEMPTS || 0));

function configuredKeys(): string[] {
  const pooled = process.env.OPENAI_API_KEYS || process.env.LLM_API_KEYS || "";
  const numbered = Object.entries(process.env)
    .filter(([name, value]) => /^(OPENAI|LLM)_API_KEY_\d+$/.test(name) && value?.trim())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, value]) => value!.trim());
  const keys = [...pooled.split(/[\n,]+/).map((key) => key.trim()).filter(Boolean), ...numbered];
  if (keys.length > 0) return [...new Set(keys)];
  return process.env.OPENAI_API_KEY?.trim() ? [process.env.OPENAI_API_KEY.trim()] : [];
}

let states: KeyState[] = [];
let keysLoaded = false;
let nextIndex = 0;

function ensureKeysLoaded(): void {
  if (keysLoaded) return;
  states = configuredKeys().map((key, index) => ({
    key,
    index,
    cooldownUntil: 0,
    uses: 0,
    rateLimits: 0,
    failures: 0,
  }));
  keysLoaded = true;
}

function nextAvailable(excluded: Set<number>): KeyState | null {
  const now = Date.now();
  for (let offset = 0; offset < states.length; offset += 1) {
    const index = (nextIndex + offset) % states.length;
    const state = states[index];
    if (excluded.has(index) || state.cooldownUntil > now) continue;
    nextIndex = (index + 1) % states.length;
    return state;
  }
  return null;
}

function retryAfterMs(response: Response): number {
  const raw = response.headers.get("retry-after");
  if (!raw) return keyCooldownMs;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1_000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : keyCooldownMs;
}

function safeDetail(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 1_000);
  if (value && typeof value === "object") return value;
  return undefined;
}

function validateRequest(input: ChatCompletionRequest): void {
  if (!input || !Array.isArray(input.messages) || input.messages.length === 0) {
    throw new GatewayError("messages must be a non-empty array", 400);
  }
  if (input.messages.length > 100) {
    throw new GatewayError("too many messages", 413);
  }
  if (input.messages.some((message) => !message || typeof message.role !== "string" || message.content == null)) {
    throw new GatewayError("each message needs a role and content", 400);
  }
}

export async function chatCompletion(input: ChatCompletionRequest): Promise<{ data: any; attempts: number; keyIndex: number }> {
  ensureKeysLoaded();
  validateRequest(input);
  if (input.stream === true) throw new GatewayError("streaming is not enabled on this gateway route", 400);
  if (input.model && input.model.length > 200) throw new GatewayError("model name is too long", 400);
  if (states.length === 0) throw new GatewayError("no LLM API keys configured", 503);

  const excluded = new Set<number>();
  const limit = Math.min(states.length, maxAttempts > 0 ? maxAttempts : states.length);
  let lastRateLimit = keyCooldownMs;

  for (let attempt = 0; attempt < limit; attempt += 1) {
    const state = nextAvailable(excluded);
    if (!state) break;
    excluded.add(state.index);
    state.uses += 1;

    const body = {
      ...input,
      model: input.model || defaultModel,
      stream: false,
    };
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${state.key}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      state.failures += 1;
      throw new GatewayError("upstream connection failed", 502, String(error));
    }

    const raw = await response.text();
    let parsed: any;
    try { parsed = raw ? JSON.parse(raw) : undefined; } catch { parsed = raw.slice(0, 1_000); }
    if (response.ok) return { data: parsed, attempts: attempt + 1, keyIndex: state.index };

    if (response.status === 429) {
      const wait = retryAfterMs(response);
      state.rateLimits += 1;
      state.cooldownUntil = Date.now() + wait;
      lastRateLimit = Math.max(lastRateLimit, wait);
      continue;
    }

    state.failures += 1;
    throw new GatewayError(`upstream returned HTTP ${response.status}`, response.status, safeDetail(parsed));
  }

  const availableAt = states.reduce((soonest, state) => Math.min(soonest, state.cooldownUntil || Date.now()), Date.now() + lastRateLimit);
  throw new GatewayError("all pooled LLM keys are rate-limited", 429, { keys: states.length }, Math.max(1_000, availableAt - Date.now()));
}

export function gatewayStatus() {
  ensureKeysLoaded();
  return {
    provider: endpoint.replace(/\/v1\/chat\/completions$/, ""),
    model: defaultModel,
    keys: states.length,
    nextIndex,
    keyStates: states.map((state) => ({
      index: state.index,
      uses: state.uses,
      rateLimits: state.rateLimits,
      failures: state.failures,
      coolingDown: state.cooldownUntil > Date.now(),
    })),
  };
}
