const REKEY_APP_VERSION = "1.2.0-alpha.1";

let rekeySourceProject = null;
let rekeyCandidateSnapshot = null;

window.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("rekeyKeySelect");
  const calculateBtn = document.getElementById("calculateRekeyBtn");
  const saveBtn = document.getElementById("saveRekeyBtn");

  calculateBtn.addEventListener("click", async () => {
    if (!rekeySourceProject?.snapshot) {
      renderRekeyError("Rekey arvutamine ebaõnnestus: ava enne serverist projekt.");
      return;
    }

    const keyId = select.value;
    if (!keyId) {
      renderRekeyError("Rekey arvutamine ebaõnnestus: vali kadunud võti.");
      return;
    }

    calculateBtn.disabled = true;
    saveBtn.disabled = true;
    rekeyCandidateSnapshot = null;
    renderRekeyStatus("Arvutan minimaalset ohutut Rekey lahendust...");
    document.getElementById("rekeyResult").innerHTML = "";

    try {
      const result = await calculateRekey(rekeySourceProject.snapshot, keyId);
      rekeyCandidateSnapshot = result.snapshot;
      renderRekeyResult(result);
      saveBtn.textContent = `Salvesta V${result.snapshot.project.projectVersion} serverisse`;
      saveBtn.disabled = false;
    } catch (error) {
      renderRekeyError(error.message || "Rekey arvutamine ebaõnnestus.");
    } finally {
      calculateBtn.disabled = false;
    }
  });

  saveBtn.addEventListener("click", async () => {
    if (!rekeyCandidateSnapshot) {
      renderRekeyError("Rekey salvestamine ebaõnnestus: arvuta enne Rekey lahendus.");
      return;
    }

    saveBtn.disabled = true;
    renderRekeyStatus(
      `Salvestan ${rekeyCandidateSnapshot.project.projectCode} / V${rekeyCandidateSnapshot.project.projectVersion} serverisse...`
    );

    try {
      const result = await saveSnapshotToServer(rekeyCandidateSnapshot);
      validateSaveResponse(result, rekeyCandidateSnapshot);
      renderRekeyStatus(
        `Rekey salvestatud • ID: ${escapeHtml(result.id)} • ${escapeHtml(result.projectCode)} / V${result.projectVersion}`
      );
      await loadProjectList();
    } catch (error) {
      renderRekeyError(
        error.message || "Rekey salvestamine ebaõnnestus: uut projektiversiooni ei salvestatud."
      );
      saveBtn.disabled = false;
    }
  });
});

window.addEventListener("server-project-opened", event => {
  const project = event.detail?.project;
  const latestVersion = Number(event.detail?.latestVersion || project?.projectVersion || 0);
  const isLatestVersion = event.detail?.isLatestVersion !== false;

  if (!project?.snapshot) return;

  rekeySourceProject = isLatestVersion ? project : null;
  rekeyCandidateSnapshot = null;

  const panel = document.getElementById("rekeyPanel");
  const select = document.getElementById("rekeyKeySelect");
  const calculateBtn = document.getElementById("calculateRekeyBtn");
  const saveBtn = document.getElementById("saveRekeyBtn");

  panel.hidden = false;
  saveBtn.disabled = true;
  saveBtn.textContent = "Salvesta uus versioon serverisse";
  document.getElementById("rekeyResult").innerHTML = "";

  if (!isLatestVersion) {
    select.innerHTML = "";
    select.disabled = true;
    calculateBtn.disabled = true;
    document.getElementById("rekeySourceStatus").className = "warning";
    document.getElementById("rekeySourceStatus").textContent =
      "Read-only: V" + project.projectVersion +
      " ei ole enam muudetav. Projekti viimane versioon on V" + latestVersion +
      ". Uus Rekey tuleb teha V" + latestVersion + " pealt.";
    renderRekeyStatus(
      "See versioon on ajalugu ja jääb muutmata. Ava V" + latestVersion + ", et teha järgmine muudatus."
    );
    return;
  }

  select.disabled = false;
  calculateBtn.disabled = false;

  const keys = Array.isArray(project.snapshot.generated?.keys)
    ? project.snapshot.generated.keys
    : [];

  select.innerHTML = keys
    .filter(key => Array.isArray(key.code) && key.code.length > 0)
    .map(key =>
      '<option value="' + escapeHtml(key.id) + '">' +
      escapeHtml(key.name) + " — " + escapeHtml(key.code.join("")) +
      "</option>"
    )
    .join("");

  document.getElementById("rekeySourceStatus").className = "status";
  document.getElementById("rekeySourceStatus").textContent =
    "Projekt: " + project.projectCode + " / V" + project.projectVersion +
    ". Rekey loob uue V" + (project.projectVersion + 1) +
    " versiooni; praegune versioon jääb muutmata.";

  renderRekeyStatus("Vali kadunud võti ja vajuta „Arvuta Rekey“.");
});

async function calculateRekey(sourceSnapshot, lostKeyId) {
  validateRekeySource(sourceSnapshot);

  const generatedKeys = sourceSnapshot.generated.keys;
  const cylinders = sourceSnapshot.generated.cylinders;
  const doors = sourceSnapshot.matrix.doors;

  const lostKey = generatedKeys.find(key => key.id === lostKeyId);
  if (!lostKey) {
    throw new Error("Rekey arvutamine ebaõnnestus: valitud võtit ei leitud projekti snapshotist.");
  }

  const oldCode = [...lostKey.code];
  const affectedDoors = doors.filter(
    door => door.lockable && Array.isArray(door.openBy) && door.openBy.includes(lostKeyId)
  );

  if (affectedDoors.length === 0) {
    throw new Error(`Rekey arvutamine ebaõnnestus: võtmel „${lostKey.name}“ ei ole ühtegi lukustatavat ust.`);
  }

  const cylindersByDoorId = new Map(cylinders.map(cylinder => [cylinder.doorId, cylinder]));
  const codesByKeyId = new Map(generatedKeys.map(key => [key.id, [...key.code]]));
  const existingCodeStrings = new Set(
    generatedKeys.filter(key => key.id !== lostKeyId).map(key => key.code.join(""))
  );

  const candidates = buildRekeyCandidates(oldCode, sourceSnapshot.settings?.qualityRules || {});
  let best = null;
  const failureCounts = {
    quality: 0,
    duplicate: 0,
    pinning: 0,
    rights: 0,
    lostKeyStillOpens: 0,
    upcut: 0
  };

  for (const candidate of candidates) {
    if (existingCodeStrings.has(candidate.join(""))) {
      failureCounts.duplicate++;
      continue;
    }

    if (!isRekeyCodeQualityValid(candidate, sourceSnapshot.settings?.qualityRules || {})) {
      failureCounts.quality++;
      continue;
    }

    const candidateCodes = new Map(codesByKeyId);
    candidateCodes.set(lostKeyId, candidate);

    if (!verifySnapshotNoUpcut(sourceSnapshot, candidateCodes)) {
      failureCounts.upcut++;
      continue;
    }

    const changedCylinders = [];
    let pinningFailed = false;

    for (const door of affectedDoors) {
      const originalCylinder = cylindersByDoorId.get(door.id);
      if (!originalCylinder) {
        pinningFailed = true;
        break;
      }

      const rebuilt = rebuildDoorPinning(door, candidateCodes, sourceSnapshot.settings || {});
      if (!rebuilt.ok) {
        pinningFailed = true;
        break;
      }

      changedCylinders.push({
        door,
        originalCylinder,
        newCylinder: {
          ...deepClone(originalCylinder),
          pinning: rebuilt.pinning
        }
      });
    }

    if (pinningFailed) {
      failureCounts.pinning++;
      continue;
    }

    const changedByDoor = new Map(
      changedCylinders.map(item => [item.door.id, item.newCylinder])
    );
    const candidateCylinders = cylinders.map(cylinder =>
      changedByDoor.get(cylinder.doorId) || cylinder
    );

    if (!verifyAllSnapshotRights(sourceSnapshot, candidateCodes, candidateCylinders)) {
      failureCounts.rights++;
      continue;
    }

    const lostOldCodeBlockedEverywhere = affectedDoors.every(door => {
      const cylinder = candidateCylinders.find(item => item.doorId === door.id);
      return cylinder && !codeOpensCylinder(oldCode, cylinder);
    });

    if (!lostOldCodeBlockedEverywhere) {
      failureCounts.lostKeyStillOpens++;
      continue;
    }

    const changeStats = calculateRekeyChangeStats(changedCylinders);
    const score = scoreRekeyCandidate(oldCode, candidate, changeStats);

    if (!best || score < best.score) {
      best = {
        candidate,
        candidateCylinders,
        changedCylinders,
        changeStats,
        score
      };
    }
  }

  if (!best) {
    throw new Error(
      "Rekey lahendust ei leitud praeguste ABUS SFA 777 reeglitega. " +
      "Kontrollitud variandid ei suutnud samaaegselt blokeerida kadunud võtit, säilitada teiste võtmete avamisõigusi ja hoida lubatud sarjastust. " +
      `Kontroll: kvaliteet ${failureCounts.quality}, olemasolev kood ${failureCounts.duplicate}, ` +
      `sarjastus ${failureCounts.pinning}, avamisõigused ${failureCounts.rights}, ` +
      `vana võti jäi avama ${failureCounts.lostKeyStillOpens}, turvareegel ${failureCounts.upcut}.`
    );
  }

  const newSnapshot = deepClone(sourceSnapshot);
  const newKey = newSnapshot.generated.keys.find(key => key.id === lostKeyId);
  newKey.code = [...best.candidate];
  newSnapshot.generated.cylinders = deepClone(best.candidateCylinders);

  const nextVersion = sourceSnapshot.project.projectVersion + 1;
  const now = new Date().toISOString();

  newSnapshot.applicationVersion = REKEY_APP_VERSION;
  newSnapshot.project.projectVersion = nextVersion;
  newSnapshot.project.confirmedAt = now;
  newSnapshot.confirmation = {
    confirmed: true,
    confirmedBy: null,
    confirmationMethod: "REKEY_UI"
  };
  const affectedDoorNames = best.changedCylinders.map(item => item.door.name);
  newSnapshot.rekey = {
    type: "LOST_KEY",
    sourceProjectVersion: sourceSnapshot.project.projectVersion,
    createdAt: now,
    keyId: lostKey.id,
    keyName: lostKey.name,
    oldCode: [...oldCode],
    newCode: [...best.candidate],
    affectedDoorIds: best.changedCylinders.map(item => item.door.id),
    affectedDoorNames,
    changedCylinderCount: best.changeStats.changedCylinderCount,
    changedChamberCount: best.changeStats.changedChamberCount,
    comment:
      'Rekey: kadunud võti "' + lostKey.name + '" muudeti koodilt ' +
      oldCode.join("") + ' koodile ' + best.candidate.join("") + '. ' +
      'Muudeti ' + best.changeStats.changedCylinderCount + ' südamikku ja ' +
      best.changeStats.changedChamberCount + ' kambrit. Mõjutatud uksed: ' +
      affectedDoorNames.join(", ") + '.'
  };

  newSnapshot.integrity.checksum = "";
  const checksumSource = deepClone(newSnapshot);
  checksumSource.integrity.checksum = "";
  newSnapshot.integrity.checksum = await sha256Hex(canonicalJson(checksumSource));

  return {
    snapshot: newSnapshot,
    key: lostKey,
    oldCode,
    newCode: best.candidate,
    affectedDoors: best.changedCylinders.map(item => ({
      id: item.door.id,
      name: item.door.name,
      quantity: item.door.quantity
    })),
    changeStats: best.changeStats
  };
}

function validateRekeySource(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Rekey arvutamine ebaõnnestus: projekti snapshot puudub.");
  }
  if (snapshot.schemaVersion !== "1.1") {
    throw new Error(`Rekey arvutamine ebaõnnestus: snapshoti skeemiversioon ${snapshot.schemaVersion || "puudub"} pole toetatud.`);
  }
  if (snapshot.engineVersion !== "1.0.4") {
    throw new Error(`Rekey arvutamine ebaõnnestus: engine versioon ${snapshot.engineVersion || "puudub"} pole toetatud.`);
  }
  if (!Array.isArray(snapshot.generated?.keys) || !Array.isArray(snapshot.generated?.cylinders)) {
    throw new Error("Rekey arvutamine ebaõnnestus: snapshotis puuduvad võtmete või südamike andmed.");
  }
  if (!Array.isArray(snapshot.matrix?.doors)) {
    throw new Error("Rekey arvutamine ebaõnnestus: snapshotis puudub avamismaatriks.");
  }
}

function buildRekeyCandidates(oldCode, qualityRules) {
  const minDifference = Number.isInteger(qualityRules.rekeyMinDifference)
    ? qualityRules.rekeyMinDifference
    : 2;

  const rearFirst = [...oldCode.keys()].sort((a, b) => b - a);
  const candidates = [];
  const seen = new Set();

  function add(code) {
    const key = code.join("");
    if (key === oldCode.join("") || seen.has(key)) return;
    seen.add(key);
    candidates.push(code);
  }

  for (const channel of rearFirst) {
    for (let depth = 0; depth <= 9; depth++) {
      if (Math.abs(depth - oldCode[channel]) < minDifference) continue;
      const next = [...oldCode];
      next[channel] = depth;
      add(next);
    }
  }

  for (let a = 0; a < rearFirst.length; a++) {
    for (let b = a + 1; b < rearFirst.length; b++) {
      const ch1 = rearFirst[a];
      const ch2 = rearFirst[b];

      for (let d1 = 0; d1 <= 9; d1++) {
        if (Math.abs(d1 - oldCode[ch1]) < minDifference) continue;
        for (let d2 = 0; d2 <= 9; d2++) {
          if (Math.abs(d2 - oldCode[ch2]) < minDifference) continue;
          const next = [...oldCode];
          next[ch1] = d1;
          next[ch2] = d2;
          add(next);
        }
      }
    }
  }

  return candidates;
}

function isRekeyCodeQualityValid(code, rules) {
  if (!Array.isArray(code) || code.length !== 6) return false;

  const macs = Number.isInteger(rules.macs) ? rules.macs : 4;
  for (let i = 0; i < code.length - 1; i++) {
    if (Math.abs(code[i] - code[i + 1]) > macs) return false;
  }

  const minUnique = Number.isInteger(rules.minUniqueDepths) ? rules.minUniqueDepths : 4;
  if (new Set(code).size < minUnique) return false;

  const maxSame = Number.isInteger(rules.maxSameDepthCount) ? rules.maxSameDepthCount : 2;
  const counts = {};
  for (const depth of code) {
    counts[depth] = (counts[depth] || 0) + 1;
    if (counts[depth] > maxSame) return false;
  }

  if (rules.avoidFirstDepth9 !== false && code[0] === 9) return false;

  for (let i = 0; i < code.length - 1; i++) {
    if (rules.avoid88 !== false && code[i] === 8 && code[i + 1] === 8) return false;
    if (rules.avoid99 !== false && code[i] === 9 && code[i + 1] === 9) return false;
  }

  if (rules.avoidSimplePatterns !== false) {
    const text = code.join("");
    const simple = new Set([
      "012345","123456","234567","345678","654321","543210",
      "010210","012012","001122","111234","987654","876543"
    ]);
    if (simple.has(text)) return false;
  }

  return true;
}

function rebuildDoorPinning(door, codesByKeyId, settings) {
  const allowedStandardPins = Array.isArray(settings.allowedStandardPins)
    ? settings.allowedStandardPins
    : [0,1,2,3,4,5,6,7,8,9];
  const allowedMasterPins = Array.isArray(settings.allowedMasterPins)
    ? settings.allowedMasterPins
    : [2,3,4,5,6,7,8];
  const maxMasterPins = Number.isInteger(settings.maxMasterPinsPerChamber)
    ? settings.maxMasterPinsPerChamber
    : 2;
  const rules = settings.qualityRules || {};

  const keyIds = Array.isArray(door.openBy) ? door.openBy : [];
  const openingCodes = keyIds.map(keyId => codesByKeyId.get(keyId)).filter(Array.isArray);
  if (openingCodes.length !== keyIds.length || openingCodes.length === 0) {
    return { ok: false };
  }

  const pinning = [];

  for (let chamber = 0; chamber < 6; chamber++) {
    const values = [...new Set(openingCodes.map(code => code[chamber]))].sort((a, b) => a - b);
    if (values.length > maxMasterPins + 1) return { ok: false };

    const base = values[0];
    if (!allowedStandardPins.includes(base)) return { ok: false };
    if (rules.avoidBaseAbove7 !== false && base > 7) return { ok: false };

    const masters = [];
    for (let i = 1; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      if (!allowedMasterPins.includes(diff)) return { ok: false };
      masters.push(diff);
    }

    if (base + masters.reduce((sum, value) => sum + value, 0) > 9) return { ok: false };

    pinning.push({ chamber: chamber + 1, base, masters });
  }

  return { ok: true, pinning };
}

function codeOpensCylinder(code, cylinder) {
  if (!Array.isArray(code) || !Array.isArray(cylinder?.pinning)) return false;
  if (cylinder.pinning.length !== code.length) return false;

  for (let chamber = 0; chamber < code.length; chamber++) {
    const channel = cylinder.pinning[chamber];
    const allowedValues = [channel.base];
    let current = channel.base;

    for (const master of channel.masters || []) {
      current += master;
      allowedValues.push(current);
    }

    if (!allowedValues.includes(code[chamber])) return false;
  }

  return true;
}

function verifyAllSnapshotRights(snapshot, codesByKeyId, cylinders) {
  const doorById = new Map(snapshot.matrix.doors.map(door => [door.id, door]));

  for (const cylinder of cylinders) {
    const door = doorById.get(cylinder.doorId);
    if (!door) return false;
    const allowedKeyIds = new Set(Array.isArray(door.openBy) ? door.openBy : []);

    for (const [keyId, code] of codesByKeyId.entries()) {
      if (allowedKeyIds.has(keyId) !== codeOpensCylinder(code, cylinder)) return false;
    }
  }

  return true;
}

function verifySnapshotNoUpcut(snapshot, codesByKeyId) {
  const rules = snapshot.settings?.qualityRules || {};
  if (rules.noUpcutToHigherLevel === false) return true;

  const rights = new Map();
  for (const key of snapshot.generated.keys) {
    rights.set(key.id, new Set(Array.isArray(key.opensDoors) ? key.opensDoors : []));
  }

  for (const lower of snapshot.generated.keys) {
    const lowerRights = rights.get(lower.id) || new Set();
    const lowerCode = codesByKeyId.get(lower.id);
    if (!lowerCode) continue;

    for (const higher of snapshot.generated.keys) {
      if (higher.id === lower.id) continue;
      const higherRights = rights.get(higher.id) || new Set();
      if (!isStrictRightsSubset(lowerRights, higherRights)) continue;

      const higherCode = codesByKeyId.get(higher.id);
      if (higherCode && canCodeBeUpcut(lowerCode, higherCode)) return false;
    }
  }

  return true;
}

function isStrictRightsSubset(lower, higher) {
  if (lower.size >= higher.size) return false;
  for (const item of lower) if (!higher.has(item)) return false;
  return true;
}

function canCodeBeUpcut(lowerCode, higherCode) {
  let hasDeeperCut = false;
  for (let i = 0; i < lowerCode.length; i++) {
    if (higherCode[i] < lowerCode[i]) return false;
    if (higherCode[i] > lowerCode[i]) hasDeeperCut = true;
  }
  return hasDeeperCut;
}

function calculateRekeyChangeStats(changedCylinders) {
  let changedChamberCount = 0;
  let changedCylinderCount = 0;

  for (const item of changedCylinders) {
    let cylinderChanged = false;
    for (let i = 0; i < item.originalCylinder.pinning.length; i++) {
      const before = item.originalCylinder.pinning[i];
      const after = item.newCylinder.pinning[i];
      const sameBase = before.base === after.base;
      const sameMasters = JSON.stringify(before.masters || []) === JSON.stringify(after.masters || []);
      if (!sameBase || !sameMasters) {
        changedChamberCount++;
        cylinderChanged = true;
      }
    }
    if (cylinderChanged) changedCylinderCount++;
  }

  return { changedCylinderCount, changedChamberCount };
}

function scoreRekeyCandidate(oldCode, candidate, stats) {
  let changedKeyPositions = 0;
  let frontPenalty = 0;
  let depthPenalty = 0;

  for (let i = 0; i < oldCode.length; i++) {
    if (oldCode[i] !== candidate[i]) {
      changedKeyPositions++;
      frontPenalty += oldCode.length - i;
      depthPenalty += candidate[i];
    }
  }

  return (
    stats.changedCylinderCount * 100000 +
    stats.changedChamberCount * 10000 +
    changedKeyPositions * 1000 +
    frontPenalty * 50 +
    depthPenalty
  );
}

function renderRekeyResult(result) {
  const target = document.getElementById("rekeyResult");
  const status = document.getElementById("rekeyResultStatus");

  status.className = "status";
  status.innerHTML =
    `Rekey OK • ${escapeHtml(result.key.name)} • V${result.snapshot.project.projectVersion} valmis salvestamiseks.`;

  const affectedRows = result.affectedDoors.map(item => `
    <tr><td>${escapeHtml(item.name)}</td><td>${formatQuantity(item.quantity)} tk</td></tr>
  `).join("");

  target.innerHTML = `
    <div class="rekey-summary">
      <div><strong>Vana võtmekood:</strong> <span class="code">${escapeHtml(result.oldCode.join(""))}</span></div>
      <div><strong>Uus võtmekood:</strong> <span class="code">${escapeHtml(result.newCode.join(""))}</span></div>
      <div><strong>Muudetavaid südamikke:</strong> ${result.changeStats.changedCylinderCount}</div>
      <div><strong>Muudetavaid kambreid:</strong> ${result.changeStats.changedChamberCount}</div>
    </div>
    <table>
      <thead><tr><th>Muudetav uks</th><th>Südamikke</th></tr></thead>
      <tbody>${affectedRows}</tbody>
    </table>
    <div class="status">
      Kontroll OK: uus võti säilitab samad avamisõigused, teised võtmed säilitavad oma õigused ja kadunud vana võtmekood ei ava enam ühtegi mõjutatud ust.
    </div>
  `;
}

function renderRekeyStatus(message) {
  const target = document.getElementById("rekeyResultStatus");
  target.className = "status";
  target.textContent = message;
}

function renderRekeyError(message) {
  const target = document.getElementById("rekeyResultStatus");
  target.className = "error";
  target.textContent = message;
}
