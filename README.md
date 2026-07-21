# SEO QA Automation Framework

Full-stack web application for SEO quality assurance — recommendation sheet validation and blog content comparison.

```
seo-qa-framework/   ← Backend: Express API + Playwright automation engine
seo-qa-web/         ← Frontend: React + Vite SPA
```

---

## Quick Start (Local Development)

### 1 — Backend

```bash
cd seo-qa-framework
npm install
npx playwright install chromium

# Copy env template and edit if needed
cp api/.env.example api/.env

# Build TypeScript
npm run build

# Start API server (port 3001)
npm run api:start
```

### 2 — Frontend

```bash
cd seo-qa-web
npm install

# Copy env template (leave VITE_API_URL blank for local dev — Vite proxies /api/* to port 3001)
cp .env.example .env

npm run dev
# → opens http://localhost:5173
```

### 3 — CLI (still works unchanged)

```bash
cd seo-qa-framework
npm run audit -- --sheet=audit-sheets/your-sheet.xlsx
npm run blog-audit -- --doc=blogs/Blog.docx --url=https://example.com/blog/my-post
npm run compare -- --sheet=audit-sheets/your-sheet.xlsx
```

---

## Folder Structure

```
SEO _TESTING/
├── seo-qa-framework/          # Backend
│   ├── api/
│   │   ├── server.ts          # Express entry point
│   │   ├── history-store.ts   # JSON file history (no database)
│   │   ├── middleware/
│   │   │   └── upload.ts      # multer file upload middleware
│   │   └── routes/
│   │       ├── runs.ts        # POST /api/runs — run an audit
│   │       ├── history.ts     # GET /api/history, GET /api/history/:id
│   │       └── compare.ts     # POST /api/compare
│   ├── src/                   # Existing Playwright automation modules
│   │   ├── blog/              # Blog docx parser + comparator + URL normalizer
│   │   ├── cli/               # npm run audit / blog-audit / compare
│   │   ├── runner/            # AuditRunner + BlogAuditRunner
│   │   ├── seo-checks/        # All SEO check implementations
│   │   ├── parsers/           # CSV/XLSX parser
│   │   ├── reports/           # Report data builder (JSON output only)
│   │   └── history/           # History compare logic
│   ├── render.yaml            # Render deployment config
│   └── package.json
│
└── seo-qa-web/                # Frontend
    ├── src/
    │   ├── lib/api.ts         # API client (all fetch calls)
    │   ├── components/        # Layout, StatusBadge, StatCard, etc.
    │   └── pages/             # Home, Upload, Results, History, Compare, Settings
    ├── vercel.json            # Vercel deployment config
    └── package.json
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/health` | Health check |
| `POST` | `/api/runs` | Upload file and run audit |
| `GET`  | `/api/runs/:id` | Get a single run result |
| `GET`  | `/api/history` | List all audit history |
| `GET`  | `/api/history/:id` | Get historical audit JSON |
| `GET`  | `/api/history/:id?download=1` | Download audit as JSON file |
| `POST` | `/api/compare` | Compare two audit runs (`{ aId, bId }`) |

### POST /api/runs fields (multipart/form-data)

| Field | Required | Description |
|-------|----------|-------------|
| `file` | ✓ | `.xlsx`, `.csv`, or `.docx` |
| `url` | For `.docx` only | Live blog URL to validate against |
| `noLighthouse` | — | Send `'1'` to skip Lighthouse checks |
| `noAccessibility` | — | Send `'1'` to skip axe-core checks |

---

## Environment Variables

### Backend (`seo-qa-framework/api/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Express server port |
| `ALLOWED_ORIGINS` | `''` (allow all) | Comma-separated allowed CORS origins |
| `UPLOAD_DIR` | `api/uploads` | Uploaded file staging directory |
| `HISTORY_DIR` | `api/history` | JSON audit history directory |
| `HEADLESS` | `true` | Run Playwright headless |
| `LOG_LEVEL` | `info` | Winston log level |
| `BASE_URL` | `https://example.com` | Default base URL for sheet audits |

### Frontend (`seo-qa-web/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `''` | Backend URL (e.g. `https://your-app.onrender.com`). Leave blank for local dev. |

---

## Deployment

### Backend → Render

1. Push the repo to GitHub
2. Create a **Web Service** in Render:
   - **Root directory:** `seo-qa-framework`
   - **Build command:** `npm install && npx playwright install chromium --with-deps && npm run build`
   - **Start command:** `npm run api:start`
3. Add a **Disk** (for persistent history):
   - Mount path: `/opt/render/project/src/api/history`
4. Set environment variables:
   ```
   NODE_ENV=production
   PORT=3001
   ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
   HISTORY_DIR=/opt/render/project/src/api/history
   HEADLESS=true
   ```

The `render.yaml` file pre-configures all of this — just update `ALLOWED_ORIGINS`.

### Frontend → Vercel

1. Import the repo in Vercel dashboard
2. Set **Root directory** to `seo-qa-web`
3. Add environment variable:
   ```
   VITE_API_URL=https://your-render-app.onrender.com
   ```
4. Deploy — Vercel auto-detects Vite

The `vercel.json` handles SPA routing.

---

## User Workflow

```
Upload Excel/CSV/DOCX
        ↓
Application detects file type automatically
        ↓
Excel/CSV → Recommendation Sheet Audit
DOCX      → Blog Content Audit
        ↓
Playwright validates live pages
        ↓
JSON results displayed in the browser
        ↓
Audit saved to history for future comparison
```

No terminal commands required for end users.
