// =====================================================
// V1.1 Alpha - PROJECT SNAPSHOT LAYER
// Reads V1.0.4 Stable generator state without modifying app.js.
// =====================================================

const SNAPSHOT_SCHEMA_VERSION = "1.1";
const SNAPSHOT_APPLICATION_VERSION = "1.1.0-alpha.1";
const SNAPSHOT_ENGINE_VERSION = "1.0.4";
const SNAPSHOT_PROFILE_ID = "ABUS_SFA_777";
const SNAPSHOT_PROFILE_VERSION = "1.0";

let latestProjectSnapshot = null;
let projectSessionCreatedAt = new Date().toISOString();

document.addEventListener("DOMContentLoaded", () => {
  const createBtn = document.getElementById("createSnapshotBtn");
  const downloadBtn = document.getElementById("downloadSnapshotBtn");
  const confirmBtn = document.getElementById("confirmProjectBtn");

  createBtn.addEventListener("click", async () => {
    try {
      latestProjectSnapshot = await createConfirmedProjectSnapshot();
      renderSnapshotStatus(latestProjectSnapshot);
      downloadBtn.disabled = false;
    } catch (error) {
      renderSnapshotError(error);
    }
  });

  downloadBtn.addEventListener("click", () => {
    if (latestProjectSnapshot) downloadSnapshot(latestProjectSnapshot);
  });

  confirmBtn.addEventListener("click", () => {
    if (projectLocked) {
      createBtn.disabled = false;
      document.getElementById("snapshotStatus").textContent =
        "Projekt on kinnitatud. Snapshot on valmis koostamiseks.";
    }
  });
});

async function createConfirmedProjectSnapshot() {
  if (!projectLocked) throw new Error("Projekt tuleb enne snapshoti koostamist kinnitada.");
  if (!projectInfo.projectCode) throw new Error("Projektikood puudub.");
  if (!masterData.keys.length || !masterData.matrix.length) throw new Error("Avamismaatriks puudub.");
  if (!Object.keys(keyCodes).length || !pinnings.length) {
    throw new Error("Genereeritud võtme- või südamikukoodid puuduvad.");
  }

  const keyIds = new Map();
  masterData.keys.forEach((name, index) => {
    keyIds.set(name, `K${String(index + 1).padStart(3, "0")}`);
  });

  const doors = masterData.matrix.map((row, index) => ({
    id: `D${String(index + 1).padStart(3, "0")}`,
    name: row.door,
    quantity: row.openings.some(Boolean) ? normalizeQuantity(row.quantity) : null,
    lockable: row.openings.some(Boolean),
    openBy: row.openings
      .map((opens, keyIndex) => opens ? keyIds.get(masterData.keys[keyIndex]) : null)
      .filter(Boolean)
  }));

  const keys = masterData.keys.map((name, index) => ({
    id: keyIds.get(name),
    name,
    quantity: normalizeQuantity(masterData.keyQuantities[index])
  }));

  const generatedKeys = masterData.keys
    .filter(name => Array.isArray(keyCodes[name]))
    .map(name => {
      const hierarchy = keyHierarchy.find(item => item.key === name);
      const keyIndex = masterData.keys.indexOf(name);
      const keyId = keyIds.get(name);

      return {
        id: keyId,
        name,
        quantity: normalizeQuantity(masterData.keyQuantities[keyIndex]),
        code: [...keyCodes[name]],
        hierarchyLevel: hierarchy ? hierarchy.level : null,
        opensDoors: doors.filter(door => door.openBy.includes(keyId)).map(door => door.id)
      };
    });

  const lockableDoors = doors.filter(door => door.lockable);
  if (lockableDoors.length !== pinnings.length) {
    throw new Error("Südamike arv ei vasta lukustatavate uste arvule.");
  }

  const cylinders = pinnings.map((pinning, index) => ({
    id: `C${String(index + 1).padStart(3, "0")}`,
    doorId: lockableDoors[index].id,
    quantity: lockableDoors[index].quantity,
    pinning: pinning.channels.map((channel, chamberIndex) => ({
      chamber: chamberIndex + 1,
      base: channel.base,
      masters: [...channel.masters]
    })),
    openedBy: pinning.opensBy.map(name => keyIds.get(name)).filter(Boolean)
  }));

  const validation = validateMatrix();

  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    applicationVersion: SNAPSHOT_APPLICATION_VERSION,
    engineVersion: SNAPSHOT_ENGINE_VERSION,
    profile: {
      id: SNAPSHOT_PROFILE_ID,
      version: SNAPSHOT_PROFILE_VERSION
    },
    project: {
      projectCode: projectInfo.projectCode,
      projectVersion: 1,
      orderNumber: projectInfo.orderNumber || "",
      status: "CONFIRMED",
      createdAt: projectSessionCreatedAt,
      confirmedAt: new Date().toISOString()
    },
    settings: {
      allowedStandardPins: [...getAllowedStandardPins()],
      allowedMasterPins: [...getAllowedMasterPins()],
      qualityRules: {
        macs: QUALITY_RULES.RULE_3_MACS,
        minUniqueDepths: QUALITY_RULES.RULE_1_MIN_UNIQUE_DEPTHS,
        maxSameDepthCount: QUALITY_RULES.RULE_2_MAX_DUPLICATES,
        avoidFirstDepth9: QUALITY_RULES.RULE_4_AVOID_FIRST_DEPTH_9,
        avoid88: QUALITY_RULES.RULE_5_AVOID_88,
        avoid99: QUALITY_RULES.RULE_6_AVOID_99,
        avoidSimplePatterns: QUALITY_RULES.RULE_7_AVOID_SIMPLE_PATTERNS,
        preferLowBaseDepths: QUALITY_RULES.RULE_8_PREFER_LOW_BASE_DEPTHS,
        avoidBaseAbove7: QUALITY_RULES.RULE_9_AVOID_BASE_ABOVE_7,
        preferRearMasterPins: QUALITY_RULES.RULE_10_PREFER_REAR_MASTER_PINS,
        rekeyMinDifference: QUALITY_RULES.RULE_11_REKEY_MIN_DIFFERENCE,
        reserveForRekey: QUALITY_RULES.RULE_12_RESERVE_FOR_REKEY,
        noUpcutToHigherLevel: QUALITY_RULES.RULE_13_NO_UPCUT_TO_HIGHER_LEVEL
      },
      maxMasterPinsPerChamber: ACTIVE_PROFILE.maxMasterPins,
      strategy: "QUALITY"
    },
    matrix: { keys, doors },
    generated: { keys: generatedKeys, cylinders },
    validation: {
      valid: validation.errors.length === 0,
      errors: [...validation.errors],
      warnings: [...validation.warnings]
    },
    confirmation: {
      confirmed: true,
      confirmedBy: null,
      confirmationMethod: "UI"
    },
    integrity: {
      algorithm: "SHA-256",
      checksum: ""
    }
  };

  const checksumSource = deepClone(snapshot);
  checksumSource.integrity.checksum = "";
  snapshot.integrity.checksum = await sha256Hex(canonicalJson(checksumSource));

  return snapshot;
}

function normalizeQuantity(value) {
  return Number.isInteger(value) ? value : null;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = sortObjectKeys(value[key]);
      return result;
    }, {});
  }
  return value;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function renderSnapshotStatus(snapshot) {
  const target = document.getElementById("snapshotStatus");
  target.className = "status";
  target.innerHTML =
    `<strong>Snapshot OK</strong><br>` +
    `Projekt: ${escapeHtml(snapshot.project.projectCode)} / V${snapshot.project.projectVersion}<br>` +
    `Võtmeid: ${snapshot.generated.keys.length}, südamikke: ${snapshot.generated.cylinders.length}<br>` +
    `SHA-256: <span class="code">${snapshot.integrity.checksum.slice(0, 16)}…</span>`;
}

function renderSnapshotError(error) {
  const target = document.getElementById("snapshotStatus");
  target.className = "error";
  target.textContent = `Snapshoti viga: ${error.message}`;
}

function downloadSnapshot(snapshot) {
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeCode = snapshot.project.projectCode.replace(/[^A-Za-z0-9_-]/g, "_");
  link.href = url;
  link.download = `${safeCode}_V${snapshot.project.projectVersion}_snapshot.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
