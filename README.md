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

- `admin/`: administrator pages (`index.html`, `console.js`, `network-editor.js`, `bulk-import.js`, `bulk-actions.js`, `accounts.js`, `feedback.js`), login, authentication adapter, client stores, and `dataset-core.js`, the shared rules engine (also the core all bulk-import/bulk-action logic lives in).
- `backend/`: server, account setup (both single-admin and multi-account/`accounts-pg.js`), sessions, feedback tracker, persistence wrapper, `backend/db/` (PostgreSQL schema/migration/snapshot/restore), `backend/import/` (dependency-free `.xlsx`/`.csv` parsing and field mapping), and tests.
- `docs/`: deployment (`DEPLOYMENT.md`), UAT (`UAT.md`), and the real-data import report (`EXCEL_IMPORT_REPORT.md`).
- `index.html`, `app.js`, `data.js`, `ai-engine.js`: public directory.
- `admin.html`, `admin-login.html`: small redirects for existing bookmarks.

## Administration console

- **Network editor** (Admin > Network editor): edit the Ecosystem Network graphically, see below.
- Tables for organisations, projects, research themes, relationships and sources, with search and status filters.
- Draft / Publish / Withdraw / Delete for every record, with confirmation dialogs that show what will happen.
- Confidence levels, last-checked dates, source notes, office locations, a change history, and JSON import / export.

### Network editor

Admin > **Network editor** is an interactive canvas of the same records as the tables (it keeps no graph copy of its own):

- Search, status filter (draft / published / unpublished changes), node-type filter and relationship-type filter dim non-matching items. Click a node or a line to select it.
- **+ Organisation / + Project / + Theme** add a draft node (the normal edit form opens; the node is placed at the centre of the view).
- **Link nodes**: click two nodes, then complete the relationship form (type, strength, evidence). Project -> organisation defaults to "Hosted by"; anything with a theme defaults to "Shares research theme".
- The side panel shows the selected node or link with Edit, Preview, Publish / Publish changes, Withdraw and Delete. Click a link in the panel to jump to it.
- Drag nodes to arrange them; the position is saved immediately. Drag empty space to pan, scroll to zoom, **Fit view** / **Auto-arrange** to reset. Positions are stored as `layout.nodes` in the dataset: abstract canvas coordinates, unrelated to map locations and never sent to the public site.
- Drafts are dashed with a **D** badge; published records are solid; published records with unpublished edits have an amber ring.
- Deleting a node shows its name and exactly which relationships, hosted projects and theme tags go with it.

## Draft and publish workflow

Admin is the single source of truth. Every organisation, project, research theme and relationship has a status:

| Status | Meaning |
| --- | --- |
| `draft` | Saved in Admin only. New records start here. Never returned by the public API. |
| `published` | Visible publicly. The public copy is a stored snapshot taken at publish time. |

There is no archive. A record is either in the working set (draft or published) or deleted.

- **Save** never changes what the public sees. Editing a published record keeps the last published copy public and shows "unpublished changes" until you click **Publish changes**. The confirmation lists the exact field differences.
- **Publish** shows the content and asks for confirmation. **Withdraw** returns a published record to `draft` (it disappears publicly; nothing is deleted). **Preview** shows a record, its visibility and its relationships (login required).
- **Publishing a relationship whose end is still a draft** is explained, not silent: the dialog names the unpublished records and offers "Publish these records too". The server enforces the same rule, so the API refuses (HTTP 400, naming the records) unless `withDependencies` is sent.
- **Delete** removes the record everywhere: its published copy, its relationships, layout position and any reference to it (project hosts, theme tags). A published record disappears from the public site immediately. The audit log keeps the fact that it was deleted.
- The public API only returns published records, and only relationships that are published with both ends published, so withdrawing or deleting never leaves a dangling edge.

### Single authority for links

A project's host and a record's research-theme tags used to exist both as fields and as relationships. **Relationships are now the authority.**

- A project's host is its `hosted_by` relationship (project -> organisation, at most one). A record's theme tags are its `shares_research_theme` relationships to theme nodes.
- `hostId` and the theme ids in `themes` are derived from those relationships by the shared core on every save. The edit forms only edit "other topic tags" (tags with no theme node); to link a theme or set a host, use the Network editor or Relationships.
- Creating or deleting such a relationship in the graph updates the node fields, and the other way round: a theme id typed as a tag creates the matching draft link.
- Public hosts and theme tags are derived from published relationships only. Publishing a node also publishes its links to already-published records; a link to a draft record stays hidden until that record is published, and the confirmation dialog lists those links.

### Public site and AI Discovery

- All public views (Directory, search, filters, counts, Ecosystem Network, Geography, Insights, Data Trust, AI Discovery) render only the published data from `GET /api/dataset`.
- **AI Discovery** answers are generated from the published records at question time (`ai-engine.js`): lists by theme, state or type, counts, an organisation's relationships, the shortest published connection between two organisations, and coverage gaps. Evidence comes from the relationships' own evidence text. Questions the data cannot answer get an explicit "can't answer" reply, and suggested questions are built from what is currently published. There is no pre-written answer bank.
- Empty data shows an empty state; a failed request shows an error banner with Retry and no placeholder records. Map pins come from each organisation's recorded offices (state-level placement; the data model has no coordinates). Organisations without an office are listed as "location unavailable".
- Public pages re-fetch when the tab regains focus. In browser demo mode an open public tab updates through the `storage` event.

### Migration and backups

The dataset version is now 3. On first load of an older dataset, the shared core migrates it and, before the file or browser storage is rewritten, keeps an untouched copy:

| Where | Backup |
| --- | --- |
| `dataset.json` | `dataset.json.bak-v<old version>` next to it (created once) |
| Browser demo storage | `localStorage["rd-directory-demo-data-v1.backup-v<old version>"]` |

Rules: records with no `status` (version 1) become `published`; legacy `archived` records are **kept as non-public drafts** with their content (their old published copy is dropped, so they are never auto-published); a theme tag or project host that had no matching relationship gets one created (published only when both ends are already published, so existing public filters and counts do not shrink). Seed research themes are stored in the dataset so they can be managed.

### Where data lives, and who sees it

- **Backend mode** (`apiBaseUrl` set in `site-config.js`): one shared dataset on the server. Every visitor and browser sees the same published data; admins' drafts are visible only to signed-in admins.
- **Browser demo mode** (`apiBaseUrl` empty, as on GitHub Pages today): the dataset lives in this browser's `localStorage`. Changes are visible only to this browser on this site. They are **not** shared with other visitors, browsers or devices, and clearing site data loses them (use Export JSON).
- GitHub Pages is static, so shared editing needs the Node backend deployed somewhere with HTTPS and persistent storage; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

With the backend, changes are saved in `backend/.private/dataset.json` and the public directory fetches the shared published records. Administrator mutations and audit history require a server session. In browser demo mode (GitHub Pages today) changes affect only synthetic records in the current browser's localStorage; Export JSON to transfer them.

## Authentication and deployment

In backend mode, passwords are verified with a salted scrypt hash. Sessions expire after eight hours and are revoked on logout. The same-origin version uses an HttpOnly cookie; the connected GitHub Pages frontend uses an opaque bearer token in tab-local sessionStorage. Server sessions are held in memory, so a restart requires signing in again. Login attempts are rate limited.

- `POST /api/login` and `POST /api/logout`
- `GET /api/session`
- `GET /api/dataset` (public directory records only)
- `GET /api/admin/dataset` (authenticated, includes audit history)
- `POST /api/admin/action` (authenticated, validates records and writes history)

GitHub Pages currently enables the explicitly requested **initial-account demonstration login** through `demoAccount` in `site-config.js`. This frontend-only flow can be bypassed and must only be used with synthetic data. It has no registration UI. The account verifier is public; the plaintext password is not stored in the repository. See [admin/README.md](admin/README.md).

For real access control, deploy the Node.js backend, set `apiBaseUrl` in `site-config.js` to its HTTPS origin and disable `demoAccount.enabled`. Backend mode takes precedence whenever the API address is configured. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

This version uses one administrator and a JSON file **by default**. Setting the `DATABASE_URL` environment variable switches the whole backend to PostgreSQL with multi-account auth (see the next section) — the JSON-file mode above remains fully supported and unchanged for anyone not using it.

## PostgreSQL, multi-account auth, bulk import and feedback tracking

Setting `DATABASE_URL` enables a second storage/auth mode, used for real-data import and
stakeholder UAT testing:

- **Accounts and roles**: real accounts (not one hardcoded admin) with `admin` or `stakeholder`
  roles, both with equivalent full capability — see [docs/UAT.md](docs/UAT.md) for the role matrix
  and why. Create accounts with `npm run setup:accounts`, manage them from the admin console's
  **Accounts** page (list, create, disable/enable, reset password — each immediately revokes that
  account's existing sessions).
- **Environments**: `APP_ENVIRONMENT=production` or `uat`. A server process only ever queries
  accounts/data for its own environment; a UAT account cannot authenticate against a
  production-environment server process. UAT mode shows a persistent "USER ACCEPTANCE TESTING"
  banner on every page.
- **Bulk admin input** (Admin > **Bulk import**): type or paste rows directly into a table
  (including pasting a rectangular block copied from Excel), or upload a `.xlsx`/UTF-8 `.csv`
  file with sheet selection and column mapping. Every import runs through
  preview (per-row new/update/skip/error counts) → confirm → commit, is all-or-nothing (a row
  error blocks the whole batch), defaults every imported record to Draft, and records
  provenance (file fingerprint, sheet, row numbers, batch) so re-uploading the identical file is
  detected and refused rather than creating duplicates.
- **Batch admin actions**: select multiple existing records in any table (checkboxes) and
  publish / withdraw / delete / edit-a-field together, with an aggregated impact preview (how many
  are published, which relationships/references are affected) before confirming. Batch field edits
  are restricted to an explicit per-collection allowlist, never identity fields like `id` or
  `status`.
- **Custom relationship types**: the relationship-type field is a free-text combobox with
  suggestions from existing types everywhere it appears (single-record form, Network editor, bulk
  import) — not a fixed dropdown. Types have a stable ID and an independently editable display
  name and colour, managed from the Relationships page (create, rename, merge-then-delete). The
  two types the app relies on structurally (`hosted_by`, `shares_research_theme`) cannot be
  renamed or deleted.
- **Feedback tracker** (any page, "Report an issue" button once logged in): bug/suggestion
  submissions with repro steps, expected/actual result, related page/record, and an optional
  screenshot (stored outside any public/static directory, served only to an authorised viewer).
  Submission is idempotent (a double-click or retried request never creates a duplicate) and
  preserves the form's content if it fails. `admin`/`stakeholder` accounts see and triage all
  feedback in their environment (status: New/Investigating/Fixed/Ready for retest/Closed, with a
  full change history, and CSV export); an ordinary account would see only its own.
- **Optimistic concurrency**: every record carries a version; a concurrent edit that already
  changed a record is rejected with a 409 conflict and a clear message, instead of silently
  overwriting it.
- **Backups**: `npm run db:snapshot` / `npm run db:restore` for the Postgres path (restore always
  takes a fresh safety backup first, and never touches submitted feedback unless explicitly told
  to). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) §7.
- **Health check**: `GET /api/health` (no login required) reports process/storage/database status.

See [docs/UAT.md](docs/UAT.md) for the full stakeholder testing guide, and
[docs/EXCEL_IMPORT_REPORT.md](docs/EXCEL_IMPORT_REPORT.md) /
[backend/import/real-data/README.md](backend/import/real-data/README.md) for how the real
organisation-relationship Excel dataset was mapped and imported.
