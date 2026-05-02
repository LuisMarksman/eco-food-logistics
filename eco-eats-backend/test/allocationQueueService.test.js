const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildAvailableFoodFilter,
    buildFoodDemandAllocations,
    buildReceiverFoodOptions
} = require('../services/allocationQueueService');

const now = new Date('2026-05-01T10:00:00.000Z');

function route(durationMinutes, distanceMeters = 5000) {
    return {
        provider: 'test',
        fallback: false,
        distanceMeters,
        durationSeconds: durationMinutes * 60,
        geometry: {
            type: 'LineString',
            coordinates: [[77.59, 12.97], [77.6, 12.98]]
        }
    };
}

test('buildFoodDemandAllocations chooses the highest-fit demand center for a food item', async () => {
    const foodItems = [{
        _id: 'food-1',
        title: 'Prepared meals',
        quantity: '10 kg',
        category: 'prepared-meals',
        expiryDate: new Date('2026-05-01T18:00:00.000Z'),
        pickupCoordinates: { lat: 12.97, lng: 77.59 },
        isAvailable: true,
        status: 'available',
        freshness: {
            state: 'good',
            score: 82,
            effectiveExpiryDate: new Date('2026-05-01T18:00:00.000Z')
        }
    }];
    const demandCenters = [
        {
            _id: 'center-low',
            name: 'Low need center',
            coordinates: { lat: 12.98, lng: 77.6 },
            urgency: 'low',
            mealNeed: 10,
            acceptedCategories: ['prepared-meals']
        },
        {
            _id: 'center-critical',
            name: 'Critical need center',
            coordinates: { lat: 12.99, lng: 77.61 },
            urgency: 'critical',
            mealNeed: 200,
            acceptedCategories: ['prepared-meals']
        }
    ];

    const queue = await buildFoodDemandAllocations(foodItems, demandCenters, {
        now,
        routeBetweenFn: async () => route(15)
    });

    assert.equal(queue.length, 1);
    assert.equal(queue[0].demandCenter.name, 'Critical need center');
    assert.ok(queue[0].allocation.score > 0);
    assert.match(queue[0].allocation.reason, /critical demand/);
});

test('buildFoodDemandAllocations excludes routes that miss the sensor-adjusted expiry window', async () => {
    const queue = await buildFoodDemandAllocations([{
        _id: 'food-1',
        title: 'Tight food',
        quantity: '5 kg',
        category: 'general',
        expiryDate: new Date('2026-05-01T18:00:00.000Z'),
        pickupCoordinates: { lat: 12.97, lng: 77.59 },
        isAvailable: true,
        status: 'available',
        freshness: {
            state: 'watch',
            score: 60,
            effectiveExpiryDate: new Date('2026-05-01T10:30:00.000Z')
        }
    }], [{
        _id: 'center-1',
        name: 'Nearby center',
        coordinates: { lat: 12.98, lng: 77.6 },
        urgency: 'critical',
        mealNeed: 100,
        acceptedCategories: ['general']
    }], {
        now,
        routeBetweenFn: async () => route(20)
    });

    assert.equal(queue.length, 0);
});

test('buildFoodDemandAllocations excludes unsafe or expired food', async () => {
    const demandCenters = [{
        _id: 'center-1',
        name: 'Center',
        coordinates: { lat: 12.98, lng: 77.6 },
        urgency: 'critical',
        mealNeed: 100,
        acceptedCategories: ['general']
    }];
    const foodItems = [
        {
            _id: 'unsafe',
            title: 'Unsafe food',
            quantity: '5 kg',
            category: 'general',
            expiryDate: new Date('2026-05-01T18:00:00.000Z'),
            pickupCoordinates: { lat: 12.97, lng: 77.59 },
            isAvailable: true,
            status: 'available',
            freshness: { state: 'unsafe', effectiveExpiryDate: new Date('2026-05-01T18:00:00.000Z') }
        },
        {
            _id: 'expired',
            title: 'Expired food',
            quantity: '5 kg',
            category: 'general',
            expiryDate: new Date('2026-05-01T09:00:00.000Z'),
            pickupCoordinates: { lat: 12.97, lng: 77.59 },
            isAvailable: true,
            status: 'available'
        }
    ];

    const queue = await buildFoodDemandAllocations(foodItems, demandCenters, {
        now,
        routeBetweenFn: async () => route(5)
    });

    assert.equal(queue.length, 0);
});

test('buildAvailableFoodFilter scopes donor allocation requests', () => {
    const filter = buildAvailableFoodFilter(now, { donorId: 'donor-1' });

    assert.equal(filter.donor, 'donor-1');
    assert.deepEqual(filter.expiryDate, { $gt: now });
    assert.ok(filter.$and.some((entry) => entry.$or?.some((condition) => condition.claimedBy === null)));
});

test('buildReceiverFoodOptions ranks available food against a receiver destination', async () => {
    const foodItems = [
        {
            _id: 'stable',
            title: 'Stable pantry boxes',
            quantity: '8 kg',
            category: 'packaged',
            expiryDate: new Date('2026-05-03T10:00:00.000Z'),
            pickupCoordinates: { lat: 12.96, lng: 77.58 },
            isAvailable: true,
            status: 'available',
            freshness: {
                state: 'good',
                score: 84,
                effectiveExpiryDate: new Date('2026-05-03T10:00:00.000Z')
            }
        },
        {
            _id: 'urgent',
            title: 'Urgent prepared meals',
            quantity: '10 kg',
            category: 'prepared-meals',
            expiryDate: new Date('2026-05-01T15:00:00.000Z'),
            pickupCoordinates: { lat: 12.97, lng: 77.59 },
            isAvailable: true,
            status: 'available',
            freshness: {
                state: 'watch',
                score: 62,
                effectiveExpiryDate: new Date('2026-05-01T15:00:00.000Z')
            }
        }
    ];

    const options = await buildReceiverFoodOptions(foodItems, {
        address: 'Indiranagar, Bengaluru',
        coordinates: { lat: 12.98, lng: 77.6 }
    }, {
        now,
        routeBetweenFn: async (pickup) => (
            pickup.lat === 12.97 ? route(10, 3500) : route(20, 8000)
        )
    });

    assert.equal(options.length, 2);
    assert.equal(options[0].foodItem.title, 'Urgent prepared meals');
    assert.equal(options[0].receiver.address, 'Indiranagar, Bengaluru');
    assert.match(options[0].allocation.reason, /min pickup/);
});

test('buildReceiverFoodOptions excludes unavailable and infeasible options', async () => {
    const foodItems = [
        {
            _id: 'unsafe',
            title: 'Unsafe food',
            quantity: '5 kg',
            category: 'general',
            expiryDate: new Date('2026-05-01T18:00:00.000Z'),
            pickupCoordinates: { lat: 12.97, lng: 77.59 },
            isAvailable: true,
            status: 'available',
            freshness: { state: 'unsafe', effectiveExpiryDate: new Date('2026-05-01T18:00:00.000Z') }
        },
        {
            _id: 'claimed',
            title: 'Claimed food',
            quantity: '5 kg',
            category: 'general',
            expiryDate: new Date('2026-05-01T18:00:00.000Z'),
            pickupCoordinates: { lat: 12.98, lng: 77.6 },
            isAvailable: false,
            status: 'claimed'
        },
        {
            _id: 'missing-coordinates',
            title: 'Missing coordinates',
            quantity: '5 kg',
            category: 'general',
            expiryDate: new Date('2026-05-01T18:00:00.000Z'),
            isAvailable: true,
            status: 'available'
        },
        {
            _id: 'misses-expiry',
            title: 'Too far away',
            quantity: '5 kg',
            category: 'general',
            expiryDate: new Date('2026-05-01T10:35:00.000Z'),
            pickupCoordinates: { lat: 13.01, lng: 77.7 },
            isAvailable: true,
            status: 'available'
        }
    ];

    const options = await buildReceiverFoodOptions(foodItems, {
        address: 'Indiranagar, Bengaluru',
        coordinates: { lat: 12.98, lng: 77.6 }
    }, {
        now,
        routeBetweenFn: async () => route(20)
    });

    assert.equal(options.length, 0);
});
