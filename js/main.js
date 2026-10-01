// task panel, selection, slot clicks + init

function showTaskPanel(task) {
  if (!taskPanel || !task) {
    return;
  }

  taskTitleEl.textContent = task.title || "";
  taskDateEl.textContent = formatTaskDate(task.day);
  taskTimeEl.textContent = formatStartTime(task.startTime);
  taskDurationEl.textContent = formatDuration(task.duration);

  taskPanel.hidden = false;
  void taskPanel.offsetWidth;
  taskPanel.classList.add("is-visible");
}

function hideTaskPanel() {
  if (!taskPanel) {
    return;
  }

  taskPanel.classList.remove("is-visible");
  window.setTimeout(
    function () {
      if (!taskPanel.classList.contains("is-visible")) {
        taskPanel.hidden = true;
        taskTitleEl.textContent = "";
        taskDateEl.textContent = "";
        taskTimeEl.textContent = "";
        taskDurationEl.textContent = "";
      }
    },
    prefersReducedMotion ? 0 : 260,
  );
}

function clearSelectedTask() {
  if (selectedSlot) {
    selectedSlot.classList.remove("is-selected");
  }
  selectedSlot = null;
  selectedTask = null;
  selectedFocusWidth = null;
  pendingTaskPanelReveal = false;
  hideTaskPanel();
  updateZoomChrome();
}

function maybeClearSelectionAfterCameraMove() {
  if (!selectedTask || !selectedFocusWidth || !camera) {
    return;
  }

  if (
    cameraAnimating &&
    cameraAnimTo &&
    cameraAnimTo.width <= selectedFocusWidth * 1.1
  ) {
    return;
  }

  if (camera.width > selectedFocusWidth * TASK_PANEL_REVEAL_DISTANCE) {
    clearSelectedTask();
  }
}

function buildTaskFocusViewBox(slot) {
  // prefer current displayed center (includes deformation offsets).
  const display = getSlotDisplayCenter(slot);
  const centerX = display.x;
  const centerY = display.y;

  let base = 1;
  if (slot && slot.deformHome) {
    // approximate slot size from home cache when available.
    base = Math.max(base, 12);
  }
  try {
    const bbox = slot.getBBox();
    base = Math.max(bbox.width, bbox.height, base);
  } catch (error) {
    // keep fallback base
  }

  const size = base * TASK_VIEW_PADDING;
  const aspect = originalViewBox.height / originalViewBox.width;

  let width = size;
  width = Math.min(
    Math.max(width, originalViewBox.width / MAX_ZOOM),
    originalViewBox.width / MIN_ZOOM,
  );
  const height = width * aspect;

  return clampCamera({
    x: centerX - width / 2,
    y: centerY - height / 2,
    width: width,
    height: height,
  });
}

function zoomToTask(slot, task) {
  if (selectedSlot && selectedSlot !== slot) {
    selectedSlot.classList.remove("is-selected");
  }

  selectedSlot = slot;
  selectedTask = task;
  if (slot) {
    slot.classList.add("is-selected");
  }

  const focus = buildTaskFocusViewBox(slot);
  selectedFocusWidth = focus.width;

  // task→task: refresh panel content immediately so the prior title does not linger.
  if (
    taskPanel &&
    !taskPanel.hidden &&
    taskPanel.classList.contains("is-visible")
  ) {
    showTaskPanel(task);
  }

  // animate from wherever the user currently is — never via the full portrait.
  animateToViewBox(focus, { revealTaskPanel: true });
  updateZoomChrome();
}

function resetView() {
  clearSelectedTask();
  animateToViewBox(copyViewBox(originalViewBox));
}

// click uses the task stored on the slot during assignment.
function addSlotInteraction(slots) {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];

    if (!slot.classList.contains("task-slot")) {
      continue;
    }

    slot.addEventListener("click", function (event) {
      // drag-to-pan on a circle should not also select that task.
      if (shouldIgnoreTaskClickAfterPan()) {
        return;
      }

      // defense in depth: inactive/filtered nodes are not selectable.
      if (
        slot.classList.contains("is-time-inactive") ||
        slot.classList.contains("is-sample-placeholder")
      ) {
        return;
      }

      const task = slot.assignedTask;

      if (!task) {
        console.warn("Clicked slot has no assigned task:", slot.id);
        return;
      }

      // untreated sample/template records are portrait geometry only.
      // after visual remap, assignedTask is a planning/reset instance (clickable).
      if (isSamplePlaceholderTask(task) && !slot.visualRecord) {
        return;
      }

      event.stopPropagation();
      if (task.sourceType === "recurring-scheduled-instance") {
        console.log(
          "Selected portrait Planning and Reset instance:",
          task.day,
          "hasOccurrence=",
          task.hasOccurrence,
        );
      } else {
        console.log("Selected task:", task.title);
      }
      zoomToTask(slot, task);
    });
  }
}

function printPortraitDataCheck(report) {
  console.log("=== PORTRAIT DATA CHECK ===");
  console.log("");
  console.log("SVG slots:", report.slotCount);
  console.log("Tasks loaded:", report.taskCount);
  console.log("Tasks assigned:", report.assignedCount);
  console.log("Slots without tasks:", report.unassignedSlotCount);
  console.log("");
  console.log("Tasks with Structured symbols:", report.withSymbol);
  console.log("Tasks without Structured symbols:", report.withoutSymbol);
  console.log("");
  console.log("Unique Structured symbols:", report.uniqueSymbolCount);
  console.log("Unique Structured colors:", report.uniqueColorCount);
  console.log("");
  console.log(
    "Icon artwork available:",
    report.artworkAvailable + " / " + report.uniqueSymbolCount,
  );
  console.log(
    "Icon artwork missing:",
    report.artworkMissing + " / " + report.uniqueSymbolCount,
  );
  console.log("");
  console.log(
    "Tasks displaying real icon artwork:",
    report.tasksWithArtwork + " / " + report.taskCount,
  );
  console.log(
    "Tasks currently displaying development fallback:",
    report.tasksWithFallback + " / " + report.taskCount,
  );
  console.log("");
  console.log("Missing icon artwork:");
  console.log(report.missingIcons);
}

async function init() {
  try {
    const results = await Promise.all([
      loadPortraitSvg(),
      loadStructuredData(),
    ]);

    const svgElement = results[0];
    const rawData = results[1];

    // existing portrait pipeline (tasks[] only) — unchanged assignment
    normalTasks = normalizeTasks(rawData);
    normalizedTasks = normalTasks;
    portraitSlots = getPortraitSlots(svgElement);

    // recurring occurrence audit + separate normalization (no slot merge)
    auditRecurringOccurrences(rawData);
    recurringOccurrences = normalizeRecurringOccurrences(rawData);
    const duplicateReport = findRecurringTaskDuplicates(
      normalTasks,
      recurringOccurrences,
    );
    validatePlanningAndReset(recurringOccurrences);
    reportPortraitCountGate(normalTasks, recurringOccurrences, duplicateReport);

    console.log("Sunshine color mapping ready:", structuredColorMap.sunshine);
    console.log(
      "Calendar icon artwork present:",
      Boolean(structuredIconMap["calendar"]),
    );

    // allDataPoints is not created / assigned while count exceeds slot capacity.
    // portrait continues to use normalTasks only.

    const symbolStats = analyzeSymbols(normalizedTasks);
    const colorCounts = analyzeColors(normalizedTasks);
    const missingIcons = getMissingIconSymbols(symbolStats.uniqueSymbols);
    const iconAuditRows = buildIconAudit(normalizedTasks);
    const iconAudit = printIconAudit(iconAuditRows);
    const iconUsage = countIconUsage(normalizedTasks);

    const assignment = assignTasksToSlots(portraitSlots, normalizedTasks);

    applyTaskVisuals(portraitSlots);
    addSlotInteraction(portraitSlots);

    // build ALL 17 scheduled planning/reset instances, then split:
    // 3 → former samplePlaceholder portrait slots (visual assignment)
    // 14 → recurring background layer (no duplicates)
    const allPlanningResetInstances = buildPlanningResetScheduledInstances(
      rawData,
      recurringOccurrences,
    );
    const planningResetRemap = assignPlanningResetVisualsToPlaceholderSlots(
      portraitSlots,
      allPlanningResetInstances,
    );
    const planningResetBackground = renderPlanningResetBackgroundLayer(
      svgElement,
      planningResetRemap.backgroundInstances,
      portraitSlots,
    );
    addRecurringNodeInteraction(recurringBackgroundNodes);
    printPlanningResetSchedule(
      findPlanningResetDefinition(rawData),
      allPlanningResetInstances,
    );
    printVisualDataAssignment(
      portraitSlots,
      recurringBackgroundNodes,
      planningResetRemap,
    );
    printVisualDataLayers(allPlanningResetInstances);

    initializeCamera(svgElement);

    // capture Illustrator slot opacities before any time filter runs.
    captureOriginalPortraitOpacities(portraitSlots);

    // step 7a/7b — cache immutable homes, then derive Illustrator work field.
    cachePortraitDeformationHomes(portraitSlots);
    const illustratorField =
      await buildIllustratorWorkFieldFromPrototype(portraitSlots);
    window.__illustratorWorkField = illustratorField;
    if (!illustratorField || !illustratorField.ok) {
      console.error(
        "STEP 7B STOP: Illustrator work field was not applied.",
        illustratorField,
      );
      throw new Error("STEP 7B Illustrator work field validation failed");
    }

    // mode switch + category controls + live time filter
    initializeModeSwitch();
    initializeCategoryControls();
    initializeYearControls();
    initializeDevTimeControls();
    initializeDeformationControls();
    auditScheduleTimeCoverage(portraitSlots, recurringBackgroundNodes);
    auditSamplePlaceholderRecords(portraitSlots);
    auditCategoryClassification(portraitSlots, recurringBackgroundNodes);
    auditYearCoverage(portraitSlots);
    window.__lastUndatedAudit = auditUndatedMeaningfulRecords(
      portraitSlots,
      rawData,
    );
    // step 6 — cache live density min/max (data-only; no visual side effects).
    computeLiveDensityRange();
    window.__liveDayExpressiveExtrema = analyzeLiveDayExpressiveExtrema();
    // step 8 — historical tiredness energy distribution + unit tests.
    window.__tirednessEnergyUnitTests = runTirednessEnergyUnitTests();
    window.__liveTirednessEnergyDistribution =
      computeLiveTirednessEnergyDistribution();
    window.__yearWeightedEnergy = getYearWeightedEnergyReport();
    useCurrentBrowserTime({ syncSlider: true });
    enableTimeFilterTransitions();

    printPortraitDataCheck({
      slotCount: portraitSlots.length,
      taskCount: normalizedTasks.length,
      assignedCount: assignment.assignedCount,
      unassignedSlotCount: assignment.unassignedSlots.length,
      withSymbol: symbolStats.withSymbol,
      withoutSymbol: symbolStats.withoutSymbol,
      uniqueSymbolCount: symbolStats.uniqueSymbols.size,
      uniqueColorCount: Object.keys(colorCounts).length,
      artworkAvailable:
        symbolStats.uniqueSymbols.size - iconAudit.missingRows.length,
      artworkMissing: iconAudit.missingRows.length,
      tasksWithArtwork: iconUsage.withArtwork,
      tasksWithFallback: iconUsage.withFallback,
      missingIcons: missingIcons,
    });
  } catch (error) {
    console.error("Error during init:", error);
  }
}

init();

/*
  development only — remove before final
  expose measurement + expressive helpers for step 5/6 inspection.
*/
window.__activeDataDebug = {
  getState: function () {
    return lastActiveDataState;
  },
  getExpressiveState: function () {
    return lastExpressiveState;
  },
  getLiveDensityRange: function () {
    return liveDensityRange;
  },
  getLiveDayExtrema: function () {
    return (
      window.__liveDayExpressiveExtrema || analyzeLiveDayExpressiveExtrema()
    );
  },
  getDeformStats: function () {
    return {
      enabled: deformationEnabled,
      multiplier: deformationDevMultiplier,
      effectiveStrength: lastEffectiveStrength,
      workExpression: lastWorkExpression,
      workFieldAmount: lastDeformationAmount,
      deformationAmount: lastDeformationAmount,
      tiredness: lastTirednessState,
      settingsManipulationAmount: lastSettingsManipulationAmount,
      maxTargetDisplacement: lastMaxAppliedDisplacement,
      illustratorWorkScale: ILLUSTRATOR_WORK_SCALE,
      illustratorField: deformationFields.work,
      tirednessReferenceEnergy: TIREDNESS_REFERENCE_ENERGY,
      tirednessCurveExponent: TIREDNESS_CURVE_EXPONENT,
      liveTirednessDistribution: liveTirednessEnergyDistribution,
      maxDisplacementCap: portraitDeformBounds
        ? portraitDeformBounds.maxDisplacement
        : null,
      portraitWidth: portraitDeformBounds ? portraitDeformBounds.width : null,
      showIllustratorVectors: showIllustratorVectors,
    };
  },
  getTirednessState: function () {
    return lastTirednessState;
  },
  getLiveTirednessDistribution: function () {
    return liveTirednessEnergyDistribution;
  },
  getYearWeightedEnergy: function () {
    return window.__yearWeightedEnergy || getYearWeightedEnergyReport();
  },
  getIllustratorField: function () {
    return deformationFields.work;
  },
  sampleWorkExpressionAtMinutes: function (minutes) {
    const previousFollow = followCurrentTime;
    const previousMinutes = selectedTimeMinutes;
    followCurrentTime = false;
    setSelectedTimeMinutes(minutes, { syncSlider: true, log: false });
    const expressive = lastExpressiveState;
    const effective = lastEffectiveStrength;
    const workExpression = lastWorkExpression;
    const maxDisp = lastMaxAppliedDisplacement;
    const measure = window.__activeDataDebug.measureMaxDisplacement();
    followCurrentTime = previousFollow;
    setSelectedTimeMinutes(previousMinutes, {
      syncSlider: true,
      log: false,
    });
    updateFollowCurrentTimeUI();
    return {
      minutes: minutes,
      expressive: expressive,
      effectiveStrength: effective,
      workExpression: workExpression,
      maxTargetDisplacement: maxDisp,
      measure: measure,
    };
  },
  measureMaxDisplacement: function () {
    let maxMag = 0;
    let farthest = null;
    for (let i = 0; i < portraitSlots.length; i++) {
      const slot = portraitSlots[i];
      const dx = slot.deformTargetDx || 0;
      const dy = slot.deformTargetDy || 0;
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag > maxMag) {
        maxMag = mag;
        farthest = slot.id;
      }
    }
    return { maxMag: maxMag, slotId: farthest };
  },
  verifyHomesRestored: function () {
    let off = 0;
    let missingHome = 0;
    for (let i = 0; i < portraitSlots.length; i++) {
      const slot = portraitSlots[i];
      if (!slot.deformHome) {
        missingHome += 1;
        continue;
      }
      const dx = slot.deformDx || 0;
      const dy = slot.deformDy || 0;
      const hasTransform = Boolean(slot.getAttribute("transform"));
      if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6 || hasTransform) {
        off += 1;
      }
    }
    return {
      total: portraitSlots.length,
      offHome: off,
      missingHome: missingHome,
      allHome: off === 0,
    };
  },
  setDeformationEnabled: function (on) {
    deformationEnabled = Boolean(on);
    updateDeformationControlUI();
    applyPortraitDeformation(lastExpressiveState || emptyExpressiveState());
  },
  setDeformationMultiplier: function (value) {
    deformationDevMultiplier = Number(value);
    if (!Number.isFinite(deformationDevMultiplier)) {
      deformationDevMultiplier = 1;
    }
    updateDeformationControlUI();
    applyPortraitDeformation(lastExpressiveState || emptyExpressiveState());
  },
  calculate: calculateActiveDataState,
  calculateExpressive: calculateExpressiveState,
  setMode: setInteractionMode,
  setYear: setSettingsYear,
  setCategory: function (categoryId, isOn) {
    if (categoryId !== "workSchool" && categoryId !== "events") {
      return;
    }
    settingsState.categories[categoryId] = Boolean(isOn);
    updateCategoryControlUI();
    updateVisualization();
  },
  setTestTimeMinutes: function (minutes) {
    followCurrentTime = false;
    updateFollowCurrentTimeUI();
    return setSelectedTimeMinutes(minutes, { syncSlider: true, log: false });
  },
};
