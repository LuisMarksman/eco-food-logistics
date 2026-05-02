const CATEGORY_PROFILES = {
  general: {
    label: 'General perishables',
    idealTempC: 5,
    coldSafeMaxC: 8,
    hotHoldingMinC: null,
    dangerMaxC: 32,
    idealHumidityPct: 60,
    humidityMin: 35,
    humidityMax: 75,
    gasWatch: 45,
    gasCritical: 72
  },
  'prepared-meals': {
    label: 'Prepared meals',
    idealTempC: 4,
    coldSafeMaxC: 5,
    hotHoldingMinC: 57,
    dangerMaxC: 32,
    idealHumidityPct: 58,
    humidityMin: 35,
    humidityMax: 75,
    gasWatch: 42,
    gasCritical: 68
  },
  produce: {
    label: 'Fresh produce',
    idealTempC: 8,
    coldSafeMaxC: 12,
    hotHoldingMinC: null,
    dangerMaxC: 28,
    idealHumidityPct: 85,
    humidityMin: 55,
    humidityMax: 95,
    gasWatch: 50,
    gasCritical: 78
  },
  bakery: {
    label: 'Bakery',
    idealTempC: 22,
    coldSafeMaxC: 28,
    hotHoldingMinC: null,
    dangerMaxC: 35,
    idealHumidityPct: 45,
    humidityMin: 25,
    humidityMax: 65,
    gasWatch: 55,
    gasCritical: 82
  },
  dairy: {
    label: 'Dairy',
    idealTempC: 3,
    coldSafeMaxC: 5,
    hotHoldingMinC: null,
    dangerMaxC: 24,
    idealHumidityPct: 55,
    humidityMin: 35,
    humidityMax: 75,
    gasWatch: 38,
    gasCritical: 60
  },
  packaged: {
    label: 'Packaged shelf-stable',
    idealTempC: 24,
    coldSafeMaxC: 32,
    hotHoldingMinC: null,
    dangerMaxC: 42,
    idealHumidityPct: 45,
    humidityMin: 20,
    humidityMax: 70,
    gasWatch: 65,
    gasCritical: 88
  }
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const round = (value, places = 1) => Number(value.toFixed(places));

function temperatureBand(temperatureC, profile) {
  if (profile.hotHoldingMinC !== null && temperatureC >= profile.hotHoldingMinC) return 'hot_holding';
  if (temperatureC <= profile.coldSafeMaxC) return 'safe';
  if (temperatureC < profile.dangerMaxC) return 'watch';
  return 'critical';
}

function thermalStress(temperatureC, profile) {
  const band = temperatureBand(temperatureC, profile);

  if (band === 'hot_holding') return 4;
  if (band === 'safe') return clamp(Math.abs(temperatureC - profile.idealTempC) * 1.4, 0, 8);
  if (band === 'watch') {
    return clamp(18 + ((temperatureC - profile.coldSafeMaxC) / Math.max(1, profile.dangerMaxC - profile.coldSafeMaxC)) * 26, 18, 44);
  }

  return clamp(52 + Math.max(0, temperatureC - profile.dangerMaxC) * 2.2, 52, 88);
}

function gasStress(gasLevel, profile) {
  if (gasLevel <= profile.gasWatch) return clamp((gasLevel / Math.max(1, profile.gasWatch)) * 18, 0, 18);
  if (gasLevel <= profile.gasCritical) {
    return clamp(18 + ((gasLevel - profile.gasWatch) / Math.max(1, profile.gasCritical - profile.gasWatch)) * 26, 18, 44);
  }

  return clamp(44 + ((gasLevel - profile.gasCritical) / Math.max(1, 100 - profile.gasCritical)) * 44, 44, 88);
}

function humidityStress(humidityPct, profile) {
  if (humidityPct >= profile.humidityMin && humidityPct <= profile.humidityMax) {
    return clamp(Math.abs(humidityPct - profile.idealHumidityPct) * 0.08, 0, 3);
  }

  if (humidityPct < profile.humidityMin) {
    return clamp((profile.humidityMin - humidityPct) * 0.18, 1, 8);
  }

  return clamp((humidityPct - profile.humidityMax) * 0.18, 1, 8);
}

function expiryStress(expiryDate, now) {
  const expiry = expiryDate ? new Date(expiryDate) : null;
  if (!expiry || Number.isNaN(expiry.getTime())) return { pressure: 8, minutesRemaining: null };

  const minutesRemaining = Math.max(0, Math.round((expiry.getTime() - now.getTime()) / 60000));

  if (minutesRemaining <= 0) return { pressure: 100, minutesRemaining: 0 };
  if (minutesRemaining <= 60) return { pressure: 72, minutesRemaining };
  if (minutesRemaining <= 240) return { pressure: 44, minutesRemaining };
  if (minutesRemaining <= 720) return { pressure: 20, minutesRemaining };
  if (minutesRemaining <= 1440) return { pressure: 10, minutesRemaining };
  return { pressure: 4, minutesRemaining };
}

function stateFromScore(score, thermal, gas, expiryPressure) {
  if (expiryPressure >= 100 || thermal >= 80 || gas >= 82 || score <= 18) return 'unsafe';
  if (thermal >= 52 || gas >= 58 || expiryPressure >= 72 || score <= 44) return 'critical';
  if (thermal >= 26 || gas >= 34 || expiryPressure >= 20 || score <= 72) return 'watch';
  if (score <= 88) return 'good';
  return 'excellent';
}

function recommendationFor(state) {
  if (state === 'unsafe') return 'Condition is outside the safe operating range. Do not route.';
  if (state === 'critical') return 'Route only if the handoff is immediate and tightly controlled.';
  if (state === 'watch') return 'Condition is usable, but keep the route short and prioritize this item.';
  if (state === 'good') return 'Condition is stable for routine routing.';
  return 'Condition is excellent and ready for normal allocation.';
}

export function calculateLiveFreshness({
  category,
  expiryDate,
  temperatureC,
  humidityPct,
  gasLevel,
  now = new Date()
}) {
  const profile = CATEGORY_PROFILES[category] || CATEGORY_PROFILES.general;
  const thermal = thermalStress(Number(temperatureC), profile);
  const gas = gasStress(Number(gasLevel), profile);
  const humidity = humidityStress(Number(humidityPct), profile);
  const { pressure: expiryPressure, minutesRemaining } = expiryStress(expiryDate, now);

  const weightedStress = clamp(
    (thermal * 0.46)
    + (gas * 0.28)
    + (humidity * 0.04)
    + (expiryPressure * 0.22),
    0,
    100
  );
  const score = Math.round(clamp(100 - weightedStress, 0, 100));
  const state = stateFromScore(score, thermal, gas, expiryPressure);
  const preservationFactor = clamp(1 - (thermal / 140) - (gas / 180) - (humidity / 300), 0.18, 1);
  const remainingShelfLifeMinutes = minutesRemaining === null
    ? Math.round(8 * 60 * preservationFactor)
    : Math.max(0, Math.round(minutesRemaining * preservationFactor));
  const effectiveExpiryDate = new Date(now.getTime() + (remainingShelfLifeMinutes * 60000));
  const band = temperatureBand(Number(temperatureC), profile);

  return {
    score,
    state,
    temperatureC: Number(temperatureC),
    humidityPct: Number(humidityPct),
    gasLevel: Number(gasLevel),
    gasIndex: Number(gasLevel),
    lastSensorAt: now,
    effectiveExpiryDate,
    remainingShelfLifeMinutes,
    confidence: 0.96,
    recommendation: recommendationFor(state),
    model: {
      name: 'Frontend live condition model',
      categoryProfile: profile.label,
      temperatureBand: band,
      qualityLossRate: round(1 + (thermal / 50), 2),
      safetyCapMinutes: expiryPressure >= 72 ? 60 : null,
      thermalStress: round(thermal),
      gasStress: round(gas),
      humidityStress: round(humidity),
      expiryStress: round(expiryPressure),
      totalStress: round(weightedStress)
    },
    signals: [
      band === 'safe'
        ? 'Temperature is inside the preferred range.'
        : band === 'hot_holding'
          ? 'Temperature is in the hot-holding range.'
          : band === 'watch'
            ? 'Temperature is above the preferred range and needs monitoring.'
            : 'Temperature is in a high-risk band.',
      gas >= 58
        ? 'Gas signal is elevated and needs urgent attention.'
        : gas >= 34
          ? 'Gas signal is rising and should be watched.'
          : 'Gas signal is stable.',
      humidity > 6
        ? 'Humidity is outside the preferred band.'
        : 'Humidity has low impact on the current score.',
      minutesRemaining !== null && minutesRemaining <= 240
        ? 'Expiry window is short and reduces routing headroom.'
        : 'Expiry window is not the main limiter right now.'
    ]
  };
}
