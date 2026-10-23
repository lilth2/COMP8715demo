"use strict";
// Postgres-backed sessions (backend/db/schema.sql's `sessions` table), used instead of the
// in-memory Map when the server is running with DATABASE_URL set. Tokens themselves are never
// stored — only their SHA-256 hash — so a database read/backup cannot be used to impersonate a
// session, matching the spirit of the existing scrypt password hashing.
const { randomBytes, createHash } = require("node:crypto");

function hashToken(token) { return createHash("sha256").update(token).digest("hex"); }

function createSessionsStore(pool, ttlMs) {
  return {
    async create(accountId, remoteAddr) {
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + ttlMs);
      await pool.query(
        "INSERT INTO sessions (account_id, token_hash, expires_at, remote_addr) VALUES ($1,$2,$3,$4)",
        [accountId, hashToken(token), expiresAt, remoteAddr || null]
      );
      return { token, expiresAt: expiresAt.getTime() };
    },
    // Returns { accountId, username, role, environment, expires } or null. Joins accounts so a
    // disabled/expired account's existing sessions stop working immediately, not just at next login.
    async get(token) {
      const r = await pool.query(
        `SELECT s.account_id, s.expires_at, a.username, a.role, a.environment, a.disabled_at, a.expires_at AS account_expires_at, a.must_change_password
         FROM sessions s JOIN accounts a ON a.id = s.account_id
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
        [hashToken(token)]
      );
      const row = r.rows[0];
      if (!row) return null;
      if (new Date(row.expires_at) <= new Date()) return null;
      if (row.disabled_at) return null;
      if (row.account_expires_at && new Date(row.account_expires_at) <= new Date()) return null;
      return { accountId: row.account_id, username: row.username, role: row.role, environment: row.environment, expires: new Date(row.expires_at).getTime(), mustChangePassword: row.must_change_password };
    },
    async revoke(token) {
      await pool.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1", [hashToken(token)]);
    },
    // Revokes every active session for an account — used when disabling an account or resetting
    // its password, so an already-issued session token cannot keep working afterward.
    async revokeAllForAccount(accountId) {
      await pool.query("UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL", [accountId]);
    },
    async cleanupExpired() {
      await pool.query("DELETE FROM sessions WHERE expires_at < now() - interval '7 days'");
    },
  };
}

module.exports = { createSessionsStore };
