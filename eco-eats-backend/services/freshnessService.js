const DEFAULT_SENSOR_STALE_MINUTES = Number(process.env.SENSOR_STALE_MINUTES || 60);
const { classifyReading } = require('./calibrationModelService');

const CATEGORY_PROFILES = {
    general: {
        label: 'General perishables',
        baseShelfLifeMinutes: 24 * 60,
        tcs: true,
        idealTempC: 4,
        coldSafeMaxC: 5,
        hotHoldingMinC: null,
        dangerMaxC: 60,
        q10: 2.2,
        humidityMin: 35,
        humidityMax: 75,
        idealHumidityPct: 60,
        gasWatch: 45,
        gasCritical: 70,
        gasUnsafe: 90
    },
    'prepared-meals': {
        label: 'Prepared meals',
        baseShelfLifeMinutes: 12 * 60,
        tcs: true,
        idealTempC: 4,
        coldSafeMaxC: 5,
        hotHoldingMinC: 57,
        dangerMaxC: 60,
        q10: 2.4,
        humidityMin: 35,
        humidityMax: 75,
        idealHumidityPct: 60,
        gasWatch: 42,
        gasCritical: 68,
        gasUnsafe: 88
    },
    produce: {
        label: 'Fresh produce',
        baseShelfLifeMinutes: 72 * 60,
        tcs: false,
        idealTempC: 8,
        coldSafeMaxC: 12,
        hotHoldingMinC: null,
        dangerMaxC: 35,
        q10: 2,
        humidityMin: 55,
        humidityMax: 95,
        idealHumidityPct: 85,
        gasWatch: 50,
        gasCritical: 75,
        gasUnsafe: 92
    },
    bakery: {
        label: 'Bakery',
        baseShelfLifeMinutes: 48 * 60,
        tcs: false,
        idealTempC: 22,
        coldSafeMaxC: 28,
        hotHoldingMinC: null,
        dangerMaxC: 38,
        q10: 1.7,
        humidityMin: 25,
        humidityMax: 65,
        idealHumidityPct: 45,
        gasWatch: 55,
        gasCritical: 78,
        gasUnsafe: 94
    },
    dairy: {
        label: 'Dairy',
        baseShelfLifeMinutes: 18 * 60,
        tcs: true,
        idealTempC: 3,
        coldSafeMaxC: 5,
        hotHoldingMinC: null,
        dangerMaxC: 60,
        q10: 2.8,
        humidityMin: 35,
        humidityMax: 75,
        idealHumidityPct: 55,
        gasWatch: 38,
        gasCritical: 62,
        gasUnsafe: 85
    },
    packaged: {
        label: 'Packaged shelf-stable',
        baseShelfLifeMinutes: 7 * 24 * 60,
        tcs: false,
        idealTempC: 24,
        coldSafeMaxC: 32,
        hotHoldingMinC: null,
        dangerMaxC: 45,
        q10: 1.5,
        humidityMin: 20,
        humidityMax: 70,
        idealHumidityPct: 45,
        gasWatch: 65,
        gasCritical: 82,
        gasUnsafe: 95
    }
};

function toNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizedScore(weightedStress) {
    const stressRatio = clamp(weightedStress / 100, 0, 1);

    // Keep the top end more usable for baseline and moderate conditions while
    // still dropping steeply once the combined stress gets genuinely severe.
    return Math.round(clamp((1 - Math.pow(stressRatio, 1.35)) * 100, 0, 100));
}

function hasSensorValues(reading = {}) {
    return ['temperatureC', 'humidityPct', 'gasLevel', 'temperature', 'teperature', 'humidity', 'gas', 'mq2', 'mq3', 'mq135']
        .some((field) => reading[field] !== undefined && reading[field] !== null && reading[field] !== '');
}

function normalizeGasIndex(gasLevel) {
    const gas = toNumber(gasLevel);
    if (gas === null) return null;

    if (gas <= 100) return clamp(gas, 0, 100);
    return clamp((gas / 1000) * 100, 0, 100);
}

function normalizeMqReadings(reading = {}) {
    const mq2 = toNumber(reading.mq2 ?? reading.MQ2);
    const mq3 = toNumber(reading.mq3 ?? reading.MQ3);
    const mq135 = toNumber(reading.mq135 ?? reading.MQ135);

    return { mq2, mq3, mq135 };
}

function gasIndexFromMqReadings(mqReadings = {}) {
    const indexes = Object.values(mqReadings)
        .map(normalizeGasIndex)
        .filter((value) => value !== null);

    if (indexes.length === 0) return null;
    return clamp(Math.max(...indexes), 0, 100);
}

function normalizeSensorReading(reading = {}) {
    const observedAt = reading.readingAt || reading.observedAt || reading.lastSensorAt || new Date();
    const observedDate = new Date(observedAt);
    const mqReadings = normalizeMqReadings(reading);
    const gasLevel = toNumber(reading.gasLevel ?? reading.gas);
    const mqGasIndex = gasIndexFromMqReadings(mqReadings);
    const gasIndex = gasLevel === null ? mqGasIndex : normalizeGasIndex(gasLevel);

    return {
        temperatureC: toNumber(reading.temperatureC ?? reading.temperature ?? reading.teperature ?? reading.temp),
        humidityPct: toNumber(reading.humidityPct ?? reading.humidity ?? reading.hum),
        gasLevel,
        gasIndex,
        ...mqReadings,
        observedAt: Number.isNaN(observedDate.getTime()) ? new Date() : observedDate,
        source: reading.source || 'sensor'
    };
}

function isHotHeld(temperatureC, profile) {
    return profile.hotHoldingMinC !== null && temperatureC !== null && temperatureC >= profile.hotHoldingMinC;
}

function temperatureBand(temperatureC, profile) {
    if (temperatureC === null) return 'unknown';
    if (profile.tcs && isHotHeld(temperatureC, profile)) return 'hot_holding';
    if (temperatureC <= profile.coldSafeMaxC) return 'safe_cold';
    if (temperatureC < profile.dangerMaxC) return profile.tcs ? 'danger_zone' : 'quality_risk';
    return 'extreme';
}

function q10Rate(temperatureC, profile) {
    if (temperatureC === null || isHotHeld(temperatureC, profile)) return 1;

    const deltaC = Math.max(0, temperatureC - profile.idealTempC);
    return Number(Math.pow(profile.q10, deltaC / 10).toFixed(2));
}

function gasStress(gasIndex, profile) {
    if (gasIndex === null) return 0;
    if (gasIndex <= profile.gasWatch) return clamp(gasIndex / profile.gasWatch * 10, 0, 10);
    if (gasIndex <= profile.gasCritical) {
        return 10 + ((gasIndex - profile.gasWatch) / (profile.gasCritical - profile.gasWatch)) * 25;
    }
    if (gasIndex <= profile.gasUnsafe) {
        return 35 + ((gasIndex - profile.gasCritical) / (profile.gasUnsafe - profile.gasCritical)) * 35;
    }
    return 90;
}

function mqSpoilageStress(reading = {}) {
    const mq2Index = normalizeGasIndex(reading.mq2);
    const mq3Index = normalizeGasIndex(reading.mq3);
    const mq135Index = normalizeGasIndex(reading.mq135);
    let stress = 0;

    if (mq2Index !== null) stress += mq2Index * 0.12;
    if (mq3Index !== null) stress += mq3Index * 0.42;
    if (mq135Index !== null) stress += mq135Index * 0.46;

    return Number(clamp(stress, 0, 45).toFixed(1));
}

function humidityStress(humidityPct, profile) {
    if (humidityPct === null) return 0;
    if (humidityPct >= profile.humidityMin && humidityPct <= profile.humidityMax) {
        return Math.abs(humidityPct - profile.idealHumidityPct) * 0.03;
    }

    if (humidityPct < profile.humidityMin) {
        return clamp((profile.humidityMin - humidityPct) * 0.18, 1, 8);
    }

    return clamp((humidityPct - profile.humidityMax) * 0.2, 1, 10);
}

function staleStress(observedAt, now) {
    const ageMinutes = Math.max(0, (now.getTime() - observedAt.getTime()) / (1000 * 60));
    if (ageMinutes <= DEFAULT_SENSOR_STALE_MINUTES) return 0;
    if (ageMinutes <= DEFAULT_SENSOR_STALE_MINUTES * 2) return 8;
    if (ageMinutes <= DEFAULT_SENSOR_STALE_MINUTES * 4) return 16;
    return 26;
}

function weightedStressScore({
    thermalPenalty,
    combinedGasPenalty,
    humidityPenalty,
    stalePenalty,
    safetyCap
}) {
    if (safetyCap === 0) return 100;

    const thermalComponent = clamp((thermalPenalty / 70) * 100, 0, 100);
    const gasComponent = clamp((combinedGasPenalty / 90) * 100, 0, 100);
    const humidityComponent = clamp((humidityPenalty / 12) * 100, 0, 100);
    const staleComponent = clamp((stalePenalty / 26) * 100, 0, 100);

    return Number(clamp(
        (thermalComponent * 0.5)
        + (gasComponent * 0.3)
        + (humidityComponent * 0.06)
        + (staleComponent * 0.14),
        0,
        100
    ).toFixed(1));
}

function safetyCapMinutes(temperatureC, gasIndex, profile) {
    const band = temperatureBand(temperatureC, profile);

    if (gasIndex !== null && gasIndex >= profile.gasUnsafe) return 0;
    if (band === 'extreme') return profile.tcs ? 0 : 45;
    if (band === 'hot_holding') return null;
    if (!profile.tcs) return null;
    if (band === 'danger_zone') return temperatureC >= 32 ? 60 : 120;
    return null;
}

function buildSignals({ band, rate, gasIndex, humidityPct, profile, stalePenalty, safetyCap }) {
    const signals = [];

    if (band === 'safe_cold') {
        signals.push('Temperature is inside the recommended cold holding range for this category.');
    } else if (band === 'hot_holding') {
        signals.push('Temperature is high enough for hot holding of prepared food.');
    } else if (band === 'danger_zone') {
        signals.push('Temperature is in the time-temperature danger zone; delivery time is capped.');
    } else if (band === 'quality_risk') {
        signals.push('Temperature is above the ideal range and accelerates quality loss.');
    } else if (band === 'extreme') {
        signals.push('Temperature is outside the operating band for redistribution.');
    }

    if (rate > 1.15) {
        signals.push(`Q10 model estimates freshness loss is ${rate}x faster than ideal storage.`);
    }

    if (gasIndex !== null) {
        if (gasIndex >= profile.gasUnsafe) signals.push('Gas reading is above the unsafe spoilage threshold.');
        else if (gasIndex >= profile.gasCritical) signals.push('Gas reading is critical and indicates rapid spoilage risk.');
        else if (gasIndex >= profile.gasWatch) signals.push('Gas reading is elevated and should be prioritized.');
        else signals.push('Gas reading is within the expected range.');
    }

    if (humidityPct !== null && (humidityPct < profile.humidityMin || humidityPct > profile.humidityMax)) {
        signals.push('Humidity is outside the quality band for this food category.');
    }

    if (stalePenalty > 0) {
        signals.push('Sensor reading is stale; confidence is reduced.');
    }

    if (safetyCap === 0) {
        signals.push('Safety cap is zero: do not distribute without manual inspection.');
    } else if (safetyCap) {
        signals.push(`Food-code safety cap limits the route window to ${safetyCap} minutes.`);
    }

    return signals.length ? signals : ['Sensor readings are within the expected operating range.'];
}

function calculateEffectiveExpiry(expiryDate, model, now) {
    const expiry = expiryDate ? new Date(expiryDate) : null;

    if (model.safetyCapMinutes === 0) return now;

    const staticRemainingMs = expiry && !Number.isNaN(expiry.getTime())
        ? Math.max(0, expiry.getTime() - now.getTime())
        : model.estimatedSpoilMinutes * 60 * 1000;
    const qualityAdjustedMs = staticRemainingMs / model.qualityLossRate;
    const safetyCapMs = model.safetyCapMinutes === null
        ? Number.POSITIVE_INFINITY
        : model.safetyCapMinutes * 60 * 1000;
    const adjustedMs = Math.min(staticRemainingMs, qualityAdjustedMs, safetyCapMs);

    return new Date(now.getTime() + Math.max(0, adjustedMs));
}

function confidenceFor(reading, now) {
    const hasGasSignal = reading.gasLevel !== null || reading.gasIndex !== null;
    const availableSignals = [
        reading.temperatureC,
        reading.humidityPct,
        hasGasSignal ? 1 : null
    ].filter((value) => value !== null).length;
    const ageMinutes = (now.getTime() - reading.observedAt.getTime()) / (1000 * 60);
    const completeness = availableSignals / 3;
    const freshness = ageMinutes <= DEFAULT_SENSOR_STALE_MINUTES ? 1 : 0.65;

    return Number(clamp(completeness * freshness, 0, 1).toFixed(2));
}

function estimatedSpoilMinutes(score, model, profile) {
    if (model.safetyCapMinutes === 0) return 0;

    const stressFactor = clamp(score / 100, 0, 1);
    const baseMinutes = profile.baseShelfLifeMinutes || CATEGORY_PROFILES.general.baseShelfLifeMinutes;
    const gasMultiplier = model.gasStress >= 60 ? 0.2
        : model.gasStress >= 35 ? 0.38
            : model.gasStress >= 15 ? 0.65
                : 1;
    const humidityMultiplier = model.humidityStress >= 18 ? 0.72 : 1;
    const thermalMultiplier = model.temperatureBand === 'hot_holding'
        ? 1
        : 1 / Math.max(1, model.qualityLossRate);
    const estimate = baseMinutes * stressFactor * gasMultiplier * humidityMultiplier * thermalMultiplier;

    return Math.max(0, Math.round(estimate));
}

function stateFromModel(score, model, reading, profile) {
    if (model.safetyCapMinutes === 0) return 'unsafe';
    if (reading.gasIndex !== null && reading.gasIndex >= profile.gasUnsafe) return 'unsafe';
    if (score < 18 && model.temperatureBand === 'extreme') return 'unsafe';
    if (
        score < 42
        || (model.temperatureBand === 'danger_zone' && score < 62)
        || (reading.gasIndex !== null && reading.gasIndex >= profile.gasCritical)
    ) {
        return 'critical';
    }
    if (score < 68 || model.qualityLossRate >= 2.3 || (reading.gasIndex !== null && reading.gasIndex >= profile.gasWatch)) {
        return 'watch';
    }
    if (score < 90) return 'good';
    return 'excellent';
}

function recommendationFromState(state, model) {
    if (state === 'unsafe') return 'Do not distribute. Hold for manual inspection or disposal workflow.';
    if (state === 'critical') return 'Dispatch only to the nearest high-need center that can receive immediately.';
    if (state === 'watch') return 'Prioritize this item before stable listings and keep route time short.';
    if (model.temperatureBand === 'hot_holding') return 'Maintain hot holding during pickup and delivery.';
    return 'Safe to route using normal allocation priority.';
}

function predictionGap(prediction = {}) {
    const first = prediction.distances?.[0]?.distance;
    const second = prediction.distances?.[1]?.distance;

    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
    return Number((second - first).toFixed(4));
}

function likelyCalibratedMatch(prediction, minimumConfidence = 0.5, minimumGap = 0.015, maximumDistance = 2.5) {
    if (!prediction) return false;
    if (!Number.isFinite(prediction.distance) || prediction.distance > maximumDistance) return false;
    if ((prediction.confidence || 0) >= minimumConfidence) return true;

    const gap = predictionGap(prediction);
    return gap !== null && gap >= minimumGap;
}

function calibrationScoreFloor(prediction) {
    if (!prediction) return null;

    if (prediction.state === 'empty' || prediction.label?.includes('empty')) {
        return prediction.confidence >= 0.65 ? 94 : 90;
    }

    if (['fresh', 'good', 'excellent'].includes(prediction.state)) {
        if (prediction.confidence >= 0.7) return 90;
        if (prediction.confidence >= 0.5) return 84;
        return 78;
    }

    return null;
}

function applyCalibratedPrediction(snapshot, prediction, normalized, now) {
    const calibratedSignal = `Sensor signature is closest to ${prediction.label} (${Math.round(prediction.confidence * 100)}% confidence).`;
    const calibratedSnapshot = {
        ...snapshot,
        model: {
            ...snapshot.model,
            calibratedPrediction: {
                label: prediction.label,
                state: prediction.state,
                foodName: prediction.foodName,
                foodForm: prediction.foodForm,
                confidence: prediction.confidence,
                readyForRottenDetection: prediction.readyForRottenDetection,
                readyForShelfLifeLearning: prediction.readyForShelfLifeLearning
            }
        },
        signals: [calibratedSignal, ...snapshot.signals]
    };

    if (!prediction) return snapshot;

    if ((prediction.state === 'empty' || prediction.label.includes('empty')) && likelyCalibratedMatch(prediction, 0.2, 0.01, 2.5)) {
        const scoreFloor = calibrationScoreFloor(prediction) ?? 90;
        return {
            ...calibratedSnapshot,
            score: Math.max(snapshot.score ?? 0, scoreFloor),
            state: 'good',
            effectiveExpiryDate: null,
            remainingShelfLifeMinutes: null,
            confidence: Math.max(snapshot.confidence, prediction.confidence),
            recommendation: 'Container matches the open-container baseline. Ambient sensor condition looks stable; add food before routing.',
            signals: ['Container matches the empty baseline calibration.', ...snapshot.signals],
            temperatureC: normalized.temperatureC,
            humidityPct: normalized.humidityPct
        };
    }

    if (['fresh', 'good', 'excellent'].includes(prediction.state) && likelyCalibratedMatch(prediction, 0.3, 0.015, 2.5)) {
        const scoreFloor = calibrationScoreFloor(prediction) ?? 78;
        const nextState = snapshot.state === 'unsafe'
            ? 'watch'
            : scoreFloor >= 88
                ? 'excellent'
                : 'good';

        return {
            ...calibratedSnapshot,
            score: Math.max(snapshot.score ?? 0, scoreFloor),
            state: nextState,
            confidence: Math.max(snapshot.confidence, prediction.confidence),
            recommendation: nextState === 'excellent'
                ? 'Sensor signature matches a stable fresh sample. Safe to route using normal allocation priority.'
                : 'Sensor signature matches a fresh sample. Safe to route, but keep standard delivery discipline.'
        };
    }

    return prediction.confidence >= 0.58 ? calibratedSnapshot : snapshot;
}

function buildFreshnessSnapshot(reading = {}, options = {}) {
    const now = options.now || new Date();
    const expiryDate = options.expiryDate || options.expiryTimestamp;
    const category = options.category || 'general';
    const profile = CATEGORY_PROFILES[category] || CATEGORY_PROFILES.general;

    if (!hasSensorValues(reading)) {
        return {
            score: null,
            state: 'unknown',
            temperatureC: null,
            humidityPct: null,
            gasLevel: null,
            gasIndex: null,
            mq2: null,
            mq3: null,
            mq135: null,
            lastSensorAt: null,
            effectiveExpiryDate: expiryDate ? new Date(expiryDate) : null,
            remainingShelfLifeMinutes: null,
            confidence: 0,
            recommendation: 'Attach a sensor reading before relying on freshness-aware routing.',
            model: {
                name: 'Q10 time-temperature + MQ gas spoilage estimate',
                categoryProfile: profile.label,
                temperatureBand: 'unknown',
                qualityLossRate: 1,
                safetyCapMinutes: null,
                estimatedSpoilMinutes: null,
                gasStress: 0,
                mqSpoilageStress: 0,
                humidityStress: 0,
                staleStress: 0,
                totalStress: 0
            },
            signals: ['No sensor telemetry yet.']
        };
    }

    const normalized = normalizeSensorReading(reading);
    const band = temperatureBand(normalized.temperatureC, profile);
    const qualityLossRate = q10Rate(normalized.temperatureC, profile);
    const gasPenalty = gasStress(normalized.gasIndex, profile);
    const mqPenalty = mqSpoilageStress(normalized);
    const humidityPenalty = humidityStress(normalized.humidityPct, profile);
    const stalePenalty = staleStress(normalized.observedAt, now);
    const thermalPenalty = band === 'hot_holding'
        ? 2
        : clamp((qualityLossRate - 1) * 18, 0, 45) + (band === 'danger_zone' ? 18 : band === 'extreme' ? 45 : 0);
    const safetyCap = safetyCapMinutes(normalized.temperatureC, normalized.gasIndex, profile);
    const combinedGasPenalty = Math.max(gasPenalty, mqPenalty);
    const rawTotalStress = Number(clamp(thermalPenalty + combinedGasPenalty + humidityPenalty + stalePenalty, 0, 100).toFixed(1));
    const weightedStress = weightedStressScore({
        thermalPenalty,
        combinedGasPenalty,
        humidityPenalty,
        stalePenalty,
        safetyCap
    });
    const score = normalizedScore(weightedStress);
    const model = {
        name: 'Q10 time-temperature + MQ gas spoilage estimate',
        categoryProfile: profile.label,
        temperatureBand: band,
        qualityLossRate,
        safetyCapMinutes: safetyCap,
        gasStress: Number(combinedGasPenalty.toFixed(1)),
        mqSpoilageStress: mqPenalty,
        humidityStress: Number(humidityPenalty.toFixed(1)),
        thermalStress: Number(thermalPenalty.toFixed(1)),
        staleStress: Number(stalePenalty.toFixed(1)),
        rawTotalStress,
        weightedStress,
        totalStress: weightedStress
    };
    model.estimatedSpoilMinutes = estimatedSpoilMinutes(score, model, profile);
    const state = stateFromModel(score, model, normalized, profile);
    const effectiveExpiryDate = calculateEffectiveExpiry(expiryDate, model, now);
    const remainingShelfLifeMinutes = effectiveExpiryDate
        ? Math.max(0, Math.round((effectiveExpiryDate.getTime() - now.getTime()) / (1000 * 60)))
        : null;

    const snapshot = {
        score,
        state,
        temperatureC: normalized.temperatureC,
        humidityPct: normalized.humidityPct,
        gasLevel: normalized.gasLevel,
        gasIndex: normalized.gasIndex,
        mq2: normalized.mq2,
        mq3: normalized.mq3,
        mq135: normalized.mq135,
        lastSensorAt: normalized.observedAt,
        effectiveExpiryDate,
        remainingShelfLifeMinutes,
        confidence: confidenceFor(normalized, now),
        recommendation: recommendationFromState(state, model),
        model,
        signals: buildSignals({
            band,
            rate: qualityLossRate,
            gasIndex: normalized.gasIndex,
            humidityPct: normalized.humidityPct,
            profile,
            stalePenalty,
            safetyCap
        })
    };

    return applyCalibratedPrediction(snapshot, classifyReading(normalized), normalized, now);
}

module.exports = {
    CATEGORY_PROFILES,
    buildFreshnessSnapshot,
    normalizedScore,
    normalizeGasIndex,
    normalizeSensorReading,
    q10Rate,
    temperatureBand
};
