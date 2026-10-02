"use strict";

const { randomBytes, scryptSync } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const accountDir = path.join(__dirname, ".private");
const accountPath = path.join(accountDir, "admin-account.json");
if (fs.existsSync(accountPath)) {
  console.log("The initial administrator already exists. Existing credentials were preserved.");
  process.exit(0);
}
const username = process.env.ADMIN_USERNAME || "admin";
const password = process.env.ADMIN_PASSWORD || "RD-" + randomBytes(15).toString("base64url");
if (password.length < 12) throw new Error("ADMIN_PASSWORD must contain at least 12 characters.");
const salt = randomBytes(32).toString("hex");
fs.mkdirSync(accountDir, { recursive: true, mode: 0o700 });
fs.writeFileSync(accountPath, JSON.stringify({ username, salt, passwordHash: scryptSync(password, salt, 64).toString("hex") }, null, 2), { mode: 0o600, flag: "wx" });
fs.writeFileSync(path.join(accountDir, "INITIAL_ADMIN_CREDENTIALS.txt"), "Administrator username: " + username + "\nInitial password: " + password + "\n\nKeep this file private. It is excluded from Git.\n", { mode: 0o600, flag: "wx" });
console.log("Initial administrator created. Credentials: .private/INITIAL_ADMIN_CREDENTIALS.txt");
