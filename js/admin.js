// Admin & Reports Page Logic (index.html)
(function () {
  const { escapeHtml, showToast, openModal, closeModal, requirePinIfProtected, openPrintWindow } = window.AppLayout;
  const DB = window.PosDB;

  const state = {
    settings: JSON.parse(JSON.stringify(DB.DEFAULT_SETTINGS)),
    staff: [],
    wallets: {},
    walletTxs: [],
    sales: [],
    drawerTxs: [],
    inventory: [],
    phones: [],
    shiftClosings: [],
    expectedDrawer: 0,
    manualType: "deposit", // 'deposit' | 'withdraw'
    editingDrawerId: null,
    pendingDeleteDrawerId: null,
    pendingDeleteStaffId: null,
    editingStaffId: null,
    activeLogTab: "drawer" // 'drawer' | 'closings'
  };

  function computeWalletBalances() {
    const ids = ["cash_1", "cash_2", "cash_3"];
    const result = {};
    ids.forEach((id) => {
      const w = state.wallets[id] || {};
      let bal = Number(w.openingBalance) || 0;
      let todayComm = 0;
      const txs = state.walletTxs
        .filter((t) => t.walletId === id)
        .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
      txs.forEach((t) => {
        const amt = Number(t.amount) || 0;
        const comm = Number(t.commission) || 0;
        if (t.type === "withdraw") bal -= amt;
        else bal += amt;
        if (t.dateStr === DB.todayDateStr()) {
          todayComm += comm;
        }
      });
      result[id] = {
        simNumber: w.simNumber || "",
        balance: bal,
        todayComm,
        txCount: txs.length
      };
    });
    return result;
  }

  function renderKPIs() {
    const today = DB.todayDateStr();
    const todaySales = state.sales.filter((s) => s.dateStr === today);
    const todayWalletTxs = state.walletTxs.filter((t) => t.dateStr === today);
    const todayDrawerTxs = state.drawerTxs.filter((d) => d.dateStr === today);

    const goodsRevenue = todaySales.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);
    const unitsSold = todaySales.reduce((acc, s) => acc + (Number(s.qty) || 1), 0);
    const walletCommissions = todayWalletTxs.reduce((acc, t) => acc + (Number(t.commission) || 0), 0);
    const totalRevenue = goodsRevenue + walletCommissions;
    const totalOpsCount = todaySales.length + todayWalletTxs.length;

    const openingBal = Number(state.settings.shift?.openingBalance) || 0;
    const drawerIn = todayDrawerTxs
      .filter((d) => d.direction !== "out")
      .reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
    const drawerOut = todayDrawerTxs
      .filter((d) => d.direction === "out")
      .reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
    const expectedDrawer = openingBal + drawerIn - drawerOut;
    state.expectedDrawer = expectedDrawer;

    document.getElementById("kpiTotalRevenue").textContent = DB.formatMoney(totalRevenue);
    document.getElementById("kpiTotalOps").textContent = `${totalOpsCount} معاملة`;

    document.getElementById("kpiDrawerBalance").textContent = DB.formatMoney(expectedDrawer);
    const drawerStatusEl = document.getElementById("kpiDrawerStatus");
    if (state.settings.shift?.isOpen === false) {
      drawerStatusEl.textContent = "الدرج مغلق حالياً";
      drawerStatusEl.className = "px-2 py-0.5 rounded bg-error-container text-on-error-container font-bold";
    } else if (openingBal === 0 && todayDrawerTxs.length === 0) {
      drawerStatusEl.textContent = "بانتظار الرصيد الافتتاحي";
      drawerStatusEl.className = "px-2 py-0.5 rounded bg-tertiary-fixed text-on-tertiary-fixed-variant font-bold";
    } else {
      drawerStatusEl.textContent = "الدرج مفتوح ونشط";
      drawerStatusEl.className = "px-2 py-0.5 rounded bg-tertiary-fixed text-on-tertiary-fixed-variant font-bold";
    }

    document.getElementById("kpiGoodsSales").textContent = DB.formatMoney(goodsRevenue);
    document.getElementById("kpiUnitsSold").textContent = `${unitsSold} قطعة مُباعة`;

    document.getElementById("kpiWalletCommissions").textContent = DB.formatMoney(walletCommissions);
    const staffPct = Number(state.settings.security?.staffCommissionPercent) || 0;
    const staffShare = (walletCommissions * staffPct) / 100;
    document.getElementById("kpiCommissionSub").textContent = `حصة الموظف (${staffPct}%): ${DB.formatMoney(staffShare)} ج.م`;

    // Cross-system quick balances
    const wBalances = computeWalletBalances();
    ["cash_1", "cash_2", "cash_3"].forEach((wId, idx) => {
      const balEl = document.getElementById(`summaryWalletBal${idx + 1}`);
      const simEl = document.getElementById(`summaryWalletSim${idx + 1}`);
      if (balEl) balEl.textContent = `${DB.formatMoney(wBalances[wId].balance)} ج.م`;
      if (simEl) simEl.textContent = wBalances[wId].simNumber || "شريحة غير محددة";
    });

    const chargersCount = state.inventory.filter((i) => i.section === "chargers").reduce((a, b) => a + (Number(b.qty) || 0), 0);
    const headphonesCount = state.inventory.filter((i) => i.section === "headphones").reduce((a, b) => a + (Number(b.qty) || 0), 0);
    const speakersCount = state.inventory.filter((i) => i.section === "speakers").reduce((a, b) => a + (Number(b.qty) || 0), 0);
    const phonesAvailCount = state.phones.filter((p) => !p.isSold).length;

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setTxt("summaryStockChargers", `${chargersCount} قطعة`);
    setTxt("summaryStockPhones", `${phonesAvailCount} جهاز متاح`);
    setTxt("summaryStockHeadphones", `${headphonesCount} قطعة`);
    setTxt("summaryStockSpeakers", `${speakersCount} قطعة`);

    updateVariance();
  }

  function syncSettingsToUI() {
    const shift = state.settings.shift || {};
    const sec = state.settings.security || {};

    const periodSel = document.getElementById("shiftPeriod");
    if (periodSel) periodSel.value = shift.period || "morning";

    const openedAtEl = document.getElementById("shiftOpenedAt");
    if (openedAtEl) openedAtEl.textContent = shift.openedAt || "مفتوح الآن";

    const openingInput = document.getElementById("openingBalanceInput");
    if (openingInput && document.activeElement !== openingInput) {
      openingInput.value = shift.openingBalance || "";
    }

    const cashierNameEl = document.getElementById("shiftCashierNameDisplay");
    const cashierRoleEl = document.getElementById("shiftCashierRoleDisplay");
    if (cashierNameEl) cashierNameEl.textContent = shift.cashierName || "أدمن الوردية";
    if (cashierRoleEl) cashierRoleEl.textContent = shift.cashierRole || "إدارة عامة";

    const pinInput = document.getElementById("adminPinInput");
    if (pinInput && document.activeElement !== pinInput) {
      pinInput.value = sec.adminPin || "";
    }

    const commInput = document.getElementById("commissionPercentInput");
    if (commInput && document.activeElement !== commInput) {
      commInput.value = sec.staffCommissionPercent ?? 15;
    }

    const policyVal = sec.deletePolicy || "open";
    const radio = document.querySelector(`input[name="delete_policy"][value="${policyVal}"]`);
    if (radio) radio.checked = true;

    const securityStatusEl = document.getElementById("securityPolicyStatus");
    if (securityStatusEl) {
      if (policyVal !== "open" && sec.adminPin) {
        securityStatusEl.innerHTML = `<span class="material-symbols-outlined text-sm">check_circle</span><span>الحماية بالرقم السري مفعلة</span>`;
        securityStatusEl.className = "font-label-md text-tertiary flex items-center gap-1 font-bold";
      } else if (policyVal !== "open" && !sec.adminPin) {
        securityStatusEl.innerHTML = `<span class="material-symbols-outlined text-sm">info</span><span>يرجى تعيين رمز PIN لتفعيل الحماية</span>`;
        securityStatusEl.className = "font-label-md text-warning flex items-center gap-1 font-bold";
      } else {
        securityStatusEl.innerHTML = `<span class="material-symbols-outlined text-sm">lock_open</span><span>الحذف السريع متاح بدون رمز سري</span>`;
        securityStatusEl.className = "font-label-md text-on-surface-variant flex items-center gap-1";
      }
    }
  }

  function updateVariance() {
    const actualInput = document.getElementById("actualHandCashInput");
    const expectedDisplay = document.getElementById("expectedDrawerDisplay");
    const varianceVal = document.getElementById("varianceValue");
    const varianceBadge = document.getElementById("varianceStatusBadge");
    if (!actualInput || !varianceVal || !varianceBadge) return;

    const expected = state.expectedDrawer || 0;
    if (expectedDisplay) {
      expectedDisplay.textContent = `${DB.formatMoney(expected)} ج.م`;
    }

    if (actualInput.value === "") {
      varianceVal.textContent = "0.00";
      varianceBadge.textContent = "أدخل الجرد الفعلي";
      varianceBadge.className = "font-label-md px-2 py-0.5 rounded bg-surface-container text-on-surface-variant";
      return;
    }

    const actual = parseFloat(actualInput.value) || 0;
    const diff = actual - expected;
    varianceVal.textContent = `${diff >= 0 ? "+" : ""}${DB.formatMoney(diff)}`;

    if (Math.abs(diff) < 0.01) {
      varianceBadge.textContent = "متطابق تماماً";
      varianceBadge.className = "font-label-md px-2 py-0.5 rounded bg-tertiary-fixed text-on-tertiary-fixed font-bold";
    } else if (diff < 0) {
      varianceBadge.textContent = `عجز ${DB.formatMoney(Math.abs(diff))} ج.م`;
      varianceBadge.className = "font-label-md px-2 py-0.5 rounded bg-error-container text-on-error-container font-bold";
    } else {
      varianceBadge.textContent = `زيادة +${DB.formatMoney(diff)} ج.م`;
      varianceBadge.className = "font-label-md px-2 py-0.5 rounded bg-primary-fixed text-on-primary-fixed font-bold";
    }
  }

  function renderDrawerLogTable() {
    const drawerContainer = document.getElementById("drawerTableWrapper");
    const closingsContainer = document.getElementById("closingsTableWrapper");
    const emptyState = document.getElementById("drawerEmptyState");
    const badge = document.getElementById("drawerRecordsBadge");

    if (state.activeLogTab === "closings") {
      drawerContainer.classList.add("hidden");
      if (state.shiftClosings.length === 0) {
        closingsContainer.classList.add("hidden");
        emptyState.classList.remove("hidden");
        document.getElementById("drawerEmptyTitle").textContent = "لا توجد تقارير إغلاق ورديات مسجلة بعد";
        document.getElementById("drawerEmptySubtitle").textContent = "عند اعتماد إغلاق أي وردية من قسم الجرد الفعلي أعلاه، سيتم حفظ التقرير هنا للرجوع إليه.";
      } else {
        emptyState.classList.add("hidden");
        closingsContainer.classList.remove("hidden");
        renderClosingsTable();
      }
      if (badge) badge.textContent = `${state.shiftClosings.length} تقارير`;
      return;
    }

    closingsContainer.classList.add("hidden");
    const tbody = document.getElementById("drawerTableBody");
    const filterVal = document.getElementById("drawerLogFilter")?.value || "today";
    const today = DB.todayDateStr();

    const list = state.drawerTxs.filter((tx) => (filterVal === "today" ? tx.dateStr === today : true));
    if (badge) badge.textContent = `${list.length} حركة`;

    if (list.length === 0) {
      tbody.innerHTML = "";
      drawerContainer.classList.add("hidden");
      emptyState.classList.remove("hidden");
      document.getElementById("drawerEmptyTitle").textContent = "لا توجد حركات مسجلة في درج الخزينة لهذا الشيفت حتى الآن";
      document.getElementById("drawerEmptySubtitle").textContent = "الدرج في وضع الاستعداد الكامل. بمجرد تسجيل حركة يدوية أو إصدار فاتورة مبيعات كاش ستظهر العمليات هنا لحظياً.";
      return;
    }

    emptyState.classList.add("hidden");
    drawerContainer.classList.remove("hidden");

    const sourceNames = {
      manual: "حركة يدوية",
      chargers: "مبيعات شواحن",
      headphones: "مبيعات سماعات",
      speakers: "مبيعات صبات",
      phones: "مبيعات هواتف",
      pos: "فاتورة سريعة",
      shift: "تعديل وردية"
    };

    tbody.innerHTML = list
      .map((tx, idx) => {
        const isOut = tx.direction === "out";
        const typeLabel = isOut ? "سحب / مصروف" : tx.type === "sale" ? "مبيعات كاش" : "إيداع بالدرج";
        const typeBadge = isOut
          ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-error-container text-on-error-container font-label-md font-bold">${typeLabel}</span>`
          : tx.type === "sale"
          ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary-fixed text-on-primary-fixed font-label-md font-bold">${typeLabel}</span>`
          : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-tertiary-fixed text-on-tertiary-fixed font-label-md font-bold">${typeLabel}</span>`;

        const rowBg = idx % 2 === 0 ? "bg-white" : "bg-slate-50/70";
        return `
          <tr class="${rowBg} hover:bg-primary-fixed/20 transition-colors border-b border-slate-100">
            <td class="py-3 px-4 font-numeric-table text-on-surface-variant text-body-sm">${escapeHtml(tx.dateStr || "")} • ${escapeHtml(tx.timeStr || "")}</td>
            <td class="py-3 px-4">${typeBadge}</td>
            <td class="py-3 px-4 text-body-sm text-on-surface-variant">${escapeHtml(sourceNames[tx.source] || tx.source || "يدوي")}</td>
            <td class="py-3 px-4 font-body-md font-medium text-on-surface">${escapeHtml(tx.reason || "-")}</td>
            <td class="py-3 px-4 text-body-sm text-on-surface-variant">${escapeHtml(tx.staffName || "النظام")}</td>
            <td class="py-3 px-4 font-numeric-table text-left font-bold ${isOut ? "text-error" : "text-tertiary"}" dir="ltr">
              ${isOut ? "-" : "+"}${DB.formatMoney(tx.amount)} ج.م
            </td>
            <td class="py-3 px-4 text-center">
              <div class="inline-flex items-center gap-1">
                <button type="button" onclick="AdminPage.openEditDrawerTx('${tx.id}')" title="تعديل" class="p-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-primary transition-colors">
                  <span class="material-symbols-outlined text-base">edit</span>
                </button>
                <button type="button" onclick="AdminPage.triggerDeleteDrawerTx('${tx.id}')" title="حذف" class="p-1.5 rounded-lg bg-error-container/40 hover:bg-error hover:text-white text-error transition-colors">
                  <span class="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderClosingsTable() {
    const tbody = document.getElementById("closingsTableBody");
    if (!tbody) return;
    tbody.innerHTML = state.shiftClosings
      .map((rep, idx) => {
        const variance = Number(rep.variance) || 0;
        const varClass = Math.abs(variance) < 0.01 ? "text-tertiary" : variance < 0 ? "text-error" : "text-primary";
        const rowBg = idx % 2 === 0 ? "bg-white" : "bg-slate-50/70";
        return `
          <tr class="${rowBg} border-b border-slate-100">
            <td class="py-3 px-4 font-numeric-table text-body-sm">${escapeHtml(rep.closedAt || rep.dateStr)}</td>
            <td class="py-3 px-4 font-body-md font-semibold">${escapeHtml(rep.cashierName || "-")}</td>
            <td class="py-3 px-4 font-numeric-table text-left">${DB.formatMoney(rep.openingBalance)} ج.م</td>
            <td class="py-3 px-4 font-numeric-table text-left">${DB.formatMoney(rep.expectedDrawer)} ج.م</td>
            <td class="py-3 px-4 font-numeric-table text-left font-bold">${DB.formatMoney(rep.actualHandCash)} ج.م</td>
            <td class="py-3 px-4 font-numeric-table text-left font-bold ${varClass}" dir="ltr">${variance >= 0 ? "+" : ""}${DB.formatMoney(variance)} ج.م</td>
            <td class="py-3 px-4 text-body-sm text-on-surface-variant">${escapeHtml(rep.notes || "—")}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderStaffTable() {
    const tbody = document.getElementById("staffTableBody");
    const emptyEl = document.getElementById("staffEmptyState");
    if (!tbody || !emptyEl) return;

    if (state.staff.length === 0) {
      tbody.innerHTML = "";
      emptyEl.classList.remove("hidden");
      return;
    }

    emptyEl.classList.add("hidden");
    tbody.innerHTML = state.staff
      .map((person) => `
        <tr class="border-b border-slate-100 hover:bg-slate-50">
          <td class="py-2.5 px-4 font-body-md font-bold text-on-surface">${escapeHtml(person.name)}</td>
          <td class="py-2.5 px-4">
            <span class="px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-label-md font-bold">${escapeHtml(person.role || "كاشير")}</span>
          </td>
          <td class="py-2.5 px-4 font-numeric-table text-body-sm">${person.pin ? "••••" : "بدون رمز"}</td>
          <td class="py-2.5 px-4 text-body-sm text-on-surface-variant">
            ${person.canDelete ? "حذف وتعديل • " : ""}${person.canManageDrawer ? "إدارة الدرج • " : ""}${person.canEditPrices ? "تعديل الأسعار" : "مبيعات فقط"}
          </td>
          <td class="py-2.5 px-4 text-center">
            <div class="inline-flex items-center gap-1">
              <button type="button" onclick="AdminPage.setActiveCashier('${person.id}')" title="تعيين ككاشير نشط" class="px-2 py-1 rounded bg-tertiary-fixed text-on-tertiary-fixed text-xs font-bold hover:opacity-90">تفعيل</button>
              <button type="button" onclick="AdminPage.openEditStaffModal('${person.id}')" title="تعديل" class="p-1 rounded bg-surface-container-low hover:bg-surface-container text-on-surface-variant">
                <span class="material-symbols-outlined text-base">edit</span>
              </button>
              <button type="button" onclick="AdminPage.triggerDeleteStaff('${person.id}')" title="حذف" class="p-1 rounded bg-error-container/40 hover:bg-error hover:text-white text-error">
                <span class="material-symbols-outlined text-base">delete</span>
              </button>
            </div>
          </td>
        </tr>
      `)
      .join("");
  }

  // Modal & Action Handlers
  function setManualTxType(type) {
    state.manualType = type;
    const depBtn = document.getElementById("typeDepositBtn");
    const withBtn = document.getElementById("typeWithdrawBtn");
    if (type === "deposit") {
      depBtn.className = "py-2.5 rounded-lg border-2 border-tertiary bg-tertiary-fixed text-on-tertiary-fixed font-label-lg flex items-center justify-center gap-1";
      withBtn.className = "py-2.5 rounded-lg border-2 border-slate-200 bg-surface-container-low text-on-surface font-label-lg flex items-center justify-center gap-1 opacity-75";
    } else {
      withBtn.className = "py-2.5 rounded-lg border-2 border-error bg-error-container text-on-error-container font-label-lg flex items-center justify-center gap-1";
      depBtn.className = "py-2.5 rounded-lg border-2 border-slate-200 bg-surface-container-low text-on-surface font-label-lg flex items-center justify-center gap-1 opacity-75";
    }
  }

  function openNewManualTxModal() {
    state.editingDrawerId = null;
    document.getElementById("manualModalTitle").textContent = "تسجيل حركة نقدية يدوية بالدرج";
    document.getElementById("modalAmountInput").value = "";
    document.getElementById("modalReasonInput").value = "";
    setManualTxType("deposit");
    openModal("manualTxModal");
    setTimeout(() => document.getElementById("modalAmountInput").focus(), 80);
  }

  function openEditDrawerTx(id) {
    const tx = state.drawerTxs.find((d) => d.id === id);
    if (!tx) return;
    state.editingDrawerId = id;
    document.getElementById("manualModalTitle").textContent = "تعديل حركة الدرج";
    document.getElementById("modalAmountInput").value = tx.amount || 0;
    document.getElementById("modalReasonInput").value = tx.reason || "";
    setManualTxType(tx.direction === "out" ? "withdraw" : "deposit");
    openModal("manualTxModal");
  }

  async function submitManualTx(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById("modalAmountInput").value);
    const reason = document.getElementById("modalReasonInput").value.trim();
    if (isNaN(amount) || amount <= 0) {
      showToast("يرجى إدخال مبلغ صحيح أكبر من صفر", "", true);
      return;
    }
    if (!reason) {
      showToast("يرجى كتابة السبب أو البند المالي", "", true);
      return;
    }

    const direction = state.manualType === "withdraw" ? "out" : "in";
    const type = state.manualType === "withdraw" ? "withdraw" : "deposit";

    try {
      if (state.editingDrawerId) {
        await DB.updateDrawerTx(state.editingDrawerId, { amount, direction, type, reason });
        showToast("تم تعديل حركة الخزينة بنجاح");
      } else {
        await DB.addDrawerTx({
          type,
          source: "manual",
          amount,
          direction,
          reason,
          staffName: window.AppLayout.getActiveStaffName()
        });
        showToast("تم قيد الحركة المالية بالخزينة", `${DB.formatMoney(amount)} ج.م`);
      }
      closeModal("manualTxModal");
    } catch (err) {
      showToast("تعذر حفظ الحركة", err.message, true);
    }
  }

  function triggerDeleteDrawerTx(id) {
    requirePinIfProtected(() => {
      state.pendingDeleteDrawerId = id;
      const tx = state.drawerTxs.find((d) => d.id === id);
      const summary = document.getElementById("deleteDrawerSummary");
      if (summary && tx) {
        summary.textContent = `${tx.reason || "حركة خزينة"} — ${DB.formatMoney(tx.amount)} ج.م`;
      }
      openModal("deleteModal");
    });
  }

  async function confirmDeleteDrawerTx() {
    if (!state.pendingDeleteDrawerId) return;
    try {
      await DB.deleteDrawerTx(state.pendingDeleteDrawerId);
      state.pendingDeleteDrawerId = null;
      closeModal("deleteModal");
      showToast("تم حذف الحركة المالية من الخزينة وتحديث الرصيد");
    } catch (err) {
      showToast("تعذر الحذف", err.message, true);
    }
  }

  async function saveShiftOpening() {
    const period = document.getElementById("shiftPeriod").value;
    const openingBalance = parseFloat(document.getElementById("openingBalanceInput").value) || 0;
    try {
      await DB.saveSetting("shift", {
        isOpen: true,
        period,
        openingBalance,
        openedAt: state.settings.shift?.openedAt || DB.formatTimeAr()
      });
      showToast("تم تثبيت إعدادات الوردية والرصيد الافتتاحي", `${DB.formatMoney(openingBalance)} ج.م`);
    } catch (err) {
      showToast("تعذر حفظ إعدادات الوردية", err.message, true);
    }
  }

  async function commitShiftClose() {
    const actualInput = document.getElementById("actualHandCashInput");
    const actualHandCash = parseFloat(actualInput.value);
    if (isNaN(actualHandCash)) {
      showToast("يرجى إدخال الكاش الفعلي المحسوب باليد أولاً", "", true);
      actualInput.focus();
      return;
    }

    const expected = state.expectedDrawer || 0;
    const variance = actualHandCash - expected;
    const notes = document.getElementById("auditNotesInput").value.trim();
    const today = DB.todayDateStr();
    const totalSalesToday = state.sales.filter((s) => s.dateStr === today).reduce((a, b) => a + (Number(b.totalAmount) || 0), 0);
    const totalCommissionsToday = state.walletTxs.filter((t) => t.dateStr === today).reduce((a, b) => a + (Number(b.commission) || 0), 0);

    try {
      await DB.saveShiftClosing({
        period: state.settings.shift?.period || "morning",
        cashierName: window.AppLayout.getActiveStaffName(),
        openingBalance: Number(state.settings.shift?.openingBalance) || 0,
        expectedDrawer: expected,
        actualHandCash,
        variance,
        totalSalesToday,
        totalCommissionsToday,
        notes
      });

      await DB.saveSetting("shift", { isOpen: false });
      actualInput.value = "";
      document.getElementById("auditNotesInput").value = "";
      updateVariance();
      const synced = DB.isCloudConnected ? DB.isCloudConnected() : false;
      showToast(synced ? "تم اعتماد إغلاق الخزينة وحفظ تقرير الجرد في Firebase" : "تم حفظ إغلاق الخزينة محلياً فقط (المزامنة غير مفعلة)");

      const storeName = state.settings.store?.storeName || "سنترال تيك";
      openPrintWindow(
        "تقرير إغلاق وردية وجرد خزينة",
        `
        <div style="text-align:center;border-bottom:2px solid #0F172A;padding-bottom:10px;margin-bottom:12px;">
          <h2 style="margin:0;">${escapeHtml(storeName)}</h2>
          <p style="margin:4px 0;font-size:13px;">تقرير إغلاق الوردية وجرد الخزينة • ${today}</p>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:6px;border-bottom:1px solid #eee;">الكاشير المسؤول:</td><td style="padding:6px;border-bottom:1px solid #eee;"><strong>${escapeHtml(window.AppLayout.getActiveStaffName())}</strong></td></tr>
          <tr><td style="padding:6px;border-bottom:1px solid #eee;">الرصيد الافتتاحي:</td><td style="padding:6px;border-bottom:1px solid #eee;">${DB.formatMoney(state.settings.shift?.openingBalance || 0)} ج.م</td></tr>
          <tr><td style="padding:6px;border-bottom:1px solid #eee;">مبيعات البضاعة اليوم:</td><td style="padding:6px;border-bottom:1px solid #eee;">${DB.formatMoney(totalSalesToday)} ج.م</td></tr>
          <tr><td style="padding:6px;border-bottom:1px solid #eee;">أرباح عمولات المحافظ اليوم:</td><td style="padding:6px;border-bottom:1px solid #eee;">${DB.formatMoney(totalCommissionsToday)} ج.م</td></tr>
          <tr><td style="padding:6px;border-bottom:1px solid #eee;">الرصيد الدفتري المتوقع بالدرج:</td><td style="padding:6px;border-bottom:1px solid #eee;"><strong>${DB.formatMoney(expected)} ج.م</strong></td></tr>
          <tr><td style="padding:6px;border-bottom:1px solid #eee;">الكاش الفعلي باليد:</td><td style="padding:6px;border-bottom:1px solid #eee;"><strong>${DB.formatMoney(actualHandCash)} ج.م</strong></td></tr>
          <tr><td style="padding:6px;border-bottom:1px solid #eee;">الفارق (عجز / زيادة):</td><td style="padding:6px;border-bottom:1px solid #eee;"><strong>${variance >= 0 ? "+" : ""}${DB.formatMoney(variance)} ج.م</strong></td></tr>
        </table>
        ${notes ? `<p style="margin-top:12px;font-size:12px;"><strong>ملاحظات التدقيق:</strong> ${escapeHtml(notes)}</p>` : ""}
      `
      );
    } catch (err) {
      showToast("تعذر حفظ تقرير الإغلاق", err.message, true);
    }
  }

  // Staff CRUD
  function openNewStaffModal() {
    state.editingStaffId = null;
    document.getElementById("staffModalTitle").textContent = "إضافة موظف / صلاحية جديدة";
    document.getElementById("staffForm").reset();
    openModal("staffModal");
  }

  function openEditStaffModal(id) {
    const p = state.staff.find((s) => s.id === id);
    if (!p) return;
    state.editingStaffId = id;
    document.getElementById("staffModalTitle").textContent = "تعديل بيانات وصلاحيات الموظف";
    document.getElementById("staffNameInput").value = p.name || "";
    document.getElementById("staffRoleInput").value = p.role || "كاشير";
    document.getElementById("staffPinInput").value = p.pin || "";
    document.getElementById("staffCanDelete").checked = Boolean(p.canDelete);
    document.getElementById("staffCanManageDrawer").checked = Boolean(p.canManageDrawer);
    document.getElementById("staffCanEditPrices").checked = Boolean(p.canEditPrices);
    openModal("staffModal");
  }

  async function submitStaffForm(e) {
    e.preventDefault();
    const payload = {
      name: document.getElementById("staffNameInput").value.trim(),
      role: document.getElementById("staffRoleInput").value,
      pin: document.getElementById("staffPinInput").value.trim(),
      canDelete: document.getElementById("staffCanDelete").checked,
      canManageDrawer: document.getElementById("staffCanManageDrawer").checked,
      canEditPrices: document.getElementById("staffCanEditPrices").checked
    };
    if (!payload.name) return;

    try {
      if (state.editingStaffId) {
        await DB.updateStaff(state.editingStaffId, payload);
        showToast("تم تحديث بيانات الموظف", payload.name);
      } else {
        await DB.addStaff(payload);
        showToast("تمت إضافة الموظف والصلاحيات", payload.name);
      }
      closeModal("staffModal");
    } catch (err) {
      showToast("تعذر حفظ بيانات الموظف", err.message, true);
    }
  }

  async function setActiveCashier(id) {
    const p = state.staff.find((s) => s.id === id);
    if (!p) return;
    try {
      await DB.saveSetting("shift", {
        cashierName: p.name,
        cashierRole: p.role || "كاشير"
      });
      showToast("تم تبديل الكاشير النشط", p.name);
    } catch (err) {
      showToast("تعذر التبديل", err.message, true);
    }
  }

  function triggerDeleteStaff(id) {
    requirePinIfProtected(async () => {
      try {
        await DB.deleteStaff(id);
        showToast("تم حذف حساب الموظف");
      } catch (err) {
        showToast("تعذر الحذف", err.message, true);
      }
    });
  }

  function switchLogTab(tab) {
    state.activeLogTab = tab;
    const dBtn = document.getElementById("tabDrawerLog");
    const cBtn = document.getElementById("tabClosingsLog");
    if (tab === "drawer") {
      dBtn.className = "px-3 py-1.5 rounded-lg bg-primary text-white font-label-md shadow-sm";
      cBtn.className = "px-3 py-1.5 rounded-lg bg-surface-container-low text-on-surface-variant hover:bg-surface-container font-label-md";
    } else {
      cBtn.className = "px-3 py-1.5 rounded-lg bg-primary text-white font-label-md shadow-sm";
      dBtn.className = "px-3 py-1.5 rounded-lg bg-surface-container-low text-on-surface-variant hover:bg-surface-container font-label-md";
    }
    renderDrawerLogTable();
  }

  function init() {
    window.AppLayout.init("admin");

    // Subscribe to all Firebase collections
    window.AppLayout.onSettingsUpdate((settings) => {
      state.settings = settings;
      syncSettingsToUI();
      renderKPIs();
    });

    DB.subscribeStaff((list) => {
      state.staff = list;
      renderStaffTable();
    });

    DB.subscribeWallets((map) => {
      state.wallets = map;
      renderKPIs();
    });

    DB.subscribeAllWalletTransactions((list) => {
      state.walletTxs = list;
      renderKPIs();
    });

    DB.subscribeSales((list) => {
      state.sales = list;
      renderKPIs();
    });

    DB.subscribeDrawerTransactions((list) => {
      state.drawerTxs = list;
      renderKPIs();
      renderDrawerLogTable();
    });

    DB.subscribeAllInventory((list) => {
      state.inventory = list;
      renderKPIs();
    });

    DB.subscribePhones((list) => {
      state.phones = list;
      renderKPIs();
    });

    DB.subscribeShiftClosings((list) => {
      state.shiftClosings = list;
      if (state.activeLogTab === "closings") renderDrawerLogTable();
    });

    // Event bindings
    document.getElementById("actualHandCashInput")?.addEventListener("input", updateVariance);
    document.getElementById("saveShiftOpeningBtn")?.addEventListener("click", saveShiftOpening);
    document.getElementById("commitShiftCloseBtn")?.addEventListener("click", commitShiftClose);
    document.getElementById("exportShiftReportBtn")?.addEventListener("click", () => window.print());

    document.getElementById("openManualTxModalBtn")?.addEventListener("click", openNewManualTxModal);
    document.getElementById("tableAddManualBtn")?.addEventListener("click", openNewManualTxModal);
    document.getElementById("emptyStateAddBtn")?.addEventListener("click", openNewManualTxModal);
    document.getElementById("manualTxForm")?.addEventListener("submit", submitManualTx);
    document.getElementById("confirmDeleteBtn")?.addEventListener("click", confirmDeleteDrawerTx);
    document.getElementById("drawerLogFilter")?.addEventListener("change", renderDrawerLogTable);

    // Security bindings
    document.getElementById("togglePinVisibility")?.addEventListener("click", () => {
      const inp = document.getElementById("adminPinInput");
      inp.type = inp.type === "password" ? "text" : "password";
    });

    document.getElementById("savePinBtn")?.addEventListener("click", async () => {
      const pin = document.getElementById("adminPinInput").value.trim();
      if (pin && (pin.length < 4 || pin.length > 6)) {
        showToast("يرجى إدخال رمز مكون من 4 إلى 6 أرقام", "", true);
        return;
      }
      try {
        await DB.saveSetting("security", { adminPin: pin });
        showToast(pin ? "تم تحديث رمز PIN الإدارة بنجاح" : "تم إلغاء رمز PIN");
      } catch (err) {
        showToast("تعذر الحفظ", err.message, true);
      }
    });

    document.querySelectorAll('input[name="delete_policy"]').forEach((radio) => {
      radio.addEventListener("change", async (e) => {
        try {
          await DB.saveSetting("security", { deletePolicy: e.target.value });
          showToast("تم تحديث سياسة حماية الحذف");
        } catch (err) {
          showToast("تعذر التحديث", err.message, true);
        }
      });
    });

    document.getElementById("saveCommissionBtn")?.addEventListener("click", async () => {
      const pct = parseFloat(document.getElementById("commissionPercentInput").value) || 0;
      try {
        await DB.saveSetting("security", { staffCommissionPercent: pct });
        showToast("تم حفظ نسبة عمولة الموظفين", `${pct}%`);
      } catch (err) {
        showToast("تعذر الحفظ", err.message, true);
      }
    });

    document.getElementById("staffForm")?.addEventListener("submit", submitStaffForm);
  }

  window.AdminPage = {
    setManualTxType,
    openEditDrawerTx,
    triggerDeleteDrawerTx,
    openNewStaffModal,
    openEditStaffModal,
    setActiveCashier,
    triggerDeleteStaff,
    switchLogTab
  };

  document.addEventListener("DOMContentLoaded", init);
})();
