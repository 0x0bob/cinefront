# cinefront

Next.js (App Router, TypeScript) frontend for SceneShift: text request -> admin approval -> a PC worker generates a 180° AI video dome -> gallery + Three.js viewer (drag, zoom, Enter VR). It is a generated video on a dome (3DoF), not a 3D reconstruction.

Deploy on Vercel with the repo root as the project root. Needs Upstash Redis (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) and Vercel Blob (`BLOB_READ_WRITE_TOKEN`), plus the secrets listed in `.env.example` (`REQUEST_PASSCODE`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `WORKER_SECRET`, `IP_HASH_SALT`, `DAILY_CAP_USD`, ...). No real values are in this repo.

Local: `npm install`, copy `.env.example` to `.env.local` (set `STORE_DRIVER=local`, `BLOB_DRIVER=local`), `npm run dev`, `npm test`.

The generation worker (`vercel_worker.py`) lives in the main SceneShift repo and polls this site; nothing calls the PC.
