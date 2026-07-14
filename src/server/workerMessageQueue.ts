export function createWorkerMessageQueue<T>(
  handle: (message: T) => Promise<void>,
  onError: (error: unknown) => void,
): (message: T) => Promise<void> {
  let tail = Promise.resolve();
  return (message) => {
    tail = tail.then(() => handle(message)).catch((error) => {
      onError(error);
    });
    return tail;
  };
}
