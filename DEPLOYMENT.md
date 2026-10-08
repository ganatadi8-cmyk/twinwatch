# GitHub and Vercel deployment

This source is a standard Next.js project. No database credentials are included.

## 1. Create the GitHub repository

Create an empty repository named `twinwatch` in your GitHub account. Keep it private unless you want the source public. Do not initialise the remote with a README; this project already includes one.

If using the supplied git checkout, connect it to your repository and push:

```bash
git remote add origin https://github.com/YOUR_USERNAME/twinwatch.git
git push -u origin main
```

If using the source ZIP instead, initialise git in its `twinwatch` directory first:

```bash
git init -b main
git add .
git commit -m "Add TwinWatch posture monitoring application"
git remote add origin https://github.com/YOUR_USERNAME/twinwatch.git
git push -u origin main
```

## 2. Prepare PostgreSQL

Create a Neon project, database, and compute endpoint. Copy its PostgreSQL connection string to the local `.env.local` file as `DATABASE_URL`. Do not commit the connection string.

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
```

Alternatively run `migrations/001_sessions.sql` in Neon's SQL editor. The migration is idempotent. Use a separate Neon branch for Vercel previews if previews should have independent data.

## 3. Import into Vercel

1. Add a new Vercel project and import the `twinwatch` GitHub repository.
2. Select the Next.js framework and repository root.
3. Use Node.js 22.x or a later supported version.
4. Use `pnpm install --frozen-lockfile` for installation and `pnpm build` for the build. Leave the output directory at the Next.js default.
5. Set the sensitive `DATABASE_URL` environment variable for Production. Add a separate preview connection for Preview if needed.
6. Deploy. `vercel.json` requests the Mumbai (`bom1`) function region; choose a nearby Neon region when provisioning the database.

No AI API key is required. The build must be able to download the pinned MediaPipe model from `storage.googleapis.com`.

## 4. Verify the deployed application

- Open the HTTPS deployment and import `public/sample-posture.csv`. It should produce two sustained posture alerts, at source timestamps 3 seconds and 11 seconds, with the default rules.
- Finish a session, refresh the page, and confirm its summary remains in **Sessions**.
- Open the same deployment in a separate browser profile and confirm the first profile's history is absent.
- Upload a supported video, then test a live webcam with camera permission. Confirm pose tracking, the skeletal twin, angle updates, and alerts.
- Download a CSV report. Confirm save errors remain visible if the database connection is unavailable.

The GitHub and Vercel account permissions and database provisioning must be completed before hosted persistence can be verified. Camera testing requires a camera-equipped browser.
