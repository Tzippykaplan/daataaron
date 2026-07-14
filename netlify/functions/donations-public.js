// Fast, compact public donations endpoint.
// It removes large/private fields such as rawNedarim before sending data to the browser.
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbz8T_SpCAAR-yIoOnK-1S_ZZgt0Uzr6sV74oVsMP4tZDLThwOHLe0PM7r9pHKfk0qGncg/exec';

const KEEP_FIELDS = [
  'id','fullName','donorName','fundraiserName','honoreeName','deceasedName',
  'status','amount','chargedAmount','monthlyAmount','currentMonthAmount','installmentAmount',
  'totalCommitment','totalAmount','totalDonationAmount','currency','paymentCurrency',
  'paymentProcessor','processor','paymentStatus','paymentApproved','paymentType','paymentTypeRaw',
  'donationFrequency','donationFrequencyLabel','source','donationSource','category','notes',
  'paymentDate','createdAt','importedAt','TransactionTime','orderRef','transactionId','TransactionId',
  'KevaId','kevaId','KevaStatus','KevaAmount','KevaTashlumim','kevaTashlumim',
  'remainingPayments','remainingInstallments','remainingCharges','completedPayments','completedCharges',
  'KevaSuccess','HistoryCount','TotalHistoryAmount','paymentInstallments','installments','tashlumim',
  'Tashlumim','Tashloumim','paymentsCount','tashlumimCount'
];

function compactDonor(d) {
  const out = {};
  for (const key of KEEP_FIELDS) {
    if (d && d[key] !== undefined && d[key] !== null && d[key] !== '') out[key] = d[key];
  }

  // Preserve only the small subset of raw Nedarim fields needed by the page's legacy calculations.
  let raw = d && d.rawNedarim;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { raw = null; }
  }
  if (raw && typeof raw === 'object') {
    const rawSmall = {};
    for (const key of [
      'KevaId','KevaStatus','KevaName','ClientName','KevaAmount','Amount','KevaCurrency','Currency',
      'KevaTashlumim','Itra','KevaSuccess','HistoryCount','TotalHistoryAmount','CreatedDate','CreationDate',
      'KevaNextDate','NextDate','KevaGroupe','Groupe','KevaAvour','Comments','TransactionType','PaymentType',
      'Tashloumim','Tashlumim','TransactionTime'
    ]) {
      if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') rawSmall[key] = raw[key];
    }
    if (Object.keys(rawSmall).length) out.rawNedarim = rawSmall;
  }
  return out;
}

exports.handler = async function () {
  try {
    const url = APPS_SCRIPT_URL + '?action=get&t=' + Date.now();
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('Apps Script returned invalid JSON'); }
    if (!response.ok || data.success === false) throw new Error(data.error || 'Apps Script request failed');

    const donors = Array.isArray(data.donors) ? data.donors.map(compactDonor) : [];
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=600',
        'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=60, stale-while-revalidate=600',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ success: true, donors, count: donors.length, compact: true })
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ success: false, error: error.message || 'Loading failed' })
    };
  }
};
