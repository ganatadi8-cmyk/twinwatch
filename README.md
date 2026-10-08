# TwinWatch

Software prototype for **Human Digital Twins in Industry 5.0 Using AI and IoT**. Analyse an existing video, a live webcam feed, or measured posture data and receive timestamped alerts for sustained trunk lean and arm elevation.

## Features

- Video upload and live webcam use the same MediaPipe Pose model.
- CSV import accepts `timestamp,trunk_angle,arm_angle` in seconds and degrees.
- A 3D skeletal twin, posture chart, and explained alert timeline update during analysis.
- Configurable angle thresholds, duration, and landmark visibility filtering.
- Alert acknowledgement, CSV report export, and PostgreSQL session history.
- Frames stay in the browser. Only derived measurements and alerts are saved.

## Technology

| Technology | Purpose |
| --- | --- |
| Next.js, React, TypeScript | Dashboard and server API |
| Tailwind CSS and shadcn primitives | Interface styling and accessible controls |
| MediaPipe Tasks Vision, WebAssembly, Web Workers | On-device pose inference from video and webcam |
| Three.js | 3D skeletal twin |
| Recharts | Angle history chart |
| Neon PostgreSQL | Persistent session summaries |
| Zod | Server-side report validation |
| Vercel | Next.js hosting and API execution |

## Run locally

Use Node.js 22.13 or later and the pnpm version in `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
```

Replace the placeholder `DATABASE_URL` in `.env.local` with a Neon connection string. Apply the schema once, then start the app:

```bash
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000`. Without a database connection, video/webcam/CSV analysis and report export work; saved history reports an explicit error. The application does not pretend a failed save succeeded.

## Build and check

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm start
```

Installation and build prepare same-origin MediaPipe assets and download Google's official Pose Landmarker Lite model if needed. The model is checked against a pinned SHA-256 checksum. Generated assets and local secrets are excluded from git.

## Use

1. Select **Upload video**, choose a browser-supported MP4/WebM/MOV, and press **Analyse**.
2. Or select **Live webcam**, grant camera permission, and keep the torso, hips and arms visible.
3. For existing measurements, select CSV input and import the supplied `public/sample-posture.csv` or your dataset. Blank angles represent unavailable measurements; samples must be at most one second apart to establish sustained posture continuity. The example file is simulated demonstration data.
4. Adjust **Alert settings** before a session. Defaults are trunk 35°, arm 90°, hold 3 seconds, and landmark visibility 0.6. A 5° recovery margin avoids repeated events at a threshold.
5. Finish analysis to save the summary, open **Sessions** to review it, or download the report as CSV.

## Session privacy

The Vercel edition creates a random, HttpOnly, SameSite=Lax browser workspace cookie, with Secure enabled in production. Only its SHA-256 hash is stored with database rows. Reports belong to that browser workspace; this is not an account login or cross-device synchronisation. Clearing cookies starts a new workspace. Export reports before clearing cookies. POST requests reject cross-site origins, and history responses are never cached.

## Deploy

Follow [DEPLOYMENT.md](DEPLOYMENT.md) to create the GitHub repository, provision Neon, and import the project into Vercel. A successful local build does not mean it has been published or that a database has been provisioned.

## Prototype limits

Single-camera posture estimates depend on camera angle, lighting, and occlusion. Visibility is not a validated accuracy probability. These configurable posture indicators are not a full RULA/REBA score or a clinical fatigue assessment. Validate results against annotated footage before industrial use.

The application does not measure heart rate or mental fatigue. Webcam access requires HTTPS or localhost and browser permission; the 3D view requires WebGL. Browser codecs affect video compatibility, background tabs may throttle processing, and CSV angle data cannot reconstruct a skeleton without landmarks.

MediaPipe runtime licensing and model documentation: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker . Vendored shadcn styling includes its license in `vendor/`.
