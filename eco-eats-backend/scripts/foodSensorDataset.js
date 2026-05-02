const fs = require('node:fs');
const path = require('node:path');

const DATASET_COLUMNS = [
    'capturedAt',
    'label',
    'state',
    'foodForm',
    'foodName',
    'sampleNote',
    'sourceRow',
    'time',
    'mq2',
    'mq3',
    'mq135',
    'temperatureC',
    'humidityPct',
    'gasIndex'
];

function cleanValue(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function toNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function csvEscape(value) {
    const cleaned = cleanValue(value);
    if (/[",\n\r]/.test(cleaned)) return `"${cleaned.replace(/"/g, '""')}"`;
    return cleaned;
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

function rowsToObjects(rows = []) {
    const [header = [], ...dataRows] = rows;
    return dataRows.map((row) => Object.fromEntries(header.map((column, index) => [column, row[index] || ''])));
}

function stringifyRow(row) {
    return DATASET_COLUMNS.map((column) => csvEscape(row[column])).join(',');
}

function ensureDataset(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, `${DATASET_COLUMNS.join(',')}\n`);
    }
}

function readDataset(filePath) {
    if (!fs.existsSync(filePath)) return [];
    return rowsToObjects(parseCsv(fs.readFileSync(filePath, 'utf8')));
}

function appendDatasetRows(filePath, rows = []) {
    ensureDataset(filePath);
    if (rows.length === 0) return 0;

    const lineEnding = fs.readFileSync(filePath, 'utf8').endsWith('\n') ? '' : '\n';
    fs.appendFileSync(filePath, `${lineEnding}${rows.map(stringifyRow).join('\n')}\n`);
    return rows.length;
}

function writeDatasetRows(filePath, rows = []) {
    ensureDataset(filePath);
    fs.writeFileSync(filePath, `${DATASET_COLUMNS.join(',')}\n${rows.map(stringifyRow).join('\n')}${rows.length ? '\n' : ''}`);
    return rows.length;
}

module.exports = {
    DATASET_COLUMNS,
    appendDatasetRows,
    cleanValue,
    ensureDataset,
    parseCsv,
    readDataset,
    toNumber,
    writeDatasetRows
};
