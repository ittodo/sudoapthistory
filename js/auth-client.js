/** Same-origin authentication and API client. No credentials persist in browser storage. */
(function (global) {
  'use strict';
  if (global.NodoAPI) return;
  let state = null;
  let pending = null;
  const listeners = new Set();
  const creates = new Map();
  async function request(path, options = {}) {
    if (!path.startsWith('/api/')) throw new Error('허용되지 않은 API 경로입니다.');
    const method = options.method || 'GET';
    const headers = { Accept: 'application/json', ...options.headers };
    const auditSignature=method==='PUT'&&(/\/api\/admin\/comments\/\d+\/moderation$/.test(path)||/\/api\/board\/posts\/\d+\/pin$/.test(path))?path+'\n'+options.body:null;
    if(auditSignature&&!headers['Idempotency-Key']){if(!creates.has(auditSignature))creates.set(auditSignature,crypto.randomUUID());headers['Idempotency-Key']=creates.get(auditSignature);}
    if (method !== 'GET') {
      if (!state) await getState();
      if (!state?.session || !state.csrfToken) throw new Error('로그인이 필요합니다.');
      headers['X-CSRF-Token'] = state.csrfToken;
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(path, { ...options, method, headers, credentials: 'same-origin', cache: 'no-store' });
    let result;
    try { result = await response.json(); } catch (_) { throw new Error('서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.'); }
    if (!response.ok) {
      if(auditSignature&&response.status<500)creates.delete(auditSignature);
      const error = new Error(result.error?.message || result.message || '요청을 처리하지 못했습니다.');
      error.code = result.error?.code || result.code;
      error.status = response.status;
      if (response.status === 401) { state = null; listeners.forEach(fn => fn(null)); }
      throw error;
    }
    if(auditSignature)creates.delete(auditSignature);
    return result;
  }
  async function getState(refresh = false) {
    if (state && !refresh) return state;
    if (!pending) pending = request('/api/session').then(value => {
      if (!Object.hasOwn(value, 'session')) throw new Error('로그인 상태 응답이 올바르지 않습니다.');
      state = value; return value;
    }).finally(() => { pending = null; });
    return pending;
  }
  function login(reauth = false) {
    const params = new URLSearchParams({ returnTo: global.NodoApartmentLinks?.embedded ? global.NodoApartmentLinks.returnURL() : location.pathname + location.search + location.hash });
    if (reauth) params.set('reauth', '1');
    if(global.NodoApartmentLinks?.embedded)global.NodoApartmentLinks.navigate('/auth/google?' + params);else location.assign('/auth/google?' + params);
  }
  async function logout() {
    await request('/api/logout', { method: 'POST', body: '{}' });
    state = null;
    listeners.forEach(fn => fn(null));
  }
  async function create(path, body) {
    const payload = JSON.stringify(body);
    const signature = path + '\n' + payload;
    if (!creates.has(signature)) creates.set(signature, crypto.randomUUID());
    const result = await request(path, { method: 'POST', body: payload,
      headers: { 'Idempotency-Key': creates.get(signature) } });
    creates.delete(signature);
    return result;
  }
  global.NodoAPI = {
    request, getState, login, logout, create,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async saveProfile(nickname) {
      const result = await request('/api/profile', { method: 'PATCH', body: JSON.stringify({ nickname }) });
      if (state) state.profile = result.profile;
      return result.profile;
    }
  };
})(window);
