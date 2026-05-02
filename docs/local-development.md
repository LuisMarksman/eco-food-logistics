# Local Development

## One-Time Setup

Install dependencies from each app folder:

```powershell
cd eco-eats-backend
..\.tools\node-v22.13.1-win-x64\npm.cmd install

cd ..\eco-eats-frontend
..\.tools\node-v22.13.1-win-x64\npm.cmd install
```

PowerShell may block globally installed shims on this machine, so these commands use the repo's bundled Node.js.

## Environment

Create `eco-eats-backend\.env` from `eco-eats-backend\.env.example` and set:

- `MONGO_URI`: MongoDB Atlas connection string.
- `JWT_SECRET`: long random secret.
- `PORT`: usually `5000`.
- `CORS_ORIGIN`: usually `http://localhost:5173`.
- `SENSOR_STALE_MINUTES`: defaults to `60`.
- `MAX_SENSOR_READINGS_PER_ITEM`: defaults to `50`.
- `IOT_DEVICE_TOKEN`: optional token required by `/api/iot/telemetry`.
- `GOOGLE_SHEETS_SPREADSHEET_ID`: spreadsheet used as the IoT telemetry queue.
- `GOOGLE_SHEETS_URL` or `GOOGLE_SHEETS_PUBLIC_CSV_URL`: optional public Sheet source when service-account credentials are not used.
- `GOOGLE_SHEETS_PUBLIC_GID`: tab gid for public CSV export; defaults to `0`.
- `GOOGLE_SHEETS_TELEMETRY_RANGE`: defaults to `Telemetry!A2:H`.
- `GOOGLE_SHEETS_HAS_HEADER`: set `true` when importing a public CSV with a header row.
- `GOOGLE_SHEETS_DEFAULT_DEVICE_ID`: fallback device ID for hardware sheets without a device column.
- `GOOGLE_SHEETS_IMPORT_MAX_ROWS`: latest live rows to import per run; defaults to `150`.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY`: service-account credentials with read access to the Sheet.
- `SHEETS_SYNC_TOKEN`: token required by `/api/iot/sheets/status` and `/api/iot/sheets/import`.
- `SHEETS_POLL_INTERVAL_MS`: optional background polling interval; set `0` to disable.

Create `eco-eats-frontend\.env` from `eco-eats-frontend\.env.example`:

```env
VITE_API_BASE_URL=http://localhost:5000/api
```

## Run

Fast local mode, including an in-memory MongoDB and seeded demo data:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-local.ps1
```

Open the Vite URL printed in `eco-eats-frontend\local-frontend.log`.

You can also run the two apps manually.

Start the backend:

```powershell
cd eco-eats-backend
..\.tools\node-v22.13.1-win-x64\node.exe .\scripts\startFullLocal.js
```

Start the frontend:

```powershell
cd eco-eats-frontend
..\.tools\node-v22.13.1-win-x64\node.exe .\node_modules\vite\bin\vite.js --host 127.0.0.1
```

Open the Vite URL, usually `http://localhost:5173`.

The hardware simulator is available at:

```text
http://localhost:5173/freshness-lab
```

If port `5173` is already in use, Vite will print the alternate port in `eco-eats-frontend\local-frontend.log`.

## Verify

```powershell
cd eco-eats-backend
..\.tools\node-v22.13.1-win-x64\node.exe --test

cd ..\eco-eats-frontend
..\.tools\node-v22.13.1-win-x64\node.exe .\node_modules\eslint\bin\eslint.js .
..\.tools\node-v22.13.1-win-x64\node.exe .\node_modules\vite\bin\vite.js build
```

Health check:

```text
GET http://localhost:5000/api/health
```

Google Sheets telemetry sync:

```text
GET  http://localhost:5000/api/iot/sheets/status
POST http://localhost:5000/api/iot/sheets/import
Header: x-sync-token: SHEETS_SYNC_TOKEN
```
