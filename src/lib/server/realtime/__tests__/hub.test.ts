import { describe, it, expect, beforeEach } from 'vitest';
import { publish, subscribe, subscriberCount } from '../hub';

const decoder = new TextDecoder();

/** Drain pending frames from a ReadableStream without blocking forever.
 *  Returns the decoded string concatenation of all chunks available now. */
async function drain(stream: ReadableStream<Uint8Array>, maxChunks = 10): Promise<string> {
  const reader = stream.getReader();
  let text = '';
  for (let i = 0; i < maxChunks; i++) {
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), 10)
      )
    ]);
    if (result.done) break;
    if (result.value) text += decoder.decode(result.value);
  }
  reader.releaseLock();
  return text;
}

describe('hub (in-memory SSE pub/sub)', () => {
  let channelName: string;
  beforeEach(() => {
    // Unique channel per test so the singleton's channel Map stays clean.
    channelName = `test:${Math.random().toString(36).slice(2)}`;
  });

  // Locks the basic publish → subscribe → receive contract. If publish
  // ever forgot to enqueue (or subscribe forgot to register), every live
  // SSE consumer would silently miss every event.
  it('a published event reaches an active subscriber as a `data:` SSE frame', async () => {
    const stream = subscribe(channelName);
    publish(channelName, { type: 'turn', round: 2 });

    const text = await drain(stream);
    expect(text).toContain(': connected'); // greeting comment
    expect(text).toContain('data: {"type":"turn","round":2}');
  });

  it('publish to a channel with no subscribers is a no-op (no throw)', () => {
    expect(() => publish('nobody-here', { x: 1 })).not.toThrow();
  });

  // Locks the fan-out behaviour — every subscriber receives the same event.
  it('fans out to every subscriber on the channel', async () => {
    const a = subscribe(channelName);
    const b = subscribe(channelName);
    publish(channelName, { tag: 'fanout' });

    const [textA, textB] = await Promise.all([drain(a), drain(b)]);
    expect(textA).toContain('"tag":"fanout"');
    expect(textB).toContain('"tag":"fanout"');
  });

  // Locks the abort → unregister path. If this breaks, every disconnected
  // client leaks a sink and OOMs the process over time.
  it('aborting the signal drops the subscriber from the channel map', async () => {
    const controller = new AbortController();
    subscribe(channelName, controller.signal);
    expect(subscriberCount(channelName)).toBe(1);

    controller.abort();
    // Give the abort listener a tick to run.
    await new Promise((r) => setTimeout(r, 5));
    expect(subscriberCount(channelName)).toBe(0);
  });

  it('subscriberCount returns 0 for an unknown channel', () => {
    expect(subscriberCount('does-not-exist')).toBe(0);
  });

  it('emits a `: connected` greeting comment on subscribe', async () => {
    const stream = subscribe(channelName);
    const text = await drain(stream);
    expect(text).toMatch(/^: connected\n\n/);
  });
});
