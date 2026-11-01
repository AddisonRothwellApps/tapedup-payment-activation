// Calls to the trade server's own API (email, outbox, threads). Only works
// at trade.tapedup.co.uk, where the Microsoft 365 sign-in cookie is sent;
// inside Shopify admin these screens point people there instead.
import { EMBEDDED, TRADE_SERVER } from './env.js';
import { ApiError } from './api.js';

export const SERVER_FEATURES = !EMBEDDED;

export async function serverApi(path, { method = 'GET', body } = {}) {
  if (EMBEDDED) throw new ApiError(`Email works at ${TRADE_SERVER}`, 'EMBEDDED');
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.hash)}`;
    throw new ApiError('Signed out', 'SIGNED_OUT');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.message || json.error || `The server said ${res.status}`, json.error || null);
  return json;
}
