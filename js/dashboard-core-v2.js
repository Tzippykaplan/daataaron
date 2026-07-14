/* Dashboard data core v2 — Google Sheets is the single source of truth. */
(function () {
  'use strict';

  function cleanText(value) { return String(value == null ? '' : value).trim(); }
  function numberValue(value) {
    const n = Number(String(value == null ? '' : value).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  function isRecurringDonation(d) {
    const text = [d && d.donationFrequency, d && d.donationFrequencyLabel, d && d.paymentType, d && d.source]
      .filter(Boolean).join(' ').toLowerCase();
    return text.includes('recurring') || text.includes('הוראת קבע') || /(^|[^a-z])hk([^a-z]|$)/.test(text) || cleanText(d && d.kevaId) !== '';
  }
  function normalizeDashboardDonation(input) {
    const d = Object.assign({}, input || {});
    d.id = cleanText(d.id || d.externalId || d.orderRef);
    d.fullName = cleanText(d.fullName || d.ClientName || d.KevaName || 'תורם ללא שם');
    d.donorName = '';
    d.honoreeName = '';
    d.amount = numberValue(d.amount);
    d.currency = cleanText(d.currency || 'ILS').toUpperCase() === 'USD' ? 'USD' : 'ILS';
    d.paymentDate = cleanText(d.paymentDate || d.createdAt || d.importedAt);
    d.createdAt = cleanText(d.createdAt || d.paymentDate || new Date().toISOString());
    d.paymentProcessor = cleanText(d.paymentProcessor || 'Nedarim Plus');
    d.source = cleanText(d.source || 'nedarim');
    d.status = cleanText(d.status || 'paid');
    d.paymentStatus = cleanText(d.paymentStatus || 'approved');
    d.paymentApproved = d.paymentApproved !== false;
    d.hebDay = cleanText(d.hebDay);
    d.hebMonth = cleanText(d.hebMonth);

    if (isRecurringDonation(d)) {
      d.donationFrequency = 'recurring';
      d.donationFrequencyLabel = 'הוראת קבע';
      d.paymentType = 'HK';
      const remaining = cleanText(
        d.remainingPayments || d.remainingInstallments || d.remainingCharges ||
        d.KevaTashlumim || d.kevaTashlumim
      );
      d.remainingPayments = remaining;
      d.remainingInstallments = remaining;
      d.remainingCharges = remaining;
      d.KevaTashlumim = remaining;
      d.kevaTashlumim = remaining;
      d.monthlyAmount = numberValue(d.monthlyAmount || d.amount);
      d.currentMonthAmount = numberValue(d.currentMonthAmount || d.amount);
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
    if (isRecurringDonation(d)) return 'keva:' + cleanText(d.kevaId || d.externalId || d.id).replace(/^nedarim-(?:\d+-)?keva-/i, '');
    return 'tx:' + cleanText(d.externalId || d.id).replace(/^nedarim-(?:\d+-)?tx-/i, '');
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
