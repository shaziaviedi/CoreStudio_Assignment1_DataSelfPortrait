// planning / reset yellow nodes + calendar date helpers

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
