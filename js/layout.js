// Shared Sidebar, Header, Modals, Quick POS (F1), Drawer Switcher & PIN Guard
(function () {
  const NAV_ITEMS = [
    { group: "العمليات والمالية" },
    { id: "admin", href: "index.html", icon: "analytics", label: "الإدارة والتقارير العامة" },
    { id: "cash_1", href: "cash-1.html", icon: "account_balance_wallet", label: "محفظة كاش 1 - الأساسي" },
    { id: "cash_2", href: "cash-2.html", icon: "payments", label: "محفظة كاش 2 - الإضافي" },
    { id: "cash_3", href: "cash-3.html", icon: "currency_exchange", label: "محفظة كاش 3 - الاحتياطي" },
    { group: "المخازن والمبيعات" },
    { id: "chargers", href: "chargers.html", icon: "power", label: "مخزن الشواحن والوصلات" },
    { id: "phones", href: "phones.html", icon: "smartphone", label: "مخزن ومبيعات التلفونات" },
    { id: "headphones", href: "headphones.html", icon: "headphones", label: "قسم السماعات" },
    { id: "speakers", href: "speakers.html", icon: "speaker", label: "قسم الصبات والمكبرات" }
  ];

  const PERIOD_LABELS = {
    morning: "الوردية الصباحية",
    evening: "الوردية المسائية",
    night: "الوردية الليلية"
  };

  let currentPageId = "admin";
  let currentSettings = window.PosDB ? JSON.parse(JSON.stringify(window.PosDB.DEFAULT_SETTINGS)) : {};
  let staffList = [];
  let settingsListeners = [];
  let posCatalogLoaded = false;
  let allInventoryCache = [];
  let allPhonesCache = [];
  let posCart = [];
  let pendingPinCallback = null;
  let toastTimer = null;

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getInitials(name) {
    const clean = (name || "أ").trim();
    const parts = clean.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] || "") + (parts[1][0] || "");
    }
    return clean.slice(0, 2);
  }

  function renderSidebar(pageId) {
    const sidebar = document.getElementById("app-sidebar");
    if (!sidebar) return;

    sidebar.className =
      "fixed right-0 top-0 h-screen w-72 bg-navy-dark text-inverse-on-surface z-50 flex flex-col justify-between shadow-xl transition-transform duration-200 sidebar-closed lg:translate-x-0 border-l border-slate-800";

    const navHtml = NAV_ITEMS.map((item) => {
      if (item.group) {
        return `<div class="pt-3 first:pt-1 px-3 py-1 font-label-md text-label-md text-slate-400 uppercase tracking-wider">${escapeHtml(item.group)}</div>`;
      }
      const isActive = item.id === pageId;
      const cls = isActive
        ? "flex items-center gap-3 px-4 py-2.5 rounded-lg bg-primary text-on-primary font-title-md shadow-md ring-1 ring-sky-accent/40"
        : "flex items-center gap-3 px-4 py-2.5 rounded-lg text-slate-300 hover:bg-navy-card hover:text-sky-accent transition-colors";
      return `
        <a href="${item.href}" ${isActive ? 'aria-current="page"' : ""} class="${cls}">
          <span class="material-symbols-outlined text-xl ${isActive ? "text-white" : "text-slate-400"}">${item.icon}</span>
          <span class="font-body-md text-body-md">${escapeHtml(item.label)}</span>
        </a>
      `;
    }).join("");

    const store = currentSettings.store || {};
    const shift = currentSettings.shift || {};
    const cashierName = shift.cashierName || "أدمن الوردية";
    const cashierRole = shift.cashierRole || "إدارة عامة";

    sidebar.innerHTML = `
      <div class="flex flex-col h-full">
        <div class="h-16 px-4 flex items-center justify-between bg-navy-dark border-b border-slate-800 shrink-0">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-primary to-sky-accent flex items-center justify-center text-white shadow-md shrink-0">
              <span class="material-symbols-outlined text-2xl">point_of_sale</span>
            </div>
            <div class="flex flex-col min-w-0">
              <span id="sidebarStoreName" class="font-title-md text-white leading-tight truncate">${escapeHtml(store.storeName || "سنترال تيك")}</span>
              <span id="sidebarStoreSubtitle" class="font-label-md text-sky-accent truncate">${escapeHtml(store.storeSubtitle || "للاتصالات والإلكترونيات")}</span>
            </div>
          </div>
          <button type="button" onclick="AppLayout.toggleMobileSidebar(false)" class="lg:hidden text-slate-400 hover:text-white p-1 rounded-lg">
            <span class="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <nav class="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          ${navHtml}
        </nav>

        <div class="p-4 border-t border-slate-800 flex items-center justify-between bg-navy-dark shrink-0">
          <div class="flex items-center gap-3 min-w-0">
            <div id="sidebarCashierAvatar" class="w-9 h-9 rounded-full bg-navy-card border border-sky-accent/40 text-sky-accent flex items-center justify-center font-bold text-xs shrink-0">
              ${escapeHtml(getInitials(cashierName))}
            </div>
            <div class="flex flex-col min-w-0">
              <span id="sidebarCashierName" class="font-title-md text-body-md text-white leading-none truncate">${escapeHtml(cashierName)}</span>
              <span id="sidebarCashierRole" class="font-label-md text-tertiary-fixed-dim mt-1 truncate">${escapeHtml(cashierRole)}</span>
            </div>
          </div>
          <button type="button" onclick="AppLayout.openDrawerModal()" title="تبديل الكاشير / الوردية" class="text-slate-400 hover:text-sky-accent transition-colors p-1.5 rounded-lg hover:bg-navy-card">
            <span class="material-symbols-outlined text-xl">switch_account</span>
          </button>
        </div>
      </div>
    `;
  }

  function renderHeader() {
    const header = document.getElementById("app-header");
    if (!header) return;

    header.className =
      "fixed top-0 right-0 lg:right-72 left-0 h-16 bg-surface-container-lowest/95 backdrop-blur-xl border-b border-surface-container shadow-[0_1px_8px_rgba(15,23,42,0.04)] z-40 flex items-center justify-between px-4 lg:px-8 gap-3";

    const store = currentSettings.store || {};

    header.innerHTML = `
      <div class="flex items-center gap-3 min-w-0">
        <button type="button" onclick="AppLayout.toggleMobileSidebar(true)" class="lg:hidden p-2 rounded-lg bg-surface-container-low text-on-surface hover:bg-surface-container transition-colors" aria-label="فتح القائمة">
          <span class="material-symbols-outlined text-xl">menu</span>
        </button>
        <div class="flex flex-col min-w-0">
          <span id="headerStoreName" class="font-title-lg text-title-md lg:text-title-lg text-on-surface font-bold truncate">${escapeHtml(store.storeName || "سنترال تيك - الفرع الرئيسي")}</span>
          <div class="flex items-center gap-2 text-on-surface-variant font-label-md text-label-md">
            <span class="material-symbols-outlined text-sm text-primary hidden sm:inline">calendar_today</span>
            <span id="headerLiveDate" class="truncate">--</span>
            <span class="text-outline-variant hidden sm:inline">•</span>
            <span id="headerLiveClock" class="font-numeric-table text-numeric-table font-bold text-primary hidden sm:inline">--:--:--</span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2 sm:gap-3 shrink-0">
        <button type="button" id="firebaseStatusBtn" onclick="AppLayout.showFirebaseInfo()" class="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-low border border-outline-variant/40 text-on-surface-variant font-label-md transition-colors" title="حالة المزامنة مع Firebase">
          <span id="firebaseStatusDot" class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
          <span id="firebaseStatusText">جاري الربط...</span>
        </button>

        <div id="headerDrawerPill" class="hidden xl:flex items-center gap-2 px-3 py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary/20">
          <span id="headerDrawerDot" class="w-2 h-2 rounded-full bg-tertiary animate-pulse"></span>
          <span id="headerDrawerLabel" class="font-label-lg font-bold">الوردية الصباحية - الدرج مفتوح</span>
        </div>

        <button type="button" onclick="AppLayout.openDrawerModal()" class="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-surface-container-low text-on-surface hover:bg-surface-container font-label-lg transition-colors border border-outline-variant/40" title="تبديل / إغلاق الدرج">
          <span class="material-symbols-outlined text-base text-primary">lock_reset</span>
          <span class="hidden sm:inline">تبديل / إغلاق الدرج</span>
        </button>

        <button type="button" onclick="AppLayout.openPosModal()" class="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-lg bg-primary text-on-primary hover:bg-primary-container font-label-lg shadow-sm transition-colors">
          <span class="material-symbols-outlined text-base">point_of_sale</span>
          <span class="hidden sm:inline">فاتورة جديدة (F1)</span>
          <span class="sm:hidden">فاتورة</span>
        </button>
      </div>
    `;

    updateHeaderClock();
    updateDynamicHeaderUI();
  }

  function updateHeaderClock() {
    const dateEl = document.getElementById("headerLiveDate");
    const clockEl = document.getElementById("headerLiveClock");
    if (!dateEl && !clockEl) return;

    const now = new Date();
    if (dateEl) {
      try {
        const greg = now.toLocaleDateString("ar-EG", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric"
        });
        dateEl.textContent = greg;
      } catch (e) {
        dateEl.textContent = now.toLocaleDateString();
      }
    }
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString("ar-EG", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
      });
    }
  }

  function updateDynamicHeaderUI() {
    const store = currentSettings.store || {};
    const shift = currentSettings.shift || {};

    const headerStoreName = document.getElementById("headerStoreName");
    const sidebarStoreName = document.getElementById("sidebarStoreName");
    const sidebarStoreSubtitle = document.getElementById("sidebarStoreSubtitle");
    const sidebarCashierName = document.getElementById("sidebarCashierName");
    const sidebarCashierRole = document.getElementById("sidebarCashierRole");
    const sidebarCashierAvatar = document.getElementById("sidebarCashierAvatar");

    if (headerStoreName) headerStoreName.textContent = store.storeName || "سنترال تيك - الفرع الرئيسي";
    if (sidebarStoreName) sidebarStoreName.textContent = (store.storeName || "سنترال تيك").split("-")[0].trim();
    if (sidebarStoreSubtitle) sidebarStoreSubtitle.textContent = store.storeSubtitle || "للاتصالات والإلكترونيات";
    if (sidebarCashierName) sidebarCashierName.textContent = shift.cashierName || "أدمن الوردية";
    if (sidebarCashierRole) sidebarCashierRole.textContent = shift.cashierRole || "إدارة عامة";
    if (sidebarCashierAvatar) sidebarCashierAvatar.textContent = getInitials(shift.cashierName || "أدمن");

    const pill = document.getElementById("headerDrawerPill");
    const dot = document.getElementById("headerDrawerDot");
    const label = document.getElementById("headerDrawerLabel");
    if (pill && dot && label) {
      const periodName = PERIOD_LABELS[shift.period] || "الوردية الصباحية";
      if (shift.isOpen !== false) {
        pill.className = "hidden xl:flex items-center gap-2 px-3 py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary/20";
        dot.className = "w-2 h-2 rounded-full bg-tertiary animate-pulse";
        label.textContent = `${periodName} - الدرج مفتوح`;
      } else {
        pill.className = "hidden xl:flex items-center gap-2 px-3 py-1 rounded-full bg-error-container text-on-error-container border border-error/20";
        dot.className = "w-2 h-2 rounded-full bg-error";
        label.textContent = `${periodName} - الدرج مغلق`;
      }
    }
  }

  function injectGlobalContainers() {
    if (!document.getElementById("mobile-sidebar-backdrop")) {
      const backdrop = document.createElement("div");
      backdrop.id = "mobile-sidebar-backdrop";
      backdrop.className = "fixed inset-0 bg-navy-dark/60 backdrop-blur-sm z-40 hidden lg:hidden";
      backdrop.onclick = () => toggleMobileSidebar(false);
      document.body.appendChild(backdrop);
    }

    if (!document.getElementById("globalToast")) {
      const toast = document.createElement("div");
      toast.id = "globalToast";
      toast.className =
        "fixed bottom-6 left-6 z-[70] transform translate-y-24 opacity-0 transition-all duration-300 pointer-events-none flex items-center gap-3 px-4 py-3 rounded-xl bg-navy-dark text-white shadow-2xl border border-slate-700 max-w-sm";
      toast.innerHTML = `
        <span id="globalToastIcon" class="material-symbols-outlined text-sky-accent text-2xl">check_circle</span>
        <div class="flex flex-col min-w-0">
          <span id="globalToastTitle" class="font-title-md text-white truncate">تم بنجاح</span>
          <span id="globalToastSubtitle" class="font-label-md text-slate-300 truncate"></span>
        </div>
      `;
      document.body.appendChild(toast);
    }

    if (!document.getElementById("globalDrawerModal")) {
      const drawerModal = document.createElement("div");
      drawerModal.id = "globalDrawerModal";
      drawerModal.className = "fixed inset-0 z-[60] hidden bg-navy-dark/60 backdrop-blur-sm flex items-center justify-center p-4";
      drawerModal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden modal-animate border border-slate-200">
          <div class="bg-navy-dark text-white px-6 py-4 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-sky-accent text-2xl">point_of_sale</span>
              <div>
                <h3 class="font-title-lg font-bold">إدارة الدرج والوردية النشطة</h3>
                <p class="font-label-md text-slate-300">تبديل سريع لحالة الدرج والكاشير المسؤول</p>
              </div>
            </div>
            <button type="button" onclick="AppLayout.closeModal('globalDrawerModal')" class="text-slate-300 hover:text-white p-1">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <form id="globalDrawerForm" class="p-6 space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <button type="button" id="drawerStateOpenBtn" onclick="AppLayout.setModalDrawerState(true)" class="py-2.5 px-3 rounded-xl border-2 font-label-lg flex items-center justify-center gap-2 transition-all">
                <span class="material-symbols-outlined text-lg">lock_open</span>
                <span>الدرج مفتوح</span>
              </button>
              <button type="button" id="drawerStateCloseBtn" onclick="AppLayout.setModalDrawerState(false)" class="py-2.5 px-3 rounded-xl border-2 font-label-lg flex items-center justify-center gap-2 transition-all">
                <span class="material-symbols-outlined text-lg">lock</span>
                <span>إغلاق الدرج</span>
              </button>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-label-md text-on-surface-variant mb-1">فترة الوردية</label>
                <select id="globalShiftPeriod" class="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-outline-variant/40 font-body-md focus:ring-2 focus:ring-primary">
                  <option value="morning">الوردية الصباحية</option>
                  <option value="evening">الوردية المسائية</option>
                  <option value="night">الوردية الليلية</option>
                </select>
              </div>
              <div>
                <label class="block font-label-md text-on-surface-variant mb-1">الرصيد الافتتاحي للدرج (ج.م)</label>
                <input type="number" step="0.5" min="0" id="globalOpeningBalance" class="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-outline-variant/40 font-numeric-table text-left focus:ring-2 focus:ring-primary" dir="ltr" placeholder="0.00" />
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block font-label-md text-on-surface-variant mb-1">الكاشير المسؤول</label>
                <select id="globalCashierSelect" class="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-outline-variant/40 font-body-md focus:ring-2 focus:ring-primary"></select>
              </div>
              <div>
                <label class="block font-label-md text-on-surface-variant mb-1">اسم المحل / الفرع</label>
                <input type="text" id="globalStoreNameInput" class="w-full h-10 px-3 rounded-lg bg-surface-container-low border border-outline-variant/40 font-body-md focus:ring-2 focus:ring-primary" placeholder="سنترال تيك - الفرع الرئيسي" />
              </div>
            </div>
            <div class="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button type="button" onclick="AppLayout.closeModal('globalDrawerModal')" class="px-4 py-2 rounded-lg bg-surface-container-low text-on-surface hover:bg-surface-container font-label-lg">إلغاء</button>
              <button type="submit" class="px-5 py-2 rounded-lg bg-primary text-white hover:bg-primary-container font-label-lg shadow-sm flex items-center gap-1.5">
                <span class="material-symbols-outlined text-lg">save</span>
                <span>حفظ ومزامنة</span>
              </button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(drawerModal);
      document.getElementById("globalDrawerForm").addEventListener("submit", handleSaveDrawerModal);
    }

    if (!document.getElementById("globalPosModal")) {
      const posModal = document.createElement("div");
      posModal.id = "globalPosModal";
      posModal.className = "fixed inset-0 z-[60] hidden bg-navy-dark/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4";
      posModal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden modal-animate border border-slate-200">
          <div class="bg-navy-dark text-white px-6 py-4 flex items-center justify-between shrink-0">
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-sky-accent text-2xl">point_of_sale</span>
              <div>
                <h3 class="font-title-lg font-bold">كاشير الفاتورة السريعة (F1)</h3>
                <p class="font-label-md text-slate-300">بيع فوري من جميع المخازن والهواتف المتاحة وخصم تلقائي</p>
              </div>
            </div>
            <button type="button" onclick="AppLayout.closeModal('globalPosModal')" class="text-slate-300 hover:text-white p-1">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5">
            <!-- Catalog Search Side -->
            <div class="lg:col-span-7 flex flex-col gap-3">
              <div class="relative">
                <span class="material-symbols-outlined absolute right-3 top-2.5 text-outline text-xl">search</span>
                <input type="text" id="posSearchInput" oninput="AppLayout.renderPosCatalog()" placeholder="ابحث باسم الصنف، الماركة، الباركود، أو رقم IMEI..." class="w-full h-11 pr-10 pl-4 rounded-xl bg-surface-container-low border border-outline-variant/50 font-body-md focus:bg-white focus:ring-2 focus:ring-primary" />
              </div>
              <div id="posCatalogList" class="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[340px] overflow-y-auto bg-slate-50/50"></div>
            </div>

            <!-- Cart Side -->
            <div class="lg:col-span-5 flex flex-col justify-between bg-surface-container-low rounded-xl p-4 border border-slate-200 gap-4">
              <div class="flex flex-col gap-3">
                <div class="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span class="font-title-md font-bold text-on-surface">سلة الفاتورة</span>
                  <span id="posCartCount" class="px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-label-md font-bold">0 أصناف</span>
                </div>
                <div id="posCartItems" class="space-y-2 max-h-[190px] overflow-y-auto"></div>
              </div>

              <div class="space-y-3 border-t border-slate-200 pt-3">
                <div class="grid grid-cols-2 gap-2">
                  <input type="text" id="posBuyerName" placeholder="اسم العميل (اختياري)" class="h-9 px-3 rounded-lg bg-white border border-slate-200 text-body-sm focus:ring-2 focus:ring-primary" />
                  <input type="tel" id="posBuyerPhone" placeholder="رقم الهاتف (اختياري)" class="h-9 px-3 rounded-lg bg-white border border-slate-200 text-body-sm font-numeric-table focus:ring-2 focus:ring-primary" dir="ltr" />
                </div>
                <div class="grid grid-cols-3 gap-1.5 text-center">
                  <label class="flex items-center justify-center gap-1 p-2 rounded-lg bg-white border border-slate-200 cursor-pointer text-body-sm font-semibold">
                    <input type="radio" name="posPaymentMethod" value="نقدي (كاش)" checked class="accent-primary" />
                    <span>كاش</span>
                  </label>
                  <label class="flex items-center justify-center gap-1 p-2 rounded-lg bg-white border border-slate-200 cursor-pointer text-body-sm font-semibold">
                    <input type="radio" name="posPaymentMethod" value="فودافون كاش" class="accent-primary" />
                    <span>كاش محفظة</span>
                  </label>
                  <label class="flex items-center justify-center gap-1 p-2 rounded-lg bg-white border border-slate-200 cursor-pointer text-body-sm font-semibold">
                    <input type="radio" name="posPaymentMethod" value="فيزا / شبكة" class="accent-primary" />
                    <span>فيزا</span>
                  </label>
                </div>
                <div class="flex items-center justify-between bg-navy-dark text-white px-4 py-3 rounded-xl">
                  <span class="font-title-md">الإجمالي المطلوب</span>
                  <span id="posCartTotal" class="font-display-lg text-headline-md text-sky-accent font-numeric-table">0.00 ج.م</span>
                </div>
                <button type="button" id="posCheckoutBtn" onclick="AppLayout.submitPosCheckout()" class="w-full py-2.5 rounded-xl bg-primary hover:bg-primary-container text-white font-label-lg shadow-md flex items-center justify-center gap-2 transition-colors">
                  <span class="material-symbols-outlined text-xl">receipt_long</span>
                  <span>إتمام البيع وطباعة الفاتورة</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(posModal);
    }

    if (!document.getElementById("globalPinModal")) {
      const pinModal = document.createElement("div");
      pinModal.id = "globalPinModal";
      pinModal.className = "fixed inset-0 z-[65] hidden bg-navy-dark/65 backdrop-blur-sm flex items-center justify-center p-4";
      pinModal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden modal-animate border border-slate-200">
          <div class="bg-navy-dark text-white px-5 py-4 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-sky-accent">shield_lock</span>
              <h3 class="font-title-md font-bold">مطلوب رقم PIN الإدارة</h3>
            </div>
            <button type="button" onclick="AppLayout.cancelPinModal()" class="text-slate-300 hover:text-white">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <form id="globalPinForm" class="p-5 space-y-4">
            <p class="font-body-md text-on-surface-variant">هذه العملية محمية بسياسة الأمان. أدخل رمز الإدارة السري للمتابعة:</p>
            <input type="password" id="globalPinVerifyInput" maxlength="6" class="w-full h-11 px-4 rounded-lg bg-surface-container-low border border-outline-variant/60 text-center tracking-widest font-numeric-table text-title-lg focus:ring-2 focus:ring-primary" placeholder="••••" required />
            <div class="flex items-center justify-end gap-2">
              <button type="button" onclick="AppLayout.cancelPinModal()" class="px-4 py-2 rounded-lg bg-surface-container-low text-on-surface font-label-lg">إلغاء</button>
              <button type="submit" class="px-5 py-2 rounded-lg bg-primary text-white hover:bg-primary-container font-label-lg">تأكيد</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(pinModal);
      document.getElementById("globalPinForm").addEventListener("submit", handleVerifyPinSubmit);
    }

    if (!document.getElementById("globalFirebaseModal")) {
      const fbModal = document.createElement("div");
      fbModal.id = "globalFirebaseModal";
      fbModal.className = "fixed inset-0 z-[65] hidden bg-navy-dark/65 backdrop-blur-sm flex items-center justify-center p-4";
      fbModal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden modal-animate border border-slate-200">
          <div class="bg-navy-dark text-white px-5 py-4 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-sky-accent">cloud_sync</span>
              <h3 class="font-title-md font-bold">حالة الربط مع Firebase (mmmm-cba14)</h3>
            </div>
            <button type="button" onclick="AppLayout.closeModal('globalFirebaseModal')" class="text-slate-300 hover:text-white">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <div class="p-5 space-y-4">
            <div id="fbDiagBox" class="p-3.5 rounded-xl bg-surface-container-low border border-slate-200 text-body-md font-semibold"></div>
            <div id="fbSetupSteps" class="hidden space-y-2 text-body-sm text-on-surface-variant bg-slate-50 p-4 rounded-xl border border-slate-200">
              <p class="font-bold text-on-surface">لتفعيل المزامنة السحابية على مشروعك:</p>
              <ol class="list-decimal list-inside space-y-1.5 leading-relaxed">
                <li>افتح <a href="https://console.firebase.google.com/project/mmmm-cba14/firestore" target="_blank" rel="noopener noreferrer" class="text-primary underline font-bold">لوحة Cloud Firestore لمشروع mmmm-cba14</a> واضغط <strong>Create database</strong>.</li>
                <li>اختر <strong>Start in test mode</strong> (أو انسخ القواعد من ملف <code>firestore.rules</code> الموجود بمجلد المشروع).</li>
                <li>اضغط زر <strong>إعادة فحص الاتصال</strong> بالأسفل وسيتم الربط فوراً.</li>
              </ol>
            </div>
            <div class="flex items-center justify-end gap-2 pt-2">
              <button type="button" onclick="AppLayout.closeModal('globalFirebaseModal')" class="px-4 py-2 rounded-lg bg-surface-container-low text-on-surface font-label-lg">إغلاق</button>
              <button type="button" onclick="AppLayout.retryFirebaseConnection()" class="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary-container font-label-lg flex items-center gap-1.5">
                <span class="material-symbols-outlined text-base">refresh</span>
                <span>إعادة فحص الاتصال</span>
              </button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(fbModal);
    }
  }

  let modalDrawerIsOpen = true;

  function setModalDrawerState(isOpen) {
    modalDrawerIsOpen = isOpen;
    const openBtn = document.getElementById("drawerStateOpenBtn");
    const closeBtn = document.getElementById("drawerStateCloseBtn");
    if (!openBtn || !closeBtn) return;

    if (isOpen) {
      openBtn.className = "py-2.5 px-3 rounded-xl border-2 border-tertiary bg-tertiary-fixed text-on-tertiary-fixed font-label-lg flex items-center justify-center gap-2";
      closeBtn.className = "py-2.5 px-3 rounded-xl border-2 border-slate-200 bg-white text-on-surface-variant font-label-lg flex items-center justify-center gap-2";
    } else {
      closeBtn.className = "py-2.5 px-3 rounded-xl border-2 border-error bg-error-container text-on-error-container font-label-lg flex items-center justify-center gap-2";
      openBtn.className = "py-2.5 px-3 rounded-xl border-2 border-slate-200 bg-white text-on-surface-variant font-label-lg flex items-center justify-center gap-2";
    }
  }

  function openDrawerModal() {
    const shift = currentSettings.shift || {};
    const store = currentSettings.store || {};
    setModalDrawerState(shift.isOpen !== false);
    document.getElementById("globalShiftPeriod").value = shift.period || "morning";
    document.getElementById("globalOpeningBalance").value = shift.openingBalance || 0;
    document.getElementById("globalStoreNameInput").value = store.storeName || "سنترال تيك - الفرع الرئيسي";

    const select = document.getElementById("globalCashierSelect");
    const options = [{ name: "أدمن الوردية", role: "إدارة عامة" }, ...staffList];
    const uniqueNames = new Set();
    select.innerHTML = "";
    options.forEach((person) => {
      if (!person.name || uniqueNames.has(person.name)) return;
      uniqueNames.add(person.name);
      const opt = document.createElement("option");
      opt.value = JSON.stringify({ name: person.name, role: person.role || "كاشير" });
      opt.textContent = `${person.name} (${person.role || "كاشير"})`;
      if (person.name === shift.cashierName) opt.selected = true;
      select.appendChild(opt);
    });

    openModal("globalDrawerModal");
  }

  async function handleSaveDrawerModal(e) {
    e.preventDefault();
    try {
      const period = document.getElementById("globalShiftPeriod").value;
      const openingBalance = parseFloat(document.getElementById("globalOpeningBalance").value) || 0;
      const storeName = document.getElementById("globalStoreNameInput").value.trim() || "سنترال تيك - الفرع الرئيسي";
      const cashierRaw = document.getElementById("globalCashierSelect").value;
      let cashier = { name: "أدمن الوردية", role: "إدارة عامة" };
      try {
        cashier = JSON.parse(cashierRaw);
      } catch (err) {}

      await window.PosDB.saveSetting("shift", {
        isOpen: modalDrawerIsOpen,
        period,
        openingBalance,
        cashierName: cashier.name,
        cashierRole: cashier.role,
        openedAt: currentSettings.shift.openedAt || window.PosDB.formatTimeAr()
      });
      await window.PosDB.saveSetting("store", { storeName });

      closeModal("globalDrawerModal");
      showToast("تم تحديث حالة الدرج والوردية", modalDrawerIsOpen ? "الدرج مفتوح وجاهز" : "تم إغلاق الدرج");
    } catch (err) {
      showToast("تعذر حفظ الإعدادات", err.message, true);
    }
  }

  function ensurePosListeners() {
    if (posCatalogLoaded || !window.PosDB) return;
    posCatalogLoaded = true;
    window.PosDB.subscribeAllInventory((items) => {
      allInventoryCache = items;
      renderPosCatalog();
    });
    window.PosDB.subscribePhones((phones) => {
      allPhonesCache = phones;
      renderPosCatalog();
    });
  }

  function openPosModal() {
    ensurePosListeners();
    posCart = [];
    document.getElementById("posSearchInput").value = "";
    document.getElementById("posBuyerName").value = "";
    document.getElementById("posBuyerPhone").value = "";
    renderPosCatalog();
    renderPosCart();
    openModal("globalPosModal");
    setTimeout(() => document.getElementById("posSearchInput").focus(), 100);
  }

  function renderPosCatalog() {
    const container = document.getElementById("posCatalogList");
    if (!container) return;
    const query = (document.getElementById("posSearchInput")?.value || "").trim().toLowerCase();

    const sectionLabels = {
      chargers: "الشواحن والوصلات",
      headphones: "السماعات",
      speakers: "الصبات والمكبرات"
    };

    const invItems = allInventoryCache
      .filter((i) => (Number(i.qty) || 0) > 0)
      .map((i) => ({
        kind: "inventory",
        id: i.id,
        title: `${i.brand ? i.brand + " - " : ""}${i.name}`,
        subtitle: `${sectionLabels[i.section] || i.section}${i.barcode ? " • " + i.barcode : ""}`,
        stock: Number(i.qty) || 0,
        price: Number(i.salePrice) || 0
      }));

    const phoneItems = allPhonesCache
      .filter((p) => !p.isSold)
      .map((p) => ({
        kind: "phone",
        id: p.id,
        title: `${p.brand} ${p.model}`,
        subtitle: `هاتف • IMEI: ${p.imei1} • ${p.specs || ""}`,
        stock: 1,
        price: Number(p.sellingPrice) || 0
      }));

    let combined = [...invItems, ...phoneItems];
    if (query) {
      combined = combined.filter(
        (item) =>
          item.title.toLowerCase().includes(query) ||
          item.subtitle.toLowerCase().includes(query)
      );
    }

    if (combined.length === 0) {
      container.innerHTML = `
        <div class="py-12 px-4 text-center text-on-surface-variant">
          <span class="material-symbols-outlined text-4xl text-outline-variant mb-2">inventory_2</span>
          <p class="font-body-md font-semibold">لا توجد منتجات متاحة في المخزن مطابقة للبحث</p>
          <p class="font-body-sm text-outline mt-1">أضف بضاعة أو هواتف في أقسام المخزن لتظهر هنا تلقائياً.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = combined
      .slice(0, 40)
      .map((item) => `
        <div class="p-3 flex items-center justify-between gap-3 hover:bg-white transition-colors">
          <div class="min-w-0">
            <div class="font-title-md text-on-surface truncate">${escapeHtml(item.title)}</div>
            <div class="font-label-md text-on-surface-variant truncate">${escapeHtml(item.subtitle)} • متاح: <strong class="text-tertiary">${item.stock}</strong></div>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <span class="font-numeric-table font-bold text-primary">${window.PosDB.formatMoney(item.price)} ج.م</span>
            <button type="button" onclick="AppLayout.addToPosCart('${item.kind}', '${item.id}')" class="px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-primary-container font-label-md flex items-center gap-1 shadow-sm">
              <span class="material-symbols-outlined text-base">add</span>
              <span>إضافة</span>
            </button>
          </div>
        </div>
      `)
      .join("");
  }

  function addToPosCart(kind, id) {
    let source = null;
    if (kind === "phone") {
      const p = allPhonesCache.find((x) => x.id === id);
      if (!p || p.isSold) return;
      source = { kind: "phone", id: p.id, title: `${p.brand} ${p.model} (${p.imei1})`, unitPrice: Number(p.sellingPrice) || 0, maxQty: 1 };
    } else {
      const i = allInventoryCache.find((x) => x.id === id);
      if (!i || (Number(i.qty) || 0) <= 0) return;
      source = { kind: "inventory", id: i.id, title: `${i.brand ? i.brand + " - " : ""}${i.name}`, unitPrice: Number(i.salePrice) || 0, maxQty: Number(i.qty) || 1 };
    }

    const existing = posCart.find((c) => c.kind === kind && c.id === id);
    if (existing) {
      if (existing.qty >= source.maxQty) {
        showToast("تم بلوغ الحد الأقصى بالمخزن", source.title, true);
        return;
      }
      existing.qty += 1;
    } else {
      posCart.push({ ...source, qty: 1 });
    }
    renderPosCart();
  }

  function updatePosCartQty(index, delta) {
    const line = posCart[index];
    if (!line) return;
    const next = line.qty + delta;
    if (next <= 0) {
      posCart.splice(index, 1);
    } else if (next <= line.maxQty) {
      line.qty = next;
    }
    renderPosCart();
  }

  function renderPosCart() {
    const container = document.getElementById("posCartItems");
    const countEl = document.getElementById("posCartCount");
    const totalEl = document.getElementById("posCartTotal");
    if (!container) return;

    const total = posCart.reduce((acc, c) => acc + c.unitPrice * c.qty, 0);
    if (countEl) countEl.textContent = `${posCart.length} أصناف`;
    if (totalEl) totalEl.textContent = `${window.PosDB.formatMoney(total)} ج.م`;

    if (posCart.length === 0) {
      container.innerHTML = `<div class="py-8 text-center text-outline font-body-sm">اختر الأصناف من القائمة لإضافتها للفاتورة</div>`;
      return;
    }

    container.innerHTML = posCart
      .map((line, idx) => `
        <div class="bg-white p-2.5 rounded-lg border border-slate-200 flex items-center justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="font-body-md font-bold text-on-surface truncate">${escapeHtml(line.title)}</div>
            <div class="font-numeric-table text-label-md text-primary">${window.PosDB.formatMoney(line.unitPrice)} × ${line.qty}</div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button type="button" onclick="AppLayout.updatePosCartQty(${idx}, -1)" class="w-7 h-7 rounded bg-surface-container-low hover:bg-surface-container text-on-surface font-bold">-</button>
            <span class="w-6 text-center font-numeric-table font-bold text-body-md">${line.qty}</span>
            <button type="button" onclick="AppLayout.updatePosCartQty(${idx}, 1)" class="w-7 h-7 rounded bg-surface-container-low hover:bg-surface-container text-on-surface font-bold">+</button>
          </div>
        </div>
      `)
      .join("");
  }

  async function submitPosCheckout() {
    if (posCart.length === 0) {
      showToast("الفاتورة فارغة", "أضف صنفاً واحداً على الأقل", true);
      return;
    }
    const btn = document.getElementById("posCheckoutBtn");
    btn.disabled = true;
    try {
      const paymentMethod = document.querySelector('input[name="posPaymentMethod"]:checked')?.value || "نقدي (كاش)";
      const customerName = document.getElementById("posBuyerName").value.trim();
      const customerPhone = document.getElementById("posBuyerPhone").value.trim();
      const staffName = (currentSettings.shift && currentSettings.shift.cashierName) || "الكاشير";
      const itemsCopy = posCart.map((c) => ({ ...c }));

      const res = await window.PosDB.checkoutPosCart({
        items: itemsCopy,
        paymentMethod,
        customerName,
        customerPhone,
        staffName
      });

      closeModal("globalPosModal");
      showToast("تم إتمام الفاتورة وتحديث المخزن والخزينة", `الإجمالي: ${window.PosDB.formatMoney(res.grandTotal)} ج.م`);

      const storeName = (currentSettings.store && currentSettings.store.storeName) || "سنترال تيك";
      const rowsHtml = itemsCopy
        .map(
          (i) => `
          <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #ddd;">
            <span>${escapeHtml(i.title)} (×${i.qty})</span>
            <strong>${window.PosDB.formatMoney(i.unitPrice * i.qty)} ج.م</strong>
          </div>
        `
        )
        .join("");

      openPrintWindow(
        "فاتورة مبيعات",
        `
        <div style="text-align:center;border-bottom:2px solid #0F172A;padding-bottom:8px;margin-bottom:10px;">
          <h2 style="margin:0;font-size:18px;">${escapeHtml(storeName)}</h2>
          <p style="margin:2px 0;font-size:12px;color:#555;">إيصال مبيعات فوري • ${res.dateStr} ${res.timeStr}</p>
        </div>
        ${customerName ? `<p style="font-size:12px;margin:4px 0;">العميل: <strong>${escapeHtml(customerName)}</strong> ${customerPhone ? "(" + escapeHtml(customerPhone) + ")" : ""}</p>` : ""}
        <div style="margin:10px 0;">${rowsHtml}</div>
        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:bold;padding-top:8px;border-top:2px solid #0F172A;">
          <span>الإجمالي (${escapeHtml(paymentMethod)}):</span>
          <span>${window.PosDB.formatMoney(res.grandTotal)} ج.م</span>
        </div>
        <p style="text-align:center;font-size:11px;color:#666;margin-top:14px;">شكراً لتعاملكم معنا</p>
      `
      );
    } catch (err) {
      showToast("تعذر إتمام الفاتورة", err.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  function openPrintWindow(title, bodyHtml) {
    const win = window.open("", "_blank", "width=460,height=640");
    if (!win) return;
    win.document.write(`
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(title)}</title>
          <style>
            body { font-family: 'Cairo', Tahoma, Arial, sans-serif; padding: 20px; direction: rtl; color: #0F172A; }
          </style>
        </head>
        <body>
          ${bodyHtml}
          <script>window.onload = function(){ window.print(); };<\/script>
        </body>
      </html>
    `);
    win.document.close();
  }

  function toggleMobileSidebar(open) {
    const sidebar = document.getElementById("app-sidebar");
    const backdrop = document.getElementById("mobile-sidebar-backdrop");
    if (!sidebar) return;
    if (open) {
      sidebar.classList.remove("sidebar-closed");
      sidebar.classList.add("sidebar-open");
      backdrop?.classList.remove("hidden");
    } else {
      sidebar.classList.add("sidebar-closed");
      sidebar.classList.remove("sidebar-open");
      backdrop?.classList.add("hidden");
    }
  }

  function openModal(id) {
    document.getElementById(id)?.classList.remove("hidden");
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.add("hidden");
  }

  function showToast(title, subtitle = "", isError = false) {
    const toast = document.getElementById("globalToast");
    const iconEl = document.getElementById("globalToastIcon");
    const titleEl = document.getElementById("globalToastTitle");
    const subEl = document.getElementById("globalToastSubtitle");
    if (!toast) return;

    titleEl.textContent = title;
    subEl.textContent = subtitle || "";
    subEl.style.display = subtitle ? "block" : "none";

    if (isError) {
      iconEl.textContent = "error";
      iconEl.className = "material-symbols-outlined text-red-400 text-2xl";
    } else {
      iconEl.textContent = "check_circle";
      iconEl.className = "material-symbols-outlined text-emerald-400 text-2xl";
    }

    toast.classList.remove("translate-y-24", "opacity-0");
    toast.classList.add("translate-y-0", "opacity-100");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("translate-y-0", "opacity-100");
      toast.classList.add("translate-y-24", "opacity-0");
    }, 3400);
  }

  // Security PIN Verification Guard
  function requirePinIfProtected(callback) {
    const sec = currentSettings.security || {};
    const hasPin = Boolean(sec.adminPin && sec.adminPin.trim().length > 0);
    const isProtected = sec.deletePolicy && sec.deletePolicy !== "open";

    if (hasPin && isProtected) {
      pendingPinCallback = callback;
      const input = document.getElementById("globalPinVerifyInput");
      if (input) input.value = "";
      openModal("globalPinModal");
      setTimeout(() => input?.focus(), 80);
    } else {
      callback();
    }
  }

  function handleVerifyPinSubmit(e) {
    e.preventDefault();
    const entered = document.getElementById("globalPinVerifyInput").value.trim();
    const expected = (currentSettings.security && currentSettings.security.adminPin) || "";
    if (entered === expected) {
      const cb = pendingPinCallback;
      pendingPinCallback = null;
      closeModal("globalPinModal");
      if (typeof cb === "function") cb();
    } else {
      showToast("رمز PIN غير صحيح", "يرجى المحاولة مرة أخرى", true);
    }
  }

  function cancelPinModal() {
    pendingPinCallback = null;
    closeModal("globalPinModal");
  }

  function showFirebaseInfo() {
    if (!window.PosDB) return;
    const status = window.PosDB.getStatus ? window.PosDB.getStatus() : lastFirebaseStatus;
    const box = document.getElementById("fbDiagBox");
    const steps = document.getElementById("fbSetupSteps");
    if (box && steps && status) {
      if (status.state === "connected") {
        box.className = "p-3.5 rounded-xl bg-tertiary-fixed text-on-tertiary-fixed-variant border border-tertiary/20 text-body-md font-bold";
        box.textContent = "متصل بنجاح بقاعدة بيانات Cloud Firestore (mmmm-cba14) — المزامنة الفورية نشطة.";
        steps.classList.add("hidden");
      } else {
        box.className = "p-3.5 rounded-xl bg-warning-container text-on-warning-container border border-warning/30 text-body-md font-bold";
        box.textContent = status.errorMessage || "وضع الحفظ المحلي المؤقت نشط الآن — فعّل Cloud Firestore للمزامنة السحابية.";
        steps.classList.remove("hidden");
      }
    }
    openModal("globalFirebaseModal");
  }

  async function retryFirebaseConnection() {
    if (!window.PosDB || !window.PosDB.recheckConnection) return;
    const ok = await window.PosDB.recheckConnection();
    if (ok) {
      closeModal("globalFirebaseModal");
      showToast("تم الاتصال بـ Firebase بنجاح!", "جاري تحديث الصفحة لتفعيل المزامنة السحابية");
      setTimeout(() => window.location.reload(), 900);
    } else {
      showFirebaseInfo();
      showToast("لا تزال قاعدة Firestore غير مفعلة أو غير متاحة", "", true);
    }
  }

  let lastFirebaseStatus = null;

  function init(pageId) {
    currentPageId = pageId;
    renderSidebar(pageId);
    renderHeader();
    injectGlobalContainers();

    setInterval(updateHeaderClock, 1000);

    window.addEventListener("keydown", (e) => {
      if (e.key === "F1") {
        e.preventDefault();
        openPosModal();
      } else if (e.key === "Escape") {
        closeModal("globalDrawerModal");
        closeModal("globalPosModal");
        closeModal("globalFirebaseModal");
        cancelPinModal();
      }
    });

    if (window.PosDB) {
      window.PosDB.onStatusChange((status) => {
        lastFirebaseStatus = status;
        const dot = document.getElementById("firebaseStatusDot");
        const text = document.getElementById("firebaseStatusText");
        if (!dot || !text) return;

        if (status.state === "connected") {
          dot.className = "w-2 h-2 rounded-full bg-emerald-500";
          text.textContent = "متصل بـ Firebase";
        } else if (status.state === "connecting") {
          dot.className = "w-2 h-2 rounded-full bg-amber-500 animate-pulse";
          text.textContent = "جاري المزامنة...";
        } else if (status.state === "local_fallback") {
          dot.className = "w-2 h-2 rounded-full bg-amber-500";
          text.textContent = "حفظ محلي (فعّل Firestore)";
        } else {
          dot.className = "w-2 h-2 rounded-full bg-red-500";
          text.textContent = "تنبيه Firebase";
        }
      });

      window.PosDB.subscribeSettings((settings) => {
        currentSettings = settings;
        updateDynamicHeaderUI();
        settingsListeners.forEach((fn) => fn(settings));
      });

      window.PosDB.subscribeStaff((list) => {
        staffList = list;
      });
    }
  }

  function onSettingsUpdate(fn) {
    settingsListeners.push(fn);
    if (currentSettings) fn(currentSettings);
  }

  function getSettings() {
    return currentSettings;
  }

  function getActiveStaffName() {
    return (currentSettings.shift && currentSettings.shift.cashierName) || "أدمن الوردية";
  }

  window.AppLayout = {
    init,
    escapeHtml,
    toggleMobileSidebar,
    openModal,
    closeModal,
    showToast,
    openDrawerModal,
    setModalDrawerState,
    openPosModal,
    addToPosCart,
    updatePosCartQty,
    renderPosCatalog,
    submitPosCheckout,
    requirePinIfProtected,
    cancelPinModal,
    showFirebaseInfo,
    retryFirebaseConnection,
    openPrintWindow,
    onSettingsUpdate,
    getSettings,
    getActiveStaffName
  };
})();
