const test = require('node:test');
const assert = require('node:assert/strict');
const {
    attachTelemetryToFood,
    buildTelemetryFoodQuery
} = require('../services/telemetryService');

test('buildTelemetryFoodQuery prefers foodItemId over deviceId', () => {
    assert.deepEqual(buildTelemetryFoodQuery({
        foodItemId: 'food-1',
        deviceId: 'device-1'
    }), { _id: 'food-1' });
});

test('buildTelemetryFoodQuery maps deviceId to active food lookup', () => {
    assert.deepEqual(buildTelemetryFoodQuery({ deviceId: 'device-1' }), {
        deviceId: 'device-1',
        $or: [{ status: 'available' }, { status: { $exists: false } }]
    });
});

test('attachTelemetryToFood updates freshness and appends normalized reading', async () => {
    const now = new Date('2026-05-01T10:00:00.000Z');
    let saved = false;
    let seenQuery = null;
    const foodItem = {
        _id: '507f1f77bcf86cd799439011',
        expiryDate: new Date('2026-05-01T18:00:00.000Z'),
        category: 'prepared-meals',
        sensorReadings: [],
        async save() {
            saved = true;
            return this;
        }
    };
    const FoodModel = {
        findOne(query) {
            seenQuery = query;
            return {
                sort: async () => foodItem
            };
        }
    };

    const result = await attachTelemetryToFood({
        foodItemId: '507f1f77bcf86cd799439011',
        deviceId: 'device-1',
        temperatureC: '4',
        humidityPct: '60',
        gasLevel: '20',
        readingAt: now
    }, {
        FoodModel,
        now
    });

    assert.deepEqual(seenQuery, { _id: '507f1f77bcf86cd799439011' });
    assert.equal(saved, true);
    assert.equal(foodItem.sensorReadings.length, 1);
    assert.equal(foodItem.sensorReadings[0].gasIndex, 20);
    assert.equal(result.freshness.state, 'excellent');
});
