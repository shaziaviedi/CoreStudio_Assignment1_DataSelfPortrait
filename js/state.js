// shared DOM refs, app state + tuning constants

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
