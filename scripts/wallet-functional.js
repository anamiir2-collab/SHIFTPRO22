/* Functional sanity test for wallet modules.
 * Loads js/wallet.js in a jsdom window with runScripts:'dangerously'
 * (so bare `localStorage`, `window`, `SPUtils`, etc. resolve correctly),
 * then exercises the public API to ensure no runtime errors and correct
 * calculation behavior.
 *
 * Run with: node scripts/wallet-functional.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost/',
  runScripts: 'dangerously'
});
const { window } = dom;

// ---- Mock storage ----
const storageMap = new Map();
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (k) => storageMap.has(k) ? storageMap.get(k) : null,
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k)
  },
  configurable: true,
  writable: true
});

// ---- Mock SPi18n ----
window.SPi18n = {
  t: (k, v) => {
    let s = k;
    if (v && typeof s === 'string') {
      s = s.replace(/\{(\w+)\}/g, (m, kk) => v[kk] !== undefined ? String(v[kk]) : m);
    }
    return s;
  },
  getLocale: () => 'ar',
  formatDate: (d) => d.toISOString().slice(0, 10),
  formatCurrency: (n) => String(n),
  formatNumber: (n) => String(n),
  subscribe: () => (() => {}),
  apply: () => {}
};

// ---- Mock SPUtils ----
window.SPUtils = {
  $: (sel, root) => (root || window.document).querySelector(sel),
  $$: (sel, root) => Array.from((root || window.document).querySelectorAll(sel)),
  el: (tag, attrs, children) => {
    const node = window.document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'dataset') {
          for (const d in attrs.dataset) node.dataset[d] = attrs.dataset[d];
        } else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (k === 'html') {
          node.innerHTML = attrs[k];
        } else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c == null) return;
        if (typeof c === 'string') node.appendChild(window.document.createTextNode(c));
        else node.appendChild(c);
      });
    }
    return node;
  },
  fmtDate: (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  },
  parseDate: (str) => {
    const [y, m, d] = str.split('-').map(Number);
    return new window.Date(y, m - 1, d);
  },
  todayStr: () => window.SPUtils.fmtDate(new window.Date()),
  uuid: () => 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
  toast: () => {},
  confirmDialog: () => Promise.resolve(true),
  debounce: () => () => {},
  deepClone: (o) => JSON.parse(JSON.stringify(o)),
  fmtCurrency: (n) => String(n),
  fmtNum: (n) => String(n),
  t: (k, v) => window.SPi18n.t(k, v),
  onClickOnce: (fn) => fn
};

// ---- Mock SPStorage ----
window.SPStorage = {
  subscribe: () => (() => {}),
  getSettings: () => ({ cycleDay: 26, salary: 6000 })
};

// ---- Mock SPCalendar ----
window.SPCalendar = {
  getPayPeriod: (refDate) => {
    const cd = 26;
    const y = refDate.getFullYear();
    const m = refDate.getMonth();
    let start;
    if (refDate.getDate() >= cd) start = new window.Date(y, m, cd);
    else start = new window.Date(y, m - 1, cd);
    const end = new window.Date(start.getFullYear(), start.getMonth() + 1, cd - 1);
    return { start, end };
  },
  getPeriodRef: () => new window.Date()
};

// ---- Mock SPSalary ----
window.SPSalary = {
  computeSalary: () => ({ netSalary: 6000, grossSalary: 6000 })
};

// ---- Load wallet.js by injecting a script tag ----
const walletSrc = fs.readFileSync(path.join(root, 'js', 'wallet.js'), 'utf8');
const scriptEl = window.document.createElement('script');
scriptEl.textContent = walletSrc;
window.document.body.appendChild(scriptEl);

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  PASS:', msg); }
  else { fail++; console.error('  FAIL:', msg); }
}

console.log('\n=== Smart Wallet functional tests ===\n');

const W = window.SPWallet;
assert(!!W, 'SPWallet is exposed');
assert(!!W.getData, 'getData exists');
const data = W.getData();
assert(Array.isArray(data.wallets), 'data.wallets is an array');
assert(data.wallets.length === 0, 'starts with no wallets');

const pk = W.currentPeriodKey();
assert(/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(pk), 'currentPeriodKey format: ' + pk);
console.log('    currentPeriodKey =', pk);

const ns = W.getNetSalary();
assert(ns === 6000, 'net salary from SPSalary: ' + ns);

const w1 = W.createWallet({ name: 'Test Wallet 1', amount: 3000, note: 'test', icon: 'home', color: '#3b82f6' });
assert(!!w1 && w1.id, 'createWallet returns wallet with id');
assert(W.getData().wallets.length === 1, 'wallet count after create: 1');

const updated = W.updateWallet(w1.id, { amount: 4000 });
assert(updated.amount === 4000, 'updateWallet changes amount');

assert(W.getTotalAllocated() === 4000, 'getTotalAllocated: 4000');
assert(W.getUnallocated() === 2000, 'getUnallocated: 6000 - 4000 = 2000');

const tx = W.addTransaction(w1.id, { type: 'expense', amount: 500, date: window.SPUtils.todayStr(), description: 'lunch' });
assert(!!tx && tx.id, 'addTransaction returns tx with id');
const stats = W.walletStats(w1, pk);
assert(stats.expenses === 500, 'walletStats.expenses: 500');
assert(stats.balance === 3500, 'walletStats.balance: 4000 - 500 = 3500');

W.addTransaction(w1.id, { type: 'income', amount: 200, date: window.SPUtils.todayStr(), description: 'gift' });
const stats2 = W.walletStats(w1, pk);
assert(stats2.balance === 3700, 'after income: 3500 + 200 = 3700');

const w2 = W.createWallet({ name: 'Test Wallet 2', amount: 1000, note: '', icon: 'piggy', color: '#22c55e' });
const trResult = W.transferMoney(w1.id, w2.id, 800, 'transfer test');
assert(!trResult.error, 'transfer succeeds without error');
const s1 = W.walletStats(w1, pk);
const s2 = W.walletStats(w2, pk);
assert(s1.balance === 2900, 'w1 balance after transfer: 2900 (got ' + s1.balance + ')');
assert(s2.balance === 1800, 'w2 balance after transfer: 1800 (got ' + s2.balance + ')');
assert(s1.transferOut === 800, 'w1 transferOut: 800');
assert(s2.transferIn === 800, 'w2 transferIn: 800');
assert(W.getTotalExpenses(pk) === 500, 'getTotalExpenses excludes transfers: 500');
assert(W.getTotalIncome(pk) === 200, 'getTotalIncome excludes transfers: 200');

const tr2 = W.transferMoney(w1.id, w1.id, 100, '');
assert(tr2.error === 'same_wallet', 'same-wallet transfer rejected');

const tr3 = W.transferMoney(w1.id, w2.id, 0, '');
assert(tr3.error === 'invalid_amount', 'zero-amount transfer rejected');
const tr4 = W.transferMoney(w1.id, w2.id, -50, '');
assert(tr4.error === 'invalid_amount', 'negative-amount transfer rejected');

const proposal = W.generateProposal('503020');
assert(proposal.length === 3, '503020 proposal has 3 wallets');
assert(proposal[0].amount === 3000, '503020 essentials: 3000 (got ' + proposal[0].amount + ')');
assert(proposal[1].amount === 1800, '503020 savings: 1800 (got ' + proposal[1].amount + ')');
assert(proposal[2].amount === 1200, '503020 wants: 1200 (got ' + proposal[2].amount + ')');

const exported = W.exportData();
assert(exported.module === 'SmartWallet', 'export has SmartWallet module marker');
assert(Array.isArray(exported.data.wallets), 'export has wallets array');
assert(exported.data.wallets.length === 2, 'export has 2 wallets');

const dupValidation = W.validateImport(exported);
assert(!dupValidation.ok, 'import validation rejects duplicate IDs');
assert(dupValidation.error === 'duplicate', 'duplicate error code');

const freshExport = JSON.parse(JSON.stringify(exported));
freshExport.data.wallets.forEach((w) => { w.id = 'w_fresh_' + w.id; });
const freshValidation = W.validateImport(freshExport);
assert(freshValidation.ok, 'import validation accepts fresh IDs');

assert(!W.validateImport(null).ok, 'reject null payload');
assert(!W.validateImport({}).ok, 'reject empty object');
assert(!W.validateImport({ data: { version: 1 } }).ok, 'reject missing wallets array');
assert(!W.validateImport({ data: { version: 99, wallets: [] } }).ok, 'reject unsupported version');

assert(!W.isRolloverApplied(pk), 'rollover not yet applied for current period');
W.markRolloverApplied(pk, 'carry');
assert(W.isRolloverApplied(pk), 'rollover marked applied for current period');

const bounds = W.periodKeyBounds(pk);
assert(bounds && bounds.start && bounds.end, 'periodKeyBounds returns dates');

const today = window.SPUtils.fmtDate(new window.Date());
assert(W.dateInPeriod(today, pk), 'today is in current period');

const warnings = W.getWarnings(pk);
assert(Array.isArray(warnings), 'getWarnings returns array');

W.clearAllWallets();
assert(W.getData().wallets.length === 0, 'clearAllWallets empties the list');

// --- Persistence test: reload and verify data survives ---
const persistedData = JSON.parse(storageMap.get('shifpro_wallet_v1'));
assert(Array.isArray(persistedData.wallets), 'persisted data has wallets array');
assert(persistedData.wallets.length === 0, 'persisted data is empty after clear');

console.log('\n=== Results: ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail > 0 ? 1 : 0);
