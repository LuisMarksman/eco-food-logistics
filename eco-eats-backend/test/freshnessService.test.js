const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildFreshnessSnapshot,
    normalizeGasIndex,
    q10Rate,
    temperatureBand
} = require('../services/freshnessService');

test('normalizeGasIndex accepts percentage and raw ppm-style values', () => {
    assert.equal(normalizeGasIndex(42), 42);
    assert.equal(normalizeGasIndex(650), 65);
    assert.equal(normalizeGasIndex(1200), 100);
});

test('buildFreshnessSnapshot keeps healthy sensor readings shippable', () => {
    const now = new Date('2026-05-01T10:00:00.000Z');
    const expiryDate = new Date('2026-05-01T18:00:00.000Z');
    const snapshot = buildFreshnessSnapshot({
        temperatureC: 4,
        humidityPct: 58,
        gasLevel: 18,
        readingAt: now
    }, { now, expiryDate, category: 'prepared-meals' });

    assert.equal(snapshot.state, 'excellent');
    assert.ok(snapshot.score >= 85);
    assert.equal(snapshot.effectiveExpiryDate.toISOString(), expiryDate.toISOString());
    assert.equal(snapshot.model.temperatureBand, 'safe_cold');
});

test('buildFreshnessSnapshot shortens shelf life for risky sensor readings', () => {
    const now = new Date('2026-05-01T10:00:00.000Z');
    const expiryDate = new Date('2026-05-01T18:00:00.000Z');
    const snapshot = buildFreshnessSnapshot({
        temperatureC: 22,
        humidityPct: 82,
        gasLevel: 72,
        readingAt: now
    }, { now, expiryDate, category: 'prepared-meals' });

    assert.equal(snapshot.state, 'critical');
    assert.ok(snapshot.effectiveExpiryDate < expiryDate);
    assert.equal(snapshot.model.safetyCapMinutes, 120);
    assert.ok(snapshot.remainingShelfLifeMinutes <= 120);
});

test('buildFreshnessSnapshot marks very high gas readings unsafe', () => {
    const now = new Date('2026-05-01T10:00:00.000Z');
    const snapshot = buildFreshnessSnapshot({
        temperatureC: 12,
        humidityPct: 60,
        gasLevel: 95,
        readingAt: now
    }, { now, expiryDate: new Date('2026-05-01T18:00:00.000Z') });

    assert.equal(snapshot.state, 'unsafe');
    assert.equal(snapshot.remainingShelfLifeMinutes, 0);
});

test('buildFreshnessSnapshot uses MQ readings to estimate spoilage hours', () => {
    const now = new Date('2026-05-01T10:00:00.000Z');
    const snapshot = buildFreshnessSnapshot({
        temperatureC: 8,
        humidityPct: 68,
        mq2: 0,
        mq3: 320,
        mq135: 0,
        readingAt: now
    }, { now, category: 'prepared-meals' });

    assert.equal(snapshot.mq3, 320);
    assert.ok(snapshot.score < 75);
    assert.ok(snapshot.remainingShelfLifeMinutes > 0);
    assert.ok(snapshot.remainingShelfLifeMinutes <= 120);
    assert.ok(snapshot.effectiveExpiryDate > now);
});

test('q10Rate increases spoilage pressure as temperature rises', () => {
    assert.equal(q10Rate(4, { idealTempC: 4, q10: 2 }), 1);
    assert.equal(q10Rate(14, { idealTempC: 4, q10: 2 }), 2);
    assert.equal(q10Rate(24, { idealTempC: 4, q10: 2 }), 4);
});

test('temperatureBand recognizes hot holding for prepared meals', () => {
    const profile = {
        tcs: true,
        coldSafeMaxC: 5,
        hotHoldingMinC: 57,
        dangerMaxC: 60
    };

    assert.equal(temperatureBand(4, profile), 'safe_cold');
    assert.equal(temperatureBand(22, profile), 'danger_zone');
    assert.equal(temperatureBand(58, profile), 'hot_holding');
});
