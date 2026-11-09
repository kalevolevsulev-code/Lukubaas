import { createHash } from "node:crypto";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const MAX_BODY_BYTES = 512 * 1024;
const MAX_LIST_LIMIT = 100;

export default async (request) => {
  try {
    if (request.method === "POST") return await handlePost(request);
    if (request.method === "GET") return await handleGet(request);

    return jsonResponse(405, { error: "Meetod pole lubatud." });
  } catch (error) {
    console.error("projects function error", error);
    return jsonResponse(500, { error: "Serveri sisemine viga." });
  }
};

async function handlePost(request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "Snapshot on liiga suur." });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "JSON on vigane." });
  }

  const snapshot = body?.snapshot;
  const validationError = validateSnapshot(snapshot);
  if (validationError) return jsonResponse(400, { error: validationError });

  const actualBytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
  if (actualBytes > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "Snapshot on liiga suur." });
  }

  const checksumSource = deepClone(snapshot);
  checksumSource.integrity.checksum = "";
  const expectedChecksum = sha256Hex(canonicalJson(checksumSource));
  if (expectedChecksum !== snapshot.integrity.checksum) {
    return jsonResponse(400, { error: "Snapshoti checksum ei vasta sisule." });
  }

  const row = {
    project_code: snapshot.project.projectCode,
    project_version: snapshot.project.projectVersion,
    profile: snapshot.profile.id,
    status: snapshot.project.status,
    engine_version: snapshot.engineVersion,
    confirmed_at: snapshot.project.confirmedAt,
    snapshot,
    checksum: snapshot.integrity.checksum
  };

  const response = await supabaseFetch(
    "/rest/v1/projects",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(row)
    }
  );

  const text = await response.text();

  if (response.status === 409 || (response.status === 400 && text.includes("duplicate key"))) {
    return jsonResponse(409, { error: "Sama projektikood ja versioon on juba olemas." });
  }

  if (!response.ok) {
    console.error("Supabase insert failed", response.status, text);
    return jsonResponse(502, { error: "Andmebaasi salvestamine ebaõnnestus." });
  }

  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    return jsonResponse(502, { error: "Andmebaasi vastus ei olnud loetav." });
  }

  const saved = Array.isArray(rows) ? rows[0] : null;
  if (!saved?.id) {
    return jsonResponse(502, { error: "Andmebaas ei tagastanud projekti ID-d." });
  }

  if (
    saved.project_code !== snapshot.project.projectCode ||
    saved.project_version !== snapshot.project.projectVersion ||
    saved.checksum !== snapshot.integrity.checksum
  ) {
    return jsonResponse(502, { error: "Salvestuse järelkontroll ebaõnnestus." });
  }

  return jsonResponse(201, {
    id: saved.id,
    projectCode: saved.project_code,
    projectVersion: saved.project_version,
    checksum: saved.checksum,
    createdAt: saved.created_at
  });
}

async function handleGet(request) {
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") || "100");
  const limit = Number.isInteger(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIST_LIMIT)
    : MAX_LIST_LIMIT;

  const response = await supabaseFetch(
    `/rest/v1/projects?select=id,project_code,project_version,profile,status,engine_version,confirmed_at,checksum,created_at&order=created_at.desc&limit=${limit}`,
    { method: "GET" }
  );

  const text = await response.text();
  if (!response.ok) {
    console.error("Supabase list failed", response.status, text);
    return jsonResponse(502, { error: "Projektide nimekirja laadimine ebaõnnestus." });
  }

  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    return jsonResponse(502, { error: "Andmebaasi vastus ei olnud loetav." });
  }

  return jsonResponse(200, {
    projects: rows.map(row => ({
      id: row.id,
      projectCode: row.project_code,
      projectVersion: row.project_version,
      profile: row.profile,
      status: row.status,
      engineVersion: row.engine_version,
      confirmedAt: row.confirmed_at,
      checksum: row.checksum,
      createdAt: row.created_at
    }))
  });
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return "Snapshot puudub.";
  if (snapshot.schemaVersion !== "1.1") return "Snapshoti skeemiversioon pole toetatud.";
  if (snapshot.engineVersion !== "1.0.4") return "Engine versioon pole toetatud.";

  if (!snapshot.project || typeof snapshot.project !== "object") return "Projekti andmed puuduvad.";
  if (!snapshot.project.projectCode || typeof snapshot.project.projectCode !== "string") {
    return "Projektikood puudub.";
  }
  if (!Number.isInteger(snapshot.project.projectVersion) || snapshot.project.projectVersion < 1) {
    return "Projektiversioon on vigane.";
  }
  if (snapshot.project.status !== "CONFIRMED") return "Salvestada saab ainult kinnitatud projekti.";

  if (!snapshot.confirmation?.confirmed) return "Projekt pole kinnitatud.";
  if (!snapshot.integrity?.checksum || !/^[a-f0-9]{64}$/i.test(snapshot.integrity.checksum)) {
    return "Snapshoti checksum on vigane.";
  }

  if (!snapshot.profile?.id) return "Profiil puudub.";
  if (!Array.isArray(snapshot.generated?.keys)) return "Genereeritud võtmed puuduvad.";
  if (!Array.isArray(snapshot.generated?.cylinders)) return "Genereeritud südamikud puuduvad.";

  return null;
}

async function supabaseFetch(path, options = {}) {
  const baseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;

  if (!baseUrl || !serviceKey) {
    throw new Error("Supabase keskkonnamuutujad puuduvad.");
  }

  const headers = new Headers(options.headers || {});
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);

  return fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers
  });
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
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

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
