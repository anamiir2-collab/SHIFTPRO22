/* ShiftPro - Smart Wallet reports / export / rollover module
   Provides:
   - Reports view (period selector, summary, breakdown by wallet,
     transactions by date, transfers, warnings, comparison)
   - Export & Import page
   - Rollover (payroll-period transition) dialog
   - Print-friendly report

   Exposes: window.SPWalletReports
   Depends on: SPWallet (core), SPUtils, SPi18n
*/
(function (global) {
  'use strict';

  const W = global.SPWallet;
  const U = global.SPUtils;
  const i18n = global.SPi18n;
  const $ = U.$;
  const el = U.el;
  const t = (k, v) => i18n ? i18n.t(k, v) : k;

  // Period navigation state for the reports view
  let reportPeriodKey = null;

  function getReportPeriodKey() {
    if (!reportPeriodKey) reportPeriodKey = W.currentPeriodKey();
    return reportPeriodKey;
  }
  function setReportPeriodKey(k) { reportPeriodKey = k; }

  function shiftReportPeriod(delta) {
    const bounds = W.periodKeyBounds(getReportPeriodKey());
    if (!bounds) return;
    const ref = new Date(bounds.start.getTime() + delta * 30 * 86400000);
    const p = W.getPeriodForDate(ref);
    setReportPeriodKey(W.periodKeyForDates(p.start, p.end));
    render($('#page-wallet'));
  }

  // =========================================================
  // Reports view
  // =========================================================
  function render(page) {
    page.innerHTML = '';

    // Topbar
    page.appendChild(el('div', { class: 'wallet-topbar' }, [
      el('div', {}, [
        el('div', { class: 'wallet-title', 'data-i18n': 'wallet.page_reports' }, [t('wallet.page_reports')])
      ]),
      el('div', { class: 'wallet-actions' }, [
        el('button', {
          class: 'wallet-icon-btn',
          'aria-label': t('wallet.back_to_dashboard'),
          title: t('wallet.back_to_dashboard'),
          onclick: () => W.setActiveSubPage('dashboard')
        }, [W.svgParse('<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>')])
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
        class: 'wallet-subnav-btn' + (s.id === 'reports' ? ' active' : ''),
        onclick: () => W.setActiveSubPage(s.id)
      }, [s.label]));
    });
    page.appendChild(subnav);

    // Period selector
    const periodNav = el('div', { class: 'cal-nav' });
    periodNav.appendChild(el('button', {
      class: 'nav-btn',
      'aria-label': t('common.prev'),
      onclick: () => shiftReportPeriod(-1)
    }, [i18n && i18n.getLocale() === 'ar' ? '›' : '‹']));
    periodNav.appendChild(el('div', { class: 'month-label' },
      [W.formatPeriodLabel(getReportPeriodKey())]));
    periodNav.appendChild(el('button', {
      class: 'nav-btn',
      'aria-label': t('common.next'),
      onclick: () => shiftReportPeriod(1)
    }, [i18n && i18n.getLocale() === 'ar' ? '‹' : '›']));
    page.appendChild(periodNav);

    const key = getReportPeriodKey();
    const data = W.getData();
    const netSalary = W.getNetSalary();
    const allocated = W.getTotalAllocated();
    const unallocated = W.getUnallocated();
    const expenses = W.getTotalExpenses(key);
    const income = W.getTotalIncome(key);
    const trIn = W.getTotalTransfersIn(key);
    const trOut = W.getTotalTransfersOut(key);
    const remaining = W.getTotalRemaining(key);

    // Summary card
    const summaryCard = el('div', { class: 'wallet-report-card' });
    summaryCard.appendChild(el('h3', { 'data-i18n': 'wallet.report_summary' },
      [t('wallet.report_summary')]));
    summaryCard.appendChild(row(t('wallet.net_salary'), U.fmtCurrency(netSalary)));
    summaryCard.appendChild(row(t('wallet.total_allocated'), U.fmtCurrency(allocated)));
    summaryCard.appendChild(row(t('wallet.unallocated'), U.fmtCurrency(unallocated),
      unallocated < 0 ? 'danger' : ''));
    summaryCard.appendChild(row(t('wallet.total_expenses'), U.fmtCurrency(expenses)));
    summaryCard.appendChild(row(t('wallet.total_remaining'), U.fmtCurrency(remaining)));
    summaryCard.appendChild(row(t('wallet.report_transfers') + ' →',
      t('wallet.tx_transfer_in') + ': ' + U.fmtCurrency(trIn), ''));
    summaryCard.appendChild(row('',
      t('wallet.tx_transfer_out') + ': ' + U.fmtCurrency(trOut), ''));
    page.appendChild(summaryCard);

    // Breakdown by wallet
    const brkCard = el('div', { class: 'wallet-report-card' });
    brkCard.appendChild(el('h3', { 'data-i18n': 'wallet.report_breakdown' },
      [t('wallet.report_breakdown')]));
    if (!data.wallets.length) {
      brkCard.appendChild(el('div', { class: 'wallet-tx-empty' }, [t('wallet.empty_body')]));
    } else {
      const maxExp = data.wallets.reduce(
        (m, w) => Math.max(m, W.walletStats(w, key).expenses), 0
      ) || 1;
      data.wallets.forEach((w) => {
        const s = W.walletStats(w, key);
        const pct = maxExp > 0 ? Math.max(0, Math.min(100, (s.expenses / maxExp) * 100)) : 0;
        brkCard.appendChild(el('div', { class: 'wallet-report-bar' }, [
          el('div', { class: 'name' }, [w.name]),
          el('div', { class: 'bar-track' }, [
            el('div', { class: 'bar-fill', style: 'width:' + pct + '%;background:' + w.color })
          ]),
          el('div', { class: 'amt' }, [U.fmtCurrency(s.expenses)])
        ]));
        brkCard.appendChild(row(
          '  ' + t('wallet.allocated') + ' / ' + t('wallet.remaining'),
          U.fmtCurrency(w.amount) + ' / ' + U.fmtCurrency(s.balance),
          s.balance < 0 ? 'danger' : ''
        ));
      });
    }
    page.appendChild(brkCard);

    // Transactions by date (across all wallets in this period)
    const dateCard = el('div', { class: 'wallet-report-card' });
    dateCard.appendChild(el('h3', { 'data-i18n': 'wallet.report_by_date' },
      [t('wallet.report_by_date')]));
    const byDate = {};
    data.wallets.forEach((w) => {
      W.walletTxsForPeriod(w, key).forEach((tx) => {
        if (!byDate[tx.date]) byDate[tx.date] = { expense: 0, income: 0, transferIn: 0, transferOut: 0, count: 0 };
        byDate[tx.date][tx.type.replace('-', '')] = (byDate[tx.date][tx.type.replace('-', '')] || 0) + tx.amount;
        // Normalize keys
        if (tx.type === 'transfer-in')  byDate[tx.date].transferIn  += tx.amount;
        if (tx.type === 'transfer-out') byDate[tx.date].transferOut += tx.amount;
        byDate[tx.date].count++;
      });
    });
    const dateKeys = Object.keys(byDate).sort();
    if (!dateKeys.length) {
      dateCard.appendChild(el('div', { class: 'wallet-tx-empty' }, [t('wallet.no_transactions')]));
    } else {
      dateKeys.forEach((d) => {
        const e = byDate[d];
        dateCard.appendChild(row(
          d + ' · ' + t('wallet.tx_count', { count: e.count }),
          U.fmtCurrency(e.expense),
          e.expense > 0 ? 'danger' : ''
        ));
      });
    }
    page.appendChild(dateCard);

    // Warnings
    const warnCard = el('div', { class: 'wallet-report-card' });
    warnCard.appendChild(el('h3', { 'data-i18n': 'wallet.report_warnings' },
      [t('wallet.report_warnings')]));
    const warnings = W.getWarnings(key);
    if (!warnings.length) {
      warnCard.appendChild(el('div', { class: 'wallet-tx-empty' },
        [t('wallet.report_no_warnings')]));
    } else {
      warnings.forEach((wn) => {
        warnCard.appendChild(el('div', { class: 'wallet-warning-item' }, [
          W.svgParse('<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z"/><path d="M12 9v5M12 17v.5"/></svg>'),
          el('span', {}, [wn.message])
        ]));
      });
    }
    page.appendChild(warnCard);

    // Comparison with previous period
    const prevKey = (() => {
      const b = W.periodKeyBounds(key);
      if (!b) return null;
      const before = new Date(b.start.getTime() - 86400000);
      const p = W.getPeriodForDate(before);
      return W.periodKeyForDates(p.start, p.end);
    })();
    const cmpCard = el('div', { class: 'wallet-report-card' });
    cmpCard.appendChild(el('h3', { 'data-i18n': 'wallet.report_compare' },
      [t('wallet.report_compare')]));
    if (!prevKey) {
      cmpCard.appendChild(el('div', { class: 'wallet-tx-empty' }, [t('wallet.report_no_prev')]));
    } else {
      const prevExp = W.getTotalExpenses(prevKey);
      const curExp = expenses;
      const diff = W.round2(curExp - prevExp);
      cmpCard.appendChild(row(t('wallet.report_prev_period'),
        W.formatPeriodLabel(prevKey), ''));
      cmpCard.appendChild(row(t('wallet.total_expenses') + ' (' + t('wallet.report_prev_period') + ')',
        U.fmtCurrency(prevExp), ''));
      cmpCard.appendChild(row(t('wallet.report_change'),
        (diff > 0 ? '+' : '') + U.fmtCurrency(diff),
        diff > 0 ? 'danger' : (diff < 0 ? 'success' : '')));
    }
    page.appendChild(cmpCard);

    // Print button
    page.appendChild(el('button', {
      class: 'wallet-btn primary block',
      style: 'margin-top:12px;',
      onclick: () => {
        // Mark only the wallet page as visible for print
        document.querySelectorAll('.page').forEach((p) => {
          p.classList.remove('active');
        });
        const wp = $('#page-wallet');
        wp.classList.add('active');
        wp.setAttribute('data-print-wallet', '1');
        setTimeout(() => {
          window.print();
          // Restore: only dashboard active
          document.querySelectorAll('.page').forEach((p) => {
            p.classList.remove('active');
          });
          $('#page-dashboard').classList.add('active');
          wp.removeAttribute('data-print-wallet');
          document.querySelector('.tab-btn.active')?.classList.remove('active');
          document.querySelector('[data-tab="dashboard"]')?.classList.add('active');
        }, 100);
      }
    }, [
      W.svgParse('<svg viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/></svg>'),
      el('span', { 'data-i18n': 'wallet.report_print' }, [t('wallet.report_print')])
    ]));

    if (i18n) i18n.apply(page);
  }

  function row(label, value, cls) {
    return el('div', { class: 'wallet-report-row' }, [
      el('span', { class: 'lbl' }, [label]),
      el('span', { class: 'val ' + (cls || '') }, [value])
    ]);
  }

  // =========================================================
  // Export / Import view
  // =========================================================
  function renderExport(page) {
    page.innerHTML = '';

    // Topbar
    page.appendChild(el('div', { class: 'wallet-topbar' }, [
      el('div', {}, [
        el('div', { class: 'wallet-title', 'data-i18n': 'wallet.page_export' }, [t('wallet.page_export')])
      ]),
      el('div', { class: 'wallet-actions' }, [
        el('button', {
          class: 'wallet-icon-btn',
          'aria-label': t('wallet.back_to_dashboard'),
          title: t('wallet.back_to_dashboard'),
          onclick: () => W.setActiveSubPage('dashboard')
        }, [W.svgParse('<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>')])
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
        class: 'wallet-subnav-btn' + (s.id === 'export' ? ' active' : ''),
        onclick: () => W.setActiveSubPage(s.id)
      }, [s.label]));
    });
    page.appendChild(subnav);

    // Export section
    const expCard = el('div', { class: 'wallet-report-card' });
    expCard.appendChild(el('h3', { 'data-i18n': 'wallet.export_title' }, [t('wallet.export_title')]));
    expCard.appendChild(el('p', {
      style: 'font-size:.78rem;color:var(--muted);margin:0 0 12px;line-height:1.6;'
    }, [t('wallet.export_json_hint')]));
    expCard.appendChild(el('button', {
      class: 'wallet-btn primary block',
      onclick: () => {
        const payload = W.exportData();
        const today = U.todayStr();
        const filename = t('wallet.export_filename', { date: today });
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        U.downloadBlob(filename, blob);
        U.toast(t('common.export'), 'success');
      }
    }, [
      W.svgParse('<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M5 21h14"/></svg>'),
      el('span', { 'data-i18n': 'wallet.export_json' }, [t('wallet.export_json')])
    ]));
    expCard.appendChild(el('p', {
      style: 'font-size:.72rem;color:var(--muted);margin:12px 0 0;line-height:1.6;'
    }, [t('wallet.export_print_hint')]));
    expCard.appendChild(el('button', {
      class: 'wallet-btn ghost block',
      style: 'margin-top:6px;',
      onclick: () => {
        // Switch to reports sub-page and trigger print
        W.setActiveSubPage('reports');
        setTimeout(() => {
          const btn = $('.wallet-btn.primary.block');
          if (btn) btn.click();
        }, 250);
      }
    }, [
      W.svgParse('<svg viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/></svg>'),
      el('span', { 'data-i18n': 'wallet.export_print' }, [t('wallet.export_print')])
    ]));
    page.appendChild(expCard);

    // Import section
    const impCard = el('div', { class: 'wallet-report-card' });
    impCard.appendChild(el('h3', { 'data-i18n': 'wallet.import_title' }, [t('wallet.import_title')]));
    impCard.appendChild(el('p', {
      style: 'font-size:.78rem;color:var(--muted);margin:0 0 12px;line-height:1.6;'
    }, [t('wallet.import_json_hint')]));

    // Import mode radios
    let importMode = 'merge';
    const modeWrap = el('div', { class: 'wallet-suggest-mode' });
    const mergeLbl = el('label', {});
    const mergeR = el('input', {
      type: 'radio',
      name: 'import-mode',
      value: 'merge',
      checked: true,
      onchange: () => { importMode = 'merge'; }
    });
    mergeLbl.appendChild(mergeR);
    mergeLbl.appendChild(el('div', {}, [
      el('span', {}, [t('wallet.import_merge')]),
      el('span', { class: 'desc' }, [t('wallet.import_confirm_merge_msg')])
    ]));
    const repLbl = el('label', {});
    const repR = el('input', {
      type: 'radio',
      name: 'import-mode',
      value: 'replace',
      onchange: () => { importMode = 'replace'; }
    });
    repLbl.appendChild(repR);
    repLbl.appendChild(el('div', {}, [
      el('span', {}, [t('wallet.import_replace')]),
      el('span', { class: 'desc' }, [t('wallet.import_confirm_replace_msg')])
    ]));
    modeWrap.appendChild(mergeLbl);
    modeWrap.appendChild(repLbl);
    impCard.appendChild(modeWrap);

    // File input (hidden) + trigger button
    const fileInput = el('input', {
      type: 'file',
      accept: 'application/json,.json',
      style: 'display:none;',
      onchange: async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const payload = JSON.parse(text);
          const validation = W.validateImport(payload);
          if (!validation.ok) {
            let msg = t('wallet.import_err_invalid');
            if (validation.error === 'version') msg = t('wallet.import_err_version');
            else if (validation.error === 'no_data') msg = t('wallet.import_err_no_data');
            else if (validation.error === 'duplicate') msg = t('wallet.import_err_duplicate');
            U.toast(msg, 'error');
            fileInput.value = '';
            return;
          }
          // Confirm based on mode
          const confirmMsg = importMode === 'replace'
            ? t('wallet.import_confirm_replace_msg')
            : t('wallet.import_confirm_merge_msg');
          const ok = await U.confirmDialog(confirmMsg, {
            title: t('wallet.import_confirm'),
            danger: importMode === 'replace',
            okText: t('wallet.import_confirm')
          });
          if (!ok) { fileInput.value = ''; return; }
          const result = W.importData(payload, importMode);
          if (!result.ok) {
            U.toast(t('wallet.import_err_invalid'), 'error');
            fileInput.value = '';
            return;
          }
          U.toast(t('wallet.import_success'), 'success');
          fileInput.value = '';
          W.render();
        } catch (e) {
          console.error('[Wallet] import failed', e);
          U.toast(t('wallet.import_err_invalid'), 'error');
          fileInput.value = '';
        }
      }
    });
    impCard.appendChild(fileInput);
    impCard.appendChild(el('button', {
      class: 'wallet-btn primary block',
      onclick: () => fileInput.click()
    }, [
      W.svgParse('<svg viewBox="0 0 24 24"><path d="M12 21V9m0 0l-4 4m4-4l4 4"/><path d="M5 3h14"/></svg>'),
      el('span', { 'data-i18n': 'wallet.import_json' }, [t('wallet.import_json')])
    ]));
    page.appendChild(impCard);

    // Rollover section (only shown if a new period has started)
    const curKey = W.currentPeriodKey();
    const isRolled = W.isRolloverApplied(curKey);
    const rollCard = el('div', { class: 'wallet-report-card' });
    rollCard.appendChild(el('h3', { 'data-i18n': 'wallet.rollover_title' }, [t('wallet.rollover_title')]));
    rollCard.appendChild(el('p', {
      style: 'font-size:.78rem;color:var(--muted);margin:0 0 12px;line-height:1.6;'
    }, [t('wallet.rollover_intro')]));
    if (isRolled) {
      rollCard.appendChild(el('div', { class: 'wallet-warning-item', style: 'background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.3);color:var(--success);' }, [
        W.svgParse('<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>'),
        el('span', {}, [t('wallet.rollover_already_done')])
      ]));
    } else {
      rollCard.appendChild(el('button', {
        class: 'wallet-btn ghost block',
        onclick: () => openRollover()
      }, [
        W.svgParse('<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>'),
        el('span', { 'data-i18n': 'wallet.rollover_apply' }, [t('wallet.rollover_apply')])
      ]));
    }
    page.appendChild(rollCard);

    if (i18n) i18n.apply(page);
  }

  // =========================================================
  // Rollover dialog
  // =========================================================
  function openRollover() {
    const ov = el('div', { class: 'wallet-modal-overlay' });
    ov.addEventListener('click', (e) => { if (e.target === ov) closeRollover(ov); });
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('show'));

    const modal = el('div', { class: 'wallet-modal', role: 'dialog', 'aria-modal': 'true' });
    modal.appendChild(el('div', { class: 'wallet-modal-head' }, [
      el('h3', { 'data-i18n': 'wallet.rollover_title' }, [t('wallet.rollover_title')]),
      el('button', {
        class: 'wallet-modal-close',
        'aria-label': t('common.close'),
        onclick: () => closeRollover(ov)
      }, ['×'])
    ]));

    modal.appendChild(el('p', {
      style: 'font-size:.8rem;color:var(--text-2);line-height:1.6;margin:0 0 12px;'
    }, [t('wallet.rollover_intro')]));

    // Period info
    const curKey = W.currentPeriodKey();
    const prevKey = W.previousPeriodKey();
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', { 'data-i18n': 'wallet.rollover_period' }, [t('wallet.rollover_period')]),
      el('div', { style: 'font-size:.85rem;font-weight:700;color:var(--text);' }, [W.formatPeriodLabel(curKey)])
    ]));
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', { 'data-i18n': 'wallet.rollover_prev_period' }, [t('wallet.rollover_prev_period')]),
      el('div', { style: 'font-size:.85rem;font-weight:700;color:var(--text);' }, [W.formatPeriodLabel(prevKey)])
    ]));

    let mode = 'carry';
    const modeWrap = el('div', { class: 'wallet-suggest-mode' });
    function mkModeOption(v, labelKey, descKey) {
      const l = el('label', {});
      const r = el('input', {
        type: 'radio',
        name: 'rollover-mode',
        value: v,
        onchange: () => { mode = v; updateDesc(); }
      });
      if (v === mode) r.checked = true;
      l.appendChild(r);
      const txt = el('div', {}, [
        el('span', { 'data-i18n': labelKey }, [t(labelKey)]),
        el('span', { class: 'desc' }, [t(descKey)])
      ]);
      l.appendChild(txt);
      return { l, txt };
    }
    const carryOpt = mkModeOption('carry', 'wallet.rollover_option_carry', 'wallet.rollover_carry_warning');
    const resetOpt = mkModeOption('reset', 'wallet.rollover_option_reset', 'wallet.rollover_reset_warning');
    const skipOpt  = mkModeOption('skip',  'wallet.rollover_option_skip',  '');
    modeWrap.appendChild(carryOpt.l);
    modeWrap.appendChild(resetOpt.l);
    modeWrap.appendChild(skipOpt.l);
    modal.appendChild(modeWrap);

    function updateDesc() {
      // No-op for now; descriptions are static.
    }

    const actions = el('div', { class: 'wallet-form-actions' });
    actions.appendChild(el('button', {
      class: 'wallet-btn ghost',
      onclick: () => closeRollover(ov)
    }, [t('common.cancel')]));
    const submit = el('button', {
      class: 'wallet-btn primary',
      onclick: async () => {
        submit.disabled = true;
        // Confirm before applying carry/reset
        const warnMsg = mode === 'carry' ? t('wallet.rollover_carry_warning')
          : mode === 'reset' ? t('wallet.rollover_reset_warning') : '';
        if (warnMsg) {
          const ok = await U.confirmDialog(warnMsg, {
            title: t('wallet.rollover_apply'),
            danger: mode === 'carry',
            okText: t('wallet.rollover_apply')
          });
          if (!ok) { submit.disabled = false; return; }
        }
        if (mode === 'carry') {
          const n = W.rolloverCarryForward(prevKey);
          if (n < 0) {
            submit.disabled = false;
            U.toast(t('wallet.storage_error'), 'error');
            return;
          }
        } else if (mode === 'reset') {
          W.rolloverReset();
        } else {
          W.rolloverSkip();
        }
        W.markRolloverApplied(curKey, mode);
        U.toast(t('wallet.rollover_done'), 'success');
        closeRollover(ov);
        W.render();
      }
    }, [t('wallet.rollover_apply')]);
    actions.appendChild(submit);
    modal.appendChild(actions);

    ov.appendChild(modal);
  }
  function closeRollover(ov) {
    if (!ov) return;
    ov.classList.remove('show');
    setTimeout(() => { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 220);
  }

  // =========================================================
  // Public API
  // =========================================================
  global.SPWalletReports = {
    render,
    renderExport,
    openRollover,
    getReportPeriodKey,
    setReportPeriodKey,
    shiftReportPeriod
  };
})(window);
