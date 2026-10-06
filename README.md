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

## Draft and publish workflow

Admin is the single source of truth. Every organisation, project, research theme and relationship has a status:

| Status | Meaning |
| --- | --- |
| `draft` | Saved in Admin only. New records start here. Never returned by the public API. |
| `published` | Visible publicly. The public copy is a stored snapshot taken at publish time. |
| `archived` | Retired but kept in Admin. Not public. Restore returns it to `draft`. |

- **Save** never changes what the public sees. Editing a published record keeps the last published snapshot public and shows "unpublished changes" in Admin until you click **Publish changes**.
- **Publish** asks for confirmation and shows the content. **Withdraw** returns a published record to `draft`. **Preview** shows a record, its visibility and its relationships (Admin is login-protected).
- A relationship can be published only when both ends are published. The public API additionally drops any relationship whose endpoint is not currently published, so withdrawing or archiving an entity never leaves a dangling edge. Deleting an entity also deletes its relationships (Admin warns with the count first).
- Public pages (Directory, search, filters, counts, Ecosystem Network, Geography, Insights, Data Trust) render only the published data supplied by `GET /api/dataset`. Insights, region counts and hotspots are computed from it. The AI Discovery question bank is scripted demo content: an entry is offered only while every record it cites is published, and the view says so.
- Empty published data shows an empty state; a failed request shows an error banner with Retry and no placeholder records. Map pins come from each organisation's recorded offices (state-level placement; the model has no coordinates). Organisations without an office are listed as "location unavailable".
- Public pages re-fetch when the tab regains focus. In browser demo mode an open public tab updates through the `storage` event.

**Migration.** Records that existed before this workflow (including an existing `dataset.json`, which has no `status`) are migrated as `published` with their current fields as the published snapshot, so nothing that was public disappears and nothing is newly exposed. A legacy file is copied once to `dataset.json.pre-publish-workflow.bak` before it is rewritten. Seed research themes are now stored in the dataset (`themes`) so they can be managed.

**Browser demo mode limits.** On GitHub Pages the dataset lives in this browser's `localStorage`. It is not shared across browsers, devices or users, and clearing site data loses it. Use Export JSON to keep a copy.

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
