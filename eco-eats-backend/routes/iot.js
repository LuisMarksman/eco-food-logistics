const mongoose = require('mongoose');
const router = require('express').Router();
const {
    buildFreshnessSnapshot
} = require('../services/freshnessService');
const { TelemetryError, attachTelemetryToFood } = require('../services/telemetryService');
const {
    getSheetsStatus,
    importTelemetryFromSheets,
    getSheetsConfig,
    parseSheetRows,
    readSheetValues
} = require('../services/sheetsTelemetryService');
const { classifyReading } = require('../services/calibrationModelService');

function databaseReady() {
    return mongoose.connection.readyState === 1;
}

function requireDeviceToken(req, res) {
    if (!process.env.IOT_DEVICE_TOKEN) return true;

    const token = req.get('x-device-token');
    if (token === process.env.IOT_DEVICE_TOKEN) return true;

    res.status(401).json({ message: 'Invalid IoT device token.' });
    return false;
}

function requireSyncToken(req, res) {
    if (!process.env.SHEETS_SYNC_TOKEN) {
        return true;
    }

    const token = req.get('x-sync-token');
    if (token === process.env.SHEETS_SYNC_TOKEN) return true;

    res.status(401).json({ message: 'Invalid Google Sheets sync token.' });
    return false;
}

function categoryFromPrediction(prediction) {
    if (prediction?.foodForm === 'cooked') return 'prepared-meals';
    if (prediction?.foodForm === 'raw') return 'produce';
    if (prediction?.foodForm === 'packaged') return 'packaged';
    return 'general';
}

function readingPayload(row) {
    return {
        deviceId: row.deviceId || '',
        foodItemId: row.foodItemId || '',
        temperatureC: row.temperatureC,
        humidityPct: row.humidityPct,
        gasLevel: row.gasLevel,
        mq2: row.mq2,
        mq3: row.mq3,
        mq135: row.mq135,
        readingAt: row.observedAt,
        source: row.source
    };
}

function statusFromFreshness(freshness, prediction) {
    const predictedState = prediction?.state || '';
    const isEmpty = predictedState === 'empty' || prediction?.label?.includes('empty');
    const isFresh = ['fresh', 'good', 'excellent'].includes(predictedState)
        || (!isEmpty && ['excellent', 'good'].includes(freshness.state));
    const stillEdible = !isEmpty && freshness.state !== 'unsafe';

    return {
        emptyBox: isEmpty,
        freshFood: isFresh,
        stillEdible,
        rotten: freshness.state === 'unsafe'
    };
}

function displayFreshnessForFlags(freshness, flags) {
    if (flags.emptyBox) {
        return {
            ...freshness,
            score: freshness.score,
            state: freshness.state,
            effectiveExpiryDate: null,
            remainingShelfLifeMinutes: null,
            recommendation: freshness.recommendation || 'Container matches the open-container baseline. Sensor condition is stable, but add food before routing.'
        };
    }

    if (flags.rotten) {
        return {
            ...freshness,
            score: Math.min(freshness.score ?? 100, 8),
            state: 'unsafe',
            remainingShelfLifeMinutes: 0,
            recommendation: 'Do not distribute. Sensor signature matches a rotten-food sample.'
        };
    }

    if (flags.freshFood && freshness.state === 'critical') {
        return {
            ...freshness,
            state: 'watch',
            recommendation: 'Food matches a fresh sample, but temperature and humidity still affect the route window.'
        };
    }

    return freshness;
}

function hasLiveSensorValues(row = {}) {
    return row.observedAt
        && row.temperatureC !== null
        && row.humidityPct !== null
        && (row.mq2 !== null || row.mq3 !== null || row.mq135 !== null || row.gasLevel !== null);
}

function buildDisplayFreshness(payload = {}, options = {}) {
    const freshness = buildFreshnessSnapshot(payload, options);
    const prediction = options.prediction || classifyReading(payload) || freshness.model?.calibratedPrediction || null;
    const flags = statusFromFreshness(freshness, prediction);
    const displayFreshness = displayFreshnessForFlags(freshness, flags);

    return {
        freshness,
        prediction,
        flags,
        displayFreshness
    };
}

router.post('/freshness-preview', (req, res) => {
    const { displayFreshness, prediction, flags } = buildDisplayFreshness(req.body, {
        expiryDate: req.body.expiryDate,
        category: req.body.category,
        now: req.body.now ? new Date(req.body.now) : new Date()
    });

    return res.status(200).json({
        ...displayFreshness,
        prediction,
        flags
    });
});

router.get('/live-status', async (req, res) => {
    try {
        const config = getSheetsConfig(process.env);
        const values = await readSheetValues(config);
        const rows = parseSheetRows(values, {
            spreadsheetId: config.spreadsheetId,
            range: config.range,
            hasHeader: undefined,
            defaultDeviceId: config.defaultDeviceId,
            maxRows: config.importMaxRows
        }).filter(hasLiveSensorValues);
        const latest = rows.at(-1);

        if (!latest) {
            return res.status(404).json({ message: 'No valid live sensor readings found.' });
        }

        const payload = readingPayload(latest);
        const rawPrediction = classifyReading(payload);
        const { prediction, flags, displayFreshness } = buildDisplayFreshness(payload, {
            category: req.query.category || categoryFromPrediction(rawPrediction),
            prediction: rawPrediction,
            now: new Date()
        });

        return res.status(200).json({
            observedAt: latest.observedAt,
            rowNumber: latest.rowNumber,
            reading: payload,
            freshness: displayFreshness,
            prediction: prediction || displayFreshness.model?.calibratedPrediction || null,
            flags,
            hoursUntilRotten: flags.emptyBox || flags.rotten || displayFreshness.remainingShelfLifeMinutes === null
                ? null
                : Number((displayFreshness.remainingShelfLifeMinutes / 60).toFixed(1))
        });
    } catch (err) {
        return res.status(500).json({ message: 'Failed to read live sensor status.', error: err.message });
    }
});

router.post('/telemetry', async (req, res) => {
    try {
        if (!requireDeviceToken(req, res)) return null;

        if (!databaseReady()) {
            return res.status(503).json({ message: 'Database is unavailable. Telemetry cannot be attached yet.' });
        }

        const { foodItem, freshness } = await attachTelemetryToFood(req.body);

        return res.status(200).json({
            message: 'Telemetry received.',
            foodItemId: foodItem._id,
            deviceId: foodItem.deviceId,
            freshness
        });
    } catch (err) {
        if (err instanceof TelemetryError) {
            return res.status(err.statusCode).json({ message: err.message });
        }

        return res.status(500).json({ message: 'Failed to process telemetry.', error: err.message });
    }
});

router.get('/sheets/status', (req, res) => {
    if (!requireSyncToken(req, res)) return null;

    return res.status(200).json({
        ...getSheetsStatus(),
        databaseReady: databaseReady()
    });
});

router.post('/sheets/import', async (req, res) => {
    try {
        if (!requireSyncToken(req, res)) return null;

        if (!databaseReady()) {
            return res.status(503).json({ message: 'Database is unavailable. Google Sheets telemetry cannot be imported yet.' });
        }

        const summary = await importTelemetryFromSheets();
        return res.status(200).json(summary);
    } catch (err) {
        return res.status(500).json({ message: 'Failed to import Google Sheets telemetry.', error: err.message });
    }
});

module.exports = router;
