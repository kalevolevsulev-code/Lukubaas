// =====================================================
// V1.1 Alpha - SERVER CLIENT PLACEHOLDER
// Server connection is intentionally disabled in this step.
// =====================================================

document.addEventListener("DOMContentLoaded", () => {
  const saveBtn = document.getElementById("saveServerBtn");
  const status = document.getElementById("serverStatus");

  saveBtn.disabled = true;
  status.className = "status";
  status.textContent =
    "Server: pole veel ühendatud. Snapshot-kiht testitakse enne serveri lisamist.";
});
