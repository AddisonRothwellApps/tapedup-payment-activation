// Prospects: gyms and shops we've not heard back from yet. They live on the
// trade server (not in Shopify) until they reply, then become a Shopify
// customer tagged "trade-lead". Only available at trade.tapedup.co.uk.
import { serverApi, SERVER_FEATURES } from './server.js';

// Postgres bigint ids arrive as strings.
const norm = (p) => ({ ...p, id: Number(p.id) });

export const prospectState = { items: [], loaded: false, loading: null, error: null };

export function loadProspects({ force = false } = {}) {
  if (!SERVER_FEATURES) return Promise.resolve([]);
  if (prospectState.loading) return prospectState.loading;
  if (prospectState.loaded && !force) return Promise.resolve(prospectState.items);
  prospectState.loading = serverApi('/api/prospects')
    .then((r) => { prospectState.items = r.items.map(norm); prospectState.loaded = true; prospectState.error = null; return r.items; })
    .catch((err) => { prospectState.error = err.message; return []; })
    .finally(() => { prospectState.loading = null; window.dispatchEvent(new Event('prospects-changed')); });
  return prospectState.loading;
}

export async function updateProspect(id, patch) {
  const { item } = await serverApi(`/api/prospects/${id}`, { method: 'PATCH', body: patch });
  const i = prospectState.items.findIndex((p) => p.id === id);
  if (i >= 0) prospectState.items[i] = { ...prospectState.items[i], ...norm(item) };
  window.dispatchEvent(new Event('prospects-changed'));
  return item;
}

export const prospectLabel = (p) => p.company;
