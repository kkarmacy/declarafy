// Declarafy API client and Firebase-compatibility adapter for Namecheap.
// The adapter lets the existing UI keep its data calls while PHP/MySQL becomes
// the only authentication and persistence authority.
'use strict';

const DECLARAFY_API_ENDPOINT = '/api/index.php';
let declarafyCsrfToken = '';
let declarafySessionUser = null;

async function declarafyFetch(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, cache: 'no-store', signal: controller.signal });
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'El servidor tardó demasiado. Intenta nuevamente; no repitas la operación varias veces.'
      : 'No se pudo conectar con el servidor. Comprueba tu conexión e intenta nuevamente.';
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

async function declarafyApi(action, options = {}) {
  const method = options.method || 'POST';
  const headers = { 'Accept': 'application/json', 'X-Requested-With': 'DeclarafyWeb' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    if (!declarafyCsrfToken) await declarafyLoadSession();
    headers['X-CSRF-Token'] = declarafyCsrfToken;
  }
  const response = await declarafyFetch(`${DECLARAFY_API_ENDPOINT}?action=${encodeURIComponent(action)}`, {
    method,
    credentials: 'same-origin',
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(options.body || {})
  });
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch (_) {
    throw new Error('El servidor devolvió una respuesta inválida. Recarga la página e intenta nuevamente.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('El servidor devolvió una respuesta inválida. Recarga la página e intenta nuevamente.');
  }
  if (!response.ok || payload.ok === false) {
    const fallback = response.status >= 500
      ? 'El servidor no pudo completar la operación. Intenta nuevamente.'
      : `La solicitud no pudo completarse (${response.status}).`;
    const error = new Error(payload.message || fallback);
    error.code = payload.code || 'server/error';
    throw error;
  }
  if (payload.csrfToken) declarafyCsrfToken = payload.csrfToken;
  if (!payload || payload.ok !== true || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error('La respuesta del servidor está incompleta. Recarga la página e intenta nuevamente.');
  }
  return payload.data;
}

async function declarafyLoadSession() {
  const response = await declarafyFetch(`${DECLARAFY_API_ENDPOINT}?action=session`, {
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json', 'X-Requested-With': 'DeclarafyWeb' }
  });
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch (_) {
    throw new Error('El servidor devolvió una sesión inválida. Recarga la página e intenta nuevamente.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('El servidor devolvió una sesión inválida. Recarga la página e intenta nuevamente.');
  }
  if (!response.ok || payload.ok === false) throw new Error(payload.message || 'No se pudo iniciar la sesión segura.');
  declarafyCsrfToken = payload.csrfToken || '';
  declarafySessionUser = payload.data?.user || null;
  return declarafySessionUser;
}

function declarafyUser(raw) {
  if (!raw) return null;
  return {
    uid: String(raw.uid),
    email: raw.email,
    displayName: raw.name || '',
    async updateProfile(changes) {
      if (changes?.displayName) await declarafyApi('profile_update', { body: { name: changes.displayName } });
    },
    async updatePassword(password) { await declarafyApi('change_password', { body: { password } }); },
    async reauthenticateWithCredential(credential) {
      await declarafyApi('reauthenticate', { body: { password: credential.password } });
    },
    async getIdToken() { return declarafyCsrfToken; }
  };
}

const declarafyAuth = {
  currentUser: null,
  async signInWithEmailAndPassword(email, password) {
    const data = await declarafyApi('login', { body: { email, password } });
    declarafySessionUser = data.user;
    this.currentUser = declarafyUser(data.user);
    return { user: this.currentUser };
  },
  async createUserWithEmailAndPassword(email, password) {
    const name = (document.getElementById('rName')?.value || document.getElementById('rN')?.value || '').trim();
    const refBy = localStorage.getItem('tp_ref') || '';
    const data = await declarafyApi('register', { body: { name, email, password, refBy } });
    declarafySessionUser = data.user;
    this.currentUser = declarafyUser(data.user);
    return { user: this.currentUser };
  },
  async sendPasswordResetEmail(email) { await declarafyApi('recover', { body: { email } }); },
  async signOut() {
    await declarafyApi('logout', { body: {} });
    declarafySessionUser = null;
    this.currentUser = null;
  },
  onAuthStateChanged(callback) {
    declarafyLoadSession()
      .then(user => { this.currentUser = declarafyUser(user); callback(this.currentUser); })
      .catch(() => callback(null));
    return () => {};
  }
};

function querySnapshot(items) {
  const docs = (items || []).map(item => ({ id: String(item.id || item.key || ''), data: () => item.data ?? item }));
  return { docs, forEach(callback) { docs.forEach(callback); } };
}

function firestoreDocument(path) {
  return {
    collection(name) { return firestoreCollection(`${path}/${name}`); },
    async get() {
      if (/^users\/[^/]+$/.test(path)) {
        const data = await declarafyApi('profile_get', { method: 'GET' });
        return { exists: !!data?.user, data: () => data.user };
      }
      if (/^historial\//.test(path)) {
        const data = await declarafyApi('history_get', { method: 'GET' });
        return { exists: true, data: () => ({ data: data.items || [] }) };
      }
      if (/^casos\//.test(path)) {
        const data = await declarafyApi('cases_get', { method: 'GET' });
        return { exists: true, data: () => ({ data: data.items || [] }) };
      }
      return { exists: false, data: () => null };
    },
    async set(value) {
      if (/^users\/[^/]+\/kv\//.test(path)) {
        const key = path.split('/').pop();
        return declarafyApi('kv_set', { body: { key, value: value.v } });
      }
      if (/^users\/[^/]+$/.test(path)) return declarafyApi('profile_update', { body: value });
      if (/^historial\//.test(path)) return declarafyApi('history_set', { body: { items: value.data || [] } });
      if (/^casos\//.test(path)) return declarafyApi('cases_set', { body: { items: value.data || [] } });
      if (/^sugerencias\//.test(path)) return declarafyApi('suggestions_create', { body: value });
      return null;
    },
    async update(value) {
      if (/^users\/[^/]+$/.test(path)) {
        if (value.mc?.__increment) return declarafyApi('increment_message', { body: {} });
        return declarafyApi('profile_update', { body: value });
      }
      if (/^sugerencias\//.test(path)) {
        return declarafyApi('suggestions_update', { body: { id: path.split('/').pop(), ...value } });
      }
      return null;
    }
  };
}

function firestoreCollection(path) {
  const query = {
    doc(id) { return firestoreDocument(`${path}/${id}`); },
    orderBy() { return query; },
    limit() { return query; },
    async get() {
      if (/^users\/[^/]+\/kv$/.test(path)) {
        const data = await declarafyApi('kv_get_all', { method: 'GET' });
        return querySnapshot(Object.entries(data.items || {}).map(([key, value]) => ({ id: key, data: { v: value } })));
      }
      if (path === 'sugerencias') {
        const data = await declarafyApi('suggestions_list', { method: 'GET' });
        return querySnapshot(data.items || []);
      }
      return querySnapshot([]);
    }
  };
  return query;
}

const declarafyFirestore = { collection: firestoreCollection, enablePersistence: async () => {} };

window.firebase = {
  apps: [],
  initializeApp(config) { const app = { config }; this.apps.push(app); return app; },
  auth() { return declarafyAuth; },
  firestore() { return declarafyFirestore; },
  messaging() { throw new Error('Las notificaciones push todavía no están habilitadas en el servidor.'); }
};
window.firebase.auth.EmailAuthProvider = { credential(email, password) { return { email, password }; } };
window.firebase.firestore.FieldValue = {
  increment(amount) { return { __increment: Number(amount) || 0 }; },
  serverTimestamp() { return { __serverTimestamp: true }; }
};
