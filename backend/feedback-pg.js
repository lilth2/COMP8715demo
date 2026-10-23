"use strict";
// Feedback tracker (bug/suggestion) backed by Postgres. Available only in multi-account mode
// (DATABASE_URL set) since feedback needs a real account to attribute submissions to and a real
// database to survive a restart — there is no browser-demo-mode equivalent.
//
// Visibility rule (server-side, not a UI hide): accounts with role "admin" or "stakeholder" see
// every feedback item in their environment (the brief's "UAT super-admin can see all UAT
// feedback"); any other role would see only its own submissions ("ordinary test role can only
// access its own feedback"). Only two roles exist today (both full-visibility), but the check is
// written to the rule, not to "there are only two roles", so a future narrower role needs no
// change here.
const crypto = require("node:crypto");

const STATUSES = ["New", "Investigating", "Fixed", "Ready for retest", "Closed"];
const FULL_VISIBILITY_ROLES = new Set(["admin", "stakeholder"]);

function canSeeAll(role) { return FULL_VISIBILITY_ROLES.has(role); }

function assertKind(kind) { if (kind !== "bug" && kind !== "suggestion") throw Object.assign(new Error("kind must be \"bug\" or \"suggestion\"."), { status: 400 }); }
function assertTitle(title) {
  if (typeof title !== "string" || !title.trim() || title.length > 200) throw Object.assign(new Error("Title is required (max 200 characters)."), { status: 400 });
}
function assertText(value, field, { required = false, max = 10000 } = {}) {
  if (value === undefined || value === null) { if (required) throw Object.assign(new Error(field + " is required."), { status: 400 }); return; }
  if (typeof value !== "string" || value.length > max) throw Object.assign(new Error("Invalid " + field + "."), { status: 400 });
}

function toPublic(row) {
  return {
    id: row.id, feedbackNumber: row.feedback_number, kind: row.kind, title: row.title, description: row.description,
    reproSteps: row.repro_steps, expectedResult: row.expected_result, actualResult: row.actual_result,
    relatedPage: row.related_page, relatedRecordId: row.related_record_id,
    hasScreenshot: Boolean(row.screenshot_path),
    submittedBy: row.submitted_by, submittedByUsername: row.submitted_by_username, submittedAt: row.submitted_at,
    appVersion: row.app_version, currentPage: row.current_page, requestId: row.request_id,
    status: row.status, statusUpdatedAt: row.status_updated_at, statusUpdatedBy: row.status_updated_by,
  };
}

function createFeedbackStore(pool) {
  return {
    STATUSES,
    // `screenshotPath` is a server-assigned relative path under the private attachments
    // directory (see server.js) — never a client-supplied path, so a submitter cannot read an
    // arbitrary file off disk by claiming it as their "screenshot".
    async create({ kind, title, description, reproSteps, expectedResult, actualResult, relatedPage, relatedRecordId, screenshotPath, submittedBy, appVersion, currentPage, requestId, idempotencyKey }) {
      assertKind(kind); assertTitle(title); assertText(description, "description", { required: true });
      assertText(reproSteps, "repro steps"); assertText(expectedResult, "expected result"); assertText(actualResult, "actual result");
      assertText(relatedPage, "related page", { max: 500 }); assertText(relatedRecordId, "related record id", { max: 200 });
      if (!submittedBy) throw Object.assign(new Error("submittedBy is required."), { status: 400 });

      // Idempotent double-submit: the same account resubmitting the same idempotency key (set by
      // the client once per form session, e.g. on first keystroke) returns the existing row
      // instead of creating a duplicate, whether this is a genuine double-click or a retried
      // request after a dropped response.
      if (idempotencyKey) {
        const existing = await pool.query("SELECT * FROM feedback WHERE submitted_by = $1 AND idempotency_key = $2", [submittedBy, idempotencyKey]);
        if (existing.rows[0]) return toPublic(existing.rows[0]);
      }
      const r = await pool.query(
        `INSERT INTO feedback (kind, title, description, repro_steps, expected_result, actual_result, related_page, related_record_id, screenshot_path, submitted_by, app_version, current_page, request_id, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [kind, title.trim(), description, reproSteps || null, expectedResult || null, actualResult || null, relatedPage || null, relatedRecordId || null, screenshotPath || null, submittedBy, appVersion || null, currentPage || null, requestId || null, idempotencyKey || null]
      );
      const row = r.rows[0];
      await pool.query("INSERT INTO feedback_status_history (feedback_id, status, changed_by) VALUES ($1,$2,$3)", [row.id, "New", submittedBy]);
      return toPublic(row);
    },
    // `account` = { id, role }. Returns only what that account is allowed to see.
    async list(account, { status, kind } = {}) {
      const conditions = [];
      const params = [];
      if (!canSeeAll(account.role)) { params.push(account.id); conditions.push("f.submitted_by = $" + params.length); }
      if (status) { params.push(status); conditions.push("f.status = $" + params.length); }
      if (kind) { params.push(kind); conditions.push("f.kind = $" + params.length); }
      const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
      const r = await pool.query(
        `SELECT f.*, a.username AS submitted_by_username FROM feedback f JOIN accounts a ON a.id = f.submitted_by ${where} ORDER BY f.submitted_at DESC`,
        params
      );
      return r.rows.map(toPublic);
    },
    async get(account, id) {
      const r = await pool.query("SELECT f.*, a.username AS submitted_by_username FROM feedback f JOIN accounts a ON a.id = f.submitted_by WHERE f.id = $1", [id]);
      const row = r.rows[0];
      if (!row) return null;
      if (!canSeeAll(account.role) && row.submitted_by !== account.id) throw Object.assign(new Error("You can only view your own feedback."), { status: 403 });
      return toPublic(row);
    },
    // Internal use only (serving the actual attachment bytes after the visibility check) — never
    // returned to a client as JSON, unlike get()/list(), which only expose hasScreenshot.
    async getScreenshotPath(account, id) {
      const r = await pool.query("SELECT submitted_by, screenshot_path FROM feedback WHERE id = $1", [id]);
      const row = r.rows[0];
      if (!row || !row.screenshot_path) return null;
      if (!canSeeAll(account.role) && row.submitted_by !== account.id) throw Object.assign(new Error("You can only view your own feedback."), { status: 403 });
      return row.screenshot_path;
    },
    // Only an account with full visibility (admin/stakeholder) may triage — a submitter cannot
    // close or re-route their own report, matching "普通测试角色只能访问自己的反馈" (view only).
    async setStatus(account, id, status, note) {
      if (!canSeeAll(account.role)) throw Object.assign(new Error("Only an administrator or the UAT stakeholder account can change feedback status."), { status: 403 });
      if (STATUSES.indexOf(status) === -1) throw Object.assign(new Error("Invalid status."), { status: 400 });
      const r = await pool.query("UPDATE feedback SET status = $2, status_updated_at = now(), status_updated_by = $3 WHERE id = $1 RETURNING *", [id, status, account.username || account.id]);
      if (!r.rows[0]) throw Object.assign(new Error("Feedback not found."), { status: 404 });
      await pool.query("INSERT INTO feedback_status_history (feedback_id, status, note, changed_by) VALUES ($1,$2,$3,$4)", [id, status, note || null, account.username || account.id]);
      return toPublic(r.rows[0]);
    },
    async history(account, id) {
      const item = await this.get(account, id); // enforces the same visibility rule
      if (!item) return null;
      const r = await pool.query("SELECT status, note, changed_by, changed_at FROM feedback_status_history WHERE feedback_id = $1 ORDER BY changed_at", [id]);
      return r.rows;
    },
    // CSV export for admin/stakeholder triage — full visibility accounts only.
    async exportCsv(account) {
      if (!canSeeAll(account.role)) throw Object.assign(new Error("Only an administrator or the UAT stakeholder account can export feedback."), { status: 403 });
      const items = await this.list(account);
      const esc = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      const header = ["Number", "Kind", "Title", "Status", "Submitted by", "Submitted at", "Related page", "Related record", "Description"];
      const rows = items.map(i => [i.feedbackNumber, i.kind, i.title, i.status, i.submittedByUsername || i.submittedBy, i.submittedAt, i.relatedPage || "", i.relatedRecordId || "", i.description]);
      return [header, ...rows].map(row => row.map(esc).join(",")).join("\r\n");
    },
  };
}

function makeIdempotencyKey() { return crypto.randomUUID(); }

module.exports = { createFeedbackStore, makeIdempotencyKey, STATUSES };
