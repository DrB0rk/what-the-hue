"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const WebSocket = require("ws");
const { ZStackAdapter } = require("zigbee-herdsman/dist/adapter/z-stack/adapter/zStackAdapter");
const { Queue } = require("zigbee-herdsman/dist/utils/queue");
const { Touchlink } = require("zigbee-herdsman/dist/controller/touchlink");
const { Subsystem } = require("zigbee-herdsman/dist/adapter/z-stack/unpi/constants");
const Zcl = require("zigbee-herdsman/dist/zspec/zcl");

const PORT = 8099;
const CHANNELS = [11, 15, 20, 25, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24, 26];
const supervisorToken = process.env.SUPERVISOR_TOKEN;
const options = JSON.parse(fs.readFileSync("/data/options.json", "utf8"));
const serialPath = options.device;
const publicDir = path.join(__dirname, "public");

const operation = {
  running: false,
  state: "idle",
  startedAt: null,
  finishedAt: null,
  messages: [],
  error: null,
};

let zhaState = "unknown";
let activeCleanup = null;
let cachedStatus = null;
let statusCheckedAt = 0;

function note(message) {
  operation.messages.push({ time: new Date().toLocaleTimeString(), message });
  operation.messages = operation.messages.slice(-50);
  console.log(message);
}

function setStage(state, message) {
  operation.state = state;
  note(message);
}

class HomeAssistantConnection {
  constructor() {
    this.socket = new WebSocket("ws://supervisor/core/websocket");
    this.nextId = 1;
    this.pending = new Map();
    this.authenticated = new Promise((resolve, reject) => {
      this.resolveAuth = resolve;
      this.rejectAuth = reject;
    });
    this.socket.on("message", (raw) => this.handleMessage(raw));
    this.socket.on("error", (error) => {
      this.rejectAuth(error);
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    });
    this.socket.on("close", () => {
      for (const request of this.pending.values()) request.reject(new Error("Home Assistant connection closed"));
      this.pending.clear();
    });
  }

  async connect() {
    if (!supervisorToken) throw new Error("Home Assistant API access is not available. Check the app permissions.");
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to Home Assistant")), 10000);
      this.socket.once("open", () => { clearTimeout(timer); resolve(); });
      this.socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
    await this.authenticated;
    return this;
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === "auth_required") {
      this.socket.send(JSON.stringify({ type: "auth", access_token: supervisorToken }));
      return;
    }
    if (message.type === "auth_ok") {
      this.resolveAuth();
      return;
    }
    if (message.type === "auth_invalid") {
      this.rejectAuth(new Error("Home Assistant rejected the app API token"));
      return;
    }

    const request = this.pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(message.id);
    if (message.success === false) {
      request.reject(new Error(message.error?.message || "Home Assistant command failed"));
    } else {
      request.resolve(message.result);
    }
  }

  async command(type, payload = {}, timeoutMs = 30000) {
    await this.authenticated;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Home Assistant command timed out: ${type}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, type, ...payload }));
    });
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }
}

async function getZhaEntries(ha) {
  const entries = await ha.command("config_entries/get");
  return entries.filter((entry) => entry.domain === "zha");
}

async function waitForZhaState(ha, entryId, desiredState, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entry = await ha.command("config_entries/get_single", { entry_id: entryId });
    const current = entry?.config_entry;
    if (current?.state === desiredState) return current;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`ZHA did not reach ${desiredState.replaceAll("_", " ")} in time`);
}

async function refreshStatus() {
  if (operation.running && cachedStatus) {
    return { ...cachedStatus, ready: false, zha: zhaState, message: "A reset is in progress." };
  }
  if (cachedStatus && Date.now() - statusCheckedAt < 5000) return cachedStatus;

  let ha;
  try {
    ha = await new HomeAssistantConnection().connect();
    const entries = await getZhaEntries(ha);
    zhaState = entries.some((entry) => entry.state === "loaded") ? "loaded" : "not_loaded";
  } catch (error) {
    zhaState = "unavailable";
    cachedStatus = { ready: false, zha: zhaState, device: serialPath || null, deviceReady: false, message: error.message };
    statusCheckedAt = Date.now();
    return cachedStatus;
  } finally {
    ha?.close();
  }

  const deviceReady = typeof serialPath === "string" && serialPath.startsWith("/dev/") && fs.existsSync(serialPath);
  cachedStatus = {
    ready: zhaState === "loaded" && deviceReady,
    zha: zhaState,
    device: serialPath || null,
    deviceReady,
    message: !deviceReady ? "Choose the Zigbee coordinator in the app configuration." : zhaState !== "loaded" ? "ZHA must be loaded before you start." : "Ready",
  };
  statusCheckedAt = Date.now();
  return cachedStatus;
}

function makeResetFrame(serialNumber, extendedPanId) {
  const manufacturerCode = Zcl.ManufacturerCode.SIGNIFY_NETHERLANDS_B_V;
  const clusters = {
    manuSpecificPhilipsPairing: {
      name: "manuSpecificPhilipsPairing",
      ID: 0x1000,
      manufacturerCode,
      attributes: {},
      commands: {
        hueResetRequest: {
          name: "hueResetRequest",
          ID: 0,
          parameters: [
            { name: "extendedPanId", type: Zcl.DataType.IEEE_ADDR },
            { name: "serialCount", type: Zcl.DataType.UINT8 },
            { name: "serialNumbers", type: Zcl.BuffaloZclDataType.LIST_UINT32 },
          ],
        },
      },
      commandsResponse: {},
    },
  };

  return Zcl.Frame.create(
    Zcl.FrameType.SPECIFIC,
    Zcl.Direction.CLIENT_TO_SERVER,
    true,
    manufacturerCode,
    0,
    "hueResetRequest",
    "manuSpecificPhilipsPairing",
    {
      extendedPanId: `0x${extendedPanId}`,
      serialCount: 1,
      serialNumbers: [Number.parseInt(serialNumber, 16)],
    },
    clusters,
  );
}

async function performReset(serialNumber) {
  operation.running = true;
  operation.state = "preparing";
  operation.startedAt = new Date().toISOString();
  operation.finishedAt = null;
  operation.messages = [];
  operation.error = null;
  let ha;
  let entryId;
  let zhaDisabled = false;
  let adapter;
  let adapterOpen = false;
  let touchlink;
  let cleanupPromise;

  const cleanup = async () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      if (touchlink) {
        try {
          await touchlink.restoreChannelInterPAN();
          note("Restored the coordinator's Zigbee channel.");
        } catch (error) {
          note(`Could not restore the Inter-PAN channel: ${error.message}`);
        }
      }
      if (adapterOpen) {
        try {
          await adapter.znp.close();
          note("Closed the coordinator connection.");
        } catch (error) {
          note(`Could not close the coordinator cleanly: ${error.message}`);
        }
        adapterOpen = false;
      }
      if (zhaDisabled && ha) {
        setStage("restoring", "Re-enabling ZHA.");
        try {
          await ha.command("config_entries/disable", { entry_id: entryId, disabled_by: null }, 45000);
          await waitForZhaState(ha, entryId, "loaded", 45000);
          zhaDisabled = false;
          zhaState = "loaded";
          note("ZHA is loaded again.");
        } catch (error) {
          zhaState = "not_loaded";
          operation.error = operation.error || `The reset was sent, but ZHA did not reload: ${error.message}. Reload ZHA from Home Assistant.`;
          note(operation.error);
        }
      }
      ha?.close();
    })();
    return cleanupPromise;
  };
  activeCleanup = cleanup;

  try {
    if (!serialPath || !serialPath.startsWith("/dev/") || !fs.existsSync(serialPath)) {
      throw new Error("Choose the Zigbee coordinator in the app configuration, then restart this app.");
    }

    setStage("connecting", "Connecting to Home Assistant and checking ZHA.");
    ha = await new HomeAssistantConnection().connect();
    const entries = await getZhaEntries(ha);
    const loadedEntries = entries.filter((entry) => entry.state === "loaded" && !entry.disabled_by);
    if (loadedEntries.length !== 1) {
      throw new Error(loadedEntries.length === 0
        ? "No loaded ZHA coordinator was found. Start ZHA before running a reset."
        : "More than one ZHA coordinator is loaded. This app requires exactly one.");
    }
    entryId = loadedEntries[0].entry_id;

    setStage("backup", "Reading the active Zigbee network ID from ZHA.");
    const backupResult = await ha.command("zha/network/backups/create", {}, 60000);
    const backup = backupResult?.backup;
    const panValue = backup?.network_info?.extended_pan_id;
    const extendedPanId = typeof panValue === "string" ? panValue.replaceAll(":", "").toLowerCase() : "";
    if (!/^[0-9a-f]{16}$/.test(extendedPanId)) {
      throw new Error("ZHA did not return a usable network ID. Make a ZHA network backup and try again.");
    }

    setStage("pausing_zha", "Pausing ZHA briefly so the coordinator can be used directly.");
    zhaDisabled = true;
    await ha.command("config_entries/disable", { entry_id: entryId, disabled_by: "user" }, 45000);
    await waitForZhaState(ha, entryId, "not_loaded", 20000);
    zhaState = "not_loaded";

    setStage("opening_radio", "Opening the Zigbee coordinator.");
    adapter = new ZStackAdapter({}, { path: serialPath, baudRate: 115200, rtscts: false }, "", {});
    adapter.queue = new Queue(1);
    adapterOpen = true;
    await adapter.znp.open();
    const version = await adapter.znp.requestWithReply(Subsystem.SYS, "version", {});
    adapter.version = version.payload;
    const endpoint = require("zigbee-herdsman/dist/adapter/z-stack/adapter/endpoints").Endpoints.find((item) => item.endpoint === 12);
    if (!endpoint) throw new Error("The Zigbee adapter library could not register its Touchlink endpoint.");
    await adapter.znp.request(Subsystem.AF, "register", endpoint);
    touchlink = new Touchlink(adapter);

    const frame = makeResetFrame(serialNumber, extendedPanId);
    note("Sending the serial-targeted Philips reset across supported channels.");
    for (let index = 0; index < CHANNELS.length; index += 1) {
      const channel = CHANNELS[index];
      setStage("sending", `Sending the targeted reset on Zigbee channel ${channel} (${index + 1}/${CHANNELS.length}).`);
      await touchlink.setChannelInterPAN(channel);
      await adapter.sendZclFrameInterPANBroadcast(frame, 10000, true);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setStage("restoring", "The channel sweep is complete. Restoring ZHA.");
  } catch (error) {
    operation.error = error.message;
    note(`Reset stopped: ${error.message}`);
  } finally {
    await cleanup();
    operation.running = false;
    operation.finishedAt = new Date().toISOString();
    operation.state = operation.error ? "error" : "complete";
    cachedStatus = null;
    statusCheckedAt = 0;
    activeCleanup = null;
  }
}

function response(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; base-uri 'self'; object-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'",
  });
  res.end(contentType.startsWith("application/json") ? JSON.stringify(body) : body);
}

function appPath(req) {
  const urlPath = new URL(req.url, "http://app.local").pathname;
  const ingressPath = req.headers["x-ingress-path"];
  if (typeof ingressPath === "string" && urlPath.startsWith(ingressPath)) {
    return urlPath.slice(ingressPath.length) || "/";
  }
  const ingressMatch = urlPath.match(/^\/api\/hassio_ingress\/[^/]+(.*)$/);
  if (ingressMatch) return ingressMatch[1] || "/";
  const marker = urlPath.indexOf("/api/");
  if (marker > 0) return urlPath.slice(marker);
  return urlPath;
}

function isIngressRequest(req) {
  const address = req.socket.remoteAddress?.replace(/^::ffff:/, "");
  return address === "172.30.32.2";
}

const server = http.createServer(async (req, res) => {
  if (!isIngressRequest(req)) return response(res, 403, { error: "Use the Home Assistant app panel." });
  const pathname = appPath(req);

  if (req.method === "GET" && pathname === "/api/status") {
    const readiness = await refreshStatus();
    return response(res, 200, { ...readiness, operation });
  }

  if (req.method === "POST" && pathname === "/api/reset") {
    if (operation.running) return response(res, 409, { error: "A reset is already running." });
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2048) return response(res, 413, { error: "Request is too large." });
    }
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      return response(res, 400, { error: "Send a valid JSON request." });
    }
    const serialNumber = String(input.serial || "").replaceAll(":", "").replaceAll(" ", "").toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(serialNumber)) return response(res, 400, { error: "Enter the six hexadecimal characters printed on the bulb." });
    if (input.confirm !== serialNumber || input.bulbReady !== true) {
      return response(res, 400, { error: "Confirm the serial number and that the bulb is on and close to the coordinator." });
    }

    void performReset(serialNumber);
    return response(res, 202, { accepted: true });
  }

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    const urlPath = new URL(req.url, "http://app.local").pathname;
    const ingressPath = urlPath.match(/^\/api\/hassio_ingress\/[A-Za-z0-9_-]+/)?.[0]
      || (typeof req.headers["x-ingress-path"] === "string" && /^\/api\/hassio_ingress\/[A-Za-z0-9_-]+$/.test(req.headers["x-ingress-path"])
        ? req.headers["x-ingress-path"]
        : "");
    const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8")
      .replace("<head>", `<head><base href="${ingressPath}/">`);
    return response(res, 200, html, "text/html; charset=utf-8");
  }

  if (req.method === "GET" && pathname === "/app.css") {
    return response(res, 200, fs.readFileSync(path.join(publicDir, "app.css"), "utf8"), "text/css; charset=utf-8");
  }

  if (req.method === "GET" && pathname === "/app.js") {
    return response(res, 200, fs.readFileSync(path.join(publicDir, "app.js"), "utf8"), "text/javascript; charset=utf-8");
  }

  return response(res, 404, { error: "Not found." });
});

server.listen(PORT, "0.0.0.0", () => console.log(`What the Hue app listening on ${PORT}`));

async function shutdown() {
  server.close();
  if (activeCleanup) await activeCleanup();
  process.exit(0);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
