// =====================================================
// ABUS SFA 777 Sarjastamise Generaator
// V1.0.4 Security Fix Stable
// =====================================================

// ===== PROFILE =====
const ACTIVE_PROFILE = {
  name: "ABUS SFA 777",
  channels: 6,
  minDepth: 0,
  maxDepth: 9,
  maxMasterPins: 2
};

// ===== QUALITY RULES =====
const QUALITY_RULES = {
  RULE_1_MIN_UNIQUE_DEPTHS: 4,
  RULE_2_MAX_DUPLICATES: 2,
  RULE_3_MACS: 4,
  RULE_4_AVOID_FIRST_DEPTH_9: true,
  RULE_5_AVOID_88: true,
  RULE_6_AVOID_99: true,
  RULE_7_AVOID_SIMPLE_PATTERNS: true,
  RULE_8_PREFER_LOW_BASE_DEPTHS: true,
  RULE_9_AVOID_BASE_ABOVE_7: true,
  RULE_10_PREFER_REAR_MASTER_PINS: true,
  RULE_11_REKEY_MIN_DIFFERENCE: 2,
  RULE_12_RESERVE_FOR_REKEY: true,
  RULE_13_NO_UPCUT_TO_HIGHER_LEVEL: true
};

// ===== STATE =====
let masterData = { keys: [], keyQuantities: [], doors: [], matrix: [] };
let importWarnings = [];
let keyCodes = {};
let pinnings = [];
let keyHierarchy = [];
let projectLocked = false;
let projectInfo = { projectCode: "", orderNumber: "" };

// ===== APP INIT =====
document.addEventListener("DOMContentLoaded", () => {
  const health = document.getElementById("appHealth");
  if (typeof XLSX === "undefined") {
    health.className = "error";
    health.textContent = "Exceli mootor ei laadinud. Kontrolli internetiühendust ja laadi leht uuesti.";
  } else {
    health.className = "status";
    health.textContent = "V1.0.4 Stable • Security Fix • Exceli mootor valmis";
  }

  document.getElementById("loadBtn").addEventListener("click", loadExcel);
  document.getElementById("generateSystemBtn").addEventListener("click", generateSystem);
  document.getElementById("generateProjectCodeBtn").addEventListener("click", generateProjectCode);
  document.getElementById("projectCode").addEventListener("input", updateProjectInfo);
  document.getElementById("orderNumber").addEventListener("input", updateProjectInfo);
  document.getElementById("confirmProjectBtn").addEventListener("click", confirmProject);
  document.getElementById("printProjectBtn").addEventListener("click", printProject);
});

// ===== PROJECT MODULE =====
function generateProjectCode() {
  if (projectLocked) {
    alert("Projekt on kinnitatud.");
    return;
  }

  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateKey = `${yy}${mm}${dd}`;
  const storageKey = `projectCounter_${dateKey}`;

  let counter = parseInt(localStorage.getItem(storageKey) || "0", 10);
  counter++;
  localStorage.setItem(storageKey, String(counter));

  const sequence = String(counter).padStart(3, "0");
  const code = `LE-EST-${dateKey}-${sequence}`;

  document.getElementById("projectCode").value = code;
  updateProjectInfo();
}

function updateProjectInfo() {
  projectInfo.projectCode = document.getElementById("projectCode").value.trim();
  projectInfo.orderNumber = document.getElementById("orderNumber").value.trim();

  const target = document.getElementById("projectInfo");
  if (!projectInfo.projectCode) {
    target.innerHTML = "Projekt puudub";
    return;
  }

  target.innerHTML =
    `<strong>Projekt:</strong> ${escapeHtml(projectInfo.projectCode)}<br>` +
    `<strong>Tellimus:</strong> ${projectInfo.orderNumber ? escapeHtml(projectInfo.orderNumber) : "-"}`;
}

function confirmProject() {
  updateProjectInfo();

  if (!projectInfo.projectCode) {
    alert("Projektikood puudub.");
    return;
  }

  if (Object.keys(keyCodes).length === 0 || pinnings.length === 0) {
    alert("Koodid pole veel genereeritud.");
    return;
  }

  if (projectLocked) {
    alert("Projekt on juba kinnitatud.");
    return;
  }

  projectLocked = true;
  document.getElementById("projectStatus").innerHTML = "Staatus: <strong>KINNITATUD</strong>";
  document.getElementById("generateSystemBtn").disabled = true;
  document.getElementById("confirmProjectBtn").disabled = true;
  document.getElementById("printProjectBtn").disabled = false;
  document.getElementById("projectCode").disabled = true;
  document.getElementById("orderNumber").disabled = true;
  document.getElementById("standardPinsInput").disabled = true;
  document.getElementById("masterPinsInput").disabled = true;
  document.getElementById("excelFile").disabled = true;
  document.getElementById("loadBtn").disabled = true;
  document.getElementById("generateProjectCodeBtn").disabled = true;

  alert("Projekt kinnitati.");
}


function printProject() {
  if (!projectLocked) {
    alert("Projekt tuleb enne trükkimist kinnitada.");
    return;
  }

  if (Object.keys(keyCodes).length === 0 || pinnings.length === 0) {
    alert("Trükitavaid koode ei ole.");
    return;
  }

  window.print();
}

// ===== EXCEL MODULE =====
function loadExcel() {
  if (projectLocked) {
    alert("Projekt on kinnitatud.");
    return;
  }

  const fileInput = document.getElementById("excelFile");
  if (!fileInput.files.length) {
    alert("Vali Excel fail!");
    return;
  }

  if (typeof XLSX === "undefined") {
    alert("XLSX teek ei ole laetud.");
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

      parseSimpleMatrix(rows);
      keyCodes = {};
      pinnings = [];
      keyHierarchy = calculateKeyHierarchy();

      renderValidation();
      renderHierarchy();
      renderMatrix();
      renderKeyCodes();
      renderPinnings();
    } catch (error) {
      console.error(error);
      alert("Exceli lugemisel tekkis viga. Vaata Console akent.");
    }
  };

  reader.readAsArrayBuffer(file);
}

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}


function formatQuantity(qty) {
  return qty === null || qty === undefined ? "–" : String(qty);
}
function parseSimpleMatrix(rows) {
  importWarnings = [];

  const headerRow = rows[0] || [];
  const secondRow = rows[1] || [];

  // V1.0.2 preferred format:
  // A1 = Ruum / Tähis, B1 = blank, C1... = key names
  // A2 = blank, B2 = "kogus", C2... = key quantities
  // A3... = doors, B3... = cylinder quantities, C3... = X matrix
  const quantityMarker = cleanText(secondRow[1]).toLowerCase();
  const preferredQuantityLayout = ["kogus", "tk", "quantity", "qty"].includes(quantityMarker);

  // Backward compatibility: old layout with B1 = Kogus
  const oldQuantityHeader = cleanText(headerRow[1]).toLowerCase();
  const legacyQuantityColumn = ["kogus", "tk", "quantity", "qty"].includes(oldQuantityHeader);

  const hasQuantityColumn = preferredQuantityLayout || legacyQuantityColumn;
  const firstKeyColumn = hasQuantityColumn ? 2 : 1;
  const keyColumns = [];

  for (let c = firstKeyColumn; c < headerRow.length; c++) {
    const keyName = cleanText(headerRow[c]);
    if (keyName) keyColumns.push({ name: keyName, column: c });
  }

  const keys = keyColumns.map(item => item.name);
  const keyQuantities = keyColumns.map(() => null);

  let firstDoorRow = 1;

  // Preferred V1.0.2 quantity row: B2 = "kogus"
  if (preferredQuantityLayout) {
    keyColumns.forEach((item, index) => {
      const raw = cleanText(secondRow[item.column]);
      if (raw === "") return;
      const qty = Number(raw.replace(",", "."));
      if (Number.isInteger(qty) && qty >= 0) {
        keyQuantities[index] = qty;
      } else {
        importWarnings.push(`Võtme "${item.name}" kogus "${raw}" ei ole korrektne. Lubatud on 0 või positiivne täisarv.`);
      }
    });
    firstDoorRow = 2;
  } else {
    // Legacy V1.0.1 quantity row: A2 = "Võtmete kogus"
    const quantityRowLabel = cleanText(secondRow[0]).toLowerCase();
    const legacyKeyQuantityRow = [
      "võtmete kogus",
      "votmete kogus",
      "võtmete arv",
      "votmete arv",
      "key quantity",
      "key qty"
    ].includes(quantityRowLabel);

    if (legacyKeyQuantityRow) {
      keyColumns.forEach((item, index) => {
        const raw = cleanText(secondRow[item.column]);
        if (raw === "") return;
        const qty = Number(raw.replace(",", "."));
        if (Number.isInteger(qty) && qty >= 0) {
          keyQuantities[index] = qty;
        } else {
          importWarnings.push(`Võtme "${item.name}" kogus "${raw}" ei ole korrektne. Lubatud on 0 või positiivne täisarv.`);
        }
      });
      firstDoorRow = 2;
    }
  }

  const doors = [];
  const matrix = [];

  for (let r = firstDoorRow; r < rows.length; r++) {
    const row = rows[r] || [];
    const doorName = cleanText(row[0]);
    if (!doorName) continue;

    const openings = keyColumns.map(item => {
      return cleanText(row[item.column]).toLowerCase() === "x";
    });

    let quantity = null;
    if (hasQuantityColumn) {
      const rawQty = cleanText(row[1]);
      if (rawQty !== "") {
        const parsedQty = Number(rawQty.replace(",", "."));
        if (Number.isInteger(parsedQty) && parsedQty >= 0) {
          quantity = parsedQty;
        } else {
          importWarnings.push(`Südamiku "${doorName}" kogus "${rawQty}" ei ole korrektne. Lubatud on 0 või positiivne täisarv.`);
        }
      }
    }

    doors.push(doorName);
    matrix.push({ door: doorName, quantity, openings });
  }

  masterData = { keys, keyQuantities, doors, matrix };
}

// ===== VALIDATION / HIERARCHY =====
function validateMatrix() {
  const errors = [];
  const warnings = [];

  if (masterData.keys.length === 0) errors.push("Võtmeid ei leitud.");
  if (masterData.doors.length === 0) errors.push("Uksi ei leitud.");

  masterData.matrix.forEach(row => {
    const hasOpening = row.openings.some(Boolean);

    if (!hasOpening) {
      warnings.push(`Uksel "${row.door}" puudub avav võti. Rida jäetakse genereerimisest välja.`);
      return;
    }

    if (row.quantity === null || row.quantity === undefined) {
      errors.push(`Südamiku "${row.door}" kogus puudub. Kui see on reserv, märgi koguseks 0.`);
    }
  });

  masterData.keys.forEach((key, keyIndex) => {
    const isUsed = masterData.matrix.some(row => row.openings[keyIndex]);
    if (isUsed && (masterData.keyQuantities[keyIndex] === null || masterData.keyQuantities[keyIndex] === undefined)) {
      errors.push(`Võtme "${key}" kogus puudub. Kui see on reserv, märgi koguseks 0.`);
    }
  });

  warnings.push(...importWarnings);
  return { errors, warnings };
}

function calculateKeyHierarchy() {
  const items = masterData.keys.map((key, keyIndex) => {
    const openedDoorIndexes = masterData.matrix
      .map((row, rowIndex) => row.openings[keyIndex] ? rowIndex : null)
      .filter(rowIndex => rowIndex !== null);

    return {
      key,
      keyIndex,
      openedCount: openedDoorIndexes.length,
      openedDoorIndexes,
      openedDoors: openedDoorIndexes.map(rowIndex => masterData.matrix[rowIndex].door),
      level: null
    };
  });

  const memo = new Map();

  function calculateLevel(item) {
    if (memo.has(item.keyIndex)) return memo.get(item.keyIndex);

    const higherKeys = items.filter(candidate =>
      candidate.keyIndex !== item.keyIndex &&
      isStrictSubset(item.openedDoorIndexes, candidate.openedDoorIndexes)
    );

    const level = higherKeys.length === 0
      ? 1
      : 1 + Math.max(...higherKeys.map(calculateLevel));

    memo.set(item.keyIndex, level);
    return level;
  }

  items.forEach(item => {
    item.level = calculateLevel(item);
  });

  items.sort((a, b) =>
    a.level - b.level ||
    b.openedCount - a.openedCount ||
    a.key.localeCompare(b.key)
  );

  return items;
}

function isStrictSubset(lowerSetValues, higherSetValues) {
  if (lowerSetValues.length >= higherSetValues.length) return false;
  const higher = new Set(higherSetValues);
  return lowerSetValues.every(value => higher.has(value));
}

function keyHasStrictlyHigherRights(higherKeyName, lowerKeyName) {
  const higherIndex = masterData.keys.indexOf(higherKeyName);
  const lowerIndex = masterData.keys.indexOf(lowerKeyName);
  if (higherIndex < 0 || lowerIndex < 0 || higherIndex === lowerIndex) return false;

  const higherRights = [];
  const lowerRights = [];

  masterData.matrix.forEach((row, rowIndex) => {
    if (row.openings[higherIndex]) higherRights.push(rowIndex);
    if (row.openings[lowerIndex]) lowerRights.push(rowIndex);
  });

  return isStrictSubset(lowerRights, higherRights);
}

function canBeUpcutToHigherKey(lowerCode, higherCode) {
  if (!Array.isArray(lowerCode) || !Array.isArray(higherCode)) return false;
  if (lowerCode.length !== higherCode.length) return false;

  let hasDeeperCut = false;

  for (let i = 0; i < lowerCode.length; i++) {
    if (higherCode[i] < lowerCode[i]) return false;
    if (higherCode[i] > lowerCode[i]) hasDeeperCut = true;
  }

  return hasDeeperCut;
}

function createsUpcutRiskForKey(lowerKeyName, lowerCandidate, selectedCodes) {
  if (!QUALITY_RULES.RULE_13_NO_UPCUT_TO_HIGHER_LEVEL) return false;

  for (const [higherKeyName, higherCode] of Object.entries(selectedCodes)) {
    if (!keyHasStrictlyHigherRights(higherKeyName, lowerKeyName)) continue;
    if (canBeUpcutToHigherKey(lowerCandidate, higherCode)) return true;
  }

  return false;
}

function verifyNoUpcutPrivilegeEscalation(codes) {
  if (!QUALITY_RULES.RULE_13_NO_UPCUT_TO_HIGHER_LEVEL) return { ok: true };

  for (const lowerKey of masterData.keys) {
    if (!codes[lowerKey]) continue;

    for (const higherKey of masterData.keys) {
      if (higherKey === lowerKey || !codes[higherKey]) continue;
      if (!keyHasStrictlyHigherRights(higherKey, lowerKey)) continue;

      if (canBeUpcutToHigherKey(codes[lowerKey], codes[higherKey])) {
        return {
          ok: false,
          lowerKey,
          higherKey,
          reason: `"${lowerKey}" on võimalik üle freesida kõrgema õigusega võtmeks "${higherKey}".`
        };
      }
    }
  }

  return { ok: true };
}

function renderValidation() {
  const target = document.getElementById("validationBox");
  const check = validateMatrix();

  if (masterData.keys.length === 0 && masterData.doors.length === 0) {
    target.innerHTML = "Pole veel kontrollitud...";
    return;
  }

  let html = check.errors.length === 0
    ? `<div class="status">Kontroll OK. Tõsiseid vigu ei leitud.</div>`
    : `<div class="error">Leiti vead:</div>`;

  check.errors.forEach(error => {
    html += `<div class="error">${escapeHtml(error)}</div>`;
  });

  if (check.warnings.length > 0) {
    html += `<div class="warning">Hoiatused (${check.warnings.length}):</div>`;
    check.warnings.forEach(warning => {
      html += `<div class="warning">${escapeHtml(warning)}</div>`;
    });
  }

  target.innerHTML = html;
}

function renderHierarchy() {
  const target = document.getElementById("hierarchyBox");
  if (!keyHierarchy.length) {
    target.innerHTML = "Pole veel arvutatud...";
    return;
  }

  let html = `<div class="status">Võtmed järjestatud avamisõiguste tugevuse järgi.</div>`;
  html += `<table><thead><tr><th>Jrk</th><th>Võti</th><th>Kogus</th><th>Tehniline tase</th><th>Avab uksi</th><th>Avatavad uksed</th></tr></thead><tbody>`;

  keyHierarchy.forEach((item, index) => {
    const rowClass = item.level === 1 ? "level-1" : item.level === 2 ? "level-2" : "";
    html += `<tr class="${rowClass}">`;
    html += `<td>${index + 1}</td>`;
    html += `<td>${escapeHtml(item.key)}</td>`;
    const keyIndex = masterData.keys.indexOf(item.key);
    html += `<td>${formatQuantity(masterData.keyQuantities[keyIndex])} tk</td>`;
    html += `<td>Tase ${item.level}</td>`;
    html += `<td>${item.openedCount}</td>`;
    html += `<td>${item.openedDoors.map(escapeHtml).join(", ")}</td>`;
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  target.innerHTML = html;
}

// ===== PIN SETTINGS =====
function parsePinListFromInput(inputId, min, max) {
  const raw = document.getElementById(inputId).value;
  return [...new Set(raw
    .split(",")
    .map(v => parseInt(v.trim(), 10))
    .filter(v => !Number.isNaN(v) && v >= min && v <= max))]
    .sort((a, b) => a - b);
}

function getAllowedStandardPins() {
  return parsePinListFromInput("standardPinsInput", ACTIVE_PROFILE.minDepth, ACTIVE_PROFILE.maxDepth);
}

function getAllowedMasterPins() {
  return parsePinListFromInput("masterPinsInput", 2, 8);
}

// ===== GENERATOR =====
function generateSystem() {
  if (projectLocked) {
    alert("Projekt on kinnitatud. Uut süsteemi ei saa samas projektis genereerida.");
    return;
  }

  updateProjectInfo();
  if (!projectInfo.projectCode) {
    alert("Palun sisesta või genereeri projektikood.");
    return;
  }

  if (masterData.keys.length === 0) {
    alert("Loe enne Excel sisse.");
    return;
  }

  const matrixCheck = validateMatrix();
  if (matrixCheck.errors.length > 0) {
    renderValidation();
    alert("Sarjatabelis on viga. Paranda enne genereerimist.");
    return;
  }

  const allowedStandardPins = getAllowedStandardPins();
  const allowedMasterPins = getAllowedMasterPins();

  if (allowedStandardPins.length === 0) {
    alert("Sisesta vähemalt üks lubatud tavamuuk.");
    return;
  }

  if (allowedMasterPins.length === 0) {
    alert("Sisesta vähemalt üks lubatud sarjamuuk.");
    return;
  }

  const fullMasterKey = findFullMasterKey();
  let result = null;

  for (let attempt = 0; attempt < 1500; attempt++) {
    let codes;

    if (fullMasterKey) {
      codes = createMasterBasedKeyCodes(allowedStandardPins, allowedMasterPins, fullMasterKey.key);
    } else {
      const chains = createChannelChains(allowedStandardPins, allowedMasterPins);
      codes = createSystemBasedKeyCodes(chains);
    }

    if (!codes) continue;

    const securityResult = verifyNoUpcutPrivilegeEscalation(codes);
    if (!securityResult.ok) continue;

    const pinningResult = calculateAllPinnings(codes, allowedStandardPins, allowedMasterPins);
    if (!pinningResult.ok) continue;

    const verifyResult = verifySystem(codes, pinningResult.pinnings);
    if (!verifyResult.ok) continue;

    result = { codes, pinnings: pinningResult.pinnings };
    break;
  }

  if (!result) {
    keyCodes = {};
    pinnings = [];
    renderKeyCodes();
    renderPinnings();
    alert("Lahendust ei leitud. Praegune V1.0 mootor võib suurte süsteemide korral vajada lõdvemaid reegleid või Capacity-loogikat.");
    return;
  }

  keyCodes = result.codes;
  pinnings = result.pinnings;
  renderKeyCodes();
  renderPinnings();
}

function findFullMasterKey() {
  const lockableDoors = masterData.matrix.filter(row => row.openings.some(Boolean));
  const totalLockableDoors = lockableDoors.length;
  return keyHierarchy.find(item => item.openedCount === totalLockableDoors) || null;
}

function createMasterBasedKeyCodes(allowedStandardPins, allowedMasterPins, masterKeyName) {
  const minMasterPin = Math.min(...allowedMasterPins);
  let usableBasePins = allowedStandardPins.filter(pin => {
    if (QUALITY_RULES.RULE_9_AVOID_BASE_ABOVE_7 && pin > 7) return false;
    return pin + minMasterPin <= ACTIVE_PROFILE.maxDepth;
  });

  if (usableBasePins.length === 0) usableBasePins = [...allowedStandardPins];

  for (let attempt = 0; attempt < 800; attempt++) {
    const baseCode = createRandomBaseCode(usableBasePins);
    if (!isValidKeyCode(baseCode)) continue;

    const selected = { [masterKeyName]: baseCode };
    const used = new Set([baseCode.join("")]);
    const usedDiffCounts = {};
    const variants = buildMasterKeyVariants(baseCode, allowedMasterPins);

    const otherKeys = keyHierarchy
      .filter(item => item.key !== masterKeyName && item.openedCount > 0)
      .sort((a, b) => a.level - b.level || b.openedCount - a.openedCount || a.key.localeCompare(b.key));

    let ok = true;
    for (const item of otherKeys) {
      const validVariants = variants.filter(code =>
        !used.has(code.join("")) &&
        isValidKeyCode(code) &&
        !createsUpcutRiskForKey(item.key, code, selected)
      );
      if (validVariants.length === 0) {
        ok = false;
        break;
      }

      validVariants.sort((a, b) =>
        scoreVariantForNewSystem(baseCode, a, usedDiffCounts) -
        scoreVariantForNewSystem(baseCode, b, usedDiffCounts)
      );

      const next = validVariants[0];
      selected[item.key] = next;
      used.add(next.join(""));
      registerUsedDiffs(baseCode, next, usedDiffCounts);
    }

    if (ok) return selected;
  }

  return null;
}

function registerUsedDiffs(masterCode, candidate, usedDiffCounts) {
  for (let i = 0; i < masterCode.length; i++) {
    const diff = Math.abs(candidate[i] - masterCode[i]);
    if (diff > 0) usedDiffCounts[diff] = (usedDiffCounts[diff] || 0) + 1;
  }
}

function scoreVariantForNewSystem(masterCode, candidate, usedDiffCounts) {
  let changedChannels = 0;
  let frontPenalty = 0;
  let diversityPenalty = 0;
  let preferredMiddlePenalty = 0;

  for (let i = 0; i < masterCode.length; i++) {
    const diff = Math.abs(candidate[i] - masterCode[i]);
    if (diff > 0) {
      changedChannels++;
      frontPenalty += ACTIVE_PROFILE.channels - i;
      diversityPenalty += (usedDiffCounts[diff] || 0) * 350;
      preferredMiddlePenalty += Math.abs(diff - 4) * 25;
    }
  }

  return changedChannels * 1000 + frontPenalty * 20 + diversityPenalty + preferredMiddlePenalty + Math.random() * 20;
}

function createRandomBaseCode(usableBasePins) {
  const code = [];
  for (let i = 0; i < ACTIVE_PROFILE.channels; i++) {
    code.push(usableBasePins[randomInt(0, usableBasePins.length - 1)]);
  }
  return code;
}

function buildMasterKeyVariants(masterCode, allowedMasterPins) {
  const variants = [];
  const rearFirstChannels = [5, 4, 3, 2, 1, 0];
  const sortedMasterPins = [...allowedMasterPins].sort((a, b) => a - b);

  for (const pin of sortedMasterPins) {
    for (const channel of rearFirstChannels) {
      addVariantIfValid(variants, masterCode, [{ channel, pin, direction: 1 }]);
      addVariantIfValid(variants, masterCode, [{ channel, pin, direction: -1 }]);
    }
  }

  for (const pin of sortedMasterPins) {
    for (let i = 0; i < rearFirstChannels.length; i++) {
      for (let j = i + 1; j < rearFirstChannels.length; j++) {
        const ch1 = rearFirstChannels[i];
        const ch2 = rearFirstChannels[j];
        for (const [d1, d2] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
          addVariantIfValid(variants, masterCode, [
            { channel: ch1, pin, direction: d1 },
            { channel: ch2, pin, direction: d2 }
          ]);
        }
      }
    }
  }

  for (let i = 0; i < rearFirstChannels.length; i++) {
    for (let j = i + 1; j < rearFirstChannels.length; j++) {
      const ch1 = rearFirstChannels[i];
      const ch2 = rearFirstChannels[j];
      for (const pin1 of sortedMasterPins) {
        for (const pin2 of sortedMasterPins) {
          for (const [d1, d2] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
            addVariantIfValid(variants, masterCode, [
              { channel: ch1, pin: pin1, direction: d1 },
              { channel: ch2, pin: pin2, direction: d2 }
            ]);
          }
        }
      }
    }
  }

  const unique = [];
  const seen = new Set();
  for (const code of variants) {
    const text = code.join("");
    if (!seen.has(text)) {
      seen.add(text);
      unique.push(code);
    }
  }

  unique.sort((a, b) => scoreMasterVariant(masterCode, a) - scoreMasterVariant(masterCode, b));
  return unique;
}

function addVariantIfValid(variants, masterCode, changes) {
  const candidate = [...masterCode];
  for (const change of changes) {
    candidate[change.channel] = masterCode[change.channel] + change.pin * change.direction;
  }

  if (candidate.some(value => value < ACTIVE_PROFILE.minDepth || value > ACTIVE_PROFILE.maxDepth)) return;
  variants.push(candidate);
}

function scoreMasterVariant(masterCode, candidate) {
  let changedChannels = 0;
  let frontPenalty = 0;
  const usedDiffs = [];

  for (let i = 0; i < masterCode.length; i++) {
    const diff = Math.abs(candidate[i] - masterCode[i]);
    if (diff > 0) {
      changedChannels++;
      usedDiffs.push(diff);
      frontPenalty += ACTIVE_PROFILE.channels - i;
    }
  }

  const averageDiff = usedDiffs.length ? usedDiffs.reduce((sum, n) => sum + n, 0) / usedDiffs.length : 0;
  return changedChannels * 1000 + frontPenalty * 20 + Math.abs(averageDiff - 4) * 30 + Math.random() * 10;
}

function createChannelChains(allowedStandardPins, allowedMasterPins) {
  const chains = [];

  for (let ch = 0; ch < ACTIVE_PROFILE.channels; ch++) {
    let chain = null;
    for (let attempt = 0; attempt < 150; attempt++) {
      const base = allowedStandardPins[randomInt(0, allowedStandardPins.length - 1)];
      const m1 = allowedMasterPins[randomInt(0, allowedMasterPins.length - 1)];
      const m2 = allowedMasterPins[randomInt(0, allowedMasterPins.length - 1)];
      const values = [base];
      let current = base;

      for (const m of [m1, m2]) {
        current += m;
        if (current <= ACTIVE_PROFILE.maxDepth) values.push(current);
      }

      if (values.length >= 2 && values.length <= ACTIVE_PROFILE.maxMasterPins + 1) {
        chain = values;
        break;
      }
    }

    chains.push(chain || [allowedStandardPins[0]]);
  }

  return chains;
}

function createSystemBasedKeyCodes(chains) {
  const allCodes = [];

  function build(pos, current) {
    if (pos === ACTIVE_PROFILE.channels) {
      if (isValidKeyCode(current)) allCodes.push([...current]);
      return;
    }
    for (const value of chains[pos]) {
      current.push(value);
      build(pos + 1, current);
      current.pop();
    }
  }

  build(0, []);
  allCodes.sort((a, b) => scoreKeyCode(a) - scoreKeyCode(b));

  const selected = {};
  const used = new Set();
  const orderedKeys = [...keyHierarchy]
    .filter(item => item.openedCount > 0)
    .sort((a, b) =>
      a.level - b.level ||
      b.openedCount - a.openedCount ||
      a.key.localeCompare(b.key)
    );

  for (const item of orderedKeys) {
    const next = allCodes.find(code =>
      !used.has(code.join("")) &&
      !createsUpcutRiskForKey(item.key, code, selected)
    );
    if (!next) return null;
    selected[item.key] = next;
    used.add(next.join(""));
  }

  return selected;
}

// ===== QUALITY ENGINE =====
function scoreKeyCode(code) {
  let score = code.reduce((sum, n) => sum + n, 0);
  for (let i = 0; i < code.length - 1; i++) score += Math.abs(code[i] - code[i + 1]);
  if (QUALITY_RULES.RULE_4_AVOID_FIRST_DEPTH_9 && code[0] === 9) score += 1000;
  return score;
}

function isValidKeyCode(code) {
  return hasMacsOk(code) &&
    hasEnoughUniqueDepths(code) &&
    hasNoDepthOverused(code) &&
    !hasSimplePattern(code) &&
    !hasMechanicalRiskPattern(code);
}

function hasMacsOk(code) {
  for (let i = 0; i < code.length - 1; i++) {
    if (Math.abs(code[i] - code[i + 1]) > QUALITY_RULES.RULE_3_MACS) return false;
  }
  return true;
}

function hasEnoughUniqueDepths(code) {
  return new Set(code).size >= QUALITY_RULES.RULE_1_MIN_UNIQUE_DEPTHS;
}

function hasNoDepthOverused(code) {
  const counts = {};
  for (const n of code) {
    counts[n] = (counts[n] || 0) + 1;
    if (counts[n] > QUALITY_RULES.RULE_2_MAX_DUPLICATES) return false;
  }
  return true;
}

function hasSimplePattern(code) {
  if (!QUALITY_RULES.RULE_7_AVOID_SIMPLE_PATTERNS) return false;
  const text = code.join("");
  return ["012345","123456","234567","345678","654321","543210","010210","012012","001122","111234","987654","876543"].includes(text);
}

function hasMechanicalRiskPattern(code) {
  if (QUALITY_RULES.RULE_4_AVOID_FIRST_DEPTH_9 && code[0] === 9) return true;
  for (let i = 0; i < code.length - 1; i++) {
    if (QUALITY_RULES.RULE_5_AVOID_88 && code[i] === 8 && code[i + 1] === 8) return true;
    if (QUALITY_RULES.RULE_6_AVOID_99 && code[i] === 9 && code[i + 1] === 9) return true;
  }
  return false;
}

// ===== PINNING ENGINE =====
function calculateAllPinnings(codes, allowedStandardPins, allowedMasterPins) {
  const result = [];

  for (const row of masterData.matrix) {
    const openingKeys = [];
    row.openings.forEach((opens, index) => {
      if (opens && codes[masterData.keys[index]]) openingKeys.push(masterData.keys[index]);
    });

    if (openingKeys.length === 0) continue;
    const channels = [];

    for (let ch = 0; ch < ACTIVE_PROFILE.channels; ch++) {
      const uniqueValues = [...new Set(openingKeys.map(key => codes[key][ch]))].sort((a, b) => a - b);

      if (uniqueValues.length > ACTIVE_PROFILE.maxMasterPins + 1) return { ok: false, reason: "Liiga palju väärtusi ühes kanalis" };

      const base = uniqueValues[0];
      if (!allowedStandardPins.includes(base)) return { ok: false, reason: "Vajalik tavamuuk pole lubatud" };
      if (QUALITY_RULES.RULE_9_AVOID_BASE_ABOVE_7 && base > 7) return { ok: false, reason: "Tavamuuk üle 7" };

      const masters = [];
      for (let i = 1; i < uniqueValues.length; i++) {
        const diff = uniqueValues[i] - uniqueValues[i - 1];
        if (!allowedMasterPins.includes(diff)) return { ok: false, reason: "Vajalik sarjamuuk pole lubatud" };
        masters.push(diff);
      }

      const total = base + masters.reduce((sum, n) => sum + n, 0);
      if (total > ACTIVE_PROFILE.maxDepth) return { ok: false, reason: "Muugisumma üle 9" };

      channels.push({ base, masters });
    }

    result.push({ door: row.door, opensBy: openingKeys, channels });
  }

  if (result.length === 0) return { ok: false, reason: "Ühtegi lukustatavat ust ei leitud." };
  return { ok: true, pinnings: result };
}

function verifySystem(codes, pinningList) {
  for (const pinning of pinningList) {
    for (const key of masterData.keys) {
      if (!codes[key]) continue;
      const shouldOpen = pinning.opensBy.includes(key);
      const doesOpen = keyOpensPinning(codes[key], pinning);
      if (shouldOpen !== doesOpen) return { ok: false, door: pinning.door, key };
    }
  }
  return { ok: true };
}

function keyOpensPinning(code, pinning) {
  for (let ch = 0; ch < ACTIVE_PROFILE.channels; ch++) {
    const channel = pinning.channels[ch];
    const allowedValues = [channel.base];
    let current = channel.base;
    for (const master of channel.masters) {
      current += master;
      allowedValues.push(current);
    }
    if (!allowedValues.includes(code[ch])) return false;
  }
  return true;
}

// ===== RENDERING =====
function renderMatrix() {
  const target = document.getElementById("matrixTable");
  if (masterData.keys.length === 0) {
    target.innerHTML = "Pole veel loetud...";
    return;
  }

  const totalKeys = masterData.keyQuantities.reduce((sum, qty) => sum + (Number.isInteger(qty) ? qty : 0), 0);
  const totalCylinders = masterData.matrix.reduce((sum, row) => sum + (Number.isInteger(row.quantity) ? row.quantity : 0), 0);

  let html = `<div class="status">Leitud võtmetüüpe: ${masterData.keys.length} (${totalKeys} võtit), südamikuridu: ${masterData.doors.length} (${totalCylinders} südamikku)</div>`;
  html += `<table><thead><tr><th>Uks \ Võti</th><th>Südamikke</th>`;
  masterData.keys.forEach((key, index) => {
    html += `<th>${escapeHtml(key)}<br><small>${formatQuantity(masterData.keyQuantities[index])} tk</small></th>`;
  });
  html += `</tr></thead><tbody>`;

  masterData.matrix.forEach(row => {
    const cylinderQtyText = row.openings.some(Boolean)
      ? `${formatQuantity(row.quantity)} tk`
      : "ei lukustata";
    html += `<tr><td>${escapeHtml(row.door)}</td><td>${cylinderQtyText}</td>`;
    row.openings.forEach(isOpen => html += isOpen ? `<td class="open-cell">X</td>` : `<td></td>`);
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  target.innerHTML = html;
}

function renderKeyCodes() {
  const target = document.getElementById("keyCodesBox");
  const keys = Object.keys(keyCodes);
  if (keys.length === 0) {
    target.innerHTML = "Pole veel genereeritud...";
    return;
  }

  const totalKeys = keys.reduce((sum, key) => {
    const keyIndex = masterData.keys.indexOf(key);
    return sum + (Number.isInteger(masterData.keyQuantities[keyIndex]) ? masterData.keyQuantities[keyIndex] : 0);
  }, 0);

  let html = `<div class="status">Võtmekoodid genereeritud: ${keys.length} tüüpi / ${totalKeys} võtit</div>`;
  html += `<table><thead><tr><th>Võti</th><th>Kogus</th><th>Kood</th></tr></thead><tbody>`;
  keys.forEach(key => {
    const keyIndex = masterData.keys.indexOf(key);
    const qty = formatQuantity(masterData.keyQuantities[keyIndex]);
    html += `<tr><td>${escapeHtml(key)}</td><td>${qty} tk</td><td class="code">${keyCodes[key].join("")}</td></tr>`;
  });
  html += `</tbody></table>`;
  target.innerHTML = html;
}

function renderPinnings() {
  const target = document.getElementById("pinningBox");
  if (pinnings.length === 0) {
    target.innerHTML = "Pole veel genereeritud...";
    return;
  }

  let html = `<div class="status">Projekt: ${escapeHtml(projectInfo.projectCode || "-")}<br>Südamike koodid genereeritud: ${pinnings.length}. Ristiavamise kontroll: OK.</div>`;

  pinnings.forEach((pinning, index) => {
    const sourceRow = masterData.matrix.find(row => row.door === pinning.door);
    const qty = sourceRow ? formatQuantity(sourceRow.quantity) : "–";
    html += `<div class="pinning-card"><div class="pinning-title">#${index + 1} ${escapeHtml(pinning.door)} — ${qty} tk</div><table><tbody>`;
    html += `<tr><th>Tava</th>`;
    pinning.channels.forEach(ch => html += `<td>${ch.base}</td>`);
    html += `</tr>`;

    for (let level = 0; level < ACTIVE_PROFILE.maxMasterPins; level++) {
      html += `<tr><th>s${level + 1}</th>`;
      pinning.channels.forEach(ch => html += `<td>${ch.masters[level] !== undefined ? ch.masters[level] : ""}</td>`);
      html += `</tr>`;
    }

    html += `</tbody></table><div><strong>Avab:</strong> ${pinning.opensBy.map(escapeHtml).join(", ")}</div></div>`;
  });

  target.innerHTML = html;
}

// ===== HELPERS =====
function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
