/* ShiftPro - Smart Wallet core module
   Provides storage, calculations, payroll-period utilities, validation,
   and the dashboard / wallet-detail UI rendering. Form modals live in
   js/wallet-forms.js. Reports / export / rollover live in
   js/wallet-reports.js.

   Exposes: window.SPWallet
   Depends on: SPStorage, SPUtils, SPi18n, SPCalendar, SPSalary
*/
(function (global) {
  'use strict';

  // =========================================================
  // Dependencies
  // =========================================================
  const U = global.SPUtils;
  const i18n = global.SPi18n;
  const storage = global.SPStorage;
  const cal = global.SPCalendar;
  const salary = global.SPSalary;

  const $ = U.$;
  const el = U.el;
  const t = (k, v) => i18n ? i18n.t(k, v) : k;

  // =========================================================
  // Storage
  // =========================================================
  const STORAGE_KEY = 'shifpro_wallet_v1';
  const SCHEMA_VERSION = 1;
  // Track which period-keys have already had a rollover applied.
  const ROLLOVER_KEY = 'shifpro_wallet_rollover_v1';

  function readRaw() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      console.warn('[Wallet] readRaw failed', e);
      return null;
    }
  }

  function writeRaw(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('[Wallet] writeRaw failed', e);
      if (U.toast) U.toast(t('wallet.storage_error'), 'error');
      return false;
    }
  }

  function readRolloverState() {
    try {
      const raw = localStorage.getItem(ROLLOVER_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) { return {}; }
  }
  function writeRolloverState(state) {
    try { localStorage.setItem(ROLLOVER_KEY, JSON.stringify(state)); }
    catch (e) { console.warn('[Wallet] rollover state save failed', e); }
  }

  // Normalize / validate a wallet record loaded from storage or import.
  function normalizeWallet(w) {
    if (!w || typeof w !== 'object') return null;
    const id = typeof w.id === 'string' && w.id ? w.id : ('w_' + U.uuid());
    const name = typeof w.name === 'string' ? w.name : '';
    const amount = parseAmount(w.amount);
    const note = typeof w.note === 'string' ? w.note : '';
    const icon = typeof w.icon === 'string' && w.icon ? w.icon : 'wallet';
    const color = typeof w.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(w.color) ? w.color : '#3b82f6';
    const createdAt = typeof w.createdAt === 'string' ? w.createdAt : new Date().toISOString();
    const txs = Array.isArray(w.transactions) ? w.transactions.map(normalizeTx).filter(Boolean) : [];
    return { id, name, amount, note, icon, color, createdAt, transactions: txs };
  }

  function normalizeTx(tx) {
    if (!tx || typeof tx !== 'object') return null;
    const id = typeof tx.id === 'string' && tx.id ? tx.id : ('t_' + U.uuid());
    const type = ['expense', 'income', 'transfer-in', 'transfer-out'].indexOf(tx.type) >= 0
      ? tx.type : 'expense';
    const amount = parseAmount(tx.amount);
    const description = typeof tx.description === 'string' ? tx.description : '';
    const date = typeof tx.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tx.date) ? tx.date : U.todayStr();
    const periodKey = typeof tx.payrollPeriodKey === 'string' ? tx.payrollPeriodKey : periodKeyForDate(date);
    const createdAt = typeof tx.createdAt === 'string' ? tx.createdAt : new Date().toISOString();
    const transferId = typeof tx.transferId === 'string' ? tx.transferId : null;
    const linkedWalletId = typeof tx.linkedWalletId === 'string' ? tx.linkedWalletId : null;
    const linkedTxId = typeof tx.linkedTxId === 'string' ? tx.linkedTxId : null;
    return { id, type, amount, description, date, payrollPeriodKey: periodKey, createdAt,
             transferId, linkedWalletId, linkedTxId };
  }

  function normalizeData(data) {
    if (!data || typeof data !== 'object') return defaultData();
    const version = Number(data.version) || SCHEMA_VERSION;
    const wallets = Array.isArray(data.wallets)
      ? data.wallets.map(normalizeWallet).filter(Boolean)
      : [];
    const manualSalaryOn = !!data.manualSalaryOn;
    const manualSalary = parseAmount(data.manualSalary);
    const additionalIncome = parseAmount(data.additionalIncome);
    const rolloverState = data.rolloverState && typeof data.rolloverState === 'object'
      ? data.rolloverState : {};
    return {
      version: SCHEMA_VERSION,
      manualSalaryOn,
      manualSalary,
      additionalIncome,
      wallets,
      rolloverState
    };
  }

  function defaultData() {
    return {
      version: SCHEMA_VERSION,
      manualSalaryOn: false,
      manualSalary: 0,
      additionalIncome: 0,
      wallets: [],
      rolloverState: {}
    };
  }

  let cache = null;
  let unsubscribers = [];
  const subscribers = [];

  function getData() {
    if (cache) return cache;
    const raw = readRaw();
    cache = raw ? normalizeData(raw) : defaultData();
    return cache;
  }

  function saveData() {
    if (!cache) return false;
    return writeRaw(cache);
  }

  function notify() {
    subscribers.forEach((cb) => {
      try { cb(); } catch (e) { console.error('[Wallet] subscriber error', e); }
    });
  }

  function subscribe(cb) {
    subscribers.push(cb);
    return () => {
      const i = subscribers.indexOf(cb);
      if (i >= 0) subscribers.splice(i, 1);
    };
  }

  // =========================================================
  // Payroll-period utilities
  // =========================================================

  // Returns {start: Date, end: Date} for any reference date,
  // using the existing SPCalendar.getPayPeriod (cycleDay from settings).
  function getPeriodForDate(refDate) {
    return cal.getPayPeriod(refDate);
  }

  // Stable string key: "2026-09-26_2026-10-25"
  function periodKeyForDates(start, end) {
    return U.fmtDate(start) + '_' + U.fmtDate(end);
  }
  function periodKeyForDate(dateStr) {
    try {
      const d = U.parseDate(dateStr);
      const p = getPeriodForDate(d);
      return periodKeyForDates(p.start, p.end);
    } catch (e) {
      return '';
    }
  }

  function currentPeriod() {
    return getPeriodForDate(new Date());
  }
  function currentPeriodKey() {
    const p = currentPeriod();
    return periodKeyForDates(p.start, p.end);
  }

  function previousPeriodKey() {
    const cur = currentPeriod();
    const before = new Date(cur.start.getTime() - 86400000);
    const prev = getPeriodForDate(before);
    return periodKeyForDates(prev.start, prev.end);
  }

  function periodKeyBounds(key) {
    // Returns {start: Date, end: Date} from a period key.
    if (!key || typeof key !== 'string') return null;
    const parts = key.split('_');
    if (parts.length !== 2) return null;
    try {
      const start = U.parseDate(parts[0]);
      const end = U.parseDate(parts[1]);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
      return { start, end };
    } catch (e) { return null; }
  }

  function dateInPeriod(dateStr, periodKey) {
    const b = periodKeyBounds(periodKey);
    if (!b) return false;
    try {
      const d = U.parseDate(dateStr);
      return d >= b.start && d <= b.end;
    } catch (e) { return false; }
  }

  function formatPeriodLabel(key) {
    const b = periodKeyBounds(key);
    if (!b) return '';
    const s = i18n.formatDate(b.start, { day: 'numeric', month: 'short' });
    const e = i18n.formatDate(b.end, { day: 'numeric', month: 'short', year: 'numeric' });
    return t('wallet.period_label', { start: s, end: e });
  }

  // =========================================================
  // Salary
  // =========================================================

  // Returns the effective net salary for the current payroll period.
  // Uses manual salary if enabled, otherwise the salary computed by SPSalary.
  // Always a non-negative finite number (0 if unavailable).
  function getNetSalary() {
    const data = getData();
    if (data.manualSalaryOn && data.manualSalary > 0) {
      return round2(data.manualSalary);
    }
    try {
      const p = currentPeriod();
      const result = salary.computeSalary(p.start, p.end);
      if (result && Number.isFinite(result.netSalary)) {
        return round2(Math.max(0, result.netSalary));
      }
    } catch (e) {
      console.warn('[Wallet] net salary computation failed', e);
    }
    return 0;
  }

  function getSalarySource() {
    const data = getData();
    return data.manualSalaryOn ? 'manual' : 'auto';
  }

  function setManualSalary(enabled, amount) {
    const data = getData();
    data.manualSalaryOn = !!enabled;
    data.manualSalary = parseAmount(amount);
    if (saveData()) notify();
  }

  function setAdditionalIncome(amount) {
    const data = getData();
    data.additionalIncome = parseAmount(amount);
    if (saveData()) notify();
  }

  // =========================================================
  // Calculations
  // =========================================================

  function parseAmount(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : 0;
    // Strip thousands separators (commas), then extract the first numeric
    // substring (supports negative + decimals). This is more robust than
    // stripping non-digits because currency symbols like "ج.م" contain
    // dots that would otherwise confuse parseFloat.
    const cleaned = String(v).replace(/,/g, '');
    const m = cleaned.match(/-?\d+(\.\d+)?/);
    if (!m) return 0;
    const n = parseFloat(m[0]);
    return Number.isFinite(n) ? round2(n) : 0;
  }

  function round2(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  // Filter transactions for a wallet by period.
  function walletTxsForPeriod(wallet, periodKey) {
    if (!wallet || !Array.isArray(wallet.transactions)) return [];
    if (!periodKey) return wallet.transactions.slice();
    return wallet.transactions.filter((tx) => {
      // Prefer stored period key; fall back to computing from date.
      if (tx.payrollPeriodKey) return tx.payrollPeriodKey === periodKey;
      return periodKeyForDate(tx.date) === periodKey;
    });
  }

  function walletStats(wallet, periodKey) {
    const txs = walletTxsForPeriod(wallet, periodKey);
    let expenses = 0, income = 0, transferIn = 0, transferOut = 0;
    txs.forEach((tx) => {
      switch (tx.type) {
        case 'expense': expenses += tx.amount; break;
        case 'income': income += tx.amount; break;
        case 'transfer-in': transferIn += tx.amount; break;
        case 'transfer-out': transferOut += tx.amount; break;
      }
    });
    const balance = round2(wallet.amount - expenses - transferOut + transferIn + income);
    return {
      expenses: round2(expenses),
      income: round2(income),
      transferIn: round2(transferIn),
      transferOut: round2(transferOut),
      balance,
      txCount: txs.length
    };
  }

  function getTotalAllocated() {
    const data = getData();
    return round2(data.wallets.reduce((s, w) => s + (w.amount || 0), 0));
  }

  function getUnallocated() {
    const data = getData();
    const salaryVal = getNetSalary();
    const allocated = getTotalAllocated();
    return round2(salaryVal + (data.additionalIncome || 0) - allocated);
  }

  function getTotalExpenses(periodKey) {
    const key = periodKey || currentPeriodKey();
    const data = getData();
    let total = 0;
    data.wallets.forEach((w) => {
      const txs = walletTxsForPeriod(w, key);
      txs.forEach((tx) => { if (tx.type === 'expense') total += tx.amount; });
    });
    return round2(total);
  }

  function getTotalIncome(periodKey) {
    const key = periodKey || currentPeriodKey();
    const data = getData();
    let total = 0;
    data.wallets.forEach((w) => {
      const txs = walletTxsForPeriod(w, key);
      txs.forEach((tx) => { if (tx.type === 'income') total += tx.amount; });
    });
    return round2(total);
  }

  function getTotalTransfersIn(periodKey) {
    const key = periodKey || currentPeriodKey();
    const data = getData();
    let total = 0;
    data.wallets.forEach((w) => {
      const txs = walletTxsForPeriod(w, key);
      txs.forEach((tx) => { if (tx.type === 'transfer-in') total += tx.amount; });
    });
    return round2(total);
  }
  function getTotalTransfersOut(periodKey) {
    const key = periodKey || currentPeriodKey();
    const data = getData();
    let total = 0;
    data.wallets.forEach((w) => {
      const txs = walletTxsForPeriod(w, key);
      txs.forEach((tx) => { if (tx.type === 'transfer-out') total += tx.amount; });
    });
    return round2(total);
  }

  function getTotalRemaining(periodKey) {
    const key = periodKey || currentPeriodKey();
    const data = getData();
    return round2(data.wallets.reduce((s, w) => s + walletStats(w, key).balance, 0));
  }

  function getWalletById(id) {
    const data = getData();
    return data.wallets.find((w) => w.id === id) || null;
  }

  function getWalletStatsById(id, periodKey) {
    const w = getWalletById(id);
    return w ? walletStats(w, periodKey || currentPeriodKey()) : null;
  }

  function getWarnings(periodKey) {
    const key = periodKey || currentPeriodKey();
    const data = getData();
    const out = [];
    const unallocated = getUnallocated();
    if (unallocated < 0) {
      out.push({ type: 'overallocate', message: t('wallet.overspend_warning') });
    }
    data.wallets.forEach((w) => {
      const s = walletStats(w, key);
      if (s.balance < 0) {
        out.push({
          type: 'negative_balance',
          walletId: w.id,
          walletName: w.name,
          message: (i18n && i18n.getLocale() === 'ar'
            ? 'محفظة «' + w.name + '» برصيد سالب ' + fmtWalletCurrency(s.balance)
            : 'Wallet "' + w.name + '" has a negative balance: ' + fmtWalletCurrency(s.balance))
        });
      }
    });
    return out;
  }

  // =========================================================
  // Wallet CRUD
  // =========================================================

  function createWallet(input) {
    const data = getData();
    const w = normalizeWallet({
      id: 'w_' + U.uuid(),
      name: (input.name || '').trim(),
      amount: parseAmount(input.amount),
      note: (input.note || '').trim(),
      icon: input.icon || 'wallet',
      color: input.color || '#3b82f6',
      createdAt: new Date().toISOString(),
      transactions: []
    });
    data.wallets.push(w);
    if (!saveData()) return null;
    notify();
    return w;
  }

  function updateWallet(id, patch) {
    const data = getData();
    const w = data.wallets.find((x) => x.id === id);
    if (!w) return null;
    if (patch && typeof patch.name === 'string') w.name = patch.name.trim();
    if (patch && 'amount' in patch) w.amount = parseAmount(patch.amount);
    if (patch && typeof patch.note === 'string') w.note = patch.note.trim();
    if (patch && typeof patch.icon === 'string') w.icon = patch.icon;
    if (patch && typeof patch.color === 'string') w.color = patch.color;
    if (!saveData()) return null;
    notify();
    return w;
  }

  async function deleteWallet(id) {
    const data = getData();
    const w = data.wallets.find((x) => x.id === id);
    if (!w) return false;
    const ok = await U.confirmDialog(t('wallet.confirm_delete_wallet'), {
      title: t('wallet.confirm_delete_wallet_title'),
      danger: true,
      okText: t('common.delete')
    });
    if (!ok) return false;
    // Also remove any linked transfer transactions in other wallets.
    const linkedTxIds = (w.transactions || [])
      .filter((tx) => tx.transferId && tx.linkedTxId)
      .map((tx) => tx.linkedTxId);
    data.wallets = data.wallets.filter((x) => x.id !== id);
    if (linkedTxIds.length) {
      data.wallets.forEach((other) => {
        if (!other.transactions) return;
        other.transactions = other.transactions.filter(
          (tx) => linkedTxIds.indexOf(tx.id) < 0
        );
      });
    }
    if (!saveData()) return false;
    notify();
    return true;
  }

  // =========================================================
  // Transactions
  // =========================================================

  function addTransaction(walletId, input) {
    const data = getData();
    const w = data.wallets.find((x) => x.id === walletId);
    if (!w) return null;
    const tx = normalizeTx({
      id: 't_' + U.uuid(),
      type: input.type || 'expense',
      amount: parseAmount(input.amount),
      description: (input.description || '').trim(),
      date: input.date || U.todayStr(),
      createdAt: new Date().toISOString()
    });
    if (!w.transactions) w.transactions = [];
    w.transactions.push(tx);
    if (!saveData()) return null;
    notify();
    return tx;
  }

  function updateTransaction(walletId, txId, patch) {
    const data = getData();
    const w = data.wallets.find((x) => x.id === walletId);
    if (!w || !w.transactions) return null;
    const tx = w.transactions.find((x) => x.id === txId);
    if (!tx) return null;
    if (patch && 'amount' in patch) tx.amount = parseAmount(patch.amount);
    if (patch && typeof patch.description === 'string') tx.description = patch.description.trim();
    if (patch && typeof patch.date === 'string') {
      tx.date = patch.date;
      tx.payrollPeriodKey = periodKeyForDate(patch.date);
    }
    // Type changes inside a linked transfer would break the relationship.
    if (patch && typeof patch.type === 'string' && !tx.transferId) {
      tx.type = ['expense', 'income'].indexOf(patch.type) >= 0 ? patch.type : tx.type;
    }
    if (!saveData()) return null;
    notify();
    return tx;
  }

  async function deleteTransaction(walletId, txId) {
    const data = getData();
    const w = data.wallets.find((x) => x.id === walletId);
    if (!w || !w.transactions) return false;
    const tx = w.transactions.find((x) => x.id === txId);
    if (!tx) return false;

    // If this is a transfer leg, confirm and remove the linked leg too.
    if (tx.transferId && tx.linkedTxId) {
      const ok = await U.confirmDialog(t('wallet.confirm_delete_transfer'), {
        title: t('wallet.confirm_delete_transfer_title'),
        danger: true,
        okText: t('common.delete')
      });
      if (!ok) return false;
      const linkedWalletId = tx.linkedWalletId;
      const linkedTxId = tx.linkedTxId;
      w.transactions = w.transactions.filter((x) => x.id !== txId);
      const other = data.wallets.find((x) => x.id === linkedWalletId);
      if (other && other.transactions) {
        other.transactions = other.transactions.filter((x) => x.id !== linkedTxId);
      }
    } else {
      const ok = await U.confirmDialog(t('wallet.confirm_delete_tx'), {
        title: t('wallet.confirm_delete_tx_title'),
        danger: true,
        okText: t('common.delete')
      });
      if (!ok) return false;
      w.transactions = w.transactions.filter((x) => x.id !== txId);
    }
    if (!saveData()) return false;
    notify();
    return true;
  }

  // =========================================================
  // Transfers
  // =========================================================
  // A transfer creates two linked transactions:
  //   - transfer-out in the source wallet
  //   - transfer-in  in the destination wallet
  // Both share transferId; each tx references the other's wallet+tx.

  function transferMoney(fromWalletId, toWalletId, amount, note) {
    const data = getData();
    if (fromWalletId === toWalletId) {
      return { error: 'same_wallet' };
    }
    const amt = parseAmount(amount);
    if (amt <= 0) return { error: 'invalid_amount' };
    const fromW = data.wallets.find((x) => x.id === fromWalletId);
    const toW = data.wallets.find((x) => x.id === toWalletId);
    if (!fromW) return { error: 'from_not_found' };
    if (!toW) return { error: 'to_not_found' };

    const transferId = 'tf_' + U.uuid();
    const date = U.todayStr();
    const periodKey = periodKeyForDate(date);
    const outTx = normalizeTx({
      id: 't_' + U.uuid(),
      type: 'transfer-out',
      amount: amt,
      description: (note || '').trim(),
      date,
      createdAt: new Date().toISOString(),
      transferId,
      linkedWalletId: toWalletId,
      linkedTxId: null // set after we know the in-tx id
    });
    outTx.payrollPeriodKey = periodKey;
    const inTx = normalizeTx({
      id: 't_' + U.uuid(),
      type: 'transfer-in',
      amount: amt,
      description: (note || '').trim(),
      date,
      createdAt: new Date().toISOString(),
      transferId,
      linkedWalletId: fromWalletId,
      linkedTxId: outTx.id
    });
    inTx.payrollPeriodKey = periodKey;
    outTx.linkedTxId = inTx.id;

    if (!fromW.transactions) fromW.transactions = [];
    if (!toW.transactions) toW.transactions = [];
    fromW.transactions.push(outTx);
    toW.transactions.push(inTx);

    if (!saveData()) return { error: 'storage' };
    notify();
    return { outTx, inTx };
  }

  // =========================================================
  // Suggest a Distribution
  // =========================================================
  // Generates a *proposal* only. Never applies without explicit user
  // confirmation in the modal (js/wallet-forms.js).

  function generateProposal(method) {
    const salaryVal = getNetSalary();
    const incomeAdd = (getData().additionalIncome || 0);
    const total = round2(salaryVal + incomeAdd);
    if (total <= 0) return [];
    if (method === '503020') {
      return [
        { name: t('wallet.suggest_essentials'), amount: round2(total * 0.50), icon: 'home', color: '#3b82f6' },
        { name: t('wallet.suggest_savings'),    amount: round2(total * 0.30), icon: 'piggy', color: '#22c55e' },
        { name: t('wallet.suggest_wants'),      amount: round2(total * 0.20), icon: 'cart',  color: '#f59e0b' }
      ];
    }
    if (method === 'envelope') {
      const per = round2(total / 4);
      const palette = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];
      const icons = ['wallet', 'cart', 'piggy', 'home'];
      const labels = [
        t('wallet.suggest_envelope_label') + ' 1',
        t('wallet.suggest_envelope_label') + ' 2',
        t('wallet.suggest_envelope_label') + ' 3',
        t('wallet.suggest_envelope_label') + ' 4'
      ];
      return labels.map((nm, i) => ({
        name: nm, amount: per, icon: icons[i], color: palette[i]
      }));
    }
    // custom: empty proposal so user builds it themselves
    return [{ name: '', amount: 0, icon: 'wallet', color: '#3b82f6' }];
  }

  // Apply proposal: 'add' merges with existing wallets; 'replace' wipes first.
  // Returns the new wallets array on success.
  function applyProposal(proposal, mode) {
    if (!Array.isArray(proposal) || !proposal.length) return null;
    const data = getData();
    if (mode === 'replace') {
      data.wallets = [];
    }
    proposal.forEach((p) => {
      if (!p || !p.name) return;
      const w = normalizeWallet({
        id: 'w_' + U.uuid(),
        name: String(p.name).trim(),
        amount: parseAmount(p.amount),
        note: '',
        icon: p.icon || 'wallet',
        color: p.color || '#3b82f6',
        createdAt: new Date().toISOString(),
        transactions: []
      });
      data.wallets.push(w);
    });
    if (!saveData()) return null;
    notify();
    return data.wallets;
  }

  // =========================================================
  // Rollover (period transition)
  // =========================================================
  // Returns the rollover state for a given period key.
  function isRolloverApplied(periodKey) {
    const state = readRolloverState();
    return !!(state[periodKey] && state[periodKey].applied);
  }
  function markRolloverApplied(periodKey, mode) {
    const state = readRolloverState();
    state[periodKey] = {
      applied: true,
      mode,
      at: new Date().toISOString()
    };
    writeRolloverState(state);
  }

  // Carry forward: adds each wallet's *previous-period* balance to its
  // allocation in the new period. Returns the number of wallets affected.
  function rolloverCarryForward(fromPeriodKey) {
    const data = getData();
    let touched = 0;
    data.wallets.forEach((w) => {
      const stats = walletStats(w, fromPeriodKey);
      w.amount = round2((w.amount || 0) + stats.balance);
      touched++;
    });
    if (!saveData()) return -1;
    notify();
    return touched;
  }

  // Reset: keep wallet definitions but reset current-period transactions.
  // IMPORTANT: We do NOT delete historical transactions. Instead, we set
  // each wallet's allocation to its original amount and *re-attribute* any
  // current-period transactions to the previous-period key so they remain
  // accessible in reports. (Per requirement: "Do not reset wallet balances
  // or delete old transactions merely because the calendar month changes.")
  //
  // In practice, "reset" here means: keep the same allocations, do not
  // carry forward balances. Historical transactions remain intact because
  // they already carry their own payrollPeriodKey.
  function rolloverReset() {
    // No state change to wallets needed: transactions are already tagged
    // with their periodKey, so the new period will simply show empty lists
    // until new transactions are added. We just mark the rollover done.
    return true;
  }

  function rolloverSkip() {
    return true;
  }

  // =========================================================
  // Export / Import
  // =========================================================
  function exportData() {
    const data = getData();
    return {
      app: 'ShiftPro',
      module: 'SmartWallet',
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        version: data.version,
        manualSalaryOn: data.manualSalaryOn,
        manualSalary: data.manualSalary,
        additionalIncome: data.additionalIncome,
        wallets: data.wallets,
        currentPeriodKey: currentPeriodKey()
      }
    };
  }

  function validateImport(payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'invalid' };
    // Accept both `{data: {...}}` (full export) and a bare wallet-data object.
    const data = payload.data ? payload.data : payload;
    if (!data || typeof data !== 'object') return { ok: false, error: 'invalid' };
    if (!Array.isArray(data.wallets)) return { ok: false, error: 'no_data' };
    // Version check
    const ver = Number(data.version);
    if (!Number.isFinite(ver) || ver > SCHEMA_VERSION) {
      return { ok: false, error: 'version' };
    }
    // Normalize + check duplicate IDs against current data.
    const normalized = normalizeData(data);
    const existingIds = getData().wallets.map((w) => w.id);
    const incomingIds = normalized.wallets.map((w) => w.id);
    const dupes = incomingIds.filter((id) => existingIds.indexOf(id) >= 0);
    if (dupes.length) return { ok: false, error: 'duplicate', duplicates: dupes };
    return { ok: true, normalized };
  }

  function importData(payload, mode) {
    const result = validateImport(payload);
    if (!result.ok) return { ok: false, error: result.error };
    const incoming = result.normalized;
    const data = getData();
    if (mode === 'replace') {
      data.wallets = incoming.wallets;
      data.manualSalaryOn = incoming.manualSalaryOn;
      data.manualSalary = incoming.manualSalary;
      data.additionalIncome = incoming.additionalIncome;
    } else {
      // merge: append incoming wallets (duplicates already rejected)
      data.wallets = data.wallets.concat(incoming.wallets);
    }
    if (!saveData()) return { ok: false, error: 'storage' };
    notify();
    return { ok: true };
  }

  function clearAllWallets() {
    cache = defaultData();
    if (saveData()) notify();
  }

  // =========================================================
  // UI: icon library
  // =========================================================
  const ICONS = {
    wallet: '<svg viewBox="0 0 24 24"><path d="M3 7h18v12H3z"/><path d="M16 12h3"/><path d="M3 7l2-3h11v3"/></svg>',
    home:   '<svg viewBox="0 0 24 24"><path d="M3 12l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
    cart:   '<svg viewBox="0 0 24 24"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l3 12h12l2-8H7"/></svg>',
    piggy:  '<svg viewBox="0 0 24 24"><path d="M19 9c1 1 1 3 0 4l-1 1v3h-3v-1H9v1H6v-3c-2-1-3-3-3-5s1-3 3-4l1-1 1-1h8l1 1 1 1c1 0 1 1 0 1z"/><circle cx="14" cy="10" r="1"/></svg>',
    car:    '<svg viewBox="0 0 24 24"><path d="M3 13l2-5h14l2 5v5h-3v-2H6v2H3z"/><circle cx="7" cy="15" r="1.2"/><circle cx="17" cy="15" r="1.2"/></svg>',
    food:   '<svg viewBox="0 0 24 24"><path d="M5 3v8a3 3 0 0 0 6 0V3"/><path d="M8 3v18"/><path d="M17 3c-2 0-3 2-3 4s1 4 3 4v10"/></svg>',
    health: '<svg viewBox="0 0 24 24"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg>',
    edu:    '<svg viewBox="0 0 24 24"><path d="M2 9l10-4 10 4-10 4z"/><path d="M6 11v5c0 1 3 2 6 2s6-1 6-2v-5"/></svg>',
    gift:   '<svg viewBox="0 0 24 24"><rect x="3" y="9" width="18" height="12" rx="1"/><path d="M3 13h18M12 9v12"/><path d="M12 9S10 4 7 5s2 4 5 4zM12 9s2-5 5-4-2 4-5 4z"/></svg>',
    travel: '<svg viewBox="0 0 24 24"><path d="M2 12l20-7-7 20-3-8-10-5z"/></svg>',
    bills:  '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    bank:   '<svg viewBox="0 0 24 24"><path d="M3 10l9-5 9 5"/><path d="M4 10v9M9 10v9M15 10v9M20 10v9M3 19h18"/></svg>',
    phone:  '<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>',
    star:   '<svg viewBox="0 0 24 24"><path d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>'
  };

  function iconSvg(name) {
    return ICONS[name] || ICONS.wallet;
  }

  // =========================================================
  // UI: Dashboard rendering
  // =========================================================
  let activeSubPage = 'dashboard'; // dashboard | reports | export
  let balancesHidden = false;
  function fmtWalletCurrency(value) { return balancesHidden ? '••••••' : U.fmtCurrency(value); }
  let activeWalletId = null; // when viewing wallet details
  let activePeriodKey = null; // for reports (defaults to current)

  function setActiveSubPage(p) {
    activeSubPage = p;
    render();
  }

  function openWalletDetails(walletId) {
    activeWalletId = walletId;
    activeSubPage = 'wallet-detail';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function backToDashboard() {
    activeWalletId = null;
    activeSubPage = 'dashboard';
    render();
  }

  function render() {
    const page = $('#page-wallet');
    if (!page) return;
    // Defer to forms/reports submodules when needed.
    if (activeSubPage === 'wallet-detail') {
      renderWalletDetail(page);
    } else if (activeSubPage === 'reports') {
      if (global.SPWalletReports) global.SPWalletReports.render(page);
    } else if (activeSubPage === 'export') {
      if (global.SPWalletReports) global.SPWalletReports.renderExport(page);
    } else {
      renderDashboard(page);
    }
    // Apply translations
    if (i18n) i18n.apply(page);
  }

  function renderDashboard(page) {
    const data = getData();
    const periodKey = currentPeriodKey();
    const netSalary = getNetSalary();
    const allocated = getTotalAllocated();
    const unallocated = getUnallocated();
    const totalExpenses = getTotalExpenses(periodKey);
    const totalRemaining = getTotalRemaining(periodKey);
    const periodLabel = formatPeriodLabel(periodKey);
    const overspent = unallocated < 0;

    const summaryCellCls = unallocated > 0 ? 'positive'
      : unallocated === 0 ? 'zero' : 'negative';

    page.innerHTML = '';

    // Topbar
    page.appendChild(el('div', { class: 'wallet-topbar' }, [
      el('div', {}, [
        el('div', { class: 'wallet-title', 'data-i18n': 'wallet.title' }, [t('wallet.title')]),
        el('div', { class: 'wallet-subtitle', 'data-i18n': 'wallet.subtitle' }, [t('wallet.subtitle')])
      ]),
      el('div', { class: 'wallet-actions' }, [
        el('button', {
          class: 'wallet-icon-btn wallet-balance-toggle',
          'data-i18n-aria': balancesHidden ? 'wallet.show_balances' : 'wallet.hide_balances',
          'aria-label': t(balancesHidden ? 'wallet.show_balances' : 'wallet.hide_balances'),
          title: t(balancesHidden ? 'wallet.show_balances' : 'wallet.hide_balances'),
          'aria-pressed': String(balancesHidden),
          onclick: () => { balancesHidden = !balancesHidden; render(); }
        }, [svgParse(balancesHidden
          ? '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.5 4.5 9 7-.2 1-1 2.1-2.1 3.1"/><path d="M6.2 6.2C4.2 7.4 3.2 9.3 3 12c.3 1.8 1.6 3.6 4 5"/></svg>'
          : '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>')]),
        el('button', {
          class: 'wallet-icon-btn',
          'data-i18n-aria': 'wallet.suggest_btn',
          'aria-label': t('wallet.suggest_btn'),
          title: t('wallet.suggest_btn'),
          onclick: () => { if (global.SPWalletForms) global.SPWalletForms.openSuggest(); }
        }, [svgParse('<svg viewBox="0 0 24 24"><path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z"/><path d="M5 16l.7 2 2 .7-2 .7L5 22l-.7-2-2-.7 2-.7z"/></svg>')]),
        el('button', {
          class: 'wallet-icon-btn',
          'data-i18n-aria': 'wallet.transfer_money',
          'aria-label': t('wallet.transfer_money'),
          title: t('wallet.transfer_money'),
          onclick: () => { if (global.SPWalletForms) global.SPWalletForms.openTransfer(); }
        }, [svgParse('<svg viewBox="0 0 24 24"><path d="M7 10l-4 4 4 4"/><path d="M3 14h11"/><path d="M17 6l4 4-4 4"/><path d="M21 10H10"/></svg>')]),
        el('button', {
          class: 'wallet-icon-btn',
          'data-i18n-aria': 'wallet.page_export',
          'aria-label': t('wallet.page_export'),
          title: t('wallet.page_export'),
          onclick: () => setActiveSubPage('export')
        }, [svgParse('<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M5 21h14"/></svg>')])
      ])
    ]));

    // Sub-navigation
    const subnav = el('div', { class: 'wallet-subnav' });
    [
      { id: 'dashboard', label: t('wallet.page_dashboard') },
      { id: 'reports',   label: t('wallet.page_reports') },
      { id: 'export',    label: t('wallet.page_export') }
    ].forEach((s) => {
      subnav.appendChild(el('button', {
        class: 'wallet-subnav-btn' + (activeSubPage === s.id ? ' active' : ''),
        onclick: () => setActiveSubPage(s.id)
      }, [s.label]));
    });
    page.appendChild(subnav);

    // Salary settings collapsible
    page.appendChild(renderSalarySettings());

    // Sticky summary
    const summary = el('div', { class: 'wallet-summary' });
    summary.appendChild(el('div', { class: 'wallet-period-row' }, [
      el('span', { 'data-i18n': 'wallet.current_period' }, [t('wallet.current_period')]),
      el('span', { class: 'period-pill' }, [periodLabel])
    ]));
    const grid = el('div', { class: 'wallet-summary-grid' });
    grid.appendChild(summaryCell('wallet.net_salary', fmtWalletCurrency(netSalary)));
    grid.appendChild(summaryCell('wallet.total_allocated', fmtWalletCurrency(allocated)));
    grid.appendChild(summaryCell('wallet.total_expenses', fmtWalletCurrency(totalExpenses)));
    grid.appendChild(summaryCell('wallet.total_remaining', fmtWalletCurrency(totalRemaining)));
    grid.appendChild(el('div', { class: 'wallet-summary-cell unallocated' }, [
      el('span', { class: 'lbl', 'data-i18n': 'wallet.unallocated' }, [t('wallet.unallocated')]),
      el('span', { class: 'val ' + summaryCellCls }, [fmtWalletCurrency(unallocated)])
    ]));
    summary.appendChild(grid);
    if (overspent) {
      summary.appendChild(el('div', { class: 'wallet-overspend-warning' }, [
        svgParse('<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z"/><path d="M12 9v5M12 17v.5"/></svg>'),
        el('span', {}, [t('wallet.overspend_warning')])
      ]));
    }
    page.appendChild(summary);

    // Wallets section
    const sectionHead = el('div', { class: 'wallet-section-head' }, [
      el('h3', { 'data-i18n': 'wallet.wallets_title' }, [t('wallet.wallets_title')]),
      el('span', { class: 'count' }, [String(data.wallets.length)])
    ]);
    page.appendChild(sectionHead);

    if (!data.wallets.length) {
      page.appendChild(renderEmptyState());
    } else {
      const grid2 = el('div', { class: 'wallet-grid' });
      data.wallets.forEach((w) => grid2.appendChild(renderWalletCard(w, periodKey)));
      page.appendChild(grid2);
    }

    // Add wallet button
    page.appendChild(el('button', {
      class: 'wallet-btn primary block',
      style: 'margin-top:12px;',
      onclick: () => { if (global.SPWalletForms) global.SPWalletForms.openAddWallet(); }
    }, [
      svgParse('<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'),
      el('span', { 'data-i18n': 'wallet.add_wallet' }, [t('wallet.add_wallet')])
    ]));
  }

  function summaryCell(labelKey, value) {
    return el('div', { class: 'wallet-summary-cell' }, [
      el('span', { class: 'lbl', 'data-i18n': labelKey }, [t(labelKey)]),
      el('span', { class: 'val' }, [value])
    ]);
  }

  function renderEmptyState() {
    return el('div', { class: 'wallet-empty' }, [
      el('div', { class: 'ico' }, [svgParse('<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><circle cx="17" cy="14" r="1"/></svg>')]),
      el('h4', { 'data-i18n': 'wallet.empty_title' }, [t('wallet.empty_title')]),
      el('p',  { 'data-i18n': 'wallet.empty_body' }, [t('wallet.empty_body')]),
      el('button', {
        class: 'wallet-btn primary',
        onclick: () => { if (global.SPWalletForms) global.SPWalletForms.openAddWallet(); }
      }, [
        svgParse('<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'),
        el('span', { 'data-i18n': 'wallet.add_wallet' }, [t('wallet.add_wallet')])
      ])
    ]);
  }

  function renderWalletCard(w, periodKey) {
    const stats = walletStats(w, periodKey);
    const remCls = stats.balance > 0 ? 'positive' : (stats.balance < 0 ? 'negative' : '');
    const card = el('div', { class: 'wallet-card', dataset: { wid: w.id } });
    card.appendChild(el('div', { class: 'accent-bar', style: 'background:' + w.color }));

    const head = el('div', { class: 'wallet-card-head' });
    const iconBox = el('div', {
      class: 'wallet-card-icon',
      style: 'background:' + w.color
    }, [svgParse(iconSvg(w.icon))]);
    head.appendChild(iconBox);
    const info = el('div', { class: 'wallet-card-info' }, [
      el('div', { class: 'wallet-card-name' }, [w.name || '—']),
      w.note ? el('div', { class: 'wallet-card-note' }, [w.note]) : null
    ]);
    head.appendChild(info);
    const actions = el('div', { class: 'wallet-card-actions' });
    actions.appendChild(el('button', {
      'data-i18n-aria': 'wallet.edit_wallet',
      'aria-label': t('wallet.edit_wallet'),
      title: t('wallet.edit_wallet'),
      onclick: (e) => { e.stopPropagation(); if (global.SPWalletForms) global.SPWalletForms.openEditWallet(w.id); }
    }, [svgParse('<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>')]));
    actions.appendChild(el('button', {
      'data-i18n-aria': 'wallet.delete_wallet',
      'aria-label': t('wallet.delete_wallet'),
      title: t('wallet.delete_wallet'),
      onclick: (e) => {
        e.stopPropagation();
        deleteWallet(w.id).then((ok) => {
          if (ok) { U.toast(t('wallet.wallet_deleted'), 'success'); render(); }
        });
      }
    }, [svgParse('<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>')]));
    head.appendChild(actions);
    card.appendChild(head);

    const statsGrid = el('div', { class: 'wallet-card-stats' }, [
      statCell('wallet.allocated', fmtWalletCurrency(w.amount)),
      statCell('wallet.spent', fmtWalletCurrency(stats.expenses)),
      el('div', { class: 'wallet-card-stat remaining' }, [
        el('span', { class: 'lbl', 'data-i18n': 'wallet.remaining' }, [t('wallet.remaining')]),
        el('span', { class: 'val ' + remCls }, [fmtWalletCurrency(stats.balance)])
      ])
    ]);
    card.appendChild(statsGrid);

    card.addEventListener('click', () => openWalletDetails(w.id));
    return card;
  }

  function statCell(labelKey, value) {
    return el('div', { class: 'wallet-card-stat' }, [
      el('span', { class: 'lbl', 'data-i18n': labelKey }, [t(labelKey)]),
      el('span', { class: 'val' }, [value])
    ]);
  }

  function renderSalarySettings() {
    const data = getData();
    const details = el('details', { class: 'wallet-salary-settings' });
    const summary = el('summary', {}, [
      el('span', {}, [
        t('wallet.net_salary') + ': ' + fmtWalletCurrency(getNetSalary()) +
        ' · ' + (data.manualSalaryOn ? t('wallet.salary_source_manual') : t('wallet.salary_source_auto'))
      ])
    ]);
    details.appendChild(summary);
    const body = el('div', { class: 'body' });

    // Manual salary toggle + input
    const toggleRow = el('div', { class: 'wallet-toggle-row' });
    toggleRow.appendChild(el('div', { style: 'flex:1' }, [
      el('div', { class: 'label', 'data-i18n': 'wallet.use_manual_salary' }, [t('wallet.use_manual_salary')]),
      el('div', { class: 'hint', 'data-i18n': 'wallet.manual_salary_hint' }, [t('wallet.manual_salary_hint')])
    ]));
    const sw = el('button', {
      class: 'wallet-switch' + (data.manualSalaryOn ? ' on' : ''),
      'aria-pressed': data.manualSalaryOn ? 'true' : 'false',
      'data-i18n-aria': 'wallet.use_manual_salary',
      'aria-label': t('wallet.use_manual_salary'),
      onclick: () => {
        const cur = getData();
        const newVal = !cur.manualSalaryOn;
        setManualSalary(newVal, cur.manualSalary);
        render();
      }
    });
    toggleRow.appendChild(sw);
    body.appendChild(toggleRow);

    if (data.manualSalaryOn) {
      const inp = el('input', {
        type: 'number',
        inputmode: 'decimal',
        min: '0',
        step: '0.01',
        value: String(data.manualSalary || ''),
        'data-i18n-placeholder': 'wallet.field_amount_ph',
        placeholder: t('wallet.field_amount_ph')
      });
      inp.addEventListener('input', U.debounce(() => {
        setManualSalary(true, inp.value);
        render();
      }, 350));
      body.appendChild(el('div', { class: 'wallet-form-group' }, [
        el('label', {}, [t('wallet.net_salary')]),
        inp
      ]));
    }

    // Additional income
    const inc = el('input', {
      type: 'number',
      inputmode: 'decimal',
      min: '0',
      step: '0.01',
      value: String(data.additionalIncome || ''),
      'data-i18n-placeholder': 'wallet.field_amount_ph',
      placeholder: t('wallet.field_amount_ph')
    });
    inc.addEventListener('input', U.debounce(() => {
      setAdditionalIncome(inc.value);
      render();
    }, 350));
    body.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', { 'data-i18n': 'wallet.additional_income' }, [t('wallet.additional_income')]),
      inc,
      el('small', { class: 'hint', style: 'color:var(--muted);font-size:.72rem;display:block;margin-top:4px;' },
        [t('wallet.additional_income_hint')])
    ]));

    details.appendChild(body);
    return details;
  }

  // =========================================================
  // UI: Wallet detail view
  // =========================================================
  function renderWalletDetail(page) {
    const data = getData();
    const w = data.wallets.find((x) => x.id === activeWalletId);
    if (!w) { backToDashboard(); return; }
    const periodKey = currentPeriodKey();
    const stats = walletStats(w, periodKey);
    const balCls = stats.balance > 0 ? 'positive' : (stats.balance < 0 ? 'negative' : '');

    page.innerHTML = '';

    // Topbar
    page.appendChild(el('div', { class: 'wallet-topbar' }, [
      el('div', {}, [
        el('div', { class: 'wallet-title' }, [w.name])
      ]),
      el('div', { class: 'wallet-actions' }, [
        el('button', {
          class: 'wallet-icon-btn',
          'data-i18n-aria': 'wallet.back_to_dashboard',
          'aria-label': t('wallet.back_to_dashboard'),
          title: t('wallet.back_to_dashboard'),
          onclick: () => backToDashboard()
        }, [svgParse('<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>')]),
        el('button', {
          class: 'wallet-icon-btn',
          'data-i18n-aria': 'wallet.edit_wallet',
          'aria-label': t('wallet.edit_wallet'),
          title: t('wallet.edit_wallet'),
          onclick: () => { if (global.SPWalletForms) global.SPWalletForms.openEditWallet(w.id); }
        }, [svgParse('<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>')])
      ])
    ]));

    // Header card
    const header = el('div', { class: 'wallet-detail-header' });
    header.appendChild(el('div', { class: 'top-row' }, [
      el('div', { class: 'icon-wrap', style: 'background:' + w.color }, [svgParse(iconSvg(w.icon))]),
      el('div', { class: 'head-info' }, [
        el('h2', {}, [w.name]),
        w.note ? el('p', {}, [w.note]) : null
      ])
    ]));
    header.appendChild(el('div', { class: 'wallet-detail-stats' }, [
      detailStat('wallet.original_allocation', fmtWalletCurrency(w.amount), ''),
      detailStat('wallet.spent', fmtWalletCurrency(stats.expenses), ''),
      detailStat('wallet.incoming_transfers', fmtWalletCurrency(stats.transferIn), ''),
      detailStat('wallet.outgoing_transfers', fmtWalletCurrency(stats.transferOut), ''),
      detailStat('wallet.balance', fmtWalletCurrency(stats.balance), 'balance ' + balCls)
    ]));
    page.appendChild(header);

    // Action buttons
    const actions = el('div', { class: 'wallet-detail-actions' });
    actions.appendChild(el('button', {
      class: 'wallet-btn primary',
      onclick: () => { if (global.SPWalletForms) global.SPWalletForms.openAddExpense(w.id, 'expense'); }
    }, [
      svgParse('<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'),
      el('span', { 'data-i18n': 'wallet.add_expense' }, [t('wallet.add_expense')])
    ]));
    actions.appendChild(el('button', {
      class: 'wallet-btn ghost',
      onclick: () => { if (global.SPWalletForms) global.SPWalletForms.openAddExpense(w.id, 'income'); }
    }, [
      svgParse('<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'),
      el('span', {}, [t('wallet.modal_add_income')])
    ]));
    actions.appendChild(el('button', {
      class: 'wallet-btn ghost',
      onclick: () => { if (global.SPWalletForms) global.SPWalletForms.openTransfer(w.id); }
    }, [
      svgParse('<svg viewBox="0 0 24 24"><path d="M7 10l-4 4 4 4"/><path d="M3 14h11"/><path d="M17 6l4 4-4 4"/><path d="M21 10H10"/></svg>'),
      el('span', { 'data-i18n': 'wallet.transfer_money' }, [t('wallet.transfer_money')])
    ]));
    actions.appendChild(el('button', {
      class: 'wallet-btn danger',
      onclick: () => {
        deleteWallet(w.id).then((ok) => {
          if (ok) {
            U.toast(t('wallet.wallet_deleted'), 'success');
            backToDashboard();
          }
        });
      }
    }, [
      svgParse('<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>'),
      el('span', { 'data-i18n': 'wallet.delete_wallet' }, [t('wallet.delete_wallet')])
    ]));
    page.appendChild(actions);

    // Transactions section
    const txSection = el('div', { class: 'wallet-tx-section' });
    txSection.appendChild(el('h3', {}, [
      el('span', { 'data-i18n': 'wallet.transactions' }, [t('wallet.transactions')]),
      el('span', { class: 'count', style: 'font-size:.72rem;color:var(--muted);font-weight:700;' },
        [t('wallet.tx_count', { count: stats.txCount })])
    ]));
    const txs = walletTxsForPeriod(w, periodKey).slice().sort((a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1))
    );
    if (!txs.length) {
      txSection.appendChild(el('div', { class: 'wallet-tx-empty' }, [t('wallet.no_transactions')]));
    } else {
      const list = el('div', { class: 'wallet-tx-list' });
      txs.forEach((tx) => list.appendChild(renderTxItem(w, tx)));
      txSection.appendChild(list);
    }
    page.appendChild(txSection);
  }

  function detailStat(labelKey, value, cls) {
    return el('div', { class: 'wallet-detail-stat ' + (cls || '') }, [
      el('span', { class: 'lbl', 'data-i18n': labelKey }, [t(labelKey)]),
      el('span', { class: 'val ' + (cls || '') }, [value])
    ]);
  }

  function renderTxItem(wallet, tx) {
    const colors = {
      'expense': 'expense',
      'income': 'income',
      'transfer-in': 'transfer-in',
      'transfer-out': 'transfer-out'
    };
    const iconKey = colors[tx.type] || 'expense';
    const icons = {
      'expense': '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
      'income':  '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
      'transfer-in':  '<svg viewBox="0 0 24 24"><path d="M7 10l-4 4 4 4"/><path d="M3 14h11"/></svg>',
      'transfer-out': '<svg viewBox="0 0 24 24"><path d="M17 6l4 4-4 4"/><path d="M21 10H10"/></svg>'
    };
    const amountSign =
      tx.type === 'expense' ? '−' :
      tx.type === 'transfer-out' ? '−' :
      '+';
    const item = el('div', { class: 'wallet-tx-item' });
    item.appendChild(el('div', { class: 'wallet-tx-icon ' + iconKey },
      [svgParse(icons[tx.type] || icons.expense)]));
    item.appendChild(el('div', { class: 'wallet-tx-body' }, [
      el('div', { class: 'wallet-tx-desc' },
        [tx.description || t('wallet.tx_' + tx.type.replace('-', '_'))]),
      el('div', { class: 'wallet-tx-meta' }, [
        el('span', {}, [tx.date]),
        el('span', { class: 'tag' }, [t('wallet.tx_' + tx.type.replace('-', '_'))]),
        tx.transferId ? el('span', { class: 'tag', style: 'background:rgba(59,130,246,.15);color:#3b82f6;' },
          [t('wallet.transfer_linked_tx')]) : null
      ])
    ]));
    item.appendChild(el('div', { class: 'wallet-tx-amount ' + iconKey },
      [amountSign + ' ' + fmtWalletCurrency(tx.amount)]));
    const act = el('div', { class: 'wallet-tx-actions' });
    act.appendChild(el('button', {
      'aria-label': t('common.edit'),
      title: t('common.edit'),
      onclick: (e) => {
        e.stopPropagation();
        if (global.SPWalletForms) {
          if (tx.type === 'expense' || tx.type === 'income') {
            global.SPWalletForms.openEditExpense(wallet.id, tx.id, tx.type);
          } else {
            // Transfers are edited via the transfer modal (edit-mode)
            global.SPWalletForms.openEditTransfer(wallet.id, tx.id);
          }
        }
      }
    }, [svgParse('<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>')]));
    act.appendChild(el('button', {
      'aria-label': t('common.delete'),
      title: t('common.delete'),
      onclick: (e) => {
        e.stopPropagation();
        deleteTransaction(wallet.id, tx.id).then((ok) => {
          if (ok) { U.toast(t('wallet.tx_deleted'), 'success'); render(); }
        });
      }
    }, [svgParse('<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>')]));
    item.appendChild(act);
    return item;
  }

  // =========================================================
  // Helpers
  // =========================================================
  function svgParse(svgStr) {
    const tmp = document.createElement('div');
    tmp.innerHTML = svgStr;
    const svg = tmp.querySelector('svg');
    if (!svg) return document.createTextNode('');
    return svg;
  }

  // =========================================================
  // Public API
  // =========================================================
  function init() {
    // Ensure storage is initialized.
    getData();
    // Subscribe to storage changes (e.g., salary settings changed elsewhere).
    try {
      if (storage && storage.subscribe) {
        unsubscribers.push(storage.subscribe(() => {
          // Salary may have changed; refresh.
          try { render(); } catch (e) { console.warn('[Wallet] re-render failed', e); }
        }));
      }
    } catch (e) { console.warn('[Wallet] storage subscribe failed', e); }
    // Subscribe to locale changes
    if (i18n && i18n.subscribe) {
      unsubscribers.push(i18n.subscribe(() => {
        try { render(); } catch (e) {}
      }));
    }
    // Wire delegate: when user navigates to wallet tab, render.
    // (The actual navigation handling is in js/app.js, which calls SPWallet.render.)
    console.log('[Wallet] Smart Wallet initialized');
  }

  function destroy() {
    unsubscribers.forEach((fn) => { try { fn(); } catch (e) {} });
    unsubscribers = [];
  }

  global.SPWallet = {
    // Storage / data
    getData,
    defaultData,
    normalizeData,
    subscribe,
    // Period
    getPeriodForDate,
    periodKeyForDate,
    periodKeyForDates,
    currentPeriod,
    currentPeriodKey,
    previousPeriodKey,
    periodKeyBounds,
    dateInPeriod,
    formatPeriodLabel,
    // Salary
    getNetSalary,
    getSalarySource,
    setManualSalary,
    setAdditionalIncome,
    // Calculations
    parseAmount,
    round2,
    walletStats,
    walletTxsForPeriod,
    getTotalAllocated,
    getUnallocated,
    getTotalExpenses,
    getTotalIncome,
    getTotalTransfersIn,
    getTotalTransfersOut,
    getTotalRemaining,
    getWalletById,
    getWalletStatsById,
    getWarnings,
    // Wallet CRUD
    createWallet,
    updateWallet,
    deleteWallet,
    // Transactions
    addTransaction,
    updateTransaction,
    deleteTransaction,
    // Transfers
    transferMoney,
    // Suggest
    generateProposal,
    applyProposal,
    // Rollover
    isRolloverApplied,
    markRolloverApplied,
    rolloverCarryForward,
    rolloverReset,
    rolloverSkip,
    // Export / Import
    exportData,
    validateImport,
    importData,
    clearAllWallets,
    // UI helpers
    iconSvg,
    ICONS,
    svgParse,
    // UI navigation
    setActiveSubPage,
    openWalletDetails,
    backToDashboard,
    // Lifecycle
    init,
    render,
    destroy
  };
})(window);
