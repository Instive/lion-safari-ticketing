import type { Instrumentation } from "next";

import { log } from "@/lib/log";

/**
 * Optionally hosts the background jobs inside this web process.
 *
 * Off by default: the standalone `lion-safari-worker` service is the shape the
 * app was designed around. Turning `RUN_WORKER_IN_WEB=true` on the web service
 * — and deleting the worker service — collapses two paid instances into one,
 * which is the single biggest saving available on a small deployment.
 *
 * Started WITHOUT being awaited, on purpose. Next docs are explicit that
 * `register` must complete before the server accepts requests, so awaiting a
 * database-dependent startup here would mean a slow or briefly unavailable
 * Postgres delays — or fails — the whole web boot. Ticket sales must not
 * depend on the queue being reachable; a failure is logged and the site serves
 * regardless.
 *
 * The `nodejs` guard matters twice: `register` also runs in the edge runtime,
 * where pg-boss and `node:` built-ins do not exist, and the dynamic import
 * keeps that module graph out of the edge bundle entirely.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { env } = await import("@/lib/env");
  if (!env.RUN_WORKER_IN_WEB) return;

  const { startWorkers } = await import("@/jobs/start-workers");

  log.info("worker", "starting in-process (RUN_WORKER_IN_WEB=true)");
  void startWorkers().catch((err) => {
    log.error("worker", "in-process startup failed — background jobs are NOT running", err);
  });
}

/**
 * The one place guaranteed to see every server-side error the web process
 * produces, regardless of whether the route, action or component that threw
 * remembered to catch and log it itself.
 *
 * Next already prints its own default trace for these to stdout, so this is
 * not the difference between visible and invisible — it is the difference
 * between an unlabelled stack dump and one line tagged `[request]`, findable
 * by scope, carrying which route and which kind of handler (render, route
 * handler, server action, proxy) it happened in.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const digest =
    typeof err === "object" && err !== null && "digest" in err
      ? String((err as { digest?: unknown }).digest)
      : undefined;

  log.error("request", `unhandled error — ${context.routeType} ${request.path}`, err, {
    method: request.method,
    routePath: context.routePath,
    routerKind: context.routerKind,
    ...(digest ? { digest } : {}),
  });
};
