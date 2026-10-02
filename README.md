# Australian R&D Intelligent Directory

Interactive Sprint prototype for exploring Australian R&D organisations, facilities, themes and relationships.

## Run locally

Use Node.js 20 or newer. No additional packages are required.

```powershell
npm run setup:admin
npm start
```

- Public directory: `http://127.0.0.1:8765/`
- Administrator login: `http://127.0.0.1:8765/admin/login.html`
- Administration console: `http://127.0.0.1:8765/admin/index.html`

The setup command creates one initial administrator, with username `admin` and a generated password. Credentials are saved in `backend/.private/INITIAL_ADMIN_CREDENTIALS.txt`, which is excluded from Git and HTTP serving. Running setup again preserves the account. There is no registration route or UI.

## Repository structure

- `admin/`: administrator pages, login, authentication adapter and client data stores.
- `backend/`: account setup, authentication server, persistence and tests.
- `docs/`: deployment documentation.
- `index.html`, `app.js`, `data.js`: public directory prototype.
- `admin.html`, `admin-login.html`: small redirects for existing bookmarks.

## Sprint 2 administration console

The current admin console provides a working prototype of the maintenance workflow:

- create, edit, search and archive organisation records;
- maintain projects and initiatives;
- create, edit and delete relationships;
- maintain source categories and provenance notes;
- record confidence levels and last-checked dates;
- keep a local change history;
- import and export the managed dataset as JSON.

With the backend, changes are saved in `backend/.private/dataset.json` and the public directory fetches shared records. Administrator mutations and audit history require a server session. In the GitHub Pages Sprint demo, changes affect only synthetic records in the current browser's localStorage. Export JSON to transfer demo records; old browser-local records are not migrated automatically.

## Authentication and deployment

In backend mode, passwords are verified with a salted scrypt hash. Sessions expire after eight hours and are revoked on logout. The same-origin version uses an HttpOnly cookie; the connected GitHub Pages frontend uses an opaque bearer token in tab-local sessionStorage. Server sessions are held in memory, so a restart requires signing in again. Login attempts are rate limited.

- `POST /api/login` and `POST /api/logout`
- `GET /api/session`
- `GET /api/dataset` (public directory records only)
- `GET /api/admin/dataset` (authenticated, includes audit history)
- `POST /api/admin/action` (authenticated, validates records and writes history)

GitHub Pages currently enables the explicitly requested **initial-account demonstration login** through `demoAccount` in `site-config.js`. This frontend-only flow can be bypassed and must only be used with synthetic data. It has no registration UI. The account verifier is public; the plaintext password is not stored in the repository. See [admin/README.md](admin/README.md).

For real access control, deploy the Node.js backend, set `apiBaseUrl` in `site-config.js` to its HTTPS origin and disable `demoAccount.enabled`. Backend mode takes precedence whenever the API address is configured. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

This version uses one administrator and a JSON file. Use one backend instance with persistent storage and backups. A production database, granular roles and an approval workflow can be added in a later sprint.
