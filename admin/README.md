# Administrator interface

This directory contains the administrator UI and its browser adapters.

| File | Purpose |
| --- | --- |
| `login.html`, `login.js` | Initial administrator sign-in flow |
| `index.html`, `console.js` | Dashboard, records, relationships, sources and history |
| `auth.js` | Server authentication or explicitly enabled Sprint demo login |
| `store.js` | Data adapter consumed by the UI and public directory |
| `demo-store.js` | Synthetic records in browser-local storage for the Pages demo |

Pages URL: `https://lilth2.github.io/COMP8715demo/admin/login.html`.

GitHub Pages currently uses the initial-account **demonstration login**, configured in the public `site-config.js`. It can be bypassed and must only be used with synthetic data. Changes are stored in the current browser, never sent to the real backend.

When a real backend is deployed, set `apiBaseUrl` and disable `demoAccount.enabled` in `site-config.js`. Backend authentication then takes precedence and the demo store is inactive. Server credentials and private data are in `backend/.private/`, excluded from Git. See `../docs/DEPLOYMENT.md`.
