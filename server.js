"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const deriveKey = promisify(scrypt);
const { createDataStore } = require("./server-data");
const ROOT = __dirname;
const SESSION_TTL = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const COOKIE = "rd_admin_session";
const PUBLIC_FILES = new Set(["index.html", "app.js", "data.js", "admin-store.js", "admin-login.html", "admin-login.js", "admin-auth.js", "site-config.js"]);
const ADMIN_FILES = new Set(["admin.html", "admin.js"]);

function createApp({ account, secureCookies = false, publicOrigin, allowedOrigins = [], dataPath } = {}) {
  if (!account || !account.username || !/^[a-f0-9]{128}$/.test(account.passwordHash || "") || !/^[a-f0-9]{64}$/.test(account.salt || "")) {
    throw new Error("A valid initial admin account is required. Run npm run setup:admin first.");
  }
  const sessions = new Map();
  const attempts = new Map();
  const store = createDataStore(dataPath);
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of sessions) if (value.expires <= now) sessions.delete(key);
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  }, 60000);
  cleanup.unref();

  function session(req) {
    if (req.headers.authorization) {
      const token = req.headers.authorization.replace(/^Bearer /, "");
      const current = sessions.get(token);
      if (!current || current.expires <= Date.now()) { sessions.delete(token); return null; }
      return { token, ...current };
    }
    const entry = (req.headers.cookie || "").split(";").map(value => value.trim()).find(value => value.startsWith(COOKIE + "="));
    const token = entry ? entry.slice(COOKIE.length + 1) : "";
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
  async function body(req) {
    let input = "";
    for await (const chunk of req) {
      input += chunk;
      if (Buffer.byteLength(input) > (req.url === "/api/admin/action" ? 2 * 1024 * 1024 : 8192)) throw Object.assign(new Error("Request too large."), { status: 413 });
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
    const current = session(req);
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
        return json(res, 200, current ? { authenticated: true, username: current.username, expiresAt: current.expires } : { authenticated: false });
      }
      if (url.pathname === "/api/login" && req.method === "POST") {
        const client = req.socket.remoteAddress;
        let limit = attempts.get(client);
        if (!limit || limit.until <= Date.now()) { limit = { count: 0, until: Date.now() + LOGIN_WINDOW }; attempts.set(client, limit); }
        if (limit.count >= 10) return json(res, 429, { message: "Too many attempts. Please try again in 15 minutes." }, { "Retry-After": String(Math.ceil((limit.until - Date.now()) / 1000)) });
        limit.count++;
        const value = await body(req);
        if (!value || typeof value.username !== "string" || typeof value.password !== "string" || value.password.length > 1024) return json(res, 400, { message: "Enter your administrator username and password." });
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
        if (current) sessions.delete(current.token);
        return json(res, 200, { authenticated: false }, { "Set-Cookie": cookie("", 0) });
      }
      if (url.pathname === "/api/dataset" && req.method === "GET") return json(res, 200, store.publicData());
      if (url.pathname === "/api/admin/dataset" && req.method === "GET") {
        if (!current) return json(res, 401, { message: "Administrator login required." });
        return json(res, 200, store.snapshot());
      }
      if (url.pathname === "/api/admin/action" && req.method === "POST") {
        if (!current) return json(res, 401, { message: "Administrator login required." });
        const value = await body(req);
        if (!value || typeof value.operation !== "string") return json(res, 400, { message: "Invalid administrator action." });
        return json(res, 200, store.apply(value.operation, value.value, value.id, current.username));
      }
      if (url.pathname.startsWith("/api/")) return json(res, 404, { message: "Not found." });
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { message: "Method not allowed." });
      let file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (ADMIN_FILES.has(file) && !current) {
        if (file === "admin.html") return redirect(res, "admin-login.html");
        return json(res, 401, { message: "Administrator login required." });
      }
      if (file === "admin-login.html" && current) return redirect(res, "admin.html");
      if (!PUBLIC_FILES.has(file) && !ADMIN_FILES.has(file)) return json(res, 404, { message: "Not found." });
      res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
      res.end(req.method === "HEAD" ? undefined : await fs.promises.readFile(path.join(ROOT, file)));
    } catch (error) {
      json(res, error.status || 500, { message: error.status ? error.message : "Unable to complete the request." });
    }
  });
  server.on("close", () => clearInterval(cleanup));
  return server;
}

if (require.main === module) {
  const accountPath = path.join(ROOT, ".private", "admin-account.json");
  if (!process.env.ADMIN_PASSWORD && !fs.existsSync(accountPath)) {
    console.error("Initial administrator missing. Run npm run setup:admin before npm start.");
    process.exit(1);
  }
  const secureCookies = process.env.NODE_ENV === "production";
  const publicOrigin = process.env.PUBLIC_ORIGIN;
  if (secureCookies && !publicOrigin) throw new Error("Set PUBLIC_ORIGIN to the HTTPS website origin in production.");
  if (publicOrigin && (new URL(publicOrigin).origin !== publicOrigin || (secureCookies && !publicOrigin.startsWith("https://")))) throw new Error("PUBLIC_ORIGIN must be an origin such as https://directory.example.org without a trailing slash.");
  let account;
  if (process.env.ADMIN_PASSWORD) {
    if (process.env.ADMIN_PASSWORD.length < 12) throw new Error("ADMIN_PASSWORD must contain at least 12 characters.");
    const salt = randomBytes(32).toString("hex");
    account = { username: process.env.ADMIN_USERNAME || "admin", salt, passwordHash: require("node:crypto").scryptSync(process.env.ADMIN_PASSWORD, salt, 64).toString("hex") };
  } else account = JSON.parse(fs.readFileSync(accountPath, "utf8"));
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
  for (const origin of allowedOrigins) if (new URL(origin).origin !== origin) throw new Error("ALLOWED_ORIGINS entries must be complete origins without a path or trailing slash.");
  const app = createApp({ account, secureCookies, publicOrigin, allowedOrigins, dataPath: process.env.DATA_PATH || path.join(ROOT, ".private", "dataset.json") });
  const port = Number(process.env.PORT || 8765);
  const host = process.env.HOST || (secureCookies ? "0.0.0.0" : "127.0.0.1");
  app.listen(port, host, () => console.log("Directory server listening on " + host + ":" + port));
}

module.exports = { createApp };
