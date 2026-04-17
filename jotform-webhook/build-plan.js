const {google} = require('googleapis');
const fs = require('fs');
const path = require('path');
const BASE = '/home/p_c_pereira/audit-snapshot-20260411';
const FB = path.join(BASE, 'fase1b');
const SID = '17mHd8eqKoj7Cl6E2MCkr0PczFj-lKv_vmFRCY5hypwg';
const SHEET = 'Formulário de Controle de Caixa';

const ids = fs.readFileSync(path.join(FB,'universe-doc-ids.txt'),'utf8')
  .split('\n').filter(Boolean).map(s=>s.trim());
const nums = ids.map(s=>parseInt(s.replace('trx-',''))).sort((a,b)=>a-b);
console.log('universe:', nums.length, 'min', nums[0], 'max', nums[nums.length-1]);

(async () => {
  const a = new google.auth.GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
  const s = google.sheets({version:'v4', auth: await a.getClient()});
  // batchGet — 1 range per trx (row N+1)
  const ranges = nums.map(n => SHEET + '!A' + (n+1) + ':AR' + (n+1));
  console.log('fetching', ranges.length, 'rows in batches of 100...');
  const sheetRows = {};
  for (let i = 0; i < ranges.length; i += 100) {
    const batch = ranges.slice(i, i+100);
    const r = await s.spreadsheets.values.batchGet({spreadsheetId: SID, ranges: batch});
    r.data.valueRanges.forEach((vr, k) => {
      const n = nums[i+k];
      sheetRows['trx-'+n] = (vr.values && vr.values[0]) || [];
    });
    console.log('  fetched', Math.min(i+100, ranges.length), '/', ranges.length);
  }
  fs.writeFileSync(path.join(FB,'sheet-rows.json'), JSON.stringify(sheetRows, null, 1));
  console.log('saved sheet-rows.json');

  // Build plan: compare planilha vs firestore
  const gv = (f, k) => {
    const v = (f && f[k]) || {};
    return v.stringValue || v.integerValue || v.doubleValue || '';
  };
  const cleanMoney = v => {
    if (!v) return '';
    return String(v).replace(/[R$\s.]/g,'').replace(',','.');
  };
  const rows = [];
  let okCount=0, divCount=0, missCount=0;
  for (const trx of ids) {
    const sr = sheetRows[trx] || [];
    const fbPath = path.join(FB,'universe-current',trx+'.json');
    if (!fs.existsSync(fbPath)) { missCount++; continue; }
    const fb = JSON.parse(fs.readFileSync(fbPath,'utf8'));
    const f = (fb.fields) || {};
    const sheetSubId = sr[42] || '';
    const fbSubId = gv(f,'submissionId');
    const sheetVal = sr[13] || sr[31] || sr[11] || '';
    const fbValOrig = gv(f,'valorOriginal');
    const fbValPago = gv(f,'valorPago');
    const fbValRecb = gv(f,'valueReceived');
    const sheetObs = sr[17] || sr[36] || '';
    const fbDesc = gv(f,'description') || gv(f,'observacao');
    const sheetDue = sr[7] || sr[22] || '';
    const fbDue = gv(f,'dueDate');
    const subIdMatch = sheetSubId && fbSubId && sheetSubId === fbSubId;
    const valMatchOrig = cleanMoney(sheetVal) === cleanMoney(fbValOrig);
    const valMatchPago = cleanMoney(sheetVal) === cleanMoney(fbValPago);
    const valMatchRecb = cleanMoney(sheetVal) === cleanMoney(fbValRecb);
    const status = subIdMatch && (valMatchOrig||valMatchPago||valMatchRecb) ? 'OK' : 'DIVERGE';
    if (status==='OK') okCount++; else divCount++;
    rows.push({trx, status, sheetSubId, fbSubId, subIdMatch, sheetVal, fbValOrig, fbValPago, fbValRecb, sheetObs:sheetObs.slice(0,40), fbDesc:fbDesc.slice(0,40), sheetDue, fbDue});
  }
  // CSV
  const head = ['trx','status','sheetSubId','fbSubId','subIdMatch','sheetVal','fbValOrig','fbValPago','fbValRecb','sheetObs','fbDesc','sheetDue','fbDue'];
  const csv = [head.join('|')].concat(rows.map(r=>head.map(h=>String(r[h]==null?'':r[h]).replace(/\|/g,'/').replace(/\n/g,' ')).join('|'))).join('\n');
  fs.writeFileSync(path.join(FB,'restauracao-plano.csv'), csv);
  console.log('\n=== PLAN SUMMARY ===');
  console.log('OK:', okCount, ' DIVERGE:', divCount, ' MISSING:', missCount);
  console.log('saved restauracao-plano.csv (' + rows.length + ' rows)');

  // Show divergences for hot docs
  const hot = fs.readFileSync(path.join(BASE,'hot-docs.txt'),'utf8').split('\n').filter(Boolean).map(l=>l.trim().split(/\s+/)[1]);
  console.log('\n=== DIVERGÊNCIAS NOS 30 HOT DOCS ===');
  for (const trx of hot) {
    const r = rows.find(x=>x.trx===trx);
    if (!r) { console.log(trx,'MISSING'); continue; }
    const flag = r.status==='OK' ? '✓' : '✗';
    console.log(flag, trx, '| sheet:', (r.sheetObs||'').slice(0,30), r.sheetVal, '| fb:', (r.fbDesc||'').slice(0,30), r.fbValOrig||r.fbValPago||r.fbValRecb, '| subId', r.subIdMatch?'OK':'DIFF');
  }
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
