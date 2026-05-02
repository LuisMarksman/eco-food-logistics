const test = require('node:test');
const assert = require('node:assert/strict');
const { TelemetryError } = require('../services/telemetryService');
const {
    importSheetTelemetryValues,
    parseCsv,
    parseRangeStartRow,
    parseSheetRows
} = require('../services/sheetsTelemetryService');

function createFakeImportModel() {
    const saved = new Map();

    class FakeImport {
        constructor(doc) {
            Object.assign(this, doc);
        }

        async save() {
            saved.set(this.importKey, this);
            return this;
        }

        static async findOne(query) {
            return saved.get(query.importKey) || null;
        }
    }

    FakeImport.saved = saved;
    return FakeImport;
}

test('parseRangeStartRow reads the first telemetry data row from A1 notation', () => {
    assert.equal(parseRangeStartRow('Telemetry!A2:H'), 2);
    assert.equal(parseRangeStartRow('A7:H'), 7);
});

test('parseSheetRows maps telemetry columns and validates required sensor values', () => {
    const rows = parseSheetRows([
        ['read-1', '2026-05-01T10:00:00.000Z', 'device-1', '', '4', '60', '20', 'sensor'],
        ['read-2', 'not-a-date', '', '', '', '60', '20', 'sensor']
    ], {
        spreadsheetId: 'sheet-1',
        range: 'Telemetry!A2:H'
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0].rowNumber, 2);
    assert.equal(rows[0].deviceId, 'device-1');
    assert.equal(rows[0].temperatureC, 4);
    assert.equal(rows[0].importKey, 'reading:sheet-1:read-1');
    assert.ok(rows[1].errors.includes('foodItemId or deviceId is required.'));
    assert.ok(rows[1].errors.includes('observedAt must be a valid date.'));
    assert.ok(rows[1].errors.includes('temperatureC is required.'));
});

test('parseSheetRows maps live MQ sensor CSV headers with a default device ID', () => {
    const rows = parseSheetRows(parseCsv([
        'Time,MQ2,MQ3,MQ135,Temperature,Humidity',
        '5/1/2026 23:07:06,0,638,0,30.7,85.5',
        '5/1/2026 23:08:37,0,691,31,nan,nan'
    ].join('\n')), {
        spreadsheetId: 'sheet-1',
        range: 'gid:0',
        hasHeader: true,
        defaultDeviceId: 'eco-device-001'
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0].rowNumber, 2);
    assert.equal(rows[0].deviceId, 'eco-device-001');
    assert.equal(rows[0].temperatureC, 30.7);
    assert.equal(rows[0].humidityPct, 85.5);
    assert.equal(rows[0].gasLevel, 0);
    assert.equal(rows[0].mq2, 0);
    assert.equal(rows[0].mq3, 638);
    assert.equal(rows[0].mq135, 0);
    assert.ok(rows[1].errors.includes('temperatureC is required.'));
    assert.ok(rows[1].errors.includes('humidityPct is required.'));
});

test('parseSheetRows accepts the misspelled teperature header from device sheets', () => {
    const rows = parseSheetRows(parseCsv([
        'time,mq2,mq3,mq135,teperature,humidity',
        '5/1/2026 23:07:06,12,34,56,29.4,71'
    ].join('\n')), {
        spreadsheetId: 'sheet-1',
        range: 'gid:0',
        hasHeader: true,
        defaultDeviceId: 'eco-device-001'
    });

    assert.equal(rows[0].temperatureC, 29.4);
    assert.equal(rows[0].humidityPct, 71);
    assert.equal(rows[0].gasLevel, 56);
});

test('parseSheetRows falls back to mq3 when mq135 is missing in live sheet data', () => {
    const rows = parseSheetRows(parseCsv([
        'time,mq2,mq3,temperature,humidity',
        '5/1/2026 23:07:06,12,34,29.4,71'
    ].join('\n')), {
        spreadsheetId: 'sheet-1',
        range: 'gid:0',
        hasHeader: true,
        defaultDeviceId: 'eco-device-001'
    });

    assert.equal(rows[0].gasLevel, 34);
    assert.equal(rows[0].mq3, 34);
});

test('importSheetTelemetryValues imports new rows and skips duplicates idempotently', async () => {
    const ImportModel = createFakeImportModel();
    let attachCount = 0;
    const attachTelemetryFn = async () => {
        attachCount += 1;
        return {
            foodItem: { _id: '507f1f77bcf86cd799439011' },
            freshness: { state: 'good', score: 82 }
        };
    };
    const values = [
        ['read-1', '2026-05-01T10:00:00.000Z', 'device-1', '', '4', '60', '20', 'sensor']
    ];

    const first = await importSheetTelemetryValues(values, {
        spreadsheetId: 'sheet-1',
        range: 'Telemetry!A2:H',
        ImportModel,
        attachTelemetryFn
    });
    const second = await importSheetTelemetryValues(values, {
        spreadsheetId: 'sheet-1',
        range: 'Telemetry!A2:H',
        ImportModel,
        attachTelemetryFn
    });

    assert.equal(first.processed, 1);
    assert.equal(second.duplicate, 1);
    assert.equal(attachCount, 1);
    assert.equal(ImportModel.saved.size, 1);
});

test('importSheetTelemetryValues records invalid and unmatched rows without crashing', async () => {
    const ImportModel = createFakeImportModel();
    const values = [
        ['bad-1', '2026-05-01T10:00:00.000Z', '', '', '4', '60', '20', 'sensor'],
        ['missing-food', '2026-05-01T10:05:00.000Z', 'device-x', '', '4', '60', '20', 'sensor']
    ];

    const summary = await importSheetTelemetryValues(values, {
        spreadsheetId: 'sheet-1',
        range: 'Telemetry!A2:H',
        ImportModel,
        attachTelemetryFn: async () => {
            throw new TelemetryError('No active food item found for this telemetry.', 404);
        }
    });

    assert.equal(summary.failed, 1);
    assert.equal(summary.unmatched, 1);
    assert.equal(ImportModel.saved.size, 2);
});
