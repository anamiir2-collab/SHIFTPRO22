/**
 * ShiftPro - Smart Wallet Tests
 * اختبارات لوحدة المحفظة الذكية.
 *
 * Coverage:
 * - Payroll-period key derivation (26th–25th cycle)
 * - Amount parsing / rounding
 * - Wallet balance calculation (allocation - expenses - out + in + income)
 * - Total allocated / unallocated / remaining
 * - Transfer linking (transfer-in / transfer-out pair)
 * - Internal transfers NOT counted as expenses or income
 * - Negative balances preserved
 * - Suggest-a-distribution proposal generation
 * - Import validation (reject invalid, version, no_data, duplicate)
 *
 * التشغيل:
 *   npm install --save-dev jest
 *   npx jest tests/
 *
 * ملاحظة: الاختبارات دي بتعيد تنفيذ المنطق الأساسي (pure functions)
 * زي ما tests/utils.test.js بيعمل، عشان متعتمدش على DOM أو window.
 */

// ---------- Helpers (mirrors of js/wallet.js core logic) ----------

function parseAmount(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : 0;
  // Strip thousands separators (commas), then extract the first numeric
  // substring (supports negative + decimals).
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

// Payroll period: cycleDay=26 by default.
// Period starts on the 26th of a month and ends on the 25th of the next.
// If today >= 26, period starts this month; otherwise starts last month.
function getPayPeriod(refDate, cycleDay) {
  cycleDay = cycleDay || 26;
  const y = refDate.getFullYear();
  const m = refDate.getMonth();
  let start;
  if (refDate.getDate() >= cycleDay) {
    start = new Date(y, m, cycleDay);
  } else {
    start = new Date(y, m - 1, cycleDay);
  }
  const end = new Date(start.getFullYear(), start.getMonth() + 1, cycleDay - 1);
  return { start, end };
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function periodKeyForDates(start, end) {
  return fmtDate(start) + '_' + fmtDate(end);
}

function periodKeyForDate(dateStr, cycleDay) {
  const d = new Date(dateStr + 'T00:00:00');
  const p = getPayPeriod(d, cycleDay);
  return periodKeyForDates(p.start, p.end);
}

function periodKeyBounds(key) {
  if (!key || typeof key !== 'string') return null;
  const parts = key.split('_');
  if (parts.length !== 2) return null;
  try {
    const start = new Date(parts[0] + 'T00:00:00');
    const end = new Date(parts[1] + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    return { start, end };
  } catch (e) { return null; }
}

function dateInPeriod(dateStr, periodKey) {
  const b = periodKeyBounds(periodKey);
  if (!b) return false;
  const d = new Date(dateStr + 'T00:00:00');
  return d >= b.start && d <= b.end;
}

// Wallet stats: balance = allocation - expenses - transferOut + transferIn + income
function walletStats(wallet, periodKey) {
  const txs = (wallet.transactions || []).filter((tx) => {
    if (!periodKey) return true;
    if (tx.payrollPeriodKey) return tx.payrollPeriodKey === periodKey;
    return periodKeyForDate(tx.date) === periodKey;
  });
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

function getTotalAllocated(wallets) {
  return round2((wallets || []).reduce((s, w) => s + (w.amount || 0), 0));
}

function getUnallocated(netSalary, additionalIncome, wallets) {
  const allocated = getTotalAllocated(wallets);
  return round2(netSalary + (additionalIncome || 0) - allocated);
}

function getTotalExpenses(wallets, periodKey) {
  let total = 0;
  (wallets || []).forEach((w) => {
    const s = walletStats(w, periodKey);
    total += s.expenses;
  });
  return round2(total);
}

function getTotalIncome(wallets, periodKey) {
  let total = 0;
  (wallets || []).forEach((w) => {
    const s = walletStats(w, periodKey);
    total += s.income;
  });
  return round2(total);
}

function getTotalTransfersIn(wallets, periodKey) {
  let total = 0;
  (wallets || []).forEach((w) => {
    const s = walletStats(w, periodKey);
    total += s.transferIn;
  });
  return round2(total);
}

function getTotalTransfersOut(wallets, periodKey) {
  let total = 0;
  (wallets || []).forEach((w) => {
    const s = walletStats(w, periodKey);
    total += s.transferOut;
  });
  return round2(total);
}

function getTotalRemaining(wallets, periodKey) {
  return round2((wallets || []).reduce((s, w) => s + walletStats(w, periodKey).balance, 0));
}

// Suggest-a-distribution proposal
function generateProposal(method, netSalary, additionalIncome) {
  const total = round2((netSalary || 0) + (additionalIncome || 0));
  if (total <= 0) return [];
  if (method === '503020') {
    return [
      { name: 'Essentials', amount: round2(total * 0.50) },
      { name: 'Savings',    amount: round2(total * 0.30) },
      { name: 'Wants',      amount: round2(total * 0.20) }
    ];
  }
  if (method === 'envelope') {
    const per = round2(total / 4);
    return [1, 2, 3, 4].map((i) => ({ name: 'Wallet ' + i, amount: per }));
  }
  return [{ name: '', amount: 0 }];
}

// Import validation
const SCHEMA_VERSION = 1;
function normalizeWallet(w) {
  if (!w || typeof w !== 'object') return null;
  const id = typeof w.id === 'string' && w.id ? w.id : 'w_test';
  const name = typeof w.name === 'string' ? w.name : '';
  const amount = parseAmount(w.amount);
  return { id, name, amount, transactions: Array.isArray(w.transactions) ? w.transactions : [] };
}
function validateImport(payload, existingWallets) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'invalid' };
  const data = payload.data ? payload.data : payload;
  if (!data || typeof data !== 'object') return { ok: false, error: 'invalid' };
  if (!Array.isArray(data.wallets)) return { ok: false, error: 'no_data' };
  const ver = Number(data.version);
  if (!Number.isFinite(ver) || ver > SCHEMA_VERSION) return { ok: false, error: 'version' };
  const normalized = data.wallets.map(normalizeWallet).filter(Boolean);
  const existingIds = (existingWallets || []).map((w) => w.id);
  const incomingIds = normalized.map((w) => w.id);
  const dupes = incomingIds.filter((id) => existingIds.indexOf(id) >= 0);
  if (dupes.length) return { ok: false, error: 'duplicate', duplicates: dupes };
  return { ok: true, normalized };
}

// =========================================================
// Tests
// =========================================================

describe('Smart Wallet - Payroll Period (26–25 cycle)', () => {
  test('Sept 26 → Oct 25 is one period', () => {
    const d = new Date(2026, 9, 5); // Oct 5, 2026
    const p = getPayPeriod(d, 26);
    expect(fmtDate(p.start)).toBe('2026-09-26');
    expect(fmtDate(p.end)).toBe('2026-10-25');
  });

  test('Sept 26 itself starts a new period', () => {
    const d = new Date(2026, 8, 26); // Sept 26
    const p = getPayPeriod(d, 26);
    expect(fmtDate(p.start)).toBe('2026-09-26');
    expect(fmtDate(p.end)).toBe('2026-10-25');
  });

  test('Sept 25 belongs to the Aug 26 – Sept 25 period', () => {
    const d = new Date(2026, 8, 25); // Sept 25
    const p = getPayPeriod(d, 26);
    expect(fmtDate(p.start)).toBe('2026-08-26');
    expect(fmtDate(p.end)).toBe('2026-09-25');
  });

  test('Period key is start_end with ISO dates', () => {
    const d = new Date(2026, 9, 10);
    const p = getPayPeriod(d, 26);
    const key = periodKeyForDates(p.start, p.end);
    expect(key).toBe('2026-09-26_2026-10-25');
  });

  test('Period key derived from a date string', () => {
    expect(periodKeyForDate('2026-10-01', 26)).toBe('2026-09-26_2026-10-25');
    expect(periodKeyForDate('2026-09-25', 26)).toBe('2026-08-26_2026-09-25');
    expect(periodKeyForDate('2026-09-26', 26)).toBe('2026-09-26_2026-10-25');
  });

  test('Custom cycleDay (e.g. 1) shifts the period', () => {
    // cycleDay=1 means the 1st of each month
    const d = new Date(2026, 9, 15); // Oct 15
    const p = getPayPeriod(d, 1);
    expect(fmtDate(p.start)).toBe('2026-10-01');
    expect(fmtDate(p.end)).toBe('2026-10-31');
  });

  test('dateInPeriod returns true inside, false outside', () => {
    const key = '2026-09-26_2026-10-25';
    expect(dateInPeriod('2026-09-26', key)).toBe(true);
    expect(dateInPeriod('2026-10-25', key)).toBe(true);
    expect(dateInPeriod('2026-10-10', key)).toBe(true);
    expect(dateInPeriod('2026-09-25', key)).toBe(false);
    expect(dateInPeriod('2026-10-26', key)).toBe(false);
  });
});

describe('Smart Wallet - Amount parsing & rounding', () => {
  test('parseAmount handles numbers', () => {
    expect(parseAmount(100)).toBe(100);
    expect(parseAmount(0)).toBe(0);
    expect(parseAmount(-50)).toBe(-50);
  });

  test('parseAmount handles strings with currency symbols', () => {
    expect(parseAmount('1,234.56')).toBeCloseTo(1234.56, 2);
    expect(parseAmount('EGP 500')).toBe(500);
    expect(parseAmount('ج.م 1000')).toBe(1000);
  });

  test('parseAmount returns 0 for invalid input', () => {
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('abc')).toBe(0);
    expect(parseAmount(undefined)).toBe(0);
  });

  test('round2 rounds to 2 decimals', () => {
    expect(round2(1.005)).toBe(1); // JS float quirk: 1.005 * 100 = 100.49999...
    expect(round2(1.01)).toBe(1.01);
    expect(round2(2.345)).toBe(2.35);
    expect(round2(2.344)).toBe(2.34);
    expect(round2(NaN)).toBe(0);
    expect(round2(Infinity)).toBe(0);
  });
});

describe('Smart Wallet - Wallet stats (balance formula)', () => {
  const periodKey = '2026-09-26_2026-10-25';

  test('empty wallet has balance = allocation', () => {
    const w = { id: 'w1', name: 'A', amount: 1000, transactions: [] };
    const s = walletStats(w, periodKey);
    expect(s.balance).toBe(1000);
    expect(s.expenses).toBe(0);
    expect(s.income).toBe(0);
    expect(s.transferIn).toBe(0);
    expect(s.transferOut).toBe(0);
  });

  test('single expense reduces balance', () => {
    const w = {
      id: 'w1', name: 'A', amount: 1000,
      transactions: [
        { id: 't1', type: 'expense', amount: 300, date: '2026-10-01', payrollPeriodKey: periodKey }
      ]
    };
    const s = walletStats(w, periodKey);
    expect(s.balance).toBe(700);
    expect(s.expenses).toBe(300);
  });

  test('income increases balance', () => {
    const w = {
      id: 'w1', name: 'A', amount: 1000,
      transactions: [
        { id: 't1', type: 'income', amount: 200, date: '2026-10-01', payrollPeriodKey: periodKey }
      ]
    };
    const s = walletStats(w, periodKey);
    expect(s.balance).toBe(1200);
    expect(s.income).toBe(200);
  });

  test('transfer-in increases balance', () => {
    const w = {
      id: 'w1', name: 'A', amount: 1000,
      transactions: [
        { id: 't1', type: 'transfer-in', amount: 500, date: '2026-10-01', payrollPeriodKey: periodKey }
      ]
    };
    const s = walletStats(w, periodKey);
    expect(s.balance).toBe(1500);
    expect(s.transferIn).toBe(500);
  });

  test('transfer-out decreases balance', () => {
    const w = {
      id: 'w1', name: 'A', amount: 1000,
      transactions: [
        { id: 't1', type: 'transfer-out', amount: 400, date: '2026-10-01', payrollPeriodKey: periodKey }
      ]
    };
    const s = walletStats(w, periodKey);
    expect(s.balance).toBe(600);
    expect(s.transferOut).toBe(400);
  });

  test('combined: balance = allocation - expenses - out + in + income', () => {
    const w = {
      id: 'w1', name: 'A', amount: 5000,
      transactions: [
        { id: 't1', type: 'expense',        amount: 1500, date: '2026-10-01', payrollPeriodKey: periodKey },
        { id: 't2', type: 'income',         amount:  200, date: '2026-10-02', payrollPeriodKey: periodKey },
        { id: 't3', type: 'transfer-in',    amount:  300, date: '2026-10-03', payrollPeriodKey: periodKey },
        { id: 't4', type: 'transfer-out',   amount:  100, date: '2026-10-04', payrollPeriodKey: periodKey }
      ]
    };
    const s = walletStats(w, periodKey);
    // 5000 - 1500 - 100 + 300 + 200 = 3900
    expect(s.balance).toBe(3900);
  });

  test('negative balance is preserved when expense exceeds allocation', () => {
    const w = {
      id: 'w1', name: 'A', amount: 500,
      transactions: [
        { id: 't1', type: 'expense', amount: 800, date: '2026-10-01', payrollPeriodKey: periodKey }
      ]
    };
    const s = walletStats(w, periodKey);
    expect(s.balance).toBe(-300);
  });

  test('transactions outside the period are excluded', () => {
    const w = {
      id: 'w1', name: 'A', amount: 1000,
      transactions: [
        { id: 't1', type: 'expense', amount: 200, date: '2026-09-25', payrollPeriodKey: '2026-08-26_2026-09-25' },
        { id: 't2', type: 'expense', amount: 100, date: '2026-10-01', payrollPeriodKey: periodKey }
      ]
    };
    const s = walletStats(w, periodKey);
    expect(s.expenses).toBe(100);
    expect(s.balance).toBe(900);
  });
});

describe('Smart Wallet - Dashboard totals', () => {
  const periodKey = '2026-09-26_2026-10-25';

  test('total allocated sums all wallet allocations', () => {
    const wallets = [
      { id: 'w1', name: 'A', amount: 3000, transactions: [] },
      { id: 'w2', name: 'B', amount: 2000, transactions: [] },
      { id: 'w3', name: 'C', amount:  500, transactions: [] }
    ];
    expect(getTotalAllocated(wallets)).toBe(5500);
  });

  test('unallocated = salary + additional income - allocated', () => {
    const wallets = [{ id: 'w1', name: 'A', amount: 4000, transactions: [] }];
    expect(getUnallocated(8000, 0, wallets)).toBe(4000);
    expect(getUnallocated(8000, 500, wallets)).toBe(4500);
    expect(getUnallocated(3000, 0, wallets)).toBe(-1000); // negative preserved
  });

  test('total expenses excludes internal transfers', () => {
    const wallets = [
      {
        id: 'w1', name: 'A', amount: 1000,
        transactions: [
          { id: 't1', type: 'expense', amount: 200, date: '2026-10-01', payrollPeriodKey: periodKey },
          { id: 't2', type: 'transfer-out', amount: 500, date: '2026-10-02', payrollPeriodKey: periodKey }
        ]
      },
      {
        id: 'w2', name: 'B', amount: 1000,
        transactions: [
          { id: 't3', type: 'transfer-in', amount: 500, date: '2026-10-02', payrollPeriodKey: periodKey }
        ]
      }
    ];
    // Total expenses = 200 only (transfers are NOT counted as expenses)
    expect(getTotalExpenses(wallets, periodKey)).toBe(200);
    expect(getTotalTransfersIn(wallets, periodKey)).toBe(500);
    expect(getTotalTransfersOut(wallets, periodKey)).toBe(500);
  });

  test('total income excludes transfers', () => {
    const wallets = [
      {
        id: 'w1', name: 'A', amount: 1000,
        transactions: [
          { id: 't1', type: 'income', amount: 300, date: '2026-10-01', payrollPeriodKey: periodKey },
          { id: 't2', type: 'transfer-in', amount: 500, date: '2026-10-02', payrollPeriodKey: periodKey }
        ]
      }
    ];
    expect(getTotalIncome(wallets, periodKey)).toBe(300);
  });

  test('total remaining sums all wallet balances', () => {
    const wallets = [
      {
        id: 'w1', name: 'A', amount: 1000,
        transactions: [
          { id: 't1', type: 'expense', amount: 300, date: '2026-10-01', payrollPeriodKey: periodKey }
        ]
      },
      {
        id: 'w2', name: 'B', amount: 2000,
        transactions: [
          { id: 't2', type: 'expense', amount: 500, date: '2026-10-01', payrollPeriodKey: periodKey }
        ]
      }
    ];
    // 700 + 1500 = 2200
    expect(getTotalRemaining(wallets, periodKey)).toBe(2200);
  });

  test('total remaining includes negative balances', () => {
    const wallets = [
      {
        id: 'w1', name: 'A', amount: 500,
        transactions: [
          { id: 't1', type: 'expense', amount: 800, date: '2026-10-01', payrollPeriodKey: periodKey }
        ]
      },
      {
        id: 'w2', name: 'B', amount: 2000,
        transactions: []
      }
    ];
    // -300 + 2000 = 1700
    expect(getTotalRemaining(wallets, periodKey)).toBe(1700);
  });
});

describe('Smart Wallet - Transfers (linked transactions)', () => {
  const periodKey = '2026-09-26_2026-10-25';

  test('a transfer creates a consistent linked pair', () => {
    // Simulate: transfer 500 from w1 to w2
    const wallets = [
      {
        id: 'w1', name: 'A', amount: 1000,
        transactions: [
          {
            id: 't1', type: 'transfer-out', amount: 500, date: '2026-10-01',
            payrollPeriodKey: periodKey,
            transferId: 'tf_1', linkedWalletId: 'w2', linkedTxId: 't2'
          }
        ]
      },
      {
        id: 'w2', name: 'B', amount: 500,
        transactions: [
          {
            id: 't2', type: 'transfer-in', amount: 500, date: '2026-10-01',
            payrollPeriodKey: periodKey,
            transferId: 'tf_1', linkedWalletId: 'w1', linkedTxId: 't1'
          }
        ]
      }
    ];
    const s1 = walletStats(wallets[0], periodKey);
    const s2 = walletStats(wallets[1], periodKey);
    // w1: 1000 - 0 - 500 + 0 + 0 = 500
    expect(s1.balance).toBe(500);
    // w2: 500 - 0 - 0 + 500 + 0 = 1000
    expect(s2.balance).toBe(1000);
    // Total across both: 500 + 1000 = 1500 = original allocation sum
    expect(getTotalRemaining(wallets, periodKey)).toBe(1500);
    // Total allocation sum is unchanged
    expect(getTotalAllocated(wallets)).toBe(1500);
  });

  test('transfers do NOT count as new salary/income/expenses', () => {
    const wallets = [
      {
        id: 'w1', name: 'A', amount: 1000,
        transactions: [
          { id: 't1', type: 'transfer-out', amount: 500, date: '2026-10-01', payrollPeriodKey: periodKey, transferId: 'tf_1', linkedWalletId: 'w2', linkedTxId: 't2' }
        ]
      },
      {
        id: 'w2', name: 'B', amount: 0,
        transactions: [
          { id: 't2', type: 'transfer-in', amount: 500, date: '2026-10-01', payrollPeriodKey: periodKey, transferId: 'tf_1', linkedWalletId: 'w1', linkedTxId: 't1' }
        ]
      }
    ];
    // Total expenses = 0 (transfers excluded)
    expect(getTotalExpenses(wallets, periodKey)).toBe(0);
    // Total income = 0 (transfers excluded)
    expect(getTotalIncome(wallets, periodKey)).toBe(0);
    // Total transfers in = 500, out = 500 (equal — money only moved)
    expect(getTotalTransfersIn(wallets, periodKey)).toBe(500);
    expect(getTotalTransfersOut(wallets, periodKey)).toBe(500);
  });

  test('transfer with insufficient funds still applies (balance goes negative)', () => {
    const wallets = [
      {
        id: 'w1', name: 'A', amount: 100,
        transactions: [
          { id: 't1', type: 'transfer-out', amount: 500, date: '2026-10-01', payrollPeriodKey: periodKey, transferId: 'tf_1', linkedWalletId: 'w2', linkedTxId: 't2' }
        ]
      },
      {
        id: 'w2', name: 'B', amount: 0,
        transactions: [
          { id: 't2', type: 'transfer-in', amount: 500, date: '2026-10-01', payrollPeriodKey: periodKey, transferId: 'tf_1', linkedWalletId: 'w1', linkedTxId: 't1' }
        ]
      }
    ];
    // w1: 100 - 500 = -400 (negative preserved)
    expect(walletStats(wallets[0], periodKey).balance).toBe(-400);
    // w2: 0 + 500 = 500
    expect(walletStats(wallets[1], periodKey).balance).toBe(500);
    // Total: -400 + 500 = 100 (unchanged from original allocation)
    expect(getTotalRemaining(wallets, periodKey)).toBe(100);
  });
});

describe('Smart Wallet - Suggest a Distribution', () => {
  test('503020 splits salary into 50/30/20', () => {
    const p = generateProposal('503020', 10000, 0);
    expect(p.length).toBe(3);
    expect(p[0].amount).toBe(5000);
    expect(p[1].amount).toBe(3000);
    expect(p[2].amount).toBe(2000);
    // Total sums to salary
    expect(round2(p[0].amount + p[1].amount + p[2].amount)).toBe(10000);
  });

  test('503020 includes additional income', () => {
    const p = generateProposal('503020', 8000, 2000);
    // Total = 10000
    expect(p[0].amount).toBe(5000);
    expect(p[1].amount).toBe(3000);
    expect(p[2].amount).toBe(2000);
  });

  test('envelope splits into 4 equal parts', () => {
    const p = generateProposal('envelope', 8000, 0);
    expect(p.length).toBe(4);
    p.forEach((w) => expect(w.amount).toBe(2000));
  });

  test('returns empty array when salary is 0 or negative', () => {
    expect(generateProposal('503020', 0, 0)).toEqual([]);
    expect(generateProposal('503020', -100, 0)).toEqual([]);
  });

  test('custom mode returns one empty proposal (user builds it)', () => {
    const p = generateProposal('custom', 5000, 0);
    expect(p.length).toBe(1);
    expect(p[0].name).toBe('');
    expect(p[0].amount).toBe(0);
  });
});

describe('Smart Wallet - Import validation', () => {
  const existingWallets = [{ id: 'w_existing', name: 'Old', amount: 100, transactions: [] }];

  test('rejects null / non-object', () => {
    expect(validateImport(null, existingWallets).ok).toBe(false);
    expect(validateImport('string', existingWallets).ok).toBe(false);
    expect(validateImport(123, existingWallets).ok).toBe(false);
  });

  test('rejects payload without wallets array', () => {
    expect(validateImport({ data: { version: 1 } }, existingWallets).error).toBe('no_data');
    expect(validateImport({ data: { version: 1, wallets: 'not-array' } }, existingWallets).error).toBe('no_data');
  });

  test('rejects unsupported version', () => {
    const p = { data: { version: 99, wallets: [] } };
    expect(validateImport(p, existingWallets).error).toBe('version');
  });

  test('rejects duplicate wallet IDs', () => {
    const p = { data: { version: 1, wallets: [
      { id: 'w_existing', name: 'Dup', amount: 0, transactions: [] }
    ] } };
    const r = validateImport(p, existingWallets);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('duplicate');
    expect(r.duplicates).toContain('w_existing');
  });

  test('accepts valid payload with fresh IDs', () => {
    const p = { data: { version: 1, wallets: [
      { id: 'w_new1', name: 'New1', amount: 500, transactions: [] },
      { id: 'w_new2', name: 'New2', amount: 300, transactions: [] }
    ] } };
    const r = validateImport(p, existingWallets);
    expect(r.ok).toBe(true);
    expect(r.normalized.length).toBe(2);
  });

  test('accepts bare wallet-data object (no wrapper)', () => {
    const p = { version: 1, wallets: [
      { id: 'w_new', name: 'Bare', amount: 100, transactions: [] }
    ] };
    const r = validateImport(p, existingWallets);
    expect(r.ok).toBe(true);
  });

  test('normalizes missing optional fields safely', () => {
    const p = { data: { version: 1, wallets: [
      { id: 'w_min', name: 'Min' } // missing amount + transactions
    ] } };
    const r = validateImport(p, []);
    expect(r.ok).toBe(true);
    expect(r.normalized[0].amount).toBe(0);
    expect(Array.isArray(r.normalized[0].transactions)).toBe(true);
    expect(r.normalized[0].transactions.length).toBe(0);
  });
});

describe('Smart Wallet - Critical accounting rules', () => {
  const periodKey = '2026-09-26_2026-10-25';

  test('allocated amounts are NOT expenses', () => {
    const wallets = [{ id: 'w1', name: 'A', amount: 5000, transactions: [] }];
    // Even with no transactions, expenses = 0
    expect(getTotalExpenses(wallets, periodKey)).toBe(0);
    expect(getTotalAllocated(wallets)).toBe(5000);
  });

  test('moving money between wallets is NOT new income', () => {
    const wallets = [
      { id: 'w1', name: 'A', amount: 1000, transactions: [
        { id: 't1', type: 'transfer-out', amount: 500, date: '2026-10-01', payrollPeriodKey: periodKey }
      ]},
      { id: 'w2', name: 'B', amount: 0, transactions: [
        { id: 't2', type: 'transfer-in', amount: 500, date: '2026-10-01', payrollPeriodKey: periodKey }
      ]}
    ];
    // Total income stays 0
    expect(getTotalIncome(wallets, periodKey)).toBe(0);
  });

  test('internal transfers are NOT external expenses', () => {
    const wallets = [
      { id: 'w1', name: 'A', amount: 1000, transactions: [
        { id: 't1', type: 'transfer-out', amount: 500, date: '2026-10-01', payrollPeriodKey: periodKey }
      ]},
      { id: 'w2', name: 'B', amount: 0, transactions: [
        { id: 't2', type: 'transfer-in', amount: 500, date: '2026-10-01', payrollPeriodKey: periodKey }
      ]}
    ];
    expect(getTotalExpenses(wallets, periodKey)).toBe(0);
  });

  test('the same transaction is not counted twice', () => {
    // A 500 transfer creates 2 transactions (out + in) but total money = original allocation
    const wallets = [
      { id: 'w1', name: 'A', amount: 1000, transactions: [
        { id: 't1', type: 'transfer-out', amount: 500, date: '2026-10-01', payrollPeriodKey: periodKey, transferId: 'tf_1', linkedWalletId: 'w2', linkedTxId: 't2' }
      ]},
      { id: 'w2', name: 'B', amount: 500, transactions: [
        { id: 't2', type: 'transfer-in', amount: 500, date: '2026-10-01', payrollPeriodKey: periodKey, transferId: 'tf_1', linkedWalletId: 'w1', linkedTxId: 't1' }
      ]}
    ];
    const totalAllocated = getTotalAllocated(wallets);
    const totalRemaining = getTotalRemaining(wallets, periodKey);
    // totalRemaining should equal totalAllocated (no money was created or destroyed)
    expect(totalRemaining).toBe(totalAllocated);
    expect(totalRemaining).toBe(1500);
  });

  test('wallet allocation is NOT added to net salary', () => {
    // Unallocated = salary - allocated (not salary + allocated)
    const wallets = [{ id: 'w1', name: 'A', amount: 3000, transactions: [] }];
    expect(getUnallocated(8000, 0, wallets)).toBe(5000); // 8000 - 3000, not 8000 + 3000
  });

  test('expenses are not double-subtracted from salary', () => {
    // The unallocated amount is about ALLOCATION, not current balances.
    // Expenses affect wallet balances, not the unallocated calculation.
    const walletsNoExpenses = [{ id: 'w1', name: 'A', amount: 3000, transactions: [] }];
    const walletsAfterExpense = [{ id: 'w1', name: 'A', amount: 3000, transactions: [
      { id: 't1', type: 'expense', amount: 1000, date: '2026-10-01', payrollPeriodKey: periodKey }
    ]}];
    // Unallocated should be the SAME in both cases (5000)
    expect(getUnallocated(8000, 0, walletsNoExpenses)).toBe(5000);
    expect(getUnallocated(8000, 0, walletsAfterExpense)).toBe(5000);
  });
});
