/* Dashboard data core v7 — official Nedarim Keva field mapping; Google Sheets is the single source of truth. */
(function () {
  'use strict';

  function cleanText(value) { return String(value == null ? '' : value).trim(); }
  function numberValue(value) {
    const n = Number(String(value == null ? '' : value).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  function isRecurringDonation(d) {
    const raw = (d && d.rawNedarim && typeof d.rawNedarim === 'object') ? d.rawNedarim : {};
    const text = [
      d && d.donationFrequency, d && d.donationFrequencyLabel, d && d.paymentType,
      d && d.paymentTypeRaw, d && d.source, d && d.TransactionType,
      raw.TransactionType, raw.PaymentType
    ].filter(Boolean).join(' ').toLowerCase();
    const kevaId = cleanText(d && (d.kevaId || d.KevaId || raw.KevaId || raw.KevaID));
    return kevaId !== '' || text.includes('recurring') || text.includes('הוראת קבע') ||
      /(^|[^a-z])hk([^a-z]|$)/.test(text) || /הו["״׳']?ק|(^|\s)קבע(\s|$)|keva|horaat/.test(text);
  }
  function normalizeDashboardDonation(input) {
    const d = Object.assign({}, input || {});
    const raw = (d.rawNedarim && typeof d.rawNedarim === 'object') ? d.rawNedarim : {};
    const recurring = isRecurringDonation(d);
    const placeholder = function (value) {
      return /^(?:|תורם הוראת קבע|תורם ללא שם|תורם מנדרים פלוס|תורם)$/.test(cleanText(value).replace(/\s+/g, ' '));
    };
    const pickName = function () {
      const values = [d.KevaName, raw.KevaName, d.ClientName, raw.ClientName, raw.Name, d.fullName];
      for (const value of values) if (!placeholder(value)) return cleanText(value);
      return 'תורם ללא שם';
    };
    const positiveNumber = function (values) {
      for (const value of values) { const n = numberValue(value); if (n > 0) return n; }
      return 0;
    };

    d.id = cleanText(d.id || d.externalId || d.kevaId || d.KevaId || d.orderRef);
    d.fullName = pickName();
    d.donorName = '';
    d.honoreeName = '';
    d.amount = recurring
      ? positiveNumber([d.KevaAmount, raw.KevaAmount, d.Amount, raw.Amount, d.monthlyAmount, d.currentMonthAmount, d.amount])
      : numberValue(d.amount || d.Amount || raw.Amount || d.chargedAmount);
    d.currency = cleanText(d.currency || d.KevaCurrency || raw.KevaCurrency || raw.Currency || 'ILS').toUpperCase() === 'USD' || String(d.currency || raw.Currency) === '2' ? 'USD' : 'ILS';
    d.paymentDate = cleanText(recurring
      ? (d.CreatedDate || raw.CreatedDate || d.CreationDate || raw.CreationDate || d.paymentDate || d.createdAt)
      : (d.paymentDate || d.TransactionTime || raw.TransactionTime || d.createdAt));
    d.createdAt = cleanText(d.createdAt || d.paymentDate);
    d.paymentProcessor = cleanText(d.paymentProcessor || 'Nedarim Plus');
    d.source = cleanText(d.source || (cleanText(d.kevaId || d.KevaId || raw.KevaId) ? 'nedarim_recurring' : 'nedarim'));
    d.status = cleanText(d.status || 'paid');
    d.paymentStatus = cleanText(d.paymentStatus || 'approved');
    d.paymentApproved = d.paymentApproved !== false;
    d.hebDay = cleanText(d.hebDay);
    d.hebMonth = cleanText(d.hebMonth);
    d.kevaId = cleanText(d.kevaId || d.KevaId || raw.KevaId || raw.KevaID);
    d.phone = cleanText(d.KevaPhone || raw.KevaPhone || d.Phone || raw.Phone || d.phone);
    d.email = cleanText(d.KevaMail || raw.KevaMail || d.Mail || raw.Mail || raw.Email || d.email);
    d.address = cleanText(d.KevaAdresse || raw.KevaAdresse || d.Adresse || raw.Adresse || raw.Address || d.address);
    d.city = cleanText(d.KevaCity || raw.KevaCity || d.City || raw.City || d.city);
    d.category = cleanText(d.KevaGroupe || raw.KevaGroupe || d.Groupe || raw.Groupe || raw.Group || d.category);
    d.notes = cleanText(d.KevaAvour || raw.KevaAvour || d.Comments || raw.Comments || raw.Notes || d.notes);

    if (recurring) {
      d.donationFrequency = 'recurring';
      d.donationFrequencyLabel = 'הוראת קבע';
      d.paymentType = 'HK';
      d.kevaStatus = cleanText(d.KevaStatus || raw.KevaStatus || d.kevaStatus);
      if (d.kevaStatus === '2') { d.status = 'frozen'; d.paymentStatus = 'frozen'; d.paymentApproved = false; }
      else if (d.kevaStatus === '3') { d.status = 'deleted'; d.paymentStatus = 'deleted'; d.paymentApproved = false; }
      else if (d.kevaStatus === '1') { d.status = 'paid'; d.paymentStatus = 'approved'; d.paymentApproved = true; }
      d.completedPayments = cleanText(d.KevaSuccess || raw.KevaSuccess || d.completedPayments || raw.Success);
      d.totalHistoryAmount = numberValue(d.TotalHistoryAmount || raw.TotalHistoryAmount || d.totalHistoryAmount);
      d.historyCount = numberValue(d.HistoryCount || raw.HistoryCount || d.historyCount);
      d.nextChargeDate = cleanText(d.KevaNextDate || raw.KevaNextDate || d.NextDate || raw.NextDate || d.nextChargeDate);
      d.kevaFrequency = cleanText(d.KevaFrequency || raw.KevaFrequency || d.kevaFrequency);
      d.cardLast4 = cleanText(d.KevaLastNum || raw.KevaLastNum || d.LastNum || raw.LastNum || d.cardLast4).replace(/\D/g, '').slice(-4);
      const remaining = cleanText(
        d.KevaTashlumim || raw.KevaTashlumim || d.kevaTashlumim || raw.kevaTashlumim ||
        d.remainingPayments || d.remainingInstallments || d.remainingCharges ||
        d.Itra || raw.Itra || raw.Yitra
      );
      d.remainingPayments = remaining;
      d.remainingInstallments = remaining;
      d.remainingCharges = remaining;
      d.KevaTashlumim = remaining;
      d.kevaTashlumim = remaining;
      d.monthlyAmount = positiveNumber([d.KevaAmount, raw.KevaAmount, d.monthlyAmount, d.Amount, raw.Amount, d.amount]);
      d.currentMonthAmount = d.monthlyAmount;
      d.amount = d.monthlyAmount;
    } else {
      d.donationFrequency = 'one_time';
      d.donationFrequencyLabel = 'תשלום בכרטיס אשראי';
      d.paymentType = cleanText(d.paymentType || 'CARD');
      d.remainingPayments = '';
      d.remainingInstallments = '';
      d.remainingCharges = '';
      d.KevaTashlumim = '';
      d.kevaTashlumim = '';
      d.currentMonthAmount = d.amount;
      d.totalCommitment = d.amount;
    }
    return d;
  }

  function appsUrl() {
    try {
      return cleanText((window.NDA_CONFIG && window.NDA_CONFIG.APPS_SCRIPT_URL) || window.APPS_SCRIPT_URL || (typeof getAppsScriptUrl === 'function' ? getAppsScriptUrl() : ''));
    } catch (_) { return ''; }
  }
  async function parseJsonResponse(response) {
    const text = await response.text();
    try { return JSON.parse(text); }
    catch (_) { throw new Error('השרת לא החזיר JSON תקין: ' + text.slice(0, 180)); }
  }
  async function sheetsGet() {
    const url = appsUrl();
    if (!url) throw new Error('כתובת Google Apps Script חסרה');
    const response = await fetch(url + '?action=get&t=' + Date.now(), { method: 'GET', cache: 'no-store' });
    const data = await parseJsonResponse(response);
    if (!response.ok || data.success === false) throw new Error(data.message || data.error || 'שגיאה בקריאה מ-Google Sheets');
    if (Number(data.schemaVersion || 0) < 7) {
      throw new Error('ה-Web App עדיין מריץ Apps Script ישן. יש להחליף ל-Code.gs החדש ולבצע Deploy → New version באותה פריסה.');
    }
    window.NDA_LAST_SHEETS_META = {
      count: data.count || 0,
      recurringCount: data.recurringCount || 0,
      oneTimeCount: data.oneTimeCount || 0,
      sources: data.sources || {}
    };
    return Array.isArray(data.donors) ? data.donors.map(normalizeDashboardDonation) : [];
  }
  async function sheetsPost(payload) {
    const url = appsUrl();
    if (!url) throw new Error('כתובת Google Apps Script חסרה');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const data = await parseJsonResponse(response);
    if (!response.ok || data.success === false) throw new Error(data.message || data.error || 'שגיאה בכתיבה ל-Google Sheets');
    return data;
  }
  function canonicalDonationKey(raw) {
    const d = normalizeDashboardDonation(raw);
    if (isRecurringDonation(d)) {
      const recurringId = cleanText(d.kevaId || d.KevaId || d.externalId || d.id).replace(/^nedarim-(?:\d+-)?keva-/i, '');
      return 'keva:' + (recurringId || [d.fullName, d.phone, d.amount].join('|'));
    }
    const txId = cleanText(d.externalId || d.id).replace(/^nedarim-(?:\d+-)?tx-/i, '');
    return 'tx:' + (txId || [d.fullName, d.phone, d.amount, d.paymentDate].join('|'));
  }
  function dedupeDashboardRows(rows) {
    const map = new Map();
    (rows || []).map(normalizeDashboardDonation).forEach(function (d) {
      const key = canonicalDonationKey(d);
      if (!map.has(key)) map.set(key, d);
      else map.set(key, Object.assign({}, map.get(key), d, { donorName: '', honoreeName: '' }));
    });
    return Array.from(map.values());
  }
  function replaceLocalDonors(rows) {
    donors = dedupeDashboardRows(rows)
      .sort(function (a, b) { return new Date(b.paymentDate || b.createdAt || 0) - new Date(a.paymentDate || a.createdAt || 0); });
    if (typeof saveData === 'function') saveData();
    if (typeof renderDashboard === 'function') renderDashboard();
    if (typeof renderAllDonors === 'function') renderAllDonors();
    if (typeof renderReports === 'function' && document.getElementById('page-reports')?.classList.contains('active')) renderReports();
  }

  window.reloadDonationsFromSheets = async function (silent) {
    try {
      if (!silent && typeof toast === 'function') toast('טוען נתונים מ-Google Sheets...');
      const rows = await sheetsGet();
      replaceLocalDonors(rows);
      if (!silent && typeof toast === 'function') toast('הנתונים נטענו בהצלחה', 'success');
      return rows;
    } catch (error) {
      console.error(error);
      if (!silent && typeof toast === 'function') toast('שגיאה בטעינת הנתונים: ' + error.message, 'error');
      throw error;
    }
  };

  window.syncNow = async function () {
    try {
      if (typeof toast === 'function') toast('טוען את הנתונים המשותפים מ-Google Sheets...');
      const rows = await sheetsGet();
      replaceLocalDonors(rows);
      if (typeof settings !== 'undefined') settings.lastSync = new Date().toISOString();
      if (typeof updateSyncStatus === 'function') updateSyncStatus(true);
      if (typeof toast === 'function') toast('הנתונים סונכרנו מכל הדפדפנים', 'success');
      return rows;
    } catch (error) {
      console.error(error);
      if (typeof updateSyncStatus === 'function') updateSyncStatus(false);
      if (typeof toast === 'function') toast('שגיאה בסנכרון: ' + error.message, 'error');
      throw error;
    }
  };

  window.importNedarimExternalDonations = async function () {
    try {
      if (typeof toast === 'function') toast('מייבא מנדרים פלוס...');
      const qs = new URLSearchParams({ full: '1', includeKeva: '1', pages: '20', maxId: '500' });
      const response = await fetch('/.netlify/functions/nedarim-import?' + qs.toString(), { cache: 'no-store' });
      const result = await parseJsonResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || 'ייבוא נדרים נכשל');
      const incoming = (Array.isArray(result.donors) ? result.donors : []).map(normalizeDashboardDonation);
      await sheetsPost({ action: 'import', donors: incoming });
      const rows = await sheetsGet();
      replaceLocalDonors(rows);
      if (typeof toast === 'function') {
        toast('ייבוא הושלם · תשלומים בכרטיס: ' + (result.importedHistory || 0) + ' · הוראות קבע: ' + (result.importedKeva || 0), 'success');
      }
      return result;
    } catch (error) {
      console.error(error);
      if (typeof toast === 'function') toast('שגיאה בייבוא מנדרים: ' + error.message, 'error');
      throw error;
    }
  };

  function displayDate(d) {
    const raw = cleanText(d.paymentDate || d.createdAt);
    if (!raw) return '—';
    const parsed = typeof window.ndaParseDashboardDate === 'function' ? window.ndaParseDashboardDate(raw, null) : new Date(raw);
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleDateString('he-IL') : raw;
  }
  function displayAmount(d) {
    if (typeof fmtAmount === 'function') return fmtAmount(numberValue(d.amount), d.currency || 'ILS');
    return (d.currency === 'USD' ? '$' : '₪') + numberValue(d.amount).toLocaleString('he-IL');
  }
  function remainingCount(d) {
    const value = cleanText(d.remainingPayments || d.remainingInstallments || d.remainingCharges || d.KevaTashlumim || d.kevaTashlumim);
    return value || '—';
  }
  function initialsFor(name) {
    if (typeof initialsSafe === 'function') return initialsSafe(name);
    return cleanText(name).split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0); }).join('');
  }
  function esc(value) { return typeof escapeHtml === 'function' ? escapeHtml(cleanText(value)) : cleanText(value); }

  donationRow = function (rawDonation) {
    const d = normalizeDashboardDonation(rawDonation);
    const recurring = isRecurringDonation(d);
    const processorLine = recurring
      ? 'בוצע דרך נדרים פלוס <span class="nda-separator">|</span> הוראת קבע'
      : 'בוצע דרך נדרים פלוס <span class="nda-separator">|</span> תשלום בכרטיס אשראי';
    const amountLine = recurring
      ? '<span class="nda-donation-amount">' + esc(displayAmount(d)) + '</span><span class="nda-separator">|</span><span>מספר תשלומי הוראת קבע: ' + esc(remainingCount(d)) + '</span>'
      : '<span class="nda-donation-amount">' + esc(displayAmount(d)) + '</span>';

    return '<div class="income-row nda-clean-donation-row" onclick="showDonorDetails(\'' + esc(d.id) + '\')">' +
      '<div class="income-avatar">' + esc(initialsFor(d.fullName)) + '</div>' +
      '<div class="nda-donation-main">' +
        '<div class="income-name">' + esc(d.fullName) + '</div>' +
        '<div class="nda-donation-source">' + processorLine + '</div>' +
        '<div class="nda-donation-date">תאריך ביצוע: ' + esc(displayDate(d)) + '</div>' +
        '<div class="nda-donation-bottom">' + amountLine + '</div>' +
      '</div>' +
    '</div>';
  };
  window.donationRow = donationRow;

  function removeFundraiserFields() {
    const body = document.getElementById('modalBody');
    if (!body) return;
    body.querySelectorAll('.detail-box').forEach(function (box) {
      const label = box.querySelector('.detail-label');
      if (label && cleanText(label.textContent) === 'שם המתרים') box.remove();
    });
  }
  const oldShowDonorDetails = window.showDonorDetails;
  if (typeof oldShowDonorDetails === 'function') {
    window.showDonorDetails = function () {
      const result = oldShowDonorDetails.apply(this, arguments);
      setTimeout(removeFundraiserFields, 0);
      return result;
    };
  }

  const style = document.createElement('style');
  style.textContent = `
    .nda-clean-donation-row{align-items:center;grid-template-columns:58px minmax(0,1fr)!important;padding:22px 10px!important;gap:18px!important}
    .nda-clean-donation-row .nda-donation-main{min-width:0}
    .nda-clean-donation-row .income-name{font-size:20px;font-weight:800;margin-bottom:7px;color:#0b172a}
    .nda-donation-source{font-size:15px;font-weight:700;color:#52637a;margin-bottom:5px}
    .nda-donation-date{font-size:14px;color:#8a97aa;margin-bottom:12px}
    .nda-donation-bottom{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:16px;font-weight:700;color:#0d4f78}
    .nda-donation-amount{font-size:22px;font-weight:900;color:#0d4f78}
    .nda-separator{color:#b4bfcc;padding:0 3px}
    @media(max-width:680px){.nda-clean-donation-row{grid-template-columns:46px minmax(0,1fr)!important;padding:17px 4px!important}.nda-clean-donation-row .income-name{font-size:18px}.nda-donation-bottom{font-size:14px}.nda-donation-amount{font-size:20px}}
  `;
  document.head.appendChild(style);

  function initialize() {
    if (Array.isArray(donors)) {
      donors = donors.map(normalizeDashboardDonation);
      if (typeof saveData === 'function') saveData();
    }
    setTimeout(function () { window.reloadDonationsFromSheets(true).catch(function () {}); }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();
