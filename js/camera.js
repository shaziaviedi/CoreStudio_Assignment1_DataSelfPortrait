// camera — viewBox zoom, pan + animation

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
