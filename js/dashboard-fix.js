/* Dashboard display repair for Nedarim Plus records. Load after the dashboard's main scripts. */
(function () {
  'use strict';

  function list() {
    try {
      if (typeof donors !== 'undefined' && Array.isArray(donors)) return donors;
    } catch (_) {}
    return Array.isArray(window.donors) ? window.donors : [];
  }

  function rawObject(d) {
    const value = d && d.rawNedarim;
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (_) { return {}; }
  }

  function text(v) { return String(v == null ? '' : v).trim(); }
  function numberText(v) {
    const m = text(v).match(/\d+/);
    return m ? m[0] : '';
  }
  function first(values) {
    for (const value of values) if (text(value)) return text(value);
    return '';
  }
  function typeValue(d) {
    const r = rawObject(d);
    return first([r.TransactionType, r.transactionType, r.PaymentType, r.paymentType, d.paymentTypeRaw, d.paymentType]);
  }
  function isRecurring(d) {
    const type = typeValue(d);
    if (/רגיל|חד\s*פעמ|one[\s_-]*time|regular|תשלומים/i.test(type) && !first([rawObject(d).KevaId, d.KevaId, d.kevaId])) return false;
    return !!first([d.KevaId, d.kevaId, d.standingOrderId]) ||
      /הוראת\s*קבע|הו["״׳']?ק|הוק|(^|\s)קבע(\s|$)|(^|[^a-z])hk([^a-z]|$)|keva|horaat|recurring/i.test(type + ' ' + text(d.donationFrequency) + ' ' + text(d.source));
  }
  function countInfo(d) {
    const r = rawObject(d);
    const remaining = first([
      d.KevaTashlumim, d.kevaTashlumim, d.remainingPayments, d.remainingInstallments, d.remainingCharges,
      r.KevaTashlumim, r.kevaTashlumim, r.YitratTashloumim, r.YitratTashlumim, r.RemainingPayments
    ]);
    if (numberText(remaining)) return { label: 'יתרת תשלומים', value: numberText(remaining) };
    const total = first([d.totalPayments, d.totalInstallments, d.totalCharges, d.paymentsCount, d.tashlumimCount, r.TotalPayments, r.MisparTashlumim]);
    if (numberText(total)) return { label: 'מספר תשלומים', value: numberText(total) };
    const completed = first([d.completedPayments, d.completedInstallments, d.completedCharges]);
    if (numberText(completed)) return { label: 'חיובים שבוצעו', value: numberText(completed) };
    return null;
  }
  function rowId(row) {
    const onclick = row.getAttribute('onclick') || '';
    const m = onclick.match(/showDonorDetails\(\s*['"]([^'"]+)['"]\s*\)/);
    return m ? m[1] : '';
  }
  function donorById(id) { return list().find(d => text(d && d.id) === text(id)); }

  function removeFundraiserLines(root) {
    (root || document).querySelectorAll('.income-meta, .donor-meta, .detail-box, div, span').forEach(function (el) {
      const t = text(el.textContent);
      if (!/^שם המתרים\s*:/.test(t)) return;
      const target = el.closest('.income-meta, .donor-meta, .detail-box') || el;
      target.remove();
    });
  }

  function repairRow(row) {
    const d = donorById(rowId(row));
    if (!d) return;

    // Never display the donor's name a second time as a fundraiser.
    row.querySelectorAll('.income-meta, .donor-meta').forEach(function (el) {
      if (/שם המתרים\s*:/.test(text(el.textContent))) el.remove();
    });

    const recurring = isRecurring(d);
    row.querySelectorAll('.income-badge').forEach(function (badge) {
      const t = text(badge.textContent);
      if (t === 'הוראת קבע' && !recurring) {
        badge.textContent = 'חד פעמית';
        badge.classList.remove('recurring');
        badge.classList.add('one-time');
      }
    });

    // Keep exactly one payment-count badge. The main dashboard renderer may already
    // create it, so dashboard-fix must not append a second copy.
    const paymentBadges = Array.from(row.querySelectorAll('.income-badge')).filter(function (badge) {
      return /^(?:יתרת תשלומים|מספר תשלומים|חיובים שבוצעו)\s*:/.test(text(badge.textContent));
    });

    if (!recurring) {
      paymentBadges.forEach(function (badge) { badge.remove(); });
      return;
    }

    const info = countInfo(d);
    if (!info) {
      paymentBadges.forEach(function (badge) { badge.remove(); });
      return;
    }

    const wantedText = info.label + ': ' + info.value;
    if (paymentBadges.length) {
      const firstBadge = paymentBadges[0];
      firstBadge.textContent = wantedText;
      firstBadge.classList.add('recurring', 'nda-payment-count');
      paymentBadges.slice(1).forEach(function (badge) { badge.remove(); });
      return;
    }

    const meta = row.querySelector('.income-meta');
    if (!meta) return;
    const badge = document.createElement('span');
    badge.className = 'income-badge recurring nda-payment-count';
    badge.textContent = wantedText;
    meta.appendChild(badge);
  }

  function repair() {
    // Clear legacy duplicated names in memory as well, so rerenders do not recreate the line.
    list().forEach(function (d) {
      if (/nedarim|נדרים/i.test([d.source, d.paymentProcessor, d.processor].filter(Boolean).join(' '))) {
        d.donorName = '';
        d.fundraiserName = '';
      }
    });
    document.querySelectorAll('.income-row').forEach(repairRow);
    removeFundraiserLines(document);
  }

  let queued = false;
  function queueRepair() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; repair(); });
  }
  const observer = new MutationObserver(queueRepair);
  function start() {
    observer.observe(document.body, { childList: true, subtree: true });
    repair();
    setTimeout(repair, 300);
    setTimeout(repair, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
