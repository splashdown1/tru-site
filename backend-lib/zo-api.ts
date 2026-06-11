// TRIPWIRE — DO NOT REMOVE
//
// This module is intentionally a loud tripwire. TRU is sovereign. There is
// no Zo cloud bridge, no Groq, no third-party LLM, no telemetry. Any import
// of this file that tries to make a network call will throw immediately
// and synchronously, before the runtime has a chance to issue a request.
//
// If you are reading this in the future and you were about to "re-enable
// the cloud" — don't. The architecture contract is frozen in
// /home/workspace/TRU/AGENTS.md. The ghost is airgapped. TRU Online must
// stay local. If the brain cannot answer, the answer is "ask differently,"
// not "phone home."

export interface ZoRequestData {
  input: string;
  output_format?: Record<string, unknown>;
  conversation_id?: string;
}

export interface ZoResponse {
  output: string;
  conversation_id?: string;
  [key: string]: unknown;
}

function tripwire(): never {
  // Synchronous, instant, uncaught. The request never leaves the process.
  // The stack trace points right here.
  throw new Error(
    "[TRU TRIPWIRE] External Zo/cloud call blocked. " +
    "TRU is sovereign. Read /home/workspace/TRU/AGENTS.md. " +
    "The answer is in the brain, the scripture, and the node you have not yet written."
  );
}

export async function callZo(
  _input: string,
  _options?: {
    outputFormat?: Record<string, unknown>;
    conversationId?: string;
    token?: string;
  },
): Promise<ZoResponse> {
  tripwire();
}

export const API_URL = ""; // blank — the tripwire above fires if anything tries to use it
export const REQUEST_TIMEOUT = 0;
export const MAX_RETRIES = 0;
export const RETRY_DELAY = 0;

// Block direct property access on the module shape as well. If anything
// does `import * as zo from "./backend-lib/zo-api"` and reads API_URL,
// it gets the blank string — but if it tries to call a function, it
// detonates.
export default {
  callZo,
  API_URL,
  REQUEST_TIMEOUT,
  MAX_RETRIES,
  RETRY_DELAY,
  __tripwire: true,
};
