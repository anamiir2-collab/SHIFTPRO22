/* ShiftPro - Smart Wallet forms module
   Provides modal dialogs for:
   - Add / edit wallet
   - Add / edit expense or income transaction
   - Transfer between wallets
   - Suggest a distribution (review + apply)

   Exposes: window.SPWalletForms
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

  // Active modal container + cleanup helpers
  let overlay = null;

  function close() {
    if (overlay) {
      overlay.classList.remove('show');
      const o = overlay;
      setTimeout(() => { if (o && o.parentNode) o.parentNode.removeChild(o); }, 220);
      overlay = null;
    }
  }

  function ensureOverlay() {
    close();
    overlay = el('div', { class: 'wallet-modal-overlay' });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    return overlay;
  }

  function modalShell(titleText) {
    const modal = el('div', { class: 'wallet-modal', role: 'dialog', 'aria-modal': 'true' });
    const head = el('div', { class: 'wallet-modal-head' }, [
      el('h3', {}, [titleText]),
      el('button', {
        class: 'wallet-modal-close',
        'aria-label': t('common.close'),
        'data-i18n-aria': 'common.close',
        onclick: close
      }, ['×'])
    ]);
    modal.appendChild(head);
    return modal;
  }

  function fieldError(name) {
    const e = el('div', { class: 'wallet-form-error', id: 'err-' + name });
    return e;
  }
  function showErr(name, msg) {
    const e = $('#err-' + name);
    if (e) { e.textContent = msg; e.classList.add('show'); }
  }
  function clearErr(name) {
    const e = $('#err-' + name);
    if (e) { e.textContent = ''; e.classList.remove('show'); }
  }

  // =========================================================
  // Icon + color picker
  // =========================================================
  function iconPicker(selected, onChange) {
    const wrap = el('div', { class: 'wallet-icon-picker' });
    Object.keys(W.ICONS).forEach((key) => {
      const b = el('button', {
        type: 'button',
        class: 'wallet-icon-option' + (selected === key ? ' selected' : ''),
        'aria-label': key,
        onclick: () => {
          wrap.querySelectorAll('.wallet-icon-option').forEach((n) => n.classList.remove('selected'));
          b.classList.add('selected');
          onChange(key);
        }
      }, [W.svgParse(W.ICONS[key])]);
      wrap.appendChild(b);
    });
    return wrap;
  }

  const COLORS = [
    '#3b82f6', '#22c55e', '#f59e0b', '#a855f7',
    '#ef4444', '#06b6d4', '#ec4899', '#14b8a6',
    '#6366f1', '#84cc16'
  ];

  function colorPicker(selected, onChange) {
    const wrap = el('div', { class: 'wallet-color-picker' });
    COLORS.forEach((c) => {
      const b = el('button', {
        type: 'button',
        class: 'wallet-color-option' + (selected === c ? ' selected' : ''),
        style: 'background:' + c,
        'aria-label': c,
        onclick: () => {
          wrap.querySelectorAll('.wallet-color-option').forEach((n) => n.classList.remove('selected'));
          b.classList.add('selected');
          onChange(c);
        }
      });
      wrap.appendChild(b);
    });
    // Custom color input
    const custom = el('input', {
      type: 'color',
      value: selected && COLORS.indexOf(selected) < 0 ? selected : '#3b82f6',
      style: 'width:30px;height:30px;border:none;background:transparent;padding:0;cursor:pointer;border-radius:50%;',
      'aria-label': t('wallet.field_color'),
      onchange: () => {
        wrap.querySelectorAll('.wallet-color-option').forEach((n) => n.classList.remove('selected'));
        onChange(custom.value);
      }
    });
    wrap.appendChild(custom);
    return wrap;
  }

  // =========================================================
  // Add / Edit wallet
  // =========================================================
  function openAddWallet() {
    openWalletEditor(null);
  }
  function openEditWallet(walletId) {
    openWalletEditor(walletId);
  }

  function openWalletEditor(walletId) {
    const editing = !!walletId;
    const w = editing ? W.getWalletById(walletId) : null;
    if (editing && !w) { U.toast(t('wallet.err_name_required'), 'error'); return; }

    const ov = ensureOverlay();
    const modal = modalShell(t(editing ? 'wallet.modal_edit_title' : 'wallet.modal_add_title'));

    let state = {
      name: w ? w.name : '',
      amount: w ? String(w.amount) : '',
      note: w ? w.note : '',
      icon: w ? w.icon : 'wallet',
      color: w ? w.color : '#3b82f6'
    };

    // Name
    const nameInp = el('input', {
      type: 'text',
      maxlength: '60',
      value: state.name,
      'data-i18n-placeholder': 'wallet.field_name_ph',
      placeholder: t('wallet.field_name_ph'),
      oninput: () => { state.name = nameInp.value; clearErr('name'); }
    });
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', {}, [t('wallet.field_name'), el('span', { class: 'req' }, ['*'])]),
      nameInp,
      fieldError('name')
    ]));

    // Amount
    const amountInp = el('input', {
      type: 'number',
      inputmode: 'decimal',
      min: '0',
      step: '0.01',
      value: state.amount,
      'data-i18n-placeholder': 'wallet.field_amount_ph',
      placeholder: t('wallet.field_amount_ph'),
      oninput: () => { state.amount = amountInp.value; clearErr('amount'); }
    });
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', {}, [t('wallet.field_amount')]),
      amountInp,
      fieldError('amount')
    ]));

    // Note
    const noteInp = el('textarea', {
      maxlength: '300',
      'data-i18n-placeholder': 'wallet.field_note_ph',
      placeholder: t('wallet.field_note_ph'),
      oninput: () => { state.note = noteInp.value; }
    });
    noteInp.value = state.note;
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', {}, [t('wallet.field_note')]),
      noteInp
    ]));

    // Icon
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', {}, [t('wallet.field_icon')]),
      iconPicker(state.icon, (k) => { state.icon = k; })
    ]));

    // Color
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', {}, [t('wallet.field_color')]),
      colorPicker(state.color, (c) => { state.color = c; })
    ]));

    // Actions
    const actions = el('div', { class: 'wallet-form-actions' });
    actions.appendChild(el('button', {
      class: 'wallet-btn ghost',
      onclick: close
    }, [t('common.cancel')]));
    const submit = el('button', {
      class: 'wallet-btn primary',
      onclick: () => {
        if (!state.name.trim()) {
          showErr('name', t('wallet.err_name_required'));
          return;
        }
        const amt = W.parseAmount(state.amount);
        if (!Number.isFinite(amt) || amt < 0) {
          showErr('amount', t('wallet.err_amount_invalid'));
          return;
        }
        // Disable to prevent duplicate submissions
        submit.disabled = true;
        let result;
        if (editing) {
          result = W.updateWallet(walletId, {
            name: state.name,
            amount: amt,
            note: state.note,
            icon: state.icon,
            color: state.color
          });
        } else {
          result = W.createWallet({
            name: state.name,
            amount: amt,
            note: state.note,
            icon: state.icon,
            color: state.color
          });
        }
        if (!result) {
          submit.disabled = false;
          U.toast(t('wallet.storage_error'), 'error');
          return;
        }
        U.toast(t(editing ? 'wallet.wallet_updated' : 'wallet.wallet_saved'), 'success');
        close();
        W.render();
      }
    }, [t('wallet.save')]);
    actions.appendChild(submit);
    modal.appendChild(actions);

    ov.appendChild(modal);
    setTimeout(() => nameInp.focus(), 100);
  }

  // =========================================================
  // Add / Edit transaction (expense or income)
  // =========================================================
  function openAddExpense(walletId, type) {
    openTxEditor(walletId, null, type || 'expense');
  }
  function openEditExpense(walletId, txId, type) {
    openTxEditor(walletId, txId, type || 'expense');
  }

  function openTxEditor(walletId, txId, type) {
    const editing = !!txId;
    const w = W.getWalletById(walletId);
    if (!w) return;
    let tx = null;
    if (editing) {
      tx = (w.transactions || []).find((x) => x.id === txId);
      if (!tx) return;
      type = tx.type;
    }
    const isExpense = type === 'expense';

    const ov = ensureOverlay();
    const titleKey = editing
      ? (isExpense ? 'wallet.modal_edit_expense' : 'wallet.modal_edit_income')
      : (isExpense ? 'wallet.modal_add_expense' : 'wallet.modal_add_income');
    const modal = modalShell(t(titleKey));

    let state = {
      amount: tx ? String(tx.amount) : '',
      description: tx ? tx.description : '',
      date: tx ? tx.date : U.todayStr(),
      walletId: walletId,
      type: type
    };

    // Wallet selector (allow changing which wallet this tx belongs to)
    const sel = el('select', {
      onchange: () => { state.walletId = sel.value; }
    });
    const data = W.getData();
    data.wallets.forEach((opt) => {
      const o = el('option', { value: opt.id }, [opt.name]);
      if (opt.id === state.walletId) o.selected = true;
      sel.appendChild(o);
    });
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', {}, [t('wallet.field_tx_wallet'), el('span', { class: 'req' }, ['*'])]),
      sel
    ]));

    // Amount
    const amountInp = el('input', {
      type: 'number',
      inputmode: 'decimal',
      min: '0',
      step: '0.01',
      value: state.amount,
      'data-i18n-placeholder': 'wallet.field_amount_ph',
      placeholder: t('wallet.field_amount_ph'),
      oninput: () => {
        state.amount = amountInp.value;
        clearErr('amount');
        updateOverspendWarning();
      }
    });
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', {}, [t('wallet.field_tx_amount'), el('span', { class: 'req' }, ['*'])]),
      amountInp,
      fieldError('amount')
    ]));

    // Date
    const dateInp = el('input', {
      type: 'date',
      value: state.date,
      max: U.todayStr(),
      onchange: () => { state.date = dateInp.value; }
    });
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', {}, [t('wallet.field_tx_date')]),
      dateInp
    ]));

    // Description
    const descInp = el('textarea', {
      maxlength: '200',
      'data-i18n-placeholder': 'wallet.field_tx_description_ph',
      placeholder: t('wallet.field_tx_description_ph'),
      oninput: () => { state.description = descInp.value; }
    });
    descInp.value = state.description;
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', {}, [t('wallet.field_tx_description')]),
      descInp
    ]));

    // Overspend warning placeholder (filled dynamically)
    const warningHost = el('div', {});
    modal.appendChild(warningHost);

    function updateOverspendWarning() {
      warningHost.innerHTML = '';
      if (!isExpense) return;
      const amt = W.parseAmount(state.amount);
      if (amt <= 0) return;
      const targetW = W.getWalletById(state.walletId);
      if (!targetW) return;
      const stats = W.walletStats(targetW, W.currentPeriodKey());
      const wouldExceed = (stats.balance - amt) < 0;
      if (wouldExceed) {
        warningHost.appendChild(el('div', { class: 'wallet-form-warning' }, [
          U.el ? null : null,
          el('span', {}, [t('wallet.overspend_tx_warning')])
        ]));
      }
    }
    updateOverspendWarning();

    // Actions
    const actions = el('div', { class: 'wallet-form-actions' });
    actions.appendChild(el('button', {
      class: 'wallet-btn ghost',
      onclick: close
    }, [t('common.cancel')]));
    const submit = el('button', {
      class: 'wallet-btn primary',
      onclick: () => {
        const amt = W.parseAmount(state.amount);
        if (!Number.isFinite(amt) || amt <= 0) {
          showErr('amount', t('wallet.err_tx_amount'));
          return;
        }
        if (!state.walletId) {
          U.toast(t('wallet.err_tx_wallet'), 'error');
          return;
        }
        submit.disabled = true;
        let result;
        if (editing) {
          result = W.updateTransaction(walletId, txId, {
            amount: amt,
            description: state.description,
            date: state.date
          });
        } else {
          result = W.addTransaction(state.walletId, {
            type: state.type,
            amount: amt,
            description: state.description,
            date: state.date
          });
        }
        if (!result) {
          submit.disabled = false;
          U.toast(t('wallet.storage_error'), 'error');
          return;
        }
        U.toast(t(editing ? 'wallet.tx_updated' : 'wallet.tx_saved'), 'success');
        close();
        W.render();
      }
    }, [t('wallet.save_tx')]);
    actions.appendChild(submit);
    modal.appendChild(actions);

    ov.appendChild(modal);
    setTimeout(() => amountInp.focus(), 100);
  }

  // =========================================================
  // Transfer between wallets
  // =========================================================
  function openTransfer(preselectedFromId) {
    openTransferEditor(null, preselectedFromId || null);
  }
  function openEditTransfer(walletId, txId) {
    openTransferEditor({ walletId, txId });
  }

  function openTransferEditor(editCtx, preselectedFromId) {
    const editing = !!editCtx;
    const data = W.getData();
    if (data.wallets.length < 2) {
      U.toast(t('wallet.err_transfer_same'), 'warning');
      return;
    }

    const ov = ensureOverlay();
    const modal = modalShell(t('wallet.modal_transfer_title'));

    let state = {
      fromId: preselectedFromId || data.wallets[0].id,
      toId: '',
      amount: '',
      note: ''
    };

    if (editing) {
      // Look up the transfer leg to seed the form.
      const w = W.getWalletById(editCtx.walletId);
      const tx = w && w.transactions ? w.transactions.find((x) => x.id === editCtx.txId) : null;
      if (tx && tx.transferId && tx.linkedWalletId) {
        // Editing a transfer: we delete + recreate on submit.
        state.fromId = tx.type === 'transfer-out' ? editCtx.walletId : tx.linkedWalletId;
        state.toId   = tx.type === 'transfer-out' ? tx.linkedWalletId : editCtx.walletId;
        state.amount = String(tx.amount);
        state.note = tx.description || '';
      } else {
        U.toast(t('wallet.confirm_delete_transfer'), 'error');
        close();
        return;
      }
    }

    // From
    const fromSel = el('select', {
      onchange: () => {
        state.fromId = fromSel.value;
        clearErr('from');
        updateBalanceWarning();
      }
    });
    data.wallets.forEach((opt) => {
      const o = el('option', { value: opt.id }, [opt.name]);
      if (opt.id === state.fromId) o.selected = true;
      fromSel.appendChild(o);
    });
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', {}, [t('wallet.transfer_from'), el('span', { class: 'req' }, ['*'])]),
      fromSel,
      fieldError('from')
    ]));

    // To
    const toSel = el('select', {
      onchange: () => {
        state.toId = toSel.value;
        clearErr('to');
        updateBalanceWarning();
      }
    });
    toSel.appendChild(el('option', { value: '' }, [t('wallet.select_wallet')]));
    data.wallets.forEach((opt) => {
      if (opt.id === state.fromId) return; // skip same
      const o = el('option', { value: opt.id }, [opt.name]);
      if (opt.id === state.toId) o.selected = true;
      toSel.appendChild(o);
    });
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', {}, [t('wallet.transfer_to'), el('span', { class: 'req' }, ['*'])]),
      toSel,
      fieldError('to')
    ]));

    // Amount
    const amountInp = el('input', {
      type: 'number',
      inputmode: 'decimal',
      min: '0',
      step: '0.01',
      value: state.amount,
      'data-i18n-placeholder': 'wallet.field_amount_ph',
      placeholder: t('wallet.field_amount_ph'),
      oninput: () => {
        state.amount = amountInp.value;
        clearErr('amount');
        updateBalanceWarning();
      }
    });
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', {}, [t('wallet.transfer_amount'), el('span', { class: 'req' }, ['*'])]),
      amountInp,
      fieldError('amount')
    ]));

    // Note
    const noteInp = el('input', {
      type: 'text',
      maxlength: '200',
      value: state.note,
      'data-i18n-placeholder': 'wallet.transfer_note',
      placeholder: t('wallet.transfer_note'),
      oninput: () => { state.note = noteInp.value; }
    });
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', {}, [t('wallet.transfer_note')]),
      noteInp
    ]));

    // Warning placeholder
    const warnHost = el('div', {});
    modal.appendChild(warnHost);

    function updateBalanceWarning() {
      warnHost.innerHTML = '';
      if (!state.fromId || !state.amount) return;
      const amt = W.parseAmount(state.amount);
      if (amt <= 0) return;
      const fromW = W.getWalletById(state.fromId);
      if (!fromW) return;
      const stats = W.walletStats(fromW, W.currentPeriodKey());
      if (stats.balance - amt < 0) {
        warnHost.appendChild(el('div', { class: 'wallet-form-warning' }, [
          el('span', {}, [t('wallet.transfer_insufficient_warning')])
        ]));
      }
    }
    updateBalanceWarning();

    const actions = el('div', { class: 'wallet-form-actions' });
    actions.appendChild(el('button', {
      class: 'wallet-btn ghost',
      onclick: close
    }, [t('common.cancel')]));

    const submit = el('button', {
      class: 'wallet-btn primary',
      onclick: async () => {
        if (!state.fromId) { showErr('from', t('wallet.err_transfer_from')); return; }
        if (!state.toId)   { showErr('to',   t('wallet.err_transfer_to'));   return; }
        if (state.fromId === state.toId) {
          showErr('to', t('wallet.err_transfer_same'));
          return;
        }
        const amt = W.parseAmount(state.amount);
        if (!Number.isFinite(amt) || amt <= 0) {
          showErr('amount', t('wallet.err_transfer_amount'));
          return;
        }
        submit.disabled = true;

        if (editing) {
          // Delete the old pair of transfer transactions, then re-create.
          // (We do not try to mutate the linked transactions in place to
          // avoid corrupting balances.)
          const oldWalletId = editCtx.walletId;
          const oldTxId = editCtx.txId;
          const oldW = W.getWalletById(oldWalletId);
          const oldTx = oldW && oldW.transactions
            ? oldW.transactions.find((x) => x.id === oldTxId) : null;
          if (oldTx && oldTx.linkedWalletId && oldTx.linkedTxId) {
            // Remove both legs directly from the data layer (bypassing
            // the confirmation dialog since we're replacing, not deleting).
            const data2 = W.getData();
            const a = data2.wallets.find((x) => x.id === oldWalletId);
            const b = data2.wallets.find((x) => x.id === oldTx.linkedWalletId);
            if (a && a.transactions) {
              a.transactions = a.transactions.filter((x) => x.id !== oldTxId);
            }
            if (b && b.transactions) {
              b.transactions = b.transactions.filter((x) => x.id !== oldTx.linkedTxId);
            }
          }
        }

        const res = W.transferMoney(state.fromId, state.toId, amt, state.note);
        if (res.error) {
          submit.disabled = false;
          let msg = t('wallet.storage_error');
          if (res.error === 'same_wallet') msg = t('wallet.err_transfer_same');
          else if (res.error === 'invalid_amount') msg = t('wallet.err_transfer_amount');
          U.toast(msg, 'error');
          return;
        }
        U.toast(t('wallet.transfer_done'), 'success');
        close();
        W.render();
      }
    }, [t('wallet.transfer_submit')]);
    actions.appendChild(submit);
    modal.appendChild(actions);

    ov.appendChild(modal);
  }

  // =========================================================
  // Suggest a Distribution
  // =========================================================
  let suggestState = null;

  function openSuggest() {
    suggestState = {
      method: '503020',
      proposal: W.generateProposal('503020'),
      applyMode: W.getData().wallets.length ? 'add' : 'add'
    };
    renderSuggestModal();
  }

  function renderSuggestModal() {
    const ov = ensureOverlay();
    const modal = modalShell(t('wallet.suggest_title'));

    // Intro
    modal.appendChild(el('p', {
      style: 'font-size:.78rem;color:var(--muted);line-height:1.6;margin:0 0 12px;'
    }, [t('wallet.suggest_intro')]));

    // Method selector
    const methodSel = el('select', {
      onchange: () => {
        suggestState.method = methodSel.value;
        suggestState.proposal = W.generateProposal(methodSel.value);
        renderSuggestModal();
      }
    });
    [
      { v: '503020',  l: t('wallet.suggest_503020') },
      { v: 'envelope', l: t('wallet.suggest_envelope') },
      { v: 'custom',   l: t('wallet.suggest_custom') }
    ].forEach((o) => {
      const opt = el('option', { value: o.v }, [o.l]);
      if (o.v === suggestState.method) opt.selected = true;
      methodSel.appendChild(opt);
    });
    modal.appendChild(el('div', { class: 'wallet-form-group' }, [
      el('label', {}, [t('wallet.suggest_method')]),
      methodSel
    ]));

    // Proposal list
    const list = el('div', { class: 'wallet-suggest-list' });
    suggestState.proposal.forEach((item, idx) => {
      list.appendChild(suggestRow(item, idx, () => {
        suggestState.proposal.splice(idx, 1);
        renderSuggestModal();
      }, (patch) => {
        Object.assign(suggestState.proposal[idx], patch);
      }));
    });
    modal.appendChild(list);

    // Add wallet button
    modal.appendChild(el('button', {
      class: 'wallet-btn ghost block',
      style: 'margin-bottom:12px;',
      onclick: () => {
        suggestState.proposal.push({
          name: '', amount: 0, icon: 'wallet', color: '#3b82f6'
        });
        renderSuggestModal();
      }
    }, [
      W.svgParse('<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'),
      el('span', {}, [t('wallet.suggest_add_wallet')])
    ]));

    // Apply mode (only if user has existing wallets)
    const data = W.getData();
    if (data.wallets.length) {
      modal.appendChild(el('div', { class: 'wallet-suggest-mode' }, [
        (() => {
          const l = el('label', {});
          const r = el('input', {
            type: 'radio',
            name: 'suggest-mode',
            value: 'add',
            onchange: () => { suggestState.applyMode = 'add'; }
          });
          if (suggestState.applyMode === 'add') r.checked = true;
          l.appendChild(r);
          l.appendChild(el('div', {}, [
            el('span', {}, [t('wallet.suggest_apply_add')]),
            el('span', { class: 'desc' }, [t('wallet.suggest_add_warning')])
          ]));
          return l;
        })(),
        (() => {
          const l = el('label', {});
          const r = el('input', {
            type: 'radio',
            name: 'suggest-mode',
            value: 'replace',
            onchange: () => { suggestState.applyMode = 'replace'; }
          });
          if (suggestState.applyMode === 'replace') r.checked = true;
          l.appendChild(r);
          l.appendChild(el('div', {}, [
            el('span', {}, [t('wallet.suggest_apply_replace')]),
            el('span', { class: 'desc' }, [t('wallet.suggest_replace_warning')])
          ]));
          return l;
        })()
      ]));
    }

    const actions = el('div', { class: 'wallet-form-actions' });
    actions.appendChild(el('button', {
      class: 'wallet-btn ghost',
      onclick: close
    }, [t('wallet.suggest_cancel')]));

    const submit = el('button', {
      class: 'wallet-btn primary',
      onclick: async () => {
        // Validate that there is at least one wallet with a name
        const valid = suggestState.proposal.filter((p) => p.name && p.name.trim());
        if (!valid.length) {
          U.toast(t('wallet.err_name_required'), 'error');
          return;
        }
        // If user has existing wallets and selected "replace", require explicit confirm.
        let proceed = true;
        if (data.wallets.length && suggestState.applyMode === 'replace') {
          proceed = await U.confirmDialog(
            t('wallet.suggest_replace_warning'),
            { title: t('wallet.suggest_apply_replace'), danger: true, okText: t('wallet.suggest_confirm') }
          );
        }
        if (!proceed) return;

        submit.disabled = true;
        const result = W.applyProposal(valid, suggestState.applyMode);
        if (!result) {
          submit.disabled = false;
          U.toast(t('wallet.storage_error'), 'error');
          return;
        }
        U.toast(t('wallet.suggest_applied'), 'success');
        close();
        W.render();
      }
    }, [t('wallet.suggest_confirm')]);
    actions.appendChild(submit);
    modal.appendChild(actions);

    // Replace previous modal content
    if (ov.firstChild) ov.removeChild(ov.firstChild);
    ov.appendChild(modal);
  }

  function suggestRow(item, idx, onRemove, onPatch) {
    const row = el('div', { class: 'wallet-suggest-row' });
    const nameInp = el('input', {
      type: 'text',
      value: item.name || '',
      'data-i18n-placeholder': 'wallet.field_name_ph',
      placeholder: t('wallet.field_name_ph'),
      oninput: () => { onPatch({ name: nameInp.value }); }
    });
    const amtInp = el('input', {
      type: 'number',
      inputmode: 'decimal',
      min: '0',
      step: '0.01',
      value: String(item.amount || ''),
      'data-i18n-placeholder': 'wallet.field_amount_ph',
      placeholder: t('wallet.field_amount_ph'),
      oninput: () => { onPatch({ amount: W.parseAmount(amtInp.value) }); }
    });
    row.appendChild(nameInp);
    row.appendChild(amtInp);
    row.appendChild(el('div', { class: 'row-foot' }, [
      el('span', {}, [t('wallet.suggest_envelope_label') + ' ' + (idx + 1)]),
      el('button', { class: 'remove-btn', onclick: onRemove }, [t('common.delete')])
    ]));
    return row;
  }

  // =========================================================
  // Public API
  // =========================================================
  global.SPWalletForms = {
    openAddWallet,
    openEditWallet,
    openAddExpense,
    openEditExpense,
    openTransfer,
    openEditTransfer,
    openSuggest,
    close
  };
})(window);
