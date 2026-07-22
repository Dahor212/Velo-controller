// =========================================================
// VELO CONTROLLER - external mobile controller for a cycling
// game running in Unreal Engine.
//
// This file only handles the UI logic and prepares a single
// entry point (sendGameCommand) for wiring up a real transport
// (WebSocket or HTTP) later on. No network connection is made
// yet - CONFIG.transport stays "mock" until that is ready.
// =========================================================

// ---------------------------------------------------------
// Transport configuration (placeholder for future WebSocket/HTTP link)
// ---------------------------------------------------------
const CONFIG = {
  transport: "mock", // "mock" | "websocket" | "http"
  websocketUrl: "ws://192.168.1.100:8080",
  httpUrl: "http://192.168.1.100:8080",
};

// ---------------------------------------------------------
// Central command dispatcher.
// Every control in the UI funnels through this function, so
// swapping "mock" for a real WebSocket/HTTP transport later
// only requires changes here.
// ---------------------------------------------------------
function sendGameCommand(command, payload = {}) {
  console.log("Game command:", command, payload);

  if (CONFIG.transport === "websocket") {
    // Future: reuse a persistent WebSocket connection and send JSON.
    // socket.send(JSON.stringify({ command, ...payload }));
  } else if (CONFIG.transport === "http") {
    // Future: POST the command to the Unreal Engine HTTP endpoint.
    // fetch(CONFIG.httpUrl, {
    //   method: "POST",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify({ command, ...payload }),
    // });
  }
  // "mock" transport: console.log above is enough for now.
}

// ---------------------------------------------------------
// DOM references
// ---------------------------------------------------------
const cameraLabelEl = document.getElementById("camera-label");
const commandLabelEl = document.getElementById("command-label");
const connectionDotEl = document.getElementById("connection-dot");
const connectionTextEl = document.getElementById("connection-text");

const cameraButtons = Array.from(document.querySelectorAll(".cam-btn"));

// Human-readable labels for the top bar, keyed by data-camera value.
const CAMERA_LABELS = {
  rear: "Rear",
  front: "Front",
  left: "Left",
  right: "Right",
  top: "Top",
};

// ---------------------------------------------------------
// Connection status helper (offline / connecting / online).
// Not driven by anything yet - exposed for the future real
// transport to call, e.g. setConnectionStatus("online").
// ---------------------------------------------------------
function setConnectionStatus(status) {
  connectionDotEl.classList.remove("offline", "connecting", "online");
  connectionDotEl.classList.add(status);
  connectionTextEl.textContent = status.toUpperCase();
}

// ---------------------------------------------------------
// Camera selection: updates active button, top bar label,
// bottom command label, then sends the command.
// ---------------------------------------------------------
function selectCamera(button) {
  cameraButtons.forEach((btn) => btn.classList.remove("active"));
  button.classList.add("active");

  const camera = button.dataset.camera;
  cameraLabelEl.textContent = CAMERA_LABELS[camera] || camera;
}

// ---------------------------------------------------------
// Generic single-press handling.
//
// Mobile Safari can fire both touch and mouse/click events for
// the same physical press, which would trigger sendGameCommand
// twice. To guarantee "exactly once per press", we handle the
// action on pointerdown and then ignore every other event type
// until the next pointerdown.
// ---------------------------------------------------------
const supportsPointerEvents = typeof window.PointerEvent === "function";

function bindButton(button) {
  const activate = () => {
    button.classList.add("pressed");

    const command = button.dataset.command;

    if (button.classList.contains("cam-btn")) {
      selectCamera(button);
    }

    if (command) {
      commandLabelEl.textContent = command;
      sendGameCommand(command);
    }
  };

  const release = () => {
    button.classList.remove("pressed");
  };

  if (supportsPointerEvents) {
    // iOS Safari (and every modern browser) fires pointerdown once per
    // press. Using it exclusively - and skipping "click" entirely -
    // avoids the touch+click double-fire that a mixed listener setup
    // would otherwise trigger.
    button.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      activate();
    });
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);
  } else {
    // Fallback for the rare environment without PointerEvent support.
    button.addEventListener("click", (e) => {
      e.preventDefault();
      activate();
    });
  }

  // Block the native context menu / callout on long-press.
  button.addEventListener("contextmenu", (e) => e.preventDefault());
}

document.querySelectorAll(".btn").forEach(bindButton);

// ---------------------------------------------------------
// Extra page-wide safety nets against scrolling/zooming gestures.
// ---------------------------------------------------------
document.addEventListener("contextmenu", (e) => e.preventDefault());

document.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
  },
  { passive: false }
);

// Prevent double-tap-to-zoom.
let lastTouchEnd = 0;
document.addEventListener(
  "touchend",
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 350) {
      e.preventDefault();
    }
    lastTouchEnd = now;
  },
  { passive: false }
);

// ---------------------------------------------------------
// Initial state
// ---------------------------------------------------------
setConnectionStatus("offline");
