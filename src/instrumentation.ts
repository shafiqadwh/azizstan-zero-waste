import type { Instrumentation } from 'next';

/** Unexpected server errors as one redacted JSON line (12-security §2 item 6); no request headers or bodies. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { log } = await import('./server/log');
  log.error('request failed', err, {
    method: request.method,
    path: request.path.split('?')[0], // query strings may carry tokens
    routeType: context.routeType,
    routePath: context.routePath,
  });
};
