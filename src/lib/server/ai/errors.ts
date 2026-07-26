// Typed error union for the AI layer. Every failure mode a route can see is
// one of these classes; each carries the HTTP status the route should map it
// to (see http.ts → handleAiError). Keeping the union small and closed means
// routes never need to inspect SDK exception internals.

/** Base class — routes catch this and map `status`/`message` to HTTP. */
export class AiError extends Error {
  constructor(
    message: string,
    /** Suggested HTTP status for the route-facing error response. */
    readonly status: number
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** ANTHROPIC_API_KEY is unset — AI features are dark. Routes → 501. */
export class AiNotConfiguredError extends AiError {
  constructor() {
    super('AI features are not configured', 501);
  }
}

/** Per-user per-feature quota exhausted. Routes → 429. */
export class AiQuotaError extends AiError {
  constructor(feature: string) {
    super(`AI quota exceeded for ${feature} — try again in an hour`, 429);
  }
}

/** The model declined the request (stop_reason 'refusal'). Routes → 422 —
 *  surface "couldn't process this input", never crash on empty content. */
export class AiRefusalError extends AiError {
  constructor(feature: string) {
    super(`The AI declined to process this ${feature} request`, 422);
  }
}

/** Response arrived but parsed_output was null (schema mismatch or
 *  truncation). Routes → 502. */
export class AiParseError extends AiError {
  constructor(feature: string, stopReason: string | null) {
    super(
      `AI response for ${feature} did not match the expected structure` +
        (stopReason ? ` (stop_reason: ${stopReason})` : ''),
      502
    );
  }
}

/** Upstream is rate-limiting, overloaded, erroring, or unreachable —
 *  retryable from the caller's perspective. Routes → 503. */
export class AiUnavailableError extends AiError {
  constructor() {
    super('AI temporarily unavailable', 503);
  }
}

/** Any other non-retryable upstream API failure (4xx we caused). Routes → 502. */
export class AiRequestError extends AiError {
  constructor(detail: string) {
    super(`AI request failed: ${detail}`, 502);
  }
}
