export type ThreadQueueTask<T> = () => Promise<T>;

type QueueState = {
  tail: Promise<void>;
  depth: number;
};

/**
 * Per-thread FIFO async queue.
 *
 * Guarantees tasks for the same threadId never overlap and run in submission order,
 * while allowing full concurrency across different threadIds.
 */
export class ThreadQueue {
  private states = new Map<string, QueueState>();

  depth(threadId: string): number {
    return this.states.get(threadId)?.depth ?? 0;
  }

  enqueue<T>(threadId: string, task: ThreadQueueTask<T>): Promise<T> {
    const state = this.states.get(threadId) ?? { tail: Promise.resolve(), depth: 0 };
    state.depth += 1;

    let resolveOut!: (v: T) => void;
    let rejectOut!: (e: unknown) => void;
    const out = new Promise<T>((resolve, reject) => {
      resolveOut = resolve;
      rejectOut = reject;
    });

    const run = async () => {
      try {
        const v = await task();
        resolveOut(v);
      } catch (e) {
        rejectOut(e);
      } finally {
        state.depth -= 1;
        if (state.depth <= 0) {
          // allow GC once the queue drains
          this.states.delete(threadId);
        }
      }
    };

    const nextTail = state.tail.then(run, run);

    // tail is void; swallow errors to keep the chain alive.
    state.tail = nextTail.then(
      () => {},
      () => {},
    );
    this.states.set(threadId, state);

    return out;
  }
}
