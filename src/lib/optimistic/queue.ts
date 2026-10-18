/**
 * Runs server calls one after another, in the order they were asked for. An Undo tapped while
 * its change is still on the way must reach the server after it, or the change would win.
 * A failed call doesn't stop the ones queued behind it.
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(call: () => Promise<T>): Promise<T> {
    const next = tail.catch(() => undefined).then(call);
    tail = next;
    return next;
  };
}

export type SerialQueue = ReturnType<typeof createSerialQueue>;
