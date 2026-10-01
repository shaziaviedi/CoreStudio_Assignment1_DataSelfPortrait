// portrait deformation from the Illustrator field

/*
  step 7b — Illustrator-derived late-night deformation field
  production portrait.svg stays visible. prototype SVG is reference
  geometry only: index-mapped residuals become the work field.
*/

function smoothstep(edge0, edge1, x) {
  if (edge1 === edge0) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clampMagnitude(dx, dy, maxMag) {
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(mag) || mag <= maxMag || mag === 0) {
    return { dx: dx || 0, dy: dy || 0 };
  }
  const scale = maxMag / mag;
  return { dx: dx * scale, dy: dy * scale };
}

function percentileSorted(sortedValues, p) {
  if (!sortedValues || sortedValues.length === 0) {
    return 0;
  }
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.round((p / 100) * (sortedValues.length - 1))),
  );
  return sortedValues[idx];
}

function parseSlotNumericIndex(slotId) {
  const match = /^slot-(\d+)$/i.exec(slotId || "");
  return match ? parseInt(match[1], 10) : null;
}

/*
  canonical prototype ids: task-nnnn-*-circles
  ignore illustrative duplicates: *-circles-2 / *-glyphs-2
*/
function parseCanonicalPrototypeIndex(elementId) {
  const match = /^task-(\d+)-.+-circles$/i.exec(elementId || "");
  return match ? parseInt(match[1], 10) : null;
}

function getProvisionalFieldUnit() {
  if (portraitDeformBounds && portraitDeformBounds.width) {
    return portraitDeformBounds.width * PROVISIONAL_FIELD_FRACTION;
  }
  return 8;
}

/*
  cache each portrait slot's immutable Illustrator home + regional weights.
  call once after slots exist and before any deformation transform is applied.
*/
function cachePortraitDeformationHomes(slots) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const centers = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    let bbox;
    try {
      bbox = slot.getBBox();
    } catch (error) {
      centers.push(null);
      continue;
    }

    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    centers.push({ cx: cx, cy: cy, width: bbox.width, height: bbox.height });

    if (cx < minX) minX = cx;
    if (cy < minY) minY = cy;
    if (cx > maxX) maxX = cx;
    if (cy > maxY) maxY = cy;
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const halfW = width / 2;
  const halfH = height / 2;

  portraitDeformBounds = {
    minX: minX,
    minY: minY,
    maxX: maxX,
    maxY: maxY,
    width: width,
    height: height,
    centerX: centerX,
    centerY: centerY,
    provisionalUnit: width * PROVISIONAL_FIELD_FRACTION,
  };

  for (let j = 0; j < slots.length; j++) {
    const slot = slots[j];
    const center = centers[j];
    if (!center) {
      slot.deformHome = null;
      continue;
    }

    const nx = clamp01Range((center.cx - centerX) / halfW);
    const ny = clamp01Range((center.cy - centerY) / halfH);

    // continuous region weights from original spatial coordinates (0→1).
    // still used by provisional social/personal fields only.
    const upperWeight = clamp01(0.5 - ny * 0.5);
    const lowerWeight = clamp01(0.5 + ny * 0.5);
    const outerWeight = clamp01(Math.abs(nx));
    const centerWeight = clamp01(1 - Math.abs(nx));

    const eyeNy = -0.2;
    const eyeSigma = 0.15;
    const eyeBand = Math.exp(
      -((ny - eyeNy) * (ny - eyeNy)) / (2 * eyeSigma * eyeSigma),
    );
    const eyeWeight = clamp01(eyeBand * (0.3 + 0.7 * centerWeight));

    slot.deformHome = {
      originalX: center.cx,
      originalY: center.cy,
      nx: nx,
      ny: ny,
      upperWeight: upperWeight,
      lowerWeight: lowerWeight,
      outerWeight: outerWeight,
      centerWeight: centerWeight,
      eyeWeight: eyeWeight,
    };
    slot.deformFields = {
      work: { dx: 0, dy: 0 },
      social: null,
      personal: null,
    };
    slot.slotIndex = parseSlotNumericIndex(slot.id);
    slot.deformDx = 0;
    slot.deformDy = 0;
    slot.deformTargetDx = 0;
    slot.deformTargetDy = 0;
    slot.deformFromDx = 0;
    slot.deformFromDy = 0;
    slot.removeAttribute("transform");
  }

  console.log("=== PORTRAIT DEFORMATION HOMES CACHED ===");
  console.log("slots:", slots.length);
  console.log("portrait width:", width);
  console.log("provisionalUnit:", portraitDeformBounds.provisionalUnit);
}

function clamp01Range(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < -1) {
    return -1;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function extractCanonicalPrototypePositions(prototypeDocument) {
  const byIndex = new Map();
  const duplicateCanonical = [];
  const ignoredDuplicates = [];
  const groups = prototypeDocument.querySelectorAll("[id]");

  for (let i = 0; i < groups.length; i++) {
    const el = groups[i];
    const id = el.getAttribute("id") || "";

    if (/^task-\d+-.+-circles-\d+$/i.test(id) || /glyphs-2$/i.test(id)) {
      ignoredDuplicates.push(id);
      continue;
    }

    const index = parseCanonicalPrototypeIndex(id);
    if (index === null) {
      continue;
    }

    const circle = el.querySelector("circle");
    if (!circle) {
      continue;
    }

    const cx = Number(circle.getAttribute("cx"));
    const cy = Number(circle.getAttribute("cy"));
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
      continue;
    }

    if (byIndex.has(index)) {
      duplicateCanonical.push(id);
      continue;
    }

    byIndex.set(index, { x: cx, y: cy, id: id });
  }

  return {
    byIndex: byIndex,
    duplicateCanonical: duplicateCanonical,
    ignoredDuplicates: ignoredDuplicates,
  };
}

/*
  best-fit uniform similarity: prototype ≈ s * production + (tx, ty)
  same s for x and y. least-squares over ALL matched nodes.
*/
function fitGlobalAlignment(pairs) {
  const n = pairs.length;
  if (n === 0) {
    return { S: 1, tx: 0, ty: 0 };
  }

  let meanPx = 0;
  let meanPy = 0;
  let meanQx = 0;
  let meanQy = 0;
  for (let i = 0; i < n; i++) {
    meanPx += pairs[i].productionX;
    meanPy += pairs[i].productionY;
    meanQx += pairs[i].prototypeX;
    meanQy += pairs[i].prototypeY;
  }
  meanPx /= n;
  meanPy /= n;
  meanQx /= n;
  meanQy /= n;

  let numerator = 0;
  let denominator = 0;
  for (let j = 0; j < n; j++) {
    const dx = pairs[j].productionX - meanPx;
    const dy = pairs[j].productionY - meanPy;
    const qx = pairs[j].prototypeX - meanQx;
    const qy = pairs[j].prototypeY - meanQy;
    numerator += dx * qx + dy * qy;
    denominator += dx * dx + dy * dy;
  }

  const S = denominator > 0 ? numerator / denominator : 1;
  const tx = meanQx - S * meanPx;
  const ty = meanQy - S * meanPy;
  return { S: S, tx: tx, ty: ty };
}

/*
  soft dead-zone in production units.
  below threshold → 0. between threshold and 2×threshold → smoothstep ramp.
*/
function applyIllustratorDeadZone(dx, dy, threshold) {
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(mag) || mag === 0) {
    return { dx: 0, dy: 0, mag: 0 };
  }
  if (mag <= threshold) {
    return { dx: 0, dy: 0, mag: 0 };
  }

  const softEnd = threshold * 2;
  if (mag < softEnd) {
    const t = (mag - threshold) / (softEnd - threshold);
    const s = t * t * (3 - 2 * t);
    return { dx: dx * s, dy: dy * s, mag: mag * s };
  }

  return { dx: dx, dy: dy, mag: mag };
}

/*
  obsolete step 7 SETTINGS/LIVE amplitude helpers — disabled.
  deformation amount is calculated exclusively by calculateTirednessState (step 8).
*/
function getSettingsManipulationAmount() {
  return 0;
}

function getWorkExpression() {
  return lastDeformationAmount;
}

function getDeformationSupport() {
  return 1;
}

function getEffectiveDeformationStrength() {
  return lastDeformationAmount;
}

/*
  per-node offset: Illustrator residual × deformationAmount × scales.
  no social / personal / order contributions.
*/
function calculateNodeDeformation(slot, deformationAmount) {
  const home = slot && slot.deformHome;
  if (!home) {
    return { dx: 0, dy: 0 };
  }

  if (!deformationEnabled || !Number.isFinite(deformationAmount) || deformationAmount <= 0) {
    return { dx: 0, dy: 0 };
  }

  const workField =
    slot.deformFields && slot.deformFields.work ? slot.deformFields.work : null;
  if (!workField) {
    return { dx: 0, dy: 0 };
  }

  let dx =
    workField.dx *
    deformationAmount *
    ILLUSTRATOR_WORK_SCALE *
    deformationDevMultiplier;
  let dy =
    workField.dy *
    deformationAmount *
    ILLUSTRATOR_WORK_SCALE *
    deformationDevMultiplier;

  const safetyCap =
    deformationFields.work && deformationFields.work.safetyCap
      ? deformationFields.work.safetyCap
      : getProvisionalFieldUnit();
  const cap = safetyCap * Math.max(deformationDevMultiplier, 1);

  return clampMagnitude(dx, dy, cap);
}

/*
  fetch prototype once, derive 2383 production-space work vectors,
  assign onto slots.deformFields.work. validates mapping before apply.
*/
async function buildIllustratorWorkFieldFromPrototype(slots) {
  const response = await fetch(ILLUSTRATOR_PROTOTYPE_URL);
  if (!response.ok) {
    throw new Error(
      "Failed to fetch Illustrator prototype: " + response.status,
    );
  }
  const text = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Failed to parse Illustrator prototype SVG");
  }

  const extracted = extractCanonicalPrototypePositions(doc);
  const prototypeByIndex = extracted.byIndex;

  const productionByIndex = new Map();
  const missingProductionHomes = [];
  const duplicateProduction = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const index = parseSlotNumericIndex(slot.id);
    if (index === null) {
      continue;
    }
    if (!slot.deformHome) {
      missingProductionHomes.push(slot.id);
      continue;
    }
    if (productionByIndex.has(index)) {
      duplicateProduction.push(slot.id);
      continue;
    }

    // prefer the slot's background circle (matches prototype circle geometry).
    let prodX = slot.deformHome.originalX;
    let prodY = slot.deformHome.originalY;
    const bgCircle =
      slot.querySelector("circle[id$='-background']") ||
      slot.querySelector("circle");
    if (bgCircle) {
      const cx = Number(bgCircle.getAttribute("cx"));
      const cy = Number(bgCircle.getAttribute("cy"));
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        prodX = cx;
        prodY = cy;
      }
    }

    productionByIndex.set(index, {
      slot: slot,
      x: prodX,
      y: prodY,
    });
  }

  const expected = 2383;
  const matched = [];
  const missingProductionNodes = [];
  const missingPrototypeNodes = [];

  for (let index = 1; index <= expected; index++) {
    const hasProd = productionByIndex.has(index);
    const hasProto = prototypeByIndex.has(index);
    if (!hasProd) {
      missingProductionNodes.push(index);
    }
    if (!hasProto) {
      missingPrototypeNodes.push(index);
    }
    if (hasProd && hasProto) {
      const prod = productionByIndex.get(index);
      const proto = prototypeByIndex.get(index);
      matched.push({
        index: index,
        slot: prod.slot,
        productionX: prod.x,
        productionY: prod.y,
        prototypeX: proto.x,
        prototypeY: proto.y,
        prototypeId: proto.id,
      });
    }
  }

  const validation = {
    matchedCanonicalNodes: matched.length,
    missingProductionNodes: missingProductionNodes.length,
    missingPrototypeCanonicalNodes: missingPrototypeNodes.length,
    duplicateCanonicalMappings:
      extracted.duplicateCanonical.length + duplicateProduction.length,
    ignoredIllustrativeDuplicates: extracted.ignoredDuplicates.length,
  };

  console.log("=== STEP 7B INDEX MAPPING VALIDATION ===");
  console.log(validation);

  if (
    validation.matchedCanonicalNodes !== expected ||
    validation.missingProductionNodes !== 0 ||
    validation.missingPrototypeCanonicalNodes !== 0 ||
    validation.duplicateCanonicalMappings !== 0
  ) {
    console.error("STEP 7B STOP: index mapping validation failed.");
    return { ok: false, reason: "index-mapping", validation: validation };
  }

  const alignment = fitGlobalAlignment(matched);
  const { S, tx, ty } = alignment;

  const residualMags = [];
  const productionMagsRaw = [];
  const productionMagsDeadzoned = [];
  let maxIllustratorVectorMagnitude = 0;
  let nonZeroAfterDeadzone = 0;

  for (let k = 0; k < matched.length; k++) {
    const pair = matched[k];
    const expectedX = S * pair.productionX + tx;
    const expectedY = S * pair.productionY + ty;
    const residualX = pair.prototypeX - expectedX;
    const residualY = pair.prototypeY - expectedY;
    const residualMag = Math.sqrt(
      residualX * residualX + residualY * residualY,
    );
    residualMags.push(residualMag);

    const rawDx = residualX / S;
    const rawDy = residualY / S;
    const rawMag = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
    productionMagsRaw.push(rawMag);

    const deadzoned = applyIllustratorDeadZone(
      rawDx,
      rawDy,
      ILLUSTRATOR_DEADZONE_PRODUCTION,
    );
    productionMagsDeadzoned.push(deadzoned.mag);

    if (deadzoned.mag > 0) {
      nonZeroAfterDeadzone += 1;
    }
    if (deadzoned.mag > maxIllustratorVectorMagnitude) {
      maxIllustratorVectorMagnitude = deadzoned.mag;
    }

    if (!pair.slot.deformFields) {
      pair.slot.deformFields = { work: null, social: null, personal: null };
    }
    pair.slot.deformFields.work = {
      dx: deadzoned.dx,
      dy: deadzoned.dy,
      rawDx: rawDx,
      rawDy: rawDy,
    };
  }

  residualMags.sort(function (a, b) {
    return a - b;
  });
  productionMagsRaw.sort(function (a, b) {
    return a - b;
  });
  productionMagsDeadzoned.sort(function (a, b) {
    return a - b;
  });

  const residualStats = {
    p50: percentileSorted(residualMags, 50),
    p90: percentileSorted(residualMags, 90),
    p95: percentileSorted(residualMags, 95),
    max: residualMags[residualMags.length - 1] || 0,
  };

  const workVectorStats = {
    p50: percentileSorted(productionMagsDeadzoned, 50),
    p90: percentileSorted(productionMagsDeadzoned, 90),
    p95: percentileSorted(productionMagsDeadzoned, 95),
    max: maxIllustratorVectorMagnitude,
    rawP50: percentileSorted(productionMagsRaw, 50),
    rawMax: productionMagsRaw[productionMagsRaw.length - 1] || 0,
  };

  // guard: residuals should resemble the audit (~p50≈1.14, max≈36).
  // allow headroom for bbox-vs-circle and exact ls fit differences.
  if (residualStats.max > 80 || residualStats.p50 > 8) {
    console.error(
      "STEP 7B STOP: residual statistics look wrong.",
      residualStats,
    );
    return {
      ok: false,
      reason: "bad-alignment",
      alignment: alignment,
      residualStats: residualStats,
    };
  }

  const safetyCap = maxIllustratorVectorMagnitude * 1.05;

  deformationFields.work = {
    source: ILLUSTRATOR_PROTOTYPE_URL,
    state: "STATE_03_Late_Night_High_Density",
    alignment: alignment,
    residualStats: residualStats,
    workVectorStats: workVectorStats,
    deadzone: ILLUSTRATOR_DEADZONE_PRODUCTION,
    nonZeroAfterDeadzone: nonZeroAfterDeadzone,
    maxIllustratorVectorMagnitude: maxIllustratorVectorMagnitude,
    safetyCap: safetyCap,
    matchedCount: matched.length,
    vectors: null, // reserved for later lightweight export
  };

  if (portraitDeformBounds) {
    portraitDeformBounds.maxDisplacement = safetyCap;
    portraitDeformBounds.illustratorSafetyCap = safetyCap;
  }

  console.log("=== STEP 7B GLOBAL ALIGNMENT ===");
  console.log("S:", S);
  console.log("tx:", tx);
  console.log("ty:", ty);
  console.log("=== STEP 7B RESIDUAL STATS (prototype units) ===");
  console.log(residualStats);
  console.log(
    "=== STEP 7B WORK VECTORS (production units, after dead-zone) ===",
  );
  console.log(workVectorStats);
  console.log("dead-zone:", ILLUSTRATOR_DEADZONE_PRODUCTION);
  console.log("non-zero after dead-zone:", nonZeroAfterDeadzone);
  console.log("ILLUSTRATOR_SAFETY_CAP:", safetyCap);

  return {
    ok: true,
    alignment: alignment,
    residualStats: residualStats,
    workVectorStats: workVectorStats,
    validation: validation,
    nonZeroAfterDeadzone: nonZeroAfterDeadzone,
    safetyCap: safetyCap,
  };
}

function setSlotDeformationTransform(slot, dx, dy) {
  if (!slot) {
    return;
  }

  slot.deformDx = dx;
  slot.deformDy = dy;

  if (dx === 0 && dy === 0) {
    slot.removeAttribute("transform");
    return;
  }

  slot.setAttribute("transform", "translate(" + dx + " " + dy + ")");
}

function cancelDeformationAnimation() {
  if (deformAnimRafId !== null) {
    cancelAnimationFrame(deformAnimRafId);
    deformAnimRafId = null;
  }
  deformAnimStart = null;
}

function ensureIllustratorVectorOverlay() {
  if (!portraitSvg) {
    return null;
  }
  let group = portraitSvg.getElementById("dev-illustrator-vector-overlay");
  if (!group) {
    group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("id", "dev-illustrator-vector-overlay");
    group.setAttribute("pointer-events", "none");
    portraitSvg.appendChild(group);
  }
  return group;
}

/* development only — sparse sample of Illustrator work vectors from home. */
function updateIllustratorVectorOverlay() {
  const group = ensureIllustratorVectorOverlay();
  if (!group) {
    return;
  }

  while (group.firstChild) {
    group.removeChild(group.firstChild);
  }

  if (!showIllustratorVectors || !portraitSlots || portraitSlots.length === 0) {
    group.setAttribute("display", "none");
    return;
  }

  group.setAttribute("display", "inline");
  const sampleStep = 40;
  const magThreshold = ILLUSTRATOR_DEADZONE_PRODUCTION;

  for (let i = 0; i < portraitSlots.length; i++) {
    const slot = portraitSlots[i];
    const home = slot.deformHome;
    const field = slot.deformFields && slot.deformFields.work;
    if (!home || !field) {
      continue;
    }

    const mag = Math.sqrt(field.dx * field.dx + field.dy * field.dy);
    const sampleHit = i % sampleStep === 0;
    if (!sampleHit && mag < magThreshold * 4) {
      continue;
    }
    if (mag < magThreshold) {
      continue;
    }

    const x1 = home.originalX;
    const y1 = home.originalY;
    const x2 = x1 + field.dx;
    const y2 = y1 + field.dy;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    line.setAttribute("stroke", "#ff3b30");
    line.setAttribute("stroke-width", "1.25");
    line.setAttribute("stroke-opacity", "0.85");
    group.appendChild(line);

    const tip = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    tip.setAttribute("cx", String(x2));
    tip.setAttribute("cy", String(y2));
    tip.setAttribute("r", "1.6");
    tip.setAttribute("fill", "#ff3b30");
    tip.setAttribute("fill-opacity", "0.9");
    group.appendChild(tip);
  }
}

function applyPortraitDeformation(expressiveState) {
  if (!portraitSlots || portraitSlots.length === 0) {
    return;
  }

  const tiredness = calculateTirednessState(lastActiveDataState);
  lastTirednessState = tiredness;

  const deformationAmount = deformationEnabled
    ? tiredness.deformationAmount
    : 0;
  lastDeformationAmount = deformationAmount;
  lastWorkExpression = deformationAmount;
  lastEffectiveStrength = deformationAmount;
  lastSettingsManipulationAmount = 0;

  let maxTarget = 0;

  for (let i = 0; i < portraitSlots.length; i++) {
    const slot = portraitSlots[i];
    if (!slot.deformHome) {
      continue;
    }

    const offset = calculateNodeDeformation(slot, deformationAmount);
    slot.deformFromDx = typeof slot.deformDx === "number" ? slot.deformDx : 0;
    slot.deformFromDy = typeof slot.deformDy === "number" ? slot.deformDy : 0;
    slot.deformTargetDx = offset.dx;
    slot.deformTargetDy = offset.dy;

    const mag = Math.sqrt(offset.dx * offset.dx + offset.dy * offset.dy);
    if (mag > maxTarget) {
      maxTarget = mag;
    }
  }

  lastMaxAppliedDisplacement = maxTarget;

  cancelDeformationAnimation();

  if (prefersReducedMotion) {
    for (let j = 0; j < portraitSlots.length; j++) {
      const slot = portraitSlots[j];
      if (!slot.deformHome) {
        continue;
      }
      setSlotDeformationTransform(
        slot,
        slot.deformTargetDx,
        slot.deformTargetDy,
      );
    }
    updateIllustratorVectorOverlay();
    updateDevelopmentReadout(
      expressiveState || lastExpressiveState || emptyExpressiveState(),
    );
    return;
  }

  deformAnimStart = performance.now();

  function tick(now) {
    const t = Math.min(1, (now - deformAnimStart) / DEFORM_ANIM_MS);
    const e = easeOutCubic(t);

    for (let k = 0; k < portraitSlots.length; k++) {
      const slot = portraitSlots[k];
      if (!slot.deformHome) {
        continue;
      }
      const dx = lerp(slot.deformFromDx, slot.deformTargetDx, e);
      const dy = lerp(slot.deformFromDy, slot.deformTargetDy, e);
      setSlotDeformationTransform(slot, dx, dy);
    }

    if (t >= 1) {
      deformAnimRafId = null;
      deformAnimStart = null;
      updateIllustratorVectorOverlay();
      return;
    }

    deformAnimRafId = requestAnimationFrame(tick);
  }

  deformAnimRafId = requestAnimationFrame(tick);
  updateDevelopmentReadout(
    expressiveState || lastExpressiveState || emptyExpressiveState(),
  );
}

function getSlotDisplayCenter(slot) {
  if (!slot) {
    return { x: 0, y: 0 };
  }

  if (slot.deformHome) {
    // prefer deformation target so click-to-task during a transition
    // flies to where the node will settle (not mid-animation / neutral home).
    const dx =
      typeof slot.deformTargetDx === "number"
        ? slot.deformTargetDx
        : slot.deformDx || 0;
    const dy =
      typeof slot.deformTargetDy === "number"
        ? slot.deformTargetDy
        : slot.deformDy || 0;
    return {
      x: slot.deformHome.originalX + dx,
      y: slot.deformHome.originalY + dy,
    };
  }

  try {
    const bbox = slot.getBBox();
    return {
      x: bbox.x + bbox.width / 2,
      y: bbox.y + bbox.height / 2,
    };
  } catch (error) {
    return { x: 0, y: 0 };
  }
}

/* development only — remove before final */
function updateDeformationControlUI() {
  if (devDeformToggle) {
    devDeformToggle.setAttribute(
      "aria-pressed",
      deformationEnabled ? "true" : "false",
    );
    devDeformToggle.textContent = deformationEnabled ? "ON" : "OFF";
  }
}

function initializeDeformationControls() {
  updateDeformationControlUI();

  if (devDeformToggle) {
    isolateUiFromCamera(devDeformToggle);
    devDeformToggle.addEventListener("click", function () {
      deformationEnabled = !deformationEnabled;
      updateDeformationControlUI();
      applyPortraitDeformation(lastExpressiveState || emptyExpressiveState());
    });
  }
}
