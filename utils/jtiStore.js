/**
 * In-process jti replay store (single-instance only).
 * Multi-instance deployments should replace with Redis later.
 */

const store = new Map(); // jti -> expireAtMs
let cleanupTimer = null;

function nowMs() {
  return Date.now();
}

function purgeExpired(now = nowMs()) {
  for (const [jti, expireAt] of store.entries()) {
    if (expireAt <= now) store.delete(jti);
  }
}

/**
 * Consume a jti. Returns false if already used or invalid.
 * TTL = max(expSec, nowSec) + 5s buffer, stored as absolute ms.
 * @param {string} jti
 * @param {number} expSec unix seconds
 * @returns {boolean}
 */
function consume(jti, expSec) {
  if (!jti || typeof jti !== "string") return false;

  const now = nowMs();
  purgeExpired(now);

  if (store.has(jti)) return false;

  const nowSec = Math.floor(now / 1000);
  const baseExp = typeof expSec === "number" && Number.isFinite(expSec) ? expSec : nowSec;
  const expireAtMs = (Math.max(baseExp, nowSec) + 5) * 1000;
  store.set(jti, expireAtMs);
  return true;
}

function has(jti) {
  if (!jti) return false;
  purgeExpired();
  return store.has(jti);
}

function clear() {
  store.clear();
}

function size() {
  return store.size;
}

function startCleanupInterval(intervalMs = 30000) {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => purgeExpired(), intervalMs);
  if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();
}

function stopCleanupInterval() {
  if (!cleanupTimer) return;
  clearInterval(cleanupTimer);
  cleanupTimer = null;
}

startCleanupInterval();

module.exports = {
  consume,
  has,
  clear,
  size,
  purgeExpired,
  startCleanupInterval,
  stopCleanupInterval
};
