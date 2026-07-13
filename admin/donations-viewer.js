(function () {
  const PAGE_ID = 'donations-view';
  const PAGE_SECTION_ID = 'page-donations-view';
  const FILTER_CHIPS_ID = 'donationsViewFilterChips';
  const TABLE_BODY_ID = 'donationsViewTableBody';
  const RESULT_COUNT_ID = 'donationsViewResultCount';
  const PAGE_INFO_ID = 'donationsViewPageInfo';
  const EMPTY_ID = 'donationsViewEmpty';
  const PREV_ID = 'donationsViewPrev';
  const NEXT_ID = 'donationsViewNext';

  const PAGE_SIZE = 15;

  const state = {
    globalSearch: '',
    donorName: '',
    fundraiserName: '',
    amount: '',
    receipt: '',
    notes: '',
    status: 'all',
    dateFrom: '',
    dateTo: '',
    sortBy: 'date',
    sortDir: 'desc',
    page: 1
  };

  function isHebrewUI() {
    return document.documentElement.lang === 'he' || document.documentElement.dir === 'rtl';
  }

  function t(he, en) {
    return isHebrewUI() ? he : en;
  }

  function safe(v) {
    return String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function donorCurrencySafe(d) {
    if (typeof window.donorCurrency === 'function') return window.donorCurrency(d);
    return String((d && d.currency) || 'USD').toUpperCase() === 'ILS' ? 'ILS' : 'USD';
  }

  function fmtCurrencyAmount(value, currency) {
    const symbol = currency === 'ILS' ? '₪' : '$';
    return symbol + num(value).toLocaleString('en-US');
  }

  function installmentCountSafe(d) {
    const raw = rawNedarimSafe(d);
    const value = firstNonEmpty(d, [
      'paymentInstallments', 'installments', 'tashlumim', 'tashloumim', 'Tashlumim', 'Tashloumim', 'paymentsCount'
    ]) || firstNonEmpty(raw, [
      'Tashlumim', 'Tashloumim', 'tashlumim', 'tashloumim', 'Payments', 'payments', 'TashlumimCount', 'TashloumimCount'
    ]);
    const n = Number(String(value || '').replace(/[^0-9]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
  }

  function rawAmountSafe(d) {
    const raw = rawNedarimSafe(d);
    return num(firstNonEmpty(raw, ['Amount','amount']) || (raw.Value && raw.Value.Amount) || (raw.value && raw.value.Amount));
  }

  function nonRecurringTotalSafe(d) {
    const installments = installmentCountSafe(d);
    const rawAmount = rawAmountSafe(d);
    const amount = num((d && (d.amount || d.chargedAmount || d.currentMonthAmount)) || 0);
    const rawTotal = num(d && (d.totalCommitment || d.totalDonationAmount || d.totalAmount || d.pledgeAmount));
    const base = rawAmount || amount || rawTotal;
    // A previous version mistakenly saved totalCommitment = amount × installments.
    // For Nedarim one-time installments, Amount is already the total transaction amount.
    if (installments > 1 && base > 0 && rawTotal > base && Math.abs(rawTotal - base * installments) < 0.01) return base;
    return base || rawTotal;
  }

  function monthlyChargeSafe(d) {
    if (!isRecurringDonation(d) && installmentCountSafe(d) > 1) {
      return nonRecurringTotalSafe(d);
    }
    return num((d && (d.chargedAmount || d.currentMonthAmount || d.installmentAmount || d.monthlyAmount || d.amount)) || 0);
  }

  function singleInstallmentSafe(d) {
    const installments = installmentCountSafe(d);
    const total = nonRecurringTotalSafe(d);
    if (!isRecurringDonation(d) && installments > 1 && total > 0) return Math.round((total / installments) * 100) / 100;
    return monthlyChargeSafe(d);
  }

  function totalCommitmentSafe(d) {
    const rawTotal = num(d && (d.totalCommitment || d.totalDonationAmount || d.totalAmount || d.pledgeAmount));
    const monthly = monthlyChargeSafe(d);
    if (isRecurringDonation(d)) return rawTotal || monthly;
    return nonRecurringTotalSafe(d) || monthly;
  }

  function fmtAmountSafe(d) {
    const c = donorCurrencySafe(d);
    if (!isRecurringDonation(d) && installmentCountSafe(d) > 1) return fmtCurrencyAmount(totalCommitmentSafe(d), c);
    if (typeof window.fmtDonorMoney === 'function') return window.fmtDonorMoney(d);
    return fmtCurrencyAmount(monthlyChargeSafe(d), c);
  }

  function paymentDetailsTextSafe(d) {
    if (isRecurringDonation(d)) {
      const left = kevaTashlumimValue(d);
      return left ? t('יתרת תשלומים: ', 'Remaining payments: ') + left : '—';
    }
    return '—';
  }


  function statusLabelSafe(status) {
    if (typeof window.statusLabel === 'function') return window.statusLabel(status);
    return status === 'paid' ? t('שולם', 'Paid') : status === 'pending' ? t('ממתין', 'Pending') : t('לא שולם', 'Unpaid');
  }

  function statusBadgeSafe(status) {
    if (typeof window.statusBadge === 'function') return window.statusBadge(status);
    const cls = status === 'paid' ? 'badge-paid' : status === 'pending' ? 'badge-pending' : 'badge-unpaid';
    return '<span class="badge ' + cls + '">' + safe(statusLabelSafe(status)) + '</span>';
  }

  function parseDateSafe(d) {
    const value = d && (d.paymentDate || d.createdAt || d.date);
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatDateSafe(d) {
    const parsed = parseDateSafe(d);
    if (!parsed) return '—';
    const locale = isHebrewUI() ? 'he-IL' : 'en-US';
    return parsed.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function fundraiserNameSafe(d) {
    return String((d && (d.donorName || d.honoreeName || d.fundraiserName || '')) || '').trim();
  }

  function receiptSafe(d) {
    return String((d && (d.orderRef || d.id || d.receiptNumber || d.receipt || '')) || '').trim();
  }

  function notesSafe(d) {
    return String((d && (d.notes || d.memoryContent || '')) || '').trim();
  }

  function firstNonEmpty(obj, keys) {
    if (!obj) return '';
    for (let i = 0; i < keys.length; i++) {
      const value = obj[keys[i]];
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return '';
  }

  function rawNedarimSafe(d) {
    if (!d) return {};
    const raw = d.rawNedarim || d.nedarimRaw || d.raw || d.paymentTransaction || d.transaction || {};
    if (raw && typeof raw === 'object') return raw;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch (e) { return {}; }
    }
    return {};
  }

  function paymentTypeRawSafe(d) {
    const raw = rawNedarimSafe(d);
    return String(firstNonEmpty(d, [
      'paymentType',
      'donationType',
      'chargeType',
      'paymentMethodType',
      'sourcePaymentType',
      'nedarimPaymentType'
    ]) || firstNonEmpty(raw, [
      'PaymentType',
      'paymentType',
      'TransactionType',
      'transactionType',
      'Type',
      'type'
    ]) || '').trim();
  }

  function isRecurringDonation(d) {
    const raw = rawNedarimSafe(d);
    const joined = [
      paymentTypeRawSafe(d),
      firstNonEmpty(d, ['recurringType', 'paymentLabel', 'paymentTypeLabel', 'donationTypeLabel', 'donationFrequency', 'donationFrequencyLabel', 'source', 'notes', 'id', 'orderRef', 'KevaId', 'kevaId']),
      firstNonEmpty(raw, ['PaymentTypeName', 'PaymentTypeText', 'TransactionTypeName', 'TransactionTypeText', 'PaymentType', 'TransactionType', 'Type', 'KevaId', 'KevaID', 'HoraatKevaId', 'HoraaId', 'KevaTashlumim', 'YitratTashloumim'])
    ].join(' ').toLowerCase();

    return Boolean(
      d && (d.isRecurring || d.recurring || d.isKeva || d.keva || d.kevaId || d.KevaId)
    ) ||
      joined.includes('hk') ||
      joined.includes('keva') ||
      joined.includes('recurring') ||
      joined.includes('standing') ||
      joined.includes('horaat') ||
      joined.includes('הוראת') ||
      joined.includes('קבע') ||
      kevaTashlumimValue(d) !== '';
  }

  function kevaTashlumimValue(d) {
    const raw = rawNedarimSafe(d);
    const value = firstNonEmpty(d, [
      'KevaTashlumim',
      'kevaTashlumim',
      'KevaTashloumim',
      'kevaTashloumim',
      'remainingPayments',
      'remainingInstallments',
      'remainingCharges',
      'kevaRemainingPayments'
    ]) || firstNonEmpty(raw, [
      'KevaTashlumim',
      'kevaTashlumim',
      'KevaTashloumim',
      'kevaTashloumim',
      'YitratTashloumim',
      'YitratTashlumim',
      'Yitra',
      'RemainingPayments',
      'remainingPayments',
      'remainingInstallments',
      'remainingCharges',
      'TashlumimLeft',
      'tashlumimLeft'
    ]);

    if (value !== undefined && value !== null && String(value).trim() !== '') {
      const str = String(value).trim();
      const digits = str.replace(/[^0-9]/g, '');
      if (digits !== '') return digits;
    }
    const notes = String((d && d.notes) || '');
    const m = notes.match(/(?:יתרת\s*(?:תשלומים|חיובים)|נותרו|remaining\s*(?:payments|installments|charges))\D{0,20}(\d+)/i);
    return m ? m[1] : '';
  }

  function donationTypeLabelSafe(d) {
    if (isRecurringDonation(d)) return t('הוראת קבע', 'Recurring');
    return t('חד פעמית', 'One-time');
  }

  function kevaTashlumimTextSafe(d) {
    if (!isRecurringDonation(d)) return '—';
    const value = kevaTashlumimValue(d);
    return value ? value : '—';
  }

  function normalizeRows() {
    const list = Array.isArray(window.donors) ? window.donors.slice() : [];
    return list.map(function (d) {
      return {
        raw: d,
        donorName: String((d && d.fullName) || '').trim(),
        fundraiserName: fundraiserNameSafe(d),
        amount: num(d && d.amount),
        currency: donorCurrencySafe(d),
        status: String((d && d.status) || 'unpaid'),
        receipt: receiptSafe(d),
        notes: notesSafe(d),
        paymentTypeText: donationTypeLabelSafe(d),
        kevaTashlumimText: kevaTashlumimTextSafe(d),
        paymentDetailsText: paymentDetailsTextSafe(d),
        dateObj: parseDateSafe(d),
        dateText: formatDateSafe(d)
      };
    });
  }

  function contains(hay, needle) {
    return String(hay || '').toLowerCase().includes(String(needle || '').toLowerCase());
  }

  function applyFilters(rows) {
    const g = state.globalSearch.trim().toLowerCase();
    const dn = state.donorName.trim().toLowerCase();
    const fn = state.fundraiserName.trim().toLowerCase();
    const amt = state.amount.trim().toLowerCase();
    const rc = state.receipt.trim().toLowerCase();
    const nt = state.notes.trim().toLowerCase();

    return rows.filter(function (r) {
      if (dn && !contains(r.donorName, dn)) return false;
      if (fn && !contains(r.fundraiserName, fn)) return false;
      if (amt && !contains(String(r.amount), amt)) return false;
      if (rc && !contains(r.receipt, rc)) return false;
      if (nt && !contains(r.notes, nt)) return false;
      if (state.status !== 'all' && r.status !== state.status) return false;

      if (state.dateFrom) {
        const from = new Date(state.dateFrom + 'T00:00:00');
        if (!r.dateObj || r.dateObj < from) return false;
      }
      if (state.dateTo) {
        const to = new Date(state.dateTo + 'T23:59:59');
        if (!r.dateObj || r.dateObj > to) return false;
      }

      if (g) {
        const corpus = [
          r.donorName,
          r.fundraiserName,
          r.amount,
          r.currency,
          r.dateText,
          statusLabelSafe(r.status),
          r.paymentTypeText,
          r.kevaTashlumimText,
          r.paymentDetailsText,
          r.receipt,
          r.notes,
          r.paymentTypeText,
          r.kevaTashlumimText,
          r.paymentDetailsText
        ].join(' ').toLowerCase();
        if (!corpus.includes(g)) return false;
      }

      return true;
    });
  }

  function applySort(rows) {
    const dir = state.sortDir === 'asc' ? 1 : -1;
    const sorted = rows.slice();
    sorted.sort(function (a, b) {
      let left;
      let right;
      if (state.sortBy === 'amount') {
        left = a.amount;
        right = b.amount;
      } else if (state.sortBy === 'donor') {
        left = a.donorName.toLowerCase();
        right = b.donorName.toLowerCase();
      } else if (state.sortBy === 'fundraiser') {
        left = a.fundraiserName.toLowerCase();
        right = b.fundraiserName.toLowerCase();
      } else if (state.sortBy === 'status') {
        left = statusLabelSafe(a.status).toLowerCase();
        right = statusLabelSafe(b.status).toLowerCase();
      } else {
        left = a.dateObj ? a.dateObj.getTime() : 0;
        right = b.dateObj ? b.dateObj.getTime() : 0;
      }
      if (left < right) return -1 * dir;
      if (left > right) return 1 * dir;
      return 0;
    });
    return sorted;
  }

  function paged(rows) {
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;
    const start = (state.page - 1) * PAGE_SIZE;
    return {
      totalPages: totalPages,
      rows: rows.slice(start, start + PAGE_SIZE)
    };
  }

  function getEl(id) {
    return document.getElementById(id);
  }

  function renderRows(rows) {
    const body = getEl(TABLE_BODY_ID);
    const empty = getEl(EMPTY_ID);
    if (!body) return;

    if (!rows.length) {
      body.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }

    if (empty) empty.style.display = 'none';

    body.innerHTML = rows.map(function (r) {
      return (
        '<tr>' +
          '<td>' + safe(r.donorName || '—') + '</td>' +
          '<td>' + safe(fmtAmountSafe(r.raw)) + '</td>' +
          '<td>' + safe(r.currency || '—') + '</td>' +
          '<td>' + safe(r.dateText || '—') + '</td>' +
          '<td>' + safe(r.fundraiserName || '—') + '</td>' +
          '<td>' + statusBadgeSafe(r.status) + '</td>' +
          '<td>' + safe(r.paymentTypeText || '—') + '</td>' +
          '<td>' + safe(r.paymentDetailsText || '—') + '</td>' +
          '<td>' + safe(r.receipt || '—') + '</td>' +
          '<td class="donations-notes-cell">' + safe(r.notes || '—') + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderMeta(total, totalPages) {
    const result = getEl(RESULT_COUNT_ID);
    const pageInfo = getEl(PAGE_INFO_ID);
    const prev = getEl(PREV_ID);
    const next = getEl(NEXT_ID);

    if (result) result.textContent = t(total + ' תוצאות', total + ' results');
    if (pageInfo) pageInfo.textContent = t('עמוד ' + state.page + ' מתוך ' + totalPages, 'Page ' + state.page + ' of ' + totalPages);

    if (prev) prev.disabled = state.page <= 1;
    if (next) next.disabled = state.page >= totalPages;
  }

  function render() {
    const normalized = normalizeRows();
    const filtered = applyFilters(normalized);
    const sorted = applySort(filtered);
    const pg = paged(sorted);
    renderRows(pg.rows);
    renderMeta(filtered.length, pg.totalPages);
    renderFilterChips();
  }

  function setAndRender(field, value) {
    state[field] = value;
    state.page = 1;
    render();
  }

  function renderFilterChips() {
    const wrap = getEl(FILTER_CHIPS_ID);
    if (!wrap) return;
    wrap.querySelectorAll('[data-status]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-status') === state.status);
    });
  }

  function bindInputs() {
    const map = [
      ['donationsViewGlobalSearch', 'globalSearch'],
      ['donationsViewDonorName', 'donorName'],
      ['donationsViewFundraiserName', 'fundraiserName'],
      ['donationsViewAmount', 'amount'],
      ['donationsViewReceipt', 'receipt'],
      ['donationsViewNotes', 'notes'],
      ['donationsViewDateFrom', 'dateFrom'],
      ['donationsViewDateTo', 'dateTo']
    ];

    map.forEach(function (item) {
      const el = getEl(item[0]);
      if (!el) return;
      const handler = function () { setAndRender(item[1], el.value || ''); };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });

    const sortBy = getEl('donationsViewSortBy');
    if (sortBy) {
      sortBy.addEventListener('change', function () { setAndRender('sortBy', sortBy.value || 'date'); });
    }

    const sortDir = getEl('donationsViewSortDir');
    if (sortDir) {
      sortDir.addEventListener('change', function () { setAndRender('sortDir', sortDir.value || 'desc'); });
    }

    const clearBtn = getEl('donationsViewClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        state.globalSearch = '';
        state.donorName = '';
        state.fundraiserName = '';
        state.amount = '';
        state.receipt = '';
        state.notes = '';
        state.status = 'all';
        state.dateFrom = '';
        state.dateTo = '';
        state.sortBy = 'date';
        state.sortDir = 'desc';
        state.page = 1;

        [
          'donationsViewGlobalSearch',
          'donationsViewDonorName',
          'donationsViewFundraiserName',
          'donationsViewAmount',
          'donationsViewReceipt',
          'donationsViewNotes',
          'donationsViewDateFrom',
          'donationsViewDateTo'
        ].forEach(function (id) {
          const el = getEl(id);
          if (el) el.value = '';
        });
        if (sortBy) sortBy.value = 'date';
        if (sortDir) sortDir.value = 'desc';

        render();
      });
    }

    const chipWrap = getEl(FILTER_CHIPS_ID);
    if (chipWrap) {
      chipWrap.addEventListener('click', function (ev) {
        const btn = ev.target.closest('[data-status]');
        if (!btn) return;
        setAndRender('status', btn.getAttribute('data-status') || 'all');
      });
    }

    const prev = getEl(PREV_ID);
    const next = getEl(NEXT_ID);
    if (prev) {
      prev.addEventListener('click', function () {
        state.page = Math.max(1, state.page - 1);
        render();
      });
    }
    if (next) {
      next.addEventListener('click', function () {
        state.page += 1;
        render();
      });
    }
  }

  function viewerSectionMarkup() {
    return (
      '<section class="page" id="' + PAGE_SECTION_ID + '">' +
        '<div class="page-head">' +
          '<h2 class="page-title">' + safe(t('תרומות - תצוגה בלבד', 'Donations - Read Only')) + '</h2>' +
          '<div class="page-actions">' +
            '<button class="btn btn-ghost btn-sm" id="donationsViewBackBtn" type="button">' + safe(t('חזרה לתורמים', 'Back to Donors')) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="field">' +
            '<input id="donationsViewGlobalSearch" type="text" placeholder="' + safe(t('חיפוש כללי בכל השדות...', 'Global search across all fields...')) + '" aria-label="' + safe(t('חיפוש כללי', 'Global search')) + '">' +
          '</div>' +
          '<div class="filter-panel open">' +
            '<div class="filter-panel-header">' + safe(t('סינון מתקדם', 'Advanced Filters')) + '</div>' +
            '<div class="filter-panel-body" style="display:block;">' +
              '<div class="field-row cols-2">' +
                '<div class="field"><label>' + safe(t('שם תורם', 'Donor Name')) + '</label><input id="donationsViewDonorName" type="text"></div>' +
                '<div class="field"><label>' + safe(t('שם מתרים', 'Fundraiser Name')) + '</label><input id="donationsViewFundraiserName" type="text"></div>' +
              '</div>' +
              '<div class="field-row cols-2 mt-10">' +
                '<div class="field"><label>' + safe(t('סכום תרומה', 'Donation Amount')) + '</label><input id="donationsViewAmount" type="text"></div>' +
                '<div class="field"><label>' + safe(t('מספר קבלה / מזהה תרומה', 'Receipt / Donation ID')) + '</label><input id="donationsViewReceipt" type="text"></div>' +
              '</div>' +
              '<div class="field-row cols-2 mt-10">' +
                '<div class="field"><label>' + safe(t('הערות', 'Notes')) + '</label><input id="donationsViewNotes" type="text"></div>' +
                '<div class="field"><label>' + safe(t('סטטוס', 'Status')) + '</label>' +
                  '<div class="chip-row" id="' + FILTER_CHIPS_ID + '">' +
                    '<button class="chip active" data-status="all" type="button">' + safe(t('הכל', 'All')) + '</button>' +
                    '<button class="chip" data-status="paid" type="button">' + safe(t('שולם', 'Paid')) + '</button>' +
                    '<button class="chip" data-status="pending" type="button">' + safe(t('ממתין', 'Pending')) + '</button>' +
                    '<button class="chip" data-status="unpaid" type="button">' + safe(t('לא שולם', 'Unpaid')) + '</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="field-row cols-2 mt-10">' +
                '<div class="field"><label>' + safe(t('מתאריך', 'From Date')) + '</label><input id="donationsViewDateFrom" type="date"></div>' +
                '<div class="field"><label>' + safe(t('עד תאריך', 'To Date')) + '</label><input id="donationsViewDateTo" type="date"></div>' +
              '</div>' +
              '<div class="field-row cols-2 mt-10">' +
                '<div class="field"><label>' + safe(t('מיון לפי', 'Sort By')) + '</label>' +
                  '<select id="donationsViewSortBy">' +
                    '<option value="date">' + safe(t('תאריך תרומה', 'Donation Date')) + '</option>' +
                    '<option value="amount">' + safe(t('סכום תרומה', 'Donation Amount')) + '</option>' +
                    '<option value="donor">' + safe(t('שם תורם', 'Donor Name')) + '</option>' +
                    '<option value="fundraiser">' + safe(t('שם מתרים', 'Fundraiser Name')) + '</option>' +
                    '<option value="status">' + safe(t('סטטוס', 'Status')) + '</option>' +
                  '</select>' +
                '</div>' +
                '<div class="field"><label>' + safe(t('כיוון', 'Direction')) + '</label>' +
                  '<select id="donationsViewSortDir">' +
                    '<option value="desc">' + safe(t('יורד', 'Descending')) + '</option>' +
                    '<option value="asc">' + safe(t('עולה', 'Ascending')) + '</option>' +
                  '</select>' +
                '</div>' +
              '</div>' +
              '<div class="mt-10"><button class="btn btn-ghost btn-sm" id="donationsViewClear" type="button">' + safe(t('נקה סינונים', 'Clear Filters')) + '</button></div>' +
            '</div>' +
          '</div>' +

          '<div class="small muted" id="' + RESULT_COUNT_ID + '"></div>' +

          '<div class="donations-table-wrap" role="region" aria-label="' + safe(t('טבלת תרומות', 'Donations table')) + '">' +
            '<table class="donations-table">' +
              '<thead>' +
                '<tr>' +
                  '<th scope="col">' + safe(t('שם תורם', 'Donor Name')) + '</th>' +
                  '<th scope="col">' + safe(t('סכום תרומה', 'Donation Amount')) + '</th>' +
                  '<th scope="col">' + safe(t('מטבע', 'Currency')) + '</th>' +
                  '<th scope="col">' + safe(t('תאריך תרומה', 'Donation Date')) + '</th>' +
                  '<th scope="col">' + safe(t('שם מתרים', 'Fundraiser Name')) + '</th>' +
                  '<th scope="col">' + safe(t('סטטוס', 'Status')) + '</th>' +
                  '<th scope="col">' + safe(t('סוג תרומה', 'Donation Type')) + '</th>' +
                  '<th scope="col">' + safe(t('יתרת תשלומים', 'Remaining Payments')) + '</th>' +
                  '<th scope="col">' + safe(t('קבלה / מזהה', 'Receipt / ID')) + '</th>' +
                  '<th scope="col">' + safe(t('הערות', 'Notes')) + '</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody id="' + TABLE_BODY_ID + '"></tbody>' +
            '</table>' +
          '</div>' +

          '<div class="empty" id="' + EMPTY_ID + '" style="display:none;">' + safe(t('אין תרומות להצגה', 'No donations to display')) + '</div>' +

          '<div class="donations-pagination">' +
            '<button class="btn btn-ghost btn-sm" id="' + PREV_ID + '" type="button">' + safe(t('הקודם', 'Previous')) + '</button>' +
            '<div class="small muted" id="' + PAGE_INFO_ID + '"></div>' +
            '<button class="btn btn-ghost btn-sm" id="' + NEXT_ID + '" type="button">' + safe(t('הבא', 'Next')) + '</button>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function ensureSection() {
    if (document.getElementById(PAGE_SECTION_ID)) return;
    const reports = document.getElementById('page-reports');
    if (!reports || !reports.parentNode) return;
    reports.insertAdjacentHTML('beforebegin', viewerSectionMarkup());
  }

  function ensureViewButton() {
    const actions = document.querySelector('#page-donors .page-actions');
    if (!actions || document.getElementById('viewDonationsBtn')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'viewDonationsBtn';
    button.className = 'btn btn-ghost btn-sm';
    button.setAttribute('aria-label', t('הצג תרומות', 'View Donations'));
    button.textContent = t('הצג תרומות', 'View Donations');
    button.addEventListener('click', function () {
      if (typeof window.showPage === 'function') {
        window.showPage(PAGE_ID);
      }
    });
    actions.insertBefore(button, actions.firstChild);
  }

  function patchShowPage() {
    if (typeof window.showPage !== 'function' || window.__donationsViewerShowPagePatched) return;

    const original = window.showPage;
    window.showPage = function (page) {
      if (page === PAGE_ID) page = 'donations-view';
      const result = original.call(this, page);
      if (page === 'donations-view') {
        render();
        const firstFocusable = document.getElementById('donationsViewGlobalSearch');
        if (firstFocusable) firstFocusable.focus();
      }
      return result;
    };

    window.__donationsViewerShowPagePatched = true;
  }

  function ensureNavEntrypoint() {
    const actionsGrid = document.querySelector('#page-actions .actions-grid');
    if (!actionsGrid || document.getElementById('viewDonationsActionCard')) return;

    const btn = document.createElement('button');
    btn.id = 'viewDonationsActionCard';
    btn.className = 'action-card';
    btn.type = 'button';
    btn.innerHTML =
      '<div class="action-card-icon">' +
        '<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24">' +
          '<path d="M3 4h18"></path><path d="M3 10h18"></path><path d="M3 16h18"></path><path d="M3 22h18"></path>' +
        '</svg>' +
      '</div>' +
      '<div class="action-card-label">' + safe(t('צפייה בתרומות', 'View Donations')) + '</div>';

    btn.addEventListener('click', function () {
      if (typeof window.showPage === 'function') window.showPage(PAGE_ID);
    });

    actionsGrid.insertBefore(btn, actionsGrid.firstChild);
  }

  function bindBackButton() {
    const back = document.getElementById('donationsViewBackBtn');
    if (!back || back.dataset.bound === '1') return;
    back.dataset.bound = '1';
    back.addEventListener('click', function () {
      if (typeof window.showPage === 'function') window.showPage('donors');
    });
  }

  function bootstrap() {
    ensureSection();
    ensureViewButton();
    ensureNavEntrypoint();
    patchShowPage();
    bindBackButton();
    bindInputs();
    render();
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
  if (document.readyState !== 'loading') bootstrap();
})();
