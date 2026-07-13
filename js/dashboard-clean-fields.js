/*
 * תוספת קטנה לדשבורד הקיים.
 * יש לטעון אותה בסוף הדף, ממש לפני </body>.
 * המטרה: למחוק נתוני תצוגה ישנים ששמורים ב-localStorage,
 * לא להציג "שם המתרים", ולקרוא את KevaTashlumim מה-Apps Script החדש.
 */
(function () {
  'use strict';

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function remainingValue(donor) {
    if (!donor) return '';
    const raw = donor.rawNedarim && typeof donor.rawNedarim === 'object'
      ? donor.rawNedarim
      : {};
    const values = [
      donor.KevaTashlumim,
      donor.kevaTashlumim,
      donor.remainingPayments,
      donor.remainingInstallments,
      donor.remainingCharges,
      raw.KevaTashlumim
    ];
    for (const value of values) {
      if (!text(value)) continue;
      const match = text(value).match(/\d+/);
      return match ? String(Number(match[0])) : text(value);
    }
    return '';
  }

  function cleanDonor(donor) {
    if (!donor || typeof donor !== 'object') return donor;
    // השדות האלה אינם קיימים במבנה החדש ואסור שיופיעו מהזיכרון המקומי הישן.
    delete donor.donorName;
    delete donor.fundraiserName;
    delete donor.honoreeName;
    delete donor.deceasedName;
    delete donor.hebDay;
    delete donor.hebMonth;
    delete donor.memoryContent;
    return donor;
  }

  function cleanStoredData() {
    try {
      if (Array.isArray(window.donors)) {
        window.donors = window.donors.map(cleanDonor);
        if (typeof window.saveData === 'function') window.saveData();
      }
    } catch (_) {}
  }

  // הפונקציות בדשבורד הן גלובליות, ולכן החלפה זו מונעת לחלוטין את שורת "שם המתרים".
  window.donorNameValue = function () { return ''; };
  window.kevaRemainingPayments = remainingValue;
  window.ndaKevaTashlumimValue = remainingValue;

  function removeOldRenderedLines(root) {
    (root || document).querySelectorAll('.income-meta, .donor-sub, span, div').forEach(function (element) {
      const value = text(element.textContent);
      if (!/^שם המתרים\s*:/.test(value)) return;
      const row = element.closest('.income-meta') || element;
      row.remove();
    });
  }

  const originalSync = window.syncNow;
  if (typeof originalSync === 'function') {
    window.syncNow = async function () {
      const result = await originalSync.apply(this, arguments);
      cleanStoredData();
      if (typeof window.renderDashboard === 'function') window.renderDashboard();
      if (typeof window.renderAllDonors === 'function') window.renderAllDonors();
      removeOldRenderedLines(document);
      return result;
    };
  }

  document.addEventListener('DOMContentLoaded', function () {
    cleanStoredData();
    removeOldRenderedLines(document);

    const observer = new MutationObserver(function () {
      removeOldRenderedLines(document);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
