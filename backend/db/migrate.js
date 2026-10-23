"use strict";
// Runs backend/db/schema.sql against DATABASE_URL. Safe to run repeatedly: every statement is
// CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING, so re-running on an already-migrated
// database is a no-op. Usage: node backend/db/migrate.js (reads DATABASE_URL from the environment).
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

async function migrate(connectionString) {
  const pool = new Pool({ connectionString });
  try {
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await pool.query(sql);
    console.log("Migration complete: schema is up to date.");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    console.error("Set DATABASE_URL before running the migration, e.g. postgres://user:pass@host:5432/dbname");
    process.exit(1);
  }
  migrate(process.env.DATABASE_URL).catch(error => { console.error(error.message); process.exit(1); });
}

module.exports = { migrate };
