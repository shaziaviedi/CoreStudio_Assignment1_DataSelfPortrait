const portraitContainer = document.getElementById("portrait-container");
const taskPanel = document.getElementById("task-panel");
const taskTitleEl = document.getElementById("task-title");
const taskDateEl = document.getElementById("task-date");
const taskTimeEl = document.getElementById("task-time");
const taskDurationEl = document.getElementById("task-duration");
const resetViewButton = document.getElementById("reset-view");
const currentTimeEl = document.getElementById("current-time");
const modeLiveButton = document.getElementById("mode-live");
const modeSettingsButton = document.getElementById("mode-settings");
const settingsPanel = document.getElementById("settings-panel");
const appElement = document.getElementById("app");

// DEVELOPMENT ONLY — REMOVE BEFORE FINAL
const devTimeControls = document.getElementById("dev-time-controls");
const devTimeSlider = document.getElementById("dev-time-slider");
const devTimeReadout = document.getElementById("dev-time-readout");
const devUseCurrentTimeButton = document.getElementById("dev-use-current-time");

let normalizedTasks = [];
let portraitSlots = [];

// Application interaction mode: "live" | "settings"
let interactionMode = "live";

// Live time filter: minutes since midnight (0–1439). Date is ignored.
// Remembered across mode switches — do not reset when leaving LIVE.
let selectedTimeMinutes = 0;

// When true, visualization tracks the browser clock continuously.
// Moving the TEST TIME slider turns this off until USE CURRENT TIME is clicked.
let followCurrentTime = true;
let currentTimeClockId = null;

// ---- Time-filter opacity (tune here) ----
// Portrait slots keep Illustrator shading via originalOpacity * multiplier.
const INACTIVE_MULTIPLIER = 0.35;
const ACTIVE_MIN_OPACITY = 0.9;
// Yellow Planning/Reset nodes are not part of the Illustrator portrait.
const INACTIVE_RECURRING_OPACITY = 0.12;

// ---- Camera / zoom state (SVG viewBox is the camera) ----
//
// TWO ways the camera moves (intentionally different):
// 1. MANUAL (wheel / trackpad / drag) → update `camera` immediately and stay there.
// 2. PROGRAMMATIC (click-to-task / RESET / Escape) → ease toward a destination.
//
// Mixing those caused bounce-back: wheel started a short animation whose
// unfinished target fought the next input. Manual moves must never animate.
const MIN_ZOOM = 1;
const MAX_ZOOM = 20;
const WHEEL_ZOOM_SENSITIVITY = 0.0035; // stronger = fewer scrolls to reach icons
const CAMERA_ANIM_MS = 520; // only for click-to-task / reset
const TASK_VIEW_PADDING = 5.5;
const TASK_PANEL_REVEAL_DISTANCE = 2.5;
const PAN_EDGE_SLACK = 0.55; // allow exploring portrait edges when zoomed in
const DRAG_THRESHOLD_PX = 4;

// Match the earlier CSS framing: height 135vh + translate(-10vh, 2vh)
const START_DISPLAY_SCALE = 1.35;
const START_NUDGE_X_VH = -0.1;
const START_NUDGE_Y_VH = 0.02;

let portraitSvg = null;

// Full artwork bounds (1080×1920). Used so zoom/pan can reach hair/edges.
let contentBounds = null;

// Immutable starting camera framing (zoom = 1 / RESET VIEW).
// This is the old on-load composition — NOT a padded full-art fit.
let originalViewBox = null;

// ONE authoritative live camera. Manual zoom/pan write here directly.
let camera = null;

// Animation bookkeeping — only used by animateToViewBox (task / reset).
let cameraAnimating = false;
let cameraRafId = null;
let cameraAnimStart = null;
let cameraAnimFrom = null;
let cameraAnimTo = null;
let prefersReducedMotion = false;

let selectedSlot = null;
let selectedTask = null;
let selectedFocusWidth = null;
let pendingTaskPanelReveal = false;

// Pan state
let isPanning = false;
let panPointerId = null;
let panStartClientX = 0;
let panStartClientY = 0;
let panOrigin = null;
let panScaleX = 1;
let panScaleY = 1;
let panMoved = false;

// Central Structured color → display color.
// Shades live in style.css as --task-* variables so you can tweak them in one place.
const structuredColorMap = {
  nature: "var(--task-green)", // school / studying / work
  night: "var(--task-blue)", // personal tasks
  day: "var(--task-coral)", // events & appointments
  sunshine: "var(--task-yellow)", // weekly reset / sunshine category
  "": "var(--task-neutral)", // empty JSON color
  yellow: "var(--task-yellow)", // alias reserved for older notes
};

let normalTasks = [];
let recurringOccurrences = [];
let recurringBackgroundNodes = [];
// normalizedTasks continues to mean the portrait's current data (tasks[] only).
// Recurring routine data lives on a separate SVG background layer.

// Category access model — single source for labels, colors, and locks.
// Inspection is always allowed; manipulable:false = cannot toggle visibility.
const categoryAccessModel = {
  workSchool: {
    id: "workSchool",
    label: "WORK / SCHOOL",
    colorKey: "nature",
    colors: ["nature", "forest"],
    manipulable: true,
  },
  events: {
    id: "events",
    label: "EVENTS / SCHEDULE",
    colorKey: "day",
    colors: ["day"],
    manipulable: true,
  },
  personal: {
    id: "personal",
    label: "PERSONAL",
    colorKey: "night",
    colors: ["night", "midnight", "twilight"],
    manipulable: false,
  },
  planningReset: {
    id: "planningReset",
    label: "PLANNING / RESET",
    colorKey: "sunshine",
    colors: ["sunshine", "yellow"],
    titles: ["planning and reset"],
    manipulable: false,
  },
};

// Explicit Structured sample/template task IDs (Buy Groceries, Prepare Food, Eat Lunch).
// These stay assigned to SVG slots as portrait structure, not personal data.
const SAMPLE_PLACEHOLDER_TASK_IDS = {
  "23E3EDDF-10A3-4B87-B466-7678900ED17D": true, // Buy Groceries
  "CC10963A-6C76-45E6-A9B8-F09A619B70F4": true, // Prepare Food
  "51AE6140-178C-448A-ABB4-85A54C548015": true, // Eat Lunch
};

function isSamplePlaceholderTaskId(taskId) {
  return Boolean(taskId && SAMPLE_PLACEHOLDER_TASK_IDS[taskId]);
}

function isSamplePlaceholderTask(task) {
  return Boolean(task && isSamplePlaceholderTaskId(task.id));
}

// Only manipulable categories have toggleable visibility state.
// personal + planningReset are intentionally absent (always visible).
// year: "all" | 2023 | 2024 | 2025 | 2026
const settingsState = {
  categories: {
    workSchool: true,
    events: true,
  },
  year: "all",
};

// Discrete year timeline positions (slider index → year value).
const YEAR_TIMELINE_OPTIONS = ["all", 2023, 2024, 2025, 2026];

const yearSlider = document.getElementById("year-slider");
const yearReadout = document.getElementById("year-readout");

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

  // size is controlled in style.css → #portrait-container svg
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

// Keep every scheduled task record. Do not filter by date, completion, notes, etc.
function normalizeTasks(rawData) {
  const rawTasks = rawData.tasks;
  const result = [];

  for (let i = 0; i < rawTasks.length; i++) {
    const task = rawTasks[i];

    // Only skip entries that are clearly not real task records
    if (!task || !task.id) {
      continue;
    }

    result.push(normalizeTask(task));
  }

  return result;
}

// ------------------------------------------------------------
// Recurring occurrence audit + normalization (separate from tasks[])
// Documented instances only — never invent Sundays from start_day.
// ------------------------------------------------------------

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

// Normalize one documented occurrence using its recurring definition.
function normalizeRecurringOccurrence(occurrence, definition) {
  return {
    // Instance-specific (from occurrence)
    id: occurrence.id,
    day: occurrence.day,
    completedAt: occurrence.completed_at,
    occurrenceCreatedAt: occurrence.created_at,
    occurrenceModifiedAt: occurrence.modified_at,
    isDetached: occurrence.is_detached,
    detachedTask: occurrence.detached_task,
    deleted: occurrence._deleted,

    // Definition information (from recurrings[])
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

// Only documented occurrence records that successfully join to a recurring definition.
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

  // Occurrence field inventory (for semantics)
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

// ============================================================
// LAYER 1 — Planning and Reset yellow nodes (beside the portrait)
// Scheduled instances from the recurring DEFINITION. Placed next
// to existing portrait circles without overlapping them.
// Portrait slots stay at 2383.
// ============================================================

const SVG_NS = "http://www.w3.org/2000/svg";
const PLANNING_RESET_RECURRING_ID = "A87921ED-54D5-4C21-B040-C51306109CD8";

// Portrait task circles use r ≈ 7.82 — keep yellow nodes in the same family.
const RECURRING_NODE_RADIUS = 8.4;
const RECURRING_PLACEMENT_GAP = 1.4;
const RECURRING_ANGLE_STEPS = 12;

const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

// ---- Safe calendar-date helpers (no timezone shift from Date.parse) ----

function parseCalendarDate(iso) {
  const parts = String(iso || "").split("-");
  return {
    y: Number(parts[0]),
    m: Number(parts[1]),
    d: Number(parts[2]),
  };
}

function formatCalendarDate(y, m, d) {
  const mm = m < 10 ? "0" + m : String(m);
  const dd = d < 10 ? "0" + d : String(d);
  return y + "-" + mm + "-" + dd;
}

function calendarDateToUtcDayIndex(y, m, d) {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function utcDayIndexToCalendarDate(dayIndex) {
  const dt = new Date(dayIndex * 86400000);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

function calendarWeekday(y, m, d) {
  // 0 = Sunday … 6 = Saturday in UTC calendar space
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function getTodayCalendarDate() {
  const now = new Date();
  return {
    y: now.getFullYear(),
    m: now.getMonth() + 1,
    d: now.getDate(),
  };
}

function compareCalendarDates(a, b) {
  if (a.y !== b.y) {
    return a.y - b.y;
  }
  if (a.m !== b.m) {
    return a.m - b.m;
  }
  return a.d - b.d;
}

function minCalendarDate(a, b) {
  return compareCalendarDates(a, b) <= 0 ? a : b;
}

function findPlanningResetDefinition(rawData) {
  const recurrings = (rawData && rawData.recurrings) || [];
  for (let i = 0; i < recurrings.length; i++) {
    const definition = recurrings[i];
    if (definition && definition.id === PLANNING_RESET_RECURRING_ID) {
      return definition;
    }
  }
  for (let i = 0; i < recurrings.length; i++) {
    const definition = recurrings[i];
    const title = String((definition && definition.title) || "")
      .trim()
      .toLowerCase();
    if (title === "planning and reset") {
      return definition;
    }
  }
  return null;
}

/*
  Generate every scheduled calendar date implied by the recurring definition,
  from start_day through min(today, end_day). Never invent past the current date.
  Respect weekday flags + interval weeks (interval 1 = every matching week).
*/
function generateScheduledDatesFromDefinition(definition, throughDate) {
  if (!definition || !definition.start_day) {
    return [];
  }

  const start = parseCalendarDate(definition.start_day);
  let end = throughDate || getTodayCalendarDate();

  if (definition.end_day) {
    end = minCalendarDate(end, parseCalendarDate(definition.end_day));
  }

  if (compareCalendarDates(start, end) > 0) {
    return [];
  }

  const intervalWeeks = Math.max(1, Number(definition.interval) || 1);
  const activeWeekdays = {};
  for (let w = 0; w < WEEKDAY_KEYS.length; w++) {
    if (definition[WEEKDAY_KEYS[w]]) {
      activeWeekdays[w] = true;
    }
  }

  // If no weekday flags are set, fall back to nothing rather than inventing days.
  if (Object.keys(activeWeekdays).length === 0) {
    return [];
  }

  const startIndex = calendarDateToUtcDayIndex(start.y, start.m, start.d);
  const endIndex = calendarDateToUtcDayIndex(end.y, end.m, end.d);
  const dates = [];

  for (let dayIndex = startIndex; dayIndex <= endIndex; dayIndex++) {
    const cal = utcDayIndexToCalendarDate(dayIndex);
    const weekday = calendarWeekday(cal.y, cal.m, cal.d);
    if (!activeWeekdays[weekday]) {
      continue;
    }

    // Weeks since start_day (floor), then keep every intervalWeeks-th week.
    const weeksSinceStart = Math.floor((dayIndex - startIndex) / 7);
    if (weeksSinceStart % intervalWeeks !== 0) {
      continue;
    }

    dates.push(formatCalendarDate(cal.y, cal.m, cal.d));
  }

  return dates;
}

function buildOccurrenceLookupByRecurringDay(occurrenceList) {
  const lookup = {};
  for (let i = 0; i < occurrenceList.length; i++) {
    const item = occurrenceList[i];
    if (!item) {
      continue;
    }
    const key = String(item.recurringId || "") + "|" + String(item.day || "");
    lookup[key] = item;
  }
  return lookup;
}

// Build scheduled instances for Planning and Reset, joining real occurrences.
function buildPlanningResetScheduledInstances(rawData, occurrenceList) {
  const definition = findPlanningResetDefinition(rawData);
  if (!definition) {
    console.warn("Planning and Reset recurring definition not found.");
    return [];
  }

  const scheduledDays = generateScheduledDatesFromDefinition(
    definition,
    getTodayCalendarDate(),
  );
  const occurrenceLookup = buildOccurrenceLookupByRecurringDay(occurrenceList);
  const instances = [];

  for (let i = 0; i < scheduledDays.length; i++) {
    const day = scheduledDays[i];
    const key = String(definition.id) + "|" + day;
    const matchedOccurrence = occurrenceLookup[key] || null;

    instances.push({
      id: "scheduled-" + definition.id + "-" + day,
      day: day,
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
      // Completion only when a real occurrence record exists for this date.
      completedAt: matchedOccurrence ? matchedOccurrence.completedAt : null,
      occurrence: matchedOccurrence,
      hasOccurrence: Boolean(matchedOccurrence),
      sourceType: "recurring-scheduled-instance",
    });
  }

  return instances;
}

function ensureRecurringBackgroundLayer(svgElement) {
  let layer = svgElement.querySelector("#recurring-background-layer");
  if (layer) {
    return layer;
  }

  layer = document.createElementNS(SVG_NS, "g");
  layer.setAttribute("id", "recurring-background-layer");

  // Draw after portrait slots so yellow nodes sit visibly beside circles.
  const portraitGroup = svgElement.querySelector("#PORTRAIT_SLOTS");
  if (portraitGroup && portraitGroup.parentNode) {
    if (portraitGroup.nextSibling) {
      portraitGroup.parentNode.insertBefore(layer, portraitGroup.nextSibling);
    } else {
      portraitGroup.parentNode.appendChild(layer);
    }
  } else {
    svgElement.appendChild(layer);
  }

  return layer;
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function collectPortraitCircleObstacles(slots) {
  const obstacles = [];
  let sumX = 0;
  let sumY = 0;

  for (let i = 0; i < slots.length; i++) {
    const background = getSlotBackground(slots[i]);
    if (!background) {
      continue;
    }
    const cx = Number(background.getAttribute("cx"));
    const cy = Number(background.getAttribute("cy"));
    const r = Number(background.getAttribute("r"));
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
      continue;
    }
    const radius = Number.isFinite(r) && r > 0 ? r : 7.82;
    obstacles.push({ cx: cx, cy: cy, r: radius });
    sumX += cx;
    sumY += cy;
  }

  const centroid =
    obstacles.length > 0
      ? { x: sumX / obstacles.length, y: sumY / obstacles.length }
      : { x: 540, y: 960 };

  // Prefer silhouette-edge hosts — more open directions for neighbors.
  const ranked = obstacles.slice().sort(function (a, b) {
    const da =
      (a.cx - centroid.x) * (a.cx - centroid.x) +
      (a.cy - centroid.y) * (a.cy - centroid.y);
    const db =
      (b.cx - centroid.x) * (b.cx - centroid.x) +
      (b.cy - centroid.y) * (b.cy - centroid.y);
    return db - da;
  });

  return {
    obstacles: obstacles,
    edgeHosts: ranked.slice(0, Math.max(80, Math.floor(ranked.length * 0.28))),
    centroid: centroid,
  };
}

function circlesCollide(a, b, gap) {
  const dx = a.cx - b.cx;
  const dy = a.cy - b.cy;
  const minDist = a.r + b.r + gap;
  return dx * dx + dy * dy < minDist * minDist;
}

function isClearOfObstacles(candidate, portraitObstacles, placedYellow, gap) {
  for (let i = 0; i < portraitObstacles.length; i++) {
    if (circlesCollide(candidate, portraitObstacles[i], gap)) {
      return false;
    }
  }
  for (let j = 0; j < placedYellow.length; j++) {
    if (circlesCollide(candidate, placedYellow[j], gap)) {
      return false;
    }
  }
  return true;
}

/*
  Place each yellow node beside an existing portrait circle.
  Prefer edge hosts and outward angles so nodes nest next to the
  silhouette without overlapping assigned tasks or each other.
*/
function positionAdjacentToPortrait(
  instance,
  layout,
  placedYellow,
) {
  const seed =
    String(instance.recurringId || "") + "|" + String(instance.day || "");
  const hash = hashSeed(seed);
  const hosts = layout.edgeHosts.length
    ? layout.edgeHosts
    : layout.obstacles;
  const gap = RECURRING_PLACEMENT_GAP;
  const yellowR = RECURRING_NODE_RADIUS;

  if (!hosts.length) {
    return { x: 80 + (hash % 200), y: 80 + ((hash >>> 8) % 200) };
  }

  const startHost = hash % hosts.length;
  const startAngle = hash % RECURRING_ANGLE_STEPS;

  for (let hostOffset = 0; hostOffset < hosts.length; hostOffset++) {
    const host = hosts[(startHost + hostOffset) % hosts.length];
    const outwardAngle = Math.atan2(
      host.cy - layout.centroid.y,
      host.cx - layout.centroid.x,
    );
    const distance = host.r + yellowR + gap;

    for (let step = 0; step < RECURRING_ANGLE_STEPS; step++) {
      const angleIndex = (startAngle + step) % RECURRING_ANGLE_STEPS;
      // Step 0 ≈ outward from silhouette; remaining steps ring the host.
      const angle =
        outwardAngle + (angleIndex / RECURRING_ANGLE_STEPS) * Math.PI * 2;

      const candidate = {
        cx: host.cx + Math.cos(angle) * distance,
        cy: host.cy + Math.sin(angle) * distance,
        r: yellowR,
      };

      if (
        candidate.cx < 16 ||
        candidate.cx > 1064 ||
        candidate.cy < 16 ||
        candidate.cy > 1904
      ) {
        continue;
      }

      if (
        isClearOfObstacles(
          candidate,
          layout.obstacles,
          placedYellow,
          gap,
        )
      ) {
        return { x: candidate.cx, y: candidate.cy };
      }
    }

    // Slightly farther ring if the tight neighbor ring is packed.
    const farDistance = distance + yellowR * 0.85;
    for (let step = 0; step < RECURRING_ANGLE_STEPS; step++) {
      const angleIndex = (startAngle + step) % RECURRING_ANGLE_STEPS;
      const angle =
        outwardAngle + (angleIndex / RECURRING_ANGLE_STEPS) * Math.PI * 2;
      const candidate = {
        cx: host.cx + Math.cos(angle) * farDistance,
        cy: host.cy + Math.sin(angle) * farDistance,
        r: yellowR,
      };
      if (
        candidate.cx < 16 ||
        candidate.cx > 1064 ||
        candidate.cy < 16 ||
        candidate.cy > 1904
      ) {
        continue;
      }
      if (
        isClearOfObstacles(
          candidate,
          layout.obstacles,
          placedYellow,
          gap,
        )
      ) {
        return { x: candidate.cx, y: candidate.cy };
      }
    }
  }

  // Last resort: push outward from centroid without host attachment.
  const fallbackAngle = ((hash % 360) * Math.PI) / 180;
  return {
    x: layout.centroid.x + Math.cos(fallbackAngle) * 420,
    y: layout.centroid.y + Math.sin(fallbackAngle) * 520,
  };
}

function createRecurringNode(instance, point) {
  const cx = point.x;
  const cy = point.y;
  const nodeId = "recurring-node-" + String(instance.day);

  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("id", nodeId);
  group.setAttribute(
    "class",
    "recurring-node protected-category planning-reset-node",
  );
  group.setAttribute("data-source-type", "recurring-scheduled-instance");
  group.setAttribute("data-recurring-id", instance.recurringId || "");
  group.setAttribute("data-day", instance.day || "");
  group.setAttribute(
    "data-has-occurrence",
    instance.hasOccurrence ? "true" : "false",
  );
  group.assignedTask = instance;

  const background = document.createElementNS(SVG_NS, "circle");
  background.setAttribute("id", nodeId + "-background");
  background.setAttribute("cx", String(cx));
  background.setAttribute("cy", String(cy));
  background.setAttribute("r", String(RECURRING_NODE_RADIUS));
  background.style.fill = getTaskDisplayColor(instance.color || "sunshine");

  const iconGroup = document.createElementNS(SVG_NS, "g");
  iconGroup.setAttribute("id", nodeId + "-icon");
  iconGroup.setAttribute("data-symbol", instance.symbol || "calendar");
  iconGroup.setAttribute("transform", "translate(" + cx + "," + cy + ")");

  const artwork = hasIconArtwork(instance.symbol)
    ? structuredIconMap[instance.symbol]
    : hasIconArtwork("calendar")
      ? structuredIconMap["calendar"]
      : DEVELOPMENT_FALLBACK_ICON;
  iconGroup.innerHTML = artwork;

  group.appendChild(background);
  group.appendChild(iconGroup);

  return group;
}

function renderPlanningResetBackgroundLayer(
  svgElement,
  backgroundInstances,
  portraitSlots,
) {
  const layer = ensureRecurringBackgroundLayer(svgElement);
  layer.innerHTML = "";
  recurringBackgroundNodes = [];

  const instances = backgroundInstances || [];
  const layout = collectPortraitCircleObstacles(portraitSlots || []);
  const placedYellow = [];

  for (let i = 0; i < instances.length; i++) {
    const point = positionAdjacentToPortrait(
      instances[i],
      layout,
      placedYellow,
    );
    placedYellow.push({
      cx: point.x,
      cy: point.y,
      r: RECURRING_NODE_RADIUS,
    });
    const node = createRecurringNode(instances[i], point);
    layer.appendChild(node);
    recurringBackgroundNodes.push(node);
  }

  return instances;
}

function addRecurringNodeInteraction(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    node.addEventListener("click", function (event) {
      if (panMoved) {
        panMoved = false;
        return;
      }

      const record = node.assignedTask;
      if (!record) {
        return;
      }

      event.stopPropagation();
      console.log(
        "Selected scheduled Planning and Reset instance:",
        record.day,
        "hasOccurrence=",
        record.hasOccurrence,
      );
      // Inspection allowed; category manipulation remains locked later.
      zoomToTask(node, record);
    });
  }
}

function printPlanningResetSchedule(definition, instances) {
  let withOccurrence = 0;
  for (let i = 0; i < instances.length; i++) {
    if (instances[i].hasOccurrence) {
      withOccurrence += 1;
    }
  }

  const latest =
    instances.length > 0 ? instances[instances.length - 1].day : null;

  console.log("=== PLANNING AND RESET SCHEDULE ===");
  console.log("");
  console.log("Recurring definition:");
  console.log(definition ? definition.title : "(missing)");
  console.log("");
  console.log("Start:");
  console.log(definition ? definition.start_day : null);
  console.log("");
  console.log("Generated through:");
  console.log(latest);
  console.log("");
  console.log("Scheduled instances:");
  console.log(instances.length);
  console.log("");
  console.log("Instances with matching occurrence records:");
  console.log(withOccurrence);
  console.log("");
  console.log("Instances without matching occurrence records:");
  console.log(instances.length - withOccurrence);
  console.log("");
  console.table(
    instances.map(function (item) {
      return {
        date: item.day,
        title: item.title,
        color: item.color,
        symbol: item.symbol,
        hasOccurrence: item.hasOccurrence,
        sourceType: item.sourceType,
      };
    }),
  );
}

function printVisualDataLayers(planningResetRecords) {
  console.log("=== VISUAL DATA LAYERS ===");
  console.log("");
  console.log("Portrait slots:", 2383);
  console.log("Portrait tasks:", normalTasks.length);
  console.log(
    "Planning and Reset yellow nodes (beside portrait):",
    recurringBackgroundNodes.length,
  );
  console.log(
    "Total visible data points:",
    normalTasks.length + recurringBackgroundNodes.length,
  );
  console.log("");
  console.log(
    "Category access model (manipulation later):",
    categoryAccessModel,
  );
}

// Find only real slot groups (slot-1, slot-001, …), not slot-001-background / slot-001-icon.
// Sort numerically: slot-1, slot-2, slot-10 (not alphabetical).
function getPortraitSlots(svgElement) {
  const candidates = svgElement.querySelectorAll('g[id^="slot-"]');
  const slots = [];

  for (let i = 0; i < candidates.length; i++) {
    const node = candidates[i];

    // exact pattern: "slot-" + digits only
    if (/^slot-\d+$/.test(node.id)) {
      slots.push(node);
    }
  }

  slots.sort(function (a, b) {
    const numA = parseInt(a.id.replace("slot-", ""), 10);
    const numB = parseInt(b.id.replace("slot-", ""), 10);
    return numA - numB;
  });

  return slots;
}

// Assign exactly one normalized task to every portrait slot (1:1 by sorted index).
function assignTasksToSlots(slots, tasks) {
  const assignCount = Math.min(slots.length, tasks.length);
  const unassignedSlots = [];
  const unassignedTasks = [];

  for (let i = 0; i < assignCount; i++) {
    const slot = slots[i];
    const task = tasks[i];

    slot.classList.add("task-slot");
    slot.setAttribute("data-task-index", String(i));

    if (task.id) {
      slot.setAttribute("data-task-id", task.id);
    }

    // Raw source assignment (never reordered / deleted).
    slot.sourceTask = task;
    // Visual assignment — may later point at a Planning/Reset instance.
    slot.assignedTask = task;
    slot.visualRecord = null;

    if (isSamplePlaceholderTask(task)) {
      slot.classList.add("is-sample-placeholder");
      slot.setAttribute("data-data-kind", "samplePlaceholder");
      slot.setAttribute("data-source-kind", "samplePlaceholder");
    }
  }

  for (let i = assignCount; i < slots.length; i++) {
    unassignedSlots.push(slots[i]);
  }

  for (let i = assignCount; i < tasks.length; i++) {
    unassignedTasks.push(tasks[i]);
  }

  console.log("Portrait slots:", slots.length);
  console.log("Tasks:", tasks.length);
  console.log("Assigned:", assignCount);
  console.log("Unassigned slots:", unassignedSlots.length);
  console.log("Unassigned tasks:", unassignedTasks.length);

  if (unassignedSlots.length > 0) {
    const ids = [];
    for (let i = 0; i < unassignedSlots.length; i++) {
      ids.push(unassignedSlots[i].id);
    }
    console.warn("Unassigned slot IDs:", ids);
  }

  return {
    assignedCount: assignCount,
    unassignedSlots: unassignedSlots,
    unassignedTasks: unassignedTasks,
  };
}

// Collect unique Structured symbols (exact values from JSON).
function analyzeSymbols(tasks) {
  const uniqueSymbols = new Set();
  let withSymbol = 0;
  let withoutSymbol = 0;

  for (let i = 0; i < tasks.length; i++) {
    const symbol = tasks[i].symbol;

    if (symbol === null || symbol === undefined || symbol === "") {
      withoutSymbol += 1;
    } else {
      withSymbol += 1;
      uniqueSymbols.add(symbol);
    }
  }

  console.log("Unique Structured symbols:", Array.from(uniqueSymbols).sort());
  console.log("Tasks with symbol:", withSymbol);
  console.log("Tasks without symbol:", withoutSymbol);

  return {
    uniqueSymbols: uniqueSymbols,
    withSymbol: withSymbol,
    withoutSymbol: withoutSymbol,
  };
}

// Collect unique Structured color values + counts.
function analyzeColors(tasks) {
  const counts = {};

  for (let i = 0; i < tasks.length; i++) {
    const key =
      tasks[i].color === null || tasks[i].color === undefined
        ? "<null>"
        : String(tasks[i].color);

    if (!counts[key]) {
      counts[key] = 0;
    }
    counts[key] += 1;
  }

  console.log("Unique Structured colors + counts:", counts);

  return counts;
}

// Map a Structured color string to a display hex.
function getTaskDisplayColor(structuredColor) {
  const key =
    structuredColor === null || structuredColor === undefined
      ? ""
      : String(structuredColor);

  if (Object.prototype.hasOwnProperty.call(structuredColorMap, key)) {
    return structuredColorMap[key];
  }

  // Unknown Structured color value — keep a visible neutral rather than inventing a category.
  return structuredColorMap[""];
}

// True only when structuredIconMap has real artwork for this exact symbol.
function hasIconArtwork(symbol) {
  return Boolean(symbol && structuredIconMap[symbol]);
}

// Which Structured symbols still need custom artwork?
function getMissingIconSymbols(uniqueSymbols) {
  const missing = [];
  const symbols = Array.from(uniqueSymbols).sort();

  for (let i = 0; i < symbols.length; i++) {
    const name = symbols[i];
    if (!hasIconArtwork(name)) {
      missing.push(name);
    }
  }

  console.log("Structured symbols still needing artwork:", missing);
  return missing;
}

// Build a frequency + example-title audit for every unique Structured symbol.
function buildIconAudit(tasks) {
  const bySymbol = {};

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const symbol = task.symbol;

    if (symbol === null || symbol === undefined || symbol === "") {
      continue;
    }

    if (!bySymbol[symbol]) {
      bySymbol[symbol] = {
        symbol: symbol,
        count: 0,
        exampleTitles: [],
      };
    }

    bySymbol[symbol].count += 1;

    if (bySymbol[symbol].exampleTitles.length < 3) {
      const title = task.title || "(untitled)";
      if (bySymbol[symbol].exampleTitles.indexOf(title) === -1) {
        bySymbol[symbol].exampleTitles.push(title);
      }
    }
  }

  const auditRows = [];
  const symbols = Object.keys(bySymbol);

  for (let i = 0; i < symbols.length; i++) {
    const entry = bySymbol[symbols[i]];
    auditRows.push({
      symbol: entry.symbol,
      count: entry.count,
      hasArtwork: hasIconArtwork(entry.symbol),
      example1: entry.exampleTitles[0] || "",
      example2: entry.exampleTitles[1] || "",
      example3: entry.exampleTitles[2] || "",
    });
  }

  // Most-used symbol first
  auditRows.sort(function (a, b) {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    if (a.symbol < b.symbol) {
      return -1;
    }
    if (a.symbol > b.symbol) {
      return 1;
    }
    return 0;
  });

  return auditRows;
}

// Print full audit + missing-only audit + top 20 missing priorities.
function printIconAudit(auditRows) {
  console.log("=== STRUCTURED ICON AUDIT (all unique symbols) ===");
  console.table(auditRows);

  const missingRows = [];
  for (let i = 0; i < auditRows.length; i++) {
    if (!auditRows[i].hasArtwork) {
      missingRows.push(auditRows[i]);
    }
  }

  console.log("=== MISSING ICON ARTWORK ONLY ===");
  console.table(missingRows);

  console.log("=== TOP 20 MISSING ICONS TO CREATE ===");
  const topMissing = missingRows.slice(0, 20);
  for (let i = 0; i < topMissing.length; i++) {
    const row = topMissing[i];
    console.log(i + 1 + ". " + row.symbol);
    console.log("   usage count: " + row.count);
    console.log(
      "   examples: " +
        [row.example1, row.example2, row.example3]
          .filter(function (title) {
            return title;
          })
          .join(" | "),
    );
  }

  return {
    auditRows: auditRows,
    missingRows: missingRows,
    topMissing: topMissing,
  };
}

// Count how many tasks show real artwork vs development fallback.
function countIconUsage(tasks) {
  let withArtwork = 0;
  let withFallback = 0;

  for (let i = 0; i < tasks.length; i++) {
    if (hasIconArtwork(tasks[i].symbol)) {
      withArtwork += 1;
    } else {
      withFallback += 1;
    }
  }

  return {
    withArtwork: withArtwork,
    withFallback: withFallback,
  };
}

// Get the circle / background shape inside a slot (preserve cx, cy, r).
function getSlotBackground(slot) {
  const byId = slot.querySelector('[id$="-background"]');
  if (byId) {
    return byId;
  }
  return slot.querySelector("circle");
}

// Get the icon group inside a slot.
function getSlotIconGroup(slot) {
  const byId = slot.querySelector('[id$="-icon"]');
  if (byId) {
    return byId;
  }
  return null;
}

// Update circle fill + icon for one slot from a display record.
function applyRecordVisualsToSlot(slot, record) {
  if (!slot || !record) {
    return;
  }

  const background = getSlotBackground(slot);
  const iconGroup = getSlotIconGroup(slot);

  if (background) {
    const fillColor = getTaskDisplayColor(record.color);
    // Inline style beats the Illustrator class fills inside the SVG <style> block.
    background.style.fill = fillColor;
  }

  if (iconGroup && background) {
    const cx = parseFloat(background.getAttribute("cx"));
    const cy = parseFloat(background.getAttribute("cy"));

    // Exact Structured match only — never infer from task.title
    const symbol = record.symbol;
    const hasArtwork = hasIconArtwork(symbol);
    const artwork = hasArtwork
      ? structuredIconMap[symbol]
      : hasIconArtwork("calendar") && record.sourceType === "recurring-scheduled-instance"
        ? structuredIconMap["calendar"]
        : DEVELOPMENT_FALLBACK_ICON;

    iconGroup.setAttribute("transform", "translate(" + cx + "," + cy + ")");
    iconGroup.setAttribute("data-symbol", symbol || "");
    if (!hasArtwork && artwork === DEVELOPMENT_FALLBACK_ICON) {
      iconGroup.setAttribute("data-icon-fallback", "development");
    } else {
      iconGroup.removeAttribute("data-icon-fallback");
    }
    iconGroup.innerHTML = artwork;
  }
}

// Update circle fill + icon for every assigned slot from its visual record.
function applyTaskVisuals(slots) {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const record = slot.assignedTask;
    if (!record) {
      continue;
    }
    applyRecordVisualsToSlot(slot, record);
  }
}

/*
  Visual assignment layer:
  Move the first 3 chronological Planning/Reset instances into the
  verified samplePlaceholder SVG slots. Geometry / opacity stay put.
  Those 3 must NOT also render in the background layer.
*/
const PLANNING_RESET_PORTRAIT_COUNT = 3;

function getSamplePlaceholderSlots(slots) {
  const result = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const source = slot.sourceTask || slot.assignedTask;
    if (isSamplePlaceholderTask(source)) {
      result.push(slot);
    }
  }
  return result;
}

function selectPortraitPlanningResetInstances(instances, count) {
  // buildPlanningResetScheduledInstances is already chronological.
  const selected = [];
  for (let i = 0; i < instances.length && selected.length < count; i++) {
    selected.push(instances[i]);
  }
  return selected;
}

function assignPlanningResetVisualsToPlaceholderSlots(slots, allInstances) {
  const placeholderSlots = getSamplePlaceholderSlots(slots);
  const portraitInstances = selectPortraitPlanningResetInstances(
    allInstances,
    PLANNING_RESET_PORTRAIT_COUNT,
  );
  const usedDayKeys = {};

  if (placeholderSlots.length !== PLANNING_RESET_PORTRAIT_COUNT) {
    console.warn(
      "Expected",
      PLANNING_RESET_PORTRAIT_COUNT,
      "samplePlaceholder slots, found",
      placeholderSlots.length,
    );
  }

  if (portraitInstances.length < PLANNING_RESET_PORTRAIT_COUNT) {
    console.warn(
      "Not enough Planning/Reset instances to fill placeholder slots:",
      portraitInstances.length,
    );
  }

  const assignedPortrait = [];
  const pairCount = Math.min(
    placeholderSlots.length,
    portraitInstances.length,
    PLANNING_RESET_PORTRAIT_COUNT,
  );

  for (let i = 0; i < pairCount; i++) {
    const slot = placeholderSlots[i];
    const instance = portraitInstances[i];

    if (!slot.sourceTask) {
      slot.sourceTask = slot.assignedTask;
    }

    slot.visualRecord = instance;
    slot.assignedTask = instance;
    usedDayKeys[String(instance.day)] = true;

    slot.classList.remove("is-sample-placeholder");
    slot.classList.add("planning-reset-node", "protected-category");
    slot.setAttribute("data-data-kind", "planningReset-visual");
    slot.setAttribute("data-source-kind", "samplePlaceholder");
    slot.setAttribute("data-source-type", "recurring-scheduled-instance");
    slot.setAttribute("data-recurring-id", instance.recurringId || "");
    slot.setAttribute("data-day", instance.day || "");

    // Yellow + calendar; ORIGINAL slot opacity is preserved separately.
    applyRecordVisualsToSlot(slot, instance);
    assignedPortrait.push({
      slotId: slot.id,
      day: instance.day,
      instanceId: instance.id,
      originalOpacity: slot.dataset.originalOpacity || null,
    });
  }

  const backgroundInstances = [];
  for (let j = 0; j < allInstances.length; j++) {
    const instance = allInstances[j];
    if (!usedDayKeys[String(instance.day)]) {
      backgroundInstances.push(instance);
    }
  }

  console.log("=== PLANNING/RESET VISUAL REMAP ===");
  console.log("Placeholder slots remapped:", assignedPortrait);
  console.log("Portrait Planning/Reset nodes:", assignedPortrait.length);
  console.log("Background Planning/Reset nodes:", backgroundInstances.length);
  console.log(
    "Total Planning/Reset instances:",
    assignedPortrait.length + backgroundInstances.length,
  );

  return {
    portraitInstances: portraitInstances.slice(0, pairCount),
    backgroundInstances: backgroundInstances,
    remappedSlots: assignedPortrait,
  };
}

function printVisualDataAssignment(slots, backgroundNodes, remapInfo) {
  let personalPortrait = 0;
  let planningResetPortrait = 0;
  let visiblePlaceholders = 0;
  let rawPlaceholders = 0;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const source = slot.sourceTask;
    const visual = slot.assignedTask;

    if (isSamplePlaceholderTask(source)) {
      rawPlaceholders += 1;
    }

    if (slot.classList.contains("is-sample-placeholder")) {
      visiblePlaceholders += 1;
    }

    if (visual && visual.sourceType === "recurring-scheduled-instance") {
      planningResetPortrait += 1;
    } else if (visual && !isSamplePlaceholderTask(visual)) {
      personalPortrait += 1;
    }
  }

  const backgroundCount = backgroundNodes.length;
  const totalPlanningReset = planningResetPortrait + backgroundCount;
  const meaningfulPortrait = personalPortrait + planningResetPortrait;
  const meaningfulTotal = meaningfulPortrait + backgroundCount;

  console.log("=== VISUAL DATA ASSIGNMENT ===");
  console.log("");
  console.log("SVG portrait slots:", slots.length);
  console.log("");
  console.log("Normal personal task nodes:", personalPortrait);
  console.log("Planning/Reset portrait nodes:", planningResetPortrait);
  console.log("Meaningful portrait nodes:", meaningfulPortrait);
  console.log("");
  console.log("Planning/Reset background nodes:", backgroundCount);
  console.log("Total Planning/Reset instances represented:", totalPlanningReset);
  console.log("Total meaningful data points represented:", meaningfulTotal);
  console.log("Grey/sample placeholder nodes visible:", visiblePlaceholders);
  console.log("");
  console.log("Raw tasks[] records:", slots.length);
  console.log("Raw samplePlaceholder records:", rawPlaceholders);

  return {
    slotCount: slots.length,
    personalPortrait: personalPortrait,
    planningResetPortrait: planningResetPortrait,
    backgroundCount: backgroundCount,
    totalPlanningReset: totalPlanningReset,
    meaningfulTotal: meaningfulTotal,
    visiblePlaceholders: visiblePlaceholders,
    rawPlaceholders: rawPlaceholders,
    remapInfo: remapInfo || null,
  };
}

// ============================================================
// CAMERA — full-screen SVG viewBox navigation
// ============================================================

function copyViewBox(vb) {
  return {
    x: vb.x,
    y: vb.y,
    width: vb.width,
    height: vb.height,
  };
}

function parseViewBox(svgElement) {
  const raw = svgElement.getAttribute("viewBox");
  if (!raw) {
    return { x: 0, y: 0, width: 1080, height: 1920 };
  }

  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return {
    x: parts[0] || 0,
    y: parts[1] || 0,
    width: parts[2] || 1080,
    height: parts[3] || 1920,
  };
}

// Zoom is derived from camera size — never stored separately.
function getZoomLevel() {
  if (!originalViewBox || !camera || camera.width <= 0) {
    return 1;
  }
  return originalViewBox.width / camera.width;
}

function applyViewBox() {
  if (!portraitSvg || !camera) {
    return;
  }

  portraitSvg.setAttribute(
    "viewBox",
    camera.x + " " + camera.y + " " + camera.width + " " + camera.height,
  );
}

/*
  Soft clamp:
  - Zoom limits are relative to originalViewBox (on-load framing).
  - At zoom 1, snaps exactly to originalViewBox.
  - Pan uses full contentBounds + slack so zoomed-in views can reach hair/edges
    without being trapped in the starting crop.
  - Never snaps back on pointerup / wheel-end.
*/
function clampCamera(next) {
  const clamped = copyViewBox(next);
  const aspect = originalViewBox.height / originalViewBox.width;
  const minW = originalViewBox.width / MAX_ZOOM;
  const maxW = originalViewBox.width / MIN_ZOOM;

  clamped.width = Math.min(Math.max(clamped.width, minW), maxW);
  clamped.height = clamped.width * aspect;

  if (clamped.width >= originalViewBox.width - 0.01) {
    return copyViewBox(originalViewBox);
  }

  // Pan against the FULL artwork so zoomed-in navigation can reach every edge.
  const bounds = contentBounds || originalViewBox;
  const slackX = clamped.width * PAN_EDGE_SLACK;
  const slackY = clamped.height * PAN_EDGE_SLACK;
  const minX = bounds.x - slackX;
  const maxX = bounds.x + bounds.width - clamped.width + slackX;
  const minY = bounds.y - slackY;
  const maxY = bounds.y + bounds.height - clamped.height + slackY;

  clamped.x = Math.min(Math.max(clamped.x, minX), maxX);
  clamped.y = Math.min(Math.max(clamped.y, minY), maxY);

  return clamped;
}

function setCamera(next) {
  camera = clampCamera(next);
  applyViewBox();
  updateZoomChrome();
}

function updateZoomChrome() {
  if (!portraitContainer || !originalViewBox || !camera) {
    return;
  }

  const zoom = getZoomLevel();
  const zoomed = zoom > 1.02;

  portraitContainer.classList.toggle("is-zoomed", zoomed);
  portraitContainer.classList.toggle("is-zoomed-deep", zoom >= 6);

  if (resetViewButton) {
    resetViewButton.hidden = !(zoomed || selectedTask);
  }
}

// Browser client (screen) → SVG user units via the live screen CTM.
function screenToSvgPoint(clientX, clientY) {
  if (!portraitSvg) {
    return { x: 0, y: 0 };
  }

  const ctm = portraitSvg.getScreenCTM();
  if (!ctm) {
    return { x: 0, y: 0 };
  }

  const point = portraitSvg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const svgPoint = point.matrixTransform(ctm.inverse());
  return { x: svgPoint.x, y: svgPoint.y };
}

/*
  Pointer-centered zoom (manual, immediate):

  1. Read the SVG point under the cursor.
  2. Remember its fractional position inside the current camera (rx, ry).
  3. Scale camera width/height by 1/zoomFactor.
  4. Reposition x/y so that same SVG point stays at (rx, ry).

  Then STOP. No animation. No return to originalViewBox.
*/
function zoomAtPoint(clientX, clientY, zoomFactor) {
  if (!camera) {
    return;
  }

  cancelCameraAnimation();

  const pointer = screenToSvgPoint(clientX, clientY);
  const rx = (pointer.x - camera.x) / camera.width;
  const ry = (pointer.y - camera.y) / camera.height;

  let nextWidth = camera.width / zoomFactor;
  const minW = originalViewBox.width / MAX_ZOOM;
  const maxW = originalViewBox.width / MIN_ZOOM;
  nextWidth = Math.min(Math.max(nextWidth, minW), maxW);
  const nextHeight =
    nextWidth * (originalViewBox.height / originalViewBox.width);

  setCamera({
    x: pointer.x - rx * nextWidth,
    y: pointer.y - ry * nextHeight,
    width: nextWidth,
    height: nextHeight,
  });

  maybeClearSelectionAfterCameraMove();
}

function handleWheelZoom(event) {
  event.preventDefault();

  // User input always cancels any click-to-task / reset animation.
  cancelCameraAnimation();

  // deltaY < 0 (scroll up / pinch inward) → zoomFactor > 1 → zoom IN
  // deltaY > 0 (scroll down) → zoomFactor < 1 → zoom OUT
  const zoomFactor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
  zoomAtPoint(event.clientX, event.clientY, zoomFactor);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Stop any in-flight programmatic animation so manual input wins.
function cancelCameraAnimation() {
  if (cameraRafId !== null) {
    cancelAnimationFrame(cameraRafId);
    cameraRafId = null;
  }
  cameraAnimating = false;
  cameraAnimStart = null;
  cameraAnimFrom = null;
  cameraAnimTo = null;
  // Keep pendingTaskPanelReveal only if a focus animation still owns it —
  // cancelling due to user scroll should drop the pending reveal.
  pendingTaskPanelReveal = false;
}

function finishCameraAnimation() {
  if (cameraAnimTo) {
    setCamera(cameraAnimTo);
  }
  cameraAnimating = false;
  cameraRafId = null;
  cameraAnimStart = null;
  cameraAnimFrom = null;
  cameraAnimTo = null;

  if (pendingTaskPanelReveal) {
    pendingTaskPanelReveal = false;
    showTaskPanel(selectedTask);
  }

  maybeClearSelectionAfterCameraMove();
}

/*
  Programmatic camera moves ONLY (click-to-task, RESET VIEW, Escape).
  Manual wheel/pan must never call this — that was the bounce-back bug.
*/
function animateToViewBox(nextViewBox, options) {
  const opts = options || {};
  const destination = clampCamera(nextViewBox);

  cancelCameraAnimation();

  pendingTaskPanelReveal = Boolean(opts.revealTaskPanel);
  cameraAnimFrom = copyViewBox(camera);
  cameraAnimTo = destination;
  cameraAnimStart = performance.now();

  if (prefersReducedMotion) {
    finishCameraAnimation();
    return;
  }

  cameraAnimating = true;

  function tick(now) {
    if (!cameraAnimating) {
      cameraRafId = null;
      return;
    }

    const duration = opts.duration || CAMERA_ANIM_MS;
    const t = Math.min(1, (now - cameraAnimStart) / duration);
    const e = easeOutCubic(t);

    camera = {
      x: lerp(cameraAnimFrom.x, cameraAnimTo.x, e),
      y: lerp(cameraAnimFrom.y, cameraAnimTo.y, e),
      width: lerp(cameraAnimFrom.width, cameraAnimTo.width, e),
      height: lerp(cameraAnimFrom.height, cameraAnimTo.height, e),
    };
    applyViewBox();
    updateZoomChrome();

    if (pendingTaskPanelReveal && t > 0.82) {
      pendingTaskPanelReveal = false;
      showTaskPanel(selectedTask);
    }

    if (t >= 1) {
      finishCameraAnimation();
      return;
    }

    cameraRafId = requestAnimationFrame(tick);
  }

  cameraRafId = requestAnimationFrame(tick);
}

function initializeCamera(svgElement) {
  portraitSvg = svgElement;
  prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  // Full-screen SVG surface — the browser window is the camera viewport.
  // No smaller CSS frame, so zooming in never hits an artificial crop edge.
  portraitSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  portraitSvg.removeAttribute("width");
  portraitSvg.removeAttribute("height");

  contentBounds = parseViewBox(svgElement);

  // Restore the previous on-load composition (CSS was height:135vh +
  // translate(-10vh, 2vh)) as the zoom-1 / RESET VIEW camera framing.
  const scale = START_DISPLAY_SCALE;
  const startW = contentBounds.width / scale;
  const startH = contentBounds.height / scale;
  const centerX = contentBounds.x + contentBounds.width / 2;
  const centerY = contentBounds.y + contentBounds.height / 2;
  // Convert the old vh nudges into SVG units at that display scale.
  const nudgeX = (-START_NUDGE_X_VH * contentBounds.height) / scale;
  const nudgeY = (-START_NUDGE_Y_VH * contentBounds.height) / scale;

  originalViewBox = {
    x: centerX - startW / 2 + nudgeX,
    y: centerY - startH / 2 + nudgeY,
    width: startW,
    height: startH,
  };

  camera = copyViewBox(originalViewBox);
  applyViewBox();
  updateZoomChrome();

  // Single wheel listener on the container — never per-slot.
  portraitContainer.addEventListener("wheel", handleWheelZoom, {
    passive: false,
  });

  portraitContainer.addEventListener("pointerdown", handlePanPointerDown);
  portraitContainer.addEventListener("pointermove", handlePanPointerMove);
  portraitContainer.addEventListener("pointerup", handlePanPointerUp);
  portraitContainer.addEventListener("pointercancel", handlePanPointerUp);
  portraitContainer.addEventListener("lostpointercapture", handlePanPointerUp);

  if (resetViewButton) {
    resetViewButton.addEventListener("click", function () {
      resetView();
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      resetView();
    }
  });
}

function handlePanPointerDown(event) {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }

  if (getZoomLevel() <= 1.02) {
    return;
  }

  // Pan can start anywhere — including on task circles.
  // A real click (no drag past the threshold) still selects the task.
  cancelCameraAnimation();

  isPanning = true;
  panMoved = false;
  panPointerId = event.pointerId;
  panStartClientX = event.clientX;
  panStartClientY = event.clientY;
  panOrigin = copyViewBox(camera);

  // Freeze the screen→SVG scale at drag start (handles meet letterboxing).
  const ctm = portraitSvg.getScreenCTM();
  panScaleX = ctm && ctm.a ? ctm.a : 1;
  panScaleY = ctm && ctm.d ? ctm.d : 1;

  if (portraitContainer.setPointerCapture) {
    portraitContainer.setPointerCapture(event.pointerId);
  }
}

function handlePanPointerMove(event) {
  if (!isPanning || event.pointerId !== panPointerId || !panOrigin) {
    return;
  }

  const dxScreen = event.clientX - panStartClientX;
  const dyScreen = event.clientY - panStartClientY;

  // Ignore tiny movement so a click on a circle does not nudge the camera.
  if (
    Math.abs(dxScreen) <= DRAG_THRESHOLD_PX &&
    Math.abs(dyScreen) <= DRAG_THRESHOLD_PX
  ) {
    return;
  }

  panMoved = true;
  portraitContainer.classList.add("is-panning");

  const dxSvg = dxScreen / panScaleX;
  const dySvg = dyScreen / panScaleY;

  // Drag right → content moves right → camera x decreases.
  setCamera({
    x: panOrigin.x - dxSvg,
    y: panOrigin.y - dySvg,
    width: panOrigin.width,
    height: panOrigin.height,
  });

  maybeClearSelectionAfterCameraMove();
}

function handlePanPointerUp(event) {
  if (!isPanning) {
    return;
  }

  if (panPointerId !== null && event && event.pointerId !== panPointerId) {
    return;
  }

  // Intentionally do nothing to the camera — it stays where the user left it.
  isPanning = false;
  panPointerId = null;
  panOrigin = null;
  portraitContainer.classList.remove("is-panning");
}

function formatStartTime(startTime) {
  if (startTime === null || startTime === undefined || startTime === "") {
    return "";
  }

  const numeric = Number(startTime);
  if (Number.isNaN(numeric)) {
    return String(startTime);
  }

  const hour24 = Math.floor(numeric);
  const minutes = Math.round((numeric - hour24) * 60);
  const period = hour24 >= 12 ? "PM" : "AM";
  let hour12 = hour24 % 12;
  if (hour12 === 0) {
    hour12 = 12;
  }

  const minuteText = minutes < 10 ? "0" + minutes : String(minutes);
  return hour12 + ":" + minuteText + " " + period;
}

function formatDuration(duration) {
  if (duration === null || duration === undefined || duration === "") {
    return "";
  }

  const minutes = Number(duration);
  if (Number.isNaN(minutes)) {
    return String(duration);
  }

  if (minutes < 60) {
    return minutes + " min";
  }

  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) {
    return hours + (hours === 1 ? " hr" : " hrs");
  }
  return hours + " hr " + rem + " min";
}

// ============================================================
// LIVE TIME FILTERING
// Match tasks by time-of-day only (ignore historical calendar date).
// A task matches when: taskStart <= selectedTime < taskEnd
// ============================================================

/*
  Structured start_time is a decimal hour (e.g. 13.5 = 1:30 PM).
  Convert to whole minutes since midnight.
*/
function timeToMinutes(startTime) {
  if (startTime === null || startTime === undefined || startTime === "") {
    return null;
  }

  const numeric = Number(startTime);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const minutes = Math.round(numeric * 60);
  if (minutes < 0 || minutes > 24 * 60) {
    return null;
  }

  return minutes;
}

/*
  duration is minutes (Structured field as already normalized).
  Returns true when selectedMinutes falls inside [start, end).
*/
function taskMatchesTime(task, selectedMinutes) {
  if (!task) {
    return false;
  }

  const startMinutes = timeToMinutes(task.startTime);
  const durationMinutes = Number(task.duration);

  if (startMinutes === null) {
    return false;
  }

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return false;
  }

  if (!Number.isFinite(selectedMinutes)) {
    return false;
  }

  const endMinutes = startMinutes + durationMinutes;
  return startMinutes <= selectedMinutes && selectedMinutes < endMinutes;
}

function hasUsableScheduleTime(task) {
  if (!task) {
    return false;
  }

  const startMinutes = timeToMinutes(task.startTime);
  const durationMinutes = Number(task.duration);
  return (
    startMinutes !== null &&
    Number.isFinite(durationMinutes) &&
    durationMinutes > 0
  );
}

// Format minutes-since-midnight as 12-hour clock text (e.g. "1:20 PM").
function formatMinutesAsClock(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) {
    return "";
  }

  let minutes = Math.floor(totalMinutes) % (24 * 60);
  if (minutes < 0) {
    minutes += 24 * 60;
  }

  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  let hour12 = hour24 % 12;
  if (hour12 === 0) {
    hour12 = 12;
  }

  const minuteText = minute < 10 ? "0" + minute : String(minute);
  return hour12 + ":" + minuteText + " " + period;
}

function getBrowserTimeMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function snapMinutesToSliderStep(minutes, step) {
  const safeStep = step > 0 ? step : 10;
  const snapped = Math.round(minutes / safeStep) * safeStep;
  if (snapped < 0) {
    return 0;
  }
  if (snapped > 1439) {
    // Keep within slider max; 1430 is last step-10 value under 1439.
    return Math.floor(1439 / safeStep) * safeStep;
  }
  return snapped;
}

function updateCurrentTimeDisplay(selectedMinutes) {
  if (!currentTimeEl) {
    return;
  }
  currentTimeEl.textContent = formatMinutesAsClock(selectedMinutes);
}

/*
  Illustrator encodes facial shading as opacity on each slot <g>
  via .cls-* rules (opacity-only — fills live on circle/icon children).

  Capture once, then remove those cls-* classes from the slot group so
  time-filter opacity can be applied via style.opacity. Transitions are
  disabled until after the first filter apply (see time-filter-ready).
*/
function captureOriginalPortraitOpacities(slots) {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot) {
      continue;
    }

    // Skip if already captured — never overwrite on later filter passes.
    if (slot.dataset.originalOpacity !== undefined) {
      continue;
    }

    // Prevent CSS transitions from locking opacity while we strip classes.
    slot.style.transition = "none";
    if (slot.getAnimations) {
      const animations = slot.getAnimations();
      for (let a = 0; a < animations.length; a++) {
        animations[a].cancel();
      }
    }

    const computed = parseFloat(window.getComputedStyle(slot).opacity);
    const originalOpacity = Number.isFinite(computed) ? computed : 1;

    slot.dataset.originalOpacity = String(originalOpacity);
    slot.originalOpacity = originalOpacity;

    // Drop Illustrator opacity classes from the slot <g> only.
    const rawClass = slot.getAttribute("class") || "";
    const keptClasses = rawClass
      .split(/\s+/)
      .filter(function (name) {
        return name && !/^cls-\d+$/.test(name);
      });
    slot.setAttribute("class", keptClasses.join(" "));

    // Restore baseline shading until the live time filter runs.
    slot.style.opacity = String(originalOpacity);
  }

  // Flush pending style so later filter writes are not mid-transition.
  if (slots.length > 0) {
    void window.getComputedStyle(slots[0]).opacity;
  }
}

function getOriginalSlotOpacity(slot) {
  if (!slot) {
    return 1;
  }

  if (typeof slot.originalOpacity === "number") {
    return slot.originalOpacity;
  }

  const fromDataset = parseFloat(slot.dataset.originalOpacity);
  if (Number.isFinite(fromDataset)) {
    return fromDataset;
  }

  return 1;
}

function setPortraitSlotTimeFilterState(slot, isActive) {
  if (!slot) {
    return;
  }

  const originalOpacity = getOriginalSlotOpacity(slot);
  const opacity = isActive
    ? Math.max(originalOpacity, ACTIVE_MIN_OPACITY)
    : originalOpacity * INACTIVE_MULTIPLIER;

  // Parent-group opacity dims the whole node (circle + icon) together.
  slot.style.opacity = String(opacity);

  if (isActive) {
    slot.classList.add("is-time-active");
    slot.classList.remove("is-time-inactive");
  } else {
    slot.classList.add("is-time-inactive");
    slot.classList.remove("is-time-active");
  }
}

function setRecurringNodeTimeFilterState(node, isActive) {
  if (!node) {
    return;
  }

  const opacity = isActive ? 1 : INACTIVE_RECURRING_OPACITY;
  node.style.opacity = String(opacity);

  if (isActive) {
    node.classList.add("is-time-active");
    node.classList.remove("is-time-inactive");
  } else {
    node.classList.add("is-time-inactive");
    node.classList.remove("is-time-active");
  }
}

function enableTimeFilterTransitions() {
  if (!portraitContainer) {
    return;
  }

  // Clear any init-time transition:none so CSS transitions can run.
  for (let i = 0; i < portraitSlots.length; i++) {
    portraitSlots[i].style.transition = "";
  }
  for (let j = 0; j < recurringBackgroundNodes.length; j++) {
    recurringBackgroundNodes[j].style.transition = "";
  }

  portraitContainer.classList.add("time-filter-ready");
}

/*
  Apply live time filter to both layers.
  Portrait inactive = originalOpacity * INACTIVE_MULTIPLIER (keeps face).
  Portrait active = max(originalOpacity, ACTIVE_MIN_OPACITY).
  Yellow inactive = INACTIVE_RECURRING_OPACITY; active = 1.
  Never uses display:none.
*/
function applyTimeFilter() {
  return applyLiveTimeFilter(selectedTimeMinutes);
}

function applyLiveTimeFilter(selectedMinutes) {
  let activePortraitTasks = 0;
  let activePlanningReset = 0;

  for (let i = 0; i < portraitSlots.length; i++) {
    const slot = portraitSlots[i];
    const record = slot.assignedTask;

    // Untreated sample placeholders (should be none after visual remap).
    if (
      isSamplePlaceholderTask(slot.sourceTask) &&
      !slot.visualRecord &&
      isSamplePlaceholderTask(record)
    ) {
      setSamplePlaceholderVisualState(slot);
      continue;
    }

    const matches = taskMatchesTime(record, selectedMinutes);
    setPortraitSlotTimeFilterState(slot, matches);
    if (matches) {
      if (record && record.sourceType === "recurring-scheduled-instance") {
        activePlanningReset += 1;
      } else {
        activePortraitTasks += 1;
      }
    }
  }

  for (let j = 0; j < recurringBackgroundNodes.length; j++) {
    const node = recurringBackgroundNodes[j];
    const record = node.assignedTask;
    const matches = taskMatchesTime(record, selectedMinutes);
    setRecurringNodeTimeFilterState(node, matches);
    if (matches) {
      activePlanningReset += 1;
    }
  }

  return {
    selectedTime: formatMinutesAsClock(selectedMinutes),
    activePortraitTasks: activePortraitTasks,
    activePlanningReset: activePlanningReset,
    totalActive: activePortraitTasks + activePlanningReset,
  };
}

/*
  SETTINGS mode category filters.
  Active categories restore ORIGINAL Illustrator opacity (not forced to 1).
  Filtered categories use originalOpacity * INACTIVE_MULTIPLIER.
  Locked categories (personal, planningReset) always stay active.
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

  if (isSamplePlaceholderTask(record) || record.dataKind === "samplePlaceholder") {
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

// Year from the visual/display record's scheduled day (never placeholder source date).
function getRecordYear(record) {
  if (!record || record.day === null || record.day === undefined || record.day === "") {
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
    // Undated tasks only appear when ALL years are selected.
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
  const clamped = Math.max(0, Math.min(YEAR_TIMELINE_OPTIONS.length - 1, index));
  return YEAR_TIMELINE_OPTIONS[clamped];
}

function setSamplePlaceholderVisualState(slot) {
  if (!slot) {
    return;
  }

  // Keep original Illustrator opacity; never emphasize as active data.
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
  // Settings ON = exact original portrait opacity (not boosted live-active).
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

    // Untreated sample placeholders only (post-remap these should not exist).
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

  // Background Planning/Reset: year filter applies; category stays protected/always allowed.
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

/*
  Central visualization update — mode buttons and time controls call this.
  Does not touch the camera.
*/
function updateVisualization() {
  if (interactionMode === "live") {
    return applyTimeFilter();
  }

  if (interactionMode === "settings") {
    const counts = applySettingsFilters();
    logYearFilterDebug(counts);
    return counts;
  }

  return null;
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

/*
  Clear selection when the selected node becomes filtered (LIVE or SETTINGS).
*/
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

  // DEVELOPMENT ONLY — REMOVE BEFORE FINAL
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

  // Camera is intentionally untouched — zoom/pan stay where the visitor left them.
  const counts = updateVisualization();
  if (interactionMode === "live" && opts.log !== false) {
    logTimeFilterDebug(counts);
  }
  syncSelectionWithVisualization();
  return counts;
}

function updateFollowCurrentTimeUI() {
  // DEVELOPMENT ONLY — REMOVE BEFORE FINAL
  if (!devUseCurrentTimeButton) {
    return;
  }
  devUseCurrentTimeButton.setAttribute(
    "aria-pressed",
    followCurrentTime ? "true" : "false",
  );
}

/*
  Tick the live clock. When followCurrentTime is on (LIVE mode),
  refresh the time filter as browser minutes change — never resets camera.
*/
function tickCurrentTimeFollow() {
  const browserMinutes = getBrowserTimeMinutes();

  // CURRENT TIME label always tracks the browser clock.
  updateCurrentTimeDisplay(browserMinutes);

  if (interactionMode !== "live") {
    return;
  }

  // LIVE + manual TEST TIME — leave selectedTimeMinutes / filter alone.
  if (!followCurrentTime) {
    return;
  }

  if (browserMinutes === selectedTimeMinutes) {
    return;
  }

  // New minute: update filter data only (no zoom/pan/reset).
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
    modeSettingsButton.setAttribute(
      "aria-pressed",
      isLive ? "false" : "true",
    );
  }

  // DEVELOPMENT ONLY — REMOVE BEFORE FINAL
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

  // Returning to LIVE while following the clock: sync to now without resetting camera.
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
      // Should be 0 after visual remap — keep for safety.
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
  console.log("Portrait tasks without usable start + duration:", portraitMissing);
  console.log(
    "Planning and Reset nodes with usable start + duration:",
    yellowUsable + " / " + yellowNodes.length,
  );
  console.log(
    "Planning and Reset nodes without usable time:",
    yellowMissing,
  );
  console.log(
    "Structured time format: start_time = decimal hour, duration = minutes",
  );
}

/*
  DEVELOPMENT ONLY — REMOVE BEFORE FINAL
  Temporary slider + USE CURRENT TIME for testing live time filtering.
*/
function initializeDevTimeControls() {
  if (!devTimeControls) {
    return;
  }

  isolateUiFromCamera(devTimeControls);

  if (devTimeSlider) {
    devTimeSlider.addEventListener("input", function () {
      // Manual testing pauses live clock follow until USE CURRENT TIME.
      followCurrentTime = false;
      updateFollowCurrentTimeUI();
      const minutes = Number(devTimeSlider.value);
      // Do not re-snap / overwrite while dragging — use slider value directly.
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

function showTaskPanel(task) {
  if (!taskPanel || !task) {
    return;
  }

  taskTitleEl.textContent = task.title || "";
  taskDateEl.textContent = task.day || "";
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
  const bbox = slot.getBBox();
  const centerX = bbox.x + bbox.width / 2;
  const centerY = bbox.y + bbox.height / 2;
  const base = Math.max(bbox.width, bbox.height, 1);
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
  selectedSlot = slot;
  selectedTask = task;

  const focus = buildTaskFocusViewBox(slot);
  selectedFocusWidth = focus.width;

  // Animate from wherever the user currently is — never via the full portrait.
  animateToViewBox(focus, { revealTaskPanel: true });
  updateZoomChrome();
}

function resetView() {
  clearSelectedTask();
  animateToViewBox(copyViewBox(originalViewBox));
}

// Click uses the task stored on the slot during assignment.
function addSlotInteraction(slots) {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];

    if (!slot.classList.contains("task-slot")) {
      continue;
    }

    slot.addEventListener("click", function (event) {
      // Drag-to-pan on a circle should not also select that task.
      if (panMoved) {
        panMoved = false;
        return;
      }

      const task = slot.assignedTask;

      if (!task) {
        console.warn("Clicked slot has no assigned task:", slot.id);
        return;
      }

      // Untreated sample/template records are portrait geometry only.
      // After visual remap, assignedTask is a Planning/Reset instance (clickable).
      if (
        (isSamplePlaceholderTask(task) && !slot.visualRecord) ||
        slot.classList.contains("is-sample-placeholder")
      ) {
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

    // --- Existing portrait pipeline (tasks[] only) — unchanged assignment ---
    normalTasks = normalizeTasks(rawData);
    normalizedTasks = normalTasks;
    portraitSlots = getPortraitSlots(svgElement);

    // --- Recurring occurrence audit + separate normalization (no slot merge) ---
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

    // allDataPoints is NOT created / assigned while count exceeds slot capacity.
    // Portrait continues to use normalTasks only.

    const symbolStats = analyzeSymbols(normalizedTasks);
    const colorCounts = analyzeColors(normalizedTasks);
    const missingIcons = getMissingIconSymbols(symbolStats.uniqueSymbols);
    const iconAuditRows = buildIconAudit(normalizedTasks);
    const iconAudit = printIconAudit(iconAuditRows);
    const iconUsage = countIconUsage(normalizedTasks);

    const assignment = assignTasksToSlots(portraitSlots, normalizedTasks);

    applyTaskVisuals(portraitSlots);
    addSlotInteraction(portraitSlots);

    // Build all 17 scheduled Planning/Reset instances, then split:
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

    // Capture Illustrator slot opacities BEFORE any time filter runs.
    captureOriginalPortraitOpacities(portraitSlots);

    // Mode switch + category controls + live time filter
    initializeModeSwitch();
    initializeCategoryControls();
    initializeYearControls();
    initializeDevTimeControls();
    auditScheduleTimeCoverage(portraitSlots, recurringBackgroundNodes);
    auditSamplePlaceholderRecords(portraitSlots);
    auditCategoryClassification(portraitSlots, recurringBackgroundNodes);
    auditYearCoverage(portraitSlots);
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
