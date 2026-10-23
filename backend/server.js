"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomBytes, scrypt, timingSafeEqual, createHash } = require("node:crypto");
const { promisify } = require("node:util");
const deriveKey = promisify(scrypt);
const { createDataStore } = require("./server-data");
const { openUpload, rowsFromMapping } = require("./import/plan-from-file");
const { makeIdempotencyKey } = require("./feedback-pg");
const ROOT = path.resolve(__dirname, "..");
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const ALLOWED_SCREENSHOT_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const SESSION_TTL = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const COOKIE = "rd_admin_session";
const PUBLIC_FILES = new Set(["index.html", "app.js", "data.js", "admin/store.js", "admin/dataset-core.js", "ai-engine.js", "admin/login.html", "admin/login.js", "admin/auth.js", "admin/demo-store.js", "site-config.js"]);
const ADMIN_FILES = new Set(["admin/index.html", "admin/console.js", "admin/network-editor.js", "admin/bulk-import.js", "admin/accounts.js", "admin/feedback.js", "admin/bulk-actions.js"]);

// --------------------------------------------------------------------- bulk import helpers
// Request shape for all three /api/admin/import/* endpoints:
//   { collection, mode, rows }                                            — direct rows (bulk form / paste-matrix)
//   { collection, mode, filename, contentBase64, sheetName, headerRow, fieldMapping } — file upload
// `inspect` only needs {filename, contentBase64} and returns the sheet list + header row guess,
// so the admin UI can let the operator choose a sheet and map columns before previewing.
function decodedFile(value) {
  if (!value || typeof value.filename !== "string" || typeof value.contentBase64 !== "string") {
    throw Object.assign(new Error("A file is required."), { status: 400 });
  }
  let buf;
  try { buf = Buffer.from(value.contentBase64, "base64"); } catch { throw Object.assign(new Error("Invalid file encoding."), { status: 400 }); }
  return { filename: value.filename, buf };
}
function inspectUpload(value) {
  const { filename, buf } = decodedFile(value);
  const upload = openUpload(buf, filename);
  const firstSheet = upload.sheets[0];
  const parsed = firstSheet ? upload.readSheet(firstSheet, 1) : { headers: {}, rows: [] };
  return { kind: upload.kind, sheets: upload.sheets, suggestedHeaderRow: 1, headers: parsed.headers, sampleRows: parsed.rows.slice(0, 5), anyFormulas: Boolean(parsed.anyFormulas) };
}
function rowsForImport(value) {
  if (Array.isArray(value.rows)) return value.rows; // direct bulk-form / paste-matrix submission
  const { filename, buf } = decodedFile(value);
  const upload = openUpload(buf, filename);
  const sheetName = value.sheetName || upload.sheets[0];
  const parsed = upload.readSheet(sheetName, value.headerRow || 1);
  if (!value.fieldMapping || typeof value.fieldMapping !== "object") throw Object.assign(new Error("A field mapping is required for a file import."), { status: 400 });
  return rowsFromMapping(parsed, value.fieldMapping);
}
// Ties a commit to the exact file bytes + sheet + mode, so re-uploading the identical file is
// recognisable. Direct row submissions (no file) are not fingerprinted — there is nothing stable
// to hash, and the per-row duplicate-ID checks in planBulkUpsert already prevent re-creating the
// same record.
function fingerprintOf(value) {
  if (!value || !value.contentBase64) return null;
  const hash = createHash("sha256").update(value.contentBase64).update("|" + (value.sheetName || "")).update("|" + (value.mode || "")).digest("hex");
  return hash;
}
function findPriorImport(snapshot, fingerprint) {
  if (!fingerprint) return null;
  const match = (snapshot.importBatches || []).find(b => b.fingerprint === fingerprint);
  return match ? { importedAt: match.importedAt, importedBy: match.importedBy, createdCount: match.createdCount, updatedCount: match.updatedCount } : null;
}

function createApp({ account, secureCookies = false, publicOrigin, allowedOrigins = [], dataPath, store: injectedStore, accountsStore, sessionsStore, environment = "production", feedbackStore, attachmentsDir } = {}) {
  // Two mutually-exclusive auth modes:
  //  - Legacy single-admin (accountsStore not given): one hardcoded account, in-memory sessions
  //    Map, exactly as before — unchanged behaviour for the existing JSON-file deployment story.
  //  - Multi-account (accountsStore + sessionsStore given, Postgres-backed): real accounts with
  //    roles (admin/stakeholder), server-side disable/expiry/session-revocation, and the account
  //    management endpoints below. Used whenever DATABASE_URL is set (see bottom of this file).
  const multiAccount = Boolean(accountsStore && sessionsStore);
  if (!multiAccount && (!account || !account.username || !/^[a-f0-9]{128}$/.test(account.passwordHash || "") || !/^[a-f0-9]{64}$/.test(account.salt || ""))) {
    throw new Error("A valid initial admin account is required. Run npm run setup:admin first.");
  }
  const sessions = new Map(); // legacy mode only
  const attempts = new Map();
  // Postgres-backed storage (backend/db/pg-store.js) is injected via `store` when DATABASE_URL
  // is set (see the bottom of this file); otherwise the original single-JSON-file store is used.
  // Both expose the same snapshot()/publicData()/apply()/migration() shape; this file awaits
  // every call so it works identically whether the method is sync (JSON store) or async (Postgres).
  const store = injectedStore || createDataStore(dataPath);
  // Read-only planning core for import previews (dataset-core.js's planBulkUpsert never mutates
  // its input), built once rather than per-request. The actual commit always goes through
  // store.apply("bulkUpsert", ...), which re-plans server-side against the live state — this core
  // is only ever used for the non-committing preview, so a stale preview can never diverge from
  // what commit actually does (commit re-validates from scratch).
  const previewCore = (() => {
    const { createCore } = require("../admin/dataset-core");
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, "data.js"), "utf8"), context);
    return createCore(context.window.RD_DATA);
  })();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of sessions) if (value.expires <= now) sessions.delete(key);
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    if (multiAccount) sessionsStore.cleanupExpired().catch(() => {});
  }, 60000);
  cleanup.unref();

  function tokenFromRequest(req) {
    if (req.headers.authorization) return req.headers.authorization.replace(/^Bearer /, "");
    const entry = (req.headers.cookie || "").split(";").map(value => value.trim()).find(value => value.startsWith(COOKIE + "="));
    return entry ? entry.slice(COOKIE.length + 1) : "";
  }
  async function session(req) {
    const token = tokenFromRequest(req);
    if (!token) return null;
    if (multiAccount) {
      const current = await sessionsStore.get(token);
      return current ? { token, ...current } : null;
    }
    const current = sessions.get(token);
    if (!current || current.expires <= Date.now()) { sessions.delete(token); return null; }
    return { token, ...current };
  }
  function cookie(token, maxAge) {
    return COOKIE + "=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + maxAge + (secureCookies ? "; Secure" : "");
  }
  function json(res, status, payload, headers = {}) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
    res.end(JSON.stringify(payload));
  }
  function redirect(res, destination) {
    res.writeHead(303, { Location: destination });
    res.end();
  }
  const IMPORT_PATHS = new Set(["/api/admin/import/inspect", "/api/admin/import/preview", "/api/admin/import/commit"]);
  function bodyLimitFor(pathname) {
    if (pathname === "/api/admin/action") return 2 * 1024 * 1024;
    if (IMPORT_PATHS.has(pathname)) return 21 * 1024 * 1024; // base64 of a 15MB file is ~20MB
    if (pathname === "/api/feedback") return 7 * 1024 * 1024; // base64 of a 5MB screenshot is ~6.7MB
    return 8192;
  }
  async function body(req) {
    let input = "";
    const limit = bodyLimitFor(req.url.split("?")[0]);
    for await (const chunk of req) {
      input += chunk;
      if (Buffer.byteLength(input) > limit) throw Object.assign(new Error("Request too large."), { status: 413 });
    }
    try { return JSON.parse(input); }
    catch { throw Object.assign(new Error("Invalid JSON."), { status: 400 }); }
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    const url = new URL(req.url, "http://localhost");
    const current = await session(req);
    try {
      const allowedOrigin = publicOrigin || (secureCookies ? "https://" : "http://") + req.headers.host;
      const originAllowed = req.headers.origin === allowedOrigin || allowedOrigins.includes(req.headers.origin);
      if (originAllowed) {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
        res.setHeader("Vary", "Origin");
      }
      if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
        if (!originAllowed) return json(res, 403, { message: "Origin is not permitted." });
        res.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" });
        return res.end();
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        if (!originAllowed) {
          return json(res, 403, { message: "Please sign in from this website." });
        }
        if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) return json(res, 415, { message: "JSON is required." });
      }
      if (url.pathname === "/api/session" && req.method === "GET") {
        return json(res, 200, current ? { authenticated: true, username: current.username, role: current.role || "admin", environment: current.environment || environment, expiresAt: current.expires } : { authenticated: false });
      }
      if (url.pathname === "/api/login" && req.method === "POST") {
        const client = req.socket.remoteAddress;
        let limit = attempts.get(client);
        if (!limit || limit.until <= Date.now()) { limit = { count: 0, until: Date.now() + LOGIN_WINDOW }; attempts.set(client, limit); }
        if (limit.count >= 10) return json(res, 429, { message: "Too many attempts. Please try again in 15 minutes." }, { "Retry-After": String(Math.ceil((limit.until - Date.now()) / 1000)) });
        limit.count++;
        const value = await body(req);
        if (!value || typeof value.username !== "string" || typeof value.password !== "string" || value.password.length > 1024) return json(res, 400, { message: "Enter your administrator username and password." });
        if (multiAccount) {
          const authenticated = await accountsStore.authenticate(value.username, value.password);
          if (!authenticated) return json(res, 401, { message: "Incorrect username or password, or this account is disabled or expired." });
          attempts.delete(client);
          if (current) await sessionsStore.revoke(current.token);
          const { token, expiresAt } = await sessionsStore.create(authenticated.id, client);
          return json(res, 200, { authenticated: true, token, username: authenticated.username, role: authenticated.role, environment: authenticated.environment, expiresAt }, { "Set-Cookie": cookie(token, SESSION_TTL / 1000) });
        }
        const key = await deriveKey(value.password, account.salt, 64);
        if (!timingSafeEqual(key, Buffer.from(account.passwordHash, "hex")) || value.username !== account.username) {
          return json(res, 401, { message: "Incorrect username or password." });
        }
        attempts.delete(client);
        if (current) sessions.delete(current.token);
        const token = randomBytes(32).toString("hex");
        sessions.set(token, { username: account.username, expires: Date.now() + SESSION_TTL });
        return json(res, 200, { authenticated: true, token, expiresAt: Date.now() + SESSION_TTL }, { "Set-Cookie": cookie(token, SESSION_TTL / 1000) });
      }
      if (url.pathname === "/api/logout" && req.method === "POST") {
        if (current) { if (multiAccount) await sessionsStore.revoke(current.token); else sessions.delete(current.token); }
        return json(res, 200, { authenticated: false }, { "Set-Cookie": cookie("", 0) });
      }
      if (url.pathname === "/api/dataset" && req.method === "GET") {
        var publicData = await store.publicData();
        publicData.environment = environment; // non-sensitive; lets the public page show a UAT banner
        return json(res, 200, publicData);
      }
      if (url.pathname === "/api/admin/dataset" && req.method === "GET") {
        if (!current) return json(res, 401, { message: "Administrator login required." });
        return json(res, 200, await store.snapshot());
      }
      if (url.pathname === "/api/admin/action" && req.method === "POST") {
        if (!current) return json(res, 401, { message: "Administrator login required." });
        const value = await body(req);
        if (!value || typeof value.operation !== "string") return json(res, 400, { message: "Invalid administrator action." });
        return json(res, 200, await store.apply(value.operation, value.value, value.id, current.username));
      }
      if (url.pathname === "/api/admin/import/inspect" && req.method === "POST") {
        if (!current) return json(res, 401, { message: "Administrator login required." });
        return json(res, 200, inspectUpload(await body(req)));
      }
      if (url.pathname === "/api/admin/import/preview" && req.method === "POST") {
        if (!current) return json(res, 401, { message: "Administrator login required." });
        const value = await body(req);
        const rows = rowsForImport(value);
        const snapshot = await store.snapshot();
        const plan = previewCore.planBulkUpsert(snapshot, value.collection, value.mode, rows);
        const fingerprint = fingerprintOf(value);
        return json(res, 200, { plan, fingerprint, previouslyImported: findPriorImport(snapshot, fingerprint) });
      }
      if (url.pathname === "/api/admin/import/commit" && req.method === "POST") {
        if (!current) return json(res, 401, { message: "Administrator login required." });
        const value = await body(req);
        const rows = rowsForImport(value);
        const result = await store.apply("bulkUpsert", { collection: value.collection, mode: value.mode, rows: rows, fingerprint: fingerprintOf(value), sourceFilename: value.filename || null, sheetName: value.sheetName || null }, undefined, current.username);
        return json(res, 200, result);
      }
      // ------------------------------------------------------------- account management (multi-account mode only)
      // Any authenticated account in this environment (admin OR stakeholder) may manage other
      // accounts IN THIS SAME ENVIRONMENT — per the brief, the UAT stakeholder has the same
      // capability as the environment's own admin, not a cut-down permission set. There is no
      // cross-environment reach: accountsStore is constructed once per server process against one
      // specific `environment` value (see the bottom of this file), so a UAT server process can
      // only ever see/create/disable UAT accounts, never production ones, regardless of role.
      if (url.pathname === "/api/admin/accounts" && req.method === "GET") {
        if (!multiAccount) return json(res, 404, { message: "Account management requires Postgres (DATABASE_URL)." });
        if (!current) return json(res, 401, { message: "Login required." });
        return json(res, 200, await accountsStore.list());
      }
      if (url.pathname === "/api/admin/accounts" && req.method === "POST") {
        if (!multiAccount) return json(res, 404, { message: "Account management requires Postgres (DATABASE_URL)." });
        if (!current) return json(res, 401, { message: "Login required." });
        const value = await body(req);
        const created = await accountsStore.create({ username: value.username, password: value.password, role: value.role, displayName: value.displayName, createdBy: current.username, expiresAt: value.expiresAt });
        await accountsStore.audit({ actor: current.username, action: "Created account", targetAccountId: created.id, targetUsername: created.username });
        return json(res, 200, created);
      }
      const accountActionMatch = url.pathname.match(/^\/api\/admin\/accounts\/([^/]+)\/(disable|enable|set-password)$/);
      if (accountActionMatch && req.method === "POST") {
        if (!multiAccount) return json(res, 404, { message: "Account management requires Postgres (DATABASE_URL)." });
        if (!current) return json(res, 401, { message: "Login required." });
        const [, accountId, action] = accountActionMatch;
        if (action === "disable") {
          await accountsStore.disable(accountId);
          await sessionsStore.revokeAllForAccount(accountId); // a disabled account's existing sessions must stop working immediately
          const target = await accountsStore.get(accountId);
          await accountsStore.audit({ actor: current.username, action: "Disabled account", targetAccountId: accountId, targetUsername: target && target.username });
          return json(res, 200, target);
        }
        if (action === "enable") {
          await accountsStore.enable(accountId);
          const target = await accountsStore.get(accountId);
          await accountsStore.audit({ actor: current.username, action: "Enabled account", targetAccountId: accountId, targetUsername: target && target.username });
          return json(res, 200, target);
        }
        if (action === "set-password") {
          const value = await body(req);
          await accountsStore.setPassword(accountId, value.password);
          await sessionsStore.revokeAllForAccount(accountId); // force re-login with the new password everywhere
          const target = await accountsStore.get(accountId);
          await accountsStore.audit({ actor: current.username, action: "Changed password", targetAccountId: accountId, targetUsername: target && target.username });
          return json(res, 200, target);
        }
      }
      // --------------------------------------------------------------------- feedback (multi-account mode only)
      // "Report an issue / Suggest an improvement" — any authenticated account (admin or
      // stakeholder) may submit; visibility and triage rights are enforced inside feedbackStore
      // itself (an ordinary submitter only ever sees their own, admin/stakeholder see everything
      // in this environment), never by a client-side check.
      if (url.pathname === "/api/feedback" && req.method === "GET") {
        if (!feedbackStore) return json(res, 404, { message: "Feedback requires Postgres (DATABASE_URL)." });
        if (!current) return json(res, 401, { message: "Login required." });
        const items = await feedbackStore.list({ id: current.accountId, role: current.role }, { status: url.searchParams.get("status") || undefined, kind: url.searchParams.get("kind") || undefined });
        return json(res, 200, items);
      }
      if (url.pathname === "/api/feedback" && req.method === "POST") {
        if (!feedbackStore) return json(res, 404, { message: "Feedback requires Postgres (DATABASE_URL)." });
        if (!current) return json(res, 401, { message: "Login required." });
        const value = await body(req);
        let screenshotPath = null;
        if (value.screenshotBase64) {
          const mime = value.screenshotMimeType;
          if (!ALLOWED_SCREENSHOT_TYPES[mime]) return json(res, 415, { message: "Screenshot must be PNG, JPEG or WebP." });
          let buf;
          try { buf = Buffer.from(value.screenshotBase64, "base64"); } catch { return json(res, 400, { message: "Invalid screenshot encoding." }); }
          if (buf.length > MAX_SCREENSHOT_BYTES) return json(res, 413, { message: "Screenshot is too large (max 5 MB)." });
          const filename = randomBytes(16).toString("hex") + "." + ALLOWED_SCREENSHOT_TYPES[mime];
          fs.mkdirSync(attachmentsDir, { recursive: true, mode: 0o700 });
          fs.writeFileSync(path.join(attachmentsDir, filename), buf, { mode: 0o600 });
          screenshotPath = filename;
        }
        const created = await feedbackStore.create({
          kind: value.kind, title: value.title, description: value.description, reproSteps: value.reproSteps,
          expectedResult: value.expectedResult, actualResult: value.actualResult, relatedPage: value.relatedPage,
          relatedRecordId: value.relatedRecordId, screenshotPath, submittedBy: current.accountId,
          appVersion: value.appVersion, currentPage: value.currentPage, requestId: value.requestId, idempotencyKey: value.idempotencyKey,
        });
        return json(res, 200, created);
      }
      const feedbackStatusMatch = url.pathname.match(/^\/api\/feedback\/([^/]+)\/status$/);
      if (feedbackStatusMatch && req.method === "POST") {
        if (!feedbackStore) return json(res, 404, { message: "Feedback requires Postgres (DATABASE_URL)." });
        if (!current) return json(res, 401, { message: "Login required." });
        const value = await body(req);
        const updated = await feedbackStore.setStatus({ id: current.accountId, role: current.role, username: current.username }, feedbackStatusMatch[1], value.status, value.note);
        return json(res, 200, updated);
      }
      const feedbackHistoryMatch = url.pathname.match(/^\/api\/feedback\/([^/]+)\/history$/);
      if (feedbackHistoryMatch && req.method === "GET") {
        if (!feedbackStore) return json(res, 404, { message: "Feedback requires Postgres (DATABASE_URL)." });
        if (!current) return json(res, 401, { message: "Login required." });
        const history = await feedbackStore.history({ id: current.accountId, role: current.role }, feedbackHistoryMatch[1]);
        if (!history) return json(res, 404, { message: "Feedback not found." });
        return json(res, 200, history);
      }
      const feedbackScreenshotMatch = url.pathname.match(/^\/api\/feedback\/([^/]+)\/screenshot$/);
      if (feedbackScreenshotMatch && req.method === "GET") {
        if (!feedbackStore) return json(res, 404, { message: "Feedback requires Postgres (DATABASE_URL)." });
        if (!current) return json(res, 401, { message: "Login required." });
        // getScreenshotPath() enforces the same ownership/role visibility rule as get()/list();
        // the file itself lives under attachmentsDir, never under a statically-served directory.
        const filename = await feedbackStore.getScreenshotPath({ id: current.accountId, role: current.role }, feedbackScreenshotMatch[1]);
        if (!filename) return json(res, 404, { message: "No screenshot for this feedback item." });
        const ext = path.extname(filename).slice(1);
        const contentType = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": contentType });
        return res.end(await fs.promises.readFile(path.join(attachmentsDir, filename)));
      }
      if (url.pathname === "/api/feedback/export.csv" && req.method === "GET") {
        if (!feedbackStore) return json(res, 404, { message: "Feedback requires Postgres (DATABASE_URL)." });
        if (!current) return json(res, 401, { message: "Login required." });
        const csv = await feedbackStore.exportCsv({ id: current.accountId, role: current.role });
        res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"feedback-export.csv\"" });
        return res.end(csv);
      }
      if (url.pathname.startsWith("/api/")) return json(res, 404, { message: "Not found." });
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { message: "Method not allowed." });
      if (url.pathname === "/admin-login.html") return redirect(res, "/admin/login.html");
      if (url.pathname === "/admin.html" || url.pathname === "/admin" || url.pathname === "/admin/") return redirect(res, "/admin/index.html");
      let file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (ADMIN_FILES.has(file) && !current) {
        if (file === "admin/index.html") return redirect(res, "/admin/login.html");
        return json(res, 401, { message: "Administrator login required." });
      }
      if (file === "admin/login.html" && current) return redirect(res, "/admin/index.html");
      if (!PUBLIC_FILES.has(file) && !ADMIN_FILES.has(file)) return json(res, 404, { message: "Not found." });
      res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
      res.end(req.method === "HEAD" ? undefined : await fs.promises.readFile(path.join(ROOT, file)));
    } catch (error) {
      if (!error.status) return json(res, 500, { message: "Unable to complete the request." });
      // Pass through the structured extras some core errors carry (describePublish's `blockers`,
      // deleteRelationshipType's `typeId`, bulkUpsert's `plan`) so the admin UI's error handling
      // — which already reads error.blockers etc. — gets real data in backend mode, not just in
      // the browser demo store where the same Error object is thrown and caught locally.
      const payload = { message: error.message };
      ["code", "blockers", "plan", "typeId", "collection", "id"].forEach(key => { if (error[key] !== undefined) payload[key] = error[key]; });
      json(res, error.status, payload);
    }
  });
  server.on("close", () => clearInterval(cleanup));
  return server;
}

if (require.main === module) {
  const usingDatabase = Boolean(process.env.DATABASE_URL);
  const accountPath = path.join(__dirname, ".private", "admin-account.json");
  // The legacy single-hardcoded-admin requirement only applies when there is no database to hold
  // real multi-account rows — with DATABASE_URL set, accounts are created via
  // backend/accounts-bootstrap.js (npm run setup:uat-admin) into the `accounts` table instead.
  if (!usingDatabase && !process.env.ADMIN_PASSWORD && !fs.existsSync(accountPath)) {
    console.error("Initial administrator missing. Run npm run setup:admin before npm start.");
    process.exit(1);
  }
  const secureCookies = process.env.NODE_ENV === "production";
  const publicOrigin = process.env.PUBLIC_ORIGIN;
  if (secureCookies && !publicOrigin) throw new Error("Set PUBLIC_ORIGIN to the HTTPS website origin in production.");
  if (publicOrigin && (new URL(publicOrigin).origin !== publicOrigin || (secureCookies && !publicOrigin.startsWith("https://")))) throw new Error("PUBLIC_ORIGIN must be an origin such as https://directory.example.org without a trailing slash.");
  let account;
  if (!usingDatabase) {
    if (process.env.ADMIN_PASSWORD) {
      if (process.env.ADMIN_PASSWORD.length < 12) throw new Error("ADMIN_PASSWORD must contain at least 12 characters.");
      const salt = randomBytes(32).toString("hex");
      account = { username: process.env.ADMIN_USERNAME || "admin", salt, passwordHash: require("node:crypto").scryptSync(process.env.ADMIN_PASSWORD, salt, 64).toString("hex") };
    } else account = JSON.parse(fs.readFileSync(accountPath, "utf8"));
  }
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
  for (const origin of allowedOrigins) if (new URL(origin).origin !== origin) throw new Error("ALLOWED_ORIGINS entries must be complete origins without a path or trailing slash.");
  const port = Number(process.env.PORT || 8765);
  const host = process.env.HOST || (secureCookies ? "0.0.0.0" : "127.0.0.1");
  // APP_ENVIRONMENT distinguishes a UAT deployment from production — used for the accounts table's
  // `environment` column (so a UAT server process can only ever see UAT accounts) and surfaced to
  // the frontend via /api/session so the admin UI can show a "User Acceptance Testing" banner.
  const environment = (process.env.APP_ENVIRONMENT || "production").toLowerCase();
  if (environment !== "production" && environment !== "uat") throw new Error("APP_ENVIRONMENT must be \"production\" or \"uat\" if set.");
  (async () => {
    let store, accountsStore, sessionsStore, feedbackStore;
    const attachmentsDir = process.env.ATTACHMENTS_DIR || path.join(__dirname, ".private", "attachments");
    if (usingDatabase) {
      const { Pool } = require("pg");
      const { createPgDataStore } = require("./db/pg-store");
      const { createAccountsStore } = require("./accounts-pg");
      const { createSessionsStore } = require("./sessions-pg");
      const { createFeedbackStore } = require("./feedback-pg");
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      await pool.query("SELECT 1"); // fail fast on a bad connection string instead of on the first request
      store = createPgDataStore(pool);
      accountsStore = createAccountsStore(pool, environment);
      sessionsStore = createSessionsStore(pool, SESSION_TTL);
      feedbackStore = createFeedbackStore(pool);
      console.log("Using PostgreSQL storage and multi-account auth (DATABASE_URL is set). Environment: " + environment + ".");
    } else {
      console.log("Using single-file JSON storage and single-admin auth (DATA_PATH). Set DATABASE_URL to use PostgreSQL + multi-account auth instead.");
    }
    const app = createApp({ account, secureCookies, publicOrigin, allowedOrigins, dataPath: process.env.DATA_PATH || path.join(__dirname, ".private", "dataset.json"), store, accountsStore, sessionsStore, environment, feedbackStore, attachmentsDir });
    app.listen(port, host, () => console.log("Directory server listening on " + host + ":" + port));
  })().catch(error => { console.error("Failed to start: " + error.message); process.exit(1); });
}

module.exports = { createApp };
