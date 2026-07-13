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

function numericDigits(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.max(0, Math.trunc(value)));
  if (typeof value !== "string") return "";
  const str = value.trim();
  if (!str) return "";
  // Accept a plain integer or a label such as "יתרת חיובים: 99".
  const direct = str.match(/^\s*(\d{1,6})\s*$/);
  if (direct) return direct[1];
  const labeled = str.match(/(?:יתרת\s*(?:חיובים|תשלומים|חיוב)|remaining\s*(?:payments|installments|charges)|keva\s*tashl(?:u|ou)mim)\D{0,12}(\d{1,6})/i);
  return labeled ? labeled[1] : "";
}

function normalizeKevaKey(key) {
  return String(key || "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/[^a-zA-Z0-9א-ת]/g, "")
    .toLowerCase();
}

function getKevaTashlumim(tx) {
  if (!tx || typeof tx !== "object") return "";

  const exactKeys = new Set([
    "kevatahlumim", "kevatashlumim", "kevatashloumim",
    "yitrattashloumim", "yitrattashlumim", "yitra",
    "yitratchiyuvim", "yitrathiyuvim", "yitrathiuvim",
    "remainingpayments", "remaininginstallments", "remainingcharges",
    "tashlumimleft", "tashloumimleft",
    "יתרתחיובים", "יתרתתשלומים", "יתרתחיוב", "יתרהלחיוב", "יתרהלתשלום"
  ]);

  const seen = new Set();
  function walk(value, depth) {
    if (depth > 10 || value === null || value === undefined) return "";

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^[\[{]/.test(trimmed)) {
        try { return walk(JSON.parse(trimmed), depth + 1); } catch (_) {}
      }
      return "";
    }
    if (typeof value !== "object") return "";
    if (seen.has(value)) return "";
    seen.add(value);

    // First pass: exact keys, including values nested inside wrappers returned by Nedarim.
    for (const [key, fieldValue] of Object.entries(value)) {
      const nk = normalizeKevaKey(key);
      if (exactKeys.has(nk)) {
        const n = numericDigits(fieldValue);
        if (n !== "") return n;
        const nested = walk(fieldValue, depth + 1);
        if (nested !== "") return nested;
      }
    }

    // Second pass: tolerate API spelling variants, but only when the key clearly refers to a balance/count.
    for (const [key, fieldValue] of Object.entries(value)) {
      const nk = normalizeKevaKey(key);
      const isBalanceKey =
        (/remaining/.test(nk) && /(payment|installment|charge)/.test(nk)) ||
        (/yitrat|yitra/.test(nk) && /(tash|chiyuv|hiyuv|hiuv)/.test(nk)) ||
        (/keva/.test(nk) && /tash/.test(nk)) ||
        (/יתרת|יתרה/.test(nk) && /(תשלום|חיוב)/.test(nk));
      if (isBalanceKey) {
        const n = numericDigits(fieldValue);
        if (n !== "") return n;
      }
    }

    // Third pass: recursively inspect children.
    for (const child of Object.values(value)) {
      const found = walk(child, depth + 1);
      if (found !== "") return found;
    }
    return "";
  }

  const found = walk(tx, 0);
  if (found !== "") return found;

  // Last fallback: sometimes the dashboard already has the value only in the note text.
  return numericDigits([tx.Notes, tx.notes, tx.Comments, tx.Comment].filter(Boolean).join(" · "));
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


function hasCategorySignal(tx) {
  return [
    tx.Groupe, tx.Group, tx.Category, tx.CampaignName, tx.ProjectName,
    tx.MasofName, tx.Avour, tx.Purpose
  ].some((value) => value != null && String(value).trim() !== "");
}

function matchesKevaCategory(tx, wantedNormalized) {
  if (!wantedNormalized) return true;
  // The standing-orders screen often omits the campaign/category entirely.
  // In that case the row belongs to the selected institution and should not be discarded.
  if (!hasCategorySignal(tx)) return true;
  return matchesCategory(tx, wantedNormalized);
}

function stableExternalKey(donor) {
  const raw = donor && donor.rawNedarim && typeof donor.rawNedarim === "object" ? donor.rawNedarim : {};
  const kevaId = donor && (
    donor.KevaId || donor.kevaId || donor.standingOrderId || donor.recurringId ||
    raw.KevaId || raw.KevaID || raw.HoraatKevaId || raw.HoraaId
  );
  if (kevaId != null && String(kevaId).trim() !== "") return `keva:${String(kevaId).trim()}`;

  const txId = donor && (
    donor.transactionId || donor.TransactionId ||
    raw.TransactionId || raw.transactionId || raw.Id
  );
  if (txId != null && String(txId).trim() !== "") return `tx:${String(txId).trim()}`;

  return String(donor && donor.id || "");
}

function dedupeDonors(donors) {
  const map = new Map();
  for (const donor of donors || []) {
    const key = stableExternalKey(donor) || String(donor.id || Math.random());
    const previous = map.get(key);
    // Prefer an active standing-order record over a completed history charge with the same KevaId.
    if (!previous || donor.source === "nedarim_recurring") map.set(key, donor);
  }
  return Array.from(map.values());
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
  const raw = String(
    tx.PaymentType || tx.paymentType || tx.TransactionType || tx.transactionType ||
    tx.Type || tx.type || tx.HK || tx.HoraatKeva || tx.Keva || ""
  ).trim();

  const joined = [
    raw, tx.Groupe, tx.Group, tx.Category, tx.Comments, tx.Comment,
    tx.Notes, tx.MasofName, tx.Avour
  ].filter(Boolean).join(" ").toLowerCase();

  if (/(^|[^a-z])hk([^a-z]|$)|הוראת\s*קבע|קבע|horaat|keva|standing\s*order|recurring/.test(joined)) {
    return { kind: "recurring", label: "הוראת קבע", raw: raw || "HK" };
  }

  // A regular card transaction remains a one-time donation even when Nedarim divided it
  // into several installments. The dashboard intentionally shows only the final total.
  return { kind: "one_time", label: "חד פעמית", raw: raw || "Ragil" };
}

function parseMaybeJsonString(value) {
  if (typeof value !== "string") return value;
  const txt = value.replace(/^\uFEFF/, "").trim();
  if (!txt || !/^[\[{]/.test(txt)) return value;
  try { return JSON.parse(txt); } catch (_) { return value; }
}

const TX_KEYS = ["TransactionId", "transactionId", "TransactionTime", "Amount", "ClientName", "Groupe", "KabalaId", "Shovar", "KevaId"];

// IMPORTANT: these are identity/row fields, not every possible balance field.
// A previous version included broad keys such as "יתרה" here. That caused wrapper objects
// returned by Nedarim to be mistaken for an actual standing-order row, so recursion stopped
// before reaching the real orders and importedKeva became 0.
const KEVA_ID_KEYS = ["KevaId", "KevaID", "HoraatKevaId", "HoraaId", "StandingOrderId", "RecurringId"];
const KEVA_ROW_HINT_KEYS = [
  "ClientName", "Name", "FirstName", "Phone", "Mail", "Amount", "SchumHiyuv",
  "KevaAmount", "StartFrom", "NextDate", "LastNum", "PaymentType", "Groupe", "Category"
];
const KEVA_BALANCE_KEYS = [
  "KevaTashlumim", "kevaTashlumim", "KevaTashloumim", "kevaTashloumim",
  "YitratTashloumim", "YitratTashlumim", "Yitra", "YitratChiyuvim",
  "YitratHiyuvim", "YitratHiuvim", "RemainingPayments", "RemainingInstallments",
  "RemainingCharges", "remainingPayments", "remainingInstallments", "remainingCharges",
  "יתרת חיובים", "יתרת תשלומים", "יתרת חיוב", "יתרה לחיוב", "יתרה לתשלום", "יתרה"
];

function looksLikeActualKevaRow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const hasId = KEVA_ID_KEYS.some((k) => Object.prototype.hasOwnProperty.call(value, k) && String(value[k] ?? '').trim() !== '');
  const hintCount = KEVA_ROW_HINT_KEYS.reduce((n, k) => n + (Object.prototype.hasOwnProperty.call(value, k) && String(value[k] ?? '').trim() !== '' ? 1 : 0), 0);
  const hasBalance = KEVA_BALANCE_KEYS.some((k) => Object.prototype.hasOwnProperty.call(value, k) && String(value[k] ?? '').trim() !== '');
  const paymentType = String(value.PaymentType || value.paymentType || value.TransactionType || '').toLowerCase();
  const recurringMarker = /(^|[^a-z])hk([^a-z]|$)|keva|horaat|recurring|הוראת\s*קבע|קבע/.test(paymentType + ' ' + String(value.Notes || value.Comments || ''));

  // An explicit standing-order ID is sufficient. Otherwise require at least two real row hints,
  // plus either a balance field or an explicit recurring marker.
  return hasId || (hintCount >= 2 && (hasBalance || recurringMarker));
}

function collectRows(value, out = [], depth = 0, mode = "transaction") {
  if (depth > 12 || value == null) return out;
  value = parseMaybeJsonString(value);

  if (Array.isArray(value)) {
    for (const item of value) collectRows(item, out, depth + 1, mode);
    return out;
  }

  if (typeof value !== "object") return out;

  const preferred = [
    "Data", "data", "History", "history", "Rows", "rows", "Result", "result",
    "List", "list", "Transactions", "transactions", "Keva", "keva",
    "Horaot", "horaot", "JsonData", "jsonData", "Table", "table",
    "Items", "items", "Records", "records"
  ];

  const looksLikeTransaction = TX_KEYS.some((k) =>
    Object.prototype.hasOwnProperty.call(value, k)
  );
  const looksLikeKeva = looksLikeActualKevaRow(value);
  const hasExplicitKevaId = KEVA_ID_KEYS.some((k) =>
    Object.prototype.hasOwnProperty.call(value, k) && String(value[k] ?? "").trim() !== ""
  );
  const hasNestedContainer = preferred.some((k) => {
    if (!Object.prototype.hasOwnProperty.call(value, k)) return false;
    const nested = parseMaybeJsonString(value[k]);
    return Array.isArray(nested) || (nested && typeof nested === "object");
  });

  if (mode === "transaction" && looksLikeTransaction) {
    out.push(value);
  }

  if (mode === "keva" && looksLikeKeva) {
    // Nedarim sometimes wraps the real standing-order rows inside an object that also
    // contains summary fields. Do not treat that wrapper as a donor unless it has an
    // explicit standing-order ID. Most importantly, continue traversing nested values.
    if (!hasNestedContainer || hasExplicitKevaId) out.push(value);
  }

  for (const k of preferred) {
    if (Object.prototype.hasOwnProperty.call(value, k)) {
      collectRows(value[k], out, depth + 1, mode);
    }
  }
  for (const k of Object.keys(value)) {
    if (!preferred.includes(k)) collectRows(value[k], out, depth + 1, mode);
  }

  return out;
}

function parseResponse(raw, mode = "transaction") {
  const clean = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!clean) return { parsed: null, rows: [] };

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (error) {
    const err = new Error("Nedarim response was not valid JSON. Check MosadId/API password/API endpoint.");
    err.statusCode = 502;
    err.raw = clean.slice(0, 1500);
    throw err;
  }

  const collected = collectRows(parsed, [], 0, mode);
  const seen = new Set();
  const rows = collected.filter((row, index) => {
    if (!row || typeof row !== "object") return false;
    const key = mode === "keva"
      ? String(row.KevaId || row.KevaID || row.HoraatKevaId || row.HoraaId || row.StandingOrderId || row.RecurringId || row.Id || row.id || `${row.ClientName || row.Name || ""}|${row.Phone || ""}|${row.Amount || row.SchumHiyuv || ""}|${index}`)
      : String(row.TransactionId || row.transactionId || row.Id || row.id || row.Shovar || row.KabalaId || `${row.ClientName || row.Name || ""}|${row.Amount || ""}|${row.TransactionTime || ""}|${index}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { parsed, rows };
}

function boolish(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (/^(true|1|yes|y|כן|פעיל|active)$/.test(text)) return true;
  if (/^(false|0|no|n|לא|לא פעיל|inactive)$/.test(text)) return false;
  return null;
}

function isInactiveKeva(tx) {
  tx = tx || {};

  const activeValues = [tx.Active, tx.active, tx.IsActive, tx.isActive];
  for (const value of activeValues) {
    const parsed = boolish(value);
    if (parsed === false) return true;
  }

  const cancelledValues = [
    tx.Cancelled, tx.cancelled, tx.Canceled, tx.canceled,
    tx.IsCancelled, tx.isCancelled, tx.IsCanceled, tx.isCanceled,
    tx.Bitual, tx.Bitul
  ];
  for (const value of cancelledValues) {
    const parsed = boolish(value);
    if (parsed === true) return true;
  }

  const statusText = [
    tx.Status, tx.status, tx.State, tx.state,
    tx.Notes, tx.notes, tx.Comments, tx.Comment
  ].filter((v) => v != null && String(v).trim() !== "").join(" ").toLowerCase();

  return /מבוטל|בוטל|הופסק|מוקפא|לא\s*פעיל|cancel(?:led|ed)?|inactive|stopped|suspended/.test(statusText);
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
  // For a regular transaction, Amount is already the final total amount.
  // Installment details are intentionally not displayed or used for categorization.
  const installmentAmount = amount;

  return {
    id: `nedarim-${mosadId}-tx-${key}`,
    transactionId: key,
    TransactionId: key,
    KevaId: tx.KevaId || tx.KevaID || "",
    kevaId: tx.KevaId || tx.KevaID || "",
    fullName: clientName,
    donorName: clientName,
    phone: tx.Phone || "",
    email: tx.Mail || tx.Email || "",
    address: tx.Adresse || tx.Address || tx.Street || "",
    category,
    isExternalDonation: true,
    externalDonation: true,
    isExternalNedarim: true,
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
    paymentsCount: installments,
    tashlumimCount: installments,
    totalPayments: installments,
    totalInstallments: installments,
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
    source: frequency.kind === "recurring" ? "nedarim_recurring_history" : "nedarim_external",
    donationSource: frequency.kind === "recurring" ? "nedarim_recurring_history" : "nedarim_external",
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
  const kevaTashlumim = getKevaTashlumim(tx);
  const explicitInstallments = numericDigits(
    tx.TotalPayments ?? tx.TotalInstallments ?? tx.PaymentsCount ??
    tx.Tashloumim ?? tx.Tashlumim ?? tx.Payments ?? ""
  );
  const recurringCount = kevaTashlumim || explicitInstallments || "";
  const installments = Math.max(1, Number(recurringCount || 1) || 1);
  const category = tx.Groupe || tx.Group || tx.Category || "נציבי דעת אהרן";
  const comments = tx.Comments || tx.Comment || tx.Notes || tx.Avour || "";
  const clientName = tx.ClientName || tx.Name || [tx.FirstName, tx.LastName].filter(Boolean).join(" ") || "תורם הוראת קבע מנדרים פלוס";
  const startDate = parseDate(tx.StartFrom || tx.StartDate || tx.CreatedAt || tx.Date || tx.OpenDate || tx.TransactionTime, { allowFuture: true }) || new Date().toISOString();
  const nextChargeDate = parseDate(tx.NextDate || tx.NextCharge || tx.ChargeDate || tx.HiyuvHaba || tx.HiyuvDate || tx.DateHiyuv, { allowFuture: true });
  const dayOfCharge = String(tx.Day || tx.DayC || tx.ChargeDay || tx.HiyuvDay || "").replace(/[^0-9]/g, "");
  const inactive = isInactiveKeva(tx);
  const totalCommitment = recurringCount ? amount * Number(recurringCount) : amount;

  return {
    id: `nedarim-${mosadId}-keva-${key}`,
    KevaId: key,
    kevaId: key,
    standingOrderId: key,
    recurringId: key,
    fullName: clientName,
    donorName: clientName,
    phone: tx.Phone || "",
    email: tx.Mail || tx.Email || "",
    address: tx.Adresse || tx.Address || tx.Street || "",
    category,
    isExternalDonation: true,
    externalDonation: true,
    isExternalNedarim: true,
    importedFromNedarim: true,
    activeStandingOrder: !inactive,
    hasDedicationDate: false,
    hebDay: "",
    hebMonth: "",
    memoryContent: comments,
    deceasedName: "",
    status: inactive ? "unpaid" : "paid",
    amount,
    currency,
    paymentProcessor: "Nedarim Plus",
    processor: "Nedarim Plus",
    paymentStatus: inactive ? "inactive" : "approved",
    paymentApproved: !inactive,
    chargedAmount: amount,
    orderRef: `NED-HK-${key}`,
    paymentType: "HK",
    paymentTypeRaw: "HK",
    donationFrequency: "recurring",
    donationFrequencyLabel: "הוראת קבע",
    paymentInstallments: installments,
    installments,
    tashlumim: installments,
    Tashlumim: installments,
    Tashloumim: installments,
    paymentsCount: installments,
    tashlumimCount: installments,
    kevaTashlumim: recurringCount,
    KevaTashlumim: recurringCount,
    remainingPayments: recurringCount,
    remainingInstallments: recurringCount,
    remainingCharges: recurringCount,
    totalPayments: explicitInstallments || recurringCount,
    totalInstallments: explicitInstallments || recurringCount,
    monthlyAmount: amount,
    KevaAmount: amount,
    kevaAmount: amount,
    installmentAmount: amount,
    totalCommitment,
    totalDonationAmount: totalCommitment,
    currentMonthAmount: amount,
    paymentDate: startDate,
    donationDate: startDate,
    startDate,
    nextChargeDate,
    dayOfCharge,
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "nedarim_recurring",
    donationSource: "nedarim_recurring",
    notes: [
      "ייבוא חיצוני מנדרים פלוס - הוראת קבע",
      `מזהה הוראת קבע: ${key}`,
      recurringCount !== "" ? `יתרת תשלומים: ${recurringCount}` : "",
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function kevaCandidates() {
  const configuredUrl = process.env.NEDARIM_KEVA_URL;
  const configuredAction = process.env.NEDARIM_KEVA_ACTION;

  if (configuredUrl && configuredAction) {
    return [{ endpoint: configuredUrl, action: configuredAction, configured: true }];
  }

  const endpoints = configuredUrl ? [configuredUrl] : DEFAULT_KEVA_ENDPOINTS;
  const actions = configuredAction ? [configuredAction] : DEFAULT_KEVA_ACTIONS;
  const preferred = [];

  // Try the most plausible combinations first. This avoids dozens of sequential requests.
  const preferredActions = [
    "GetKevaJson", "GetHoraotKevaJson", "GetHoraatKevaJson",
    "GetKevaListJson", "GetHKJson", "GetStandingOrdersJson"
  ];
  const orderedActions = [...new Set([...preferredActions, ...actions])];

  for (const endpoint of endpoints) {
    for (const action of orderedActions) {
      preferred.push({ endpoint, action, configured: Boolean(configuredUrl || configuredAction) });
    }
  }
  return preferred;
}

async function tryFetchKeva({ mosadId, apiPassword, maxId, debug }) {
  const attempts = [];
  const candidates = kevaCandidates();
  const maxAttempts = Math.max(1, Math.min(Number(process.env.NEDARIM_KEVA_MAX_ATTEMPTS || 18) || 18, 40));
  const perRequestTimeout = Math.max(1000, Math.min(Number(process.env.NEDARIM_KEVA_TIMEOUT_MS || 3500) || 3500, 8000));
  const overallTimeout = Math.max(3000, Math.min(Number(process.env.NEDARIM_KEVA_TOTAL_TIMEOUT_MS || 12000) || 12000, 22000));
  const deadline = Date.now() + overallTimeout;

  for (const candidate of candidates.slice(0, maxAttempts)) {
    if (Date.now() >= deadline) {
      attempts.push({ skipped: true, reason: "overall timeout reached" });
      break;
    }

    const { endpoint, action } = candidate;
    const url = new URL(endpoint);
    url.searchParams.set("Action", action);
    url.searchParams.set("MosadId", mosadId);
    url.searchParams.set("ApiPassword", apiPassword);
    if (maxId) url.searchParams.set("MaxId", String(maxId));

    try {
      const remaining = Math.max(500, deadline - Date.now());
      const timeoutMs = Math.min(perRequestTimeout, remaining);
      const response = await fetchWithTimeout(
        url.toString(),
        { method: "GET", headers: { "Accept": "application/json,text/plain,*/*" } },
        timeoutMs
      );
      const raw = (await response.text()).replace(/^\uFEFF/, "").trim();
      let rows = [];
      let parseError = "";

      if (response.ok && raw) {
        try {
          rows = parseResponse(raw, "keva").rows;
        } catch (error) {
          parseError = error.message;
        }
      }

      attempts.push({
        endpoint,
        action,
        ok: response.ok,
        status: response.status,
        rows: rows.length,
        parseError: parseError || undefined,
        preview: debug ? raw.slice(0, 300) : undefined
      });

      if (response.ok && rows.length) {
        return { rows, endpoint, action, attempts, warning: "" };
      }
    } catch (error) {
      attempts.push({
        endpoint,
        action,
        ok: false,
        error: error && error.name === "AbortError" ? "request timeout" : String(error.message || error)
      });
    }
  }

  const configured = Boolean(process.env.NEDARIM_KEVA_URL || process.env.NEDARIM_KEVA_ACTION);
  return {
    rows: [],
    endpoint: "",
    action: "",
    attempts,
    warning: configured
      ? "The configured standing-orders endpoint returned no rows."
      : "No documented standing-orders endpoint is configured. History donations were still imported."
  };
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

    const uniqueHistoryRows = [];
    const historySeen = new Set();
    for (const tx of allRows) {
      const key = transactionKey(tx, uniqueHistoryRows.length, mosadId);
      if (historySeen.has(key)) continue;
      historySeen.add(key);
      uniqueHistoryRows.push(tx);
    }

    const filteredHistory = uniqueHistoryRows.filter((tx) => matchesCategory(tx, wanted));
    const historyDonors = filteredHistory.map((tx, index) => mapHistoryToDashboardDonor(tx, index, mosadId));

    // 2) Active credit-card standing orders: the Nedarim הוראות קבע - אשראי screen.
    let kevaRows = [];
    let filteredKeva = [];
    let kevaDonors = [];
    let kevaInfo = { endpoint: "", action: "", attempts: [] };

    if (includeKeva) {
      kevaInfo = await tryFetchKeva({ mosadId, apiPassword, maxId, debug });
      kevaRows = kevaInfo.rows || [];
      filteredKeva = kevaRows.filter((tx) => !isInactiveKeva(tx) && matchesKevaCategory(tx, wanted));
      kevaDonors = filteredKeva.map((tx, index) => mapKevaToDashboardDonor(tx, index, mosadId));
    }

    const donors = dedupeDonors([...historyDonors, ...kevaDonors]);

    return json(200, {
      success: true,
      mosadId,
      category,
      full,
      pagesFetched,
      fetched: uniqueHistoryRows.length,
      imported: donors.length,
      importedHistory: historyDonors.length,
      fetchedKeva: kevaRows.length,
      importedKeva: kevaDonors.length,
      kevaEndpoint: kevaInfo.endpoint,
      kevaAction: kevaInfo.action,
      kevaWarning: kevaInfo.warning || "",
      maxTransactionId,
      groups: groupSummary(uniqueHistoryRows),
      kevaGroups: groupSummary(kevaRows),
      donors,
      debug: debug ? {
        historyRequestUrl: lastRequestUrl,
        historyRawPreview: lastRawPreview,
        historyFirstRowKeys: uniqueHistoryRows[0] ? Object.keys(uniqueHistoryRows[0]).slice(0, 80) : [],
        kevaAttempts: kevaInfo.attempts,
        kevaFirstRowKeys: kevaRows[0] ? Object.keys(kevaRows[0]).slice(0, 100) : [],
        kevaFirstRowPreview: kevaRows[0] || null,
        kevaMatchedCount: filteredKeva.length
      } : undefined
    });
  } catch (error) {
    return json(error.statusCode || 500, { success: false, message: error.message, raw: error.raw || undefined });
  }
};
