// console audits for years, undated records, categories + schedule times

function auditYearCoverage(slots) {
  const yearCounts = {
    2023: 0,
    2024: 0,
    2025: 0,
    2026: 0,
  };
  let undated = 0;
  const outside = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const source = slot.sourceTask;
    const visual = slot.assignedTask;

    if (isSamplePlaceholderTask(source)) {
      continue;
    }
    if (visual && visual.sourceType === "recurring-scheduled-instance") {
      continue;
    }

    const year = getRecordYear(visual);
    if (year === null) {
      undated += 1;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(yearCounts, year)) {
      yearCounts[year] += 1;
    } else {
      outside.push({
        title: visual.title,
        day: visual.day,
        id: visual.id,
        year: year,
      });
    }
  }

  console.log("=== YEAR COVERAGE (real personal tasks) ===");
  console.log("2023:", yearCounts[2023]);
  console.log("2024:", yearCounts[2024]);
  console.log("2025:", yearCounts[2025]);
  console.log("2026:", yearCounts[2026]);
  console.log("Undated (day null/empty):", undated);
  console.log("Outside 2023–2026:", outside.length);
  if (outside.length > 0) {
    console.warn("Tasks with years outside 2023–2026:", outside);
  }

  return {
    yearCounts: yearCounts,
    undated: undated,
    outside: outside,
  };
}

/*
  investigation only — does not change filtering or visualization.
  audits meaningful records that appear under year=ALL but have no usable year
  for 2023 / 2024 / 2025 / 2026 filters.
*/
function classifyUndatedDayReason(rawDay, normalizedDay) {
  if (rawDay === null || rawDay === undefined) {
    return "missing scheduled date (source day is null/undefined)";
  }
  if (rawDay === "") {
    return "empty date (source day is empty string)";
  }

  const rawYear = parseInt(String(rawDay).slice(0, 4), 10);
  if (!Number.isFinite(rawYear)) {
    return "invalid date format (source day present but year unparsable)";
  }

  if (
    (normalizedDay === null ||
      normalizedDay === undefined ||
      normalizedDay === "") &&
    rawDay !== null &&
    rawDay !== undefined &&
    rawDay !== ""
  ) {
    return "normalization bug (source day present, normalized day lost)";
  }

  if (Number.isFinite(rawYear) && (rawYear < 2023 || rawYear > 2026)) {
    return "other (source year outside 2023–2026)";
  }

  return "other";
}

function auditUndatedMeaningfulRecords(slots, rawData) {
  const rawTasks = (rawData && rawData.tasks) || [];
  const rawById = {};
  for (let i = 0; i < rawTasks.length; i++) {
    const task = rawTasks[i];
    if (task && task.id) {
      rawById[task.id] = { task: task, originalIndex: i };
    }
  }

  const rows = [];
  const reasonCounts = {};
  const categoryCounts = {
    workSchool: 0,
    events: 0,
    personal: 0,
    planningReset: 0,
    unknown: 0,
  };
  let withUsableTime = 0;
  let sourceLacksDate = 0;
  let normalizationFailed = 0;
  const seenIds = {};

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const source = slot.sourceTask;
    const visual = slot.assignedTask;

    // exclude raw samplePlaceholder geometry / remapped pr portraits from this audit
    // of "normal task" undated records (matches prior year-coverage undated count).
    if (isSamplePlaceholderTask(source)) {
      continue;
    }
    if (!visual) {
      continue;
    }
    if (visual.sourceType === "recurring-scheduled-instance") {
      continue;
    }
    if (
      isSamplePlaceholderTask(visual) ||
      visual.dataKind === "samplePlaceholder"
    ) {
      continue;
    }

    if (getRecordYear(visual) !== null) {
      continue;
    }

    if (visual.id && seenIds[visual.id]) {
      continue;
    }
    if (visual.id) {
      seenIds[visual.id] = true;
    }

    const rawEntry = visual.id ? rawById[visual.id] : null;
    const raw = rawEntry ? rawEntry.task : null;
    const originalIndex = rawEntry ? rawEntry.originalIndex : null;
    const categoryId = getCategoryIdForRecord(visual);
    const reason = classifyUndatedDayReason(
      raw ? raw.day : undefined,
      visual.day,
    );

    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    if (Object.prototype.hasOwnProperty.call(categoryCounts, categoryId)) {
      categoryCounts[categoryId] += 1;
    } else {
      categoryCounts.unknown += 1;
    }

    if (hasUsableScheduleTime(visual)) {
      withUsableTime += 1;
    }

    const sourceDayMissing =
      !raw || raw.day === null || raw.day === undefined || raw.day === "";
    if (sourceDayMissing) {
      sourceLacksDate += 1;
    } else if (
      visual.day === null ||
      visual.day === undefined ||
      visual.day === ""
    ) {
      normalizationFailed += 1;
    }

    rows.push({
      title: visual.title,
      scheduled_day_normalized: visual.day,
      scheduled_day_raw: raw ? raw.day : "(raw not found)",
      calendar_day_index_raw: raw ? raw.calendar_day_index : null,
      start_time: visual.startTime,
      start_time_raw: raw ? raw.start_time : null,
      duration: visual.duration,
      color: visual.color,
      category: categoryId,
      symbol: visual.symbol,
      sourceType: visual.sourceType,
      id: visual.id,
      originalTaskIndex: originalIndex,
      assignedSlotId: slot.id || null,
      dataKind: visual.dataKind,
      is_all_day_raw: raw ? raw.is_all_day : null,
      is_in_inbox_raw: raw ? raw.is_in_inbox : null,
      created_at_raw: raw ? raw.created_at : null,
      completed_at_raw: raw ? raw.completed_at : null,
      modified_at_raw: raw ? raw.modified_at : null,
      undatedReason: reason,
      sourceGenuinelyLacksScheduledDate: sourceDayMissing,
      hasUsableTimeOfDay: hasUsableScheduleTime(visual),
    });
  }

  // also confirm no undated planning/reset background nodes (they should ALL be dated).
  let undatedPlanningResetBackground = 0;
  for (let j = 0; j < recurringBackgroundNodes.length; j++) {
    const node = recurringBackgroundNodes[j];
    const record = node.assignedTask;
    if (!record) {
      continue;
    }
    if (getRecordYear(record) === null) {
      undatedPlanningResetBackground += 1;
    }
  }

  const totalRealNormalTasks = 2380;
  const total = rows.length;

  console.log("=== UNDATED MEANINGFUL RECORDS AUDIT (investigation only) ===");
  console.log("UNDATED MEANINGFUL RECORDS:", total);
  console.log(
    "Undated Planning/Reset background nodes:",
    undatedPlanningResetBackground,
  );
  console.log("");
  console.log("Reason breakdown:");
  console.table(reasonCounts);
  console.log("");
  console.log("Category breakdown:");
  console.table({
    workSchool: {
      count: categoryCounts.workSchool,
      pctOf2380:
        ((categoryCounts.workSchool / totalRealNormalTasks) * 100).toFixed(2) +
        "%",
    },
    events: {
      count: categoryCounts.events,
      pctOf2380:
        ((categoryCounts.events / totalRealNormalTasks) * 100).toFixed(2) + "%",
    },
    personal: {
      count: categoryCounts.personal,
      pctOf2380:
        ((categoryCounts.personal / totalRealNormalTasks) * 100).toFixed(2) +
        "%",
    },
    planningReset: {
      count: categoryCounts.planningReset,
      pctOf2380:
        ((categoryCounts.planningReset / totalRealNormalTasks) * 100).toFixed(
          2,
        ) + "%",
    },
    total: {
      count: total,
      pctOf2380: ((total / totalRealNormalTasks) * 100).toFixed(2) + "%",
    },
  });
  console.log("");
  console.log("Source vs normalization:");
  console.log("  Source genuinely lacks scheduled day:", sourceLacksDate);
  console.log(
    "  Normalization lost a present source day:",
    normalizationFailed,
  );
  console.log("  Records with usable time-of-day:", withUsableTime, "/", total);
  console.log("");
  console.log("Full undated record table:");
  console.table(rows);

  return {
    total: total,
    rows: rows,
    reasonCounts: reasonCounts,
    categoryCounts: categoryCounts,
    sourceLacksDate: sourceLacksDate,
    normalizationFailed: normalizationFailed,
    withUsableTime: withUsableTime,
    undatedPlanningResetBackground: undatedPlanningResetBackground,
  };
}

function auditCategoryClassification(slots, yellowNodes) {
  const counts = {
    workSchool: 0,
    events: 0,
    personal: 0,
    planningReset: 0,
    samplePlaceholderRaw: 0,
    samplePlaceholderVisible: 0,
    unknown: 0,
  };
  const unexpectedColors = {};

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const source = slot.sourceTask;
    const visual = slot.assignedTask;

    if (isSamplePlaceholderTask(source)) {
      counts.samplePlaceholderRaw += 1;
    }
    if (slot.classList.contains("is-sample-placeholder")) {
      counts.samplePlaceholderVisible += 1;
    }

    const categoryId = getCategoryIdForRecord(visual);
    if (categoryId === "samplePlaceholder") {
      // should be 0 after visual remap — keep for safety.
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(counts, categoryId)) {
      counts[categoryId] += 1;
    } else {
      counts.unknown += 1;
      const color = visual ? visual.color : "";
      const key = String(color === undefined || color === null ? "" : color);
      unexpectedColors[key] = (unexpectedColors[key] || 0) + 1;
    }
  }

  for (let j = 0; j < yellowNodes.length; j++) {
    counts.planningReset += 1;
  }

  const realPortraitTasks =
    counts.workSchool + counts.events + counts.personal + counts.unknown;
  const meaningfulDataPoints = realPortraitTasks + counts.planningReset;

  console.log("=== CATEGORY CLASSIFICATION ===");
  console.log("workSchool:", counts.workSchool);
  console.log("events:", counts.events);
  console.log("personal:", counts.personal);
  console.log("planningReset (portrait + background):", counts.planningReset);
  console.log(
    "samplePlaceholder RAW source records:",
    counts.samplePlaceholderRaw,
  );
  console.log(
    "samplePlaceholder VISIBLE nodes:",
    counts.samplePlaceholderVisible,
  );
  console.log("unknown:", counts.unknown);
  console.log("Unexpected Structured colors:", unexpectedColors);
  console.log("");
  console.log("SVG portrait slots:", slots.length);
  console.log("Meaningful data points:", meaningfulDataPoints);

  return {
    counts: counts,
    unexpectedColors: unexpectedColors,
    realPortraitTasks: realPortraitTasks,
    meaningfulDataPoints: meaningfulDataPoints,
  };
}

function auditSamplePlaceholderRecords(slots) {
  const rows = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const source = slot.sourceTask || slot.assignedTask;
    if (!isSamplePlaceholderTask(source)) {
      continue;
    }

    const visual = slot.assignedTask;
    rows.push({
      index: i,
      slotId: slot.id,
      title: source.title,
      day: source.day,
      startTime: source.startTime,
      duration: source.duration,
      color: source.color,
      symbol: source.symbol,
      type: source.type,
      id: source.id,
      deleted: source.deleted,
      hidden: source.hidden,
      dataKind: source.dataKind,
      visualKind: visual && visual.sourceType ? visual.sourceType : "task",
      visualDay: visual && visual.day ? visual.day : null,
      stillVisibleAsGrey: slot.classList.contains("is-sample-placeholder"),
    });
  }

  console.log("=== SAMPLE PLACEHOLDER AUDIT (RAW SOURCE) ===");
  console.table(rows);
  console.log("Raw sample placeholder count:", rows.length);
  console.log(
    "Still visible as grey:",
    rows.filter(function (r) {
      return r.stillVisibleAsGrey;
    }).length,
  );

  return rows;
}

function auditScheduleTimeCoverage(slots, yellowNodes) {
  let portraitUsable = 0;
  let portraitMissing = 0;

  for (let i = 0; i < slots.length; i++) {
    if (hasUsableScheduleTime(slots[i].assignedTask)) {
      portraitUsable += 1;
    } else {
      portraitMissing += 1;
    }
  }

  let yellowUsable = 0;
  let yellowMissing = 0;
  for (let j = 0; j < yellowNodes.length; j++) {
    if (hasUsableScheduleTime(yellowNodes[j].assignedTask)) {
      yellowUsable += 1;
    } else {
      yellowMissing += 1;
    }
  }

  console.log("=== SCHEDULE TIME COVERAGE ===");
  console.log("Portrait tasks with usable start + duration:", portraitUsable);
  console.log(
    "Portrait tasks without usable start + duration:",
    portraitMissing,
  );
  console.log(
    "Planning and Reset nodes with usable start + duration:",
    yellowUsable + " / " + yellowNodes.length,
  );
  console.log("Planning and Reset nodes without usable time:", yellowMissing);
  console.log(
    "Structured time format: start_time = decimal hour, duration = minutes",
  );
}
