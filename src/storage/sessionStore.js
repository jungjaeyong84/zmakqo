const session = require("express-session");
const { getFirestore } = require("./firestore");

class FirestoreSessionStore extends session.Store {
  constructor({ collection = "sessions", ttlMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    super();
    this.collection = collection;
    this.ttlMs = Number.isFinite(Number(ttlMs)) ? Number(ttlMs) : 7 * 24 * 60 * 60 * 1000;
  }

  _toPlainSession(sessionObj) {
    if (!sessionObj) return null;
    try {
      return JSON.parse(JSON.stringify(sessionObj));
    } catch (_) {
      const plain = {};
      for (const [k, v] of Object.entries(sessionObj)) {
        plain[k] = v;
      }
      return plain;
    }
  }

  _ref(sid) {
    return getFirestore().collection(this.collection).doc(String(sid));
  }

  _expiresAt(sessionObj) {
    const cookie = sessionObj && sessionObj.cookie;
    const exp = cookie && cookie.expires ? new Date(cookie.expires) : null;
    const ms = exp && !Number.isNaN(exp.getTime()) ? exp.getTime() : (Date.now() + this.ttlMs);
    return new Date(ms);
  }

  get(sid, cb) {
    this._ref(sid).get()
      .then((snap) => {
        if (!snap.exists) return cb(null, null);
        const data = snap.data() || {};
        const expiresAt = data.expires_at && data.expires_at.toDate ? data.expires_at.toDate() : null;
        if (expiresAt && expiresAt.getTime() <= Date.now()) {
          return this.destroy(sid, () => cb(null, null));
        }
        return cb(null, data.session || null);
      })
      .catch((err) => cb(err));
  }

  set(sid, sessionObj, cb) {
    const safeSession = this._toPlainSession(sessionObj);
    const payload = {
      session: safeSession,
      expires_at: this._expiresAt(safeSession),
      updated_at: new Date(),
      created_at: new Date(),
    };
    this._ref(sid).set(payload, { merge: true })
      .then(() => cb && cb(null))
      .catch((err) => cb && cb(err));
  }

  touch(sid, sessionObj, cb) {
    const safeSession = this._toPlainSession(sessionObj);
    const payload = {
      session: safeSession,
      expires_at: this._expiresAt(safeSession),
      updated_at: new Date(),
    };
    this._ref(sid).set(payload, { merge: true })
      .then(() => cb && cb(null))
      .catch((err) => cb && cb(err));
  }

  destroy(sid, cb) {
    this._ref(sid).delete()
      .then(() => cb && cb(null))
      .catch((err) => cb && cb(err));
  }
}

module.exports = { FirestoreSessionStore };
