/** Rejects after `ms` without cancelling the underlying promise (callers treat timeout as failure). */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = `operation timed out after ${ms}ms`,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
