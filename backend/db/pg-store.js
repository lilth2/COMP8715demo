"use strict";
// Postgres-backed persistence, dropped in behind the same interface as backend/server-data.js
// (snapshot/publicData/migration/apply). All dataset rules (drafts, publishing, delete cascades,
// theme/host derivation, migration) still live in admin/dataset-core.js unchanged: this module's
// only job is to load the real relational tables into the in-memory tree shape that core expects,
// run core.apply() against it, and write back exactly the rows that changed inside one
// transaction, with per-record optimistic-concurrency checks.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createCore } = require("../../admin/dataset-core");

function rowsToActor(row, offices) {
  return Object.assign({
    id: row.id, name: row.name, type: row.type, state: row.state || "", summary: row.summary,
    dataConfidence: row.data_confidence, sectors: row.sectors || [], themes: row.themes || [],
    website: row.website || "", lastUpdated: row.last_updated ? row.last_updated.toISOString().slice(0, 10) : "",
    sourceNotes: row.source_notes || [], status: row.status, offices: offices,
  }, row.published_snapshot ? { publishedSnapshot: row.published_snapshot } : {}, row.extra || {});
}
function rowsToProject(row) {
  return Object.assign({
    id: row.id, name: row.name, type: "project_initiative", hostId: row.host_id || "", state: row.state || "",
    summary: row.summary, dataConfidence: row.data_confidence, themes: row.themes || [],
    lastUpdated: row.last_updated ? row.last_updated.toISOString().slice(0, 10) : "",
    evidenceSnippet: row.evidence_snippet || "", status: row.status,
  }, row.published_snapshot ? { publishedSnapshot: row.published_snapshot } : {});
}
function rowsToTheme(row) {
  return Object.assign({
    id: row.id, name: row.name, type: "research_theme", summary: row.summary, dataConfidence: row.data_confidence,
    lastUpdated: row.last_updated ? row.last_updated.toISOString().slice(0, 10) : "", status: row.status,
  }, row.published_snapshot ? { publishedSnapshot: row.published_snapshot } : {});
}
function rowsToRelationship(row) {
  return Object.assign({
    id: row.id, sourceId: row.source_id, targetId: row.target_id, type: row.type, confidence: row.confidence,
    intensity: row.intensity, evidence: row.evidence || "",
    lastUpdated: row.last_updated ? row.last_updated.toISOString().slice(0, 10) : "", status: row.status,
  }, row.published_snapshot ? { publishedSnapshot: row.published_snapshot } : {});
}

// Known/fixed columns per table; anything else on a record goes in `extra` for actors (the only
// node type with display-only cosmetic fields in the seed data).
const ACTOR_KNOWN = new Set(["id", "name", "type", "state", "summary", "dataConfidence", "sectors", "themes", "website", "lastUpdated", "sourceNotes", "status", "publishedSnapshot", "offices", "hostId"]);
function actorExtra(record) {
  const extra = {};
  Object.keys(record).forEach(k => { if (!ACTOR_KNOWN.has(k)) extra[k] = record[k]; });
  return extra;
}

async function loadState(pool) {
  const [actorsR, addressesR, projectsR, themesR, relsR, typesR, sourcesR, layoutR, auditR, batchesR, metaR] = await Promise.all([
    pool.query("SELECT * FROM actors ORDER BY id"),
    pool.query("SELECT * FROM addresses ORDER BY actor_id, position"),
    pool.query("SELECT * FROM projects ORDER BY id"),
    pool.query("SELECT * FROM themes ORDER BY id"),
    pool.query("SELECT * FROM relationships ORDER BY id"),
    pool.query("SELECT * FROM relationship_types ORDER BY id"),
    pool.query("SELECT * FROM sources ORDER BY id"),
    pool.query("SELECT * FROM layout_positions"),
    pool.query('SELECT * FROM audit_log ORDER BY "timestamp" DESC LIMIT 100'),
    pool.query("SELECT * FROM import_batches ORDER BY imported_at DESC LIMIT 200"),
    pool.query("SELECT version FROM schema_meta WHERE id = 1"),
  ]);
  const officesByActor = {};
  for (const o of addressesR.rows) (officesByActor[o.actor_id] = officesByActor[o.actor_id] || []).push({ role: o.role, state: o.state, city: o.city || "", focus: o.focus || "" });

  const batchIds = batchesR.rows.map(b => b.id);
  const rowsR = batchIds.length ? await pool.query("SELECT * FROM import_rows WHERE batch_id = ANY($1::uuid[]) ORDER BY source_row_number", [batchIds]) : { rows: [] };
  const rowsByBatch = {};
  for (const r of rowsR.rows) (rowsByBatch[r.batch_id] = rowsByBatch[r.batch_id] || []).push({ sourceRow: r.source_row_number, recordId: r.record_id, outcome: r.outcome, detail: r.detail });

  const state = {
    version: 4,
    actors: actorsR.rows.map(r => rowsToActor(r, officesByActor[r.id] || [])),
    projects: projectsR.rows.map(rowsToProject),
    themes: themesR.rows.map(rowsToTheme),
    relationships: relsR.rows.map(rowsToRelationship),
    relationshipTypes: typesR.rows.map(r => ({ id: r.id, displayName: r.display_name, color: r.color, isSystem: r.is_system })),
    sources: sourcesR.rows.map(r => ({ id: r.id, name: r.name, type: r.type, notes: r.notes })),
    layout: { nodes: Object.fromEntries(layoutR.rows.map(r => [r.node_id, { x: r.x, y: r.y }])) },
    audit: auditR.rows.map(r => ({ id: r.id, timestamp: r.timestamp.toISOString(), actor: r.actor, action: r.action, recordType: r.record_type, recordId: r.record_id, label: r.label, details: r.details })),
    importBatches: batchesR.rows.map(b => ({
      id: b.id, collection: b.collection, mode: b.mode, fingerprint: b.file_fingerprint,
      sourceFilename: b.source_filename, sheetName: b.sheet_name, importedBy: b.imported_by, importedAt: b.imported_at.toISOString(),
      rowCount: b.row_count, createdCount: b.created_count, updatedCount: b.updated_count, skippedCount: b.skipped_count,
      rows: rowsByBatch[b.id] || [],
    })),
    updatedAt: new Date().toISOString(),
  };
  const versions = {};
  for (const r of actorsR.rows) versions["actors:" + r.id] = r.version;
  for (const r of projectsR.rows) versions["projects:" + r.id] = r.version;
  for (const r of themesR.rows) versions["themes:" + r.id] = r.version;
  for (const r of relsR.rows) versions["relationships:" + r.id] = r.version;
  return { state, versions, schemaVersion: metaR.rows[0] ? metaR.rows[0].version : 0 };
}

// Writes exactly the rows that differ from `before` to `after`, inside one transaction.
// Optimistic concurrency: every UPDATE to an existing node/relationship row is conditioned on
// `version = $expectedVersion` (the version this request's in-memory `before` snapshot was built
// from). If another request updated the same row in between — bumping its version in the DB —
// the UPDATE's WHERE clause matches zero rows and we raise a 409 conflict instead of silently
// overwriting the concurrent edit. New rows (INSERT) cannot conflict this way by definition.
async function conditionalUpdate(client, sql, params, collection, id) {
  const result = await client.query(sql, params);
  if (result.rowCount === 0) {
    const err = new Error("This record was changed by someone else since you opened it. Reload and try again.");
    err.status = 409; err.code = "conflict"; err.collection = collection; err.id = id;
    throw err;
  }
}
async function writeDiff(client, before, after, versions) {
  const NODE_TABLES = { actors: "actors", projects: "projects", themes: "themes" };
  const byId = (list) => Object.fromEntries(list.map(r => [r.id, r]));

  for (const [key, table] of Object.entries(NODE_TABLES)) {
    const beforeById = byId(before[key]), afterById = byId(after[key]);
    for (const id of Object.keys(afterById)) {
      const prevRow = beforeById[id];
      const nextRow = afterById[id];
      if (prevRow && JSON.stringify(prevRow) === JSON.stringify(nextRow)) continue;
      await upsertNode(client, key, nextRow, prevRow ? versions[key + ":" + id] : undefined);
    }
    for (const id of Object.keys(beforeById)) {
      if (!afterById[id]) await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    }
  }

  // relationship_types must be written (new types inserted) BEFORE relationships, and deleted
  // (removed types) AFTER relationships — relationships.type is a foreign key into this table, so
  // a bulk import that creates a brand-new freeform type and a relationship using it in the same
  // commit would otherwise violate the FK constraint on insert.
  const beforeTypes = byId(before.relationshipTypes || []), afterTypes = byId(after.relationshipTypes || []);
  for (const id of Object.keys(afterTypes)) {
    const t = afterTypes[id];
    if (beforeTypes[id] && JSON.stringify(beforeTypes[id]) === JSON.stringify(t)) continue;
    await client.query(
      `INSERT INTO relationship_types (id, display_name, color, is_system) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET display_name=$2, color=$3`,
      [t.id, t.displayName, t.color || null, Boolean(t.isSystem)]
    );
  }

  const beforeRels = byId(before.relationships), afterRels = byId(after.relationships);
  for (const id of Object.keys(afterRels)) {
    const prevRow = beforeRels[id], nextRow = afterRels[id];
    if (prevRow && JSON.stringify(prevRow) === JSON.stringify(nextRow)) continue;
    if (!prevRow) {
      await client.query(
        `INSERT INTO relationships (id, source_id, target_id, type, confidence, intensity, evidence, last_updated, status, published_snapshot, version, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1, now())`,
        [nextRow.id, nextRow.sourceId, nextRow.targetId, nextRow.type, nextRow.confidence, nextRow.intensity, nextRow.evidence || "", nextRow.lastUpdated || null, nextRow.status, nextRow.publishedSnapshot || null]
      );
    } else {
      await conditionalUpdate(client,
        `UPDATE relationships SET source_id=$2, target_id=$3, type=$4, confidence=$5, intensity=$6, evidence=$7, last_updated=$8, status=$9, published_snapshot=$10, version=version+1, updated_at=now()
         WHERE id=$1 AND version=$11`,
        [nextRow.id, nextRow.sourceId, nextRow.targetId, nextRow.type, nextRow.confidence, nextRow.intensity, nextRow.evidence || "", nextRow.lastUpdated || null, nextRow.status, nextRow.publishedSnapshot || null, versions["relationships:" + id]],
        "relationships", id);
    }
  }
  for (const id of Object.keys(beforeRels)) {
    if (!afterRels[id]) await client.query("DELETE FROM relationships WHERE id = $1", [id]);
  }

  for (const id of Object.keys(beforeTypes)) {
    if (!afterTypes[id]) await client.query("DELETE FROM relationship_types WHERE id = $1", [id]);
  }

  const beforeSrc = byId(before.sources), afterSrc = byId(after.sources);
  for (const id of Object.keys(afterSrc)) {
    const s = afterSrc[id];
    if (beforeSrc[id] && JSON.stringify(beforeSrc[id]) === JSON.stringify(s)) continue;
    await client.query(
      `INSERT INTO sources (id, name, type, notes) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=$2, type=$3, notes=$4`,
      [s.id, s.name, s.type, s.notes || ""]
    );
  }
  for (const id of Object.keys(beforeSrc)) { if (!afterSrc[id]) await client.query("DELETE FROM sources WHERE id = $1", [id]); }

  const beforeLayout = before.layout.nodes, afterLayout = after.layout.nodes;
  for (const id of Object.keys(afterLayout)) {
    const p = afterLayout[id];
    if (beforeLayout[id] && beforeLayout[id].x === p.x && beforeLayout[id].y === p.y) continue;
    await client.query(`INSERT INTO layout_positions (node_id, x, y) VALUES ($1,$2,$3) ON CONFLICT (node_id) DO UPDATE SET x=$2, y=$3`, [id, p.x, p.y]);
  }
  for (const id of Object.keys(beforeLayout)) { if (!afterLayout[id]) await client.query("DELETE FROM layout_positions WHERE node_id = $1", [id]); }

  const newAuditEntries = after.audit.filter(a => !before.audit.some(b => b.id === a.id));
  for (const a of newAuditEntries) {
    await client.query(
      `INSERT INTO audit_log (id, "timestamp", actor, action, record_type, record_id, label, details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [a.id, a.timestamp, a.actor, a.action, a.recordType, a.recordId, a.label, a.details]
    );
  }

  const newBatches = (after.importBatches || []).filter(b => !(before.importBatches || []).some(bb => bb.id === b.id));
  for (const b of newBatches) {
    await client.query(
      `INSERT INTO import_batches (id, collection, source_filename, file_fingerprint, sheet_name, imported_by, imported_at, mode, row_count, created_count, updated_count, skipped_count, error_count, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'committed') ON CONFLICT (id) DO NOTHING`,
      [b.id, b.collection, b.sourceFilename || null, b.fingerprint || null, b.sheetName || null, b.importedBy, b.importedAt, b.mode, b.rowCount, b.createdCount, b.updatedCount, b.skippedCount, 0]
    );
    for (const r of b.rows || []) {
      await client.query(
        `INSERT INTO import_rows (batch_id, source_row_number, record_type, record_id, outcome, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
        [b.id, r.sourceRow, b.collection, r.recordId || null, r.outcome, r.detail || null]
      );
    }
  }
}

// `expectedVersion` is undefined for a brand-new record (INSERT; no conflict is possible) and
// the version this request's snapshot was read at for an existing one (conditional UPDATE).
async function upsertNode(client, key, record, expectedVersion) {
  if (key === "actors") {
    if (expectedVersion === undefined) {
      await client.query(
        `INSERT INTO actors (id, name, type, state, summary, data_confidence, sectors, themes, website, last_updated, source_notes, status, published_snapshot, extra, version, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1, now())`,
        [record.id, record.name, record.type, record.state || null, record.summary || "", record.dataConfidence, record.sectors || [], record.themes || [], record.website || null, record.lastUpdated || null, record.sourceNotes || [], record.status, record.publishedSnapshot || null, actorExtra(record)]
      );
    } else {
      await conditionalUpdate(client,
        `UPDATE actors SET name=$2, type=$3, state=$4, summary=$5, data_confidence=$6, sectors=$7, themes=$8, website=$9, last_updated=$10, source_notes=$11, status=$12, published_snapshot=$13, extra=$14, version=version+1, updated_at=now()
         WHERE id=$1 AND version=$15`,
        [record.id, record.name, record.type, record.state || null, record.summary || "", record.dataConfidence, record.sectors || [], record.themes || [], record.website || null, record.lastUpdated || null, record.sourceNotes || [], record.status, record.publishedSnapshot || null, actorExtra(record), expectedVersion],
        "actors", record.id);
    }
    await client.query("DELETE FROM addresses WHERE actor_id = $1", [record.id]);
    const offices = record.offices || [];
    for (let i = 0; i < offices.length; i++) {
      const o = offices[i];
      await client.query("INSERT INTO addresses (actor_id, role, state, city, focus, position) VALUES ($1,$2,$3,$4,$5,$6)", [record.id, o.role, o.state, o.city || null, o.focus || null, i]);
    }
  } else if (key === "projects") {
    if (expectedVersion === undefined) {
      await client.query(
        `INSERT INTO projects (id, name, host_id, state, summary, data_confidence, themes, last_updated, evidence_snippet, status, published_snapshot, version, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1, now())`,
        [record.id, record.name, record.hostId || null, record.state || null, record.summary || "", record.dataConfidence, record.themes || [], record.lastUpdated || null, record.evidenceSnippet || null, record.status, record.publishedSnapshot || null]
      );
    } else {
      await conditionalUpdate(client,
        `UPDATE projects SET name=$2, host_id=$3, state=$4, summary=$5, data_confidence=$6, themes=$7, last_updated=$8, evidence_snippet=$9, status=$10, published_snapshot=$11, version=version+1, updated_at=now()
         WHERE id=$1 AND version=$12`,
        [record.id, record.name, record.hostId || null, record.state || null, record.summary || "", record.dataConfidence, record.themes || [], record.lastUpdated || null, record.evidenceSnippet || null, record.status, record.publishedSnapshot || null, expectedVersion],
        "projects", record.id);
    }
  } else if (key === "themes") {
    if (expectedVersion === undefined) {
      await client.query(
        `INSERT INTO themes (id, name, summary, data_confidence, last_updated, status, published_snapshot, version, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,1, now())`,
        [record.id, record.name, record.summary || "", record.dataConfidence, record.lastUpdated || null, record.status, record.publishedSnapshot || null]
      );
    } else {
      await conditionalUpdate(client,
        `UPDATE themes SET name=$2, summary=$3, data_confidence=$4, last_updated=$5, status=$6, published_snapshot=$7, version=version+1, updated_at=now()
         WHERE id=$1 AND version=$8`,
        [record.id, record.name, record.summary || "", record.dataConfidence, record.lastUpdated || null, record.status, record.publishedSnapshot || null, expectedVersion],
        "themes", record.id);
    }
  }
}

// Imports the current single-JSON-file dataset into empty Postgres tables. Call once, with the
// JSON file backed up beforehand by the caller (see backend/db/migrate-from-json.js).
async function importFromJson(pool, jsonState) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const empty = { actors: [], projects: [], themes: [], relationships: [], relationshipTypes: [], sources: [], layout: { nodes: {} }, audit: [], importBatches: [] };
    await writeDiff(client, empty, jsonState, {});
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function createPgDataStore(pool) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "..", "data.js"), "utf8"), context);
  const core = createCore(context.window.RD_DATA);
  let cached = null; // { state, versions } — refreshed on every read/write to stay current for multi-process safety is out of scope for one Node instance; see docs/DEPLOYMENT.md for the single-writer requirement.

  async function ensureLoaded() {
    if (!cached) cached = await loadState(pool);
    return cached;
  }

  return {
    async snapshot() { return JSON.parse(JSON.stringify((await ensureLoaded()).state)); },
    async publicData() { return core.publicData((await ensureLoaded()).state); },
    migration: () => null, // Postgres schema migrations are handled by backend/db/migrate.js, not this runtime path.
    async apply(operation, value, recordId, username) {
      const before = await ensureLoaded();
      const next = core.apply(before.state, operation, value, recordId, username);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await writeDiff(client, before.state, next, before.versions);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        // A conflict (or any other failure) may mean our cached snapshot is stale; drop it so
        // the next read (including the caller's own retry) sees the current committed state
        // instead of repeating the same doomed comparison.
        cached = null;
        throw error;
      } finally {
        client.release();
      }
      cached = await loadState(pool);
      return JSON.parse(JSON.stringify(cached.state));
    },
    // Applies several core operations in sequence against one in-memory state (each seeing the
    // previous operation's effect, e.g. a relationship referencing an org the same batch just
    // created), then writes the FINAL diff in a single transaction. Used where a caller needs
    // several logically-dependent core.apply steps to either all land or none — e.g. the real-data
    // importer's organisations -> projects -> relationships phases — without leaving a partially
    // imported state if a later phase fails validation.
    async applyBatch(operations) {
      const before = await ensureLoaded();
      let state = before.state;
      for (const op of operations) state = core.apply(state, op.operation, op.value, op.recordId, op.username);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await writeDiff(client, before.state, state, before.versions);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        cached = null;
        throw error;
      } finally {
        client.release();
      }
      cached = await loadState(pool);
      return JSON.parse(JSON.stringify(cached.state));
    },
  };
}

module.exports = { createPgDataStore, importFromJson, loadState };
