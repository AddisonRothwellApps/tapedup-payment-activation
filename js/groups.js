// Groups: one business with several centres (The Climbing Academy, Climbing
// Hangar…). Each centre stays its own customer or prospect with its own
// emails and orders; the group adds their orders up and lets the agent
// mention a sister site that already stocks us. Kept on the trade server.
import { serverApi, SERVER_FEATURES } from './server.js';

export const groupState = { list: [], loaded: false, loading: null, error: null };

export function loadGroups({ force = false } = {}) {
  if (!SERVER_FEATURES) return Promise.resolve([]);
  if (groupState.loading) return groupState.loading;
  if (groupState.loaded && !force) return Promise.resolve(groupState.list);
  groupState.loading = serverApi('/api/groups')
    .then((r) => { groupState.list = r.groups; groupState.loaded = true; groupState.error = null; return r.groups; })
    .catch((err) => { groupState.error = err.message; return []; })
    .finally(() => { groupState.loading = null; window.dispatchEvent(new Event('groups-changed')); });
  return groupState.loading;
}

export const groupById = (id) => groupState.list.find((g) => g.id === Number(id)) || null;
export const groupOfCustomer = (gid) => groupState.list.find((g) => g.customers.some((c) => c.customerId === gid)) || null;
export const groupOfProspect = (id) => groupState.list.find((g) => g.prospects.some((p) => p.id === Number(id))) || null;
export const siteNameOf = (g, { customerId, prospectId }) => (customerId ? g.customers.find((c) => c.customerId === customerId) : g.prospects.find((p) => p.id === Number(prospectId)))?.siteName || '';

async function call(path, body, method = 'POST') {
  const r = await serverApi(path, { method, body });
  await loadGroups({ force: true });
  return r;
}

export const createGroup = (name, notes = '') => call('/api/groups', { name, notes });
export const updateGroup = (id, patch) => call(`/api/groups/${id}`, patch, 'PATCH');
export const deleteGroup = (id) => call(`/api/groups/${id}`, undefined, 'DELETE');
export const addSite = (id, site) => call(`/api/groups/${id}/sites`, site);
export const renameSite = (site) => call('/api/groups/sites/name', site);
export const removeSite = (site) => call('/api/groups/sites/remove', site);
