const test = require('node:test');
const assert = require('node:assert/strict');
const foodRouter = require('../routes/food');

test('sanitizeRouteSummary preserves pickup and dropoff coordinates for claimed routes', () => {
    const summary = foodRouter._test.sanitizeRouteSummary({
        provider: 'osrm',
        fallback: false,
        distanceMeters: 4200,
        durationSeconds: 900,
        expiry: { riskLevel: 'ok', effectiveExpiryDate: new Date('2026-05-01T12:00:00.000Z') },
        freshness: { state: 'good', score: 88 },
        pickup: {
            address: 'MG Road, Bengaluru',
            coordinates: { lat: 12.975, lng: 77.605 }
        },
        dropoff: {
            address: 'Indiranagar, Bengaluru',
            displayName: 'Indiranagar receiver',
            coordinates: { lat: 12.978, lng: 77.64 }
        },
        geometry: {
            type: 'LineString',
            coordinates: [[77.605, 12.975], [77.64, 12.978]]
        }
    });

    assert.equal(summary.provider, 'osrm');
    assert.equal(summary.pickup.address, 'MG Road, Bengaluru');
    assert.deepEqual(summary.pickup.coordinates, { lat: 12.975, lng: 77.605 });
    assert.equal(summary.dropoff.displayName, 'Indiranagar receiver');
    assert.deepEqual(summary.dropoff.coordinates, { lat: 12.978, lng: 77.64 });
    assert.equal(summary.geometry.type, 'LineString');
});
