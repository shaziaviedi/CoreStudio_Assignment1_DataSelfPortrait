// loading the SVG + Structured JSON, normalizing tasks + recurring audits

// loading SVG
async function loadPortraitSvg() {
  const response = await fetch("assets/portrait.svg");

  if (!response.ok) {
    throw new Error(
      "Could not load portrait.svg (status " + response.status + ")",
    );
  }

  const svgText = await response.text();
  portraitContainer.innerHTML = svgText;

  const svgElement = portraitContainer.querySelector("svg");

  // size is controlled in style.css → #portrait-container SVG
  return svgElement;
}

// loading JSON
async function loadStructuredData() {
  const response = await fetch("data/structured-data.json");

  if (!response.ok) {
    throw new Error(
      "Could not load structured-data.json (status " + response.status + ")",
    );
  }

  return response.json();
}

// normalizing tasks — keep the exact Structured symbol string
function normalizeTask(task) {
  const isPlaceholder = isSamplePlaceholderTaskId(task.id);

  return {
    id: task.id,
    title: task.title,
    day: task.day,
    startTime: task.start_time,
    duration: task.duration,
    completedAt: task.completed_at,
    symbol: task.symbol,
    color: task.color,
    note: task.note,
    subtasks: task.subtasks,
    type: task.type,
    deleted: task._deleted,
    hidden: task.is_hidden,
    sourceType: "task",
    // samplePlaceholder = Structured onboarding/template, not personal data
    dataKind: isPlaceholder ? "samplePlaceholder" : "personalData",
  };
}

// keep every scheduled task record. do not filter by date, completion, notes, etc.
function normalizeTasks(rawData) {
  const rawTasks = rawData.tasks;
  const result = [];

  for (let i = 0; i < rawTasks.length; i++) {
    const task = rawTasks[i];

    // only skip entries that are clearly not real task records
    if (!task || !task.id) {
      continue;
    }

    result.push(normalizeTask(task));
  }

  return result;
}

// recurring occurrence audit + normalization (separate from tasks[])
// documented instances only — never invent sundays from start_day.

function buildRecurringLookup(rawData) {
  const lookup = {};
  const recurrings = rawData.recurrings || [];

  for (let i = 0; i < recurrings.length; i++) {
    const definition = recurrings[i];
    if (definition && definition.id) {
      lookup[definition.id] = definition;
    }
  }

  return lookup;
}

// normalize one documented occurrence using its recurring definition.
function normalizeRecurringOccurrence(occurrence, definition) {
  return {
    // instance-specific (from occurrence)
    id: occurrence.id,
    day: occurrence.day,
    completedAt: occurrence.completed_at,
    occurrenceCreatedAt: occurrence.created_at,
    occurrenceModifiedAt: occurrence.modified_at,
    isDetached: occurrence.is_detached,
    detachedTask: occurrence.detached_task,
    deleted: occurrence._deleted,

    // definition information (from recurrings[])
    title: definition.title,
    color: definition.color,
    symbol: definition.symbol,
    startTime: definition.start_time,
    duration: definition.duration,
    note: definition.note,
    recurringId: definition.id,
    recurringType: definition.recurring_type,
    interval: definition.interval,
    startDay: definition.start_day,
    endDay: definition.end_day,
    sunday: definition.sunday,
    monday: definition.monday,
    tuesday: definition.tuesday,
    wednesday: definition.wednesday,
    thursday: definition.thursday,
    friday: definition.friday,
    saturday: definition.saturday,

    sourceType: "recurring-occurrence",
  };
}

// only documented occurrence records that successfully join to a recurring definition.
function normalizeRecurringOccurrences(rawData) {
  const occurrences = rawData.occurrences || [];
  const lookup = buildRecurringLookup(rawData);
  const result = [];

  for (let i = 0; i < occurrences.length; i++) {
    const occurrence = occurrences[i];
    if (!occurrence || !occurrence.id) {
      continue;
    }

    const definition = lookup[occurrence.recurring];
    if (!definition) {
      continue;
    }

    result.push(normalizeRecurringOccurrence(occurrence, definition));
  }

  return result;
}

function auditRecurringOccurrences(rawData) {
  const occurrences = rawData.occurrences || [];
  const recurrings = rawData.recurrings || [];
  const lookup = buildRecurringLookup(rawData);

  let matchedCount = 0;
  let unmatchedCount = 0;
  const byRecurringId = {};
  const representedIds = {};

  for (let i = 0; i < occurrences.length; i++) {
    const occurrence = occurrences[i];
    const recurringId = occurrence.recurring;
    const definition = lookup[recurringId];

    if (!definition) {
      unmatchedCount += 1;
      continue;
    }

    matchedCount += 1;
    representedIds[recurringId] = true;

    if (!byRecurringId[recurringId]) {
      byRecurringId[recurringId] = {
        title: definition.title,
        color: definition.color,
        symbol: definition.symbol,
        count: 0,
        earliest: null,
        latest: null,
      };
    }

    const row = byRecurringId[recurringId];
    row.count += 1;

    const day = occurrence.day;
    if (day) {
      if (!row.earliest || day < row.earliest) {
        row.earliest = day;
      }
      if (!row.latest || day > row.latest) {
        row.latest = day;
      }
    }
  }

  const tableRows = [];
  const ids = Object.keys(byRecurringId);
  for (let i = 0; i < ids.length; i++) {
    tableRows.push(byRecurringId[ids[i]]);
  }
  tableRows.sort(function (a, b) {
    return b.count - a.count;
  });

  let zeroOccurrenceDefinitions = 0;
  for (let i = 0; i < recurrings.length; i++) {
    if (!representedIds[recurrings[i].id]) {
      zeroOccurrenceDefinitions += 1;
    }
  }

  // occurrence field inventory (for semantics)
  const sample = occurrences[0] || null;
  let withCompletedAt = 0;
  let withoutCompletedAt = 0;
  let detachedTrue = 0;
  let withDetachedTask = 0;

  for (let i = 0; i < occurrences.length; i++) {
    const occurrence = occurrences[i];
    if (
      occurrence.completed_at === null ||
      occurrence.completed_at === undefined
    ) {
      withoutCompletedAt += 1;
    } else {
      withCompletedAt += 1;
    }
    if (occurrence.is_detached) {
      detachedTrue += 1;
    }
    if (occurrence.detached_task) {
      withDetachedTask += 1;
    }
  }

  console.log("=== RECURRING OCCURRENCE AUDIT ===");
  console.log("Total occurrence records:", occurrences.length);
  console.log("Matched to a recurring definition:", matchedCount);
  console.log("Unmatched occurrences:", unmatchedCount);
  console.log(
    "Unique recurring definitions represented by occurrences:",
    Object.keys(representedIds).length,
  );
  console.log(
    "Recurrings with zero occurrence records:",
    zeroOccurrenceDefinitions,
  );
  console.log("");
  console.log("Per recurring definition (documented occurrences only):");
  console.table(tableRows);

  console.log("");
  console.log("=== OCCURRENCE SEMANTICS ===");
  console.log("Occurrence fields:", sample ? Object.keys(sample) : []);
  console.log("With completed_at:", withCompletedAt);
  console.log("Without completed_at:", withoutCompletedAt);
  console.log("is_detached true:", detachedTrue);
  console.log("detached_task present:", withDetachedTask);
  console.log(
    "Conclusion: occurrence records behave like logged/completed (or otherwise " +
      "touched) recurring instances — NOT every generated calendar date. " +
      "Evidence: completed_at is set on " +
      withCompletedAt +
      "/" +
      occurrences.length +
      " records; series such as daily Wake up! / Sleep Well! have far fewer " +
      "occurrence rows than calendar days in their active ranges.",
  );

  return {
    totalOccurrences: occurrences.length,
    matchedCount: matchedCount,
    unmatchedCount: unmatchedCount,
    uniqueDefinitionsRepresented: Object.keys(representedIds).length,
    zeroOccurrenceDefinitions: zeroOccurrenceDefinitions,
    tableRows: tableRows,
    withCompletedAt: withCompletedAt,
    withoutCompletedAt: withoutCompletedAt,
  };
}

function findRecurringTaskDuplicates(normalTaskList, occurrenceList) {
  const byStrong = {};
  const byLoose = {};

  function titleKey(title) {
    return String(title || "")
      .trim()
      .toLowerCase();
  }

  for (let i = 0; i < normalTaskList.length; i++) {
    const task = normalTaskList[i];
    const strong =
      titleKey(task.title) +
      "|" +
      String(task.day) +
      "|" +
      String(task.startTime) +
      "|" +
      String(task.duration);
    const loose = titleKey(task.title) + "|" + String(task.day);

    if (!byStrong[strong]) {
      byStrong[strong] = [];
    }
    byStrong[strong].push(task);

    if (!byLoose[loose]) {
      byLoose[loose] = [];
    }
    byLoose[loose].push(task);
  }

  const strongDuplicates = [];
  const looseDuplicates = [];

  for (let i = 0; i < occurrenceList.length; i++) {
    const occurrence = occurrenceList[i];
    const strong =
      titleKey(occurrence.title) +
      "|" +
      String(occurrence.day) +
      "|" +
      String(occurrence.startTime) +
      "|" +
      String(occurrence.duration);
    const loose = titleKey(occurrence.title) + "|" + String(occurrence.day);

    if (byStrong[strong] && byStrong[strong].length) {
      strongDuplicates.push({
        matchType: "title+day+start+duration",
        title: occurrence.title,
        day: occurrence.day,
        occurrenceId: occurrence.id,
        taskId: byStrong[strong][0].id,
      });
    } else if (byLoose[loose] && byLoose[loose].length) {
      looseDuplicates.push({
        matchType: "title+day only (times differ)",
        title: occurrence.title,
        day: occurrence.day,
        occurrenceId: occurrence.id,
        occurrenceStart: occurrence.startTime,
        taskId: byLoose[loose][0].id,
        taskStart: byLoose[loose][0].startTime,
      });
    }
  }

  console.log("=== DUPLICATE CHECK (occurrences vs tasks[]) ===");
  console.log(
    "Strong duplicates (title + day + start + duration):",
    strongDuplicates.length,
  );
  if (strongDuplicates.length) {
    console.table(strongDuplicates);
  }
  console.log(
    "Loose title+day overlaps (NOT auto-removed; start/duration may differ):",
    looseDuplicates.length,
  );
  if (looseDuplicates.length) {
    console.table(looseDuplicates);
  }

  return {
    strongDuplicates: strongDuplicates,
    looseDuplicates: looseDuplicates,
  };
}

function validatePlanningAndReset(occurrenceList) {
  const matches = [];

  for (let i = 0; i < occurrenceList.length; i++) {
    const item = occurrenceList[i];
    const title = String(item.title || "")
      .trim()
      .toLowerCase();
    if (title === "planning and reset") {
      matches.push({
        title: item.title,
        day: item.day,
        color: item.color,
        symbol: item.symbol,
        startTime: item.startTime,
        duration: item.duration,
        completedAt: item.completedAt,
        occurrenceId: item.id,
        recurringId: item.recurringId,
        sourceType: item.sourceType,
      });
    }
  }

  matches.sort(function (a, b) {
    if (a.day < b.day) {
      return -1;
    }
    if (a.day > b.day) {
      return 1;
    }
    return 0;
  });

  console.log("=== PLANNING AND RESET VALIDATION ===");
  console.log(
    "Documented normalized planning and reset occurrences:",
    matches.length,
  );
  console.table(matches);
  console.log(
    "Expected: exactly the occurrences[] rows (currently 2026-08-23 and 2026-08-30). No extra Sundays generated.",
  );

  return matches;
}

function reportPortraitCountGate(
  normalTaskList,
  occurrenceList,
  duplicateReport,
) {
  const normalCount = normalTaskList.length;
  const occurrenceCount = occurrenceList.length;
  const strongDupCount = duplicateReport.strongDuplicates.length;
  const mergedTotal = normalCount + occurrenceCount;
  const slotCount = 2383;

  console.log("=== PORTRAIT COUNT GATE ===");
  console.log("Normal tasks:", normalCount);
  console.log("Eligible recurring occurrences:", occurrenceCount);
  console.log("Potential strong duplicates with tasks:", strongDupCount);
  console.log(
    "Loose title+day overlaps (informational):",
    duplicateReport.looseDuplicates.length,
  );
  console.log("Total data points if merged into slots:", mergedTotal);
  console.log("Available SVG slots:", slotCount);
  console.log(
    "Decision: recurring data uses a SEPARATE background layer — portrait slots stay 2383.",
  );

  return {
    normalCount: normalCount,
    occurrenceCount: occurrenceCount,
    strongDupCount: strongDupCount,
    mergedTotal: mergedTotal,
    slotCount: slotCount,
    exceedsSlots: mergedTotal > slotCount,
  };
}
