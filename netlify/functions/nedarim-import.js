const HISTORY_URL = 'https://matara.pro/nedarimplus/Reports/Manage3.aspx';
const DEFAULT_KEVA_ENDPOINTS = [
  'https://matara.pro/nedarimplus/Reports/Manage3.aspx',
  'https://matara.pro/nedarimplus/Reports/Manage.aspx',
  'https://matara.pro/nedarimplus/Reports/Keva.aspx',
  'https://matara.pro/nedarimplus/Reports/HoraatKeva.aspx',
  'https://matara.pro/nedarimplus/Reports/HoraotKeva.aspx',
  'https://matara.pro/nedarimplus/Reports/KevaAshrai.aspx'
];
const DEFAULT_KEVA_ACTIONS = [
  'GetKevaJson','GetKevaListJson','GetHoraotKevaJson','GetHoraatKevaJson',
  'GetHKJson','GetHKListJson','GetKevaAshraiJson','GetStandingOrdersJson','GetRecurringJson'
];

function reply(statusCode, body) {
  return { statusCode, headers: { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*' }, body: JSON.stringify(body) };
}
function text(v){ return String(v == null ? '' : v).trim(); }
function amount(v){ const n=Number(text(v).replace(/[₪$,\s]/g,'').replace(/,/g,'')); return Number.isFinite(n)?n:0; }
function hash(v){ let h=2166136261; const s=text(v); for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24);} return (h>>>0).toString(36); }
function dateDay(v){ const d=parseDate(v); return d?d.slice(0,10):''; }
function currency(v){ const s=text(v); return s==='2'||/usd|dollar|דולר|\$/i.test(s)?'USD':'ILS'; }
function parseDate(v){
  const s=text(v); if(!s) return '';
  const m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m){ let y=Number(m[3]); if(y<100)y+=2000; const d=new Date(y,Number(m[2])-1,Number(m[1]),Number(m[4]||0),Number(m[5]||0),Number(m[6]||0)); if(!Number.isNaN(d.getTime())) return d.toISOString(); }
  const d=new Date(s); return Number.isNaN(d.getTime())?'':d.toISOString();
}
function normalizeCategory(v){ return text(v).replace(/אהרון/g,'אהרן').replace(/[\s\-_"'׳״.,:;()\[\]{}]+/g,'').toLowerCase(); }
function categoryMatches(row, wanted){
  if(!wanted) return true;
  const hay=normalizeCategory([row.Groupe,row.Group,row.Category,row.KevaGroupe,row.Comments,row.KevaAvour].filter(Boolean).join(' '));
  if(!hay) return true; // Keva API sometimes omits category; do not lose valid standing orders.
  return hay.includes(wanted)||wanted.includes(hay)||((hay.includes('נציבי')||hay.includes('נציב'))&&hay.includes('דעת')&&hay.includes('אהרן'));
}
function parseMaybeJson(v){ if(typeof v!=='string')return v; const s=v.replace(/^\uFEFF/,'').trim(); if(!/^[\[{]/.test(s))return v; try{return JSON.parse(s);}catch(_){return v;} }
function collect(value, mode, out=[], depth=0){
  if(depth>12||value==null)return out; value=parseMaybeJson(value);
  if(Array.isArray(value)){ value.forEach(x=>collect(x,mode,out,depth+1)); return out; }
  if(typeof value!=='object')return out;
  const keys=Object.keys(value);
  const isHistory=['TransactionId','TransactionTime','ClientName','Amount'].some(k=>keys.includes(k));
  const isKeva=text(value.KevaId||value.KevaID)!=='' || ['KevaName','KevaAmount','KevaTashlumim','ClientName','Amount','Itra'].some(k=>text(value[k])!=='');
  if(mode==='history'&&isHistory)out.push(value);
  if(mode==='keva'&&isKeva)out.push(value);
  Object.values(value).forEach(x=>{ if(x&&typeof x==='object'||typeof x==='string') collect(x,mode,out,depth+1); });
  return out;
}
function parseRows(raw, mode){
  let parsed; try{ parsed=JSON.parse(text(raw).replace(/^\uFEFF/,'')); }catch(_){ throw new Error('Nedarim response was not valid JSON'); }
  const rows=collect(parsed,mode); const seen=new Set();
  return rows.filter((r,i)=>{ const key=mode==='keva'?text(r.KevaId||`${r.KevaName}|${r.KevaPhone}|${r.KevaAmount}|${i}`):text(r.TransactionId||`${r.ClientName}|${r.TransactionTime}|${r.Amount}|${i}`); if(seen.has(key))return false; seen.add(key); return true; });
}
function isInactiveKeva(r){
  const status=[r.Status,r.status,r.Notes,r.KevaAvour,r.Comments,r.ErrorText].filter(Boolean).join(' ').toLowerCase();
  const active=text(r.Enabled ?? r.Active ?? r.IsActive).toLowerCase();
  const cancelled=text(r.Cancelled ?? r.Canceled ?? r.IsCancelled).toLowerCase();
  return /מבוטל|בוטל|cancel|inactive|לא\s*פעיל|הופסק|אין\s*יתרת\s*תשלומים/.test(status)||active==='false'||active==='0'||cancelled==='true'||cancelled==='1';
}
function mapHistory(r, mosadId){
  const txId=text(r.TransactionId||r.Id||r.Shovar||r.KabalaId)||hash([r.ClientName,r.Phone,r.Mail,r.Amount,dateDay(r.TransactionTime),r.Groupe].join('|'));
  const transactionType=text(r.TransactionType||r.PaymentType||'רגיל');
  // History rows marked הו"ק are charges of an existing standing order. They are not shown again.
  if(/הו["״']?ק|הוראת\s*קבע|(^|[^a-z])hk([^a-z]|$)|keva|recurring/i.test(transactionType)) return null;
  const total=amount(r.Amount);
  return {
    id:`nedarim-${mosadId}-tx-${txId}`,
    externalId:txId,
    fullName:text(r.ClientName)||'תורם מנדרים פלוס',
    phone:text(r.Phone), email:text(r.Mail), address:text(r.Adresse), city:text(r.City),
    category:text(r.Groupe), memoryContent:text(r.Comments), notes:text(r.Comments),
    status:'paid', amount:total, currency:currency(r.Currency),
    paymentProcessor:'Nedarim Plus', paymentStatus:'approved', paymentApproved:true,
    orderRef:`NED-${txId}`, paymentType:'CARD', donationFrequency:'one_time', donationFrequencyLabel:'תשלום בכרטיס אשראי',
    paymentInstallments:Number(text(r.Tashloumim).replace(/\D/g,''))||1,
    paymentDate:parseDate(r.TransactionTime)||new Date().toISOString(),
    createdAt:parseDate(r.TransactionTime)||new Date().toISOString(), source:'nedarim_card',
    rawNedarim:r, hebDay:'', hebMonth:'', donorName:'', honoreeName:''
  };
}
function mapKeva(r, mosadId){
  const id=text(r.KevaId||r.KevaID); if(!id)return null;
  // ה-API בפועל מחזיר לעיתים את שדות ההוראה בשמות הכלליים הבאים:
  // ClientName, Amount, Itra, CreationDate, Phone, Mail, Adresse, City, Groupe, Comments.
  const remaining=text(r.KevaTashlumim ?? r.kevaTashlumim ?? r.Itra ?? r.Yitra).replace(/[^0-9]/g,'');
  const monthly=amount(r.KevaAmount ?? r.Amount ?? r.MonthlyAmount);
  const created=parseDate(r.CreatedDate||r.CreationDate||r.StartDate||r.StartFrom);
  const inactive=isInactiveKeva(r);
  return {
    id:`nedarim-${mosadId}-keva-${id}`,
    externalId:id, kevaId:id,
    fullName:text(r.KevaName||r.ClientName||r.Name)||'תורם ללא שם',
    phone:text(r.KevaPhone||r.Phone), email:text(r.KevaMail||r.Mail||r.Email),
    address:text(r.KevaAdresse||r.Adresse||r.Address), city:text(r.KevaCity||r.City),
    category:text(r.KevaGroupe||r.Groupe||r.Group||r.Category),
    memoryContent:text(r.KevaAvour||r.Comments||r.Comment||r.Notes),
    notes:text(r.KevaAvour||r.Comments||r.Comment||r.Notes),
    status:inactive?'unpaid':'paid', amount:monthly, monthlyAmount:monthly, currentMonthAmount:monthly,
    currency:currency(r.KevaCurrency||r.Currency), paymentProcessor:'Nedarim Plus',
    paymentStatus:inactive?'inactive':'approved', paymentApproved:!inactive,
    orderRef:`NED-HK-${id}`, paymentType:'HK', donationFrequency:'recurring', donationFrequencyLabel:'הוראת קבע',
    remainingPayments:remaining, remainingInstallments:remaining, remainingCharges:remaining,
    KevaTashlumim:remaining, kevaTashlumim:remaining,
    paymentDate:created, createdAt:created,
    source:'nedarim_recurring', rawNedarim:r, hebDay:'', hebMonth:'', donorName:'', honoreeName:''
  };
}
async function getJson(url){ const res=await fetch(url,{headers:{Accept:'application/json,text/plain,*/*'}}); const raw=await res.text(); return {res,raw}; }
async function fetchHistory({mosadId,password,lastId,maxId}){
  const u=new URL(HISTORY_URL); u.searchParams.set('Action','GetHistoryJson'); u.searchParams.set('MosadId',mosadId); u.searchParams.set('ApiPassword',password); if(lastId)u.searchParams.set('LastId',lastId); u.searchParams.set('MaxId',String(maxId));
  const {res,raw}=await getJson(u.toString()); if(!res.ok)throw new Error('Nedarim history request failed'); return parseRows(raw,'history');
}
async function fetchKeva({mosadId,password,maxId,debug}){
  const endpoints=process.env.NEDARIM_KEVA_URL?[process.env.NEDARIM_KEVA_URL]:DEFAULT_KEVA_ENDPOINTS;
  const actions=process.env.NEDARIM_KEVA_ACTION?[process.env.NEDARIM_KEVA_ACTION]:DEFAULT_KEVA_ACTIONS;
  const attempts=[];
  for(const endpoint of endpoints){ for(const action of actions){
    const u=new URL(endpoint); u.searchParams.set('Action',action); u.searchParams.set('MosadId',mosadId); u.searchParams.set('ApiPassword',password); u.searchParams.set('MaxId',String(maxId));
    try{ const {res,raw}=await getJson(u.toString()); let rows=[]; if(res.ok){ try{rows=parseRows(raw,'keva');}catch(_){} } attempts.push({endpoint,action,status:res.status,rows:rows.length,preview:debug?raw.slice(0,180):undefined}); if(rows.length)return {rows,endpoint,action,attempts}; }catch(e){attempts.push({endpoint,action,error:e.message});}
  }}
  return {rows:[],endpoint:'',action:'',attempts};
}
exports.handler=async function(event){
  if(event.httpMethod==='OPTIONS')return reply(200,{success:true});
  if(event.httpMethod!=='GET')return reply(405,{success:false,message:'GET only'});
  const q=event.queryStringParameters||{}; const mosadId=process.env.NEDARIM_MOSAD_ID||'7018563'; const password=process.env.NEDARIM_API_PASSWORD;
  if(!password)return reply(500,{success:false,message:'Missing NEDARIM_API_PASSWORD'});
  const wanted=normalizeCategory(q.category||process.env.NEDARIM_CATEGORY||'נציבי דעת אהרן'); const maxId=Number(q.maxId||500)||500; const pages=Math.max(1,Math.min(Number(q.pages||20)||20,50)); const debug=q.debug==='1';
  try{
    const history=[]; let cursor='';
    for(let p=0;p<pages;p++){ const rows=await fetchHistory({mosadId,password,lastId:cursor,maxId}); if(!rows.length)break; history.push(...rows); const next=Math.max(...rows.map(r=>Number(r.TransactionId||0)).filter(Number.isFinite),0); if(!next||String(next)===cursor||rows.length<maxId)break; cursor=String(next); }
    const historyMap=new Map();
    history.filter(r=>categoryMatches(r,wanted)).map(r=>mapHistory(r,mosadId)).filter(Boolean).forEach(d=>historyMap.set(d.id,d));
    const historyDonors=[...historyMap.values()];
    const keva=await fetchKeva({mosadId,password,maxId,debug});
    const kevaMap=new Map();
    (keva.rows||[]).filter(r=>categoryMatches(r,wanted)).map(r=>mapKeva(r,mosadId)).filter(Boolean).forEach(d=>kevaMap.set(d.id,d));
    const kevaDonors=[...kevaMap.values()];
    const allMap=new Map();
    [...historyDonors,...kevaDonors].forEach(d=>allMap.set(d.id,d));
    const donors=[...allMap.values()];
    return reply(200,{success:true,imported:donors.length,importedHistory:historyDonors.length,importedKeva:kevaDonors.length,fetched:history.length,fetchedKeva:(keva.rows||[]).length,duplicatesRemoved:(history.length+(keva.rows||[]).length)-donors.length,donors,kevaEndpoint:keva.endpoint,kevaAction:keva.action,debug:debug?{kevaAttempts:keva.attempts}:undefined});
  }catch(e){return reply(500,{success:false,message:e.message});}
};
