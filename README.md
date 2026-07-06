# GaliLeo CV

AI-powered resume analysis system.

## Deployment

The frontend is deployed with GitHub Pages through `.github/workflows/pages.yml`.

- If `frontend/package.json` exists, the workflow installs dependencies, builds the frontend, and publishes `frontend/dist`.
- If no frontend app exists yet, the workflow publishes the repository root so GitHub Pages can still complete successfully.

After the first push, enable GitHub Pages in the repository settings:

1. Open **Settings -> Pages**.
2. Set **Source** to **GitHub Actions**.
3. Re-run the **Deploy GitHub Pages** workflow if needed.

If the workflow fails with `Get Pages site failed`, the repository has not
created a GitHub Pages site yet. Fix it with either option:

- Recommended: open `Settings -> Pages`, set **Source** to **GitHub Actions**,
  save, then re-run the workflow.
- Optional automation: add a repository secret named `PAGES_TOKEN` that uses a
  Personal Access Token with Pages write permission. The workflow will then use
  `actions/configure-pages` with `enablement: true`.
