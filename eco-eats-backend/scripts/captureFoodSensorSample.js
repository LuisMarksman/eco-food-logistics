const path = require('node:path');
const {
    appendDatasetRows,
    cleanValue,
    parseCsv,
    readDataset,
    toNumber,
    writeDatasetRows
} = require('./foodSensorDataset');

const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1qCRE33JypGTtCES4XPTxXhwij1KI5cxqJ9jlQcwfKtE/export?format=csv&gid=0';
const DEFAULT_OUT = path.join(__dirname, '..', 'data', 'food_sensor_samples.csv');

function parseArgs(argv = process.argv.slice(2)) {
    const args = {};

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;

        const key = token.slice(2);
        const next = argv[index + 1];

        if (!next || next.startsWith('--')) {
            args[key] = true;
        } else {
            args[key] = next;
            index += 1;
        }
    }

    return args;
}

function usage() {
    return [
        'Usage:',
        '  npm run capture:sample -- --label empty_baseline --state empty --food-form empty --food-name empty_container --last 60',
        '  npm run capture:sample -- --label rotten_pomegranate --state rotten --food-form raw --food-name pomegranate --minutes 8',
        '  npm run capture:sample -- --label rotten_cooked_rice --state rotten --food-form cooked --food-name rice --minutes 8',
        '',
        'Options:',
        '  --label       Required sample label.',
        '  --state       empty, fresh, good, rotten, or unsafe. Defaults to unknown.',
        '  --food-form   empty, raw, cooked, or packaged. Defaults to unknown.',
        '  --food-name   Human readable sample name.',
        '  --last        Capture the latest N valid sensor rows. Defaults to 60.',
        '  --minutes     Capture rows from the last N minutes relative to the newest sheet row.',
        '  --since       Capture rows at or after a timestamp parseable by JavaScript Date.',
        '  --until       Capture rows at or before a timestamp parseable by JavaScript Date.',
        '  --replace-label  Remove existing rows for this label before appending the new capture.',
        '  --note        Optional note stored with every captured row.',
        '  --url         Public CSV URL. Defaults to the live project sheet.',
        '  --out         Dataset path. Defaults to eco-eats-backend/data/food_sensor_samples.csv.'
    ].join('\n');
}

function headerIndexMap(header = []) {
    return new Map(header.map((value, index) => [cleanValue(value).toLowerCase().replace(/[^a-z0-9]/g, ''), index]));
}

function valueAt(row, headerMap, names) {
    for (const name of names) {
        const index = headerMap.get(name.toLowerCase().replace(/[^a-z0-9]/g, ''));
        if (index !== undefined) return row[index];
    }

    return '';
}

function normalizeGasIndex(value) {
    const gas = toNumber(value);
    if (gas === null) return null;
    if (gas <= 100) return Math.min(100, Math.max(0, gas));
    return Math.min(100, Math.max(0, (gas / 1000) * 100));
}

function normalizeSheetRows(csvText) {
    const rows = parseCsv(csvText);
    const [header = [], ...dataRows] = rows;
    const headerMap = headerIndexMap(header);

    return dataRows.map((row, index) => {
        const mq2 = toNumber(valueAt(row, headerMap, ['mq2']));
        const mq3 = toNumber(valueAt(row, headerMap, ['mq3']));
        const mq135 = toNumber(valueAt(row, headerMap, ['mq135']));
        const temperatureC = toNumber(valueAt(row, headerMap, ['temperature', 'temperatureC', 'teperature', 'temp']));
        const humidityPct = toNumber(valueAt(row, headerMap, ['humidity', 'humidityPct', 'hum']));
        const gasValues = [mq2, mq3, mq135].map(normalizeGasIndex).filter((value) => value !== null);

        return {
            sourceRow: index + 2,
            time: cleanValue(valueAt(row, headerMap, ['time', 'timestamp', 'observedAt', 'readingAt'])),
            mq2,
            mq3,
            mq135,
            temperatureC,
            humidityPct,
            gasIndex: gasValues.length ? Math.max(...gasValues) : null
        };
    }).filter((row) => (
        row.time
        && row.temperatureC !== null
        && row.humidityPct !== null
        && (row.mq2 !== null || row.mq3 !== null || row.mq135 !== null)
    ));
}

function parseSheetDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function selectRows(rows, args) {
    if (args.since || args.until) {
        const since = parseSheetDate(args.since);
        const until = parseSheetDate(args.until);
        if (args.since && !since) throw new Error(`Could not parse --since timestamp: ${args.since}`);
        if (args.until && !until) throw new Error(`Could not parse --until timestamp: ${args.until}`);
        return rows.filter((row) => {
            const date = parseSheetDate(row.time);
            return date && (!since || date >= since) && (!until || date <= until);
        });
    }

    if (args.minutes) {
        const minutes = Number(args.minutes);
        if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('--minutes must be a positive number.');

        const datedRows = rows.map((row) => ({ ...row, parsedTime: parseSheetDate(row.time) })).filter((row) => row.parsedTime);
        const latest = datedRows.reduce((max, row) => row.parsedTime > max ? row.parsedTime : max, datedRows[0]?.parsedTime);
        if (!latest) return [];
        const cutoff = new Date(latest.getTime() - minutes * 60 * 1000);
        return datedRows.filter((row) => row.parsedTime >= cutoff).map(({ parsedTime, ...row }) => row);
    }

    const last = Number(args.last || 60);
    if (!Number.isFinite(last) || last <= 0) throw new Error('--last must be a positive number.');
    return rows.slice(-last);
}

function dedupeRows(existingRows, candidateRows) {
    const existingKeys = new Set(existingRows.map((row) => [
        row.label,
        row.sourceRow,
        row.time,
        row.mq2,
        row.mq3,
        row.mq135,
        row.temperatureC,
        row.humidityPct
    ].join('|')));

    return candidateRows.filter((row) => {
        const key = [
            row.label,
            row.sourceRow,
            row.time,
            row.mq2,
            row.mq3,
            row.mq135,
            row.temperatureC,
            row.humidityPct
        ].join('|');

        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
    });
}

async function main() {
    const args = parseArgs();
    const label = cleanValue(args.label);

    if (!label || args.help) {
        console.log(usage());
        process.exit(label ? 0 : 1);
    }

    const response = await fetch(args.url || DEFAULT_SHEET_URL);
    if (!response.ok) throw new Error(`Google Sheet CSV fetch failed with status ${response.status}`);

    const rows = normalizeSheetRows(await response.text());
    const selectedRows = selectRows(rows, args);
    const capturedAt = new Date().toISOString();
    const datasetRows = selectedRows.map((row) => ({
        capturedAt,
        label,
        state: cleanValue(args.state) || 'unknown',
        foodForm: cleanValue(args['food-form']) || cleanValue(args.foodForm) || 'unknown',
        foodName: cleanValue(args['food-name']) || cleanValue(args.foodName) || label,
        sampleNote: cleanValue(args.note),
        sourceRow: row.sourceRow,
        time: row.time,
        mq2: row.mq2 ?? '',
        mq3: row.mq3 ?? '',
        mq135: row.mq135 ?? '',
        temperatureC: row.temperatureC ?? '',
        humidityPct: row.humidityPct ?? '',
        gasIndex: row.gasIndex ?? ''
    }));
    const outPath = path.resolve(args.out || DEFAULT_OUT);
    const existingRows = readDataset(outPath);
    const retainedRows = args['replace-label']
        ? existingRows.filter((row) => cleanValue(row.label) !== label)
        : existingRows;
    const newRows = dedupeRows(retainedRows, datasetRows);

    if (!args['dry-run']) {
        if (args['replace-label']) {
            writeDatasetRows(outPath, retainedRows);
        }

        appendDatasetRows(outPath, newRows);
    }

    console.log(JSON.stringify({
        dataset: outPath,
        fetchedRows: rows.length,
        selectedRows: selectedRows.length,
        appendedRows: args['dry-run'] ? 0 : newRows.length,
        replacedRows: args['replace-label'] ? existingRows.length - retainedRows.length : 0,
        skippedDuplicates: datasetRows.length - newRows.length,
        firstReadingAt: selectedRows[0]?.time || null,
        lastReadingAt: selectedRows.at(-1)?.time || null,
        label,
        state: cleanValue(args.state) || 'unknown',
        foodForm: cleanValue(args['food-form']) || cleanValue(args.foodForm) || 'unknown'
    }, null, 2));
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
