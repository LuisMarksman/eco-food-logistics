const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateDistanceMeters,
    fallbackRoute,
    normalizeCoordinates
} = require('../services/locationService');

test('normalizeCoordinates accepts lat/lng and lat/lon shapes', () => {
    assert.deepEqual(normalizeCoordinates({ lat: '12.9', lng: '77.5' }), { lat: 12.9, lng: 77.5 });
    assert.deepEqual(normalizeCoordinates({ latitude: 12.9, longitude: 77.5 }), { lat: 12.9, lng: 77.5 });
});

test('calculateDistanceMeters returns a sensible non-zero distance', () => {
    const meters = calculateDistanceMeters(
        { lat: 12.9716, lng: 77.5946 },
        { lat: 12.9352, lng: 77.6245 }
    );

    assert.ok(meters > 4000);
    assert.ok(meters < 7000);
});

test('fallbackRoute returns drawable GeoJSON', () => {
    const route = fallbackRoute(
        { lat: 12.9716, lng: 77.5946 },
        { lat: 12.9352, lng: 77.6245 },
        'test fallback'
    );

    assert.equal(route.fallback, true);
    assert.equal(route.geometry.type, 'LineString');
    assert.equal(route.geometry.coordinates.length, 2);
    assert.ok(route.durationSeconds > 0);
});
