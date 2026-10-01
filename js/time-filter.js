// date/time formatting + live time filtering

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
