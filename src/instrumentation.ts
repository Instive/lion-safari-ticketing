import type { Instrumentation } from "next";

import { log } from "@/lib/log";

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
