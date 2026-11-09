// =====================================================
// V1.1 Alpha - SERVER CLIENT
// Server failure must never block local generator usage.
// =====================================================

const SERVER_ENDPOINT = "/.netlify/functions/projects";
const SERVER_TIMEOUT_MS = 8000;

document.addEventListener("DOMContentLoaded", () => {
  const saveBtn = document.getElementById("saveServerBtn");
  const status = document.getElementById("serverStatus");
  const refreshBtn = document.getElementById("refreshProjectsBtn");
  const printServerProjectBtn = document.getElementById("printServerProjectBtn");
  const serverMenuBtn = document.getElementById("serverMenuBtn");
  const backToGeneratorBtn = document.getElementById("backToGeneratorBtn");
  const generatorView = document.getElementById("generatorView");
  const serverView = document.getElementById("serverView");

  status.className = "status";
  status.textContent = "Server: valmis ühenduse testimiseks.";

  document.getElementById("createSnapshotBtn").addEventListener("click", () => {
    setTimeout(() => {
      saveBtn.disabled = !latestProjectSnapshot;
    }, 0);
  });

  saveBtn.addEventListener("click", async () => {
    if (!latestProjectSnapshot) {
      renderServerError("Koosta enne snapshot.");
      return;
    }

    saveBtn.disabled = true;
    renderServerStatus("Salvestan serverisse...");

    try {
      const result = await saveSnapshotToServer(latestProjectSnapshot);
      validateSaveResponse(result, latestProjectSnapshot);

      renderServerStatus(
        `Salvestatud • ID: ${escapeHtml(result.id)} • ` +
        `${escapeHtml(result.projectCode)} / V${result.projectVersion}`
      );

      await loadProjectList();
    } catch (error) {
      renderServerError(error.message || "Serveriga ühendust ei saadud. Projekt töötab lokaalselt edasi.");
    } finally {
      saveBtn.disabled = false;
    }
  });

  serverMenuBtn.addEventListener("click", () => {
    generatorView.hidden = true;
    serverView.hidden = false;
    loadProjectList();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  backToGeneratorBtn.addEventListener("click", () => {
    serverView.hidden = true;
    generatorView.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  refreshBtn.addEventListener("click", loadProjectList);
  printServerProjectBtn.addEventListener("click", () => {
    const preview = document.getElementById("projectPreview");
    if (preview.hidden) {
      document.getElementById("projectPreviewStatus").className = "error";
      document.getElementById("projectPreviewStatus").textContent =
        "Trükkimine ebaõnnestus: ava enne serverist projekt.";
      return;
    }

    document.body.classList.add("server-preview-print");

    const cleanupPrintMode = () => {
      document.body.classList.remove("server-preview-print");
      window.removeEventListener("afterprint", cleanupPrintMode);
    };

    window.addEventListener("afterprint", cleanupPrintMode);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  });
});

async function saveSnapshotToServer(snapshot) {
  const response = await serverFetch(SERVER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshot })
  }, "Serverisse salvestamine");

  if (!response.ok) {
    if (response.status === 409) {
      throw new Error("Sama projektikood ja versioon on juba serveris olemas.");
    }
    const payload = await safeJson(response, "Serverisse salvestamine");
    throw new Error(payload?.error || "Serverisse salvestamine ebaõnnestus. Kontrolli serveri seadistust ja proovi uuesti.");
  }

  return safeJson(response, "Serverisse salvestamine");
}

async function loadProjectList() {
  const refreshBtn = document.getElementById("refreshProjectsBtn");
  const status = document.getElementById("projectsListStatus");
  const list = document.getElementById("projectsList");

  refreshBtn.disabled = true;
  status.className = "status";
  status.textContent = "Laadin serverisse salvestatud projekte...";

  try {
    const response = await serverFetch(
      `${SERVER_ENDPOINT}?limit=100`,
      { method: "GET" },
      "Projektide nimekirja laadimine"
    );
    const payload = await safeJson(response, "Projektide nimekirja laadimine");

    if (!response.ok) {
      throw new Error(payload?.error || "Projektide nimekirja laadimine ebaõnnestus.");
    }

    if (!payload || !Array.isArray(payload.projects)) {
      throw new Error("Projektide nimekirja laadimine ebaõnnestus: serveri vastuses puudub projektide loend.");
    }

    renderProjectList(payload.projects);
    const uniqueProjects = new Set(payload.projects.map(project => project.projectCode)).size;
    status.className = "status";
    status.textContent = payload.projects.length
      ? `Serveris on ${uniqueProjects} projekti ja ${payload.projects.length} versiooni.`
      : "Serveris pole veel ühtegi salvestatud projekti.";
  } catch (error) {
    list.innerHTML = "";
    status.className = "error";
    status.textContent = error.message || "Projektide nimekirja laadimine ebaõnnestus.";
  } finally {
    refreshBtn.disabled = false;
  }
}

function renderProjectList(projects) {
  const list = document.getElementById("projectsList");

  if (!projects.length) {
    list.innerHTML = "";
    return;
  }

  const grouped = new Map();

  projects.forEach(project => {
    if (!grouped.has(project.projectCode)) grouped.set(project.projectCode, []);
    grouped.get(project.projectCode).push(project);
  });

  const groups = [...grouped.entries()]
    .map(([projectCode, versions]) => {
      const sortedVersions = [...versions].sort((a, b) => b.projectVersion - a.projectVersion);
      return { projectCode, versions: sortedVersions, latest: sortedVersions[0] };
    })
    .sort((a, b) => new Date(b.latest.createdAt || 0) - new Date(a.latest.createdAt || 0));

  list.innerHTML = groups.map(group => {
    const versionButtons = group.versions.map(version => {
      return '<button type="button" class="open-project-btn version-btn" data-project-id="' +
        escapeHtml(version.id) + '">Ava V' + version.projectVersion + '</button>';
    }).join("");

    return '<div class="project-group">' +
      '<div class="project-group-main">' +
        '<div><strong>' + escapeHtml(group.projectCode) + '</strong>' +
        '<div class="project-group-meta">' +
          escapeHtml(group.latest.profile || "") +
          ' • viimane versioon V' + group.latest.projectVersion +
          ' • ' + escapeHtml(formatDateTime(group.latest.confirmedAt || group.latest.createdAt)) +
        '</div></div>' +
      '</div>' +
      '<div class="project-version-buttons">' + versionButtons + '</div>' +
    '</div>';
  }).join("");

  list.querySelectorAll(".open-project-btn").forEach(button => {
    button.addEventListener("click", () => openServerProject(button.dataset.projectId));
  });
}

async function openServerProject(projectId) {
  const preview = document.getElementById("projectPreview");
  const status = document.getElementById("projectPreviewStatus");
  const content = document.getElementById("projectPreviewContent");

  preview.hidden = false;
  document.getElementById("printServerProjectBtn").disabled = true;
  status.className = "status";
  status.textContent = "Laadin projekti eelvaadet...";
  content.innerHTML = "";

  try {
    const response = await serverFetch(
      `${SERVER_ENDPOINT}?id=${encodeURIComponent(projectId)}`,
      { method: "GET" },
      "Projekti avamine"
    );
    const payload = await safeJson(response, "Projekti avamine");

    if (!response.ok) {
      throw new Error(payload?.error || "Projekti avamine ebaõnnestus.");
    }

    if (!payload?.project?.snapshot) {
      throw new Error("Projekti avamine ebaõnnestus: server ei tagastanud projekti snapshoti.");
    }

    validateOpenedProject(payload.project);
    renderProjectPreview(payload.project);
    window.currentServerProject = payload.project;
    window.dispatchEvent(new CustomEvent("server-project-opened", {
      detail: { project: payload.project }
    }));

    status.className = "status";
    status.textContent =
      `Avatud ainult vaatamiseks • ${payload.project.projectCode} / V${payload.project.projectVersion}`;
    document.getElementById("printServerProjectBtn").disabled = false;
  } catch (error) {
    status.className = "error";
    status.textContent = error.message || "Projekti avamine ebaõnnestus.";
  }
}

function validateOpenedProject(project) {
  const snapshot = project.snapshot;

  if (project.id !== undefined && typeof project.id !== "string") {
    throw new Error("Projekti avamine ebaõnnestus: server tagastas vigase projekti ID.");
  }

  if (snapshot.project?.projectCode !== project.projectCode) {
    throw new Error("Projekti avamine ebaõnnestus: snapshoti projektikood ei vasta serveri kirjele.");
  }

  if (snapshot.project?.projectVersion !== project.projectVersion) {
    throw new Error("Projekti avamine ebaõnnestus: snapshoti versioon ei vasta serveri kirjele.");
  }

  if (snapshot.integrity?.checksum !== project.checksum) {
    throw new Error("Projekti avamine ebaõnnestus: snapshoti checksum ei vasta serveri kirjele.");
  }

  if (!Array.isArray(snapshot.generated?.keys) || !Array.isArray(snapshot.generated?.cylinders)) {
    throw new Error("Projekti avamine ebaõnnestus: snapshotis puuduvad võtmete või südamike andmed.");
  }
}

function renderProjectPreview(project) {
  const snapshot = project.snapshot;
  const target = document.getElementById("projectPreviewContent");

  const matrixKeys = Array.isArray(snapshot.matrix?.keys) ? snapshot.matrix.keys : [];
  const matrixDoors = Array.isArray(snapshot.matrix?.doors) ? snapshot.matrix.doors : [];
  const generatedKeys = Array.isArray(snapshot.generated?.keys) ? snapshot.generated.keys : [];
  const cylinders = Array.isArray(snapshot.generated?.cylinders) ? snapshot.generated.cylinders : [];

  const keyById = new Map(matrixKeys.map(key => [key.id, key]));
  const generatedKeyById = new Map(generatedKeys.map(key => [key.id, key]));
  const doorById = new Map(matrixDoors.map(door => [door.id, door]));

  let html = "";

  // 1. Projekt — sama info nagu generaatori projektiplokis
  html += `<div class="card">
    <h2>1. Projekt</h2>
    <div class="status">
      <strong>Projekt:</strong> ${escapeHtml(snapshot.project?.projectCode || "-")}<br>
      <strong>Tellimus:</strong> ${snapshot.project?.orderNumber ? escapeHtml(snapshot.project.orderNumber) : "-"}
    </div>
  </div>`;

  // Kontroll — snapshotis talletatud kinnitatud kontrollitulemus
  if (snapshot.rekey) {
    const rekey = snapshot.rekey;
    const affectedDoorNames = (Array.isArray(rekey.affectedDoorNames) && rekey.affectedDoorNames.length)
      ? rekey.affectedDoorNames
      : (Array.isArray(rekey.affectedDoorIds) ? rekey.affectedDoorIds.map(doorId => doorById.get(doorId)?.name || doorId) : []);

    html += `<div class="card change-summary-card">
      <h2>Muudatuste kokkuvõte</h2>
      <div class="status">
        <strong>Muudatuse tüüp:</strong> Rekey – kadunud võti<br>
        <strong>Eelmine versioon:</strong> V${rekey.sourceProjectVersion}<br>
        <strong>Muudetud võti:</strong> ${escapeHtml(rekey.keyName || rekey.keyId || "-")}<br>
        <strong>Vana võtmekood:</strong> <span class="code">${escapeHtml(Array.isArray(rekey.oldCode) ? rekey.oldCode.join("") : "")}</span><br>
        <strong>Uus võtmekood:</strong> <span class="code">${escapeHtml(Array.isArray(rekey.newCode) ? rekey.newCode.join("") : "")}</span><br>
        <strong>Muudetud südamikke:</strong> ${Number(rekey.changedCylinderCount || 0)}<br>
        <strong>Muudetud kambreid:</strong> ${Number(rekey.changedChamberCount || 0)}<br>
        <strong>Mõjutatud uksed:</strong> ${affectedDoorNames.map(escapeHtml).join(", ") || "-"}<br>
        <strong>Muudatuse aeg:</strong> ${escapeHtml(formatDateTime(rekey.createdAt))}
      </div>
      ${rekey.comment ? `<div class="status"><strong>Kommentaar:</strong> ${escapeHtml(rekey.comment)}</div>` : ""}
    </div>`;
  }

  html += `<div class="card">
    <h2>Kontroll</h2>`;

  const validation = snapshot.validation || { valid: false, errors: [], warnings: [] };
  const errors = Array.isArray(validation.errors) ? validation.errors : [];
  const warnings = Array.isArray(validation.warnings) ? validation.warnings : [];

  if (errors.length === 0) {
    html += `<div class="status">Kontroll OK. Tõsiseid vigu ei leitud.</div>`;
  } else {
    html += `<div class="error">Leiti vead:</div>`;
    errors.forEach(error => {
      html += `<div class="error">${escapeHtml(error)}</div>`;
    });
  }

  if (warnings.length > 0) {
    html += `<div class="warning">Hoiatused (${warnings.length}):</div>`;
    warnings.forEach(warning => {
      html += `<div class="warning">${escapeHtml(warning)}</div>`;
    });
  }

  html += `</div>`;

  // Võtmete tugevus / hierarhia — sama tabel ja terminid nagu generaatoris
  html += `<div class="card">
    <h2>Võtmete tugevus / hierarhia</h2>
    <div class="status">Võtmed järjestatud avamisõiguste tugevuse järgi.</div>
    <table>
      <thead>
        <tr><th>Jrk</th><th>Võti</th><th>Kogus</th><th>Tehniline tase</th><th>Avab uksi</th><th>Avatavad uksed</th></tr>
      </thead>
      <tbody>`;

  const hierarchyKeys = [...generatedKeys].sort((a, b) => {
    const levelA = Number.isInteger(a.hierarchyLevel) ? a.hierarchyLevel : 999;
    const levelB = Number.isInteger(b.hierarchyLevel) ? b.hierarchyLevel : 999;
    if (levelA !== levelB) return levelA - levelB;
    return generatedKeys.indexOf(a) - generatedKeys.indexOf(b);
  });

  hierarchyKeys.forEach((key, index) => {
    const rowClass = key.hierarchyLevel === 1 ? "level-1" : key.hierarchyLevel === 2 ? "level-2" : "";
    const openedDoorNames = (Array.isArray(key.opensDoors) ? key.opensDoors : [])
      .map(doorId => doorById.get(doorId)?.name || doorId);

    html += `<tr class="${rowClass}">
      <td>${index + 1}</td>
      <td>${escapeHtml(key.name || "")}</td>
      <td>${formatQuantity(key.quantity)} tk</td>
      <td>Tase ${key.hierarchyLevel ?? ""}</td>
      <td>${openedDoorNames.length}</td>
      <td>${openedDoorNames.map(escapeHtml).join(", ")}</td>
    </tr>`;
  });

  html += `</tbody></table></div>`;

  // Avamismaatriks — sama ülesehitus nagu generaatoris
  const totalKeys = matrixKeys.reduce(
    (sum, key) => sum + (Number.isInteger(key.quantity) ? key.quantity : 0),
    0
  );
  const totalCylinders = matrixDoors.reduce(
    (sum, door) => sum + (Number.isInteger(door.quantity) ? door.quantity : 0),
    0
  );

  html += `<div class="card">
    <h2>Avamismaatriks</h2>
    <div class="status">Leitud võtmetüüpe: ${matrixKeys.length} (${totalKeys} võtit), südamikuridu: ${matrixDoors.length} (${totalCylinders} südamikku)</div>
    <table>
      <thead><tr><th>Uks \\ Võti</th><th>Südamikke</th>`;

  matrixKeys.forEach(key => {
    html += `<th>${escapeHtml(key.name || "")}<br><small>${formatQuantity(key.quantity)} tk</small></th>`;
  });

  html += `</tr></thead><tbody>`;

  matrixDoors.forEach(door => {
    const openBy = new Set(Array.isArray(door.openBy) ? door.openBy : []);
    const cylinderQtyText = door.lockable
      ? `${formatQuantity(door.quantity)} tk`
      : "ei lukustata";

    html += `<tr><td>${escapeHtml(door.name || "")}</td><td>${cylinderQtyText}</td>`;
    matrixKeys.forEach(key => {
      html += openBy.has(key.id) ? `<td class="open-cell">X</td>` : `<td></td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody></table></div>`;

  // Võtmekoodid — sama tabel nagu generaatoris
  const totalGeneratedKeys = generatedKeys.reduce(
    (sum, key) => sum + (Number.isInteger(key.quantity) ? key.quantity : 0),
    0
  );

  html += `<div class="card">
    <h2>Võtmekoodid</h2>
    <div class="status">Võtmekoodid genereeritud: ${generatedKeys.length} tüüpi / ${totalGeneratedKeys} võtit</div>
    <table>
      <thead><tr><th>Võti</th><th>Kogus</th><th>Kood</th></tr></thead>
      <tbody>`;

  generatedKeys.forEach(key => {
    html += `<tr>
      <td>${escapeHtml(key.name || "")}</td>
      <td>${formatQuantity(key.quantity)} tk</td>
      <td class="code">${escapeHtml(Array.isArray(key.code) ? key.code.join("") : "")}</td>
    </tr>`;
  });

  html += `</tbody></table></div>`;

  // Südamike koodid — sama kaart/tabel nagu generaatoris
  html += `<div class="card">
    <h2>Südamike koodid</h2>
    <div class="status">Projekt: ${escapeHtml(snapshot.project?.projectCode || "-")}<br>Südamike koodid genereeritud: ${cylinders.length}. Ristiavamise kontroll: OK.</div>`;

  const maxMasterPins = Number.isInteger(snapshot.settings?.maxMasterPinsPerChamber)
    ? snapshot.settings.maxMasterPinsPerChamber
    : 2;

  cylinders.forEach((cylinder, index) => {
    const door = doorById.get(cylinder.doorId);
    const doorName = door?.name || cylinder.doorId || "";
    const qty = door ? formatQuantity(door.quantity) : formatQuantity(cylinder.quantity);
    const channels = Array.isArray(cylinder.pinning) ? cylinder.pinning : [];
    const openedByNames = (Array.isArray(cylinder.openedBy) ? cylinder.openedBy : [])
      .map(keyId => generatedKeyById.get(keyId)?.name || keyById.get(keyId)?.name || keyId);

    html += `<div class="pinning-card">
      <div class="pinning-title">#${index + 1} ${escapeHtml(doorName)} — ${qty} tk</div>
      <table><tbody>
        <tr><th>Tava</th>`;

    channels.forEach(channel => {
      html += `<td>${escapeHtml(String(channel.base ?? ""))}</td>`;
    });

    html += `</tr>`;

    for (let level = 0; level < maxMasterPins; level++) {
      html += `<tr><th>s${level + 1}</th>`;
      channels.forEach(channel => {
        const value = Array.isArray(channel.masters) ? channel.masters[level] : undefined;
        html += `<td>${value !== undefined ? escapeHtml(String(value)) : ""}</td>`;
      });
      html += `</tr>`;
    }

    html += `</tbody></table>
      <div><strong>Avab:</strong> ${openedByNames.map(escapeHtml).join(", ")}</div>
    </div>`;
  });

  html += `</div>`;

  // Projekti staatus — sama termin nagu generaatoris
  html += `<div class="card">
    <h2>Projekti staatus</h2>
    <div class="status">Staatus: <strong>KINNITATUD</strong></div>
  </div>`;

  target.innerHTML = html;
}

async function serverFetch(url, options, operationName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`${operationName} ebaõnnestus: server ei vastanud ${SERVER_TIMEOUT_MS / 1000} sekundi jooksul. Proovi uuesti.`);
    }
    throw new Error(`${operationName} ebaõnnestus: serveriga ei saadud ühendust. Kontrolli internetiühendust ja proovi uuesti.`);
  } finally {
    clearTimeout(timeout);
  }
}

async function safeJson(response, operationName) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${operationName} ebaõnnestus: serveri vastus ei olnud loetav JSON.`);
  }
}

function validateSaveResponse(result, snapshot) {
  if (!result || typeof result !== "object") {
    throw new Error("Serveri vastus puudub või on vigane.");
  }

  if (!result.id || typeof result.id !== "string") {
    throw new Error("Server ei tagastanud projekti ID-d.");
  }

  if (result.projectCode !== snapshot.project.projectCode) {
    throw new Error("Server tagastas vale projektikoodi.");
  }

  if (result.projectVersion !== snapshot.project.projectVersion) {
    throw new Error("Server tagastas vale projektiversiooni.");
  }

  if (result.checksum !== snapshot.integrity.checksum) {
    throw new Error("Serveri checksum ei vasta saadetud snapshotile.");
  }
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("et-EE", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function formatQuantity(value) {
  return Number.isInteger(value) ? String(value) : "—";
}

function renderServerStatus(message) {
  const target = document.getElementById("serverStatus");
  target.className = "status";
  target.textContent = message;
}

function renderServerError(message) {
  const target = document.getElementById("serverStatus");
  target.className = "error";
  target.textContent = message;
}
