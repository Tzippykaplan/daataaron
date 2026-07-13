// Netlify Function: Import Nedarim Plus one-time donations AND credit-card standing orders.
// Required Netlify Environment Variables:
//   NEDARIM_MOSAD_ID=7018563
//   NEDARIM_API_PASSWORD=<Nedarim API password, not ApiValid>
// Optional:
//   NEDARIM_CATEGORY=נציבי דעת אהרן
//   NEDARIM_MAX_ID=500
//   NEDARIM_IMPORT_PAGES=20
//   NEDARIM_KEVA_URL=<override URL for recurring orders API, if Nedarim support gives a specific endpoint>
//   NEDARIM_KEVA_ACTION=<override Action for recurring orders API, if Nedarim support gives a specific action>

const NEDARIM_HISTORY_URL = "https://matara.pro/nedarimplus/Reports/Manage3.aspx";

// Nedarim's public GetHistoryJson documentation covers completed income transactions.
// Active standing orders are a different screen in Nedarim, so we try likely API actions/endpoints and return debug data.
const DEFAULT_KEVA_ENDPOINTS = [
  "https://matara.pro/nedarimplus/Reports/Manage3.aspx",
  "https://matara.pro/nedarimplus/Reports/Manage.aspx",
  "https://matara.pro/nedarimplus/Reports/Keva.aspx",
  "https://matara.pro/nedarimplus/Reports/HoraatKeva.aspx",
  "https://matara.pro/nedarimplus/Reports/HoraotKeva.aspx",
  "https://matara.pro/nedarimplus/Reports/KevaAshrai.aspx"
];

const DEFAULT_KEVA_ACTIONS = [
  "GetKevaJson",
  "GetKevaListJson",
  "GetHoraotKevaJson",
  "GetHoraatKevaJson",
  "GetHKJson",
  "GetHkJson",
  "GetHKListJson",
  "GetHkListJson",
  "GetKevaCreditJson",
  "GetKevaAshraiJson",
  "GetHoraotKevaAshraiJson",
  "GetStandingOrdersJson",
  "GetRecurringJson",
  "GetCreditKevaJson"
];

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(body)
  };
}

function normalizeText(value) {
  return String(value || "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/אהרון/g, "אהרן")
    .replace(/[\s\-–—_"'׳״.,:;()\[\]{}]+/g, "")
    .trim()
    .toLowerCase();
}

function cleanNumber(value) {
  if (value == null) return 0;
  const raw = String(value)
    .replace(/[₪$,]/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function getKevaTashlumim(tx) {
  if (!tx || typeof tx !== "object") return "";
  // Explicit field from Nedarim Plus for remaining payments in a credit-card standing order.
  // Do not fall back to normal Tashlumim here, because that may mean total months, not remaining months.
  const candidates = [
    tx.KevaTashlumim,
    tx.kevaTashlumim,
    tx.YitratTashloumim,
    tx.YitratTashlumim,
    tx.remainingPayments,
    tx.remainingInstallments
  ];
  for (const value of candidates) {
    if (value === null || value === undefined) continue;
    const str = String(value).trim();
    if (str === "") continue;
    const digits = str.replace(/[^0-9]/g, "");
    return digits !== "" ? digits : str;
  }
  return "";
}

function getAmount(tx) {
  return cleanNumber(
    tx.Amount ?? tx.amount ?? tx.Sum ?? tx.Total ?? tx.Schum ?? tx.SchumHiyuv ?? tx.MonthlyAmount ?? tx.NextTashloum ?? tx.Tashloum ?? tx.HoraahAmount
  );
}

function clampFutureDonationDate(dateObj) {
  if (!dateObj || Number.isNaN(dateObj.getTime())) return "";
  const now = new Date();
  const futureLimit = new Date(now.getTime() + 36 * 60 * 60 * 1000);
  // Nedarim can return DD/MM/YYYY; if parsed incorrectly into a future month, count it by import date.
  if (dateObj > futureLimit) return now.toISOString();
  return dateObj.toISOString();
}

function parseDate(value, { allowFuture = false } = {}) {
  if (!value) return "";
  const raw = String(value).trim();

  const m = raw.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const hour = Number(m[4] || 0);
    const minute = Number(m[5] || 0);
    const second = Number(m[6] || 0);
    const d = new Date(year, month - 1, day, hour, minute, second);
    if (!Number.isNaN(d.getTime())) return allowFuture ? d.toISOString() : clampFutureDonationDate(d);
  }

  const ms = raw.match(/Date\((\d+)\)/i);
  if (ms) {
    const d = new Date(Number(ms[1]));
    if (!Number.isNaN(d.getTime())) return allowFuture ? d.toISOString() : clampFutureDonationDate(d);
  }

  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return allowFuture ? d.toISOString() : clampFutureDonationDate(d);

  return "";
}

function matchesCategory(tx, wantedNormalized) {
  if (!wantedNormalized) return true;
  const fields = [
    tx.Groupe,
    tx.Group,
    tx.Category,
    tx.CampaignName,
    tx.ProjectName,
    tx.MasofName,
    tx.Comments,
    tx.Comment,
    tx.Notes,
    tx.Avour,
    tx.Purpose
  ];
  const haystack = normalizeText(fields.filter(Boolean).join(" "));
  if (!haystack) return false;
  if (haystack.includes(wantedNormalized) || wantedNormalized.includes(haystack)) return true;
  return (haystack.includes("נציבי") || haystack.includes("נציב")) && haystack.includes("דעת") && haystack.includes("אהרן");
}

function transactionKey(tx, index, mosadId) {
  return String(
    tx.TransactionId || tx.transactionId || tx.Id || tx.id || tx.Shovar || tx.Confirmation || tx.KabalaId || `${mosadId}-${Date.now()}-${index}`
  );
}

function kevaKey(tx, index, mosadId) {
  return String(
    tx.KevaId || tx.KevaID || tx.HoraatKevaId || tx.HoraaId || tx.Id || tx.id || tx.ClientId || tx.TokenId || tx.LastNum || `${mosadId}-keva-${Date.now()}-${index}`
  );
}

function detectDonationFrequency(tx, installments) {
  const raw = String(tx.PaymentType || tx.paymentType || tx.TransactionType || tx.transactionType || tx.Type || tx.type || tx.HK || tx.HoraatKeva || tx.Keva || "").trim();
  const joined = [raw, tx.Groupe, tx.Group, tx.Category, tx.Comments, tx.Comment, tx.Notes, tx.MasofName, tx.Avour]
    .filter(Boolean).join(" ").toLowerCase();
  if (/(^|[^a-z])hk([^a-z]|$)|הוראת\s*קבע|קבע|horaat|keva|standing\s*order|recurring/.test(joined)) {
    return { kind: "recurring", label: "הוראת קבע", raw: raw || "HK" };
  }
  return { kind: "one_time", label: "חד פעמית", raw: raw || "Ragil" };
}

function parseMaybeJsonString(value) {
  if (typeof value !== "string") return value;
  const txt = value.replace(/^\uFEFF/, "").trim();
  if (!txt || !/^[\[{]/.test(txt)) return value;
  try { return JSON.parse(txt); } catch (_) { return value; }
}

const TX_KEYS = ["TransactionId", "transactionId", "TransactionTime", "Amount", "ClientName", "Groupe", "KabalaId", "Shovar", "KevaId"];
const KEVA_KEYS = ["KevaId", "KevaID", "HoraatKevaId", "HoraaId", "Day", "StartFrom", "Yitra", "YitratTashloumim", "Bitzua", "LastNum", "NextDate", "NextCharge", "Tashloumim", "KevaTashlumim", "kevaTashlumim", "remainingPayments", "remainingInstallments"];

function collectRows(value, out = [], depth = 0, mode = "transaction") {
  if (depth > 9 || value == null) return out;
  value = parseMaybeJsonString(value);

  if (Array.isArray(value)) {
    for (const item of value) collectRows(item, out, depth + 1, mode);
    return out;
  }

  if (typeof value !== "object") return out;

  const looksLikeTransaction = TX_KEYS.some((k) => Object.prototype.hasOwnProperty.call(value, k));
  const looksLikeKeva = KEVA_KEYS.some((k) => Object.prototype.hasOwnProperty.call(value, k));

  if ((mode === "transaction" && looksLikeTransaction) || (mode === "keva" && (looksLikeKeva || looksLikeTransaction))) {
    out.push(value);
    return out;
  }

  const preferred = ["Data", "data", "History", "history", "Rows", "rows", "Result", "result", "List", "list", "Transactions", "transactions", "Keva", "keva", "Horaot", "horaot", "JsonData", "jsonData", "Table", "table"];
  for (const k of preferred) if (k in value) collectRows(value[k], out, depth + 1, mode);
  for (const k of Object.keys(value)) if (!preferred.includes(k)) collectRows(value[k], out, depth + 1, mode);
  return out;
}

function parseResponse(raw, mode = "transaction") {
  const clean = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!clean) return { parsed: null, rows: [] };
  let parsed;
  try { parsed = JSON.parse(clean); }
  catch (error) {
    const err = new Error("Nedarim response was not valid JSON. Check MosadId/API password/API endpoint.");
    err.statusCode = 502;
    err.raw = clean.slice(0, 1500);
    throw err;
  }
  return { parsed, rows: collectRows(parsed, [], 0, mode) };
}

function isInactiveKeva(tx) {
  const raw = [tx.Status, tx.status, tx.Active, tx.IsActive, tx.Cancelled, tx.Canceled, tx.Bitual, tx.Notes, tx.Comments]
    .filter((v) => v != null).join(" ").toLowerCase();
  return /מבוטל|בוטל|cancel|inactive|לא\s*פעיל|הופסק|false/.test(raw);
}

function mapHistoryToDashboardDonor(tx, index, mosadId) {
  const key = transactionKey(tx, index, mosadId);
  const amount = getAmount(tx);
  const currencyCode = String(tx.Currency || tx.currency || "1").trim();
  const currency = currencyCode === "2" || /dollar|usd|\$|דולר/i.test(currencyCode) ? "USD" : "ILS";
  const installmentsRaw = tx.Tashloumim || tx.Tashlumim || tx.TashloumimCount || tx.Payments || "";
  const installments = Math.max(1, Number(String(installmentsRaw || "1").replace(/[^0-9]/g, "")) || 1);
  const transactionTime = parseDate(tx.TransactionTime || tx.TransactionDate || tx.Date || tx.CreatedAt || tx.Time);
  const category = tx.Groupe || tx.Group || tx.Category || "נציבי דעת אהרן";
  const comments = tx.Comments || tx.Comment || tx.Notes || "";
  const clientName = tx.ClientName || tx.Name || [tx.FirstName, tx.LastName].filter(Boolean).join(" ") || "תורם מנדרים פלוס";
  const frequency = detectDonationFrequency(tx, installments);
  const kevaTashlumim = getKevaTashlumim(tx);
  // In Nedarim GetHistoryJson, regular credit-card installments are reported as:
  // Amount = total transaction amount, Tashloumim/Tashlumim = number of installments.
  // Example from Nedarim UI: Amount=180 and Tashloumim=5 means total deal is 180, each installment is 36.
  // Do NOT multiply Amount × Tashloumim for one-time installments.
  const totalCommitment = amount;
  const monthlyAmount = amount;
  const installmentAmount = frequency.kind === "one_time_installments" && installments > 1
    ? Math.round((amount / installments) * 100) / 100
    : amount;

  return {
    id: `nedarim-${mosadId}-tx-${key}`,
    fullName: clientName,
    phone: tx.Phone || "",
    email: tx.Mail || tx.Email || "",
    address: tx.Adresse || tx.Address || tx.Street || "",
    category,
    isExternalDonation: true,
    importedFromNedarim: true,
    hasDedicationDate: false,
    hebDay: "",
    hebMonth: "",
    memoryContent: comments,
    deceasedName: "",
    status: "paid",
    amount,
    currency,
    paymentProcessor: "Nedarim Plus",
    paymentStatus: "approved",
    paymentApproved: true,
    chargedAmount: amount,
    orderRef: `NED-${key}`,
    paymentType: frequency.raw,
    paymentTypeRaw: frequency.raw,
    donationFrequency: frequency.kind,
    donationFrequencyLabel: frequency.label,
    paymentInstallments: installments,
    installments: installments,
    tashlumim: installments,
    Tashlumim: installments,
    Tashloumim: installments,
    kevaTashlumim: kevaTashlumim,
    KevaTashlumim: kevaTashlumim,
    remainingPayments: kevaTashlumim,
    remainingInstallments: kevaTashlumim,
    monthlyAmount,
    installmentAmount: installmentAmount,
    totalCommitment: totalCommitment,
    totalDonationAmount: totalCommitment,
    currentMonthAmount: amount,
    paymentDate: transactionTime || new Date().toISOString(),
    importedAt: new Date().toISOString(),
    source: "nedarim_external",
    notes: [
      "ייבוא חיצוני מנדרים פלוס - הכנסות",
      `מספר עסקה: ${key}`,
      tx.KevaId ? `מזהה הוראת קבע: ${tx.KevaId}` : "",
      kevaTashlumim !== "" ? `יתרת תשלומים: ${kevaTashlumim}` : "",
      tx.Shovar ? `שובר: ${tx.Shovar}` : "",
      tx.Confirmation ? `אישור: ${tx.Confirmation}` : "",
      tx.MasofName ? `עמדה: ${tx.MasofName}` : "",
      frequency.label ? `סוג תרומה: ${frequency.label}` : "",
      comments ? `הערות נדרים: ${comments}` : ""
    ].filter(Boolean).join(" · "),
    createdAt: transactionTime || new Date().toISOString(),
    rawNedarim: tx
  };
}

function mapKevaToDashboardDonor(tx, index, mosadId) {
  const key = kevaKey(tx, index, mosadId);
  const amount = getAmount(tx);
  const currencyCode = String(tx.Currency || tx.currency || "1").trim();
  const currency = currencyCode === "2" || /dollar|usd|\$|דולר/i.test(currencyCode) ? "USD" : "ILS";
  const installments = Math.max(1, Number(String(tx.Tashloumim || tx.Tashlumim || tx.Payments || tx.YitratTashloumim || "1").replace(/[^0-9]/g, "")) || 1);
  const kevaTashlumim = getKevaTashlumim(tx);
  const category = tx.Groupe || tx.Group || tx.Category || "נציבי דעת אהרן";
  const comments = tx.Comments || tx.Comment || tx.Notes || tx.Avour || "";
  const clientName = tx.ClientName || tx.Name || [tx.FirstName, tx.LastName].filter(Boolean).join(" ") || "תורם הוראת קבע מנדרים פלוס";
  const startDate = parseDate(tx.StartFrom || tx.StartDate || tx.CreatedAt || tx.Date || tx.OpenDate || tx.TransactionTime) || new Date().toISOString();
  const nextChargeDate = parseDate(tx.NextDate || tx.NextCharge || tx.ChargeDate || tx.HiyuvHaba || tx.HiyuvDate || tx.DateHiyuv, { allowFuture: true });
  const dayOfCharge = String(tx.Day || tx.DayC || tx.ChargeDay || tx.HiyuvDay || "").replace(/[^0-9]/g, "");

  return {
    id: `nedarim-${mosadId}-keva-${key}`,
    fullName: clientName,
    phone: tx.Phone || "",
    email: tx.Mail || tx.Email || "",
    address: tx.Adresse || tx.Address || tx.Street || "",
    category,
    isExternalDonation: true,
    importedFromNedarim: true,
    hasDedicationDate: false,
    hebDay: "",
    hebMonth: "",
    memoryContent: comments,
    deceasedName: "",
    status: isInactiveKeva(tx) ? "unpaid" : "paid",
    amount,
    currency,
    paymentProcessor: "Nedarim Plus",
    paymentStatus: isInactiveKeva(tx) ? "inactive" : "approved",
    paymentApproved: !isInactiveKeva(tx),
    chargedAmount: amount,
    orderRef: `NED-HK-${key}`,
    paymentType: "HK",
    paymentTypeRaw: "HK",
    donationFrequency: "recurring",
    donationFrequencyLabel: "הוראת קבע",
    paymentInstallments: installments,
    kevaTashlumim: kevaTashlumim,
    KevaTashlumim: kevaTashlumim,
    remainingPayments: kevaTashlumim,
    remainingInstallments: kevaTashlumim,
    remainingCharges: kevaTashlumim,
    monthlyAmount: amount,
    installmentAmount: amount,
    totalCommitment: amount,
    currentMonthAmount: amount,
    paymentDate: startDate,
    startDate,
    nextChargeDate,
    dayOfCharge,
    importedAt: new Date().toISOString(),
    source: "nedarim_recurring",
    notes: [
      "ייבוא חיצוני מנדרים פלוס - הוראת קבע",
      `מזהה הוראת קבע: ${key}`,
      kevaTashlumim !== "" ? `יתרת תשלומים: ${kevaTashlumim}` : "",
      dayOfCharge ? `יום חיוב: ${dayOfCharge}` : "",
      nextChargeDate ? `חיוב הבא: ${nextChargeDate.slice(0, 10)}` : "",
      tx.LastNum ? `כרטיס: *${tx.LastNum}` : "",
      comments ? `הערות נדרים: ${comments}` : ""
    ].filter(Boolean).join(" · "),
    createdAt: startDate,
    rawNedarim: tx
  };
}

function groupSummary(rows) {
  const map = new Map();
  for (const tx of rows || []) {
    const group = String(tx.Groupe || tx.Group || tx.Category || "(ללא קטגוריה)").trim();
    map.set(group, (map.get(group) || 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([name, count]) => ({ name, count }));
}

async function fetchHistoryPage({ mosadId, apiPassword, lastId, maxId, omitLastId }) {
  const url = new URL(NEDARIM_HISTORY_URL);
  url.searchParams.set("Action", "GetHistoryJson");
  url.searchParams.set("MosadId", mosadId);
  url.searchParams.set("ApiPassword", apiPassword);
  if (!omitLastId && lastId !== "" && lastId != null) url.searchParams.set("LastId", String(lastId));
  if (maxId !== "" && maxId != null) url.searchParams.set("MaxId", String(maxId));

  const response = await fetch(url.toString(), { method: "GET", headers: { "Accept": "application/json,text/plain,*/*" } });
  const raw = (await response.text()).replace(/^\uFEFF/, "").trim();
  if (!response.ok) {
    const err = new Error("Nedarim GetHistoryJson request failed.");
    err.statusCode = response.status;
    err.raw = raw.slice(0, 1500);
    throw err;
  }
  const { parsed, rows } = parseResponse(raw, "transaction");
  return { parsed, rows, rawPreview: raw.slice(0, 900), requestUrl: url.toString().replace(/ApiPassword=[^&]*/i, "ApiPassword=***") };
}

async function tryFetchKeva({ mosadId, apiPassword, maxId, debug }) {
  const endpoints = (process.env.NEDARIM_KEVA_URL ? [process.env.NEDARIM_KEVA_URL] : DEFAULT_KEVA_ENDPOINTS);
  const actions = (process.env.NEDARIM_KEVA_ACTION ? [process.env.NEDARIM_KEVA_ACTION] : DEFAULT_KEVA_ACTIONS);
  const attempts = [];

  for (const endpoint of endpoints) {
    for (const action of actions) {
      const url = new URL(endpoint);
      url.searchParams.set("Action", action);
      url.searchParams.set("MosadId", mosadId);
      url.searchParams.set("ApiPassword", apiPassword);
      if (maxId) url.searchParams.set("MaxId", String(maxId));
      try {
        const response = await fetch(url.toString(), { method: "GET", headers: { "Accept": "application/json,text/plain,*/*" } });
        const raw = (await response.text()).replace(/^\uFEFF/, "").trim();
        let rows = [];
        let parseError = "";
        if (response.ok) {
          try { rows = parseResponse(raw, "keva").rows; }
          catch (e) { parseError = e.message; }
        }
        attempts.push({
          endpoint,
          action,
          ok: response.ok,
          status: response.status,
          rows: rows.length,
          parseError: parseError || undefined,
          preview: debug ? raw.slice(0, 240) : undefined
        });
        if (response.ok && rows.length) {
          return { rows, endpoint, action, attempts };
        }
      } catch (error) {
        attempts.push({ endpoint, action, ok: false, error: error.message });
      }
    }
  }
  return { rows: [], endpoint: "", action: "", attempts };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return json(200, { success: true });
  if (event.httpMethod !== "GET") return json(405, { success: false, message: "Method not allowed. Use GET." });

  const query = event.queryStringParameters || {};
  const mosadId = process.env.NEDARIM_MOSAD_ID || "7018563";
  const apiPassword = process.env.NEDARIM_API_PASSWORD;
  const category = query.category || process.env.NEDARIM_CATEGORY || "נציבי דעת אהרן";
  const wanted = normalizeText(category);
  const full = query.full === "1" || query.full === "true" || query.full == null;
  const maxId = Number(query.maxId || process.env.NEDARIM_MAX_ID || 500) || 500;
  const pages = Math.max(1, Math.min(Number(query.pages || process.env.NEDARIM_IMPORT_PAGES || (full ? 20 : 1)) || 1, 50));
  const debug = query.debug === "1" || query.debug === "true";
  const includeKeva = query.includeKeva !== "0" && query.includeKeva !== "false";

  if (!apiPassword) {
    return json(500, { success: false, message: "Missing NEDARIM_API_PASSWORD environment variable. Do not put the API password in frontend code." });
  }

  try {
    // 1) Completed income transactions: the Nedarim income report / הכנסות.
    const allRows = [];
    let lastId = full ? "" : (query.lastId || "");
    let maxTransactionId = Number(query.lastId || 0) || 0;
    let pagesFetched = 0;
    let lastRawPreview = "";
    let lastRequestUrl = "";

    for (let page = 0; page < pages; page += 1) {
      const omitLastId = full && page === 0 && !query.lastId;
      const { rows, rawPreview, requestUrl } = await fetchHistoryPage({ mosadId, apiPassword, lastId, maxId, omitLastId });
      pagesFetched += 1;
      lastRawPreview = rawPreview;
      lastRequestUrl = requestUrl;
      if (!rows.length) break;
      allRows.push(...rows);
      const pageMax = rows.reduce((max, tx) => {
        const n = Number(tx.TransactionId || tx.transactionId || tx.Id || 0);
        return Number.isFinite(n) && n > max ? n : max;
      }, Number(maxTransactionId) || 0);
      if (!pageMax || pageMax <= (Number(lastId) || 0)) break;
      maxTransactionId = Math.max(Number(maxTransactionId) || 0, pageMax);
      lastId = String(pageMax);
      if (rows.length < maxId) break;
    }

    const filteredHistory = allRows.filter((tx) => matchesCategory(tx, wanted));
    const historyDonors = filteredHistory.map((tx, index) => mapHistoryToDashboardDonor(tx, index, mosadId));

    // 2) Active credit-card standing orders: the Nedarim הוראות קבע - אשראי screen.
    let kevaRows = [];
    let filteredKeva = [];
    let kevaDonors = [];
    let kevaInfo = { endpoint: "", action: "", attempts: [] };

    if (includeKeva) {
      kevaInfo = await tryFetchKeva({ mosadId, apiPassword, maxId, debug });
      kevaRows = kevaInfo.rows || [];
      filteredKeva = kevaRows.filter((tx) => !isInactiveKeva(tx) && matchesCategory(tx, wanted));
      kevaDonors = filteredKeva.map((tx, index) => mapKevaToDashboardDonor(tx, index, mosadId));
    }

    const donors = [...historyDonors, ...kevaDonors];

    return json(200, {
      success: true,
      mosadId,
      category,
      full,
      pagesFetched,
      fetched: allRows.length,
      imported: donors.length,
      importedHistory: historyDonors.length,
      fetchedKeva: kevaRows.length,
      importedKeva: kevaDonors.length,
      kevaEndpoint: kevaInfo.endpoint,
      kevaAction: kevaInfo.action,
      maxTransactionId,
      groups: groupSummary(allRows),
      kevaGroups: groupSummary(kevaRows),
      donors,
      debug: debug ? {
        historyRequestUrl: lastRequestUrl,
        historyRawPreview: lastRawPreview,
        historyFirstRowKeys: allRows[0] ? Object.keys(allRows[0]).slice(0, 80) : [],
        kevaAttempts: kevaInfo.attempts,
        kevaFirstRowKeys: kevaRows[0] ? Object.keys(kevaRows[0]).slice(0, 100) : []
      } : undefined
    });
  } catch (error) {
    return json(error.statusCode || 500, { success: false, message: error.message, raw: error.raw || undefined });
  }
};
