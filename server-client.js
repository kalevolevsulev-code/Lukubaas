// =====================================================
// V1.1 Alpha - SERVER CLIENT
// Server failure must never block local generator usage.
// =====================================================

const SERVER_ENDPOINT = "/.netlify/functions/projects";
const SERVER_TIMEOUT_MS = 8000;

document.addEventListener("DOMContentLoaded", () => {
  const saveBtn = document.getElementById("saveServerBtn");
  const status = document.getElementById("serverStatus");

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
    } catch (error) {
      renderServerError(error.message || "Serveriga ühendust ei saadud. Projekt töötab lokaalselt edasi.");
    } finally {
      saveBtn.disabled = false;
    }
  });
});

async function saveSnapshotToServer(snapshot) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);

  try {
    const response = await fetch(SERVER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot }),
      signal: controller.signal
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Serveri vastus ei olnud loetav.");
    }

    if (!response.ok) {
      if (response.status === 409) {
        throw new Error("Sama projektikood ja versioon on juba serveris olemas.");
      }
      throw new Error(payload?.error || "Serverisse salvestamine ebaõnnestus.");
    }

    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Server ei vastanud õigeaegselt. Projekt töötab lokaalselt edasi.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
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
