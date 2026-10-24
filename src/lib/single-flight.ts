/** Share pending work across timer, reconnect, and manual triggers in this tab. */
export function singleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= Promise.resolve().then(run).finally(() => { pending = undefined; });
    return pending;
  };
}
