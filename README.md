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

