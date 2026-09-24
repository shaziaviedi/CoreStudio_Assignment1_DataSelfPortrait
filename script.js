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

// development only — remove before final
const devTimeControls = document.getElementById("dev-time-controls");
const devTimeSlider = document.getElementById("dev-time-slider");
const devTimeReadout = document.getElementById("dev-time-readout");
const devUseCurrentTimeButton = document.getElementById("dev-use-current-time");

let normalizedTasks = [];
let portraitSlots = [];

// application interaction mode: "live" | "settings"
let interactionMode = "live";

// live time filter: minutes since midnight (0–1439). date is ignored.
// remembered across mode switches — do not reset when leaving LIVE.
let selectedTimeMinutes = 0;

// when true, visualization tracks the browser clock continuously.
// moving the TEST TIME slider turns this off until USE CURRENT TIME is clicked.
let followCurrentTime = true;
let currentTimeClockId = null;

// time-filter opacity (tune here)
// portrait slots keep Illustrator shading via originalOpacity * multiplier.
const INACTIVE_MULTIPLIER = 0.35;
const ACTIVE_MIN_OPACITY = 0.9;
// yellow planning/reset nodes are not part of the Illustrator portrait.
const INACTIVE_RECURRING_OPACITY = 0.12;

// camera / zoom state (SVG viewBox is the camera)

// two ways the camera moves (intentionally different):
// 1. manual (wheel / trackpad / drag) → update `camera` immediately and stay there.
// 2. programmatic (click-to-task / reset / escape) → ease toward a destination.

// mixing those caused bounce-back: wheel started a short animation whose
// unfinished target fought the next input. manual moves must never animate.
const MIN_ZOOM = 1;
const MAX_ZOOM = 20;
const WHEEL_ZOOM_SENSITIVITY = 0.0035; // stronger = fewer scrolls to reach icons
const CAMERA_ANIM_MS = 520; // only for click-to-task / reset
const TASK_VIEW_PADDING = 5.5;
const TASK_PANEL_REVEAL_DISTANCE = 2.5;
const PAN_EDGE_SLACK = 0.55; // allow exploring portrait edges when zoomed in
const DRAG_THRESHOLD_PX = 4;

// match the earlier CSS framing: height 135vh + translate(-10vh, 2vh)
const START_DISPLAY_SCALE = 1.35;
const START_NUDGE_X_VH = -0.1;
const START_NUDGE_Y_VH = 0.02;

let portraitSvg = null;

// full artwork bounds (1080×1920). used so zoom/pan can reach hair/edges.
let contentBounds = null;

// immutable starting camera framing (zoom = 1 / RESET VIEW).
// this is the old on-load composition — not a padded full-art fit.
let originalViewBox = null;

// one authoritative live camera. manual zoom/pan write here directly.
let camera = null;

// animation bookkeeping — only used by animateToViewBox (task / reset).
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

// pan state
let isPanning = false;
let panPointerId = null;
let panStartClientX = 0;
let panStartClientY = 0;
let panOrigin = null;
let panScaleX = 1;
let panScaleY = 1;
let panMoved = false;
// after a real pan, the browser still fires click — swallow that one only.
let suppressNextTaskClick = false;

// central Structured color → display color.
// shades live in style.css as --task-* variables so you can tweak them in one place.
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
// recurring routine data lives on a separate SVG background layer.

// category access model — single source for labels, colors, and locks.
// inspection is always allowed; manipulable:false = cannot toggle visibility.
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

// explicit Structured sample/template task ids (buy groceries, prepare food, eat lunch).
// these stay assigned to SVG slots as portrait structure, not personal data.
const SAMPLE_PLACEHOLDER_TASK_IDS = {
  "23E3EDDF-10A3-4B87-B466-7678900ED17D": true, // buy groceries
  "CC10963A-6C76-45E6-A9B8-F09A619B70F4": true, // prepare food
  "51AE6140-178C-448A-ABB4-85A54C548015": true, // eat lunch
};

function isSamplePlaceholderTaskId(taskId) {
  return Boolean(taskId && SAMPLE_PLACEHOLDER_TASK_IDS[taskId]);
}

function isSamplePlaceholderTask(task) {
  return Boolean(task && isSamplePlaceholderTaskId(task.id));
}

// only manipulable categories have toggleable visibility state.
// personal + planningReset are intentionally absent (always visible).
// year: "all" | 2023 | 2024 | 2025 | 2026
const settingsState = {
  categories: {
    workSchool: true,
    events: true,
  },
  year: "all",
};

// discrete year timeline positions (slider index → year value).
const YEAR_TIMELINE_OPTIONS = ["all", 2023, 2024, 2025, 2026];

// categories included in step 5 active-data measurement (not samplePlaceholder / unknown).
const ACTIVE_DATA_CATEGORY_IDS = [
  "workSchool",
  "events",
  "personal",
  "planningReset",
];

// latest calculateActiveDataState() result (measurement only — no emotion).
let lastActiveDataState = null;

// step 6 — latest expressive state (visual tendencies only; no geometry yet).
let lastExpressiveState = null;

// cached live density min/max from 10-minute day sampling (data-only).
let liveDensityRange = null;

// step 7b/8 — portrait deformation (immutable homes + Illustrator field × tiredness).
let portraitDeformBounds = null;
let deformationEnabled = true;
let deformationDevMultiplier = 1;
let deformAnimRafId = null;
let deformAnimStart = null;
let lastEffectiveStrength = 0;
let lastWorkExpression = 0; // alias of lastDeformationAmount (compat)
let lastDeformationAmount = 0;
let lastTirednessState = null;
let lastSettingsManipulationAmount = 0;
let lastMaxAppliedDisplacement = 0;
let showIllustratorVectors = false;
let liveTirednessEnergyDistribution = null;

/*
  step 7b/8 deformation field store.
  work: Illustrator late-night / tiredness residual field (authoritative).
  social / personal: reserved placeholders — unused by step 8 amplitude.
*/
const deformationFields = {
  work: null,
  social: null,
  personal: null,
};

const DEFORM_ANIM_MS = 550;

// step 7b — Illustrator-derived field (geometry only; amplitude is step 8).
const ILLUSTRATOR_PROTOTYPE_URL = "assets/portrait-deformation.svg";
const ILLUSTRATOR_WORK_SCALE = 1.0;
const ILLUSTRATOR_DEADZONE_PRODUCTION = 1.75;
const PROVISIONAL_FIELD_FRACTION = 0.025; // unused by step 8 amplitude; kept for home cache

// step 8 — energy-weighted tiredness → deformation amount.
const WORK_ENERGY_WEIGHT = 1.0;
const EVENTS_ENERGY_WEIGHT = 0.5;
const TIREDNESS_CURVE_EXPONENT = 0.75;
// set from historical live p95 after computeLiveTirednessEnergyDistribution().
let TIREDNESS_REFERENCE_ENERGY = 1;

// development only — remove before final
const devDeformToggle = document.getElementById("dev-deform-toggle");

const yearSlider = document.getElementById("year-slider");
const yearReadout = document.getElementById("year-readout");

const LIVE_DENSITY_SAMPLE_STEP_MINUTES = 10;

const EXPRESSIVE_CATEGORY_LABELS = {
  workSchool: "Work / School",
  events: "Events / Schedule",
  personal: "Personal",
  planningReset: "Planning / Reset",
  none: "None",
};

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

// layer 1 — planning and reset yellow nodes (beside the portrait)
// scheduled instances from the recurring definition. placed next
// to existing portrait circles without overlapping them.
// portrait slots stay at 2383.

const SVG_NS = "http://www.w3.org/2000/svg";
const PLANNING_RESET_RECURRING_ID = "A87921ED-54D5-4C21-B040-C51306109CD8";

// portrait task circles use r ≈ 7.82 — keep yellow nodes in the same family.
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

// safe calendar-date helpers (no timezone shift from Date.parse)

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
  // 0 = sunday … 6 = saturday in UTC calendar space
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
  generate every scheduled calendar date implied by the recurring definition,
  from start_day through min(today, end_day). never invent past the current date.
  respect weekday flags + interval weeks (interval 1 = every matching week).
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

  // if no weekday flags are set, fall back to nothing rather than inventing days.
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

    // weeks since start_day (floor), then keep every intervalWeeks-th week.
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

// build scheduled instances for planning and reset, joining real occurrences.
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
      // completion only when a real occurrence record exists for this date.
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

  // draw after portrait slots so yellow nodes sit visibly beside circles.
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

  // prefer silhouette-edge hosts — more open directions for neighbors.
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
  place each yellow node beside an existing portrait circle.
  prefer edge hosts and outward angles so nodes nest next to the
  silhouette without overlapping assigned tasks or each other.
*/
function positionAdjacentToPortrait(instance, layout, placedYellow) {
  const seed =
    String(instance.recurringId || "") + "|" + String(instance.day || "");
  const hash = hashSeed(seed);
  const hosts = layout.edgeHosts.length ? layout.edgeHosts : layout.obstacles;
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
      // step 0 ≈ outward from silhouette; remaining steps ring the host.
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

      if (isClearOfObstacles(candidate, layout.obstacles, placedYellow, gap)) {
        return { x: candidate.cx, y: candidate.cy };
      }
    }

    // slightly farther ring if the tight neighbor ring is packed.
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
      if (isClearOfObstacles(candidate, layout.obstacles, placedYellow, gap)) {
        return { x: candidate.cx, y: candidate.cy };
      }
    }
  }

  // last resort: push outward from centroid without host attachment.
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
      if (shouldIgnoreTaskClickAfterPan()) {
        return;
      }

      if (node.classList.contains("is-time-inactive")) {
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
      // inspection allowed; category manipulation remains locked later.
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

// find only real slot groups (slot-1, slot-001, …), not slot-001-background / slot-001-icon.
// sort numerically: slot-1, slot-2, slot-10 (not alphabetical).
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

// assign exactly one normalized task to every portrait slot (1:1 by sorted index).
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

    // raw source assignment (never reordered / deleted).
    slot.sourceTask = task;
    // visual assignment — may later point at a planning/reset instance.
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

// collect unique Structured symbols (exact values from JSON).
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

// collect unique Structured color values + counts.
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

// map a Structured color string to a display hex.
function getTaskDisplayColor(structuredColor) {
  const key =
    structuredColor === null || structuredColor === undefined
      ? ""
      : String(structuredColor);

  if (Object.prototype.hasOwnProperty.call(structuredColorMap, key)) {
    return structuredColorMap[key];
  }

  // unknown Structured color value — keep a visible neutral rather than inventing a category.
  return structuredColorMap[""];
}

// true only when structuredIconMap has real artwork for this exact symbol.
function hasIconArtwork(symbol) {
  return Boolean(symbol && structuredIconMap[symbol]);
}

// which Structured symbols still need custom artwork?
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

// build a frequency + example-title audit for every unique Structured symbol.
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

  // most-used symbol first
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

// print full audit + missing-only audit + top 20 missing priorities.
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

// count how many tasks show real artwork vs development fallback.
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

// get the circle / background shape inside a slot (preserve cx, cy, r).
function getSlotBackground(slot) {
  const byId = slot.querySelector('[id$="-background"]');
  if (byId) {
    return byId;
  }
  return slot.querySelector("circle");
}

// get the icon group inside a slot.
function getSlotIconGroup(slot) {
  const byId = slot.querySelector('[id$="-icon"]');
  if (byId) {
    return byId;
  }
  return null;
}

// update circle fill + icon for one slot from a display record.
function applyRecordVisualsToSlot(slot, record) {
  if (!slot || !record) {
    return;
  }

  const background = getSlotBackground(slot);
  const iconGroup = getSlotIconGroup(slot);

  if (background) {
    const fillColor = getTaskDisplayColor(record.color);
    // inline style beats the Illustrator class fills inside the SVG <style> block.
    background.style.fill = fillColor;
  }

  if (iconGroup && background) {
    const cx = parseFloat(background.getAttribute("cx"));
    const cy = parseFloat(background.getAttribute("cy"));

    // exact Structured match only — never infer from task.title
    const symbol = record.symbol;
    const hasArtwork = hasIconArtwork(symbol);
    const artwork = hasArtwork
      ? structuredIconMap[symbol]
      : hasIconArtwork("calendar") &&
          record.sourceType === "recurring-scheduled-instance"
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

// update circle fill + icon for every assigned slot from its visual record.
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
  visual assignment layer:
  move the first 3 chronological planning/reset instances into the
  verified samplePlaceholder SVG slots. geometry / opacity stay put.
  those 3 must not also render in the background layer.
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

    // yellow + calendar; original slot opacity is preserved separately.
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
  console.log(
    "Total Planning/Reset instances represented:",
    totalPlanningReset,
  );
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

// camera — full-screen SVG viewBox navigation

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

// zoom is derived from camera size — never stored separately.
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
  soft clamp:
  - zoom limits are relative to originalViewBox (on-load framing).
  - at zoom 1, snaps exactly to originalViewBox.
  - pan uses full contentBounds + slack so zoomed-in views can reach hair/edges
  without being trapped in the starting crop.
  - never snaps back on pointerup / wheel-end.
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

  // pan against the full artwork so zoomed-in navigation can reach every edge.
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

// browser client (screen) → SVG user units via the live screen CTM.
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
  pointer-centered zoom (manual, immediate):

  1. read the SVG point under the cursor.
  2. remember its fractional position inside the current camera (rx, ry).
  3. scale camera width/height by 1/zoomFactor.
  4. reposition x/y so that same SVG point stays at (rx, ry).

  then stop. no animation. no return to originalViewBox.
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

  // user input always cancels any click-to-task / reset animation.
  cancelCameraAnimation();

  // deltaY < 0 (scroll up / pinch inward) → zoomFactor > 1 → zoom in
  // deltaY > 0 (scroll down) → zoomFactor < 1 → zoom out
  const zoomFactor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
  zoomAtPoint(event.clientX, event.clientY, zoomFactor);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// stop any in-flight programmatic animation so manual input wins.
function cancelCameraAnimation() {
  if (cameraRafId !== null) {
    cancelAnimationFrame(cameraRafId);
    cameraRafId = null;
  }
  cameraAnimating = false;
  cameraAnimStart = null;
  cameraAnimFrom = null;
  cameraAnimTo = null;
  // keep pendingTaskPanelReveal only if a focus animation still owns it —
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
  programmatic camera moves only (click-to-task, RESET VIEW, escape).
  manual wheel/pan must never call this — that was the bounce-back bug.
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

  // full-screen SVG surface — the browser window is the camera viewport.
  // no smaller CSS frame, so zooming in never hits an artificial crop edge.
  portraitSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  portraitSvg.removeAttribute("width");
  portraitSvg.removeAttribute("height");

  contentBounds = parseViewBox(svgElement);

  // restore the previous on-load composition (CSS was height:135vh +
  // translate(-10vh, 2vh)) as the zoom-1 / RESET VIEW camera framing.
  const scale = START_DISPLAY_SCALE;
  const startW = contentBounds.width / scale;
  const startH = contentBounds.height / scale;
  const centerX = contentBounds.x + contentBounds.width / 2;
  const centerY = contentBounds.y + contentBounds.height / 2;
  // convert the old vh nudges into SVG units at that display scale.
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

  // single wheel listener on the container — never per-slot.
  portraitContainer.addEventListener("wheel", handleWheelZoom, {
    passive: false,
  });

  portraitContainer.addEventListener("pointerdown", handlePanPointerDown);
  portraitContainer.addEventListener("pointermove", handlePanPointerMove);
  portraitContainer.addEventListener("pointerup", handlePanPointerUp);
  portraitContainer.addEventListener("pointercancel", handlePanPointerUp);
  portraitContainer.addEventListener("lostpointercapture", handlePanPointerUp);

  // prevent browser image/SVG drag + accidental text selection while navigating.
  portraitContainer.addEventListener("dragstart", function (event) {
    event.preventDefault();
  });

  if (resetViewButton) {
    isolateUiFromCamera(resetViewButton);
    resetViewButton.addEventListener("click", function () {
      resetView();
    });
  }

  if (taskPanel) {
    isolateUiFromCamera(taskPanel);
  }

  const expressivePanel = document.getElementById("dev-expressive-panel");
  if (expressivePanel) {
    isolateUiFromCamera(expressivePanel);
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

  // pan can start anywhere — including on task circles.
  // do not capture the pointer yet: capturing on pointerdown prevents the
  // subsequent click from reaching task slots while zoomed (broken 2nd select).
  // capture begins only once movement passes drag_threshold_px.
  cancelCameraAnimation();

  isPanning = true;
  panMoved = false;
  panPointerId = event.pointerId;
  panStartClientX = event.clientX;
  panStartClientY = event.clientY;
  panOrigin = copyViewBox(camera);

  // freeze the screen→SVG scale at drag start (handles meet letterboxing).
  const ctm = portraitSvg.getScreenCTM();
  panScaleX = ctm && ctm.a ? ctm.a : 1;
  panScaleY = ctm && ctm.d ? ctm.d : 1;
}

function handlePanPointerMove(event) {
  if (!isPanning || event.pointerId !== panPointerId || !panOrigin) {
    return;
  }

  const dxScreen = event.clientX - panStartClientX;
  const dyScreen = event.clientY - panStartClientY;

  // ignore tiny movement so a click on a circle does not nudge the camera.
  if (!panMoved) {
    if (
      Math.abs(dxScreen) <= DRAG_THRESHOLD_PX &&
      Math.abs(dyScreen) <= DRAG_THRESHOLD_PX
    ) {
      return;
    }

    panMoved = true;
    portraitContainer.classList.add("is-panning");

    // capture only after a real drag so slot clicks still work while zoomed.
    if (portraitContainer.setPointerCapture) {
      portraitContainer.setPointerCapture(event.pointerId);
    }
  }

  const dxSvg = dxScreen / panScaleX;
  const dySvg = dyScreen / panScaleY;

  // drag right → content moves right → camera x decreases.
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

  // a completed drag also synthesizes a click — ignore that click on tasks.
  if (panMoved) {
    suppressNextTaskClick = true;
  }

  if (
    panPointerId !== null &&
    portraitContainer.releasePointerCapture &&
    typeof portraitContainer.hasPointerCapture === "function" &&
    portraitContainer.hasPointerCapture(panPointerId)
  ) {
    portraitContainer.releasePointerCapture(panPointerId);
  }

  // intentionally do nothing to the camera — it stays where the user left it.
  isPanning = false;
  panPointerId = null;
  panOrigin = null;
  panMoved = false;
  portraitContainer.classList.remove("is-panning");
}

function shouldIgnoreTaskClickAfterPan() {
  if (suppressNextTaskClick || panMoved) {
    suppressNextTaskClick = false;
    panMoved = false;
    return true;
  }
  return false;
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

/*
  visitor-facing scheduled date.
  undated/inbox records must not invent a calendar day.
*/
function formatTaskDate(day) {
  if (day === null || day === undefined || day === "") {
    return "No scheduled date";
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day).trim());
  if (!match) {
    return String(day);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const date = Number(match[3]);
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  if (
    !Number.isFinite(year) ||
    monthIndex < 0 ||
    monthIndex > 11 ||
    !Number.isFinite(date) ||
    date < 1 ||
    date > 31
  ) {
    return String(day);
  }

  return monthNames[monthIndex] + " " + date + ", " + year;
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

// live time filtering
// match tasks by time-of-day only (ignore historical calendar date).
// a task matches when: taskStart <= selectedTime < taskEnd

/*
  Structured start_time is a decimal hour (e.g. 13.5 = 1:30 PM).
  convert to whole minutes since midnight.
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
  returns true when selectedMinutes falls inside [start, end).
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

// format minutes-since-midnight as 12-hour clock text (e.g. "1:20 PM").
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
    // keep within slider max; 1430 is last step-10 value under 1439.
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
  via .cls-* rules (opacity-only — fills LIVE on circle/icon children).

  capture once, then remove those cls-* classes from the slot group so
  time-filter opacity can be applied via style.opacity. transitions are
  disabled until after the first filter apply (see time-filter-ready).
*/
function captureOriginalPortraitOpacities(slots) {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot) {
      continue;
    }

    // skip if already captured — never overwrite on later filter passes.
    if (slot.dataset.originalOpacity !== undefined) {
      continue;
    }

    // prevent CSS transitions from locking opacity while we strip classes.
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

    // drop Illustrator opacity classes from the slot <g> only.
    const rawClass = slot.getAttribute("class") || "";
    const keptClasses = rawClass.split(/\s+/).filter(function (name) {
      return name && !/^cls-\d+$/.test(name);
    });
    slot.setAttribute("class", keptClasses.join(" "));

    // restore baseline shading until the live time filter runs.
    slot.style.opacity = String(originalOpacity);
  }

  // flush pending style so later filter writes are not mid-transition.
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

  // parent-group opacity dims the whole node (circle + icon) together.
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

  // clear any init-time transition:none so CSS transitions can run.
  for (let i = 0; i < portraitSlots.length; i++) {
    portraitSlots[i].style.transition = "";
  }
  for (let j = 0; j < recurringBackgroundNodes.length; j++) {
    recurringBackgroundNodes[j].style.transition = "";
  }

  portraitContainer.classList.add("time-filter-ready");
}

/*
  apply live time filter to both layers.
  portrait inactive = originalOpacity * inactive_multiplier (keeps face).
  portrait active = max(originalOpacity, active_min_opacity).
  yellow inactive = inactive_recurring_opacity; active = 1.
  never uses display:none.
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

    // untreated sample placeholders (should be none after visual remap).
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
