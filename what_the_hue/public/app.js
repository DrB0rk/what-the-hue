"use strict";

const form = document.querySelector("#reset-form");
const serialInput = document.querySelector("#serial");
const confirmInput = document.querySelector("#confirm-serial");
const readyInput = document.querySelector("#bulb-ready");
const submitButton = document.querySelector("#submit-button");
const formError = document.querySelector("#form-error");
const operationState = document.querySelector("#operation-state");
const operationSummary = document.querySelector("#operation-summary");
const operationLog = document.querySelector("#operation-log");
const nextStep = document.querySelector("#next-step");
const deviceState = document.querySelector("#device-state");
const zhaState = document.querySelector("#zha-state");
const coordinatorDot = document.querySelector("#coordinator-dot");
const zhaDot = document.querySelector("#zha-dot");
const statusMessage = document.querySelector("#status-message");

let isRunning = false;
let appReady = false;

function normalized(value) {
  return value.replaceAll(":", "").replaceAll(" ", "").toUpperCase();
}

function updateButton() {
  const serial = normalized(serialInput.value);
  const confirmed = normalized(confirmInput.value);
  submitButton.disabled = isRunning || !appReady || !/^[0-9A-F]{6}$/.test(serial) || serial !== confirmed || !readyInput.checked;
}

function setDot(dot, state) {
  dot.className = `state-dot ${state}`;
}

function renderStatus(data) {
  const deviceReady = data.deviceReady === true;
  const zhaReady = data.zha === "loaded";
  appReady = data.ready === true;
  deviceState.textContent = deviceReady ? data.device : "Not selected";
  zhaState.textContent = zhaReady ? "Loaded" : data.zha === "unavailable" ? "Unavailable" : data.zha === "not_loaded" ? "Not loaded" : "Checking";
  statusMessage.textContent = data.ready ? "" : data.message || "The coordinator is not ready.";
  setDot(coordinatorDot, deviceReady ? "ready" : "error");
  setDot(zhaDot, zhaReady ? "ready" : data.zha === "unavailable" ? "error" : "waiting");
  updateButton();
}

function labelForState(state) {
  const labels = {
    idle: "Ready when the coordinator is available",
    preparing: "Preparing reset",
    connecting: "Checking Home Assistant",
    backup: "Reading Zigbee network details",
    pausing_zha: "Pausing ZHA",
    opening_radio: "Opening coordinator",
    sending: "Sending targeted reset",
    restoring: "Restoring ZHA",
    complete: "Reset command sent",
    error: "Reset could not finish",
  };
  return labels[state] || "Working";
}

function renderOperation(operation) {
  isRunning = operation.running === true;
  operationState.textContent = labelForState(operation.state);
  operationSummary.textContent = operation.running
    ? "Keep the bulb powered on near the coordinator until ZHA is restored."
    : operation.error || (operation.state === "complete"
      ? "The reset sweep finished. If the bulb blinked, it likely received the command."
      : "Keep the bulb close while the app sends the reset across the supported Zigbee channels.");

  operationLog.replaceChildren();
  for (const item of operation.messages || []) {
    const row = document.createElement("li");
    if (operation.error && item.message.includes("Reset stopped:")) row.classList.add("error");
    const time = document.createElement("time");
    time.textContent = item.time;
    const message = document.createElement("span");
    message.textContent = item.message;
    row.append(time, message);
    operationLog.append(row);
  }

  nextStep.hidden = operation.state !== "complete" || operation.error !== null;
  submitButton.textContent = isRunning ? "Reset in progress…" : "Send reset to this bulb";
}

async function refresh() {
  try {
    const response = await fetch("api/status", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not read app status");
    renderStatus(data);
    renderOperation(data.operation);
  } catch (error) {
    zhaState.textContent = error.message;
    statusMessage.textContent = error.message;
    setDot(zhaDot, "error");
    appReady = false;
    updateButton();
  }
}

form.addEventListener("input", updateButton);
form.addEventListener("change", updateButton);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.hidden = true;
  const serial = normalized(serialInput.value);
  const confirmed = normalized(confirmInput.value);
  if (serial !== confirmed || !readyInput.checked) return;

  submitButton.disabled = true;
  try {
    const response = await fetch("api/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serial, confirm: confirmed, bulbReady: readyInput.checked }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start the reset");
    await refresh();
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
    await refresh();
  }
});

refresh();
setInterval(refresh, 1000);
