// In-memory pub/sub for SSE live channels. One process, one Map.
//
// Channels are opaque strings; callers pick the convention. We use:
//   encounter:<uuid>  — fan out turn/plan/HP/conditions deltas
//   character:<uuid>  — fan out character document patches
//
// Each subscriber owns a ReadableStream backed by a controller we hold
// here. publish() writes to every controller for the channel. We close
// the controller on subscriber abort (the SvelteKit request signal) so
// disconnected clients drop out without leaking memory.
//
// Events serialize as SSE frames: `data: <json>\n\n`. Heartbeat comments
// (`:\n\n`) every 25s keep reverse proxies from idling the connection.

type Sink = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  closed: boolean;
};

const channels = new Map<string, Set<Sink>>();
const encoder = new TextEncoder();
const HEARTBEAT_MS = 25_000;

function frame(event: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function heartbeat(): Uint8Array {
  return encoder.encode(`:\n\n`);
}

export function publish(channel: string, event: unknown): void {
  const sinks = channels.get(channel);
  if (!sinks || sinks.size === 0) return;
  const payload = frame(event);
  for (const sink of sinks) {
    if (sink.closed) continue;
    try {
      sink.controller.enqueue(payload);
    } catch {
      // Controller already closed (client disconnected mid-fan-out).
      sink.closed = true;
    }
  }
}

/** Open a stream subscribed to one channel. Returns a ReadableStream you can
 *  hand directly to `new Response(stream, { headers: ... })`. The optional
 *  AbortSignal (use request.signal in SvelteKit) drives teardown when the
 *  client disconnects. */
export function subscribe(channel: string, signal?: AbortSignal): ReadableStream<Uint8Array> {
  let sink: Sink | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      sink = { controller, closed: false };
      let set = channels.get(channel);
      if (!set) {
        set = new Set();
        channels.set(channel, set);
      }
      set.add(sink);
      controller.enqueue(encoder.encode(`: connected\n\n`));
      heartbeatTimer = setInterval(() => {
        if (!sink || sink.closed) return;
        try {
          sink.controller.enqueue(heartbeat());
        } catch {
          sink.closed = true;
        }
      }, HEARTBEAT_MS);

      const onAbort = () => {
        if (!sink || sink.closed) return;
        sink.closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        const s = channels.get(channel);
        if (s) {
          s.delete(sink);
          if (s.size === 0) channels.delete(channel);
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      signal?.addEventListener('abort', onAbort);
    },
    cancel() {
      if (!sink) return;
      sink.closed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      const s = channels.get(channel);
      if (s) {
        s.delete(sink);
        if (s.size === 0) channels.delete(channel);
      }
    }
  });
}

/** Test-only — returns the number of live subscribers on a channel. */
export function subscriberCount(channel: string): number {
  return channels.get(channel)?.size ?? 0;
}
