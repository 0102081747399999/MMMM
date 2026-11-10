// Shared Vodafone Cash Wallet Page Logic (cash-1.html, cash-2.html, cash-3.html)
(function () {
  const { escapeHtml, showToast, openModal, closeModal, requirePinIfProtected } = window.AppLayout;
  const DB = window.PosDB;

  const WALLET_CONFIGS = {
    cash_1: { title: "محفظة فودافون كاش - خط 1 (الأساسي)", shortName: "كاش خط 1", filePrefix: "vodafone_cash_1" },
    cash_2: { title: "محفظة فودافون كاش - خط 2 (الإضافي)", shortName: "كاش خط 2", filePrefix: "vodafone_cash_2" },
    cash_3: { title: "محفظة فودافون كاش - خط 3 (الاحتياطي)", shortName: "كاش خط 3", filePrefix: "vodafone_cash_3" }
  };

  let walletId = "cash_1";
  const state = {
    walletDoc: { simNumber: "", openingBalance: 0, isActive: true },
    rawTransactions: [],
    computedTransactions: [], // sorted newest-first, each has resultingBalance
    currentBalance: 0,
    todayCommissions: 0,
    allCommissions: 0,
    currentType: "withdraw",
    pendingDeleteId: null,
    editingId: null,
    searchQuery: "",
    typeFilter: "all",
    dateFilter: "today"
  };

  function recalculateState() {
    const opening = Number(state.walletDoc.openingBalance) || 0;
    const asc = state.rawTransactions.slice().sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));

    let running = opening;
    let todayComm = 0;
    let allComm = 0;
    const today = DB.todayDateStr();

    const withBalances = asc.map((tx) => {
      const amount = Number(tx.amount) || 0;
      const commission = Number(tx.commission) || 0;
      if (tx.type === "withdraw") {
        running -= amount;
      } else {
        running += amount;
      }
      allComm += commission;
      if (tx.dateStr === today) {
        todayComm += commission;
      }
      return {
        ...tx,
        amount,
        commission,
        resultingBalance: running
      };
    });

    state.currentBalance = running;
    state.todayCommissions = todayComm;
    state.allCommissions = allComm;
    state.computedTransactions = withBalances.reverse();

    renderWalletMetrics();
    renderTable();
  }

  function renderWalletMetrics() {
    const simEl = document.getElementById("wallet-sim-display");
    const simBadgeEl = document.getElementById("wallet-sim-status");
    const simNumber = (state.walletDoc.simNumber || "").trim();

    if (simEl) {
      if (simNumber) {
        simEl.textContent = simNumber;
        simEl.className = "text-headline-lg font-numeric-table text-on-surface tracking-wider";
      } else {
        simEl.textContent = "لم يتم تحديد الرقم";
        simEl.className = "text-title-md font-title-md text-outline";
      }
    }
    if (simBadgeEl) {
      simBadgeEl.textContent = simNumber ? "شريحة مسجلة ومربوطة بـ Firebase" : "اضغط أيقونة التعديل لإدخال رقم الشريحة";
    }

    const lineBadge = document.getElementById("line-active-badge");
    if (lineBadge) {
      const active = state.walletDoc.isActive !== false;
      lineBadge.innerHTML = active
        ? `<span class="w-2 h-2 rounded-full bg-tertiary animate-pulse"></span><span>حالة الخط: نشط / متصل</span>`
        : `<span class="w-2 h-2 rounded-full bg-error"></span><span>حالة الخط: متوقف مؤقتاً</span>`;
      lineBadge.className = active
        ? "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant font-label-md"
        : "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-error-container text-on-error-container font-label-md";
    }

    document.getElementById("opening-balance-val").textContent = DB.formatMoney(state.walletDoc.openingBalance || 0);
    const curEl = document.getElementById("current-balance-val");
    curEl.textContent = DB.formatMoney(state.currentBalance);
    curEl.className = `text-display-lg font-numeric-table font-bold ${state.currentBalance < 0 ? "text-error" : "text-primary"}`;

    document.getElementById("total-commissions-val").textContent = DB.formatMoney(state.todayCommissions);
  }

  function getFilteredTransactions() {
    const today = DB.todayDateStr();
    return state.computedTransactions.filter((tx) => {
      if (state.dateFilter === "today" && tx.dateStr !== today) return false;
      if (state.typeFilter !== "all" && tx.type !== state.typeFilter) return false;
      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        const phoneMatch = (tx.phone || "").toLowerCase().includes(q);
        const notesMatch = (tx.notes || "").toLowerCase().includes(q);
        return phoneMatch || notesMatch;
      }
      return true;
    });
  }

  function renderTable() {
    const tbody = document.getElementById("tx-table-body");
    const emptyState = document.getElementById("tx-empty-state");
    const countBadge = document.getElementById("tx-count-badge");
    const list = getFilteredTransactions();

    if (countBadge) countBadge.textContent = `${list.length} حركات`;

    if (list.length === 0) {
      tbody.innerHTML = "";
      emptyState.classList.remove("hidden");
      return;
    }

    emptyState.classList.add("hidden");
    tbody.innerHTML = list
      .map((tx, idx) => {
        const isWithdraw = tx.type === "withdraw";
        const typeBadge = isWithdraw
          ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-label-md bg-primary-fixed text-on-primary-fixed font-bold"><span class="material-symbols-outlined text-xs">call_made</span>سحب (تحويل للعميل)</span>`
          : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-label-md bg-tertiary-fixed text-on-tertiary-fixed-variant font-bold"><span class="material-symbols-outlined text-xs">call_received</span>إيداع (استلام من العميل)</span>`;

        const rowBg = idx % 2 === 0 ? "bg-white" : "bg-slate-50/70";
        return `
          <tr class="${rowBg} hover:bg-primary-fixed/20 transition-colors border-b border-slate-100 font-body-md">
            <td class="py-3 px-4 font-numeric-table text-on-surface-variant text-body-sm">${escapeHtml(tx.dateStr || "")} • ${escapeHtml(tx.timeStr || "")}</td>
            <td class="py-3 px-4">${typeBadge}</td>
            <td class="py-3 px-4 font-numeric-table font-semibold text-on-surface" dir="ltr">${escapeHtml(tx.phone)}</td>
            <td class="py-3 px-4 text-on-surface-variant">${escapeHtml(tx.notes || "—")}</td>
            <td class="py-3 px-4 font-numeric-table font-bold ${isWithdraw ? "text-error" : "text-tertiary"} text-left" dir="ltr">
              ${isWithdraw ? "-" : "+"}${DB.formatMoney(tx.amount)} ج.م
            </td>
            <td class="py-3 px-4 font-numeric-table text-tertiary font-semibold text-left" dir="ltr">+${DB.formatMoney(tx.commission)} ج.م</td>
            <td class="py-3 px-4 font-numeric-table font-bold text-on-surface text-left" dir="ltr">${DB.formatMoney(tx.resultingBalance)} ج.م</td>
            <td class="py-3 px-4 text-center">
              <div class="inline-flex items-center gap-1">
                <button type="button" onclick="WalletPage.openEditTxModal('${tx.id}')" title="تعديل المعاملة" class="p-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-primary transition-colors">
                  <span class="material-symbols-outlined text-base">edit</span>
                </button>
                <button type="button" onclick="WalletPage.openDeleteModal('${tx.id}')" title="حذف المعاملة" class="p-1.5 rounded-lg bg-error-container/40 hover:bg-error hover:text-white text-error transition-colors">
                  <span class="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function setTxType(type) {
    state.currentType = type;
    const btnWithdraw = document.getElementById("btn-type-withdraw");
    const btnDeposit = document.getElementById("btn-type-deposit");
    const submitBtn = document.getElementById("btn-submit-tx");

    if (type === "withdraw") {
      btnWithdraw.className = "flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-label-lg transition-all bg-white text-primary shadow-sm font-bold";
      btnDeposit.className = "flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-label-lg transition-all text-on-surface-variant hover:text-on-surface";
      submitBtn.className = "w-full h-10 rounded-lg bg-primary text-white hover:bg-primary-container transition-colors font-label-lg shadow-sm flex items-center justify-center gap-1.5";
      submitBtn.innerHTML = `<span class="material-symbols-outlined text-lg">check</span><span>تسجيل سحب كاش</span>`;
    } else {
      btnDeposit.className = "flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-label-lg transition-all bg-white text-tertiary shadow-sm font-bold";
      btnWithdraw.className = "flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-label-lg transition-all text-on-surface-variant hover:text-on-surface";
      submitBtn.className = "w-full h-10 rounded-lg bg-tertiary text-white hover:bg-tertiary-container transition-colors font-label-lg shadow-sm flex items-center justify-center gap-1.5";
      submitBtn.innerHTML = `<span class="material-symbols-outlined text-lg">check</span><span>تسجيل إيداع كاش</span>`;
    }

    const curAmt = document.getElementById("tx-amount").value;
    if (curAmt) autoCalculateCommission(curAmt);
  }

  function validatePhone(input) {
    const val = input.value.trim();
    const isValid = /^01[0125][0-9]{8}$/.test(val);
    const validIcon = document.getElementById("phone-valid-icon");
    if (validIcon) {
      validIcon.classList.toggle("hidden", !isValid);
    }
  }

  function autoCalculateCommission(amountStr) {
    const amount = parseFloat(amountStr);
    const commInput = document.getElementById("tx-commission");
    if (!commInput) return;
    if (isNaN(amount) || amount <= 0) {
      commInput.value = "";
      return;
    }
    let calculated = 5;
    if (amount <= 500) calculated = 5;
    else if (amount <= 1000) calculated = 10;
    else calculated = Math.ceil(amount * 0.01);
    commInput.value = calculated.toFixed(2);
  }

  async function handleSaveTx(event) {
    event.preventDefault();
    const phone = document.getElementById("cust-phone").value.trim();
    const amount = parseFloat(document.getElementById("tx-amount").value);
    const commission = parseFloat(document.getElementById("tx-commission").value) || 0;
    const notes = document.getElementById("tx-notes").value.trim();

    if (!phone || isNaN(amount) || amount <= 0) {
      showToast("بيانات غير مكتملة", "يرجى إدخال رقم الهاتف والمبلغ بشكل صحيح", true);
      return;
    }

    if (state.currentType === "withdraw" && amount > state.currentBalance) {
      showToast(
        "تنبيه: رصيد المحفظة غير كافٍ",
        `الرصيد الحالي (${DB.formatMoney(state.currentBalance)} ج.م) أقل من المطلوب — اضغط تعديل الرصيد الافتتاحي أولاً`,
        true
      );
      return;
    }

    const submitBtn = document.getElementById("btn-submit-tx");
    submitBtn.disabled = true;
    try {
      await DB.addWalletTx({
        walletId,
        type: state.currentType,
        phone,
        amount,
        commission,
        notes
      });

      document.getElementById("tx-form").reset();
      document.getElementById("phone-valid-icon")?.classList.add("hidden");
      document.getElementById("cust-phone").focus();
      showToast("تم تسجيل المعاملة في Firebase", `${DB.formatMoney(amount)} ج.م • عمولة ${DB.formatMoney(commission)} ج.م`);
    } catch (err) {
      showToast("تعذر حفظ المعاملة", err.message, true);
    } finally {
      submitBtn.disabled = false;
    }
  }

  function openSimModal() {
    document.getElementById("input-sim-number").value = state.walletDoc.simNumber || "";
    document.getElementById("input-sim-active").checked = state.walletDoc.isActive !== false;
    openModal("sim-modal");
    setTimeout(() => document.getElementById("input-sim-number").focus(), 80);
  }

  async function handleSaveSim(e) {
    e.preventDefault();
    const simNumber = document.getElementById("input-sim-number").value.trim();
    const isActive = document.getElementById("input-sim-active").checked;
    try {
      await DB.saveWallet(walletId, { simNumber, isActive });
      closeModal("sim-modal");
      showToast("تم تحديث بيانات شريحة المحفظة", simNumber || "تم مسح الرقم");
    } catch (err) {
      showToast("تعذر الحفظ", err.message, true);
    }
  }

  function openBalanceModal() {
    document.getElementById("input-opening-bal").value = state.walletDoc.openingBalance || "";
    openModal("balance-modal");
    setTimeout(() => document.getElementById("input-opening-bal").focus(), 80);
  }

  async function handleSaveOpeningBalance(e) {
    e.preventDefault();
    const openingBalance = parseFloat(document.getElementById("input-opening-bal").value) || 0;
    try {
      await DB.saveWallet(walletId, { openingBalance });
      closeModal("balance-modal");
      showToast("تم تحديث الرصيد الافتتاحي", `${DB.formatMoney(openingBalance)} ج.م`);
    } catch (err) {
      showToast("تعذر التحديث", err.message, true);
    }
  }

  function openEditTxModal(txId) {
    const tx = state.computedTransactions.find((t) => t.id === txId);
    if (!tx) return;
    state.editingId = txId;
    document.getElementById("edit-tx-type").value = tx.type;
    document.getElementById("edit-tx-phone").value = tx.phone || "";
    document.getElementById("edit-tx-amount").value = tx.amount || 0;
    document.getElementById("edit-tx-commission").value = tx.commission || 0;
    document.getElementById("edit-tx-notes").value = tx.notes || "";
    openModal("edit-tx-modal");
  }

  async function handleSaveEditTx(e) {
    e.preventDefault();
    if (!state.editingId) return;
    const updates = {
      type: document.getElementById("edit-tx-type").value,
      phone: document.getElementById("edit-tx-phone").value.trim(),
      amount: parseFloat(document.getElementById("edit-tx-amount").value) || 0,
      commission: parseFloat(document.getElementById("edit-tx-commission").value) || 0,
      notes: document.getElementById("edit-tx-notes").value.trim()
    };
    try {
      await DB.updateWalletTx(state.editingId, updates);
      state.editingId = null;
      closeModal("edit-tx-modal");
      showToast("تم تعديل المعاملة وإعادة احتساب الرصيد");
    } catch (err) {
      showToast("تعذر التعديل", err.message, true);
    }
  }

  function openDeleteModal(txId) {
    const tx = state.computedTransactions.find((t) => t.id === txId);
    if (!tx) return;
    requirePinIfProtected(() => {
      state.pendingDeleteId = txId;
      const isW = tx.type === "withdraw";
      document.getElementById("delete-tx-summary").innerHTML = `
        <div class="flex justify-between py-1"><span>رقم العميل:</span><strong dir="ltr">${escapeHtml(tx.phone)}</strong></div>
        <div class="flex justify-between py-1"><span>قيمة العملية:</span><strong class="${isW ? "text-error" : "text-tertiary"}">${DB.formatMoney(tx.amount)} ج.م (${isW ? "سحب" : "إيداع"})</strong></div>
        <div class="flex justify-between py-1"><span>العمولة:</span><strong class="text-tertiary">${DB.formatMoney(tx.commission)} ج.م</strong></div>
      `;
      openModal("delete-modal");
    });
  }

  async function confirmDeleteTx() {
    if (!state.pendingDeleteId) return;
    try {
      await DB.deleteWalletTx(state.pendingDeleteId);
      state.pendingDeleteId = null;
      closeModal("delete-modal");
      showToast("تم حذف المعاملة وتحديث رصيد المحفظة");
    } catch (err) {
      showToast("تعذر الحذف", err.message, true);
    }
  }

  function exportTableToCsv() {
    const list = getFilteredTransactions();
    if (list.length === 0) {
      showToast("لا توجد حركات للتصدير", "", true);
      return;
    }
    const cfg = WALLET_CONFIGS[walletId] || WALLET_CONFIGS.cash_1;
    let csv = "\uFEFFالتاريخ,الوقت,نوع العملية,رقم العميل,المبلغ,العمولة,الرصيد المتبقي,ملاحظات\n";
    list.forEach((t) => {
      const typeStr = t.type === "withdraw" ? "سحب" : "إيداع";
      csv += `"${t.dateStr || ""}","${t.timeStr || ""}","${typeStr}","${t.phone}","${t.amount}","${t.commission}","${t.resultingBalance}","${(t.notes || "").replace(/"/g, '""')}"\n`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `${cfg.filePrefix}_${DB.todayDateStr()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function init() {
    walletId = document.body.dataset.walletId || "cash_1";
    const cfg = WALLET_CONFIGS[walletId] || WALLET_CONFIGS.cash_1;
    window.AppLayout.init(walletId);

    const titleEl = document.getElementById("wallet-page-title");
    const tableTitleEl = document.getElementById("wallet-table-title");
    const commTitleEl = document.getElementById("wallet-comm-title");
    const emptyTitleEl = document.getElementById("wallet-empty-title");

    if (titleEl) titleEl.textContent = cfg.title;
    if (tableTitleEl) tableTitleEl.textContent = `سجل حركات ${cfg.shortName}`;
    if (commTitleEl) commTitleEl.textContent = `عمولات ${cfg.shortName} المكتسبة اليوم`;
    if (emptyTitleEl) emptyTitleEl.textContent = `لا توجد حركات مسجلة على ${cfg.shortName} حالياً`;

    DB.subscribeWallet(walletId, (doc) => {
      state.walletDoc = doc || { simNumber: "", openingBalance: 0, isActive: true };
      recalculateState();
    });

    DB.subscribeWalletTransactions(walletId, (txs) => {
      state.rawTransactions = txs;
      recalculateState();
    });

    document.getElementById("tx-form")?.addEventListener("submit", handleSaveTx);
    document.getElementById("sim-form")?.addEventListener("submit", handleSaveSim);
    document.getElementById("balance-form")?.addEventListener("submit", handleSaveOpeningBalance);
    document.getElementById("edit-tx-form")?.addEventListener("submit", handleSaveEditTx);
    document.getElementById("table-search")?.addEventListener("input", (e) => {
      state.searchQuery = e.target.value.trim();
      renderTable();
    });
    document.getElementById("filter-tx-type")?.addEventListener("change", (e) => {
      state.typeFilter = e.target.value;
      renderTable();
    });
    document.getElementById("filter-tx-date")?.addEventListener("change", (e) => {
      state.dateFilter = e.target.value;
      renderTable();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "F2") {
        e.preventDefault();
        document.getElementById("cust-phone")?.focus();
      }
    });
  }

  window.WalletPage = {
    setTxType,
    validatePhone,
    autoCalculateCommission,
    toggleCustomCommission: () => {
      const inp = document.getElementById("tx-commission");
      inp?.focus();
      inp?.select();
    },
    openSimModal,
    openBalanceModal,
    openEditTxModal,
    openDeleteModal,
    confirmDeleteTx,
    exportTableToCsv
  };

  document.addEventListener("DOMContentLoaded", init);
})();
