const EXPECTED_NEDARIM_MOSAD_ID = "7018563";
const NEDARIM_ALLOWED_IP = "18.194.219.73";

function parseCallbackBody(event) {
  const raw = event.body || "";
  const headers = event.headers || {};
  const contentType = String(headers["content-type"] || headers["Content-Type"] || "").toLowerCase();

  if (!raw) return Object.assign({}, event.queryStringParameters || {});

  if (contentType.includes("application/json")) {
    try { return JSON.parse(raw); } catch (error) { return { rawBody: raw }; }
  }

  const params = new URLSearchParams(raw);
  const parsed = {};
  for (const [key, value] of params.entries()) parsed[key] = value;
  return Object.assign(parsed, event.queryStringParameters || {});
}

function findValueDeep(obj, keys) {
  if (!obj || typeof obj !== "object") return "";
  const normalized = keys.map((k) => String(k).toLowerCase());

  for (const [key, value] of Object.entries(obj)) {
    if (normalized.includes(String(key).toLowerCase()) && value != null) return String(value);
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findValueDeep(value, keys);
      if (found) return found;
    }
  }

  return "";
}

exports.handler = async (event) => {
  const forwardedFor = String(event.headers?.["x-forwarded-for"] || event.headers?.["X-Forwarded-For"] || "");
  const ipLooksLikeNedarim = forwardedFor.split(",").map((x) => x.trim()).includes(NEDARIM_ALLOWED_IP);
  const data = parseCallbackBody(event);
  const callbackMosad = findValueDeep(data, ["Mosad", "MosadId", "mosad", "mosadid"]);

  // Keep this permissive for now: Nedarim callback formats can vary.
  // We log mismatches instead of rejecting, so a successful payment callback is not lost.
  if (callbackMosad && callbackMosad !== EXPECTED_NEDARIM_MOSAD_ID) {
    console.warn("Nedarim callback MosadId mismatch", {
      expected: EXPECTED_NEDARIM_MOSAD_ID,
      received: callbackMosad
    });
  }

  console.log("Nedarim callback received", {
    method: event.httpMethod,
    ipLooksLikeNedarim,
    sourceIps: forwardedFor,
    expectedMosad: EXPECTED_NEDARIM_MOSAD_ID,
    receivedMosad: callbackMosad || "not supplied",
    data
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: "OK"
  };
};
