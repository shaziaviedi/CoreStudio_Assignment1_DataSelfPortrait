// SETTINGS category + year filters

/*
  SETTINGS mode category filters.
  active categories restore original Illustrator opacity (not forced to 1).
  filtered categories use originalOpacity * inactive_multiplier.
  locked categories (personal, planningReset) always stay active.
  samplePlaceholder slots are portrait structure only — never filtered/highlighted.
*/
function getCategoryIdForColor(structuredColor) {
  const key = String(structuredColor || "")
    .trim()
    .toLowerCase();

  if (!key) {
    return "unknown";
  }

  const ids = Object.keys(categoryAccessModel);
  for (let i = 0; i < ids.length; i++) {
    const categoryId = ids[i];
    const colors = categoryAccessModel[categoryId].colors || [];
    if (colors.indexOf(key) !== -1) {
      return categoryId;
    }
  }

  return "unknown";
}

function getCategoryIdForRecord(record) {
  if (!record) {
    return "unknown";
  }

  if (
    isSamplePlaceholderTask(record) ||
    record.dataKind === "samplePlaceholder"
  ) {
    return "samplePlaceholder";
  }

  if (record.sourceType === "recurring-scheduled-instance") {
    return "planningReset";
  }

  return getCategoryIdForColor(record.color);
}

function isCategoryVisibleInSettings(categoryId) {
  if (
    categoryId === "personal" ||
    categoryId === "planningReset" ||
    categoryId === "unknown"
  ) {
    return true;
  }

  if (categoryId === "workSchool" || categoryId === "events") {
    return settingsState.categories[categoryId] !== false;
  }

  // samplePlaceholder is handled separately as structural geometry.
  return true;
}

// year from the visual/display record's scheduled day (never placeholder source date).
function getRecordYear(record) {
  if (
    !record ||
    record.day === null ||
    record.day === undefined ||
    record.day === ""
  ) {
    return null;
  }

  const year = parseInt(String(record.day).slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function recordMatchesYear(record, yearSelection) {
  if (yearSelection === "all") {
    return true;
  }

  const recordYear = getRecordYear(record);
  if (recordYear === null) {
    // undated tasks only appear when ALL years are selected.
    return false;
  }

  return recordYear === Number(yearSelection);
}

function recordMatchesSettingsFilters(record) {
  const categoryId = getCategoryIdForRecord(record);
  const categoryOk = isCategoryVisibleInSettings(categoryId);
  const yearOk = recordMatchesYear(record, settingsState.year);
  return categoryOk && yearOk;
}

function yearSelectionLabel(yearSelection) {
  if (yearSelection === "all") {
    return "ALL";
  }
  return String(yearSelection);
}

function yearIndexFromValue(yearSelection) {
  for (let i = 0; i < YEAR_TIMELINE_OPTIONS.length; i++) {
    if (String(YEAR_TIMELINE_OPTIONS[i]) === String(yearSelection)) {
      return i;
    }
  }
  return 0;
}

function yearValueFromIndex(index) {
  const clamped = Math.max(
    0,
    Math.min(YEAR_TIMELINE_OPTIONS.length - 1, index),
  );
  return YEAR_TIMELINE_OPTIONS[clamped];
}

function setSamplePlaceholderVisualState(slot) {
  if (!slot) {
    return;
  }

  // keep original Illustrator opacity; never emphasize as active data.
  slot.style.opacity = String(getOriginalSlotOpacity(slot));
  slot.classList.add("is-sample-placeholder");
  slot.classList.remove("is-time-active");
  slot.classList.remove("is-time-inactive");
}

function setPortraitSlotSettingsVisibility(slot, isVisible) {
  if (!slot) {
    return;
  }

  const originalOpacity = getOriginalSlotOpacity(slot);
  // settings ON = exact original portrait opacity (not boosted live-active).
  const opacity = isVisible
    ? originalOpacity
    : originalOpacity * INACTIVE_MULTIPLIER;

  slot.style.opacity = String(opacity);

  if (isVisible) {
    slot.classList.add("is-time-active");
    slot.classList.remove("is-time-inactive");
  } else {
    slot.classList.add("is-time-inactive");
    slot.classList.remove("is-time-active");
  }
}

function applySettingsFilters() {
  let activePortrait = 0;
  let activePlanningResetPortrait = 0;
  let activePlanningResetBackground = 0;

  for (let i = 0; i < portraitSlots.length; i++) {
    const slot = portraitSlots[i];
    const record = slot.assignedTask;

    // untreated sample placeholders only (post-remap these should not exist).
    if (
      isSamplePlaceholderTask(slot.sourceTask) &&
      !slot.visualRecord &&
      isSamplePlaceholderTask(record)
    ) {
      setSamplePlaceholderVisualState(slot);
      continue;
    }

    const isVisible = recordMatchesSettingsFilters(record);
    setPortraitSlotSettingsVisibility(slot, isVisible);

    if (isVisible) {
      if (record && record.sourceType === "recurring-scheduled-instance") {
        activePlanningResetPortrait += 1;
      } else {
        activePortrait += 1;
      }
    }
  }

  // background planning/reset: year filter applies; category stays protected/always allowed.
  for (let j = 0; j < recurringBackgroundNodes.length; j++) {
    const node = recurringBackgroundNodes[j];
    const record = node.assignedTask;
    const yearOk = recordMatchesYear(record, settingsState.year);
    setRecurringNodeTimeFilterState(node, yearOk);
    if (yearOk) {
      activePlanningResetBackground += 1;
    }
  }

  return {
    year: settingsState.year,
    activePortrait: activePortrait,
    activePlanningResetPortrait: activePlanningResetPortrait,
    activePlanningResetBackground: activePlanningResetBackground,
    activePlanningResetTotal:
      activePlanningResetPortrait + activePlanningResetBackground,
  };
}
