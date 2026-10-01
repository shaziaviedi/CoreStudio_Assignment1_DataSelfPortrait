// portrait slots, task assignment, colors + icons

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
