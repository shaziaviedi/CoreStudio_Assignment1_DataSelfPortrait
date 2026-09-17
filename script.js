const portraitContainer = document.getElementById("portrait-container");
const consoleOutput = document.getElementById("console-output");
let normalizedTasks = [];
let portraitSlots = [];

function writeToConsole(message) {
  if (!consoleOutput) {
    return;
  }

  consoleOutput.textContent = message;
}

// loading SVG
async function loadPortraitSvg() {
  const response = await fetch("assets/portrait.svg");

  if (!response.ok) {
    throw new Error("Could not load portrait.svg (status " + response.status + ")");
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
    throw new Error("Could not load structured-data.json (status " + response.status + ")");
  }

  return response.json();
}

// normalizing tasks
function normalizeTask(task) {
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
    subtasks: task.subtasks
  };
}

function normalizeTasks(rawData) {
  const rawTasks = rawData.tasks;
  const result = [];

  for (let i = 0; i < rawTasks.length; i++) {
    result.push(normalizeTask(rawTasks[i]));
  }

  return result;
}

// find slot-* groups, sort by number
function getPortraitSlots(svgElement) {
  const slotNodeList = svgElement.querySelectorAll('[id^="slot-"]');
  const slots = Array.from(slotNodeList);

  slots.sort(function (a, b) {
    const numA = parseInt(a.id.replace("slot-", ""), 10);
    const numB = parseInt(b.id.replace("slot-", ""), 10);
    return numA - numB;
  });

  return slots;
}

// assigning tasks
function assignTasksToSlots(slots, tasks) {
  const assignCount = Math.min(slots.length, tasks.length);

  for (let i = 0; i < assignCount; i++) {
    const slot = slots[i];
    const task = tasks[i];

    slot.classList.add("task-slot");
    slot.setAttribute("data-task-index", i);

    if (task.id) {
      slot.setAttribute("data-task-id", task.id);
    }
  }

  return assignCount;
}

// adding interaction
function addSlotInteraction(slots) {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];

    // skip unassigned slots
    if (!slot.classList.contains("task-slot")) {
      continue;
    }

    slot.addEventListener("click", function () {
      const taskIndex = parseInt(slot.getAttribute("data-task-index"), 10);
      const task = normalizedTasks[taskIndex];

      console.log(task);
      console.log("Selected task: " + task.title);

      writeToConsole(
        "Selected task: " + task.title + "\n\n" + JSON.stringify(task, null, 2)
      );
    });
  }
}

async function init() {
  try {
    // wait for SVG + JSON together
    const results = await Promise.all([
      loadPortraitSvg(),
      loadStructuredData()
    ]);

    const svgElement = results[0];
    const rawData = results[1];

    normalizedTasks = normalizeTasks(rawData);
    portraitSlots = getPortraitSlots(svgElement);

    const assignedCount = assignTasksToSlots(portraitSlots, normalizedTasks);
    addSlotInteraction(portraitSlots);

    console.log("Portrait slots: " + portraitSlots.length);
    console.log("Normalized tasks: " + normalizedTasks.length);
    console.log("Tasks assigned: " + assignedCount);
  } catch (error) {
    console.error("Error during init:", error);
  }
}

init();
