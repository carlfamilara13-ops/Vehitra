// A tiny FIFO queue: tasks run strictly one at a time, in the order they were submitted.
// A failing task never blocks the tasks behind it.
export type Queue = { run<T>(fn: () => Promise<T>): Promise<T> };

export function createQueue(): Queue {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = chain.then(() => fn());
      chain = result.catch(() => undefined);
      return result;
    },
  };
}
