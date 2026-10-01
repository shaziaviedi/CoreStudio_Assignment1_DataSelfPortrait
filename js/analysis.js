// active data measurement, expressive state + tiredness

/*
  step 5 — active data measurement + normalization
  measurement only. no emotion mapping. no node movement.
*/

function clamp01(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function safeRatio(numerator, denominator) {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0 ||
    numerator <= 0
  ) {
    return 0;
  }
  return clamp01(numerator / denominator);
}

function emptyCategoryNumberMap() {
  return {
    workSchool: 0,
    events: 0,
    personal: 0,
    planningReset: 0,
  };
}

function isUntreatedSamplePlaceholderSlot(slot) {
  return (
    Boolean(slot) &&
    isSamplePlaceholderTask(slot.sourceTask) &&
    !slot.visualRecord &&
    isSamplePlaceholderTask(slot.assignedTask)
  );
}

/*
  meaningful visual records = portrait slots (post-remap) + background
  planning/reset nodes. excludes raw samplePlaceholder. each pr instance
  appears once (portrait or background), so the universe stays ≤ 17.
*/
function forEachMeaningfulVisualRecord(callback) {
  if (typeof callback !== "function") {
    return;
  }

  for (let i = 0; i < portraitSlots.length; i++) {
    const slot = portraitSlots[i];
    if (isUntreatedSamplePlaceholderSlot(slot)) {
      continue;
    }

    const record = slot.assignedTask;
    if (!record) {
      continue;
    }

    const categoryId = getCategoryIdForRecord(record);
    if (categoryId === "samplePlaceholder") {
      continue;
    }
    if (ACTIVE_DATA_CATEGORY_IDS.indexOf(categoryId) === -1) {
      continue;
    }

    callback(record, categoryId, "portrait", slot);
  }

  for (let j = 0; j < recurringBackgroundNodes.length; j++) {
    const node = recurringBackgroundNodes[j];
    const record = node.assignedTask;
    if (!record) {
      continue;
    }

    const categoryId = getCategoryIdForRecord(record);
    if (categoryId !== "planningReset") {
      // background layer is planning/reset only.
      continue;
    }

    callback(record, categoryId, "background", node);
  }
}

/*
  is this meaningful record active under the current mode's filters?
  data-state only — does not read element.style.opacity.
*/
function isRecordActiveForAnalysis(record, categoryId) {
  if (!record) {
    return false;
  }

  if (interactionMode === "live") {
    // LIVE ignores SETTINGS year/category toggles.
    return taskMatchesTime(record, selectedTimeMinutes);
  }

  if (interactionMode === "settings") {
    const categoryOk = isCategoryVisibleInSettings(categoryId);
    const yearOk = recordMatchesYear(record, settingsState.year);
    return categoryOk && yearOk;
  }

  return false;
}

/*
  category baselines (available counts) for the current context.

  LIVE: full meaningful historical dataset (ALL years).
  SETTINGS ALL: full meaningful dataset.
  SETTINGS year: that year's meaningful records only.

  category off does not zero the baseline — only active counts go to 0.
*/
function getCategoryBaselinesForContext() {
  const baselines = emptyCategoryNumberMap();
  const yearSelection =
    interactionMode === "settings" ? settingsState.year : "all";

  forEachMeaningfulVisualRecord(function (record, categoryId) {
    if (!recordMatchesYear(record, yearSelection)) {
      return;
    }
    baselines[categoryId] += 1;
  });

  return baselines;
}

/*
  central active-data analysis. run after visual filtering is applied.
  returns raw counts, composition (0–1), relative intensity (0–1), density (0–1).
  no emotion variables.
*/
function calculateActiveDataState() {
  const counts = emptyCategoryNumberMap();
  const baselines = getCategoryBaselinesForContext();

  forEachMeaningfulVisualRecord(function (record, categoryId) {
    if (isRecordActiveForAnalysis(record, categoryId)) {
      counts[categoryId] += 1;
    }
  });

  const totalActive =
    counts.workSchool + counts.events + counts.personal + counts.planningReset;

  const totalAvailable =
    baselines.workSchool +
    baselines.events +
    baselines.personal +
    baselines.planningReset;

  const composition = emptyCategoryNumberMap();
  const relativeIntensity = emptyCategoryNumberMap();

  for (let i = 0; i < ACTIVE_DATA_CATEGORY_IDS.length; i++) {
    const id = ACTIVE_DATA_CATEGORY_IDS[i];
    composition[id] = totalActive > 0 ? safeRatio(counts[id], totalActive) : 0;
    relativeIntensity[id] = safeRatio(counts[id], baselines[id]);
  }

  const density = safeRatio(totalActive, totalAvailable);

  return {
    mode: interactionMode,
    year: interactionMode === "settings" ? settingsState.year : null,
    selectedTimeMinutes:
      interactionMode === "live" ? selectedTimeMinutes : null,
    counts: counts,
    baselines: baselines,
    totalActive: totalActive,
    totalAvailable: totalAvailable,
    composition: composition,
    relativeIntensity: relativeIntensity,
    density: density,
  };
}

/*
  step 6 — data → expressive state mapping
  numerical visual tendencies only. no portrait deformation yet.
*/

function emptyExpressiveState() {
  return {
    workPressure: 0,
    socialEnergy: 0,
    inwardness: 0,
    order: 0,
    densityStrength: 0,
    dominantCategory: "none",
    dominance: 0,
    confidence: 0,
  };
}

/*
  data-only live density scan at 10-minute steps.
  does not touch SVG opacity / camera / mode.
*/
function computeLiveDensityRange() {
  const records = [];
  forEachMeaningfulVisualRecord(function (record) {
    records.push(record);
  });

  const totalAvailable = records.length;
  let minDensity = Infinity;
  let maxDensity = -Infinity;
  const samples = [];

  for (
    let minutes = 0;
    minutes < 24 * 60;
    minutes += LIVE_DENSITY_SAMPLE_STEP_MINUTES
  ) {
    let active = 0;
    for (let i = 0; i < records.length; i++) {
      if (taskMatchesTime(records[i], minutes)) {
        active += 1;
      }
    }

    const density = totalAvailable > 0 ? clamp01(active / totalAvailable) : 0;
    samples.push({
      minutes: minutes,
      active: active,
      density: density,
    });

    if (density < minDensity) {
      minDensity = density;
    }
    if (density > maxDensity) {
      maxDensity = density;
    }
  }

  if (!Number.isFinite(minDensity)) {
    minDensity = 0;
  }
  if (!Number.isFinite(maxDensity)) {
    maxDensity = 0;
  }

  liveDensityRange = {
    min: minDensity,
    max: maxDensity,
    totalAvailable: totalAvailable,
    stepMinutes: LIVE_DENSITY_SAMPLE_STEP_MINUTES,
    samples: samples,
  };

  console.log("=== LIVE DENSITY RANGE (10-minute sample) ===");
  console.log("min:", minDensity);
  console.log("max:", maxDensity);
  console.log("totalAvailable:", totalAvailable);
  console.log("samples:", samples.length);

  return liveDensityRange;
}

function getLiveDensityStrength(density) {
  if (!liveDensityRange) {
    return clamp01(density);
  }

  const min = liveDensityRange.min;
  const max = liveDensityRange.max;

  if (!Number.isFinite(density)) {
    return 0;
  }

  if (max === min) {
    // safe neutral — avoid divide-by-zero / NaN.
    return 0.5;
  }

  return clamp01((density - min) / (max - min));
}

function calculateExpressiveState(activeDataState) {
  if (!activeDataState || activeDataState.totalActive <= 0) {
    return emptyExpressiveState();
  }

  const composition = activeDataState.composition || emptyCategoryNumberMap();

  const workPressure = clamp01(composition.workSchool);
  const socialEnergy = clamp01(composition.events);
  const inwardness = clamp01(composition.personal);
  const order = clamp01(composition.planningReset);

  let densityStrength = 0;
  if (activeDataState.mode === "live") {
    densityStrength = getLiveDensityStrength(activeDataState.density);
  } else {
    densityStrength = clamp01(activeDataState.density);
  }

  const ranked = [
    { id: "workSchool", value: workPressure },
    { id: "events", value: socialEnergy },
    { id: "personal", value: inwardness },
    { id: "planningReset", value: order },
  ];

  ranked.sort(function (a, b) {
    return b.value - a.value;
  });

  const highest = ranked[0];
  const second = ranked[1];
  const dominantCategory = highest && highest.value > 0 ? highest.id : "none";
  const dominance = highest ? clamp01(highest.value) : 0;
  const confidence = clamp01(
    (highest ? highest.value : 0) - (second ? second.value : 0),
  );

  return {
    workPressure: workPressure,
    socialEnergy: socialEnergy,
    inwardness: inwardness,
    order: order,
    densityStrength: densityStrength,
    dominantCategory: dominantCategory,
    dominance: dominance,
    confidence: confidence,
  };
}

/*
  data-only day scan of expressive extrema (10-minute steps).
  does not modify the visible visualization.
*/
function analyzeLiveDayExpressiveExtrema() {
  if (!liveDensityRange) {
    computeLiveDensityRange();
  }

  const records = [];
  forEachMeaningfulVisualRecord(function (record, categoryId) {
    records.push({ record: record, categoryId: categoryId });
  });
  const totalAvailable = records.length;

  const extrema = {
    workPressure: null,
    socialEnergy: null,
    inwardness: null,
    order: null,
    density: null,
    lowestNonZeroDensity: null,
  };

  function considerMax(key, minutes, value, payload) {
    if (!extrema[key] || value > extrema[key].value) {
      extrema[key] = {
        minutes: minutes,
        value: value,
        payload: payload,
      };
    }
  }

  for (
    let minutes = 0;
    minutes < 24 * 60;
    minutes += LIVE_DENSITY_SAMPLE_STEP_MINUTES
  ) {
    const counts = emptyCategoryNumberMap();
    let totalActive = 0;

    for (let i = 0; i < records.length; i++) {
      const entry = records[i];
      if (taskMatchesTime(entry.record, minutes)) {
        counts[entry.categoryId] += 1;
        totalActive += 1;
      }
    }

    const density = safeRatio(totalActive, totalAvailable);
    const composition = emptyCategoryNumberMap();
    for (let c = 0; c < ACTIVE_DATA_CATEGORY_IDS.length; c++) {
      const id = ACTIVE_DATA_CATEGORY_IDS[c];
      composition[id] =
        totalActive > 0 ? safeRatio(counts[id], totalActive) : 0;
    }

    const activeState = {
      mode: "live",
      density: density,
      composition: composition,
      totalActive: totalActive,
      counts: counts,
    };
    const expressive = calculateExpressiveState(activeState);

    considerMax("workPressure", minutes, expressive.workPressure, expressive);
    considerMax("socialEnergy", minutes, expressive.socialEnergy, expressive);
    considerMax("inwardness", minutes, expressive.inwardness, expressive);
    considerMax("order", minutes, expressive.order, expressive);
    considerMax("density", minutes, density, {
      density: density,
      totalActive: totalActive,
      expressive: expressive,
    });

    if (
      density > 0 &&
      (!extrema.lowestNonZeroDensity ||
        density < extrema.lowestNonZeroDensity.value)
    ) {
      extrema.lowestNonZeroDensity = {
        minutes: minutes,
        value: density,
        payload: {
          density: density,
          totalActive: totalActive,
          expressive: expressive,
        },
      };
    }
  }

  return extrema;
}

function formatExpressivePercent(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return "0%";
  }
  const pct = clamp01(ratio) * 100;
  if (pct < 0.1) {
    return "<0.1%";
  }
  if (pct < 10) {
    return pct.toFixed(1).replace(/\.0$/, "") + "%";
  }
  return Math.round(pct) + "%";
}

/* metrics stay internal. visitor panel shows deformation ON/OFF only. */
function updateDevelopmentReadout(expressiveState) {
  // no-op
}

function emptyTirednessState() {
  return {
    mode: interactionMode,
    workCount: 0,
    eventsCount: 0,
    workEnergy: 0,
    eventsEnergy: 0,
    rawTirednessEnergy: 0,
    availableWeightedEnergy: 0,
    normalizedEnergy: 0,
    deformationAmount: 0,
    referenceEnergy: TIREDNESS_REFERENCE_ENERGY,
  };
}

/* core step 8 equation. green = 1.0, pink = 0.5. counts, not composition. */
function computeWeightedTirednessEnergy(workCount, eventsCount) {
  const work = Number.isFinite(workCount) ? Math.max(0, workCount) : 0;
  const events = Number.isFinite(eventsCount) ? Math.max(0, eventsCount) : 0;
  return work * WORK_ENERGY_WEIGHT + events * EVENTS_ENERGY_WEIGHT;
}

function runTirednessEnergyUnitTests() {
  const cases = [
    { work: 10, events: 0, expected: 10 },
    { work: 0, events: 10, expected: 5 },
    { work: 5, events: 10, expected: 10 },
    { work: 20, events: 20, expected: 30 },
  ];
  const results = [];
  let allPassed = true;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const got = computeWeightedTirednessEnergy(c.work, c.events);
    const ok = Math.abs(got - c.expected) < 1e-9;
    if (!ok) {
      allPassed = false;
    }
    results.push({
      work: c.work,
      events: c.events,
      expected: c.expected,
      got: got,
      ok: ok,
    });
  }
  console.log("=== STEP 8 TIREDNESS ENERGY UNIT TESTS ===");
  console.log(results);
  console.log(allPassed ? "ALL PASSED" : "FAILED");
  return { allPassed: allPassed, results: results };
}

/* sample live day at 10-minute steps. sets tiredness_reference_energy = p95. */
function computeLiveTirednessEnergyDistribution() {
  const tagged = [];
  forEachMeaningfulVisualRecord(function (record, categoryId) {
    tagged.push({ record: record, categoryId: categoryId });
  });

  const energies = [];
  for (
    let minutes = 0;
    minutes < 24 * 60;
    minutes += LIVE_DENSITY_SAMPLE_STEP_MINUTES
  ) {
    let workCount = 0;
    let eventsCount = 0;
    for (let i = 0; i < tagged.length; i++) {
      const entry = tagged[i];
      if (!taskMatchesTime(entry.record, minutes)) {
        continue;
      }
      if (entry.categoryId === "workSchool") {
        workCount += 1;
      } else if (entry.categoryId === "events") {
        eventsCount += 1;
      }
    }
    energies.push(computeWeightedTirednessEnergy(workCount, eventsCount));
  }

  const sorted = energies.slice().sort(function (a, b) {
    return a - b;
  });
  const distribution = {
    min: sorted.length ? sorted[0] : 0,
    median: percentileSorted(sorted, 50),
    p75: percentileSorted(sorted, 75),
    p90: percentileSorted(sorted, 90),
    p95: percentileSorted(sorted, 95),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    sampleCount: sorted.length,
    stepMinutes: LIVE_DENSITY_SAMPLE_STEP_MINUTES,
  };

  TIREDNESS_REFERENCE_ENERGY =
    distribution.p95 > 0 ? distribution.p95 : distribution.max || 1;
  liveTirednessEnergyDistribution = distribution;

  console.log("=== STEP 8 LIVE TIREDNESS ENERGY DISTRIBUTION ===");
  console.log(distribution);
  console.log("TIREDNESS_REFERENCE_ENERGY (p95):", TIREDNESS_REFERENCE_ENERGY);

  return distribution;
}

function getYearWeightedEnergyReport() {
  const years = [2023, 2024, 2025, 2026];
  const report = {};
  for (let i = 0; i < years.length; i++) {
    const year = years[i];
    let workCount = 0;
    let eventsCount = 0;
    forEachMeaningfulVisualRecord(function (record, categoryId) {
      if (!recordMatchesYear(record, year)) {
        return;
      }
      if (categoryId === "workSchool") {
        workCount += 1;
      } else if (categoryId === "events") {
        eventsCount += 1;
      }
    });
    report[year] = {
      workCount: workCount,
      eventsCount: eventsCount,
      workEnergy: workCount * WORK_ENERGY_WEIGHT,
      eventsEnergy: eventsCount * EVENTS_ENERGY_WEIGHT,
      weightedEnergy: computeWeightedTirednessEnergy(workCount, eventsCount),
    };
  }
  console.log("=== STEP 8 YEAR WEIGHTED ENERGY ===");
  console.log(report);
  return report;
}

/*
  step 8 — data → deformationAmount (0→1).
  LIVE: raw / tiredness_reference_energy, then curve.
  SETTINGS: activeWeighted / availableWeighted (same 1.0 / 0.5 weights).
*/
function calculateTirednessState(activeDataState) {
  const state = emptyTirednessState();
  if (!activeDataState) {
    return state;
  }

  const workCount = activeDataState.counts
    ? activeDataState.counts.workSchool || 0
    : 0;
  const eventsCount = activeDataState.counts
    ? activeDataState.counts.events || 0
    : 0;
  const workEnergy = workCount * WORK_ENERGY_WEIGHT;
  const eventsEnergy = eventsCount * EVENTS_ENERGY_WEIGHT;
  const rawTirednessEnergy = workEnergy + eventsEnergy;

  const availWork = activeDataState.baselines
    ? activeDataState.baselines.workSchool || 0
    : 0;
  const availEvents = activeDataState.baselines
    ? activeDataState.baselines.events || 0
    : 0;
  const availableWeightedEnergy = computeWeightedTirednessEnergy(
    availWork,
    availEvents,
  );

  let normalizedEnergy = 0;
  if (activeDataState.mode === "settings") {
    normalizedEnergy =
      availableWeightedEnergy > 0
        ? clamp01(rawTirednessEnergy / availableWeightedEnergy)
        : 0;
  } else {
    const reference =
      TIREDNESS_REFERENCE_ENERGY > 0 ? TIREDNESS_REFERENCE_ENERGY : 1;
    normalizedEnergy = clamp01(rawTirednessEnergy / reference);
  }

  const deformationAmount = Math.pow(
    normalizedEnergy,
    TIREDNESS_CURVE_EXPONENT,
  );

  state.mode = activeDataState.mode || interactionMode;
  state.workCount = workCount;
  state.eventsCount = eventsCount;
  state.workEnergy = workEnergy;
  state.eventsEnergy = eventsEnergy;
  state.rawTirednessEnergy = rawTirednessEnergy;
  state.availableWeightedEnergy = availableWeightedEnergy;
  state.normalizedEnergy = normalizedEnergy;
  state.deformationAmount = clamp01(deformationAmount);
  state.referenceEnergy = TIREDNESS_REFERENCE_ENERGY;
  return state;
}
