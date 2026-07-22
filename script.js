// =========================================================
// VELO CONTROLLER - external mobile controller for a cycling
// game running in Unreal Engine.
//
// This version talks to a local Python HTTP server using plain
// fetch() calls (no WebSocket yet - see CONFIG below).
//
// IMPORTANT:
// For local testing with an HTTP Python server, serve this frontend
// from the same Python server or another local HTTP server.
// An HTTPS GitHub Pages frontend may be blocked from calling a local
// HTTP endpoint by the browser's mixed-content policy.
// =========================================================

// ---------------------------------------------------------
// Server configuration - the ONE place to change the server address.
// 192.168.1.100 is a placeholder and will later be replaced with the
// local IPv4 address of the computer running the Python server.
// ---------------------------------------------------------
const CONFIG = {
  serverUrl: "http://192.168.1.100:8080",
  healthEndpoint: "/health",
  commandEndpoint: "/command",
  requestTimeoutMs: 2500,
  healthCheckIntervalMs: 3000,
};

// ---------------------------------------------------------
// Rider selection is mocked locally until Unreal Engine reports the
// real selected rider back to the page. Set this to false once that
// server -> client sync exists; until then the label below just
// cycles through MOCK_RIDERS on the client, while the real command
// is still sent to the server on every press.
// ---------------------------------------------------------
const MOCK_RIDER_SELECTION = true;
const MOCK_RIDERS = ["PLAYER", "RIDER 01", "RIDER 02", "RIDER 03", "RIDER 04"];
let mockRiderIndex = 0;

// Human-readable labels for the top bar, keyed by command name.
const CAMERA_LABELS = {
  camera_rear: "REAR",
  camera_front: "FRONT",
  camera_left: "LEFT",
  camera_right: "RIGHT",
  camera_top: "TOP",
  camera_helicopter: "HELICOPTER",
};

// ---------------------------------------------------------
// DOM references
// ---------------------------------------------------------
const cameraLabelEl = document.getElementById("camera-label");
const commandLabelEl = document.getElementById("command-label");
const commandTimeEl = document.getElementById("command-time");
const commandCountEl = document.getElementById("command-count");
const connectionDotEl = document.getElementById("connection-dot");
const connectionTextEl = document.getElementById("connection-text");
const connectionValueEl = document.getElementById("connection-value");
const selectedRiderEl = document.getElementById("selected-rider");

const cameraButtons = Array.from(document.querySelectorAll(".cam-btn"));

let sentCommandCount = 0;

// ---------------------------------------------------------
// Connection state (offline / connecting / online).
// Updates the status dot, its text and the wrapping element's class -
// the existing status pill in the top bar, nothing new added to the page.
// ---------------------------------------------------------
function setConnectionState(state) {
  connectionDotEl.classList.remove("offline", "connecting", "online");
  connectionDotEl.classList.add(state);

  connectionValueEl.classList.remove("offline", "connecting", "online");
  connectionValueEl.classList.add(state);

  connectionTextEl.textContent = state.toUpperCase();
}

// ---------------------------------------------------------
// Bottom telemetry strip: last command, time of last command, and a
// running count. Only called after the server actually accepts a
// command - failed/timed-out requests do not update these.
// ---------------------------------------------------------
function recordSuccessfulCommand(command) {
  commandLabelEl.textContent = command.toUpperCase();

  commandTimeEl.textContent = new Date().toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  sentCommandCount += 1;
  commandCountEl.textContent = String(sentCommandCount);
}

// ---------------------------------------------------------
// Central command dispatcher. Every control in the UI funnels
// through this function.
// ---------------------------------------------------------
async function sendGameCommand(command, payload = {}) {
  if (typeof command !== "string" || command.trim() === "") {
    console.warn("Invalid game command:", command);
    return false;
  }

  const message = {
    command: command.trim(),
    payload,
    timestamp: Date.now(),
    client: "velo-controller-web",
    version: "0.1",
  };

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, CONFIG.requestTimeoutMs);

  try {
    const response = await fetch(`${CONFIG.serverUrl}${CONFIG.commandEndpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const result = await response.json();
    setConnectionState("online");
    recordSuccessfulCommand(command);
    console.log("Game command accepted:", command, result);
    return true;
  } catch (error) {
    setConnectionState("offline");
    if (error.name === "AbortError") {
      console.error("Game command timed out:", command);
    } else {
      console.error("Game command failed:", command, error);
    }
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------
// Health check. Runs once on load and then on an interval; a flag
// guards against overlapping requests if the server is slow.
// ---------------------------------------------------------
let healthCheckInFlight = false;

async function checkServerConnection() {
  if (healthCheckInFlight) {
    return;
  }
  healthCheckInFlight = true;
  setConnectionState("connecting");

  try {
    const response = await fetch(`${CONFIG.serverUrl}${CONFIG.healthEndpoint}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    setConnectionState("online");
  } catch (error) {
    setConnectionState("offline");
  } finally {
    healthCheckInFlight = false;
  }
}

// ---------------------------------------------------------
// Camera selection (direct camera cards only). Changes the active
// card and the top-bar label immediately, before the server responds.
// ---------------------------------------------------------
function selectCamera(button) {
  cameraButtons.forEach((btn) => btn.classList.remove("active"));
  button.classList.add("active");

  const command = button.dataset.command;
  cameraLabelEl.textContent = CAMERA_LABELS[command] || command;
}

// ---------------------------------------------------------
// Rider prev/next: cycles the local mock label (if enabled) while
// always sending the real rider_previous / rider_next command.
// ---------------------------------------------------------
function advanceMockRider(direction) {
  mockRiderIndex = (mockRiderIndex + direction + MOCK_RIDERS.length) % MOCK_RIDERS.length;
  selectedRiderEl.textContent = MOCK_RIDERS[mockRiderIndex];
}

// ---------------------------------------------------------
// Toggle switches (HUD / Leaderboard / Name tags). Flips the local
// visual state immediately and returns the new "enabled" value so it
// can be sent to the server as payload.
// ---------------------------------------------------------
function toggleSwitch(button) {
  const enabled = button.dataset.enabled !== "true";
  button.dataset.enabled = String(enabled);

  const switchEl = button.querySelector(".switch");
  if (switchEl) {
    switchEl.classList.toggle("off", !enabled);
  }

  return enabled;
}

// ---------------------------------------------------------
// restart_race must only be sent after the user confirms.
// ---------------------------------------------------------
function confirmRestart() {
  return window.confirm("Opravdu chceš restartovat závod?");
}

// ---------------------------------------------------------
// Extra protection against the same command firing twice in quick
// succession. This is on top of (not instead of) the pointerdown-only
// binding below, which already stops a single press from double-firing.
// ---------------------------------------------------------
const COMMAND_DEBOUNCE_MS = 150;
let lastCommandSentAt = 0;
let lastCommandName = "";

function canSendCommand(command) {
  const now = Date.now();
  if (command === lastCommandName && now - lastCommandSentAt < COMMAND_DEBOUNCE_MS) {
    return false;
  }
  lastCommandName = command;
  lastCommandSentAt = now;
  return true;
}

// ---------------------------------------------------------
// Generic single-press handling.
//
// Mobile Safari can fire both touch and mouse/click events for the
// same physical press, which would trigger sendGameCommand twice. To
// guarantee "exactly once per press", we handle the action on
// pointerdown only and never combine it with click/touchend on the
// same element.
// ---------------------------------------------------------
const supportsPointerEvents = typeof window.PointerEvent === "function";

function bindButton(button) {
  const activate = () => {
    button.classList.add("pressed");

    const command = button.dataset.command;
    if (!command || !canSendCommand(command)) {
      return;
    }

    if (button.classList.contains("cam-btn")) {
      selectCamera(button);
    }

    if (command === "rider_previous" && MOCK_RIDER_SELECTION) {
      advanceMockRider(-1);
    } else if (command === "rider_next" && MOCK_RIDER_SELECTION) {
      advanceMockRider(1);
    }

    if (button.classList.contains("switch-row")) {
      const enabled = toggleSwitch(button);
      sendGameCommand(command, { enabled });
      return;
    }

    if (command === "restart_race" && !confirmRestart()) {
      return;
    }

    sendGameCommand(command);
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
// Startup: show offline immediately, then run the first health
// check and keep polling on the configured interval.
// ---------------------------------------------------------
setConnectionState("offline");
checkServerConnection();
window.setInterval(checkServerConnection, CONFIG.healthCheckIntervalMs);
