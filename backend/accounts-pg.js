"use strict";
// Multi-account management backed by the Postgres `accounts` table (backend/db/schema.sql).
// Only available when the server is running with DATABASE_URL set — the single-JSON-file store
// keeps its existing one-hardcoded-admin model (backend/server-data.js, backend/setup-admin.js)
// unchanged, since a real multi-account / role system needs a real database to be meaningful
// (per-account audit, disable, session revocation, environment separation).
//
// Two roles: "admin" (the developer/owner account(s)) and "stakeholder" (a UAT tester given full
// admin-equivalent capability within that UAT deployment — see docs/UAT.md for the rationale:
// the brief asks for her to have the same permissions as the environment's own admin, not a
// cut-down role, so there is no separate granular permission matrix to maintain here). Both roles
// can call every existing /api/admin/* endpoint and the account-management endpoints below; what
// actually limits a stakeholder account to "UAT only" is that it is a row in the UAT deployment's
// own database — a completely separate Postgres database/connection from production, per
// docs/DEPLOYMENT.md's environment-separation requirement. There is no cross-environment access
// to revoke because there is no shared row, connection, or process between the two.
const { randomBytes, scrypt, scryptSync, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const deriveKey = promisify(scrypt);

function assertRole(role) {
  if (role !== "admin" && role !== "stakeholder") throw Object.assign(new Error("Invalid role."), { status: 400 });
}
function assertUsername(username) {
  if (typeof username !== "string" || !/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
    throw Object.assign(new Error("Username must be 3-64 characters: letters, digits, dot, underscore or dash."), { status: 400 });
  }
}
function assertPassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) {
    throw Object.assign(new Error("Password must be at least 12 characters."), { status: 400 });
  }
}

function createAccountsStore(pool, environment) {
  async function findByUsername(username) {
    const r = await pool.query("SELECT * FROM accounts WHERE username = $1 AND environment = $2", [username, environment]);
    return r.rows[0] || null;
  }
  async function findById(id) {
    const r = await pool.query("SELECT * FROM accounts WHERE id = $1 AND environment = $2", [id, environment]);
    return r.rows[0] || null;
  }
  function toPublic(row) {
    return {
      id: row.id, username: row.username, role: row.role, displayName: row.display_name,
      environment: row.environment, disabled: row.disabled_at !== null, disabledAt: row.disabled_at,
      expiresAt: row.expires_at, createdAt: row.created_at, createdBy: row.created_by,
    };
  }

  return {
    toPublic,
    // Verifies username/password against this environment's accounts, rejecting a disabled or
    // expired account even with the correct password. Never logs or returns the password/hash.
    async authenticate(username, password) {
      const row = await findByUsername(username);
      if (!row) { await deriveKey(password, "no-such-account-constant-time-decoy", 64); return null; } // constant-time-ish: still does the scrypt work
      if (row.disabled_at) return null;
      if (row.expires_at && new Date(row.expires_at) <= new Date()) return null;
      const key = await deriveKey(password, row.password_salt, 64);
      if (!timingSafeEqual(key, Buffer.from(row.password_hash, "hex"))) return null;
      return toPublic(row);
    },
    async list() {
      const r = await pool.query("SELECT * FROM accounts WHERE environment = $1 ORDER BY created_at", [environment]);
      return r.rows.map(toPublic);
    },
    async get(id) {
      const row = await findById(id);
      return row ? toPublic(row) : null;
    },
    // Creates a new account in this environment. The caller (an authenticated admin/stakeholder
    // session — see server.js's route guard) provides the initial password directly; there is no
    // self-service registration endpoint anywhere in this app.
    async create({ username, password, role, displayName, createdBy, expiresAt }) {
      assertUsername(username); assertPassword(password); assertRole(role);
      if (expiresAt !== undefined && expiresAt !== null) {
        // The brief is explicit: do not invent an expiry date before the user has confirmed one.
        // This path exists for completeness (server-enforced expiry, if a date is ever supplied)
        // but callers in this codebase never pass one on their own initiative.
        if (isNaN(new Date(expiresAt).getTime())) throw Object.assign(new Error("Invalid expiry date."), { status: 400 });
      }
      const existing = await findByUsername(username);
      if (existing) throw Object.assign(new Error("That username already exists in this environment."), { status: 409 });
      const salt = randomBytes(32).toString("hex");
      const passwordHash = scryptSync(password, salt, 64).toString("hex");
      const r = await pool.query(
        `INSERT INTO accounts (username, password_salt, password_hash, role, display_name, environment, created_by, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [username, salt, passwordHash, role, displayName || null, environment, createdBy || null, expiresAt || null]
      );
      return toPublic(r.rows[0]);
    },
    async setPassword(id, newPassword) {
      assertPassword(newPassword);
      const row = await findById(id);
      if (!row) throw Object.assign(new Error("Account not found."), { status: 404 });
      const salt = randomBytes(32).toString("hex");
      const passwordHash = scryptSync(newPassword, salt, 64).toString("hex");
      await pool.query("UPDATE accounts SET password_salt=$2, password_hash=$3 WHERE id=$1", [id, salt, passwordHash]);
    },
    async disable(id) {
      const row = await findById(id);
      if (!row) throw Object.assign(new Error("Account not found."), { status: 404 });
      await pool.query("UPDATE accounts SET disabled_at = now() WHERE id = $1 AND disabled_at IS NULL", [id]);
    },
    async enable(id) {
      const row = await findById(id);
      if (!row) throw Object.assign(new Error("Account not found."), { status: 404 });
      await pool.query("UPDATE accounts SET disabled_at = NULL WHERE id = $1", [id]);
    },
    // Account-management actions (create/disable/enable/password-change) happen outside the
    // dataset-core.js state tree that the regular audit_log writes go through (backend/db/pg-
    // store.js), so they need their own direct write here to stay traceable to the acting account.
    async audit({ actor, action, targetAccountId, targetUsername, result }) {
      await pool.query(
        `INSERT INTO audit_log (actor, action, record_type, record_id, label, result) VALUES ($1,$2,'account',$3,$4,$5)`,
        [actor, action, targetAccountId || null, targetUsername || null, result || "success"]
      );
    },
  };
}

module.exports = { createAccountsStore };
