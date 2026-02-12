export const DEFAULT_THREAD_QUEUE_LIMIT = 3;

type ThreadQueueState = {
  chain: Promise<void>;
  pending: number;
};

const threadQueues = new Map<string, ThreadQueueState>();

export type EnqueueThreadWorkOptions = {
  limit?: number;
};

export function enqueueThreadWork(
  threadId: string,
  work: () => Promise<void>,
  options?: EnqueueThreadWorkOptions,
): Promise<void> | null {
  const limit = options?.limit ?? DEFAULT_THREAD_QUEUE_LIMIT;
  const state: ThreadQueueState = threadQueues.get(threadId) ?? { chain: Promise.resolve(), pending: 0 };
  if (state.pending >= limit) {
    return null;
  }

  state.pending += 1;
  const scheduled = state.chain.finally(() => work());
  const safeChain = scheduled
    .catch(() => undefined)
    .finally(() => {
      state.pending -= 1;
      if (state.pending === 0) {
        threadQueues.delete(threadId);
      }
    });

  state.chain = safeChain;
  threadQueues.set(threadId, state);

  return scheduled;
}

export function resetThreadQueues(): void {
  threadQueues.clear();
}
