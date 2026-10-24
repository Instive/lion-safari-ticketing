/** Pull only when the response consumer is ready; never buffer the whole export. */
export function streamBytes(source: AsyncGenerator<Uint8Array>, signal?: AbortSignal): ReadableStream<Uint8Array> {
  let stopped = false;
  const cleanup = () => signal?.removeEventListener("abort", abort);
  const stop = async () => {
    stopped = true;
    cleanup();
    // If a DB batch is in flight, finish that one, then close the generator.
    await source.return(undefined);
  };
  let abort: () => void;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => {
        if (stopped) return;
        controller.error(signal?.reason ?? new Error("Download aborted"));
        void stop().catch(() => {});
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    },
    async pull(controller) {
      try {
        const item = await source.next();
        if (stopped) return;
        if (item.done) {
          stopped = true;
          cleanup();
          controller.close();
        } else {
          controller.enqueue(item.value);
        }
      } catch (err) {
        if (!stopped) {
          stopped = true;
          cleanup();
          controller.error(err);
        }
      }
    },
    cancel: stop,
  }, { highWaterMark: 0 });
}
