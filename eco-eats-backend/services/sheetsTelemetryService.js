const SheetTelemetryImport = require('../models/SheetTelemetryImport');
const { TelemetryError, attachTelemetryToFood } = require('./telemetryService');

const DEFAULT_SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1qCRE33JypGTtCES4XPTxXhwij1KI5cxqJ9jlQcwfKtE/edit?usp=sharing';
const DEFAULT_RANGE = 'Telemetry!A2:H';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
let lastImportSummary = null;
let pollingTimer = null;
let importInProgress = false;

function cleanValue(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function toNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') return defaultValue;
    return value === true || ['true', '1', 'yes'].includes(String(value).toLowerCase());
}

function extractSpreadsheetId(value = '') {
    const cleaned = cleanValue(value);
    const match = cleaned.match(/\/spreadsheets\/d\/([^/]+)/);
    return match ? match[1] : cleaned;
}

function normalizeHeader(value = '') {
    return cleanValue(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findHeaderValue(row, headerMap, names) {
    for (const name of names) {
        const index = headerMap.get(normalizeHeader(name));
        if (index !== undefined) return row[index];
    }

    return undefined;
}

function gasLevelFromHeaderRow(row, headerMap) {
    const direct = findHeaderValue(row, headerMap, ['gasLevel', 'gas', 'gasIndex']);
    if (direct !== undefined && direct !== '') return toNumber(direct);

    const mqValues = Array.from(headerMap.entries())
        .filter(([name]) => /^mq\d+$/.test(name))
        .map(([, index]) => toNumber(row[index]))
        .filter((value) => value !== null);

    if (mqValues.length === 0) return null;
    return Math.max(...mqValues);
}

function mqReadingsFromHeaderRow(row, headerMap) {
    return {
        mq2: toNumber(findHeaderValue(row, headerMap, ['mq2'])),
        mq3: toNumber(findHeaderValue(row, headerMap, ['mq3'])),
        mq135: toNumber(findHeaderValue(row, headerMap, ['mq135']))
    };
}

function looksLikeHeader(row = []) {
    const normalized = row.map(normalizeHeader);
    return normalized.includes('time')
        || normalized.includes('temperature')
        || normalized.includes('humidity')
        || normalized.some((header) => /^mq\d+$/.test(header));
}

function buildPublicCsvUrl(config) {
    if (config.publicCsvUrl) return config.publicCsvUrl;
    if (!config.spreadsheetId) return '';

    const gid = config.publicGid || '0';
    return `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/export?format=csv&gid=${gid}`;
}

function parseCsv(text = '') {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                field += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            row.push(field);
            field = '';
        } else if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') index += 1;
            row.push(field);
            if (row.some((value) => cleanValue(value))) rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }

    row.push(field);
    if (row.some((value) => cleanValue(value))) rows.push(row);

    return rows;
}

function normalizePrivateKey(value = '') {
    return value.replace(/^"|"$/g, '').replace(/\\n/g, '\n');
}

function getSheetsConfig(env = process.env) {
    const sheetSource = env.GOOGLE_SHEETS_SPREADSHEET_ID || env.GOOGLE_SHEETS_URL || DEFAULT_SPREADSHEET_URL;
    const spreadsheetId = extractSpreadsheetId(sheetSource);
    const serviceAccountEmail = cleanValue(env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
    const privateKey = cleanValue(env.GOOGLE_PRIVATE_KEY);
    const range = cleanValue(env.GOOGLE_SHEETS_TELEMETRY_RANGE) || DEFAULT_RANGE;
    const publicCsvUrl = cleanValue(env.GOOGLE_SHEETS_PUBLIC_CSV_URL);
    const publicGid = cleanValue(env.GOOGLE_SHEETS_PUBLIC_GID || env.GOOGLE_SHEETS_GID || '0');
    const defaultDeviceId = cleanValue(env.GOOGLE_SHEETS_DEFAULT_DEVICE_ID);
    const usingDefaultLiveSheet = !env.GOOGLE_SHEETS_SPREADSHEET_ID && !env.GOOGLE_SHEETS_URL && !publicCsvUrl;
    const hasHeader = parseBoolean(env.GOOGLE_SHEETS_HAS_HEADER, Boolean(publicCsvUrl || env.GOOGLE_SHEETS_URL || usingDefaultLiveSheet));
    const syncTokenConfigured = Boolean(cleanValue(env.SHEETS_SYNC_TOKEN));
    const pollIntervalMs = Number(env.SHEETS_POLL_INTERVAL_MS || 0);
    const importMaxRows = Number(env.GOOGLE_SHEETS_IMPORT_MAX_ROWS || 150);
    const serviceAccountReady = Boolean(spreadsheetId && serviceAccountEmail && privateKey);
    const publicCsvReady = Boolean(publicCsvUrl || spreadsheetId);
    const missing = [];

    if (!spreadsheetId && !publicCsvUrl) missing.push('GOOGLE_SHEETS_SPREADSHEET_ID or GOOGLE_SHEETS_PUBLIC_CSV_URL');
    if (!serviceAccountReady && !publicCsvReady) missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY');

    return {
        spreadsheetId,
        serviceAccountEmail,
        privateKey,
        range,
        publicCsvUrl,
        publicGid,
        defaultDeviceId,
        hasHeader,
        importMaxRows: Number.isFinite(importMaxRows) && importMaxRows > 0 ? importMaxRows : 150,
        syncTokenConfigured,
        pollIntervalMs: Number.isFinite(pollIntervalMs) ? pollIntervalMs : 0,
        serviceAccountReady,
        publicCsvReady,
        mode: serviceAccountReady ? 'service-account' : 'public-csv',
        ready: missing.length === 0 && (serviceAccountReady || publicCsvReady),
        missing
    };
}

function parseRangeStartRow(range = DEFAULT_RANGE) {
    const match = range.match(/![A-Z]+(\d+)/i) || range.match(/[A-Z]+(\d+)/i);
    return match ? Number.parseInt(match[1], 10) : 1;
}

function buildImportKey({ spreadsheetId, range, rowNumber, readingId }) {
    const id = cleanValue(readingId);
    if (id) return `reading:${spreadsheetId}:${id}`;
    return `row:${spreadsheetId}:${range}:${rowNumber}`;
}

function parseSheetRow(row = [], meta = {}) {
    const [
        readingId,
        observedAt,
        deviceId,
        foodItemId,
        temperatureC,
        humidityPct,
        gasLevel,
        source
    ] = row;
    const observedDate = new Date(cleanValue(observedAt));
    const payload = {
        readingId: cleanValue(readingId),
        observedAt: observedDate,
        readingAt: observedDate,
        deviceId: cleanValue(deviceId),
        foodItemId: cleanValue(foodItemId),
        temperatureC: toNumber(temperatureC),
        humidityPct: toNumber(humidityPct),
        gasLevel: toNumber(gasLevel),
        source: cleanValue(source) || 'google-sheets'
    };
    const errors = [];

    if (!payload.foodItemId && !payload.deviceId) {
        errors.push('foodItemId or deviceId is required.');
    }

    if (!cleanValue(observedAt) || Number.isNaN(observedDate.getTime())) {
        errors.push('observedAt must be a valid date.');
    }

    if (payload.temperatureC === null) errors.push('temperatureC is required.');
    if (payload.humidityPct === null) errors.push('humidityPct is required.');
    if (payload.gasLevel === null) errors.push('gasLevel is required.');

    return {
        ...payload,
        observedAt: Number.isNaN(observedDate.getTime()) ? null : observedDate,
        readingAt: Number.isNaN(observedDate.getTime()) ? null : observedDate,
        rowNumber: meta.rowNumber,
        importKey: buildImportKey({
            spreadsheetId: meta.spreadsheetId,
            range: meta.range,
            rowNumber: meta.rowNumber,
            readingId: payload.readingId
        }),
        rawRow: row.map(cleanValue),
        errors
    };
}

function parseHeaderSheetRow(row = [], meta = {}) {
    const headerMap = meta.headerMap || new Map();
    const readingId = cleanValue(findHeaderValue(row, headerMap, ['readingId', 'reading_id', 'id']));
    const observedAt = findHeaderValue(row, headerMap, ['observedAt', 'readingAt', 'timestamp', 'dateTime', 'time']);
    const deviceId = cleanValue(findHeaderValue(row, headerMap, ['deviceId', 'device_id']) || meta.defaultDeviceId);
    const foodItemId = cleanValue(findHeaderValue(row, headerMap, ['foodItemId', 'food_item_id', 'foodId']));
    const temperatureC = toNumber(findHeaderValue(row, headerMap, ['temperatureC', 'temperature', 'teperature', 'tempC', 'temp']));
    const humidityPct = toNumber(findHeaderValue(row, headerMap, ['humidityPct', 'humidity', 'hum']));
    const gasLevel = gasLevelFromHeaderRow(row, headerMap);
    const mqReadings = mqReadingsFromHeaderRow(row, headerMap);
    const source = cleanValue(findHeaderValue(row, headerMap, ['source'])) || 'google-sheets';

    const parsed = parseSheetRow([
        readingId,
        observedAt,
        deviceId,
        foodItemId,
        temperatureC,
        humidityPct,
        gasLevel,
        source
    ], meta);

    return {
        ...parsed,
        ...mqReadings
    };
}

function parseSheetRows(values = [], options = {}) {
    const range = options.range || DEFAULT_RANGE;
    const spreadsheetId = options.spreadsheetId || 'unknown';
    const hasHeader = options.hasHeader || looksLikeHeader(values[0]);
    const header = hasHeader ? values[0] || [] : [];
    const headerMap = new Map(header.map((value, index) => [normalizeHeader(value), index]));
    let dataRows = hasHeader ? values.slice(1) : values;
    let startRow = options.startRow || (parseRangeStartRow(range) + (hasHeader ? 1 : 0));
    const maxRows = Number(options.maxRows || 0);

    if (Number.isFinite(maxRows) && maxRows > 0 && dataRows.length > maxRows) {
        startRow += dataRows.length - maxRows;
        dataRows = dataRows.slice(-maxRows);
    }

    return dataRows
        .map((row, index) => (hasHeader ? parseHeaderSheetRow(row, {
            spreadsheetId,
            range,
            rowNumber: startRow + index,
            headerMap,
            defaultDeviceId: options.defaultDeviceId
        }) : parseSheetRow(row, {
            spreadsheetId,
            range,
            rowNumber: startRow + index
        })))
        .filter((row) => row.rawRow.some(Boolean));
}

function statusBucket(status) {
    if (status === 'processed') return 'processed';
    if (status === 'unsafe') return 'unsafe';
    if (status === 'duplicate') return 'duplicate';
    if (status === 'unmatched') return 'unmatched';
    if (status === 'skipped') return 'skipped';
    return 'failed';
}

function rowResult(row, status, message, extra = {}) {
    return {
        rowNumber: row.rowNumber,
        readingId: row.readingId || null,
        deviceId: row.deviceId || null,
        foodItemId: row.foodItemId || null,
        status,
        message,
        ...extra
    };
}

async function saveAudit(ImportModel, row, status, message, extra = {}) {
    const auditDoc = {
        importKey: row.importKey,
        spreadsheetId: extra.spreadsheetId,
        range: extra.range,
        rowNumber: row.rowNumber,
        readingId: row.readingId,
        foodItem: extra.foodItemId || null,
        deviceId: row.deviceId,
        observedAt: row.observedAt,
        status,
        message,
        freshnessState: extra.freshnessState || '',
        freshnessScore: extra.freshnessScore,
        rawRow: row.rawRow,
        processedAt: extra.now || new Date()
    };

    if (typeof ImportModel.findOneAndUpdate === 'function') {
        return ImportModel.findOneAndUpdate(
            { importKey: row.importKey },
            { $set: auditDoc },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    }

    const audit = new ImportModel(auditDoc);

    try {
        await audit.save();
    } catch (err) {
        if (err.code === 11000) return null;
        throw err;
    }

    return audit;
}

async function importSheetTelemetryValues(values = [], options = {}) {
    const ImportModel = options.ImportModel || SheetTelemetryImport;
    const attachFn = options.attachTelemetryFn || attachTelemetryToFood;
    const spreadsheetId = options.spreadsheetId || getSheetsConfig().spreadsheetId;
    const range = options.range || getSheetsConfig().range;
    const now = options.now || new Date();
    const rows = parseSheetRows(values, {
        spreadsheetId,
        range,
        hasHeader: options.hasHeader,
        defaultDeviceId: options.defaultDeviceId,
        maxRows: options.maxRows
    });
    const stats = {
        scanned: rows.length,
        processed: 0,
        unsafe: 0,
        duplicate: 0,
        unmatched: 0,
        failed: 0,
        skipped: 0,
        importedAt: now,
        rows: []
    };

    for (const row of rows) {
        const existing = await ImportModel.findOne({ importKey: row.importKey });

        if (existing && ['processed', 'unsafe'].includes(existing.status)) {
            stats.duplicate += 1;
            stats.rows.push(rowResult(row, 'duplicate', 'Telemetry row was already imported.'));
            continue;
        }

        if (row.errors.length > 0) {
            const message = row.errors.join(' ');
            await saveAudit(ImportModel, row, 'failed', message, { spreadsheetId, range, now });
            stats.failed += 1;
            stats.rows.push(rowResult(row, 'failed', message));
            continue;
        }

        try {
            const result = await attachFn({
                foodItemId: row.foodItemId || undefined,
                deviceId: row.deviceId || undefined,
                temperatureC: row.temperatureC,
                humidityPct: row.humidityPct,
                gasLevel: row.gasLevel,
                mq2: row.mq2,
                mq3: row.mq3,
                mq135: row.mq135,
                readingAt: row.observedAt,
                source: row.source
            }, { now });
            const freshness = result.freshness || {};
            const unsafe = freshness.state === 'unsafe';
            const status = unsafe ? 'unsafe' : 'processed';
            const message = unsafe
                ? 'Telemetry imported; freshness state is unsafe.'
                : 'Telemetry imported and attached to food item.';
            const foodId = result.foodItem?._id || result.foodItem?.id || row.foodItemId || null;

            await saveAudit(ImportModel, row, status, message, {
                spreadsheetId,
                range,
                now,
                foodItemId: foodId,
                freshnessState: freshness.state,
                freshnessScore: freshness.score
            });

            stats[statusBucket(status)] += 1;
            stats.rows.push(rowResult(row, status, message, {
                foodItemId: foodId ? String(foodId) : null,
                freshnessState: freshness.state || null,
                freshnessScore: freshness.score ?? null
            }));
        } catch (err) {
            const unmatched = err instanceof TelemetryError && err.statusCode === 404;
            const status = unmatched ? 'unmatched' : 'failed';
            const message = err.message || 'Telemetry import failed.';

            await saveAudit(ImportModel, row, status, message, { spreadsheetId, range, now });
            stats[statusBucket(status)] += 1;
            stats.rows.push(rowResult(row, status, message));
        }
    }

    lastImportSummary = {
        ...stats,
        rows: stats.rows.slice(-25)
    };
    return lastImportSummary;
}

function loadGoogleApis() {
    try {
        return require('googleapis').google;
    } catch (err) {
        throw new Error('The googleapis package is required for Google Sheets import. Run npm install in the backend.');
    }
}

async function readSheetValues(config = getSheetsConfig()) {
    if (!config.ready) {
        throw new Error(`Google Sheets is not configured. Missing: ${config.missing.join(', ')}`);
    }

    if (!config.serviceAccountReady) {
        const response = await fetch(buildPublicCsvUrl(config));

        if (!response.ok) {
            throw new Error(`Public Google Sheets CSV fetch failed with status ${response.status}`);
        }

        return parseCsv(await response.text());
    }

    const google = loadGoogleApis();
    const auth = new google.auth.JWT({
        email: config.serviceAccountEmail,
        key: normalizePrivateKey(config.privateKey),
        scopes: SCOPES
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: config.spreadsheetId,
        range: config.range
    });

    return response.data.values || [];
}

async function importTelemetryFromSheets(options = {}) {
    if (importInProgress && !options.ignoreLock) {
        return {
            scanned: 0,
            processed: 0,
            unsafe: 0,
            duplicate: 0,
            unmatched: 0,
            failed: 0,
            skipped: 1,
            busy: true,
            message: 'Google Sheets telemetry import is already running.',
            importedAt: new Date(),
            rows: []
        };
    }

    importInProgress = true;
    const config = getSheetsConfig(options.env || process.env);

    try {
        const values = options.values || await readSheetValues(config);

        return await importSheetTelemetryValues(values, {
            spreadsheetId: config.spreadsheetId,
            range: config.range,
            hasHeader: config.hasHeader,
            defaultDeviceId: config.defaultDeviceId,
            maxRows: config.importMaxRows,
            now: options.now,
            ImportModel: options.ImportModel,
            attachTelemetryFn: options.attachTelemetryFn
        });
    } finally {
        importInProgress = false;
    }
}

function getSheetsStatus() {
    const config = getSheetsConfig();

    return {
        configured: config.ready,
        missing: config.missing,
        spreadsheetId: config.spreadsheetId || null,
        range: config.range,
        mode: config.mode,
        publicGid: config.publicGid,
        defaultDeviceId: config.defaultDeviceId || null,
        hasHeader: config.hasHeader,
        importMaxRows: config.importMaxRows,
        syncTokenConfigured: config.syncTokenConfigured,
        pollIntervalMs: config.pollIntervalMs,
        pollingActive: Boolean(pollingTimer),
        lastImport: lastImportSummary
    };
}

function startSheetsTelemetryPolling() {
    const config = getSheetsConfig();

    if (!config.ready || config.pollIntervalMs <= 0 || pollingTimer) {
        return null;
    }

    pollingTimer = setInterval(() => {
        importTelemetryFromSheets()
            .catch((err) => console.error('Google Sheets telemetry import failed:', err.message));
    }, config.pollIntervalMs);
    pollingTimer.unref?.();
    return pollingTimer;
}

function stopSheetsTelemetryPolling() {
    if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
    }
}

module.exports = {
    DEFAULT_RANGE,
    DEFAULT_SPREADSHEET_URL,
    buildImportKey,
    getSheetsConfig,
    getSheetsStatus,
    importSheetTelemetryValues,
    importTelemetryFromSheets,
    parseCsv,
    normalizePrivateKey,
    parseRangeStartRow,
    parseSheetRow,
    parseSheetRows,
    readSheetValues,
    startSheetsTelemetryPolling,
    stopSheetsTelemetryPolling
};
