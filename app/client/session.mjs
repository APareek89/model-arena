// UI ordering guard. Authentication, session revocation and CSRF are enforced by the server.
export function createClientSession(fetcher, onExpire = () => {}) {
  let owner, generation = 0, csrf = '', enabled = true;
  const current = value => value === generation;
  const assert = value => { if (!current(value)) throw new DOMException('Your account changed.', 'AbortError'); };
  const accept = (value, force = false) => {
    const nextOwner = value.enabled === false ? 'local-fixture' : value.user?.id || null;
    if (force || owner !== nextOwner) generation++;
    owner = nextOwner; enabled = value.enabled !== false; csrf = value.csrf_token || '';
    return generation;
  };
  async function request(path, options = {}, epoch = generation) {
    assert(epoch);
    const headers = new Headers(options.headers);
    if (enabled && !['GET', 'HEAD', 'OPTIONS'].includes((options.method || 'GET').toUpperCase())) {
      if (!csrf) throw new Error('Refresh the page to prepare your secure session.');
      headers.set('X-CSRF-Token', csrf);
    }
    const response = await fetcher(path, { ...options, headers, credentials: 'same-origin' });
    assert(epoch);
    const data = await response.json().catch(() => ({}));
    assert(epoch);
    if (!response.ok) {
      if (response.status === 401 && !path.startsWith('/api/auth/')) {
        accept({ enabled: true, user: null }); onExpire();
        throw new DOMException('Your session expired. Sign in again.', 'AbortError');
      }
      const error = new Error(typeof data.error === 'string' ? data.error : 'The request could not be completed. Please try again.');
      if (typeof data.requestId === 'string' && /^[0-9a-f-]{36}$/.test(data.requestId)) error.requestId = data.requestId;
      throw error;
    }
    return data;
  }
  async function read() {
    const epoch = generation;
    let response;
    try { response = await fetcher('/api/session', { cache: 'no-store', credentials: 'same-origin' }); }
    catch { assert(epoch); throw new Error('Account service is unavailable. Please try again.'); }
    assert(epoch);
    if (!response.ok) throw new Error('Account service is unavailable. Please try again.');
    let value;
    try { value = await response.json(); } catch { assert(epoch); throw new Error('Account service returned an unreadable response. Please try again.'); }
    assert(epoch); accept(value); return value;
  }
  return { accept, capture: () => generation, current, assert, request, read };
}

export const session = createClientSession((...args) => fetch(...args), () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('arena-session-expired'));
});
export const ownerStorageKey = id => `model-arena:owner:${id}:v2`;
export function scrubLegacyAccessKey(storage) {
  // Do not adopt or erase the old unowned workspace. Only retire its persisted shared key.
  try {
    const old = JSON.parse(storage.getItem('model-arena:v1') || 'null');
    if (old && Object.hasOwn(old, 'accessKey')) { delete old.accessKey; storage.setItem('model-arena:v1', JSON.stringify(old)); }
  } catch { /* Invalid legacy data is left untouched and never imported. */ }
}

export async function performAuth(action, fields, origin, fetcher = fetch) {
  const response = await fetcher('/api/auth/csrf', { cache: 'no-store', credentials: 'same-origin' });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.csrfToken) throw new Error('Could not prepare sign-in. Please try again.');
  const result = await fetcher(`/api/auth/${action}`, {
    method: 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1' },
    body: new URLSearchParams({ csrfToken: token.csrfToken, callbackUrl: origin, json: 'true', ...fields }),
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok || typeof data.url !== 'string') throw new Error('Account request was not completed. Please try again.');
  const url = new URL(data.url, origin);
  if (url.searchParams.has('error')) throw new Error('Email or password was not accepted. Please try again.');
  if (url.origin !== origin) throw new Error('Account redirect was not accepted. Refresh and try again.');
}
