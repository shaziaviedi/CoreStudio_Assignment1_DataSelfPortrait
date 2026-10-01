// visualization updates, clock, mode switch, category + year controls

/*
  central visualization update — mode buttons and time controls call this.
  does not touch the camera.

  pipeline:
  1. determine active/inactive nodes + apply visual filtering
  2. calculateActiveDataState()
  3. calculateExpressiveState()
  4. updateDevelopmentReadout()
  5. applyPortraitDeformation()
*/
function updateVisualization() {
  let filterResult = null;

  if (interactionMode === "live") {
    filterResult = applyTimeFilter();
  } else if (interactionMode === "settings") {
    filterResult = applySettingsFilters();
    logYearFilterDebug(filterResult);
  }

  lastActiveDataState = calculateActiveDataState();
  lastExpressiveState = calculateExpressiveState(lastActiveDataState);
  updateDevelopmentReadout(lastExpressiveState);
  applyPortraitDeformation(lastExpressiveState);

  return filterResult;
}

function logYearFilterDebug(counts) {
  if (!counts || interactionMode !== "settings") {
    return;
  }

  console.log({
    year: yearSelectionLabel(counts.year),
    activePortrait: counts.activePortrait,
    activePlanningResetPortrait: counts.activePlanningResetPortrait,
    activePlanningResetBackground: counts.activePlanningResetBackground,
    activePlanningResetTotal: counts.activePlanningResetTotal,
  });
}

/* clear selection when the selected node becomes filtered (LIVE or SETTINGS). */
function syncSelectionWithVisualization() {
  if (!selectedSlot) {
    return;
  }

  if (selectedSlot.classList.contains("is-time-inactive")) {
    clearSelectedTask();
  }
}

function logTimeFilterDebug(counts) {
  if (!counts) {
    return;
  }

  console.log({
    selectedTime: counts.selectedTime,
    activePortraitTasks: counts.activePortraitTasks,
    activePlanningReset: counts.activePlanningReset,
    totalActive: counts.totalActive,
  });
}

function setSelectedTimeMinutes(minutes, options) {
  const opts = options || {};
  selectedTimeMinutes = minutes;

  // development only — remove before final
  if (devTimeReadout) {
    devTimeReadout.textContent = formatMinutesAsClock(selectedTimeMinutes);
  }
  if (devTimeSlider && opts.syncSlider !== false) {
    const step = Number(devTimeSlider.step) || 10;
    devTimeSlider.value = String(
      snapMinutesToSliderStep(selectedTimeMinutes, step),
    );
  }

  // CURRENT TIME always shows the real browser clock.
  // TEST TIME readout (dev) shows the visualization time separately.
  updateCurrentTimeDisplay(getBrowserTimeMinutes());

  // camera is intentionally untouched — zoom/pan stay where the visitor left them.
  const counts = updateVisualization();
  if (interactionMode === "live" && opts.log !== false) {
    logTimeFilterDebug(counts);
  }
  syncSelectionWithVisualization();
  return counts;
}

function updateFollowCurrentTimeUI() {
  // development only — remove before final
  if (!devUseCurrentTimeButton) {
    return;
  }
  devUseCurrentTimeButton.setAttribute(
    "aria-pressed",
    followCurrentTime ? "true" : "false",
  );
}

/*
  tick the live clock. when followCurrentTime is on (LIVE mode),
  refresh the time filter as browser minutes change — never resets camera.
*/
function tickCurrentTimeFollow() {
  const browserMinutes = getBrowserTimeMinutes();

  // CURRENT TIME label always tracks the browser clock.
  updateCurrentTimeDisplay(browserMinutes);

  if (interactionMode !== "live") {
    return;
  }

  // live + manual TEST TIME — leave selectedTimeMinutes / filter alone.
  if (!followCurrentTime) {
    return;
  }

  if (browserMinutes === selectedTimeMinutes) {
    return;
  }

  // new minute: update filter data only (no zoom/pan/reset).
  setSelectedTimeMinutes(browserMinutes, {
    syncSlider: true,
    log: false,
  });
}

function startCurrentTimeClock() {
  if (currentTimeClockId !== null) {
    return;
  }
  currentTimeClockId = window.setInterval(tickCurrentTimeFollow, 1000);
}

function useCurrentBrowserTime(options) {
  followCurrentTime = true;
  updateFollowCurrentTimeUI();
  startCurrentTimeClock();
  const minutes = getBrowserTimeMinutes();
  return setSelectedTimeMinutes(minutes, options);
}

function updateModeUI() {
  const isLive = interactionMode === "live";

  if (appElement) {
    appElement.dataset.interactionMode = interactionMode;
  }

  if (modeLiveButton) {
    modeLiveButton.setAttribute("aria-pressed", isLive ? "true" : "false");
  }
  if (modeSettingsButton) {
    modeSettingsButton.setAttribute("aria-pressed", isLive ? "false" : "true");
  }

  // development only — remove before final
  if (devTimeControls) {
    devTimeControls.hidden = !isLive;
  }

  if (settingsPanel) {
    settingsPanel.hidden = isLive;
  }

  // CURRENT TIME always shows browser clock.
  updateCurrentTimeDisplay(getBrowserTimeMinutes());
}

function setInteractionMode(mode) {
  if (mode !== "live" && mode !== "settings") {
    return;
  }

  if (interactionMode === mode) {
    updateModeUI();
    return;
  }

  interactionMode = mode;
  updateModeUI();

  // returning to LIVE while following the clock: sync to now without resetting camera.
  if (mode === "live" && followCurrentTime) {
    setSelectedTimeMinutes(getBrowserTimeMinutes(), {
      syncSlider: true,
      log: false,
    });
  } else {
    updateVisualization();
    syncSelectionWithVisualization();
  }
}

function isolateUiFromCamera(element) {
  if (!element) {
    return;
  }

  element.addEventListener(
    "wheel",
    function (event) {
      event.stopPropagation();
    },
    { passive: true },
  );

  element.addEventListener("pointerdown", function (event) {
    event.stopPropagation();
  });

  element.addEventListener("click", function (event) {
    event.stopPropagation();
  });
}

function initializeModeSwitch() {
  isolateUiFromCamera(document.getElementById("mode-switch"));
  isolateUiFromCamera(settingsPanel);

  if (modeLiveButton) {
    modeLiveButton.addEventListener("click", function () {
      setInteractionMode("live");
    });
  }

  if (modeSettingsButton) {
    modeSettingsButton.addEventListener("click", function () {
      setInteractionMode("settings");
    });
  }

  updateModeUI();
}

function updateCategoryControlUI() {
  const toggles = document.querySelectorAll(".category-toggle[data-category]");
  for (let i = 0; i < toggles.length; i++) {
    const button = toggles[i];
    const categoryId = button.getAttribute("data-category");
    const isOn = settingsState.categories[categoryId] !== false;
    button.setAttribute("aria-pressed", isOn ? "true" : "false");
    const stateEl = button.querySelector(".category-state");
    if (stateEl) {
      stateEl.textContent = isOn ? "ON" : "OFF";
    }
  }
}

function toggleManipulableCategory(categoryId) {
  if (categoryId !== "workSchool" && categoryId !== "events") {
    return;
  }

  settingsState.categories[categoryId] = !settingsState.categories[categoryId];
  updateCategoryControlUI();
  updateVisualization();
  syncSelectionWithVisualization();
}

function initializeCategoryControls() {
  const toggles = document.querySelectorAll(".category-toggle[data-category]");
  for (let i = 0; i < toggles.length; i++) {
    const button = toggles[i];
    button.addEventListener("click", function () {
      const categoryId = button.getAttribute("data-category");
      toggleManipulableCategory(categoryId);
    });
  }

  updateCategoryControlUI();
}

function updateYearControlUI() {
  const label = yearSelectionLabel(settingsState.year);
  const index = yearIndexFromValue(settingsState.year);

  if (yearReadout) {
    yearReadout.textContent = label;
  }
  if (yearSlider) {
    yearSlider.value = String(index);
    yearSlider.setAttribute("aria-valuetext", label);
  }

  const ticks = document.querySelectorAll(".year-tick[data-year]");
  for (let i = 0; i < ticks.length; i++) {
    const button = ticks[i];
    const yearValue = button.getAttribute("data-year");
    const isActive = String(yearValue) === String(settingsState.year);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
}

function setSettingsYear(yearSelection, options) {
  const opts = options || {};
  const normalized =
    yearSelection === "all" || yearSelection === "ALL"
      ? "all"
      : Number(yearSelection);

  if (normalized !== "all" && !Number.isFinite(normalized)) {
    return;
  }

  if (
    normalized !== "all" &&
    YEAR_TIMELINE_OPTIONS.indexOf(normalized) === -1
  ) {
    return;
  }

  settingsState.year = normalized;
  updateYearControlUI();

  if (opts.skipVisualization) {
    return;
  }

  updateVisualization();
  syncSelectionWithVisualization();
}

function initializeYearControls() {
  updateYearControlUI();

  if (yearSlider) {
    yearSlider.addEventListener("input", function () {
      const index = Number(yearSlider.value);
      const yearValue = yearValueFromIndex(index);
      setSettingsYear(yearValue);
    });
  }

  const ticks = document.querySelectorAll(".year-tick[data-year]");
  for (let i = 0; i < ticks.length; i++) {
    const button = ticks[i];
    button.addEventListener("click", function () {
      const yearValue = button.getAttribute("data-year");
      setSettingsYear(yearValue === "all" ? "all" : Number(yearValue));
    });
  }
}

/*
  development only — remove before final
  temporary slider + USE CURRENT TIME for testing live time filtering.
*/
function initializeDevTimeControls() {
  if (!devTimeControls) {
    return;
  }

  isolateUiFromCamera(devTimeControls);

  if (devTimeSlider) {
    devTimeSlider.addEventListener("input", function () {
      // manual testing pauses live clock follow until USE CURRENT TIME.
      followCurrentTime = false;
      updateFollowCurrentTimeUI();
      const minutes = Number(devTimeSlider.value);
      // do not re-snap / overwrite while dragging — use slider value directly.
      setSelectedTimeMinutes(minutes, { syncSlider: false });
    });
  }

  if (devUseCurrentTimeButton) {
    devUseCurrentTimeButton.addEventListener("click", function () {
      useCurrentBrowserTime({ syncSlider: true });
    });
  }

  updateFollowCurrentTimeUI();
  startCurrentTimeClock();
}
