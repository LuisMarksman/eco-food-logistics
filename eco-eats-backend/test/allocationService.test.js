const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildRouteFeasibility,
    estimateMealsFromQuantity,
    getExpiryInfo,
    scoreFoodItem
} = require('../services/allocationService');

test('estimateMealsFromQuantity converts common quantity strings', () => {
    assert.equal(estimateMealsFromQuantity('4 kg'), 10);
    assert.equal(estimateMealsFromQuantity('800 grams'), 2);
});

test('getExpiryInfo marks near-expiry food as urgent', () => {
    const now = new Date('2026-05-01T10:00:00.000Z');
    const expiry = new Date('2026-05-01T16:00:00.000Z');

    assert.equal(getExpiryInfo(expiry, now).urgency, 'urgent');
});

test('buildRouteFeasibility rejects routes that miss expiry buffer', () => {
    const now = new Date('2026-05-01T10:00:00.000Z');
    const expiry = new Date('2026-05-01T10:30:00.000Z');
    const feasibility = buildRouteFeasibility(expiry, 20 * 60, now);

    assert.equal(feasibility.canDeliverBeforeExpiry, false);
    assert.equal(feasibility.riskLevel, 'misses_expiry');
});

test('scoreFoodItem excludes unavailable food', () => {
    const score = scoreFoodItem({
        quantity: '10 kg',
        expiryDate: new Date('2026-05-02T10:00:00.000Z'),
        isAvailable: false,
        status: 'claimed'
    }, { now: new Date('2026-05-01T10:00:00.000Z') });

    assert.equal(score.score, -1);
    assert.equal(score.risk, 'unavailable');
});

test('scoreFoodItem uses sensor-adjusted freshness expiry', () => {
    const now = new Date('2026-05-01T10:00:00.000Z');
    const score = scoreFoodItem({
        quantity: '10 kg',
        category: 'prepared-meals',
        expiryDate: new Date('2026-05-01T18:00:00.000Z'),
        freshness: {
            state: 'watch',
            score: 61,
            effectiveExpiryDate: new Date('2026-05-01T14:24:00.000Z')
        },
        isAvailable: true,
        status: 'available'
    }, { now, routeDurationSeconds: 20 * 60 });

    assert.equal(score.freshness.state, 'watch');
    assert.equal(score.expiry.hoursUntilExpiry, 4.4);
    assert.equal(score.risk, 'freshness_watch');
});
