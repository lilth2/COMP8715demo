# Australian R&D Intelligent Directory

Interactive Sprint prototype for exploring Australian R&D organisations, facilities, themes and relationships.

## Run locally

Serve the repository with any static web server, then open `index.html`.

```powershell
python -m http.server 8000
```

- Public directory: `http://localhost:8000/`
- Administration console: `http://localhost:8000/admin.html`

## Sprint 2 administration console

The current admin console provides a working prototype of the maintenance workflow:

- create, edit, search and archive organisation records;
- create, edit and delete relationships;
- maintain source categories and provenance notes;
- record confidence levels and last-checked dates;
- keep a local change history;
- import and export the managed dataset as JSON.

Changes are stored in browser `localStorage` through `admin-store.js` and are immediately visible in the public directory in the same browser. This keeps the prototype usable before the production database, hosting and authentication choices are confirmed.

## Production integration boundary

`admin-store.js` is the temporary persistence boundary. A production version can replace its methods with authenticated API calls while keeping the public directory and admin UI structure.

Suggested API resources:

- `GET/POST/PATCH/DELETE /api/organisations`
- `GET/POST/PATCH/DELETE /api/relationships`
- `GET/POST/PATCH/DELETE /api/sources`
- `GET /api/audit-log`

Production work still requires authentication, role-based permissions, server-side validation, database migrations, backups and an approval workflow.
