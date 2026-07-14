/*
 * Automatic data loading for the Daat Aharon dashboard.
 * Google Sheets is the source of truth; localStorage is only a short display cache.
 */
(function () {
  'use strict';

  const CONFIG = window.NDA_CONFIG || {};
  const APPS_URL = CONFIG.APPS_SCRIPT_URL || '';
  const REFRESH_MS = Number(CONFIG.DASHBOARD_REFRESH_MS || 60000);
  const IMPORT_MS = Number(CONFIG.NEDARIM_IMPORT_MS || 300000);
  const CACHE_KEY = 'nda_donors_cache_v2';
  const CACHE_TIME_KEY = 'nda_donors_cache_time_v2';

  let pullRunning = false;
  let importRunning = false;
  let initialized = false;

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function parseJson(textValue, label) {
    try { return JSON.parse(textValue); }
    catch (_) { throw new Error((label || 'השרת') + ' לא החזיר JSON תקין'); }
  }

  function normalizeNumber(value) {
    const n = Number(String(value == null ? '' : value).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function rawObject(d) {
    const raw = d && d.rawNedarim;
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }

  function first(values) {
    for (const value of values) {
      if (value !== undefined && value !== null && text(value) !== '') return value;
    }
    return '';
  }

  function normalizeDonor(input) {
    const d = Object.assign({}, input || {});
    const raw = rawObject(d);
    const recurring = /recurring|הוראת\s*קבע|(^|[^a-z])hk([^a-z]|$)|keva/i.test([
      d.donationFrequency, d.donationFrequencyLabel, d.paymentType, d.source,
      d.KevaId, d.kevaId, raw.KevaId, raw.KevaStatus, raw.KevaName, raw.KevaAmount
    ].filter(Boolean).join(' '));

    if (recurring) {
      d.fullName = text(first([raw.KevaName, d.KevaName, raw.ClientName, d.fullName])) || 'תורם ללא שם';
      d.amount = normalizeNumber(first([raw.KevaAmount, d.KevaAmount, raw.Amount, d.amount, d.monthlyAmount]));
      d.monthlyAmount = d.amount;
      d.currentMonthAmount = d.amount;
      const left = text(first([
        raw.KevaTashlumim, raw.Itra, d.KevaTashlumim, d.kevaTashlumim,
        d.remainingPayments, d.remainingInstallments, d.remainingCharges
      ]));
      d.KevaTashlumim = left;
      d.kevaTashlumim = left;
      d.remainingPayments = left;
      d.remainingInstallments = left;
      d.remainingCharges = left;
      d.paymentDate = text(first([raw.CreatedDate, d.CreatedDate, raw.CreationDate, d.paymentDate, d.createdAt]));
      d.phone = text(first([raw.KevaPhone, d.KevaPhone, raw.Phone, d.phone]));
      d.email = text(first([raw.KevaMail, d.KevaMail, raw.Mail, d.email]));
      d.address = text(first([raw.KevaAdresse, d.KevaAdresse, raw.Adresse, d.address]));
      d.city = text(first([raw.KevaCity, d.KevaCity, raw.City, d.city]));
      d.category = text(first([raw.KevaGroupe, d.KevaGroupe, raw.Groupe, d.category]));
      d.donationFrequency = 'recurring';
      d.donationFrequencyLabel = 'הוראת קבע';
      d.paymentType = 'HK';
      const officialStatus = String(first([raw.KevaStatus, d.KevaStatus]) || '').trim();
      d.KevaStatus = officialStatus;
      d.status = officialStatus === '2' ? 'frozen' : officialStatus === '3' ? 'unpaid' : 'paid';
      d.paymentStatus = d.status === 'paid' ? 'approved' : (d.status === 'frozen' ? 'frozen' : 'inactive');
      d.paymentApproved = d.status === 'paid';
      d.activeStandingOrder = d.status === 'paid';
      d.source = 'nedarim_recurring';
    }
    d.donorName = '';
    d.fundraiserName = '';
    return d;
  }

  function setDonors(rows) {
    const list = (Array.isArray(rows) ? rows : []).map(normalizeDonor)
      .sort((a, b) => new Date(b.paymentDate || b.createdAt || 0) - new Date(a.paymentDate || a.createdAt || 0));
    try { donors = list; } catch (_) { window.donors = list; }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(list));
      localStorage.setItem(CACHE_TIME_KEY, new Date().toISOString());
      // Keep compatibility with older display code, but never treat it as the server source.
      localStorage.setItem('nda_donors', JSON.stringify(list));
    } catch (_) {}
    renderAll();
    return list;
  }

  function renderAll() {
    try { if (typeof renderDashboard === 'function') renderDashboard(); } catch (e) { console.warn(e); }
    try { if (typeof renderAllDonors === 'function') renderAllDonors(); } catch (e) { console.warn(e); }
    try {
      if (typeof renderReports === 'function' && document.getElementById('page-reports')?.classList.contains('active')) renderReports();
    } catch (e) { console.warn(e); }
  }

  function restoreCache() {
    try {
      const rows = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      if (Array.isArray(rows) && rows.length) setDonors(rows);
    } catch (_) {}
  }

  async function fetchJson(url, options, label) {
    const response = await fetch(url, Object.assign({ cache: 'no-store' }, options || {}));
    const responseText = await response.text();
    const data = parseJson(responseText, label);
    if (!response.ok || data.success === false) throw new Error(data.message || data.error || ((label || 'הבקשה') + ' נכשלה'));
    return data;
  }

  async function pullFromSheets(options) {
    options = options || {};
    if (!APPS_URL || pullRunning) return null;
    pullRunning = true;
    try {
      const data = await fetchJson(APPS_URL + '?action=get&t=' + Date.now(), {}, 'Google Sheets');
      if (Array.isArray(data.donors)) setDonors(data.donors);
      if (!options.silent && typeof toast === 'function') toast('הנתונים נטענו מ-Google Sheets', 'success');
      return data;
    } catch (error) {
      console.error('Automatic Sheets load failed', error);
      if (!options.silent && typeof toast === 'function') toast('לא ניתן לטעון מ-Google Sheets: ' + error.message, 'error');
      throw error;
    } finally {
      pullRunning = false;
    }
  }

  async function saveImportedToSheets(incoming) {
    return fetchJson(APPS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'sync', donors: incoming || [] })
    }, 'שמירה ב-Google Sheets');
  }

  async function importFromNedarim(options) {
    options = options || {};
    if (importRunning) return null;
    importRunning = true;
    try {
      const qs = new URLSearchParams({
        category: 'נציבי דעת אהרן', full: '1', lastId: '0',
        maxId: '500', pages: '20', includeKeva: '1'
      });
      const result = await fetchJson('/.netlify/functions/nedarim-import?' + qs.toString(), {}, 'נדרים פלוס');
      const incoming = Array.isArray(result.donors) ? result.donors.map(normalizeDonor) : [];
      if (incoming.length) await saveImportedToSheets(incoming);
      await pullFromSheets({ silent: true });
      if (!options.silent && typeof toast === 'function') {
        toast('ייבוא אוטומטי הושלם · ' + incoming.length + ' רשומות', 'success');
      }
      return result;
    } catch (error) {
      console.error('Automatic Nedarim import failed', error);
      // Existing Sheets data remains visible even if Nedarim is temporarily unavailable.
      if (!options.silent && typeof toast === 'function') toast('ייבוא נדרים נכשל: ' + error.message, 'error');
      throw error;
    } finally {
      importRunning = false;
    }
  }

  // Manual Sync now means "reload server data". It never uploads an empty browser list first.
  window.syncNow = async function () {
    try {
      if (typeof toast === 'function') toast('טוען את הנתונים המעודכנים...');
      await pullFromSheets({ silent: true });
      if (typeof updateSyncStatus === 'function') updateSyncStatus(true);
      if (typeof toast === 'function') toast('הסנכרון הושלם', 'success');
    } catch (_) {
      if (typeof updateSyncStatus === 'function') updateSyncStatus(false);
    }
  };

  window.importNedarimExternalDonations = function () {
    return importFromNedarim({ silent: false });
  };
  window.reloadDonationsFromSheets = pullFromSheets;

  async function boot() {
    if (initialized) return;
    initialized = true;
    restoreCache();

    // 1. Immediately load already-saved data. This solves the zero-on-reopen issue.
    try { await pullFromSheets({ silent: true }); } catch (_) {}

    // 2. Then refresh Nedarim in the background and persist the result.
    importFromNedarim({ silent: true }).catch(function () {});

    // 3. Keep an open dashboard fresh.
    setInterval(function () {
      if (!document.hidden) pullFromSheets({ silent: true }).catch(function () {});
    }, REFRESH_MS);
    setInterval(function () {
      if (!document.hidden) importFromNedarim({ silent: true }).catch(function () {});
    }, IMPORT_MS);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) pullFromSheets({ silent: true }).catch(function () {});
    });
    window.addEventListener('focus', function () {
      pullFromSheets({ silent: true }).catch(function () {});
    });
  }

  function waitForDashboard() {
    let attempts = 0;
    const timer = setInterval(function () {
      attempts += 1;
      let ready = false;
      try { ready = typeof donors !== 'undefined' && typeof renderDashboard === 'function'; } catch (_) {}
      if (ready || attempts > 50) {
        clearInterval(timer);
        boot();
      }
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitForDashboard);
  else waitForDashboard();
})();
