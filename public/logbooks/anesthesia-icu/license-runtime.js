(() => {
  "use strict";

  const DB_NAME = "mentoro-local-logbooks";
  const DB_VERSION = 1;
  const STORE_NAME = "records";
  const LICENSE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
  let dbPromise;
  let configPromise;
  let licenseRecord = null;
  let stateKey = null;
  let stateSaveQueue = Promise.resolve();
  let statusNode = null;

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("Your browser does not support secure local logbook storage. Please use an updated browser."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Local storage could not be opened."));
      request.onblocked = () => reject(new Error("Local storage is busy in another tab. Close other MENTORO logbook tabs and retry."));
    });
    return dbPromise;
  }

  async function getRecord(key) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result?.value ?? null);
      request.onerror = () => reject(request.error || new Error("Local data could not be read."));
    });
  }

  async function putRecord(key, value) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ key, value, updatedAt: new Date().toISOString() });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Local data could not be saved."));
      transaction.onabort = () => reject(transaction.error || new Error("Local save was interrupted."));
    });
  }

  async function deleteRecord(key) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("Local record could not be removed."));
    });
  }

  function randomId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" +
      hex.slice(16, 20) + "-" + hex.slice(20);
  }

  async function sha256Hex(value) {
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function getInstallationId(specialtySlug) {
    const key = "installation:" + specialtySlug;
    let value = await getRecord(key);
    if (typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)) return value;
    value = randomId();
    await putRecord(key, value);
    return value;
  }

  function loadConfig() {
    if (!configPromise) {
      configPromise = fetch("/api/license/config", { method: "GET", cache: "no-store", credentials: "same-origin" })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload.supabaseUrl || !payload.publishableKey || !payload.functionName) {
            throw new Error(payload.error || "License service configuration is unavailable.");
          }
          const base = new URL(payload.supabaseUrl);
          if (base.protocol !== "https:" || !base.hostname.endsWith(".supabase.co")) {
            throw new Error("License service configuration is invalid.");
          }
          return {
            endpoint: base.origin + "/functions/v1/" + encodeURIComponent(payload.functionName),
            publishableKey: payload.publishableKey
          };
        })
        .catch((error) => {
          configPromise = null;
          throw error;
        });
    }
    return configPromise;
  }

  async function invokeLicense(action, body) {
    const config = await loadConfig();
    const response = await fetch(config.endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "apikey": config.publishableKey
      },
      body: JSON.stringify({ action, ...body })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "license_request_failed");
      error.status = response.status;
      error.retryAfterSeconds = payload.retryAfterSeconds;
      throw error;
    }
    return payload;
  }

  function showGate({ specialtyName, reason, onActivate }) {
    let gate = document.getElementById("mentoroLicenseGate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "mentoroLicenseGate";
      gate.className = "license-gate";
      gate.innerHTML = `
        <section class="license-card" role="dialog" aria-modal="true" aria-labelledby="licenseGateTitle">
          <div class="license-brand">MENTORO <span>LICENSED LOGBOOK</span></div>
          <h1 id="licenseGateTitle">Activate your logbook</h1>
          <p class="license-specialty"></p>
          <p class="license-intro">Enter the license code provided by MENTORO. Your progress will be saved on this device.</p>
          <label class="license-label" for="licenseCodeInput">License key</label>
          <input id="licenseCodeInput" class="license-input" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="MTR-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" maxlength="48">
          <p class="license-error" id="licenseGateError" role="alert"></p>
          <button class="license-submit" id="licenseActivateButton" type="button">Activate logbook</button>
          <p class="license-foot">One license supports up to two devices. Each device keeps its own separate local data; there is no automatic sync.</p>
          <p class="license-support">Never enter patient names, hospital IDs, phone numbers, or other identifying details.</p>
        </section>`;
      document.body.appendChild(gate);
    }
    gate.querySelector(".license-specialty").textContent = specialtyName;
    gate.querySelector("#licenseGateError").textContent = reason || "";
    gate.hidden = false;
    const input = gate.querySelector("#licenseCodeInput");
    const button = gate.querySelector("#licenseActivateButton");
    const activate = async () => {
      const licenseCode = input.value.trim();
      if (!licenseCode) {
        gate.querySelector("#licenseGateError").textContent = "Enter your license key to continue.";
        input.focus();
        return;
      }
      button.disabled = true;
      button.textContent = "Checking license…";
      gate.querySelector("#licenseGateError").textContent = "";
      try {
        await onActivate(licenseCode);
      } catch (error) {
        const errors = {
          license_unavailable: "This license could not be verified. Check the code or contact MENTORO.",
          device_limit_reached: "Both device activations are already in use. Contact MENTORO to reset a device.",
          too_many_attempts: "Too many attempts. Please try again in 15 minutes.",
          license_service_configuration_missing: "License service is not configured for this deployment.",
          license_service_unavailable: "The license service is temporarily unavailable. Check your connection and retry."
        };
        gate.querySelector("#licenseGateError").textContent =
          errors[error.message] || (error.message === "Failed to fetch"
            ? "Could not reach the license service. Check your internet connection."
            : "Activation failed. Please check your code and try again.");
      } finally {
        button.disabled = false;
        button.textContent = "Activate logbook";
      }
    };
    button.onclick = activate;
    input.onkeydown = (event) => { if (event.key === "Enter") activate(); };
    window.setTimeout(() => input.focus(), 0);
    return gate;
  }

  function addWatermark(label, hint, validUntil, offline) {
    let node = document.getElementById("mentoroLicenseWatermark");
    if (!node) {
      node = document.createElement("div");
      node.id = "mentoroLicenseWatermark";
      node.className = "license-watermark";
      const sync = document.getElementById("syncStatus");
      if (sync?.parentNode) sync.parentNode.insertBefore(node, sync.nextSibling);
      else document.querySelector("main.content")?.prepend(node);
    }
    const validDate = validUntil ? new Date(validUntil) : null;
    const dateLabel = validDate && Number.isFinite(validDate.getTime()) ? validDate.toLocaleDateString() : "—";
    node.textContent = "Licensed to " + (label || "MENTORO trainee") + " · License " + (hint || "—") +
      " · " + (offline ? "Offline access" : "Active") + " until " + dateLabel;
    node.hidden = false;
  }

  function updateStatus(text, isError = false) {
    statusNode = statusNode || document.getElementById("syncStatus");
    if (!statusNode) return;
    statusNode.textContent = text;
    statusNode.classList.toggle("error", Boolean(isError));
  }

  function localStateKey(licenseId, specialtySlug) {
    return "state:" + licenseId + ":" + specialtySlug;
  }

  async function loadLocalState(licenseId, specialtySlug, normalizeState, emptyState) {
    const stored = await getRecord(localStateKey(licenseId, specialtySlug));
    if (stored && typeof stored === "object") return normalizeState(stored).state;
    return emptyState();
  }

  async function persistLocalState(state) {
    if (!licenseRecord || !stateKey) throw new Error("No active license is available for local saving.");
    stateSaveQueue = stateSaveQueue.then(() => putRecord(stateKey, state));
    await stateSaveQueue;
  }

  function toContext(payload, installationId, offline = false) {
    return {
      licenseId: payload.license_id || payload.licenseId || licenseRecord?.licenseId,
      deviceId: payload.device_id || payload.deviceId || licenseRecord?.deviceId,
      deviceToken: licenseRecord?.deviceToken,
      installationId,
      traineeLabel: payload.trainee_label || payload.traineeLabel || licenseRecord?.traineeLabel || "",
      licenseHint: payload.license_hint || payload.licenseHint || licenseRecord?.licenseHint || "",
      expiresAt: payload.expires_at || payload.expiresAt || licenseRecord?.expiresAt || null,
      validUntil: payload.valid_until || payload.validUntil || licenseRecord?.validUntil || null,
      deviceLimit: payload.device_limit || payload.deviceLimit || 2,
      deviceCount: payload.device_count || payload.deviceCount || null,
      offline
    };
  }

  async function begin({
    specialtySlug,
    specialtyName,
    normalizeState,
    emptyState
  }) {
    const installationId = await getInstallationId(specialtySlug);
    const licenseStorageKey = "license:" + specialtySlug;
    const cached = await getRecord(licenseStorageKey);
    const stateStorageKey = cached?.licenseId ? localStateKey(cached.licenseId, specialtySlug) : null;

    if (cached && typeof cached.deviceToken === "string" && cached.deviceToken) {
      licenseRecord = cached;
      stateKey = stateStorageKey;
      try {
        const payload = await invokeLicense("validate", {
          specialtySlug,
          installationId,
          deviceToken: cached.deviceToken
        });
        if (payload.ok !== true) throw new Error("license_invalid");
        licenseRecord = toContext(payload, installationId, false);
        await putRecord(licenseStorageKey, licenseRecord);
        stateKey = localStateKey(licenseRecord.licenseId, specialtySlug);
        const state = await loadLocalState(licenseRecord.licenseId, specialtySlug, normalizeState, emptyState);
        addWatermark(licenseRecord.traineeLabel, licenseRecord.licenseHint, licenseRecord.validUntil, false);
        updateStatus("Active license · saved on this device");
        return { state, context: licenseRecord };
      } catch (error) {
        const canUseOffline = error.status === undefined || error.status >= 500 || error.status === 429;
        const deadline = Date.parse(cached.validUntil || "");
        if (canUseOffline && Number.isFinite(deadline) && Date.now() < deadline &&
            (!cached.expiresAt || Date.parse(cached.expiresAt) > Date.now())) {
          licenseRecord = { ...cached, installationId, offline: true };
          stateKey = localStateKey(cached.licenseId, specialtySlug);
          const state = await loadLocalState(cached.licenseId, specialtySlug, normalizeState, emptyState);
          addWatermark(cached.traineeLabel, cached.licenseHint, cached.validUntil, true);
          updateStatus("Offline access · reconnect before " + new Date(cached.validUntil).toLocaleString());
          return { state, context: licenseRecord };
        }
        licenseRecord = null;
        stateKey = null;
        const gate = showGate({
          specialtyName,
          reason: error.status === 403 ? "This device activation is no longer valid. Enter a current license key or contact MENTORO." :
            "Connect to the internet to verify your license, or enter a new license key."
        });
        return await new Promise((resolve) => {
          gate.querySelector("#licenseCodeInput").focus();
          gate.querySelector("#licenseActivateButton").onclick = async () => {
            // Re-bound below by showGate when activation is attached.
          };
          attachActivation(gate, resolve, specialtySlug, installationId, licenseStorageKey, normalizeState, emptyState);
        });
      }
    }

    const gate = showGate({ specialtyName, reason: "A valid MENTORO license is required to open this logbook." });
    return await new Promise((resolve) => {
      attachActivation(gate, resolve, specialtySlug, installationId, licenseStorageKey, normalizeState, emptyState);
    });
  }

  function attachActivation(gate, resolve, specialtySlug, installationId, licenseStorageKey, normalizeState, emptyState) {
    const input = gate.querySelector("#licenseCodeInput");
    const button = gate.querySelector("#licenseActivateButton");
    button.onclick = async () => {
      const licenseCode = input.value.trim();
      if (!licenseCode) {
        gate.querySelector("#licenseGateError").textContent = "Enter your license key to continue.";
        input.focus();
        return;
      }
      button.disabled = true;
      button.textContent = "Checking license…";
      gate.querySelector("#licenseGateError").textContent = "";
      try {
        const payload = await invokeLicense("activate", {
          specialtySlug,
          installationId,
          licenseCode
        });
        if (!payload.ok || !payload.deviceToken || !payload.licenseId) {
          throw new Error(payload.error || "license_unavailable");
        }
        licenseRecord = {
          licenseId: payload.licenseId,
          deviceId: payload.deviceId,
          deviceToken: payload.deviceToken,
          installationId,
          traineeLabel: payload.traineeLabel || "",
          licenseHint: payload.licenseHint || "",
          validUntil: payload.validUntil,
          expiresAt: payload.expiresAt || null,
          deviceLimit: 2,
          deviceCount: payload.deviceCount || null,
          offline: false
        };
        stateKey = localStateKey(licenseRecord.licenseId, specialtySlug);
        await putRecord(licenseStorageKey, licenseRecord);
        const state = await loadLocalState(licenseRecord.licenseId, specialtySlug, normalizeState, emptyState);
        gate.remove();
        addWatermark(licenseRecord.traineeLabel, licenseRecord.licenseHint, licenseRecord.validUntil, false);
        updateStatus("License activated · saved on this device");
        resolve({ state, context: licenseRecord });
      } catch (error) {
        const errors = {
          license_unavailable: "This license could not be verified. Check the code or contact MENTORO.",
          device_limit_reached: "Both device activations are already in use. Contact MENTORO to reset a device.",
          too_many_attempts: "Too many attempts. Please try again in 15 minutes.",
          license_service_unavailable: "The license service is temporarily unavailable. Check your connection and retry."
        };
        gate.querySelector("#licenseGateError").textContent = errors[error.message] ||
          (error.message === "Failed to fetch" ? "Could not reach the license service. Check your connection." :
            "Activation failed. Please check your code and try again.");
      } finally {
        button.disabled = false;
        button.textContent = "Activate logbook";
      }
    };
    input.onkeydown = (event) => { if (event.key === "Enter") button.click(); };
    input.focus();
  }

  async function validateCachedGrant() {
    if (!licenseRecord) return { valid: false };
    try {
      const result = await invokeLicense("validate", {
        specialtySlug: licenseRecord.specialtySlug,
        installationId: licenseRecord.installationId,
        deviceToken: licenseRecord.deviceToken
      });
      return { valid: result.ok === true, result };
    } catch (error) {
      return { valid: false, offline: true, error };
    }
  }

  async function start(options) {
    const result = await begin(options);
    licenseRecord = { ...result.context, specialtySlug: options.specialtySlug };
    stateKey = localStateKey(licenseRecord.licenseId, options.specialtySlug);
    return result;
  }

  async function saveState(state) {
    await persistLocalState(state);
  }

  async function exportState() {
    if (!licenseRecord || !stateKey) throw new Error("No active license is available.");
    return {
      format: "mentoro-logbook-backup",
      version: 1,
      specialty: licenseRecord.specialtySlug,
      licenseHint: licenseRecord.licenseHint,
      exportedAt: new Date().toISOString()
    };
  }

  window.MentoroLicenseRuntime = Object.freeze({
    start,
    saveState,
    validateCachedGrant,
    get license() { return licenseRecord ? { ...licenseRecord } : null; },
    get stateKey() { return stateKey; }
  });
})();
