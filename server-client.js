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

  refreshBtn.addEventListener("click", loadProjectList);
  loadProjectList();
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
    status.className = "status";
    status.textContent = payload.projects.length
      ? `Serveris on ${payload.projects.length} projekti versiooni.`
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

  const rows = projects.map(project => {
    const confirmed = formatDateTime(project.confirmedAt || project.createdAt);
    return `
      <tr>
        <td>${escapeHtml(project.projectCode)}</td>
        <td>V${Number(project.projectVersion)}</td>
        <td>${escapeHtml(project.profile || "")}</td>
        <td>${escapeHtml(confirmed)}</td>
        <td>${escapeHtml(project.engineVersion || "")}</td>
        <td><button type="button" class="open-project-btn" data-project-id="${escapeHtml(project.id)}">Ava eelvaade</button></td>
      </tr>
    `;
  }).join("");

  list.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Projekt</th>
          <th>Versioon</th>
          <th>Profiil</th>
          <th>Kinnitatud</th>
          <th>Engine</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  list.querySelectorAll(".open-project-btn").forEach(button => {
    button.addEventListener("click", () => openServerProject(button.dataset.projectId));
  });
}

async function openServerProject(projectId) {
  const preview = document.getElementById("projectPreview");
  const status = document.getElementById("projectPreviewStatus");
  const content = document.getElementById("projectPreviewContent");

  preview.hidden = false;
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

    status.className = "status";
    status.textContent =
      `Avatud ainult vaatamiseks • ${payload.project.projectCode} / V${payload.project.projectVersion}`;
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
  const doors = new Map((snapshot.matrix?.doors || []).map(door => [door.id, door.name]));

  const keyRows = snapshot.generated.keys.map(key => `
    <tr>
      <td>${escapeHtml(key.name)}</td>
      <td>${formatQuantity(key.quantity)}</td>
      <td class="code">${escapeHtml(Array.isArray(key.code) ? key.code.join("") : "")}</td>
      <td>${key.hierarchyLevel ?? ""}</td>
    </tr>
  `).join("");

  const keyNamesById = new Map(
    snapshot.generated.keys.map(key => [key.id, key.name])
  );

  const maxMasterPins = Number.isInteger(snapshot.settings?.maxMasterPinsPerChamber)
    ? snapshot.settings.maxMasterPinsPerChamber
    : 2;

  const cylinderCards = snapshot.generated.cylinders.map((cylinder, index) => {
    const doorName = doors.get(cylinder.doorId) || cylinder.doorId || "";
    const channels = Array.isArray(cylinder.pinning) ? cylinder.pinning : [];

    let pinTable = `<table><tbody><tr><th>Tava</th>`;
    channels.forEach(channel => {
      pinTable += `<td>${escapeHtml(String(channel.base ?? ""))}</td>`;
    });
    pinTable += `</tr>`;

    for (let level = 0; level < maxMasterPins; level++) {
      pinTable += `<tr><th>s${level + 1}</th>`;
      channels.forEach(channel => {
        const value = Array.isArray(channel.masters) ? channel.masters[level] : undefined;
        pinTable += `<td>${value !== undefined ? escapeHtml(String(value)) : ""}</td>`;
      });
      pinTable += `</tr>`;
    }

    pinTable += `</tbody></table>`;

    const openedByNames = Array.isArray(cylinder.openedBy)
      ? cylinder.openedBy
          .map(keyId => keyNamesById.get(keyId) || keyId)
          .map(escapeHtml)
          .join(", ")
      : "";

    return `
      <div class="pinning-card">
        <div class="pinning-title">#${index + 1} ${escapeHtml(doorName)} — ${formatQuantity(cylinder.quantity)} tk</div>
        ${pinTable}
        <div><strong>Avab:</strong> ${openedByNames}</div>
      </div>
    `;
  }).join("");

  target.innerHTML = `
    <div class="preview-meta">
      <div><strong>Projekt:</strong> ${escapeHtml(snapshot.project.projectCode)} / V${snapshot.project.projectVersion}</div>
      <div><strong>Tellimuse nr:</strong> ${escapeHtml(snapshot.project.orderNumber || "—")}</div>
      <div><strong>Profiil:</strong> ${escapeHtml(snapshot.profile?.id || "")}</div>
      <div><strong>Engine:</strong> ${escapeHtml(snapshot.engineVersion || "")}</div>
      <div><strong>Kinnitatud:</strong> ${escapeHtml(formatDateTime(snapshot.project.confirmedAt))}</div>
      <div><strong>SHA-256:</strong> <span class="code checksum">${escapeHtml(snapshot.integrity?.checksum || "")}</span></div>
    </div>

    <h4>Võtmed (${snapshot.generated.keys.length})</h4>
    <table>
      <thead>
        <tr><th>Võti</th><th>Kogus</th><th>Kood</th><th>Hierarhia</th></tr>
      </thead>
      <tbody>${keyRows}</tbody>
    </table>

    <h4>Südamike koodid</h4>
    <div class="status">Projekt: ${escapeHtml(snapshot.project.projectCode || "-")}<br>Südamike koodid genereeritud: ${snapshot.generated.cylinders.length}. Ristiavamise kontroll: OK.</div>
    ${cylinderCards}
  `;
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
