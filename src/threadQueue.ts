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

  /**
   * Enqueue a task unconditionally.
   */
  enqueue<T>(threadId: string, task: ThreadQueueTask<T>): Promise<T> {
    return this.enqueueInner(threadId, task);
  }

  /**
   * Enqueue a task only if the per-thread queue depth is below maxDepth.
   *
   * This is atomic with respect to other tryEnqueue/enqueue calls on the same queue
   * (i.e. prevents the check-then-enqueue race).
   */
  tryEnqueue<T>(threadId: string, maxDepth: number, task: ThreadQueueTask<T>): Promise<T> | null {
    const cur = this.depth(threadId);
    if (cur >= maxDepth) return null;
    return this.enqueueInner(threadId, task);
  }

  private enqueueInner<T>(threadId: string, task: ThreadQueueTask<T>): Promise<T> {
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
