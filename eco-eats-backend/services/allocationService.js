const DEFAULT_EXPIRY_BUFFER_MINUTES = Number(process.env.ROUTE_EXPIRY_BUFFER_MINUTES || 20);
const KG_PER_MEAL = 0.4;
const { buildFreshnessSnapshot } = require('./freshnessService');

function parseQuantityToKg(quantity) {
    if (typeof quantity === 'number') return quantity;
    if (!quantity || typeof quantity !== 'string') return 0;

    const normalized = quantity.trim().toLowerCase();
    const value = Number.parseFloat(normalized.replace(',', '.'));

    if (Number.isNaN(value)) return 0;
    if (normalized.includes('ton')) return value * 1000;
    if (normalized.includes('gram') || normalized.includes(' g')) return value / 1000;
    if (normalized.includes('lb') || normalized.includes('pound')) return value * 0.453592;

    return value;
}

function estimateMealsFromQuantity(quantity) {
    const kg = parseQuantityToKg(quantity);
    if (!kg || kg <= 0) return 0;
    return Math.max(1, Math.round(kg / KG_PER_MEAL));
}

function getExpiryInfo(expiryDate, now = new Date()) {
    const expiry = expiryDate ? new Date(expiryDate) : null;

    if (!expiry || Number.isNaN(expiry.getTime())) {
        return {
            expired: false,
            hoursUntilExpiry: null,
            urgency: 'unknown'
        };
    }

    const hoursUntilExpiry = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60);
    const expired = hoursUntilExpiry <= 0;
    let urgency = 'stable';

    if (expired) urgency = 'expired';
    else if (hoursUntilExpiry <= 4) urgency = 'critical';
    else if (hoursUntilExpiry <= 12) urgency = 'urgent';
    else if (hoursUntilExpiry <= 24) urgency = 'soon';

    return {
        expired,
        hoursUntilExpiry: Number(hoursUntilExpiry.toFixed(2)),
        urgency
    };
}

function buildRouteFeasibility(expiryDate, durationSeconds = 0, now = new Date()) {
    const expiryInfo = getExpiryInfo(expiryDate, now);
    const bufferMs = DEFAULT_EXPIRY_BUFFER_MINUTES * 60 * 1000;
    const travelMs = Number(durationSeconds || 0) * 1000;
    const expiry = expiryDate ? new Date(expiryDate) : null;

    if (!expiry || Number.isNaN(expiry.getTime())) {
        return {
            ...expiryInfo,
            bufferMinutes: DEFAULT_EXPIRY_BUFFER_MINUTES,
            canDeliverBeforeExpiry: true,
            riskLevel: 'unknown'
        };
    }

    const timeRemainingMs = expiry.getTime() - now.getTime();
    const canDeliverBeforeExpiry = timeRemainingMs > travelMs + bufferMs;
    let riskLevel = 'ok';

    if (expiryInfo.expired) riskLevel = 'expired';
    else if (!canDeliverBeforeExpiry) riskLevel = 'misses_expiry';
    else if (timeRemainingMs <= travelMs + bufferMs * 2) riskLevel = 'tight';

    return {
        ...expiryInfo,
        bufferMinutes: DEFAULT_EXPIRY_BUFFER_MINUTES,
        estimatedTravelMinutes: Math.round(Number(durationSeconds || 0) / 60),
        canDeliverBeforeExpiry,
        riskLevel
    };
}

function resolveFreshnessInfo(item = {}, now = new Date()) {
    const expiryDate = item.expiryDate || item.expiryTimestamp;

    if (item.freshness?.state) {
        return {
            ...item.freshness,
            effectiveExpiryDate: item.freshness.effectiveExpiryDate
                ? new Date(item.freshness.effectiveExpiryDate)
                : (expiryDate ? new Date(expiryDate) : null)
        };
    }

    const latestReading = Array.isArray(item.sensorReadings) && item.sensorReadings.length > 0
        ? item.sensorReadings[item.sensorReadings.length - 1]
        : {};

    return buildFreshnessSnapshot(latestReading, {
        expiryDate,
        category: item.category,
        now
    });
}

function scoreDemandCenter(demandCenter = {}, item = {}, estimatedMeals = 0) {
    if (!demandCenter) return 0;

    const urgencyScoreMap = {
        critical: 20,
        high: 15,
        medium: 9,
        low: 4
    };
    const mealNeed = Number(demandCenter.mealNeed || demandCenter.currentNeedMeals || 0);
    const acceptedCategories = Array.isArray(demandCenter.acceptedCategories)
        ? demandCenter.acceptedCategories
        : [];
    const acceptsCategory = acceptedCategories.length === 0
        || acceptedCategories.includes(item.category)
        || acceptedCategories.includes('general');
    const needFitScore = mealNeed > 0 && estimatedMeals > 0
        ? Math.min(20, (Math.min(mealNeed, estimatedMeals) / estimatedMeals) * 20)
        : 5;
    const categoryScore = acceptsCategory ? 8 : -30;

    return Math.round((urgencyScoreMap[demandCenter.urgency] || 4) + needFitScore + categoryScore);
}

function scoreFoodItem(item, options = {}) {
    const now = options.now || new Date();
    const freshness = resolveFreshnessInfo(item, now);
    const effectiveExpiryDate = freshness.effectiveExpiryDate || item.expiryDate || item.expiryTimestamp;
    const expiryInfo = getExpiryInfo(effectiveExpiryDate, now);
    const estimatedMeals = item.estimatedMeals || estimateMealsFromQuantity(item.quantity);
    const distanceKm = typeof options.distanceKm === 'number' ? options.distanceKm : item.distanceKm;
    const routeDurationSeconds = options.routeDurationSeconds || item.routeSummary?.durationSeconds || 0;
    const feasibility = buildRouteFeasibility(effectiveExpiryDate, routeDurationSeconds, now);

    if (expiryInfo.expired || freshness.state === 'unsafe' || item.isAvailable === false || item.status === 'claimed') {
        return {
            score: -1,
            estimatedMeals,
            expiry: expiryInfo,
            feasibility,
            freshness,
            effectiveExpiryDate,
            risk: 'unavailable'
        };
    }

    const expiryScoreMap = {
        critical: 45,
        urgent: 35,
        soon: 25,
        stable: 12,
        unknown: 5
    };
    const expiryScore = expiryScoreMap[expiryInfo.urgency] || 5;
    const freshnessScoreMap = {
        critical: 22,
        watch: 18,
        good: 8,
        excellent: 4,
        unknown: 5
    };
    const freshnessScore = freshnessScoreMap[freshness.state] || 5;
    const mealScore = Math.min(25, estimatedMeals);
    const distanceScore = typeof distanceKm === 'number' ? Math.max(0, 25 - distanceKm) : 10;
    const categoryDemandScore = options.category && item.category === options.category ? 10 : 0;
    const demandCenterScore = scoreDemandCenter(options.demandCenter, item, estimatedMeals);
    const demandScore = categoryDemandScore + demandCenterScore;
    const feasibilityPenalty = feasibility.riskLevel === 'tight' ? 10 : feasibility.canDeliverBeforeExpiry ? 0 : 40;
    const freshnessPenalty = freshness.state === 'critical' ? 8 : 0;
    const risk = freshness.state === 'critical'
        ? 'freshness_critical'
        : freshness.state === 'watch'
            ? 'freshness_watch'
            : feasibility.riskLevel;

    return {
        score: Math.max(0, Math.round(expiryScore + freshnessScore + mealScore + distanceScore + demandScore - feasibilityPenalty - freshnessPenalty)),
        estimatedMeals,
        expiry: expiryInfo,
        feasibility,
        freshness,
        effectiveExpiryDate,
        demandScore,
        risk
    };
}

module.exports = {
    parseQuantityToKg,
    estimateMealsFromQuantity,
    getExpiryInfo,
    buildRouteFeasibility,
    resolveFreshnessInfo,
    scoreDemandCenter,
    scoreFoodItem
};
