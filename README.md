# Australian R&D Intelligent Directory

Interactive Sprint prototype for exploring Australian R&D organisations, facilities, themes and relationships.

## Run locally

Use Node.js 20 or newer. No additional packages are required.

```powershell
npm run setup:admin
npm start
```

- Public directory: `http://127.0.0.1:8765/`
- Administrator login: `http://127.0.0.1:8765/admin-login.html`
- Administration console: `http://127.0.0.1:8765/admin.html`

The setup command creates one initial administrator, with username `admin` and a generated password. Credentials are saved in `.private/INITIAL_ADMIN_CREDENTIALS.txt`, which is excluded from Git and HTTP serving. Running setup again preserves the account. There is no registration route or UI.

## Sprint 2 administration console

The current admin console provides a working prototype of the maintenance workflow:

- create, edit, search and archive organisation records;
- maintain projects and initiatives;
- create, edit and delete relationships;
- maintain source categories and provenance notes;
- record confidence levels and last-checked dates;
- keep a local change history;
- import and export the managed dataset as JSON.

Changes are saved on the server in `.private/dataset.json`. The public directory fetches the shared dataset when it loads. Administrator mutations and the audit log require an authenticated session. Existing localStorage changes from the earlier prototype are not migrated automatically.

## Authentication and deployment

Passwords are verified on the server with a salted scrypt hash. Sessions expire after eight hours and are revoked on logout. The same-origin version uses an HttpOnly cookie; GitHub Pages uses an opaque bearer token in tab-local sessionStorage to avoid relying on third-party cookies. Sessions are held in memory, so a backend restart requires signing in again. Login attempts are rate limited.

- `POST /api/login` and `POST /api/logout`
- `GET /api/session`
- `GET /api/dataset` (public directory records only)
- `GET /api/admin/dataset` (authenticated, includes audit history)
- `POST /api/admin/action` (authenticated, validates records and writes history)

GitHub Pages serves the static frontend. Deploy this Node.js backend separately, then set `apiBaseUrl` in `site-config.js` to its HTTPS origin. Without this configuration, the public site continues to show synthetic data and administrator login remains unavailable. See [DEPLOYMENT.md](DEPLOYMENT.md) for environment settings and container deployment.

This version uses one administrator and a JSON file. Use one backend instance with persistent storage and backups. A production database, granular roles and an approval workflow can be added in a later sprint.
