// All multi-statement database writes go through this queue. Android delivers late location batches back-to-back
// on app resume; without it two transactions overlap and fail ("cannot start a transaction within a transaction").
import { createQueue } from '../../lib/queue';

const queue = createQueue();

export function serialize<T>(fn: () => Promise<T>): Promise<T> {
  return queue.run(fn);
}
