const {
    calculateDistanceMeters,
    normalizeCoordinates,
    routeBetween
} = require('./locationService');
const {
    buildRouteFeasibility,
    scoreFoodItem
} = require('./allocationService');

function coordinatesForFood(food) {
    return normalizeCoordinates(food.pickupCoordinates);
}

function coordinatesForCenter(center) {
    return normalizeCoordinates(center.coordinates);
}

function acceptsFoodCategory(center = {}, category) {
    const accepted = center.acceptedCategories || [];
    return accepted.length === 0 || accepted.includes(category) || accepted.includes('general');
}

function buildAllocationReason(allocation, route, center) {
    const parts = [];

    if (allocation.freshness?.state) parts.push(`freshness ${allocation.freshness.state}`);
    if (allocation.feasibility?.riskLevel) parts.push(`route ${allocation.feasibility.riskLevel}`);
    if (center.urgency) parts.push(`${center.urgency} demand`);
    if (route.durationSeconds) parts.push(`${Math.round(route.durationSeconds / 60)} min delivery`);

    return parts.join(' | ') || 'Ranked by freshness, route, and demand fit.';
}

function buildReceiverReason(allocation, route) {
    const parts = [];

    if (allocation.freshness?.state) parts.push(`freshness ${allocation.freshness.state}`);
    if (allocation.feasibility?.riskLevel) parts.push(`route ${allocation.feasibility.riskLevel}`);
    if (route.durationSeconds) parts.push(`${Math.round(route.durationSeconds / 60)} min pickup`);

    return parts.join(' | ') || 'Ranked by freshness, route, and receiver distance.';
}

function buildAvailableFoodFilter(now = new Date(), options = {}) {
    const filter = {
        expiryDate: { $gt: now },
        $and: [
            { $or: [{ isAvailable: true }, { isAvailable: { $exists: false } }] },
            { $or: [{ status: 'available' }, { status: { $exists: false } }] },
            { $or: [{ claimedBy: null }, { claimedBy: { $exists: false } }] },
            { $or: [{ 'freshness.state': { $ne: 'unsafe' } }, { 'freshness.state': { $exists: false } }] },
            {
                $or: [
                    { 'freshness.effectiveExpiryDate': { $gt: now } },
                    { 'freshness.effectiveExpiryDate': null },
                    { 'freshness.effectiveExpiryDate': { $exists: false } }
                ]
            }
        ]
    };

    if (options.donorId) {
        filter.donor = options.donorId;
    }

    return filter;
}

function serializeRoute(route = {}) {
    return {
        provider: route.provider,
        fallback: route.fallback,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        geometry: route.geometry
    };
}

async function buildFoodDemandAllocations(foodItems = [], demandCenters = [], options = {}) {
    const now = options.now || new Date();
    const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 25;
    const routeFn = options.routeBetweenFn || routeBetween;
    const allocations = [];

    for (const foodItem of foodItems) {
        const food = foodItem.toObject ? foodItem.toObject() : { ...foodItem };
        const pickup = coordinatesForFood(food);

        if (!pickup) continue;

        let bestMatch = null;

        for (const demandCenter of demandCenters) {
            const center = demandCenter.toObject ? demandCenter.toObject() : { ...demandCenter };
            const dropoff = coordinatesForCenter(center);

            if (!dropoff || !acceptsFoodCategory(center, food.category)) continue;

            const route = await routeFn(pickup, dropoff);
            const distanceKm = route.distanceMeters
                ? route.distanceMeters / 1000
                : calculateDistanceMeters(pickup, dropoff) / 1000;
            const allocation = scoreFoodItem(food, {
                now,
                distanceKm,
                routeDurationSeconds: route.durationSeconds,
                demandCenter: center
            });
            const expiry = buildRouteFeasibility(
                allocation.effectiveExpiryDate || food.expiryDate,
                route.durationSeconds,
                now
            );

            if (allocation.score < 0) continue;
            if (expiry.canDeliverBeforeExpiry === false || expiry.riskLevel === 'misses_expiry') continue;

            const match = {
                foodItem: food,
                demandCenter: center,
                route: serializeRoute(route),
                expiry,
                allocation: {
                    ...allocation,
                    reason: buildAllocationReason(allocation, route, center)
                }
            };

            if (!bestMatch || (match.allocation.score || 0) > (bestMatch.allocation.score || 0)) {
                bestMatch = match;
            }
        }

        if (bestMatch) {
            allocations.push(bestMatch);
        }
    }

    return allocations
        .sort((a, b) => (b.allocation.score || 0) - (a.allocation.score || 0))
        .slice(0, limit);
}

async function buildReceiverFoodOptions(foodItems = [], receiverPoint = {}, options = {}) {
    const now = options.now || new Date();
    const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 25;
    const radiusKm = Number.isFinite(Number(options.radiusKm)) ? Number(options.radiusKm) : null;
    const routeFn = options.routeBetweenFn || routeBetween;
    const receiverCoordinates = normalizeCoordinates(receiverPoint.coordinates || receiverPoint);
    const receiver = {
        address: receiverPoint.address || receiverPoint.displayName || 'Receiver address',
        displayName: receiverPoint.displayName || receiverPoint.address || 'Receiver address',
        coordinates: receiverCoordinates
    };
    const optionsList = [];

    if (!receiverCoordinates) return [];

    for (const foodItem of foodItems) {
        const food = foodItem.toObject ? foodItem.toObject() : { ...foodItem };
        const pickup = coordinatesForFood(food);

        if (!pickup) continue;

        const route = await routeFn(pickup, receiverCoordinates);
        const distanceKm = route.distanceMeters
            ? route.distanceMeters / 1000
            : calculateDistanceMeters(pickup, receiverCoordinates) / 1000;

        if (radiusKm && distanceKm > radiusKm) continue;

        const allocation = scoreFoodItem(food, {
            now,
            distanceKm,
            routeDurationSeconds: route.durationSeconds
        });
        const expiry = buildRouteFeasibility(
            allocation.effectiveExpiryDate || food.expiryDate,
            route.durationSeconds,
            now
        );

        if (allocation.score < 0) continue;
        if (expiry.canDeliverBeforeExpiry === false || expiry.riskLevel === 'misses_expiry') continue;

        optionsList.push({
            foodItem: food,
            receiver,
            route: serializeRoute(route),
            expiry,
            allocation: {
                ...allocation,
                reason: buildReceiverReason(allocation, route)
            }
        });
    }

    return optionsList
        .sort((a, b) => (b.allocation.score || 0) - (a.allocation.score || 0))
        .slice(0, limit);
}

module.exports = {
    acceptsFoodCategory,
    buildAvailableFoodFilter,
    buildFoodDemandAllocations,
    buildReceiverFoodOptions,
    serializeRoute
};
