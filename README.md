# GaliLeo CV

AI 赋能的智能简历分析系统。前端部署在 GitHub Pages，后端使用 Sealos Laf 云函数提供 RESTful API。

## Architecture

- Frontend: Vite + React + TypeScript, deployed by GitHub Pages.
- Backend: Sealos Laf cloud functions.
- API domain: `https://w8m6b6odq5.sealosbja.site`
- AI provider: DeepSeek official API, configured by Laf environment variables.
- Cache: Redis is reserved by key design and `REDIS_URL`; when unset, cache is skipped.

## Frontend

```bash
cd frontend
npm install
npm run dev
npm test
npm run build
```

The GitHub Pages build uses `frontend/package.json` when it exists and publishes `frontend/dist`.

Required frontend environment variable:

```bash
VITE_API_BASE_URL=https://w8m6b6odq5.sealosbja.site
```

The current default is already set in code, so local development works without an `.env` file.

## Laf Backend

Cloud functions:

- `GET /health`
- `POST /resume_analyze`
- `POST /resume_match`

Local Laf files:

- `functions/health.ts`
- `functions/resume_analyze.ts`
- `functions/resume_match.ts`

Useful commands:

```bash
laf user switch sealaf-bja
laf app init w8m6b6odq5
laf func push health -f
laf func push resume_analyze -f
laf func push resume_match -f
```

Do not commit `.app.yaml`; it contains local Laf access tokens and storage credentials.

Backend environment variables:

```bash
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
REDIS_URL=
ALLOWED_ORIGIN=https://departurezsh.github.io
```

When `DEEPSEEK_API_KEY` is not configured, the business APIs return:

```json
{
  "ok": false,
  "code": "DEEPSEEK_NOT_CONFIGURED",
  "message": "DEEPSEEK_API_KEY is not configured"
}
```

## Deployment

The frontend is deployed with GitHub Pages through `.github/workflows/pages.yml`.

If the workflow fails with `Get Pages site failed`, the repository has not created a GitHub Pages site yet. Fix it with either option:

- Recommended: open `Settings -> Pages`, set **Source** to **GitHub Actions**, save, then re-run the workflow.
- Optional automation: add a repository secret named `PAGES_TOKEN` that uses a Personal Access Token with Pages write permission. The workflow will then use `actions/configure-pages` with `enablement: true`.
