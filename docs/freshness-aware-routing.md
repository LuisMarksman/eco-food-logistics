# Freshness-Aware Routing

Eco Eats now treats hardware freshness as an allocation signal. The device sends temperature,
humidity, and gas readings. The backend converts those readings into a freshness score, a safety
state, and an effective delivery deadline. Route feasibility and match ranking use that effective
deadline instead of only the donor's static expiry time.

## Hardware Telemetry

Send telemetry to:

```text
POST /api/iot/telemetry
```

Example payload:

```json
{
  "foodItemId": "MONGO_FOOD_ITEM_ID",
  "deviceId": "eco-device-001",
  "temperatureC": 7.4,
  "humidityPct": 62,
  "gasLevel": 28,
  "readingAt": "2026-05-01T10:30:00.000Z"
}
```

Use either `foodItemId` or a `deviceId` linked to an active food listing. If `IOT_DEVICE_TOKEN`
is set in backend `.env`, include it as:

```text
x-device-token: YOUR_TOKEN
```

## Google Sheets Queue

The IoT device can also append readings to Google Sheets. Configure the backend with a Google
service account and set `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_TELEMETRY_RANGE`,
`GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_PRIVATE_KEY`. For a public/link-shared sheet, setting
`GOOGLE_SHEETS_URL` is enough. `SHEETS_SYNC_TOKEN` is optional; when set, requests must include it.

The telemetry tab should use these columns:

```text
readingId, observedAt, deviceId, foodItemId, temperatureC, humidityPct, gasLevel, source
```

For the live hardware sheet, the importer also accepts:

```text
Time, MQ2, MQ3, MQ135, Temperature, Humidity
```

In that format, `Time` becomes the sensor timestamp, `Temperature` and `Humidity` map directly,
and the MQ columns are preserved for the spoilage model. The backend still exposes the same frontend
fields (`score`, `state`, `remainingShelfLifeMinutes`, and `effectiveExpiryDate`), but now the
remaining window can be estimated directly from live sensor stress even when the static expiry is
farther away. If the sheet does not include a `deviceId` or `foodItemId`, set
`GOOGLE_SHEETS_DEFAULT_DEVICE_ID` to a device ID linked to a food listing.

Import queued readings:

```text
POST /api/iot/sheets/import
x-sync-token: YOUR_SYNC_TOKEN
```

The importer records duplicate, invalid, unmatched, and unsafe rows in MongoDB audit history, then
updates the linked food listing with the same freshness model used by direct device telemetry.

## Freshness Preview

The simulator uses:

```text
POST /api/iot/freshness-preview
```

This endpoint does not need MongoDB. It returns:

- `score`: freshness from 0 to 100.
- `state`: `excellent`, `good`, `watch`, `critical`, `unsafe`, or `unknown`.
- `effectiveExpiryDate`: sensor-adjusted delivery deadline.
- `remainingShelfLifeMinutes`: live route window.
- `signals`: human-readable reasons behind the score.

## Demand Matching

Create demand centers:

```text
POST /api/demand-centers
```

Rank destinations for one food listing:

```text
GET /api/demand-centers/matches/:foodItemId
```

Build the dispatch queue across available listings:

```text
GET /api/demand-centers/allocations?limit=25
```

The match score considers:

- current freshness state and effective expiry;
- route duration and distance;
- meals available;
- demand urgency and meal need;
- accepted food categories;
- unsafe food exclusion.

## Demo Flow

1. Start backend and frontend.
2. Open `/freshness-lab`.
3. Move the temperature, humidity, and gas sliders.
4. Watch freshness score and delivery deadline update.
5. Attach telemetry to a real food item when MongoDB is configured.
6. Import Sheets telemetry from the Freshness Lab when the device has written rows.
7. Add demand centers, then rank best destinations for a food item or use the dispatch queue.

## Calibrating with Real Food Samples

The backend can learn local sensor signatures from the public Google Sheet. First capture the empty
container baseline, then capture each labeled food sample after the readings have stabilized.

```powershell
cd eco-eats-backend
..\.tools\node-v22.13.1-win-x64\node.exe scripts\captureFoodSensorSample.js --label empty_baseline --state empty --food-form empty --food-name empty_container --last 60
..\.tools\node-v22.13.1-win-x64\node.exe scripts\captureFoodSensorSample.js --label rotten_pomegranate --state rotten --food-form raw --food-name pomegranate --minutes 8
..\.tools\node-v22.13.1-win-x64\node.exe scripts\captureFoodSensorSample.js --label rotten_cooked_rice --state rotten --food-form cooked --food-name rice --minutes 8
..\.tools\node-v22.13.1-win-x64\node.exe scripts\trainFoodSpoilageModel.js
```

The dataset is stored at `eco-eats-backend/data/food_sensor_samples.csv`, and the trained model is
stored at `eco-eats-backend/data/food_spoilage_model.json`. Freshness responses include the matched
sample label and confidence when the calibrated model has enough data. Spoilage-time learning becomes
more reliable after adding at least one known fresh sample and one rotten sample for the same food form.
