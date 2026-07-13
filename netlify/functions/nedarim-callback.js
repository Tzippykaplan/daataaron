const EXPECTED_NEDARIM_MOSAD_ID = "7018563";
const NEDARIM_ALLOWED_IP = "18.194.219.73";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

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

function cleanNumber(value) {
  if (value == null) return 0;
  const raw = String(value).replace(/[₪$,]/g, "").replace(/,/g, "").trim();
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

function extractFundraiserName(comment) {
  const text = String(comment || "");
  const parts = text.split("|");
  if (parts.length < 2) return "";
  return parts[parts.length - 1].trim();
}

function parseCount(value) {
  if (value == null) return 0;
  const n = Number(String(value).replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function buildAlertMessage(payload) {
  const amountText = payload.currency === "ILS"
    ? `₪${payload.amount.toLocaleString("he-IL")}`
    : `$${payload.amount.toLocaleString("en-US")}`;

  return [
    "New Nedarim donation received",
    `Donor: ${payload.fullName || "Unknown donor"}`,
    `Amount: ${amountText}`,
    `Comments: ${payload.comments || "-"}`,
    payload.donorName ? `Fundraiser: ${payload.donorName}` : ""
  ].filter(Boolean).join("\n");
}

function normalizeCallbackPayload(data, mosadId) {
  const comments = findValueDeep(data, [
    "Comments", "Comment", "Notes", "Remark", "Remarks", "Details", "Description", "Avour", "Purpose", "PirteyTruma"
  ]);
  const donorName = extractFundraiserName(comments);
  const amount = cleanNumber(findValueDeep(data, [
    "Amount", "Sum", "Total", "Schum", "ChargedAmount", "Payment", "PaymentSum"
  ]));
  const fullName = findValueDeep(data, [
    "ClientName", "FullName", "Name", "CustomerName", "DonorName"
  ]) || [
    findValueDeep(data, ["FirstName"]),
    findValueDeep(data, ["LastName"])
  ].filter(Boolean).join(" ").trim();
  const orderRef = findValueDeep(data, [
    "TransactionId", "Confirmation", "Shovar", "Kabala", "KabalaId", "OrderId", "OrderRef"
  ]);
  const paymentDate = findValueDeep(data, ["TransactionTime", "TransactionDate", "Date", "CreatedAt", "PaymentDate"]);
  const currencyCode = findValueDeep(data, ["Currency", "currency"]);
  const currency = currencyCode === "2" || /usd|dollar|\$/i.test(currencyCode) ? "USD" : "ILS";

  const paymentTypeRaw = findValueDeep(data, ["PaymentType", "paymentType", "TransactionType", "type", "HK", "HoraatKeva", "Keva"]);
  const paymentTypeJoined = [paymentTypeRaw, comments].filter(Boolean).join(" ").toLowerCase();
  const isRecurring = /(^|[^a-z])hk([^a-z]|$)|הוראת\s*קבע|קבע|horaat|keva|standing\s*order|recurring/.test(paymentTypeJoined);

  const explicitInstallments = parseCount(findValueDeep(data, ["Tashloumim", "Tashlumim", "Payments", "paymentInstallments", "Installments"]));
  const remainingCharges = parseCount(findValueDeep(data, ["YitratTashloumim", "Yitra", "remainingCharges", "RemainingCharges", "remainingInstallments"]));
  const completedCharges = parseCount(findValueDeep(data, ["Bitzua", "completedCharges", "completedInstallments"]));
  const inferredTotalCharges = remainingCharges + completedCharges;
  const totalCharges = Math.max(explicitInstallments, inferredTotalCharges, isRecurring ? 1 : 0);
  const totalCommitment = isRecurring && totalCharges > 0 ? amount * totalCharges : amount;

  return {
    id: orderRef ? `nedarim-callback-${mosadId}-${orderRef}` : `nedarim-callback-${mosadId}-${Date.now()}`,
    fullName: clip(fullName || "תורם מנדרים פלוס", 120),
    donorName: clip(donorName, 120),
    amount,
    currency,
    comments: clip(comments, 500),
    memoryContent: clip(comments, 500),
    notes: clip([
      "התקבל דרך Nedarim callback",
      comments ? `הערות: ${comments}` : "",
      donorName ? `שם המתרים: ${donorName}` : ""
    ].filter(Boolean).join(" · "), 1000),
    paymentDate: paymentDate || new Date().toISOString(),
    createdAt: new Date().toISOString(),
    status: "paid",
    paymentProcessor: "Nedarim Plus",
    paymentStatus: "approved",
    paymentApproved: true,
    chargedAmount: amount,
    paymentType: isRecurring ? "HK" : (paymentTypeRaw || "Ragil"),
    paymentTypeRaw: paymentTypeRaw || (isRecurring ? "HK" : "Ragil"),
    donationFrequency: isRecurring ? "recurring" : "one_time",
    donationFrequencyLabel: isRecurring ? "הוראת קבע" : "חד פעמית",
    paymentInstallments: totalCharges > 0 ? totalCharges : 1,
    remainingCharges,
    completedCharges,
    totalCharges,
    monthlyAmount: amount,
    installmentAmount: amount,
    totalCommitment,
    currentMonthAmount: amount,
    orderRef: clip(orderRef, 120),
    importedFromNedarim: true,
    source: isRecurring ? "nedarim_recurring" : "nedarim_callback",
    rawNedarim: data
  };
}

async function postJson(url, body, extraHeaders) {
  const response = await fetch(url, {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, extraHeaders || {}),
    body: JSON.stringify(body)
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    const error = new Error(`POST ${url} failed with ${response.status}`);
    error.statusCode = response.status;
    error.responseText = text.slice(0, 800);
    throw error;
  }

  return text;
}

async function fanOutImmediateAlert(payload) {
  const targets = String(process.env.NEDARIM_ALERT_WEBHOOK_URL || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!targets.length) return [];

  const body = {
    type: "nedarim.donation.received",
    title: "New Nedarim donation received",
    donorFullName: payload.fullName,
    donorName: payload.fullName,
    fundraiserName: payload.donorName,
    amount: payload.amount,
    currency: payload.currency,
    comments: payload.comments,
    orderRef: payload.orderRef,
    paymentDate: payload.paymentDate,
    message: buildAlertMessage(payload),
    donor: payload
  };

  return Promise.all(targets.map(async (url) => {
    try {
      await postJson(url, body);
      return { url, ok: true };
    } catch (error) {
      console.error("Nedarim alert webhook failed", { url, message: error.message, response: error.responseText });
      return { url, ok: false, error: error.message };
    }
  }));
}

async function writeDonationToAppsScript(payload) {
  const url = String(process.env.NEDARIM_APPS_SCRIPT_URL || "").trim();
  if (!url) return { skipped: true };

  try {
    await postJson(url, { action: "add", donor: payload }, { Accept: "application/json" });
    return { ok: true };
  } catch (error) {
    console.error("Nedarim Apps Script write failed", { message: error.message, response: error.responseText });
    return { ok: false, error: error.message };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { success: true });
  if (event.httpMethod !== "POST") return json(405, { success: false, message: "Method not allowed. Use POST." });

  const forwardedFor = String(event.headers?.["x-forwarded-for"] || event.headers?.["X-Forwarded-For"] || "");
  const ipLooksLikeNedarim = forwardedFor.split(",").map((x) => x.trim()).includes(NEDARIM_ALLOWED_IP);
  const data = parseCallbackBody(event);
  const callbackMosad = findValueDeep(data, ["Mosad", "MosadId", "mosad", "mosadid"]);
  const donation = normalizeCallbackPayload(data, callbackMosad || EXPECTED_NEDARIM_MOSAD_ID);

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
    fundraiserName: donation.donorName || "not detected",
    data
  });

  const [alertResults, persistenceResult] = await Promise.all([
    fanOutImmediateAlert(donation),
    writeDonationToAppsScript(donation)
  ]);

  return json(200, {
    success: true,
    donation,
    alerts: alertResults,
    persisted: persistenceResult,
    ipLooksLikeNedarim,
    receivedMosad: callbackMosad || ""
  });
};
