"use strict";
// One-time (or repeatable) account bootstrap for the multi-account / Postgres auth mode
// (backend/accounts-pg.js). Creates an initial admin account and, optionally, the stakeholder's
// UAT account — both with full server-side-enforced capability within that environment, per
// docs/UAT.md. Never hardcodes a password: a strong one is generated and printed once, or read
// from an environment variable you set yourself for this one run (never committed to the repo).
//
// Usage (against a UAT database):
//   DATABASE_URL=postgres://... APP_ENVIRONMENT=uat node backend/accounts-bootstrap.js \
//     --admin-username admin \
//     --stakeholder-username <her chosen username> [--stakeholder-password "..."]
//
// Re-running is safe: an existing username in that environment is left untouched (reported, not
// overwritten) — use the running server's account-management endpoints (or a follow-up
// --reset-password flag) to change a password instead of re-running this script blindly.
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { createAccountsStore } = require("./accounts-pg");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true; }
  }
  return out;
}
function randomPassword() { return "RD-" + crypto.randomBytes(15).toString("base64url"); }

async function ensureAccount(accountsStore, { username, role, passwordEnvVar, explicitPassword, displayName }) {
  const existing = (await accountsStore.list()).find(a => a.username === username);
  if (existing) {
    console.log(`Account "${username}" (${role}) already exists in this environment — left unchanged. Disabled: ${existing.disabled}.`);
    return null;
  }
  // A generated one-time password (the common case: no --*-password flag given) forces a change
  // on first login, per the brief — the recipient must set a password only they know before the
  // account can do anything. An explicitly-supplied password is assumed already chosen by/for the
  // account holder and does not force a change.
  const generated = !explicitPassword && !process.env[passwordEnvVar];
  const password = explicitPassword || process.env[passwordEnvVar] || randomPassword();
  const created = await accountsStore.create({ username, password, role, displayName, createdBy: "accounts-bootstrap-script", mustChangePassword: generated });
  console.log(`Created ${role} account: username="${created.username}"  password="${password}"`);
  if (generated) console.log(`  This is a one-time password — the account must set its own password at first login before it can do anything else.`);
  console.log(`  (Store this password securely now — it is not saved anywhere and cannot be shown again.)`);
  return created;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the target database (the UAT database for a stakeholder account — never production for a shared test account).");
  const environment = (process.env.APP_ENVIRONMENT || "uat").toLowerCase();
  if (environment !== "production" && environment !== "uat") throw new Error("APP_ENVIRONMENT must be \"production\" or \"uat\".");
  if (environment === "production" && args["stakeholder-username"]) {
    throw new Error("Refusing to create a stakeholder account with APP_ENVIRONMENT=production. Point this at the isolated UAT database instead.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const accountsStore = createAccountsStore(pool, environment);
  try {
    if (args["admin-username"]) {
      await ensureAccount(accountsStore, { username: args["admin-username"], role: "admin", passwordEnvVar: "ADMIN_PASSWORD", explicitPassword: typeof args["admin-password"] === "string" ? args["admin-password"] : undefined, displayName: "Administrator" });
    }
    if (args["stakeholder-username"]) {
      await ensureAccount(accountsStore, { username: args["stakeholder-username"], role: "stakeholder", passwordEnvVar: "STAKEHOLDER_PASSWORD", explicitPassword: typeof args["stakeholder-password"] === "string" ? args["stakeholder-password"] : undefined, displayName: args["stakeholder-name"] || "Stakeholder (UAT)" });
    }
    if (!args["admin-username"] && !args["stakeholder-username"]) {
      console.log("Nothing to do: pass --admin-username and/or --stakeholder-username.");
    }
    console.log(`\nEnvironment: ${environment}. Accounts created here can only sign in to a server process started with the same DATABASE_URL and APP_ENVIRONMENT=${environment}.`);
  } finally {
    await pool.end();
  }
}

main().catch(error => { console.error("FAILED: " + error.message); process.exit(1); });
