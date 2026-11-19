// Barcode & QR Scanner Service for POS Inventory Intake & Quick Sales
// Fully Automated: Stock-In (دخول بضاعة + خصم فلوس التكلفة) & Stock-Out (خروج بضاعة + زيادة فلوس البيع)
// Dedicated Barcode Generator & Thermal Label Print Studio for unbarcoded products
(function () {
  let audioCtx = null;
  let soundEnabled = localStorage.getItem("pos_barcode_sound_enabled") !== "false";
  let html5QrScanner = null;
  let currentCameraId = null;
  let availableCameras = [];
  let isTorchOn = false;
  let targetInputForCamera = null;
  let targetInputForLabelStudio = null;

  // Keystroke scanner detector state
  let keyBuffer = "";
  let lastKeyTime = 0;
  const SCANNER_CHAR_INTERVAL_MS = 120;
  const MIN_BARCODE_LENGTH = 3;

  // Automated Mode Configuration
  // "sale" = خروج بضاعة (بيع مباشر + خصم المخزن + إضافة الفلوس للدرج)
  // "intake" = دخول بضاعة (توريد مباشر + زيادة المخزن + خصم الفلوس من الدرج)
  let autoMode = localStorage.getItem("pos_barcode_auto_mode") || "sale";
  let autoBatchQty = parseInt(localStorage.getItem("pos_barcode_auto_batch_qty"), 10) || 1;
  let autoDeductDrawer = localStorage.getItem("pos_barcode_auto_deduct_drawer") !== "false";
  let autoAddDrawer = localStorage.getItem("pos_barcode_auto_add_drawer") !== "false";

  // Undo memory state
  let lastAction = null;
  let bannerTimer = null;

  // In-memory caches for fast barcode lookups
  let inventoryCache = [];
  let phonesCache = [];
  let sessionActivityHistory = [];

  // =========================================================================
  // 1. Audio Synthesizer (Zero-dependency Web Audio POS Beeps & Cash Register)
  // =========================================================================
  function getAudioContext() {
    if (!audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass();
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playScannerBeep(type = "success") {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      if (type === "sale") {
        // Bright retail POS cash-register chime (C6 then G6)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(1046.5, now);
        gain1.gain.setValueAtTime(0.25, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc1.start(now);
        osc1.stop(now + 0.12);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(1567.98, now + 0.08);
        gain2.gain.setValueAtTime(0.28, now + 0.08);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc2.start(now + 0.08);
        osc2.stop(now + 0.28);

      } else if (type === "restock" || type === "intake") {
        // Warm positive double tone (G5 then C6)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(783.99, now);
        osc.frequency.setValueAtTime(1046.5, now + 0.07);
        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);

      } else if (type === "undo") {
        // Soft descending tone
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(360, now + 0.15);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);

      } else if (type === "error") {
        // Low double buzz for warning / out of stock
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.setValueAtTime(200, now + 0.09);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);

      } else {
        // Default standard beep
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(1850, now);
        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      }
    } catch (e) {
      console.warn("AudioContext error:", e);
    }
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    localStorage.setItem("pos_barcode_sound_enabled", soundEnabled ? "true" : "false");
    updateSoundUI();
    if (soundEnabled) playScannerBeep("success");
    return soundEnabled;
  }

  function updateSoundUI() {
    const btn = document.getElementById("barcodeSoundToggleBtn");
    const icon = document.getElementById("barcodeSoundIcon");
    const label = document.getElementById("barcodeSoundLabel");
    if (icon) {
      icon.textContent = soundEnabled ? "volume_up" : "volume_off";
    }
    if (label) {
      label.textContent = soundEnabled ? "الصوت مفعّل" : "الصوت مكتوم";
    }
    if (btn) {
      if (soundEnabled) {
        btn.classList.add("text-emerald-700", "bg-emerald-50", "border-emerald-300");
        btn.classList.remove("text-slate-500", "bg-slate-100", "border-slate-300");
      } else {
        btn.classList.remove("text-emerald-700", "bg-emerald-50", "border-emerald-300");
        btn.classList.add("text-slate-500", "bg-slate-100", "border-slate-300");
      }
    }
  }

  // =========================================================================
  // 2. Mode Switching: Sale (خروج بضاعة) vs Intake (دخول بضاعة)
  // =========================================================================
  function setMode(newMode) {
    if (newMode !== "sale" && newMode !== "intake") return;
    autoMode = newMode;
    localStorage.setItem("pos_barcode_auto_mode", autoMode);
    updateModeUI();

    if (autoMode === "sale") {
      playScannerBeep("sale");
      window.AppLayout?.showToast?.("وضع القارئ: خروج بضاعة (بيع تلقائي)", "كل مسحة بالباركود ستخصم قطعة من المخزن وتضيف الفلوس للدرج");
    } else {
      playScannerBeep("restock");
      window.AppLayout?.showToast?.("وضع القارئ: دخول بضاعة (توريد تلقائي)", "كل مسحة بالباركود ستزيد قطعة بالمخزن وتخصم تكلفتها من الدرج");
    }
  }

  function toggleMode() {
    const next = autoMode === "sale" ? "intake" : "sale";
    setMode(next);
  }

  function updateModeUI() {
    const isSale = autoMode === "sale";

    // Header buttons
    const saleBtn = document.getElementById("headerBarcodeModeSaleBtn");
    const intakeBtn = document.getElementById("headerBarcodeModeIntakeBtn");

    if (saleBtn && intakeBtn) {
      if (isSale) {
        saleBtn.className = "px-2.5 sm:px-3 py-1 rounded-lg font-label-md font-bold flex items-center gap-1 transition-all bg-rose-600 text-white shadow-sm ring-1 ring-rose-400";
        intakeBtn.className = "px-2.5 sm:px-3 py-1 rounded-lg font-label-md font-bold flex items-center gap-1 transition-all text-slate-600 hover:text-emerald-700 bg-transparent";
      } else {
        intakeBtn.className = "px-2.5 sm:px-3 py-1 rounded-lg font-label-md font-bold flex items-center gap-1 transition-all bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-400";
        saleBtn.className = "px-2.5 sm:px-3 py-1 rounded-lg font-label-md font-bold flex items-center gap-1 transition-all text-slate-600 hover:text-rose-700 bg-transparent";
      }
    }

    // Modal buttons (if open)
    const modalSaleBtn = document.getElementById("modalModeSaleBtn");
    const modalIntakeBtn = document.getElementById("modalModeIntakeBtn");
    if (modalSaleBtn && modalIntakeBtn) {
      if (isSale) {
        modalSaleBtn.className = "px-3 py-1.5 rounded-xl font-label-md font-bold flex items-center gap-1.5 transition-all bg-rose-600 text-white shadow-sm";
        modalIntakeBtn.className = "px-3 py-1.5 rounded-xl font-label-md font-bold flex items-center gap-1.5 transition-all text-slate-600 hover:text-emerald-700 bg-slate-100";
      } else {
        modalIntakeBtn.className = "px-3 py-1.5 rounded-xl font-label-md font-bold flex items-center gap-1.5 transition-all bg-emerald-600 text-white shadow-sm";
        modalSaleBtn.className = "px-3 py-1.5 rounded-xl font-label-md font-bold flex items-center gap-1.5 transition-all text-slate-600 hover:text-rose-700 bg-slate-100";
      }
    }
  }

  // =========================================================================
  // 3. Floating Live Transaction Banner (Instant Visual Feedback & Undo)
  // =========================================================================
  function injectLiveTransactionBanner() {
    if (document.getElementById("barcodeLiveBanner")) return;

    const banner = document.createElement("div");
    banner.id = "barcodeLiveBanner";
    banner.className = "fixed bottom-5 inset-x-4 sm:inset-x-auto sm:left-6 sm:w-auto sm:max-w-md z-[80] hidden modal-animate";
    document.body.appendChild(banner);
  }

  function showLiveTransactionBanner(action) {
    injectLiveTransactionBanner();
    const banner = document.getElementById("barcodeLiveBanner");
    if (!banner) return;

    if (bannerTimer) clearTimeout(bannerTimer);

    const isSale = action.type === "sale";
    const DB = window.PosDB;

    if (isSale) {
      banner.innerHTML = `
        <div class="bg-slate-950/95 backdrop-blur-md text-white rounded-2xl p-4 shadow-2xl border-2 border-rose-500/80 space-y-3 ring-4 ring-rose-500/10">
          <div class="flex items-center justify-between gap-3 border-b border-slate-800 pb-2.5">
            <div class="flex items-center gap-2 min-w-0">
              <div class="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined text-lg">shopping_cart_checkout</span>
              </div>
              <div class="min-w-0">
                <span class="px-2 py-0.5 rounded text-[11px] font-black bg-rose-600 text-white uppercase tracking-wider">خروج بضاعة (بيع تلقائي)</span>
                <h4 class="font-title-md font-bold text-white truncate mt-0.5">${escapeHtml(action.name)}</h4>
              </div>
            </div>
            
            <button type="button" onclick="BarcodeService.undoLastAction()" class="shrink-0 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-300 hover:text-white font-label-md font-bold text-xs flex items-center gap-1 transition-colors border border-slate-700 shadow-sm" title="إلغاء المعاملة واسترداد الصنف والفلوس">
              <span class="material-symbols-outlined text-sm">undo</span>
              <span>تراجع (Ctrl+Z)</span>
            </button>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs font-numeric-table bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
            <div>
              <span class="text-slate-400 block">حركة المخزن</span>
              <span class="text-rose-400 font-bold text-sm block mt-0.5">-1 قطعة (المتبقي: ${action.remainingStock})</span>
            </div>
            <div>
              <span class="text-slate-400 block">حركة الخزينة</span>
              <span class="text-emerald-400 font-bold text-sm block mt-0.5">+${DB?.formatMoney(action.amount)} ج.م للدرج 💵</span>
            </div>
          </div>

          <div class="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-1 border-t border-slate-800/80 flex-wrap gap-1">
            <div class="flex items-center gap-2">
              <button type="button" onclick="AppLayout.openPosModal()" class="text-sky-300 hover:text-white font-bold flex items-center gap-1 transition-colors">
                <span class="material-symbols-outlined text-sm">receipt_long</span>
                <span class="underline">الفاتورة (F1)</span>
              </button>
              <button type="button" onclick="BarcodeService.navigateToProductPage('${escapeHtml(action.barcode)}')" class="text-amber-300 hover:text-white font-bold flex items-center gap-1 transition-colors">
                <span class="material-symbols-outlined text-sm">rocket_launch</span>
                <span class="underline">صفحة الصنف ⬅</span>
              </button>
            </div>
            <span>الكود: <strong class="text-slate-300 font-mono">${escapeHtml(action.barcode)}</strong></span>
          </div>
        </div>
      `;
    } else {
      banner.innerHTML = `
        <div class="bg-slate-950/95 backdrop-blur-md text-white rounded-2xl p-4 shadow-2xl border-2 border-emerald-500/80 space-y-3 ring-4 ring-emerald-500/10">
          <div class="flex items-center justify-between gap-3 border-b border-slate-800 pb-2.5">
            <div class="flex items-center gap-2 min-w-0">
              <div class="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined text-lg">add_shopping_cart</span>
              </div>
              <div class="min-w-0">
                <span class="px-2 py-0.5 rounded text-[11px] font-black bg-emerald-600 text-white uppercase tracking-wider">دخول بضاعة (توريد تلقائي)</span>
                <h4 class="font-title-md font-bold text-white truncate mt-0.5">${escapeHtml(action.name)}</h4>
              </div>
            </div>
            
            <button type="button" onclick="BarcodeService.undoLastAction()" class="shrink-0 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 hover:text-white font-label-md font-bold text-xs flex items-center gap-1 transition-colors border border-slate-700 shadow-sm" title="إلغاء المعاملة واسترداد الصنف والفلوس">
              <span class="material-symbols-outlined text-sm">undo</span>
              <span>تراجع (Ctrl+Z)</span>
            </button>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs font-numeric-table bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
            <div>
              <span class="text-slate-400 block">حركة المخزن</span>
              <span class="text-emerald-400 font-bold text-sm block mt-0.5">+${action.qty} قطعة (الرصيد: ${action.newStock})</span>
            </div>
            <div>
              <span class="text-slate-400 block">حركة الخزينة</span>
              <span class="text-rose-400 font-bold text-sm block mt-0.5">-${DB?.formatMoney(action.amount)} ج.م من الدرج 💸</span>
            </div>
          </div>

          <div class="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-1 border-t border-slate-800/80 flex-wrap gap-1">
            <div class="flex items-center gap-2">
              <button type="button" onclick="BarcodeService.openLabelStudio({ name: '${escapeHtml(action.name)}', code: '${escapeHtml(action.barcode)}' })" class="text-emerald-300 hover:text-white font-bold flex items-center gap-1 transition-colors">
                <span class="material-symbols-outlined text-sm">print</span>
                <span class="underline">استيكر</span>
              </button>
              <button type="button" onclick="BarcodeService.navigateToProductPage('${escapeHtml(action.barcode)}')" class="text-amber-300 hover:text-white font-bold flex items-center gap-1 transition-colors">
                <span class="material-symbols-outlined text-sm">rocket_launch</span>
                <span class="underline">صفحة الصنف ⬅</span>
              </button>
            </div>
            <span>الكود: <strong class="text-slate-300 font-mono">${escapeHtml(action.barcode)}</strong></span>
          </div>
        </div>
      `;
    }

    banner.classList.remove("hidden");
    bannerTimer = setTimeout(() => {
      banner.classList.add("hidden");
    }, 7000);
  }

  function hideLiveTransactionBanner() {
    if (bannerTimer) clearTimeout(bannerTimer);
    const banner = document.getElementById("barcodeLiveBanner");
    if (banner) banner.classList.add("hidden");
  }

  // =========================================================================
  // 4. Undo Engine (تراجع فوري عن آخر مسحة باركود)
  // =========================================================================
  async function undoLastAction() {
    if (!lastAction) return;
    const DB = window.PosDB;
    if (!DB) return;

    const action = lastAction;
    lastAction = null;
    hideLiveTransactionBanner();

    try {
      if (action.type === "sale") {
        if (action.kind === "phone") {
          await DB.revertPhoneSale(action.item);
        } else {
          const item = inventoryCache.find((x) => x.id === action.item.id) || action.item;
          const curQty = Number(item.qty) || 0;
          await DB.updateInventoryItem(action.item.id, {
            qty: curQty + action.qty,
            updatedAtMs: Date.now()
          });

          if (autoAddDrawer && action.amount > 0) {
            await DB.addDrawerTx({
              type: "adjustment",
              source: action.item.section || "chargers",
              amount: action.amount,
              direction: "out",
              reason: `إلغاء وتراجع عن بيع: ${action.name}`,
              staffName: window.AppLayout?.getActiveStaffName?.() || "الكاشير"
            });
          }
        }
        playScannerBeep("undo");
        window.AppLayout?.showToast?.("تم التراجع عن البيع بنجاح", `أُعيدت البضاعة للمخزن وتصحح رصيد الخزينة (-${DB?.formatMoney(action.amount)} ج.م)`);
      } else if (action.type === "intake") {
        if (action.kind === "inventory") {
          const item = inventoryCache.find((x) => x.id === action.item.id) || action.item;
          const curQty = Number(item.qty) || 0;
          const revertedQty = Math.max(0, curQty - action.qty);

          await DB.updateInventoryItem(action.item.id, {
            qty: revertedQty,
            updatedAtMs: Date.now()
          });

          if (autoDeductDrawer && action.amount > 0) {
            await DB.addDrawerTx({
              type: "adjustment",
              source: action.item.section || "chargers",
              amount: action.amount,
              direction: "in",
              reason: `إلغاء وتراجع عن توريد: ${action.name}`,
              staffName: window.AppLayout?.getActiveStaffName?.() || "الكاشير"
            });
          }
        }
        playScannerBeep("undo");
        window.AppLayout?.showToast?.("تم التراجع عن التوريد بنجاح", `حُذفت الكمية وأُعيد المبلغ المستقطع إلى الخزينة (+${DB?.formatMoney(action.amount)} ج.م)`);
      }
    } catch (err) {
      playScannerBeep("error");
      window.AppLayout?.showToast?.("تعذر التراجع عن المعاملة", err.message, true);
    }
  }

  // =========================================================================
  // 5. Hardware Barcode Scanner Keystroke Listener
  // =========================================================================
  function initHardwareScannerListener() {
    window.addEventListener("keydown", (e) => {
      if (e.key === "F1" || e.key === "F2" || e.key === "F3" || e.key === "Escape") {
        keyBuffer = "";
        return;
      }

      if (e.key === "F4") {
        e.preventDefault();
        toggleMode();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        const active = document.activeElement;
        const isEditingField = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA") && !active.hasAttribute("data-barcode-input");
        if (!isEditingField && lastAction) {
          e.preventDefault();
          undoLastAction();
          return;
        }
      }

      const activeEl = document.activeElement;
      const isBarcodeSpecificInput =
        activeEl &&
        (activeEl.id === "barcodeIntakeInput" ||
          activeEl.id === "itemBarcode" ||
          activeEl.id === "deviceImei1" ||
          activeEl.id === "deviceImei2" ||
          activeEl.id === "posSearchInput" ||
          activeEl.id === "labelStudioCode" ||
          activeEl.hasAttribute("data-barcode-input"));

      const now = Date.now();
      const interval = now - lastKeyTime;
      lastKeyTime = now;

      if (e.key === "Enter") {
        const trimmed = keyBuffer.trim();
        if (trimmed.length >= MIN_BARCODE_LENGTH) {
          e.preventDefault();
          const scannedCode = trimmed;
          keyBuffer = "";
          const camModal = document.getElementById("barcodeCameraInputModal");
          if (camModal && !camModal.classList.contains("hidden")) {
            closeCameraInputModal();
          }
          handleScannedBarcode(scannedCode, isBarcodeSpecificInput ? activeEl : null);
          return;
        }

        if (activeEl && activeEl.id === "barcodeIntakeInput" && activeEl.value.trim()) {
          e.preventDefault();
          const val = activeEl.value.trim();
          activeEl.value = "";
          handleScannedBarcode(val, activeEl);
          return;
        }

        keyBuffer = "";
        return;
      }

      if (e.key && e.key.length === 1) {
        if (!isBarcodeSpecificInput) {
          if (interval > SCANNER_CHAR_INTERVAL_MS && keyBuffer.length > 0) {
            keyBuffer = e.key;
          } else {
            keyBuffer += e.key;
          }
        } else {
          keyBuffer += e.key;
        }
      }
    }, true);
  }

  // =========================================================================
  // 6. Central Barcode Dispatcher & Automated Executors
  // =========================================================================
  function findProductByBarcode(code) {
    if (!code) return null;
    const clean = code.trim().toLowerCase();

    const inv = inventoryCache.find(
      (item) => item.barcode && item.barcode.trim().toLowerCase() === clean
    );
    if (inv) {
      return { kind: "inventory", item: inv };
    }

    const phone = phonesCache.find(
      (p) =>
        (p.imei1 && p.imei1.trim().toLowerCase() === clean) ||
        (p.imei2 && p.imei2.trim().toLowerCase() === clean) ||
        (p.barcode && p.barcode.trim().toLowerCase() === clean)
    );
    if (phone) {
      return { kind: "phone", item: phone };
    }

    return null;
  }

  // Smart Section Categorizer & Cross-Page Routing Engine
  const SECTION_INFO_MAP = {
    phones: {
      key: "phones",
      name: "مخزن ومبيعات التلفونات",
      page: "phones.html",
      icon: "smartphone",
      colorClass: "sky",
      defaultBrand: "هاتف",
      defaultCategory: "NEW",
      generateDefaultName: (code) => `هاتف ذكي (سيريال: ${String(code).slice(-6)})`
    },
    headphones: {
      key: "headphones",
      name: "قسم السماعات",
      page: "headphones.html",
      icon: "headphones",
      colorClass: "indigo",
      defaultBrand: "سماعة",
      defaultCategory: "IN_EAR",
      generateDefaultName: (code) => `سماعة وارد جديد (#${String(code).slice(-6)})`
    },
    speakers: {
      key: "speakers",
      name: "قسم الصبات والمكبرات",
      page: "speakers.html",
      icon: "speaker",
      colorClass: "purple",
      defaultBrand: "مكبر صوت",
      defaultCategory: "MEDIUM",
      generateDefaultName: (code) => `صب / مكبر صوت (#${String(code).slice(-6)})`
    },
    chargers: {
      key: "chargers",
      name: "مخزن الشواحن والوصلات",
      page: "chargers.html",
      icon: "power",
      colorClass: "emerald",
      defaultBrand: "شاحن",
      defaultCategory: "CHARGER",
      generateDefaultName: (code) => `شاحن / وصلة (#${String(code).slice(-6)})`
    }
  };

  function detectProductSection(code) {
    if (!code) return "chargers";
    const clean = String(code).trim().toUpperCase();

    // 1. Check if already registered in cache
    const match = findProductByBarcode(clean);
    if (match) {
      if (match.kind === "phone") return "phones";
      return match.item.section || "chargers";
    }

    // 2. Check if 14-16 digits IMEI (standard GSM phones)
    const isPureDigits = /^\d{14,16}$/.test(clean);
    if (isPureDigits) {
      return "phones";
    }

    // 3. Check prefixes & phone keywords
    if (
      clean.startsWith("PH-") ||
      clean.startsWith("PHONE-") ||
      clean.startsWith("IMEI") ||
      clean.includes("IPHONE") ||
      clean.includes("SAMSUNG") ||
      clean.includes("XIAOMI") ||
      clean.includes("REDMI") ||
      clean.includes("OPPO") ||
      clean.includes("VIVO") ||
      clean.includes("REALME") ||
      clean.includes("INFINIX") ||
      clean.includes("TECNO") ||
      clean.includes("POCO")
    ) {
      return "phones";
    }

    // 4. Headphone keywords & prefixes
    if (
      clean.startsWith("HDP-") ||
      clean.startsWith("EAR-") ||
      clean.startsWith("BUD-") ||
      clean.startsWith("AIR-") ||
      clean.startsWith("TWS-") ||
      clean.includes("HEADPHONE") ||
      clean.includes("EARPHONE") ||
      clean.includes("EARBUD") ||
      clean.includes("AIRPOD") ||
      clean.includes("WIRELESS") ||
      clean.includes("BLUETOOTH") ||
      clean.includes("ORAIMO") ||
      clean.includes("ANC")
    ) {
      return "headphones";
    }

    // 5. Speaker keywords & prefixes
    if (
      clean.startsWith("SPK-") ||
      clean.startsWith("KTS-") ||
      clean.startsWith("JBL-") ||
      clean.startsWith("BOOM-") ||
      clean.includes("SPEAKER") ||
      clean.includes("BOOM") ||
      clean.includes("SOUNDBAR") ||
      clean.includes("SUBWOOFER") ||
      clean.includes("PARTY") ||
      clean.includes("KTS")
    ) {
      return "speakers";
    }

    // 6. Charger & Cable keywords & prefixes
    if (
      clean.startsWith("CAB-") ||
      clean.startsWith("CHG-") ||
      clean.startsWith("USB-") ||
      clean.startsWith("PWR-") ||
      clean.includes("CHARGER") ||
      clean.includes("CABLE") ||
      clean.includes("TYPEC") ||
      clean.includes("TYPE-C") ||
      clean.includes("LIGHTNING") ||
      clean.includes("MICRO") ||
      clean.includes("ADAPTER") ||
      clean.includes("FAST") ||
      clean.includes("WATT")
    ) {
      return "chargers";
    }

    // 7. Contextual Fallback to Current Page
    const currentPath = (window.location.pathname || "").toLowerCase();
    if (currentPath.includes("phone")) return "phones";
    if (currentPath.includes("headphone")) return "headphones";
    if (currentPath.includes("speaker")) return "speakers";
    if (currentPath.includes("charger")) return "chargers";

    // 8. Default
    return "chargers";
  }

  function navigateToProductPage(code) {
    if (!code) return;
    const clean = code.trim();
    const section = detectProductSection(clean);
    const pageMap = {
      phones: "phones.html",
      headphones: "headphones.html",
      speakers: "speakers.html",
      chargers: "chargers.html"
    };
    const targetPage = pageMap[section] || "chargers.html";
    window.location.href = `${targetPage}?search=${encodeURIComponent(clean)}&highlight=${encodeURIComponent(clean)}`;
  }

  function switchSmartSection(newSec, barcode) {
    const info = SECTION_INFO_MAP[newSec] || SECTION_INFO_MAP.chargers;
    const secInp = document.getElementById("newItemSection");
    const catInp = document.getElementById("newItemCategory");
    const brandInp = document.getElementById("newItemBrand");
    const nameInp = document.getElementById("newItemName");
    const titleEl = document.getElementById("smartSectionTitleDisplay");
    const iconEl = document.getElementById("smartSectionIcon");
    const customName = document.getElementById("customItemName");
    const customBrand = document.getElementById("customItemBrand");
    const btnText = document.getElementById("saveAndGoBtnText");

    if (secInp) secInp.value = newSec;
    if (catInp) catInp.value = info.defaultCategory;
    if (brandInp) brandInp.value = info.defaultBrand;
    const defName = info.generateDefaultName(barcode);
    if (nameInp) nameInp.value = defName;
    if (customName) customName.value = defName;
    if (customBrand) customBrand.value = info.defaultBrand;
    if (titleEl) titleEl.textContent = info.name;
    if (iconEl) iconEl.textContent = info.icon;
    if (btnText) btnText.textContent = `حفظ والذهاب لصفحة القسم (${info.name}) ⬅`;

    document.querySelectorAll(".smart-sec-pill").forEach((pill) => {
      pill.className = "smart-sec-pill p-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100";
    });
    const clickedBtn = window.event?.currentTarget;
    if (clickedBtn) {
      clickedBtn.className = "smart-sec-pill p-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-emerald-300";
    }
  }

  async function handleScannedBarcode(code, sourceElement = null) {
    if (!code) return;
    const cleanCode = code.trim();
    if (!cleanCode) return;

    // 0. CHECK COMMAND 2 QR / BARCODES (Independent Control Modes):
    const cleanUpper = cleanCode.toUpperCase();
    if (
      cleanUpper === "CMD:INTAKE" ||
      cleanUpper === "CMD-INTAKE" ||
      cleanUpper === "REDMAGIC:INTAKE" ||
      cleanUpper === "REDMAGIC-INTAKE" ||
      cleanUpper === "INTAKE"
    ) {
      setMode("intake");
      playScannerBeep("restock");
      openDedicatedScanner("intake");
      window.AppLayout?.showToast?.(
        "📥 تم تفعيل كود QR: تسجيل دخول البضاعة للمخزن",
        "النظام الآن في وضع استلام وتوريد البضاعة المستقل"
      );
      return;
    }
    if (
      cleanUpper === "CMD:SALE" ||
      cleanUpper === "CMD-SALE" ||
      cleanUpper === "REDMAGIC:SALE" ||
      cleanUpper === "REDMAGIC-SALE" ||
      cleanUpper === "SALE"
    ) {
      setMode("sale");
      playScannerBeep("sale");
      openDedicatedScanner("sale");
      window.AppLayout?.showToast?.(
        "📤 تم تفعيل كود QR: خروج وبيع البضاعة",
        "النظام الآن في وضع بيع وخروج البضاعة المستقل"
      );
      return;
    }

    // If currently inside the Barcode Label Studio:
    const labelModal = document.getElementById("barcodeGeneratorModal");
    if (labelModal && !labelModal.classList.contains("hidden")) {
      const codeInp = document.getElementById("labelStudioCode");
      if (codeInp) {
        codeInp.value = cleanCode;
        renderStudioBarcode();
        playScannerBeep("success");
      }
      return;
    }

    // 1. If currently inside the dedicated intake scanner modal
    const dedicatedIntakeModal = document.getElementById("dedicatedBarcodeIntakeModal");
    const isDedicatedIntakeOpen = dedicatedIntakeModal && !dedicatedIntakeModal.classList.contains("hidden");
    if (isDedicatedIntakeOpen) {
      const match = findProductByBarcode(cleanCode);
      if (match) {
        await executeDirectIntake(match, cleanCode);
        renderDedicatedIntakeHistory();
      } else {
        playScannerBeep("success");
        openBarcodeIntakeModal(cleanCode);
      }
      return;
    }

    // 2. If currently inside the dedicated sale scanner modal
    const dedicatedSaleModal = document.getElementById("dedicatedBarcodeSaleModal");
    const isDedicatedSaleOpen = dedicatedSaleModal && !dedicatedSaleModal.classList.contains("hidden");
    if (isDedicatedSaleOpen) {
      const match = findProductByBarcode(cleanCode);
      if (match) {
        await executeDirectSale(match, cleanCode);
        renderDedicatedSaleHistory();
      } else {
        playScannerBeep("error");
        window.AppLayout?.showToast?.("الباركود غير مسجل في المخزن!", `كود: ${cleanCode}`, true);
      }
      return;
    }

    // 3. If currently inside the global POS quick cashier (F1)
    const posModal = document.getElementById("globalPosModal");
    const isPosOpen = posModal && !posModal.classList.contains("hidden");
    if (isPosOpen) {
      handlePosModalScan(cleanCode);
      return;
    }

    // 4. If currently inside the standard "Add Item" modal (#addItemModal)
    const addItemModal = document.getElementById("addItemModal");
    const isAddItemOpen = addItemModal && !addItemModal.classList.contains("hidden");
    if (isAddItemOpen) {
      handleAddItemModalScan(cleanCode);
      return;
    }

    // 3. If on phones page and form input is focused
    if (sourceElement && (sourceElement.id === "deviceImei1" || sourceElement.id === "deviceImei2")) {
      sourceElement.value = cleanCode;
      playScannerBeep("success");
      window.AppLayout?.showToast?.("تم مسح السيريال IMEI", cleanCode);
      return;
    }

    // 4. If global barcode hub is explicitly open, route to lookup:
    const barcodeModal = document.getElementById("globalBarcodeModal");
    const isBarcodeModalOpen = barcodeModal && !barcodeModal.classList.contains("hidden");
    if (isBarcodeModalOpen) {
      lookupBarcode(cleanCode);
      return;
    }

    // 5. DIRECT AUTOMATED SCANNER ENGINE:
    const match = findProductByBarcode(cleanCode);

    if (autoMode === "sale") {
      // ===== خروج بضاعة تلقائي (بيع مباشر) =====
      if (match) {
        await executeDirectSale(match, cleanCode);
      } else {
        playScannerBeep("error");
        window.AppLayout?.showToast?.("الباركود غير مسجل في المخزن!", `كود: ${cleanCode}`, true);
        openBarcodeIntakeModal(cleanCode);
      }
    } else {
      // ===== دخول بضاعة تلقائي (توريد مباشر) =====
      if (match) {
        await executeDirectIntake(match, cleanCode);
      } else {
        playScannerBeep("success");
        openBarcodeIntakeModal(cleanCode);
      }
    }
  }

  // Automatic Sale Execution (خروج بضاعة + زيادة الفلوس في الدرج)
  async function executeDirectSale(match, barcode) {
    const DB = window.PosDB;
    if (!DB) return;
    const { kind, item } = match;
    const isPhone = kind === "phone";
    const staffName = window.AppLayout?.getActiveStaffName?.() || "الكاشير";

    try {
      if (isPhone) {
        if (item.isSold) {
          playScannerBeep("error");
          window.AppLayout?.showToast?.("الهاتف مسجل كمُباع بالفعل بالمخزن!", `${item.brand} ${item.model}`, true);
          return;
        }

        const salePrice = Number(item.sellingPrice) || 0;
        await DB.sellPhone(item, {
          buyer: "بيع مباشر بالباركود",
          buyerPhone: "",
          price: salePrice,
          warranty: "ضمان المحل",
          payment: "نقدي (كاش)",
          staffName
        });

        playScannerBeep("sale");

        const action = {
          type: "sale",
          kind: "phone",
          item,
          name: `${item.brand} ${item.model}`,
          barcode: item.imei1 || barcode,
          qty: 1,
          remainingStock: 0,
          amount: salePrice,
          time: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
        };
        lastAction = action;
        showLiveTransactionBanner(action);
        logSessionLiveActivity(action);
      } else {
        const curStock = Number(item.qty) || 0;
        if (curStock <= 0) {
          playScannerBeep("error");
          window.AppLayout?.showToast?.("نفذت كمية هذا الصنف من المخزن!", `${item.name} (الرصيد 0)`, true);
          return;
        }

        const salePrice = Number(item.salePrice) || 0;
        await DB.sellInventoryItem({
          item,
          qty: 1,
          unitPrice: salePrice,
          paymentMethod: "نقدي (كاش)",
          customerName: "عميل مباشر",
          customerPhone: "",
          staffName
        });

        playScannerBeep("sale");

        const remaining = curStock - 1;
        const action = {
          type: "sale",
          kind: "inventory",
          item,
          name: `${item.brand ? item.brand + " - " : ""}${item.name}`,
          barcode: item.barcode || barcode,
          qty: 1,
          remainingStock: remaining,
          amount: salePrice,
          time: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
        };
        lastAction = action;
        showLiveTransactionBanner(action);
        logSessionLiveActivity(action);
      }
    } catch (err) {
      playScannerBeep("error");
      window.AppLayout?.showToast?.("تعذر تنفيذ عملية الخروج والبيع", err.message, true);
    }
  }

  // Automatic Intake Execution (دخول بضاعة + خصم الفلوس من الدرج)
  async function executeDirectIntake(match, barcode) {
    const DB = window.PosDB;
    if (!DB) return;
    const { kind, item } = match;
    const isPhone = kind === "phone";
    const staffName = window.AppLayout?.getActiveStaffName?.() || "الكاشير";

    try {
      if (isPhone) {
        if (item.isSold) {
          await DB.revertPhoneSale(item);
          playScannerBeep("restock");
          const action = {
            type: "intake",
            kind: "phone",
            item,
            name: `${item.brand} ${item.model}`,
            barcode: item.imei1 || barcode,
            qty: 1,
            newStock: 1,
            amount: 0,
            time: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
          };
          lastAction = action;
          showLiveTransactionBanner(action);
          logSessionLiveActivity(action);
        } else {
          playScannerBeep("error");
          window.AppLayout?.showToast?.("الهاتف مسجل ومتاح بالمخزن بالفعل", `${item.brand} ${item.model} (${item.imei1})`, true);
        }
      } else {
        const curStock = Number(item.qty) || 0;
        const addQty = autoBatchQty;
        const newStock = curStock + addQty;
        const unitCost = Number(item.costPrice) || 0;
        const totalCost = unitCost * addQty;

        await DB.updateInventoryItem(item.id, {
          qty: newStock,
          updatedAtMs: Date.now()
        });

        if (autoDeductDrawer && totalCost > 0) {
          await DB.addDrawerTx({
            type: "expense",
            source: item.section || "chargers",
            amount: totalCost,
            direction: "out",
            reason: `توريد بضاعة تلقائي بالباركود: ${item.name} (+${addQty} قطع)`,
            staffName
          });
        }

        playScannerBeep("restock");

        const action = {
          type: "intake",
          kind: "inventory",
          item,
          name: `${item.brand ? item.brand + " - " : ""}${item.name}`,
          barcode: item.barcode || barcode,
          qty: addQty,
          newStock,
          amount: totalCost,
          time: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
        };
        lastAction = action;
        showLiveTransactionBanner(action);
        logSessionLiveActivity(action);
      }
    } catch (err) {
      playScannerBeep("error");
      window.AppLayout?.showToast?.("تعذر تنفيذ عملية التوريد التلقائي", err.message, true);
    }
  }

  // Handle scan when Quick POS (F1) is open
  function handlePosModalScan(code) {
    const match = findProductByBarcode(code);
    if (match) {
      if (match.kind === "phone") {
        if (match.item.isSold) {
          playScannerBeep("error");
          window.AppLayout?.showToast?.("الهاتف مسجل كمُباع بالفعل!", `${match.item.brand} ${match.item.model}`, true);
          return;
        }
        window.AppLayout?.addToPosCart?.("phone", match.item.id);
        playScannerBeep("sale");
        window.AppLayout?.showToast?.("تمت إضافة الهاتف للفاتورة", `${match.item.brand} ${match.item.model}`);
      } else {
        const curStock = Number(match.item.qty) || 0;
        if (curStock <= 0) {
          playScannerBeep("error");
          window.AppLayout?.showToast?.("نفذت كمية هذا الصنف من المخزن!", match.item.name, true);
          return;
        }
        window.AppLayout?.addToPosCart?.("inventory", match.item.id);
        playScannerBeep("sale");
        window.AppLayout?.showToast?.("تمت إضافة الصنف للفاتورة", match.item.name);
      }
    } else {
      playScannerBeep("error");
      window.AppLayout?.showToast?.("الباركود غير مسجل في المخزن!", code, true);
      const searchInp = document.getElementById("posSearchInput");
      if (searchInp) {
        searchInp.value = code;
        window.AppLayout?.renderPosCatalog?.();
      }
    }
  }

  // Handle scan inside the standard Add Item Modal
  function handleAddItemModalScan(code) {
    const barcodeInput = document.getElementById("itemBarcode");
    if (barcodeInput) {
      barcodeInput.value = code;
      playScannerBeep("success");

      const match = findProductByBarcode(code);
      const noticeEl = document.getElementById("itemBarcodeDuplicateNotice");
      if (match) {
        if (noticeEl) {
          noticeEl.innerHTML = `
            <div class="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-center justify-between">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="material-symbols-outlined text-amber-600 text-base shrink-0">info</span>
                <span class="truncate">الباركود مسجل مسبقاً: <strong>${escapeHtml(match.item.name || match.item.model)}</strong> (الرصيد: ${match.item.qty || 1})</span>
              </div>
              <button type="button" onclick="BarcodeService.openModal('${escapeHtml(code)}')" class="shrink-0 px-2 py-1 rounded bg-amber-600 text-white font-bold hover:bg-amber-700">فتح لتوريد كمية إضافية</button>
            </div>
          `;
          noticeEl.classList.remove("hidden");
        }
      } else {
        if (noticeEl) noticeEl.classList.add("hidden");
        setTimeout(() => {
          const brandInp = document.getElementById("itemBrand");
          if (brandInp && !brandInp.value) brandInp.focus();
          else document.getElementById("itemName")?.focus();
        }, 50);
      }
    }
  }

  // =========================================================================
  // 7. Dedicated Barcode Generator & Thermal Label Print Studio
  // (للأصناف التي ليس لها باركود لطباعة استيكرات ولصقها لتدخل السستم)
  // =========================================================================
  function injectLabelStudioModal() {
    if (document.getElementById("barcodeGeneratorModal")) return;

    const modal = document.createElement("div");
    modal.id = "barcodeGeneratorModal";
    modal.className = "fixed inset-0 z-[75] hidden bg-navy-dark/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-4";
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden modal-animate border border-slate-200">
        
        <!-- Header -->
        <div class="bg-gradient-to-r from-navy-dark via-slate-900 to-navy-dark text-white px-6 py-4 flex items-center justify-between shrink-0 border-b border-slate-800">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center border border-sky-400/30">
              <span class="material-symbols-outlined text-2xl">label</span>
            </div>
            <div>
              <h3 class="font-title-lg font-black text-xl text-white">مركز توليد وطباعة ملصقات الباركود</h3>
              <p class="font-label-md text-slate-300 text-xs sm:text-sm">توليد كود رسمي عالي الدقة وطباعة استيكرات للأصناف التي ليس لها باركود مصنعي</p>
            </div>
          </div>
          <button type="button" onclick="BarcodeService.closeLabelStudio()" class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors">
            <span class="material-symbols-outlined text-2xl">close</span>
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 bg-slate-50/60">
          
          <!-- Controls Column -->
          <div class="lg:col-span-7 space-y-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div>
              <label class="block font-label-md font-bold text-on-surface mb-1">اسم المحل / المتجر على الملصق</label>
              <input type="text" id="labelStudioStoreName" oninput="BarcodeService.renderStudioBarcode()" class="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-300 font-body-md focus:bg-white focus:ring-2 focus:ring-primary font-bold" />
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-label-md font-bold text-on-surface mb-1">اسم الصنف والمواصفات *</label>
                <input type="text" id="labelStudioItemName" oninput="BarcodeService.renderStudioBarcode()" placeholder="مثال: وصلة تايب سي قماش سريع 3A" class="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-300 font-body-md focus:bg-white focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label class="block font-label-md font-bold text-on-surface mb-1">سعر البيع للجمهور (ج.م) *</label>
                <input type="number" id="labelStudioPrice" oninput="BarcodeService.renderStudioBarcode()" step="0.5" min="0" placeholder="0.00" class="w-full h-11 px-3.5 text-left font-numeric-table font-bold rounded-xl bg-slate-50 border border-slate-300 focus:bg-white focus:ring-2 focus:ring-primary" dir="ltr" />
              </div>
            </div>

            <!-- Barcode Code Generation -->
            <div>
              <label class="block font-label-md font-bold text-on-surface mb-1 flex items-center justify-between">
                <span>كود الباركود الفريد (SKU) *</span>
                <button type="button" onclick="BarcodeService.generateNewStudioCode()" class="text-xs text-primary font-bold hover:underline flex items-center gap-1">
                  <span class="material-symbols-outlined text-sm">autorenew</span>
                  <span>توليد كود تلقائي جديد</span>
                </button>
              </label>
              <div class="relative">
                <input type="text" id="labelStudioCode" oninput="BarcodeService.renderStudioBarcode()" class="w-full h-11 pr-10 pl-3.5 font-numeric-table font-black tracking-widest text-lg rounded-xl bg-slate-50 border border-slate-300 focus:bg-white focus:ring-2 focus:ring-primary text-left" dir="ltr" />
                <span class="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">barcode</span>
              </div>
            </div>

            <!-- Printing Copies and Label Size Preset -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label class="block font-label-md font-bold text-on-surface mb-1">عدد الملصقات</label>
                <input type="number" id="labelStudioCopies" min="1" max="500" value="1" class="w-full h-10 px-3 text-center font-numeric-table font-bold text-sm rounded-xl bg-slate-50 border border-slate-300" />
              </div>

              <div>
                <label class="block font-label-md font-bold text-on-surface mb-1">مقاس الملصق</label>
                <select id="labelStudioPreset" class="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-300 font-body-md focus:bg-white focus:ring-2 focus:ring-primary text-xs font-semibold">
                  <option value="50x25" selected>ملصق حراري قياسي (50 × 25 مم)</option>
                  <option value="40x25">ملصق حراري وسط (40 × 25 مم)</option>
                  <option value="38x25">ملصق حراري مدمج (38 × 25 مم)</option>
                  <option value="a4">ورق عادي A4</option>
                </select>
              </div>
            </div>

          </div>

          <!-- Preview Column -->
          <div class="lg:col-span-5 flex flex-col justify-between space-y-4">
            <div class="bg-slate-950 p-5 rounded-2xl border border-slate-800 shadow-xl flex flex-col items-center justify-center space-y-3">
              <span class="text-xs text-sky-400 font-bold uppercase tracking-wider flex items-center gap-1">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                معاينة شكل الاستيكر الحراري المطبوع
              </span>

              <!-- Exact Physical Thermal Sticker Preview Card -->
              <div id="thermalStickerPreviewCard" class="w-full max-w-[280px] bg-white text-black p-3 rounded-lg border-2 border-slate-800 shadow-2xl flex flex-col items-center justify-between text-center min-h-[140px]">
                <div id="previewStoreTitle" class="text-[11px] font-black uppercase text-slate-900 tracking-wider">ريد ماجيك - RED MAGIC</div>
                <div id="previewItemTitle" class="text-xs font-bold text-slate-800 my-0.5 truncate max-w-full">وصلة تايب سي قماش</div>
                
                <div class="w-full my-1 flex justify-center overflow-hidden">
                  <svg id="previewBarcodeSvg" class="max-w-full h-auto"></svg>
                </div>

                <div class="text-xs sm:text-sm font-black text-slate-950 font-numeric-table border-t border-slate-300 pt-1 w-full flex justify-between px-2">
                  <span>السعر:</span>
                  <span id="previewPriceVal" class="text-emerald-700 font-black">0.00 ج.م</span>
                </div>
              </div>

              <p class="text-[11px] text-slate-400 text-center px-2">
                تمت معايرة هذا الباركود بصيغة <strong>Code 128 القياسية</strong> لتقرأه جميع أجهزة ومسدسات الباركود وكاميرات الموبايل بدقة 100%.
              </p>
            </div>

            <div class="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-950 space-y-1">
              <div class="font-bold flex items-center gap-1 text-emerald-950">
                <span class="material-symbols-outlined text-base text-emerald-600">verified</span>
                <span>دورة العمل المعتمدة على الباركود:</span>
              </div>
              <p class="text-emerald-800">1. اضغط طباعة وألصق الاستيكر على علبة أو كيس الصنف.</p>
              <p class="text-emerald-800">2. وجّه مسدس الباركود نحو الملصق في وضع «دخول بضاعة» لإدخاله للمخزن وخصم تكلفته من الخزينة تلقائياً!</p>
            </div>
          </div>
        </div>

        <!-- Footer Action Buttons -->
        <div class="bg-white px-5 py-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <button type="button" onclick="BarcodeService.closeLabelStudio()" class="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 font-label-md font-semibold transition-colors">
            إلغاء
          </button>

          <div class="flex items-center gap-2.5 w-full sm:w-auto">
            <button type="button" id="applyToFormBtn" onclick="BarcodeService.applyStudioBarcodeToInput()" class="hidden w-full sm:w-auto px-4 py-2.5 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-900 font-label-md font-bold transition-colors">
              📋 تطبيق الكود في نموذج الإدخال
            </button>

            <button type="button" onclick="BarcodeService.printBarcodeLabels()" class="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-label-lg font-black shadow-md flex items-center justify-center gap-2 transition-all">
              <span class="material-symbols-outlined text-xl">print</span>
              <span>🖨️ طباعة ملصقات الباركود</span>
            </button>
          </div>
        </div>

      </div>
    `;

    document.body.appendChild(modal);
  }

  function openLabelStudio(options = {}) {
    injectLabelStudioModal();
    const modal = document.getElementById("barcodeGeneratorModal");
    if (!modal) return;

    targetInputForLabelStudio = options.targetInputId || null;

    const storeInp = document.getElementById("labelStudioStoreName");
    const nameInp = document.getElementById("labelStudioItemName");
    const priceInp = document.getElementById("labelStudioPrice");
    const codeInp = document.getElementById("labelStudioCode");
    const applyBtn = document.getElementById("applyToFormBtn");

    const defaultStore = (window.PosDB?.DEFAULT_SETTINGS?.store?.storeName) || "ريد ماجيك - RED MAGIC";
    if (storeInp) storeInp.value = options.storeName || defaultStore;
    if (nameInp) nameInp.value = options.name || "";
    if (priceInp) priceInp.value = options.price || "";

    if (codeInp) {
      codeInp.value = options.code || generateUniqueBarcodeCode();
    }

    if (applyBtn) {
      if (targetInputForLabelStudio) {
        applyBtn.classList.remove("hidden");
      } else {
        applyBtn.classList.add("hidden");
      }
    }

    modal.classList.remove("hidden");
    renderStudioBarcode();

    setTimeout(() => {
      if (!nameInp.value) nameInp.focus();
      else if (!priceInp.value) priceInp.focus();
    }, 60);
  }

  function closeLabelStudio() {
    targetInputForLabelStudio = null;
    const modal = document.getElementById("barcodeGeneratorModal");
    if (modal) modal.classList.add("hidden");
  }

  function generateUniqueBarcodeCode() {
    const rand = Math.floor(10000000 + Math.random() * 90000000);
    return `RM-${rand}`;
  }

  function generateNewStudioCode() {
    const codeInp = document.getElementById("labelStudioCode");
    if (codeInp) {
      codeInp.value = generateUniqueBarcodeCode();
      renderStudioBarcode();
      playScannerBeep("success");
    }
  }

  function setLabelCopies(q) {
    const inp = document.getElementById("labelStudioCopies");
    if (inp) inp.value = q;
  }

  function renderStudioBarcode() {
    const store = document.getElementById("labelStudioStoreName")?.value.trim() || "ريد ماجيك - RED MAGIC";
    const name = document.getElementById("labelStudioItemName")?.value.trim() || "اسم الصنف والموديل";
    const price = parseFloat(document.getElementById("labelStudioPrice")?.value) || 0;
    const code = document.getElementById("labelStudioCode")?.value.trim() || "RM-00000000";

    const previewStore = document.getElementById("previewStoreTitle");
    const previewItem = document.getElementById("previewItemTitle");
    const previewPrice = document.getElementById("previewPriceVal");

    if (previewStore) previewStore.textContent = store;
    if (previewItem) previewItem.textContent = name;
    if (previewPrice) previewPrice.textContent = `${window.PosDB?.formatMoney(price)} ج.م`;

    try {
      if (typeof JsBarcode !== "undefined" && code) {
        JsBarcode("#previewBarcodeSvg", code, {
          format: "CODE128",
          width: 1.8,
          height: 42,
          displayValue: true,
          fontSize: 13,
          font: "Readex Pro, monospace",
          lineColor: "#000000",
          margin: 2
        });
      }
    } catch (err) {
      console.warn("JsBarcode preview error:", err);
    }
  }

  function applyStudioBarcodeToInput() {
    const code = document.getElementById("labelStudioCode")?.value.trim();
    if (targetInputForLabelStudio && code) {
      const el = document.getElementById(targetInputForLabelStudio);
      if (el) {
        el.value = code;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        window.AppLayout?.showToast?.("تم نقل الباركود إلى النموذج", code);
      }
    }
    closeLabelStudio();
  }

  function printBarcodeLabels() {
    const store = document.getElementById("labelStudioStoreName")?.value.trim() || "ريد ماجيك - RED MAGIC";
    const name = document.getElementById("labelStudioItemName")?.value.trim() || "صنف بدون اسم";
    const price = parseFloat(document.getElementById("labelStudioPrice")?.value) || 0;
    const code = document.getElementById("labelStudioCode")?.value.trim() || "RM-00000000";
    const copies = parseInt(document.getElementById("labelStudioCopies")?.value, 10) || 1;
    const preset = document.getElementById("labelStudioPreset")?.value || "50x25";

    const svgEl = document.getElementById("previewBarcodeSvg");
    if (!svgEl) return;

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);

    let widthMm = 50;
    let heightMm = 25;
    if (preset === "40x25") { widthMm = 40; heightMm = 25; }
    else if (preset === "38x25") { widthMm = 38; heightMm = 25; }

    let labelsHtml = "";
    for (let i = 0; i < copies; i++) {
      labelsHtml += `
        <div class="label-sticker">
          <div class="store-name">${escapeHtml(store)}</div>
          <div class="item-name">${escapeHtml(name)}</div>
          <div class="barcode-box">${svgStr}</div>
          <div class="price-tag">السعر: ${window.PosDB?.formatMoney(price)} ج.م</div>
        </div>
      `;
    }

    const printContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="utf-8">
        <title>طباعة ملصقات الباركود - ${escapeHtml(name)}</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&family=Readex+Pro:wght@700;800&display=swap" rel="stylesheet">
        <style>
          @page {
            size: ${widthMm}mm ${heightMm}mm;
            margin: 0;
          }
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          body {
            font-family: 'Cairo', 'Readex Pro', Arial, sans-serif;
            background: #ffffff;
            color: #000000;
          }
          .label-sticker {
            width: ${widthMm}mm;
            height: ${heightMm}mm;
            padding: 1.5mm 1.5mm;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: space-between;
            text-align: center;
            page-break-after: always;
            overflow: hidden;
            border: 1px dashed #e2e8f0;
          }
          .store-name {
            font-size: 8pt;
            font-weight: 900;
            line-height: 1.1;
            letter-spacing: 0.03em;
            text-transform: uppercase;
          }
          .item-name {
            font-size: 7.5pt;
            font-weight: 800;
            line-height: 1.15;
            max-height: 2.3em;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            width: 100%;
          }
          .barcode-box {
            width: 100%;
            display: flex;
            justify-content: center;
          }
          .barcode-box svg {
            width: 95%;
            height: auto;
            max-height: 12.5mm;
          }
          .price-tag {
            font-size: 9pt;
            font-weight: 900;
            line-height: 1.1;
            font-family: 'Readex Pro', 'Cairo', sans-serif;
          }
          @media print {
            .label-sticker {
              border: none;
            }
          }
        </style>
      </head>
      <body>
        ${labelsHtml}
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 250);
          };
        </script>
      </body>
      </html>
    `;

    const printWin = window.open("", "_blank", "width=600,height=600");
    if (printWin) {
      printWin.document.open();
      printWin.document.write(printContent);
      printWin.document.close();
      window.AppLayout?.showToast?.("جاري إرسال الملصقات للطابعة", `عدد ${copies} ملصقات (${name})`);
    } else {
      window.AppLayout?.showToast?.("يرجى السماح بالنوافذ المنبثقة لطباعة الملصقات", "", true);
    }
  }

  // =========================================================================
  // 7.B Independent 2 QR Barcode Systems (دخول بضاعة & خروج بضاعة منفصلين تماماً)
  // =========================================================================

  function injectDedicatedIntakeModal() {
    if (document.getElementById("dedicatedBarcodeIntakeModal")) return;

    const modal = document.createElement("div");
    modal.id = "dedicatedBarcodeIntakeModal";
    modal.className = "fixed inset-0 z-[75] hidden bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4";
    modal.innerHTML = `
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden modal-animate border-2 border-emerald-500/80">
        <!-- Header -->
        <div class="bg-gradient-to-r from-emerald-800 via-emerald-700 to-teal-800 text-white px-5 sm:px-6 py-4 flex items-center justify-between shrink-0 shadow-md">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center text-white shadow-inner">
              <span class="material-symbols-outlined text-3xl">add_shopping_cart</span>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="font-title-lg font-black text-white text-lg sm:text-xl">📥 كود QR تسجيل دخول البضاعة (توريد)</h3>
                <span class="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-400 text-slate-950 shadow-sm">مستقل 100%</span>
              </div>
              <p class="font-label-md text-emerald-100 text-xs sm:text-sm mt-0.5">كل مسحة بالباركود أو الكاميرا تزيد بالمخزن فوراً وتوثق التكلفة بالخزينة (F6)</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" onclick="BarcodeService.openControlCardsModal()" class="px-2.5 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold flex items-center gap-1 transition-colors" title="طباعة كروت QR">
              <span class="material-symbols-outlined text-base">qr_code_2</span>
              <span class="hidden sm:inline">طباعة الكود</span>
            </button>
            <button type="button" onclick="BarcodeService.closeDedicatedScanner('intake')" class="text-emerald-100 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors">
              <span class="material-symbols-outlined text-2xl">close</span>
            </button>
          </div>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 bg-emerald-50/40">
          <!-- Active Mode Info Badge -->
          <div class="bg-emerald-100/80 border border-emerald-300/80 rounded-2xl p-3 flex items-center justify-between gap-3 text-emerald-950 text-xs sm:text-sm font-semibold">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
              <span><strong>وضع التوريد نشط:</strong> امسح كود أي بضاعة لإدخالها، أو اكتب السيريال واضغط Enter.</span>
            </div>
            <button type="button" onclick="BarcodeService.openDedicatedScanner('sale')" class="px-2.5 py-1 rounded-lg bg-white text-rose-700 hover:bg-rose-50 border border-rose-300 font-bold text-xs shrink-0 transition-colors flex items-center gap-1">
              <span>التحويل لخروج بضاعة 📤</span>
            </button>
          </div>

          <!-- Barcode Input Box -->
          <div class="relative">
            <input 
              type="text" 
              id="dedicatedIntakeBarcodeInput" 
              placeholder="امسح باركود البضاعة الداخلة بمسدس الباركود أو اكتب واضغط Enter..."
              onkeydown="if(event.key==='Enter'){event.preventDefault();BarcodeService.handleDedicatedIntakeEnter();}"
              class="w-full h-14 pl-28 pr-12 text-base sm:text-lg font-numeric-table font-bold bg-white border-2 border-emerald-500 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/20 text-slate-900 rounded-2xl shadow-sm transition-all"
              dir="ltr"
              autocomplete="off"
            />
            <span class="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-emerald-600 text-2xl">barcode_scanner</span>
            <div class="absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button 
                type="button" 
                onclick="BarcodeService.openCameraForInput('dedicatedIntakeBarcodeInput')" 
                title="مسح بالكاميرا" 
                class="p-2 rounded-xl bg-emerald-100 text-emerald-800 hover:bg-emerald-200 transition-colors">
                <span class="material-symbols-outlined text-lg">photo_camera</span>
              </button>
              <button 
                type="button" 
                onclick="BarcodeService.handleDedicatedIntakeEnter()" 
                class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm">
                تسجيل
              </button>
            </div>
          </div>

          <!-- Recent Intake Live Feed -->
          <div class="bg-white rounded-2xl p-4 border border-emerald-200 shadow-sm space-y-3">
            <div class="flex items-center justify-between border-b border-emerald-100 pb-2">
              <h4 class="font-title-md font-bold text-emerald-950 text-sm flex items-center gap-1.5">
                <span class="material-symbols-outlined text-emerald-600 text-base">history</span>
                <span>سجل البضاعة الداخلة في هذه الجلسة</span>
              </h4>
              <span id="dedicatedIntakeCountBadge" class="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 font-numeric-table">0 عمليات</span>
            </div>
            <div id="dedicatedIntakeHistoryFeed" class="space-y-2 max-h-56 overflow-y-auto divide-y divide-slate-100">
              <div class="py-6 text-center text-slate-400 text-xs">لا توجد بضاعة مسجلة بعد في هذه الجلسة. ابدأ بمسح الباركود الآن.</div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function injectDedicatedSaleModal() {
    if (document.getElementById("dedicatedBarcodeSaleModal")) return;

    const modal = document.createElement("div");
    modal.id = "dedicatedBarcodeSaleModal";
    modal.className = "fixed inset-0 z-[75] hidden bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4";
    modal.innerHTML = `
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden modal-animate border-2 border-rose-500/80">
        <!-- Header -->
        <div class="bg-gradient-to-r from-rose-800 via-rose-700 to-pink-800 text-white px-5 sm:px-6 py-4 flex items-center justify-between shrink-0 shadow-md">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center text-white shadow-inner">
              <span class="material-symbols-outlined text-3xl">shopping_cart_checkout</span>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="font-title-lg font-black text-white text-lg sm:text-xl">📤 كود QR خروج البضاعة (بيع مباشر)</h3>
                <span class="px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-400 text-slate-950 shadow-sm">مستقل 100%</span>
              </div>
              <p class="font-label-md text-rose-100 text-xs sm:text-sm mt-0.5">كل مسحة بالباركود أو الكاميرا تخصم من المخزن فوراً وتضيف الإيراد للخزينة (F7)</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" onclick="BarcodeService.openControlCardsModal()" class="px-2.5 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold flex items-center gap-1 transition-colors" title="طباعة كروت QR">
              <span class="material-symbols-outlined text-base">qr_code_2</span>
              <span class="hidden sm:inline">طباعة الكود</span>
            </button>
            <button type="button" onclick="BarcodeService.closeDedicatedScanner('sale')" class="text-rose-100 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors">
              <span class="material-symbols-outlined text-2xl">close</span>
            </button>
          </div>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 bg-rose-50/40">
          <!-- Active Mode Info Badge -->
          <div class="bg-rose-100/80 border border-rose-300/80 rounded-2xl p-3 flex items-center justify-between gap-3 text-rose-950 text-xs sm:text-sm font-semibold">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-rose-500 animate-pulse"></span>
              <span><strong>وضع البيع نشط:</strong> امسح كود الصنف لبيعه مباشرة، أو اكتب السيريال واضغط Enter.</span>
            </div>
            <button type="button" onclick="BarcodeService.openDedicatedScanner('intake')" class="px-2.5 py-1 rounded-lg bg-white text-emerald-700 hover:bg-emerald-50 border border-emerald-300 font-bold text-xs shrink-0 transition-colors flex items-center gap-1">
              <span>التحويل لدخول بضاعة 📥</span>
            </button>
          </div>

          <!-- Barcode Input Box -->
          <div class="relative">
            <input 
              type="text" 
              id="dedicatedSaleBarcodeInput" 
              placeholder="امسح باركود البضاعة الخارجة لبيعها فوراً أو اكتب واضغط Enter..."
              onkeydown="if(event.key==='Enter'){event.preventDefault();BarcodeService.handleDedicatedSaleEnter();}"
              class="w-full h-14 pl-28 pr-12 text-base sm:text-lg font-numeric-table font-bold bg-white border-2 border-rose-500 focus:border-rose-600 focus:ring-4 focus:ring-rose-500/20 text-slate-900 rounded-2xl shadow-sm transition-all"
              dir="ltr"
              autocomplete="off"
            />
            <span class="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-rose-600 text-2xl">barcode_scanner</span>
            <div class="absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button 
                type="button" 
                onclick="BarcodeService.openCameraForInput('dedicatedSaleBarcodeInput')" 
                title="مسح بالكاميرا" 
                class="p-2 rounded-xl bg-rose-100 text-rose-800 hover:bg-rose-200 transition-colors">
                <span class="material-symbols-outlined text-lg">photo_camera</span>
              </button>
              <button 
                type="button" 
                onclick="BarcodeService.handleDedicatedSaleEnter()" 
                class="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm">
                بيع فوري
              </button>
            </div>
          </div>

          <!-- Recent Sale Live Feed -->
          <div class="bg-white rounded-2xl p-4 border border-rose-200 shadow-sm space-y-3">
            <div class="flex items-center justify-between border-b border-rose-100 pb-2">
              <h4 class="font-title-md font-bold text-rose-950 text-sm flex items-center gap-1.5">
                <span class="material-symbols-outlined text-rose-600 text-base">history</span>
                <span>سجل البضاعة الخارجة (المباعة) في هذه الجلسة</span>
              </h4>
              <span id="dedicatedSaleCountBadge" class="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 font-numeric-table">0 مبيعات</span>
            </div>
            <div id="dedicatedSaleHistoryFeed" class="space-y-2 max-h-56 overflow-y-auto divide-y divide-slate-100">
              <div class="py-6 text-center text-slate-400 text-xs">لا توجد مبيعات مسجلة بعد في هذه الجلسة. ابدأ بمسح الباركود الآن.</div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function injectControlCardsModal() {
    if (document.getElementById("barcodeControlCardsModal")) return;

    const modal = document.createElement("div");
    modal.id = "barcodeControlCardsModal";
    modal.className = "fixed inset-0 z-[80] hidden bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4";
    modal.innerHTML = `
      <div class="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[94vh] flex flex-col overflow-hidden modal-animate border border-slate-200">
        <!-- Header -->
        <div class="bg-gradient-to-r from-slate-950 via-slate-900 to-navy-dark text-white px-6 py-4 flex items-center justify-between shrink-0 border-b border-slate-800">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-400 shadow-inner">
              <span class="material-symbols-outlined text-3xl">qr_code_2</span>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="font-title-lg font-black text-white text-lg sm:text-xl">🖨️ بطاقات أوامر الباركود المستقلة (2 QR Barcodes)</h3>
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-slate-950">للتحكم السريع</span>
              </div>
              <p class="font-label-md text-slate-300 text-xs sm:text-sm mt-0.5">كود QR لتسجيل البضاعة الداخلة وكود QR لخروج البضاعة؛ اطبع وضعهما بجوار مسدس الباركود</p>
            </div>
          </div>
          <button type="button" onclick="BarcodeService.closeControlCardsModal()" class="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors">
            <span class="material-symbols-outlined text-2xl">close</span>
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6 bg-slate-50">
          <!-- Guide Banner -->
          <div class="bg-amber-50 border-2 border-amber-300/80 rounded-2xl p-4 flex items-start gap-3">
            <span class="material-symbols-outlined text-amber-600 text-2xl shrink-0 mt-0.5">lightbulb</span>
            <div class="text-xs sm:text-sm text-amber-950 space-y-1">
              <p class="font-bold text-sm text-amber-900">كيف تستخدم كودَي الـ QR مع مسدس الباركود؟</p>
              <p>اطبع هذه الورقة وضعها على طاولة الكاشير بجوار مسدس الباركود. عندما تمسح كود <strong>الدخول (الأخضر)</strong> يتحول السيستم في الحال إلى استقبال وتوريد البضاعة. وعندما تمسح كود <strong>الخروج (الأحمر)</strong> يتحول في الحال إلى بيع وخصم البضاعة وإضافة الكاش للخزينة!</p>
            </div>
          </div>

          <!-- The Two Cards Grid -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-5" id="printableQrCardsContainer">
            
            <!-- Card 1: INTAKE QR CODE -->
            <div class="bg-white rounded-3xl p-5 border-2 border-emerald-500 shadow-md flex flex-col items-center text-center space-y-3 relative overflow-hidden">
              <div class="w-full bg-emerald-600 text-white py-2 px-3 rounded-2xl flex items-center justify-between">
                <span class="font-black text-sm sm:text-base flex items-center gap-1.5">
                  <span class="material-symbols-outlined text-xl">add_shopping_cart</span>
                  <span>1. كود تسجيل دخول البضاعة</span>
                </span>
                <span class="px-2 py-0.5 rounded-full bg-emerald-800 text-emerald-100 text-xs font-bold">IN</span>
              </div>

              <!-- 2D QR Code Container -->
              <div id="controlQrIntake" class="w-44 h-44 bg-slate-50 rounded-2xl p-2.5 border border-emerald-200 shadow-inner flex items-center justify-center"></div>

              <!-- 1D Linear Barcode Container -->
              <div class="w-full pt-1">
                <svg id="controlBarcodeIntake" class="w-full max-w-[240px] h-12 mx-auto"></svg>
              </div>

              <div class="text-xs font-bold text-emerald-900 space-y-1 pt-1 border-t border-emerald-100 w-full">
                <div class="flex items-center justify-center gap-2">
                  <span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono">CMD:INTAKE</span>
                  <span class="text-emerald-700 font-semibold">• توريد للمخزن</span>
                </div>
                <p class="text-[11px] text-slate-500 font-normal">يزيد رصيد المخزن تلقائياً ويقيد تكلفة الشراء بالخزينة</p>
              </div>
            </div>

            <!-- Card 2: SALE QR CODE -->
            <div class="bg-white rounded-3xl p-5 border-2 border-rose-500 shadow-md flex flex-col items-center text-center space-y-3 relative overflow-hidden">
              <div class="w-full bg-rose-600 text-white py-2 px-3 rounded-2xl flex items-center justify-between">
                <span class="font-black text-sm sm:text-base flex items-center gap-1.5">
                  <span class="material-symbols-outlined text-xl">shopping_cart_checkout</span>
                  <span>2. كود خروج وبيع البضاعة</span>
                </span>
                <span class="px-2 py-0.5 rounded-full bg-rose-800 text-rose-100 text-xs font-bold">OUT</span>
              </div>

              <!-- 2D QR Code Container -->
              <div id="controlQrSale" class="w-44 h-44 bg-slate-50 rounded-2xl p-2.5 border border-rose-200 shadow-inner flex items-center justify-center"></div>

              <!-- 1D Linear Barcode Container -->
              <div class="w-full pt-1">
                <svg id="controlBarcodeSale" class="w-full max-w-[240px] h-12 mx-auto"></svg>
              </div>

              <div class="text-xs font-bold text-rose-900 space-y-1 pt-1 border-t border-rose-100 w-full">
                <div class="flex items-center justify-center gap-2">
                  <span class="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-mono">CMD:SALE</span>
                  <span class="text-rose-700 font-semibold">• بيع فوري</span>
                </div>
                <p class="text-[11px] text-slate-500 font-normal">يخصم من المخزن تلقائياً ويضيف الفلوس كاش إلى الدرج</p>
              </div>
            </div>

          </div>
        </div>

        <!-- Footer -->
        <div class="bg-white px-6 py-4 border-t border-slate-200 flex items-center justify-between flex-wrap gap-3">
          <div class="flex items-center gap-2 text-xs text-slate-500">
            <span class="material-symbols-outlined text-base text-slate-400">info</span>
            <span>متوافق مع جميع مسدسات الباركود (ليزر و2D) وكاميرات الهواتف والتابلت</span>
          </div>
          <div class="flex items-center gap-2">
            <button 
              type="button" 
              onclick="BarcodeService.printControlCards()" 
              class="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-sm flex items-center gap-2 shadow-lg shadow-blue-600/20 transition-all hover:scale-[1.02] active:scale-[0.98]">
              <span class="material-symbols-outlined text-xl">print</span>
              <span>🖨️ طباعة البطاقتين الآن</span>
            </button>
            <button 
              type="button" 
              onclick="BarcodeService.closeControlCardsModal()" 
              class="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition-colors">
              إغلاق
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function openDedicatedScanner(mode = "intake") {
    setMode(mode);
    if (mode === "intake") {
      injectDedicatedIntakeModal();
      closeDedicatedScanner("sale");
      closeBarcodeIntakeModal();
      const modal = document.getElementById("dedicatedBarcodeIntakeModal");
      if (modal) modal.classList.remove("hidden");
      renderDedicatedIntakeHistory();
      setTimeout(() => {
        document.getElementById("dedicatedIntakeBarcodeInput")?.focus();
      }, 100);
    } else {
      injectDedicatedSaleModal();
      closeDedicatedScanner("intake");
      closeBarcodeIntakeModal();
      const modal = document.getElementById("dedicatedBarcodeSaleModal");
      if (modal) modal.classList.remove("hidden");
      renderDedicatedSaleHistory();
      setTimeout(() => {
        document.getElementById("dedicatedSaleBarcodeInput")?.focus();
      }, 100);
    }
  }

  function closeDedicatedScanner(mode = null) {
    if (!mode || mode === "intake") {
      const m1 = document.getElementById("dedicatedBarcodeIntakeModal");
      if (m1) m1.classList.add("hidden");
    }
    if (!mode || mode === "sale") {
      const m2 = document.getElementById("dedicatedBarcodeSaleModal");
      if (m2) m2.classList.add("hidden");
    }
  }

  async function handleDedicatedIntakeEnter() {
    const inp = document.getElementById("dedicatedIntakeBarcodeInput");
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) return;
    inp.value = "";
    await handleScannedBarcode(val, inp);
    renderDedicatedIntakeHistory();
    setTimeout(() => inp.focus(), 60);
  }

  async function handleDedicatedSaleEnter() {
    const inp = document.getElementById("dedicatedSaleBarcodeInput");
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) return;
    inp.value = "";
    await handleScannedBarcode(val, inp);
    renderDedicatedSaleHistory();
    setTimeout(() => inp.focus(), 60);
  }

  function renderDedicatedIntakeHistory() {
    const feed = document.getElementById("dedicatedIntakeHistoryFeed");
    const badge = document.getElementById("dedicatedIntakeCountBadge");
    if (!feed) return;

    const intakeList = sessionActivityHistory.filter((a) => a.type === "intake");
    if (badge) badge.textContent = `${intakeList.length} عمليات`;

    if (intakeList.length === 0) {
      feed.innerHTML = `<div class="py-6 text-center text-slate-400 text-xs">لا توجد بضاعة مسجلة بعد في هذه الجلسة. ابدأ بمسح الباركود الآن.</div>`;
      return;
    }

    const DB = window.PosDB;
    feed.innerHTML = intakeList
      .slice(0, 15)
      .map((item, idx) => `
        <div class="py-2.5 flex items-center justify-between gap-2 text-xs">
          <div class="min-w-0">
            <span class="font-bold text-slate-900 block truncate">${escapeHtml(item.name)}</span>
            <div class="flex items-center gap-2 text-[11px] text-slate-500 font-numeric-table">
              <span>كود: <strong class="text-slate-700 font-mono">${escapeHtml(item.barcode)}</strong></span>
              <span>•</span>
              <span class="text-emerald-700 font-bold">+${item.qty} قطعة</span>
              <span>•</span>
              <span class="text-rose-600 font-bold">-${DB?.formatMoney(item.amount)} ج.م (الدرج)</span>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0 font-numeric-table">
            <span class="text-slate-400 text-[11px]">${item.time || ""}</span>
            ${idx === 0 ? `
              <button type="button" onclick="BarcodeService.undoLastAction(); BarcodeService.renderDedicatedIntakeHistory();" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-rose-600 font-bold text-[11px] transition-colors" title="تراجع">
                تراجع
              </button>
            ` : ""}
          </div>
        </div>
      `)
      .join("");
  }

  function renderDedicatedSaleHistory() {
    const feed = document.getElementById("dedicatedSaleHistoryFeed");
    const badge = document.getElementById("dedicatedSaleCountBadge");
    if (!feed) return;

    const saleList = sessionActivityHistory.filter((a) => a.type === "sale");
    if (badge) badge.textContent = `${saleList.length} مبيعات`;

    if (saleList.length === 0) {
      feed.innerHTML = `<div class="py-6 text-center text-slate-400 text-xs">لا توجد مبيعات مسجلة بعد في هذه الجلسة. ابدأ بمسح الباركود الآن.</div>`;
      return;
    }

    const DB = window.PosDB;
    feed.innerHTML = saleList
      .slice(0, 15)
      .map((item, idx) => `
        <div class="py-2.5 flex items-center justify-between gap-2 text-xs">
          <div class="min-w-0">
            <span class="font-bold text-slate-900 block truncate">${escapeHtml(item.name)}</span>
            <div class="flex items-center gap-2 text-[11px] text-slate-500 font-numeric-table">
              <span>كود: <strong class="text-slate-700 font-mono">${escapeHtml(item.barcode)}</strong></span>
              <span>•</span>
              <span class="text-rose-600 font-bold">-1 قطعة</span>
              <span>•</span>
              <span class="text-emerald-600 font-bold">+${DB?.formatMoney(item.amount)} ج.م للدرج 💵</span>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0 font-numeric-table">
            <button type="button" onclick="BarcodeService.printSingleSaleReceipt('${escapeHtml(item.name)}', ${item.amount}, '${escapeHtml(item.barcode)}')" class="p-1.5 rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-500 hover:text-white transition-colors" title="طباعة إيصال بيع">
              <span class="material-symbols-outlined text-base">print</span>
            </button>
            ${idx === 0 ? `
              <button type="button" onclick="BarcodeService.undoLastAction(); BarcodeService.renderDedicatedSaleHistory();" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-rose-600 font-bold text-[11px] transition-colors" title="تراجع">
                تراجع
              </button>
            ` : ""}
          </div>
        </div>
      `)
      .join("");
  }

  function printSingleSaleReceipt(name, amount, barcode) {
    const store = window.AppLayout?.getSettings?.().store || {};
    const storeName = store.storeName || "ريد ماجيك";
    const dateStr = new Date().toLocaleDateString("ar-EG");
    const timeStr = new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
    const staffName = window.AppLayout?.getActiveStaffName?.() || "الكاشير";

    const bodyHtml = `
      <div style="font-family:'Cairo', Tahoma, Arial, sans-serif; text-align:center; padding:10px; max-width:300px; margin:0 auto; direction:rtl;">
        <h2 style="margin:0 0 4px 0; font-size:18px;">${escapeHtml(storeName)}</h2>
        <p style="margin:0 0 10px 0; font-size:11px; color:#555;">إيصال بيع بالباركود الفوري</p>
        <div style="border-top:1px dashed #999; border-bottom:1px dashed #999; padding:8px 0; margin:10px 0; text-align:right; font-size:13px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span>الصنف:</span>
            <strong>${escapeHtml(name)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span>الباركود:</span>
            <span style="font-family:monospace;">${escapeHtml(barcode)}</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span>الكمية:</span>
            <strong>1 قطعة</strong>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:15px; font-weight:bold; color:#065f46; margin-top:6px; border-top:1px solid #eee; padding-top:4px;">
            <span>المبلغ المدفوع:</span>
            <span>${window.PosDB?.formatMoney(amount)} ج.م</span>
          </div>
        </div>
        <div style="font-size:10px; color:#777; margin-top:6px;">
          <span>التاريخ: ${dateStr} ${timeStr}</span><br/>
          <span>المسؤول: ${escapeHtml(staffName)}</span>
        </div>
      </div>
    `;
    window.AppLayout?.openPrintWindow?.(`إيصال بيع - ${name}`, bodyHtml);
  }

  function openControlCardsModal() {
    injectControlCardsModal();
    const modal = document.getElementById("barcodeControlCardsModal");
    if (modal) modal.classList.remove("hidden");

    setTimeout(() => {
      // 1. Render Intake QR & Barcode
      const intakeQrBox = document.getElementById("controlQrIntake");
      if (intakeQrBox) {
        intakeQrBox.innerHTML = "";
        if (typeof QRCode !== "undefined") {
          try {
            new QRCode(intakeQrBox, {
              text: "CMD:INTAKE",
              width: 155,
              height: 155,
              colorDark: "#065f46",
              colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.H
            });
          } catch (e) {
            console.warn("QR render error:", e);
          }
        }
      }
      if (typeof JsBarcode !== "undefined") {
        try {
          JsBarcode("#controlBarcodeIntake", "CMD-INTAKE", {
            format: "CODE128",
            lineColor: "#065f46",
            width: 2.1,
            height: 48,
            displayValue: true,
            fontSize: 13,
            font: "Cairo, Arial"
          });
        } catch (e) {}
      }

      // 2. Render Sale QR & Barcode
      const saleQrBox = document.getElementById("controlQrSale");
      if (saleQrBox) {
        saleQrBox.innerHTML = "";
        if (typeof QRCode !== "undefined") {
          try {
            new QRCode(saleQrBox, {
              text: "CMD:SALE",
              width: 155,
              height: 155,
              colorDark: "#9f1239",
              colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.H
            });
          } catch (e) {
            console.warn("QR render error:", e);
          }
        }
      }
      if (typeof JsBarcode !== "undefined") {
        try {
          JsBarcode("#controlBarcodeSale", "CMD-SALE", {
            format: "CODE128",
            lineColor: "#9f1239",
            width: 2.1,
            height: 48,
            displayValue: true,
            fontSize: 13,
            font: "Cairo, Arial"
          });
        } catch (e) {}
      }
    }, 60);
  }

  function closeControlCardsModal() {
    const modal = document.getElementById("barcodeControlCardsModal");
    if (modal) modal.classList.add("hidden");
  }

  function printControlCards() {
    const intakeQrImg = document.querySelector("#controlQrIntake img")?.src || document.querySelector("#controlQrIntake canvas")?.toDataURL();
    const saleQrImg = document.querySelector("#controlQrSale img")?.src || document.querySelector("#controlQrSale canvas")?.toDataURL();
    const intakeBarcodeSvg = document.getElementById("controlBarcodeIntake")?.outerHTML || "";
    const saleBarcodeSvg = document.getElementById("controlBarcodeSale")?.outerHTML || "";

    const store = window.AppLayout?.getSettings?.().store || {};
    const storeName = store.storeName || "ريد ماجيك";

    const bodyHtml = `
      <div style="font-family:'Cairo', Tahoma, Arial, sans-serif; direction:rtl; max-width:680px; margin:0 auto; padding:15px; color:#0f172a;">
        <div style="text-align:center; border-bottom:2px solid #0f172a; padding-bottom:8px; margin-bottom:15px;">
          <h1 style="margin:0; font-size:22px; color:#0f172a;">${escapeHtml(storeName)}</h1>
          <p style="margin:4px 0 0; font-size:13px; color:#475569; font-weight:bold;">بطاقات تحكم الباركود وQR السريعة المستقلة (مسدس الباركود والكاميرا)</p>
          <p style="margin:2px 0 0; font-size:11px; color:#64748b;">اطبع هذه الورقة وقص البطاقتين وضعهما أمام الكاشير للتبديل الفوري بين دخول البضاعة وخروجها دون لمس الجهاز</p>
        </div>

        <div style="display:flex; justify-content:space-between; gap:20px; margin-top:20px;">
          
          <!-- Card 1: INTAKE -->
          <div style="flex:1; border:3px solid #059669; border-radius:18px; padding:14px; text-align:center; background:#f0fdf4;">
            <div style="background:#059669; color:#fff; padding:6px 10px; border-radius:10px; font-weight:bold; font-size:15px; margin-bottom:12px;">
              📥 كود تسجيل دخول البضاعة (IN)
            </div>
            
            <div style="background:#fff; padding:10px; border-radius:14px; display:inline-block; border:1px solid #a7f3d0; margin-bottom:10px;">
              ${intakeQrImg ? `<img src="${intakeQrImg}" style="width:160px; height:160px; display:block;" />` : ''}
            </div>

            <div style="margin:6px 0;">
              ${intakeBarcodeSvg}
            </div>

            <div style="font-size:13px; font-weight:bold; color:#065f46; margin-top:8px; border-top:1px dashed #6ee7b7; padding-top:8px;">
              <span>كود الأمر: </span><code style="background:#d1fae5; padding:2px 6px; border-radius:4px;">CMD:INTAKE</code>
            </div>
            <ul style="font-size:11px; color:#047857; text-align:right; margin:8px 0 0 0; padding-right:16px;">
              <li>زيادة رصيد الصنف بالمخزن (+1)</li>
              <li>خصم فلوس التكلفة من الخزينة</li>
              <li>فتح نموذج التسعير السريع للجديد</li>
            </ul>
          </div>

          <!-- Card 2: SALE -->
          <div style="flex:1; border:3px solid #e11d48; border-radius:18px; padding:14px; text-align:center; background:#fff1f2;">
            <div style="background:#e11d48; color:#fff; padding:6px 10px; border-radius:10px; font-weight:bold; font-size:15px; margin-bottom:12px;">
              📤 كود خروج وبيع البضاعة (OUT)
            </div>
            
            <div style="background:#fff; padding:10px; border-radius:14px; display:inline-block; border:1px solid #fecdd3; margin-bottom:10px;">
              ${saleQrImg ? `<img src="${saleQrImg}" style="width:160px; height:160px; display:block;" />` : ''}
            </div>

            <div style="margin:6px 0;">
              ${saleBarcodeSvg}
            </div>

            <div style="font-size:13px; font-weight:bold; color:#881337; margin-top:8px; border-top:1px dashed #fda4af; padding-top:8px;">
              <span>كود الأمر: </span><code style="background:#ffe4e6; padding:2px 6px; border-radius:4px;">CMD:SALE</code>
            </div>
            <ul style="font-size:11px; color:#be123c; text-align:right; margin:8px 0 0 0; padding-right:16px;">
              <li>خصم رصيد الصنف من المخزن (-1)</li>
              <li>زيادة فلوس البيع كاش في الدرج</li>
              <li>طباعة إيصال وفاتورة فورية</li>
            </ul>
          </div>

        </div>

        <div style="text-align:center; margin-top:25px; padding-top:10px; border-top:1px dashed #cbd5e1; font-size:11px; color:#94a3b8;">
          نظام كاشير ومخازن ريد ماجيك • متوافق مع كافة قارئات الباركود والكاميرات
        </div>
      </div>
    `;

    window.AppLayout?.openPrintWindow?.("بطاقات أوامر الباركود المستقلة", bodyHtml);
  }

  // =========================================================================
  // 8. Dedicated Barcode Hub Modal (F3)
  // =========================================================================
  function injectBarcodeModal() {
    if (document.getElementById("globalBarcodeModal")) return;

    const modal = document.createElement("div");
    modal.id = "globalBarcodeModal";
    modal.className = "fixed inset-0 z-[65] hidden bg-navy-dark/70 backdrop-blur-md flex items-center justify-center p-3 sm:p-4";
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden modal-animate border border-slate-200">
        
        <!-- Header -->
        <div class="bg-gradient-to-r from-navy-dark via-slate-900 to-navy-dark text-white px-5 sm:px-6 py-4 flex items-center justify-between shrink-0 border-b border-slate-800">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400">
              <span class="material-symbols-outlined text-2xl">barcode_scanner</span>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="font-title-lg font-bold text-white">قارئ الباركود — الأتمتة المباشرة للبضاعة والفلوس</h3>
                <span class="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500 text-slate-950">F3</span>
              </div>
              <p class="font-label-md text-slate-300 text-xs sm:text-sm">خصم تلقائي من المخزن وزيادة بالدرج للبيع، وزيادة بالمخزن وخصم من الدرج للتوريد</p>
            </div>
          </div>
          
          <div class="flex items-center gap-2">
            <!-- Label Studio Quick Button -->
            <button type="button" onclick="BarcodeService.openLabelStudio()" class="px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-1 transition-colors" title="توليد وطباعة باركود لأصناف بدون كود">
              <span class="material-symbols-outlined text-base">label</span>
              <span class="hidden sm:inline">توليد ملصق</span>
            </button>

            <!-- Sound Toggle Button -->
            <button type="button" id="barcodeSoundToggleBtn" onclick="BarcodeService.toggleSound()" class="px-2.5 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1 transition-colors" title="تشغيل / كتم نغمة القارئ">
              <span id="barcodeSoundIcon" class="material-symbols-outlined text-base">volume_up</span>
              <span id="barcodeSoundLabel" class="hidden sm:inline">الصوت مفعّل</span>
            </button>

            <!-- Close Modal -->
            <button type="button" onclick="BarcodeService.closeModal()" class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors">
              <span class="material-symbols-outlined text-2xl">close</span>
            </button>
          </div>
        </div>

        <!-- Body / Content Area (Scrollable) -->
        <div class="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-slate-50/60">
          
          <!-- Mode Switcher & Automation Controls Card -->
          <div class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-sm space-y-3">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div class="flex items-center gap-2">
                <span class="font-label-md font-bold text-slate-800">وضع القارئ التلقائي الفوري:</span>
                <div class="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                  <button type="button" id="modalModeSaleBtn" onclick="BarcodeService.setMode('sale')" class="px-3 py-1.5 rounded-lg font-label-md font-bold text-xs flex items-center gap-1 transition-all">
                    <span class="material-symbols-outlined text-base">shopping_cart_checkout</span>
                    <span>خروج بضاعة (بيع تلقائي)</span>
                  </button>
                  <button type="button" id="modalModeIntakeBtn" onclick="BarcodeService.setMode('intake')" class="px-3 py-1.5 rounded-lg font-label-md font-bold text-xs flex items-center gap-1 transition-all">
                    <span class="material-symbols-outlined text-base">add_shopping_cart</span>
                    <span>دخول بضاعة (توريد تلقائي)</span>
                  </button>
                </div>
              </div>

              <!-- Camera Toggle Button -->
              <button type="button" id="toggleCameraScannerBtn" onclick="BarcodeService.toggleCameraScanner()" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface border border-slate-200 font-label-md transition-colors text-xs sm:text-sm">
                <span class="material-symbols-outlined text-base text-primary">photo_camera</span>
                <span id="toggleCameraBtnText">مسح بكاميرا الجهاز</span>
              </button>
            </div>

            <!-- Big Interactive Barcode Input -->
            <div class="relative">
              <input 
                type="text" 
                id="barcodeIntakeInput" 
                data-barcode-input="true"
                placeholder="امسح بالمسدس أو اكتب الكود واضغط Enter للمعاملة الفورية..."
                class="w-full h-13 pl-28 pr-12 text-base sm:text-lg font-numeric-table font-bold bg-slate-50 border-2 border-emerald-500/60 focus:border-emerald-600 focus:bg-white text-on-surface rounded-xl shadow-inner focus:ring-4 focus:ring-emerald-500/20 transition-all"
                dir="ltr"
                autocomplete="off"
              />
              <span class="material-symbols-outlined absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-600 text-2xl pointer-events-none">barcode</span>
              
              <button 
                type="button" 
                onclick="BarcodeService.lookupCurrentInput()" 
                class="absolute left-2 top-1/2 -translate-y-1/2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-label-md font-bold text-xs sm:text-sm shadow-sm transition-colors flex items-center gap-1">
                <span class="material-symbols-outlined text-base">search</span>
                <span>فحص / تنفيذ</span>
              </button>
            </div>
            
            <div class="flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2 pt-1 border-t border-slate-100">
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-sm text-outline">sync_alt</span>
                <span>زر <kbd class="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 font-mono font-bold">F4</kbd> يبدل الوضع في أي وقت</span>
              </span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-sm text-outline">undo</span>
                <span>زر <kbd class="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 font-mono font-bold">Ctrl+Z</kbd> للتراجع الفوري عن آخر مسحة</span>
              </span>
            </div>
          </div>

          <!-- Camera Scanner Viewport (Hidden by default) -->
          <div id="barcodeCameraContainer" class="hidden bg-slate-950 rounded-2xl overflow-hidden p-3 border border-slate-800 shadow-xl space-y-3">
            <div class="flex items-center justify-between text-white px-2">
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
                <span class="font-label-md font-bold text-sm">كاميرا المسح الضوئي تعمل مباشرة</span>
              </div>
              <div class="flex items-center gap-2">
                <button type="button" id="cameraTorchBtn" onclick="BarcodeService.toggleTorch()" class="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition-colors hidden" title="تشغيل الفلاش">
                  <span class="material-symbols-outlined text-lg">flash_on</span>
                </button>
                <button type="button" id="cameraSwitchBtn" onclick="BarcodeService.switchCamera()" class="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition-colors hidden" title="تبديل الكاميرا">
                  <span class="material-symbols-outlined text-lg">cameraswitch</span>
                </button>
                <button type="button" onclick="BarcodeService.stopCamera()" class="p-1.5 rounded-lg bg-red-900/50 text-red-300 hover:text-white transition-colors" title="إغلاق الكاميرا">
                  <span class="material-symbols-outlined text-lg">close</span>
                </button>
              </div>
            </div>

            <div class="relative w-full max-w-md mx-auto aspect-video bg-black rounded-xl overflow-hidden border border-slate-700">
              <div id="barcodeCameraReader" class="w-full h-full"></div>
              
              <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div class="w-64 h-36 border-2 border-emerald-400 rounded-lg relative shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                  <div class="laser-line"></div>
                  <div class="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-emerald-400"></div>
                  <div class="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-emerald-400"></div>
                  <div class="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-emerald-400"></div>
                  <div class="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-emerald-400"></div>
                </div>
              </div>
            </div>
            
            <p class="text-center text-xs text-slate-400">ضع الباركود أو رمز QR داخل المربع الأخضر ليتم التقاطه فوراً</p>
          </div>

          <!-- Dynamic Result Display Area -->
          <div id="barcodeIntakeResultArea">
            <div class="py-12 px-4 text-center bg-white rounded-2xl border border-dashed border-slate-300">
              <div class="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3 shadow-sm">
                <span class="material-symbols-outlined text-3xl">qr_code_scanner</span>
              </div>
              <h4 class="font-title-lg font-bold text-on-surface">بانتظار مسح الصنف</h4>
              <p class="font-body-md text-on-surface-variant max-w-md mx-auto mt-1">
                استخدم مسدس الباركود أو كاميرا الهاتف. في وضع "الخروج" سيتم البيع والخصم فوراً، وفي وضع "الدخول" سيتم التوريد والزيادة فوراً.
              </p>
            </div>
          </div>

          <!-- Recent Session Activity Table -->
          <div id="recentIntakeContainer" class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
            <div class="flex items-center justify-between border-b border-slate-100 pb-2">
              <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-primary text-xl">history</span>
                <span class="font-title-md font-bold text-on-surface">سجل العمليات الحية في هذه الجلسة</span>
              </div>
              <span id="recentIntakeSummary" class="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">0 عمليات</span>
            </div>
            <div id="recentIntakeList" class="max-h-48 overflow-y-auto divide-y divide-slate-100">
              <div class="py-4 text-center text-xs text-slate-400">لم تتم أي عمليات مسح بالباركود بعد.</div>
            </div>
          </div>

        </div>

        <!-- Footer -->
        <div class="bg-white px-5 py-3 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div class="text-xs text-slate-500">
            اختصارات سريعة: <kbd class="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 font-mono font-bold">F4</kbd> لتبديل الوضع • <kbd class="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 font-mono font-bold">Ctrl+Z</kbd> للتراجع
          </div>
          <button type="button" onclick="BarcodeService.closeModal()" class="px-5 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 font-label-md font-semibold transition-colors">
            إغلاق النافذة
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(modal);
    updateSoundUI();
    updateModeUI();
  }

  function openBarcodeIntakeModal(initialCode = "") {
    injectBarcodeModal();
    const modal = document.getElementById("globalBarcodeModal");
    if (modal) {
      modal.classList.remove("hidden");
      updateModeUI();
      const input = document.getElementById("barcodeIntakeInput");
      if (input) {
        input.value = initialCode || "";
        setTimeout(() => {
          input.focus();
          if (initialCode) {
            lookupBarcode(initialCode);
          }
        }, 80);
      }
    }
  }

  function closeBarcodeIntakeModal() {
    stopCamera();
    const modal = document.getElementById("globalBarcodeModal");
    if (modal) {
      modal.classList.add("hidden");
    }
  }

  function lookupCurrentInput() {
    const input = document.getElementById("barcodeIntakeInput");
    if (input && input.value.trim()) {
      handleScannedBarcode(input.value.trim(), input);
      input.value = "";
    }
  }

  // =========================================================================
  // 9. Look up & Render Result: Either Existing Item (Restock) or New Item
  // =========================================================================
  function lookupBarcode(code) {
    const container = document.getElementById("barcodeIntakeResultArea");
    if (!container) return;

    const clean = (code || "").trim();
    if (!clean) {
      container.innerHTML = `
        <div class="py-12 px-4 text-center bg-white rounded-2xl border border-dashed border-slate-300">
          <p class="font-body-md text-on-surface-variant">أدخل أو امسح كود الصنف للبدء</p>
        </div>
      `;
      return;
    }

    const match = findProductByBarcode(clean);
    if (match) {
      playScannerBeep("success");
      renderExistingItemForm(match, clean);
    } else {
      playScannerBeep("success");
      renderNewItemForm(clean);
    }
  }

  function renderExistingItemForm(match, barcode) {
    const container = document.getElementById("barcodeIntakeResultArea");
    if (!container) return;

    const { kind, item } = match;
    const isPhone = kind === "phone";

    const sectionNames = {
      chargers: "مخزن الشواحن والوصلات",
      headphones: "قسم السماعات",
      speakers: "قسم الصبات والمكبرات",
      phones: "مخزن التلفونات"
    };

    const section = item.section || (isPhone ? "phones" : "chargers");
    const itemName = isPhone ? `${item.brand} ${item.model}` : `${item.brand ? item.brand + " - " : ""}${item.name}`;
    const currentStock = isPhone ? (item.isSold ? 0 : 1) : Number(item.qty) || 0;
    const costPrice = Number(item.costPrice) || 0;
    const salePrice = Number(isPhone ? item.sellingPrice : item.salePrice) || 0;

    container.innerHTML = `
      <div class="bg-white rounded-2xl border-2 border-emerald-500/80 p-5 shadow-md space-y-4">
        
        <div class="flex items-center justify-between pb-3 border-b border-slate-100 flex-wrap gap-2">
          <div class="flex items-center gap-2">
            <span class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <span class="material-symbols-outlined text-lg">check_circle</span>
            </span>
            <div>
              <span class="px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800">صنف مسجل مسبقاً بالمخزن</span>
              <h4 class="font-title-lg font-bold text-on-surface mt-0.5">${escapeHtml(itemName)}</h4>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <div class="text-left font-numeric-table hidden sm:block">
              <span class="text-xs text-slate-500 block">القسم: ${escapeHtml(sectionNames[section] || section)}</span>
              <span class="text-sm font-bold text-slate-700">الكود: ${escapeHtml(barcode)}</span>
            </div>
            <button 
              type="button" 
              onclick="BarcodeService.navigateToProductPage('${escapeHtml(barcode)}')" 
              class="px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-500 hover:to-sky-500 text-white font-label-md font-bold text-xs flex items-center gap-1.5 shadow-md shadow-blue-500/20 transition-all hover:scale-[1.02]">
              <span class="material-symbols-outlined text-base">rocket_launch</span>
              <span>الذهاب لصفحة الصنف بالمخزن ⬅</span>
            </button>
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
          <div>
            <span class="text-xs text-slate-500 block">الرصيد الحالي بالمخزن</span>
            <span class="font-numeric-table font-bold text-lg text-emerald-700">${currentStock} ${isPhone ? "جهاز" : "قطعة"}</span>
          </div>
          <div>
            <span class="text-xs text-slate-500 block">سعر الشراء المسجل</span>
            <span class="font-numeric-table font-bold text-base text-slate-800">${window.PosDB?.formatMoney(costPrice)} ج.م</span>
          </div>
          <div>
            <span class="text-xs text-slate-500 block">سعر البيع الحالي</span>
            <span class="font-numeric-table font-bold text-base text-primary">${window.PosDB?.formatMoney(salePrice)} ج.م</span>
          </div>
          <div>
            <span class="text-xs text-slate-500 block">المواصفات</span>
            <span class="text-xs font-semibold text-slate-600 truncate block mt-1">${escapeHtml(item.specs || item.color || "-")}</span>
          </div>
        </div>

        <form id="restockItemForm" onsubmit="BarcodeService.submitRestock(event, '${kind}', '${item.id}')" class="space-y-4 pt-1">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block font-label-md font-bold text-on-surface mb-1">
                ${isPhone ? "إضافة كمية (الهواتف فردية بسيريال)" : "الكمية الموردة الجديدة *"}
              </label>
              <div class="flex items-center gap-1.5">
                <input 
                  type="number" 
                  id="restockQty" 
                  min="1" 
                  step="1" 
                  value="1" 
                  required 
                  ${isPhone ? "readonly disabled" : ""}
                  oninput="BarcodeService.updateRestockCalculations()"
                  class="w-full h-11 px-3 text-center font-numeric-table font-bold text-lg rounded-xl bg-slate-50 border border-slate-300 focus:bg-white focus:ring-2 focus:ring-emerald-500" 
                />
              </div>
              ${!isPhone ? `
                <div class="flex items-center gap-1 mt-1.5 flex-wrap">
                  <button type="button" onclick="BarcodeService.setRestockQty(1)" class="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-xs font-bold">+1</button>
                  <button type="button" onclick="BarcodeService.setRestockQty(5)" class="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-xs font-bold">+5</button>
                  <button type="button" onclick="BarcodeService.setRestockQty(10)" class="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-xs font-bold">+10</button>
                  <button type="button" onclick="BarcodeService.setRestockQty(25)" class="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-xs font-bold">+25</button>
                  <button type="button" onclick="BarcodeService.setRestockQty(50)" class="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-xs font-bold">+50</button>
                </div>
              ` : ""}
            </div>

            <div>
              <label class="block font-label-md font-bold text-on-surface mb-1">سعر الشراء للقطعة (ج.م) *</label>
              <input 
                type="number" 
                id="restockCostPrice" 
                step="0.5" 
                min="0" 
                value="${costPrice}" 
                required 
                oninput="BarcodeService.updateRestockCalculations()"
                class="w-full h-11 px-3 text-left font-numeric-table font-bold rounded-xl bg-slate-50 border border-slate-300 focus:bg-white focus:ring-2 focus:ring-emerald-500" 
                dir="ltr"
              />
            </div>

            <div>
              <label class="block font-label-md font-bold text-on-surface mb-1">سعر البيع للجمهور (ج.م) *</label>
              <input 
                type="number" 
                id="restockSalePrice" 
                step="0.5" 
                min="0" 
                value="${salePrice}" 
                required 
                oninput="BarcodeService.updateRestockCalculations()"
                class="w-full h-11 px-3 text-left font-numeric-table font-bold rounded-xl bg-slate-50 border border-slate-300 focus:bg-white focus:ring-2 focus:ring-emerald-500" 
                dir="ltr"
              />
            </div>
          </div>

          <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-emerald-700">payments</span>
              <div>
                <span class="text-xs text-emerald-800 font-bold block">إجمالي تكلفة البضاعة الموردة:</span>
                <span id="restockTotalCostPreview" class="text-lg font-black font-numeric-table text-emerald-950">${window.PosDB?.formatMoney(costPrice)} ج.م</span>
              </div>
            </div>

            <label class="flex items-center gap-2 cursor-pointer font-label-md text-slate-800">
              <input type="checkbox" id="restockDeductDrawer" ${autoDeductDrawer ? "checked" : ""} class="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 accent-emerald-600" />
              <span>خصم إجمالي التكلفة من درج النقدية (منصرف مشتريات)</span>
            </label>
          </div>

          <div class="flex items-center justify-between gap-3 pt-2">
            <button 
              type="button" 
              onclick="BarcodeService.openLabelStudio({ name: '${escapeHtml(itemName)}', price: '${salePrice}', code: '${escapeHtml(barcode)}' })"
              class="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-label-md font-bold flex items-center gap-1.5 transition-colors">
              <span class="material-symbols-outlined text-lg">print</span>
              <span>طباعة ملصق باركود</span>
            </button>

            <button 
              type="submit" 
              class="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-label-lg font-bold shadow-md shadow-emerald-900/20 flex items-center justify-center gap-2 transition-all">
              <span class="material-symbols-outlined text-xl">add_shopping_cart</span>
              <span>تأكيد زيادة الكمية وتوريد البضاعة للمخزن</span>
            </button>
          </div>
        </form>

      </div>
    `;

    setTimeout(() => {
      document.getElementById("restockQty")?.focus();
      document.getElementById("restockQty")?.select();
    }, 50);
  }

  function setRestockQty(q) {
    const inp = document.getElementById("restockQty");
    if (inp) {
      inp.value = q;
      updateRestockCalculations();
      inp.focus();
    }
  }

  function updateRestockCalculations() {
    const qty = parseInt(document.getElementById("restockQty")?.value, 10) || 0;
    const cost = parseFloat(document.getElementById("restockCostPrice")?.value) || 0;
    const total = qty * cost;
    const preview = document.getElementById("restockTotalCostPreview");
    if (preview) {
      preview.textContent = `${window.PosDB?.formatMoney(total)} ج.م`;
    }
  }

  function renderNewItemForm(barcode) {
    const container = document.getElementById("barcodeIntakeResultArea");
    if (!container) return;

    const detectedSection = detectProductSection(barcode);
    const info = SECTION_INFO_MAP[detectedSection] || SECTION_INFO_MAP.chargers;
    const defaultName = info.generateDefaultName(barcode);

    container.innerHTML = `
      <div class="bg-white rounded-2xl border-2 border-emerald-500 p-4 sm:p-5 shadow-xl space-y-4">
        
        <!-- Smart Section Detection Banner -->
        <div class="flex items-center justify-between pb-3 border-b border-slate-100 flex-wrap gap-2">
          <div class="flex items-center gap-2.5">
            <div class="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <span class="material-symbols-outlined text-2xl" id="smartSectionIcon">${info.icon}</span>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-600 text-white flex items-center gap-1">
                  <span class="material-symbols-outlined text-xs">auto_awesome</span>
                  <span>تم تحديد القسم والمكان تلقائياً</span>
                </span>
              </div>
              <h3 class="font-title-lg font-black text-slate-900 mt-0.5" id="smartSectionTitleDisplay">${escapeHtml(info.name)}</h3>
            </div>
          </div>
          <div class="text-left font-numeric-table bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
            <span class="text-[11px] text-slate-500 block">كود / سيريال:</span>
            <span class="text-sm font-black text-slate-800" dir="ltr">${escapeHtml(barcode)}</span>
          </div>
        </div>

        <!-- 4 One-Click Section Switcher Pills -->
        <div class="space-y-1">
          <div class="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>القسم المكتشف (محدد تلقائياً، ويمكنك تغييره بنقرة واحدة):</span>
            <span class="text-emerald-700 font-bold">جاهز للإدراج والتسعير</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2" id="smartSectionPills">
            <button type="button" onclick="BarcodeService.switchSmartSection('phones', '${escapeHtml(barcode)}')" class="smart-sec-pill p-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${detectedSection === 'phones' ? 'bg-sky-600 text-white border-sky-600 shadow-md ring-2 ring-sky-300' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}">
              <span class="material-symbols-outlined text-base">smartphone</span>
              <span>تليفونات</span>
            </button>
            <button type="button" onclick="BarcodeService.switchSmartSection('headphones', '${escapeHtml(barcode)}')" class="smart-sec-pill p-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${detectedSection === 'headphones' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md ring-2 ring-indigo-300' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}">
              <span class="material-symbols-outlined text-base">headphones</span>
              <span>سماعات</span>
            </button>
            <button type="button" onclick="BarcodeService.switchSmartSection('speakers', '${escapeHtml(barcode)}')" class="smart-sec-pill p-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${detectedSection === 'speakers' ? 'bg-purple-600 text-white border-purple-600 shadow-md ring-2 ring-purple-300' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}">
              <span class="material-symbols-outlined text-base">speaker</span>
              <span>صبات ومكبرات</span>
            </button>
            <button type="button" onclick="BarcodeService.switchSmartSection('chargers', '${escapeHtml(barcode)}')" class="smart-sec-pill p-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${detectedSection === 'chargers' ? 'bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-emerald-300' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}">
              <span class="material-symbols-outlined text-base">power</span>
              <span>شواحن ووصلات</span>
            </button>
          </div>
        </div>

        <form id="newBarcodeItemForm" onsubmit="BarcodeService.submitNewItem(event, '${escapeHtml(barcode)}', true)" class="space-y-4">
          <!-- Hidden Inputs for Auto-populated Metadata -->
          <input type="hidden" id="newItemSection" value="${detectedSection}" />
          <input type="hidden" id="newItemCategory" value="${info.defaultCategory}" />
          <input type="hidden" id="newItemBrand" value="${info.defaultBrand}" />
          <input type="hidden" id="newItemName" value="${escapeHtml(defaultName)}" />
          <input type="hidden" id="newItemSpecs" value="" />

          <!-- PRIMARY FOCUSED FIELD: ONLY SALE PRICE IS REQUIRED! -->
          <div class="bg-gradient-to-r from-emerald-50 via-teal-50 to-sky-50 p-4 rounded-2xl border-2 border-emerald-500 shadow-sm space-y-1.5">
            <label for="newItemSalePrice" class="block font-title-lg font-black text-emerald-950 flex items-center justify-between">
              <span class="flex items-center gap-1.5">
                <span class="material-symbols-outlined text-2xl text-emerald-600">payments</span>
                <span>سعر البيع المطلوب للجمهور (ج.م) *</span>
              </span>
              <span class="text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full">الحقل الوحيد المطلوب</span>
            </label>
            <div class="relative">
              <input 
                type="number" 
                id="newItemSalePrice" 
                step="0.5" 
                min="0.5" 
                required 
                autofocus
                placeholder="اكتب السعر واضغط Enter..." 
                oninput="BarcodeService.updateNewItemCalculations()"
                class="w-full h-14 pl-16 pr-4 text-2xl font-numeric-table font-black text-emerald-900 bg-white border-2 border-emerald-500 rounded-xl focus:ring-4 focus:ring-emerald-400/30 shadow-inner" 
                dir="ltr"
              />
              <span class="absolute left-4 top-1/2 -translate-y-1/2 font-title-lg font-black text-emerald-700">ج.م</span>
            </div>
            <p class="text-xs text-emerald-800 font-bold pr-1">
              ⚡ لا تحتاج لإدخال أي بيانات أخرى! النظام حدد نوع الصنف ومكانه تلقائياً. اكتب السعر واضغط Enter.
            </p>
          </div>

          <!-- Optional Row: Cost Price & Quantity -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div>
              <label for="newItemCostPrice" class="block text-xs font-bold text-slate-600 mb-1">سعر الشراء / تكلفة الجملة (اختياري)</label>
              <div class="relative">
                <input 
                  type="number" 
                  id="newItemCostPrice" 
                  step="0.5" 
                  min="0" 
                  placeholder="0.00" 
                  oninput="BarcodeService.updateNewItemCalculations()"
                  class="w-full h-10 px-3 pl-12 rounded-lg bg-white border border-slate-300 font-numeric-table font-bold text-sm" 
                  dir="ltr"
                />
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">ج.م</span>
              </div>
            </div>

            <div>
              <label for="newItemInitialQty" class="block text-xs font-bold text-slate-600 mb-1">الكمية المستلمة بالمخزن</label>
              <input 
                type="number" 
                id="newItemInitialQty" 
                step="1" 
                min="1" 
                value="1" 
                required 
                oninput="BarcodeService.updateNewItemCalculations()"
                class="w-full h-10 px-3 text-center rounded-lg bg-white border border-slate-300 font-numeric-table font-bold text-sm" 
              />
            </div>

            <div class="sm:col-span-2 flex items-center justify-between text-xs pt-1 border-t border-slate-200/80">
              <label class="flex items-center gap-2 cursor-pointer font-bold text-slate-700">
                <input type="checkbox" id="newItemDeductDrawer" ${autoDeductDrawer ? "checked" : ""} class="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 accent-emerald-600" />
                <span>خصم تكلفة الشراء من درج النقدية تلقائياً</span>
              </label>
              <span id="newItemMarginPreview" class="font-numeric-table font-bold text-emerald-700"></span>
            </div>
          </div>

          <!-- Optional Collapsible Details (If custom name is desired) -->
          <details class="text-xs text-slate-500 border border-slate-200 rounded-xl p-2.5">
            <summary class="cursor-pointer font-bold text-slate-700 hover:text-primary">
              تعديل اسم الصنف أو الماركة (اختياري - تم التسمية تلقائياً)
            </summary>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-200">
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-0.5">اسم وموديل الصنف</label>
                <input type="text" id="customItemName" oninput="document.getElementById('newItemName').value=this.value" value="${escapeHtml(defaultName)}" class="w-full h-9 px-2.5 rounded-lg bg-white border border-slate-300 text-xs" />
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-600 mb-0.5">الماركة / الشركة</label>
                <input type="text" id="customItemBrand" oninput="document.getElementById('newItemBrand').value=this.value" value="${escapeHtml(info.defaultBrand)}" class="w-full h-9 px-2.5 rounded-lg bg-white border border-slate-300 text-xs" />
              </div>
            </div>
          </details>

          <!-- Action Buttons -->
          <div class="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-2">
            <button 
              type="button" 
              onclick="BarcodeService.submitNewItem(null, '${escapeHtml(barcode)}', false)"
              class="w-full sm:w-auto px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-label-md font-bold flex items-center justify-center gap-1.5 transition-colors" title="حفظ هذا الصنف والاستمرار في مسح وتصوير أصناف أخرى">
              <span class="material-symbols-outlined text-lg">photo_camera</span>
              <span>حفظ ومتابعة التصوير 📸</span>
            </button>

            <button 
              type="submit" 
              class="w-full sm:w-auto flex-1 px-6 py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-500 hover:to-teal-500 text-white font-title-md font-black shadow-lg shadow-emerald-900/30 ring-2 ring-emerald-400/50 flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]">
              <span class="material-symbols-outlined text-xl">rocket_launch</span>
              <span id="saveAndGoBtnText">حفظ والذهاب لصفحة القسم (${escapeHtml(info.name)}) ⬅</span>
            </button>
          </div>
        </form>

      </div>
    `;

    setTimeout(() => {
      const priceInp = document.getElementById("newItemSalePrice");
      if (priceInp) {
        priceInp.focus();
        priceInp.select();
      }
    }, 60);
  }

  function handleSectionChange() {
    const secSelect = document.getElementById("newItemSection");
    const catSelect = document.getElementById("newItemCategory");
    if (!secSelect || !catSelect) return;

    const sec = secSelect.value;
    const catOptions = {
      chargers: [
        { key: "CHARGER", label: "شاحن كامل (Charger)" },
        { key: "HEAD", label: "رأس شاحن (Head)" },
        { key: "TYPE_C", label: "وصلة Type-C عريضة" },
        { key: "MICRO", label: "وصلة Micro USB عادية" },
        { key: "LIGHTNING", label: "وصلة آيفون Lightning" }
      ],
      headphones: [
        { key: "IN_EAR", label: "سماعة جلدة (In-Ear)" },
        { key: "BONE", label: "سماعة عظم (Bone)" },
        { key: "BLUETOOTH", label: "سماعة بلوتوث (Wireless)" }
      ],
      speakers: [
        { key: "SMALL", label: "صب صغير (Small)" },
        { key: "MEDIUM", label: "صب وسط (Medium)" },
        { key: "LARGE", label: "صب كبير (Party)" }
      ],
      phones: [
        { key: "NEW", label: "هاتف جديد كرتونة" },
        { key: "USED", label: "هاتف مستعمل / كسر زيرو" }
      ]
    };

    const list = catOptions[sec] || catOptions.chargers;
    catSelect.innerHTML = list.map((c) => `<option value="${c.key}">${escapeHtml(c.label)}</option>`).join("");
  }

  function updateNewItemCalculations() {
    const cost = parseFloat(document.getElementById("newItemCostPrice")?.value) || 0;
    const sale = parseFloat(document.getElementById("newItemSalePrice")?.value) || 0;
    const qty = parseInt(document.getElementById("newItemInitialQty")?.value, 10) || 0;

    const diff = sale - cost;
    const marginEl = document.getElementById("newItemMarginPreview");
    const totalEl = document.getElementById("newItemTotalCostPreview");

    if (marginEl) {
      marginEl.textContent = `${window.PosDB?.formatMoney(diff)} ج.م`;
      marginEl.className = diff >= 0 ? "text-sm font-bold font-numeric-table text-emerald-700" : "text-sm font-bold font-numeric-table text-red-600";
    }
    if (totalEl) {
      totalEl.textContent = `${window.PosDB?.formatMoney(cost * qty)} ج.م`;
    }
  }

  async function submitRestock(e, kind, id) {
    if (e) e.preventDefault();
    const DB = window.PosDB;
    if (!DB) return;

    const addQty = parseInt(document.getElementById("restockQty")?.value, 10) || 1;
    const newCost = parseFloat(document.getElementById("restockCostPrice")?.value) || 0;
    const newSale = parseFloat(document.getElementById("restockSalePrice")?.value) || 0;
    const deduct = document.getElementById("restockDeductDrawer")?.checked;

    try {
      if (kind === "phone") {
        await DB.updatePhone(id, {
          costPrice: newCost,
          sellingPrice: newSale,
          isSold: false
        });
        window.AppLayout?.showToast?.("تم تحديث بيانات الهاتف بنجاح");
      } else {
        const item = inventoryCache.find((x) => x.id === id);
        const curQty = item ? Number(item.qty) || 0 : 0;
        const finalQty = curQty + addQty;

        await DB.updateInventoryItem(id, {
          qty: finalQty,
          costPrice: newCost,
          salePrice: newSale
        });

        const totalCost = newCost * addQty;
        if (deduct && totalCost > 0) {
          await DB.addDrawerTx({
            type: "expense",
            source: item?.section || "chargers",
            amount: totalCost,
            direction: "out",
            reason: `توريد بضاعة: ${item?.name || ""} (+${addQty} قطع)`,
            staffName: window.AppLayout?.getActiveStaffName?.() || "الكاشير"
          });
        }

        playScannerBeep("restock");
        window.AppLayout?.showToast?.("تمت زيادة الكمية بالمخزن بنجاح", `+${addQty} قطعة (${item?.name || ""})`);

        const action = {
          type: "intake",
          kind: "inventory",
          item,
          name: item?.name || "صنف",
          barcode: item?.barcode || "",
          qty: addQty,
          newStock: finalQty,
          amount: totalCost,
          time: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
        };
        lastAction = action;
        showLiveTransactionBanner(action);
        logSessionLiveActivity(action);
      }

      resetIntakeScreen();
    } catch (err) {
      playScannerBeep("error");
      window.AppLayout?.showToast?.("تعذر حفظ التوريد", err.message, true);
    }
  }

  async function submitNewItem(e, barcode, shouldNavigate = true) {
    if (e) e.preventDefault();
    const DB = window.PosDB;
    if (!DB) return;

    const section = document.getElementById("newItemSection")?.value || detectProductSection(barcode);
    const info = SECTION_INFO_MAP[section] || SECTION_INFO_MAP.chargers;
    const category = document.getElementById("newItemCategory")?.value || info.defaultCategory;
    const brand = (document.getElementById("newItemBrand")?.value || "").trim() || info.defaultBrand;
    const name = (document.getElementById("newItemName")?.value || "").trim() || info.generateDefaultName(barcode);
    const specs = (document.getElementById("newItemSpecs")?.value || "").trim();
    const costPrice = parseFloat(document.getElementById("newItemCostPrice")?.value) || 0;
    const salePrice = parseFloat(document.getElementById("newItemSalePrice")?.value) || 0;
    const qty = parseInt(document.getElementById("newItemInitialQty")?.value, 10) || 1;
    const deduct = document.getElementById("newItemDeductDrawer")?.checked;

    if (!salePrice || salePrice <= 0) {
      window.AppLayout?.showToast?.("يرجى إدخال سعر البيع", "سعر البيع مطلوب لإدراج الصنف في الكاشير", true);
      document.getElementById("newItemSalePrice")?.focus();
      return;
    }

    try {
      if (section === "phones") {
        await DB.addPhone({
          brand,
          model: name,
          specs: specs || "سيريال أساسي",
          condition: category === "NEW" ? "جديد كرتونة متبرشم" : "مستعمل بحالة ممتازة",
          color: "افتراضي",
          imei1: barcode,
          costPrice,
          sellingPrice: salePrice,
          supplier: "مسح باركود ذكي",
          receivedDate: DB.todayDateStr()
        });
      } else {
        await DB.addInventoryItem({
          section,
          barcode,
          brand,
          name,
          category,
          specs,
          costPrice,
          salePrice,
          qty
        });
      }

      const totalCost = costPrice * qty;
      if (deduct && totalCost > 0) {
        await DB.addDrawerTx({
          type: "expense",
          source: section,
          amount: totalCost,
          direction: "out",
          reason: `شراء بضاعة جديدة بالباركود: ${brand} - ${name} (${qty} قطع)`,
          staffName: window.AppLayout?.getActiveStaffName?.() || "الكاشير"
        });
      }

      playScannerBeep("restock");
      window.AppLayout?.showToast?.("تم حفظ الصنف وتحديد مكانه بالمخزن بنجاح", `${name} بسعر ${DB.formatMoney(salePrice)} ج.م`);

      const action = {
        type: "intake",
        kind: section === "phones" ? "phone" : "inventory",
        name: `${brand ? brand + " - " : ""}${name}`,
        barcode,
        qty,
        newStock: qty,
        amount: totalCost,
        time: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
      };
      lastAction = action;
      showLiveTransactionBanner(action);
      logSessionLiveActivity(action);

      if (shouldNavigate) {
        closeBarcodeIntakeModal();
        const pageMap = {
          phones: "phones.html",
          headphones: "headphones.html",
          speakers: "speakers.html",
          chargers: "chargers.html"
        };
        const targetPage = pageMap[section] || "chargers.html";
        window.location.href = `${targetPage}?search=${encodeURIComponent(barcode)}&highlight=${encodeURIComponent(barcode)}`;
      } else {
        const priceInp = document.getElementById("newItemSalePrice");
        if (priceInp) priceInp.value = "";
        window.AppLayout?.showToast?.("تم الحفظ بنجاح", "جاهز لمسح أو تصوير الصنف التالي 📸");
        resetIntakeScreen();
      }
    } catch (err) {
      playScannerBeep("error");
      window.AppLayout?.showToast?.("تعذر حفظ الصنف", err.message, true);
    }
  }

  function resetIntakeScreen() {
    const inp = document.getElementById("barcodeIntakeInput");
    if (inp) {
      inp.value = "";
      inp.focus();
    }
    const resultArea = document.getElementById("barcodeIntakeResultArea");
    if (resultArea) {
      resultArea.innerHTML = `
        <div class="py-8 px-4 text-center bg-emerald-50/50 rounded-2xl border border-emerald-200">
          <div class="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-2">
            <span class="material-symbols-outlined text-2xl">check</span>
          </div>
          <h4 class="font-title-md font-bold text-emerald-950">تم حفظ المعاملة بنجاح!</h4>
          <p class="font-body-sm text-emerald-700 mt-1">القارئ جاهز الآن لمسح الصنف التالي...</p>
        </div>
      `;
    }
  }

  function logSessionLiveActivity(action) {
    sessionActivityHistory.unshift(action);
    renderRecentIntakeHistory();
    renderDedicatedIntakeHistory();
    renderDedicatedSaleHistory();
  }

  function renderRecentIntakeHistory() {
    const container = document.getElementById("recentIntakeList");
    const summary = document.getElementById("recentIntakeSummary");
    if (!container) return;

    if (sessionActivityHistory.length === 0) {
      container.innerHTML = `<div class="py-4 text-center text-xs text-slate-400">لم تتم أي عمليات مسح بالباركود بعد.</div>`;
      if (summary) summary.textContent = "0 عمليات";
      return;
    }

    if (summary) {
      summary.textContent = `${sessionActivityHistory.length} عملية حية`;
    }

    container.innerHTML = sessionActivityHistory.map((item) => {
      const isSale = item.type === "sale";
      return `
        <div class="py-2.5 flex items-center justify-between gap-3 text-xs">
          <div class="min-w-0">
            <div class="font-bold text-slate-800 truncate">${escapeHtml(item.name)}</div>
            <div class="font-numeric-table text-slate-500 font-mono">${escapeHtml(item.barcode)} • ${escapeHtml(item.time)}</div>
          </div>
          <div class="flex items-center gap-3 shrink-0 font-numeric-table">
            <span class="px-2 py-0.5 rounded font-bold ${isSale ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}">
              ${isSale ? "خروج (بيع) -1" : `دخول (توريد) +${item.qty}`}
            </span>
            <span class="font-bold text-slate-800">${window.PosDB?.formatMoney(item.amount)} ج.م</span>
          </div>
        </div>
      `;
    }).join("");
  }

  // =========================================================================
  // 10. Camera Barcode Scanning (Html5Qrcode Integration)
  // =========================================================================
  async function toggleCameraScanner() {
    const container = document.getElementById("barcodeCameraContainer");
    if (!container) return;

    if (!container.classList.contains("hidden")) {
      stopCamera();
    } else {
      startCamera();
    }
  }

  async function startCamera() {
    const container = document.getElementById("barcodeCameraContainer");
    const btnText = document.getElementById("toggleCameraBtnText");
    if (container) container.classList.remove("hidden");
    if (btnText) btnText.textContent = "إيقاف الكاميرا";

    if (typeof Html5Qrcode === "undefined") {
      window.AppLayout?.showToast?.("مكتبة الكاميرا غير محملة بعد", "جاري المحاولة...", true);
      return;
    }

    try {
      if (!html5QrScanner) {
        html5QrScanner = new Html5Qrcode("barcodeCameraReader");
      }

      const devices = await Html5Qrcode.getCameras();
      availableCameras = devices || [];

      const switchBtn = document.getElementById("cameraSwitchBtn");
      if (switchBtn && availableCameras.length > 1) {
        switchBtn.classList.remove("hidden");
      }

      const backCam = availableCameras.find((d) => d.label.toLowerCase().includes("back") || d.label.toLowerCase().includes("rear"));
      currentCameraId = backCam ? backCam.id : (availableCameras[0] ? availableCameras[0].id : { facingMode: "environment" });

      const config = {
        fps: 15,
        qrbox: { width: 260, height: 160 },
        aspectRatio: 1.777778
      };

      await html5QrScanner.start(
        currentCameraId,
        config,
        (decodedText) => {
          onCameraScanSuccess(decodedText);
        },
        () => {}
      );

      const torchBtn = document.getElementById("cameraTorchBtn");
      if (torchBtn) torchBtn.classList.remove("hidden");

    } catch (err) {
      console.error("Camera start error:", err);
      window.AppLayout?.showToast?.("تعذر تشغيل الكاميرا", "تأكد من إعطاء إذن الكاميرا للمتصفح", true);
      stopCamera();
    }
  }

  async function stopCamera() {
    if (html5QrScanner) {
      try {
        await html5QrScanner.stop();
      } catch (e) {}
    }
    const container = document.getElementById("barcodeCameraContainer");
    const btnText = document.getElementById("toggleCameraBtnText");
    if (container) container.classList.add("hidden");
    if (btnText) btnText.textContent = "مسح بكاميرا الجهاز";
  }

  async function switchCamera() {
    if (availableCameras.length <= 1) return;
    const curIdx = availableCameras.findIndex((c) => c.id === currentCameraId);
    const nextIdx = (curIdx + 1) % availableCameras.length;
    currentCameraId = availableCameras[nextIdx].id;
    await stopCamera();
    await startCamera();
  }

  async function toggleTorch() {
    if (!html5QrScanner) return;
    try {
      isTorchOn = !isTorchOn;
      await html5QrScanner.applyVideoConstraints({
        advanced: [{ torch: isTorchOn }]
      });
      const icon = document.querySelector("#cameraTorchBtn span");
      if (icon) icon.textContent = isTorchOn ? "flash_off" : "flash_on";
    } catch (e) {
      console.warn("Torch not supported", e);
    }
  }

  function onCameraScanSuccess(text) {
    if (!text) return;

    if (targetInputForCamera) {
      const el = document.getElementById(targetInputForCamera);
      const camTarget = targetInputForCamera;
      if (el) {
        el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        playScannerBeep("success");
        window.AppLayout?.showToast?.("تم التقاط الباركود بالكاميرا", text);
        closeCameraInputModal();

        if (camTarget === "dedicatedIntakeBarcodeInput") {
          handleDedicatedIntakeEnter();
        } else if (camTarget === "dedicatedSaleBarcodeInput") {
          handleDedicatedSaleEnter();
        }
        return;
      }
    }

    const input = document.getElementById("barcodeIntakeInput");
    if (input) {
      input.value = text;
    }
    handleScannedBarcode(text, input);
  }

  function toggleOpticalCamera() {
    const intakeModal = document.getElementById("dedicatedBarcodeIntakeModal");
    const isIntakeOpen = intakeModal && !intakeModal.classList.contains("hidden");
    const saleModal = document.getElementById("dedicatedBarcodeSaleModal");
    const isSaleOpen = saleModal && !saleModal.classList.contains("hidden");

    if (isSaleOpen) {
      openCameraForInput("dedicatedSaleBarcodeInput");
    } else if (isIntakeOpen) {
      openCameraForInput("dedicatedIntakeBarcodeInput");
    } else {
      if (autoMode === "sale") {
        openDedicatedScanner("sale");
        setTimeout(() => openCameraForInput("dedicatedSaleBarcodeInput"), 120);
      } else {
        openDedicatedScanner("intake");
        setTimeout(() => openCameraForInput("dedicatedIntakeBarcodeInput"), 120);
      }
    }
  }

  function openCameraForInput(targetInputId) {
    targetInputForCamera = targetInputId;
    injectCameraInputModal();
    const modal = document.getElementById("barcodeCameraInputModal");
    if (modal) {
      modal.classList.remove("hidden");
      startInputCamera();
    }
  }

  function closeCameraInputModal() {
    targetInputForCamera = null;
    const modal = document.getElementById("barcodeCameraInputModal");
    if (modal) modal.classList.add("hidden");
    if (window._inputHtml5Scanner) {
      try {
        window._inputHtml5Scanner.stop();
      } catch (e) {}
    }
  }

  function injectCameraInputModal() {
    if (document.getElementById("barcodeCameraInputModal")) return;

    const modal = document.createElement("div");
    modal.id = "barcodeCameraInputModal";
    modal.className = "fixed inset-0 z-[75] hidden bg-navy-dark/75 backdrop-blur-md flex items-center justify-center p-4";
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden modal-animate border border-slate-200">
        <div class="bg-navy-dark text-white px-5 py-4 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-emerald-400 text-xl">photo_camera</span>
            <span class="font-title-md font-bold">مسح الباركود بالكاميرا</span>
          </div>
          <button type="button" onclick="BarcodeService.closeCameraInputModal()" class="text-slate-400 hover:text-white">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="p-4 bg-slate-950 flex flex-col items-center">
          <div class="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-slate-700">
            <div id="inputCameraReader" class="w-full h-full"></div>
            <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div class="w-56 h-32 border-2 border-emerald-400 rounded-lg relative shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                <div class="laser-line"></div>
              </div>
            </div>
          </div>
          <p class="text-xs text-slate-400 mt-3 text-center">وجّه كاميرا الهاتف نحو باركود الصنف لتعبئة الحقل مباشرة</p>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  async function startInputCamera() {
    if (typeof Html5Qrcode === "undefined") return;
    try {
      if (!window._inputHtml5Scanner) {
        window._inputHtml5Scanner = new Html5Qrcode("inputCameraReader");
      }
      await window._inputHtml5Scanner.start(
        { facingMode: "environment" },
        { fps: 15, qrbox: { width: 240, height: 140 }, aspectRatio: 1.777778 },
        (text) => onCameraScanSuccess(text),
        () => {}
      );
    } catch (e) {
      console.warn("Input camera error:", e);
      window.AppLayout?.showToast?.("تعذر تشغيل الكاميرا", "", true);
      closeCameraInputModal();
    }
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // =========================================================================
  // 11. Initialization & Subscriptions
  // =========================================================================
  function init() {
    initHardwareScannerListener();
    injectLiveTransactionBanner();

    if (window.PosDB) {
      window.PosDB.subscribeAllInventory((items) => {
        inventoryCache = items || [];
      });
      window.PosDB.subscribePhones((phones) => {
        phonesCache = phones || [];
      });
    }

    // Keybindings F3, F4, F6 & F7
    window.addEventListener("keydown", (e) => {
      if (e.key === "F3") {
        e.preventDefault();
        openBarcodeIntakeModal();
      } else if (e.key === "F4") {
        e.preventDefault();
        toggleMode();
      } else if (e.key === "F6") {
        e.preventDefault();
        openDedicatedScanner("intake");
      } else if (e.key === "F7") {
        e.preventDefault();
        openDedicatedScanner("sale");
      }
    });

    updateModeUI();
  }

  // Global API
  window.BarcodeService = {
    init,
    getMode: () => autoMode,
    setMode,
    toggleMode,
    undoLastAction,
    openModal: openBarcodeIntakeModal,
    closeModal: closeBarcodeIntakeModal,
    // Independent 2 QR Barcode System:
    openDedicatedScanner,
    closeDedicatedScanner,
    handleDedicatedIntakeEnter,
    handleDedicatedSaleEnter,
    renderDedicatedIntakeHistory,
    renderDedicatedSaleHistory,
    printSingleSaleReceipt,
    // Printable 2 QR Control Cards:
    openControlCardsModal,
    closeControlCardsModal,
    printControlCards,
    // Product Section & Routing:
    findProductByBarcode,
    detectProductSection,
    navigateToProductPage,
    switchSmartSection,
    executeDirectSale,
    executeDirectIntake,
    // Scanner & Camera:
    lookupCurrentInput,
    toggleCameraScanner,
    toggleOpticalCamera,
    switchCamera,
    toggleTorch,
    stopCamera,
    toggleSound,
    playBeep: playScannerBeep,
    setRestockQty,
    updateRestockCalculations,
    updateNewItemCalculations,
    handleSectionChange,
    submitRestock,
    submitNewItem,
    openCameraForInput,
    closeCameraInputModal,
    // Barcode Generator & Label Studio API:
    openLabelStudio,
    closeLabelStudio,
    generateNewStudioCode,
    setLabelCopies,
    renderStudioBarcode,
    printBarcodeLabels,
    applyStudioBarcodeToInput
  };

  document.addEventListener("DOMContentLoaded", init);
})();
