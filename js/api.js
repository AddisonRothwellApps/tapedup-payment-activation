// Admin GraphQL, from either place Trade Hub runs (see env.js):
//   embedded:   App Bridge direct API access, fetch('shopify:admin/...'),
//               authenticated by the embedded session.
//   standalone: the trade server's /api/shopify/graphql, authenticated by
//               the Microsoft 365 sign-in cookie; the server adds the token.
// Either way the response is Shopify's own, so the rest is shared: pacing
// against Shopify's query-cost bucket (wait instead of failing when it runs
// low) and a clear error for userErrors on mutations.
import { EMBEDDED } from './env.js';

const ENDPOINT = EMBEDDED ? 'shopify:admin/api/graphql.json' : '/api/shopify/graphql';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

let lastThrottle = null; // { currentlyAvailable, restoreRate } from the previous response

export async function gql(query, variables) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(ENDPOINT, EMBEDDED
      ? { method: 'POST', body: JSON.stringify({ query, variables }) }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ query, variables }) });
    if (!EMBEDDED && res.status === 401) {
      // Signed out (or the session expired): back through Microsoft sign-in.
      location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.hash)}`;
      throw new ApiError('Signed out', 'SIGNED_OUT');
    }
    const json = await res.json();
    if (!EMBEDDED && res.status === 503) {
      throw new ApiError('Shopify isn\'t connected to trade.tapedup.co.uk yet. Open Trade Hub inside Shopify admin, go to Setup and press "Connect trade.tapedup.co.uk".', 'NOT_LINKED');
    }
    const cost = json.extensions && json.extensions.cost;
    if (cost && cost.throttleStatus) lastThrottle = cost.throttleStatus;

    if (json.errors && json.errors.length) {
      const codes = json.errors.map((e) => e.extensions && e.extensions.code);
      if (codes.includes('THROTTLED')) {
        const needed = (cost && cost.requestedQueryCost) || 200;
        const restore = (lastThrottle && lastThrottle.restoreRate) || 50;
        await sleep(Math.ceil((needed / restore) * 1000) + 250);
        continue;
      }
      const message = json.errors.map((e) => e.message).join('; ');
      throw new ApiError(message, codes.includes('MAX_COST_EXCEEDED') ? 'MAX_COST_EXCEEDED' : codes[0] || null);
    }

    // Leave headroom for the next call rather than running the bucket dry.
    if (cost && lastThrottle && lastThrottle.currentlyAvailable < cost.requestedQueryCost) {
      const deficit = cost.requestedQueryCost - lastThrottle.currentlyAvailable;
      await sleep(Math.ceil((deficit / (lastThrottle.restoreRate || 50)) * 1000));
    }
    return json.data;
  }
  throw new ApiError('Shopify is busy right now — try again in a minute.', 'THROTTLED');
}

/** Throws if any mutation payload in `data` came back with userErrors. */
export function assertOk(data) {
  const errors = [];
  for (const payload of Object.values(data || {})) {
    if (payload && Array.isArray(payload.userErrors)) errors.push(...payload.userErrors);
  }
  if (errors.length) throw new ApiError(errors.map((e) => e.message).join('; '), 'USER_ERROR');
  return data;
}

/**
 * Walks every page of a connection. `buildQuery(pageSize)` returns the query
 * text (taking $after); `pick(data)` returns the connection. Halves the page
 * size if Shopify says a page is too expensive, so a store with unusually
 * large orders still loads.
 */
export async function paginate(buildQuery, variables, pick, { pageSize = 50, onPage } = {}) {
  const nodes = [];
  let after = null;
  let size = pageSize;
  for (;;) {
    let data;
    try {
      data = await gql(buildQuery(size), { ...variables, after });
    } catch (err) {
      if (err.code === 'MAX_COST_EXCEEDED' && size > 5) { size = Math.floor(size / 2); continue; }
      throw err;
    }
    const conn = pick(data);
    nodes.push(...conn.nodes);
    if (onPage) onPage(nodes.length);
    if (!conn.pageInfo.hasNextPage) return nodes;
    after = conn.pageInfo.endCursor;
  }
}
