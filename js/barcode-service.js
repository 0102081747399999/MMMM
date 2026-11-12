// Barcode & QR Scanner Service for POS Inventory Intake & Quick Sales
// Supports: Hardware USB/Bluetooth Scanners, Camera Scanning (Html5Qrcode), Web Audio Beeps, and Quick Goods Intake
(function () {
  let audioCtx = null;
  let soundEnabled = localStorage.getItem("pos_barcode_sound_enabled") !== "false";
  let html5QrScanner = null;
  let currentCameraId = null;
  let availableCameras = [];
  let isTorchOn = false;
  let targetInputForCamera = null;

  // Keystroke scanner detector state
  let keyBuffer = "";
  let lastKeyTime = 0;
  const SCANNER_CHAR_INTERVAL_MS = 60; // Max time between characters from a hardware scanner gun
  const MIN_BARCODE_LENGTH = 3;

  // In-memory caches for fast barcode lookups
  let inventoryCache = [];
  let phonesCache = [];
  let sessionIntakeHistory = [];

  // =========================================================================
  // 1. Audio Synthesizer (Zero-dependency Web Audio POS Beep)
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

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      if (type === "success") {
        // High crisp retail POS beep (1850Hz)
        osc.type = "sine";
        osc.frequency.setValueAtTime(1850, now);
        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === "restock") {
        // Cheerful double beep for successful stock-in (1750Hz then 2200Hz)
        osc.type = "sine";
        osc.frequency.setValueAtTime(1750, now);
        osc.frequency.setValueAtTime(2200, now + 0.07);
        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.16);
      } else if (type === "error") {
        // Low double buzz for duplicate or not found
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.setValueAtTime(240, now + 0.09);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
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
  // 2. Hardware Barcode Scanner Detection (USB & Wireless Keyboard Wedge)
  // =========================================================================
  function initHardwareScannerListener() {
    window.addEventListener("keydown", (e) => {
      // Don't intercept function keys or navigation
      if (e.key === "F1" || e.key === "F2" || e.key === "F3" || e.key === "F4" || e.key === "Escape") {
        keyBuffer = "";
        return;
      }

      const activeEl = document.activeElement;
      const isBarcodeSpecificInput =
        activeEl &&
        (activeEl.id === "barcodeIntakeInput" ||
          activeEl.id === "itemBarcode" ||
          activeEl.id === "deviceImei1" ||
          activeEl.id === "deviceImei2" ||
          activeEl.id === "posSearchInput" ||
          activeEl.hasAttribute("data-barcode-input"));

      const now = Date.now();
      const interval = now - lastKeyTime;
      lastKeyTime = now;

      if (e.key === "Enter") {
        const trimmed = keyBuffer.trim();
        // Check if buffer contains a barcode (at least 3 chars)
        if (trimmed.length >= MIN_BARCODE_LENGTH) {
          // If rapid entry (< 60ms/char) OR currently focused on a barcode input:
          e.preventDefault();
          const scannedCode = trimmed;
          keyBuffer = "";
          handleScannedBarcode(scannedCode, isBarcodeSpecificInput ? activeEl : null);
          return;
        }

        // If user pressed Enter directly inside the barcode intake input:
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

      // Record printable characters only
      if (e.key && e.key.length === 1) {
        // If not in a barcode-specific input, check timing to distinguish human typing from scanner
        if (!isBarcodeSpecificInput) {
          if (interval > SCANNER_CHAR_INTERVAL_MS && keyBuffer.length > 0) {
            // Human is typing slowly somewhere else; reset buffer to current char
            keyBuffer = e.key;
          } else {
            keyBuffer += e.key;
          }
        } else {
          // Inside a barcode input, buffer collects all chars
          keyBuffer += e.key;
        }
      }
    }, true);
  }

  // =========================================================================
  // 3. Central Barcode Dispatcher & Resolver
  // =========================================================================
  function findProductByBarcode(code) {
    if (!code) return null;
    const clean = code.trim().toLowerCase();

    // Check inventory items (chargers, headphones, speakers)
    const inv = inventoryCache.find(
      (item) => item.barcode && item.barcode.trim().toLowerCase() === clean
    );
    if (inv) {
      return { kind: "inventory", item: inv };
    }

    // Check phones (by imei1, imei2 or barcode if present)
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

  function handleScannedBarcode(code, sourceElement = null) {
    if (!code) return;
    const cleanCode = code.trim();
    if (!cleanCode) return;

    // 1. If currently inside the global POS quick cashier (F1)
    const posModal = document.getElementById("globalPosModal");
    const isPosOpen = posModal && !posModal.classList.contains("hidden");
    if (isPosOpen) {
      handlePosModalScan(cleanCode);
      return;
    }

    // 2. If currently inside the "Add Item" modal (#addItemModal) on chargers/headphones/speakers
    const addItemModal = document.getElementById("addItemModal");
    const isAddItemOpen = addItemModal && !addItemModal.classList.contains("hidden");
    if (isAddItemOpen) {
      handleAddItemModalScan(cleanCode);
      return;
    }

    // 3. If on phones page and form is visible / focused
    const phoneInput = document.getElementById("deviceImei1");
    if (sourceElement && (sourceElement.id === "deviceImei1" || sourceElement.id === "deviceImei2")) {
      sourceElement.value = cleanCode;
      playScannerBeep("success");
      window.AppLayout?.showToast?.("تم مسح السيريال IMEI", cleanCode);
      return;
    }

    // 4. Default / Global Handling: Route to Barcode Intake Hub
    playScannerBeep("success");
    openBarcodeIntakeModal(cleanCode);
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
        playScannerBeep("success");
        window.AppLayout?.showToast?.("تمت إضافة الهاتف للفاتورة", `${match.item.brand} ${match.item.model}`);
      } else {
        const curStock = Number(match.item.qty) || 0;
        if (curStock <= 0) {
          playScannerBeep("error");
          window.AppLayout?.showToast?.("نفذت كمية هذا الصنف من المخزن!", match.item.name, true);
          return;
        }
        window.AppLayout?.addToPosCart?.("inventory", match.item.id);
        playScannerBeep("success");
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

      // Check if duplicate in the current section
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
        // Move focus cleanly to itemBrand or itemName
        setTimeout(() => {
          const brandInp = document.getElementById("itemBrand");
          if (brandInp && !brandInp.value) brandInp.focus();
          else document.getElementById("itemName")?.focus();
        }, 50);
      }
    }
  }

  // =========================================================================
  // 4. Dedicated Barcode Intake & Goods Stock-In Modal
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
                <h3 class="font-title-lg font-bold text-white">قارئ الباركود — توريد وإضافة البضاعة</h3>
                <span class="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500 text-slate-950">F3</span>
              </div>
              <p class="font-label-md text-slate-300 text-xs sm:text-sm">امسح باركود أي صنف بالمسدس أو الكاميرا لإضافته للمخزن أو زيادة كميته فوراً</p>
            </div>
          </div>
          
          <div class="flex items-center gap-2">
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
          
          <!-- Barcode Input and Controls Card -->
          <div class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-sm space-y-3">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div class="flex items-center gap-2">
                <span class="relative flex h-3 w-3">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
                <span class="font-label-md font-bold text-slate-800">القارئ جاهز للمسح المباشر (USB أو لاسلكي)</span>
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
                placeholder="وجّه القارئ نحو باركود الصنف أو اكتب الكود واضغط Enter..."
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
                <span>فحص</span>
              </button>
            </div>
            
            <p class="text-xs text-slate-500 flex items-center gap-1">
              <span class="material-symbols-outlined text-sm text-outline">lightbulb</span>
              <span>يمكنك مسح كود الصنف من الكرتونة مباشرة دون لمس الماوس، والنظام سيتعرف عليه تلقائياً.</span>
            </p>
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

            <!-- Video Preview Container with Target Box & Laser Animation -->
            <div class="relative w-full max-w-md mx-auto aspect-video bg-black rounded-xl overflow-hidden border border-slate-700">
              <div id="barcodeCameraReader" class="w-full h-full"></div>
              
              <!-- Scanning Target Overlay -->
              <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div class="w-64 h-36 border-2 border-emerald-400 rounded-lg relative shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                  <div class="laser-line"></div>
                  <!-- Corner Guides -->
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
            <!-- Empty state default -->
            <div class="py-12 px-4 text-center bg-white rounded-2xl border border-dashed border-slate-300">
              <div class="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3 shadow-sm">
                <span class="material-symbols-outlined text-3xl">qr_code_scanner</span>
              </div>
              <h4 class="font-title-lg font-bold text-on-surface">بانتظار مسح الصنف</h4>
              <p class="font-body-md text-on-surface-variant max-w-md mx-auto mt-1">
                استخدم مسدس الباركود أو كاميرا الهاتف لمسح الصنف. إذا كان مسجلاً ستتمكن من زيادة كميته، وإذا كان جديداً سيظهر لك نموذج إدخاله فوراً.
              </p>
            </div>
          </div>

          <!-- Recent Session Intake Table -->
          <div id="recentIntakeContainer" class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
            <div class="flex items-center justify-between border-b border-slate-100 pb-2">
              <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-primary text-xl">history</span>
                <span class="font-title-md font-bold text-on-surface">البضائع المضافة في جلسة المسح الحالية</span>
              </div>
              <span id="recentIntakeSummary" class="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">0 أصناف</span>
            </div>
            <div id="recentIntakeList" class="max-h-48 overflow-y-auto divide-y divide-slate-100">
              <div class="py-4 text-center text-xs text-slate-400">لم تتم إضافة أي أصناف في هذه الجلسة بعد.</div>
            </div>
          </div>

        </div>

        <!-- Footer -->
        <div class="bg-white px-5 py-3 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div class="text-xs text-slate-500">
            اختصار لوحة المفاتيح: اضغط <kbd class="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 font-mono font-bold">F3</kbd> لفتح هذه النافذة بأي وقت
          </div>
          <button type="button" onclick="BarcodeService.closeModal()" class="px-5 py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 font-label-md font-semibold transition-colors">
            إغلاق النافذة
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(modal);
    updateSoundUI();
  }

  function openBarcodeIntakeModal(initialCode = "") {
    injectBarcodeModal();
    const modal = document.getElementById("globalBarcodeModal");
    if (modal) {
      modal.classList.remove("hidden");
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
      lookupBarcode(input.value.trim());
    }
  }

  // =========================================================================
  // 5. Look up & Render Result: Either Existing Item (Restock) or New Item
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
      // CASE 1: EXISTING ITEM (RESTOCK / ADD QUANTITY)
      playScannerBeep("success");
      renderExistingItemForm(match, clean);
    } else {
      // CASE 2: BRAND NEW ITEM (CREATE NEW PRODUCT)
      playScannerBeep("success");
      renderNewItemForm(clean);
    }
  }

  // Render Restock form for existing inventory item
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
        
        <!-- Top Status Banner -->
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
          <div class="text-left font-numeric-table">
            <span class="text-xs text-slate-500 block">القسم: ${escapeHtml(sectionNames[section] || section)}</span>
            <span class="text-sm font-bold text-slate-700">الكود: ${escapeHtml(barcode)}</span>
          </div>
        </div>

        <!-- Current Stock & Specs Chips -->
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

        <!-- Restock Form -->
        <form id="restockItemForm" onsubmit="BarcodeService.submitRestock(event, '${kind}', '${item.id}')" class="space-y-4 pt-1">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            
            <!-- Quantity to add -->
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
              <!-- Quick Add Buttons for Accessories -->
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

            <!-- Cost Price Adjustment -->
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

            <!-- Sale Price Adjustment -->
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

          <!-- Total Cost and Payment Option -->
          <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-emerald-700">payments</span>
              <div>
                <span class="text-xs text-emerald-800 font-bold block">إجمالي تكلفة البضاعة الموردة:</span>
                <span id="restockTotalCostPreview" class="text-lg font-black font-numeric-table text-emerald-950">${window.PosDB?.formatMoney(costPrice)} ج.م</span>
              </div>
            </div>

            <label class="flex items-center gap-2 cursor-pointer font-label-md text-slate-800">
              <input type="checkbox" id="restockDeductDrawer" class="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 accent-emerald-600" />
              <span>خصم إجمالي التكلفة من درج النقدية (منصرف مشتريات)</span>
            </label>
          </div>

          <!-- Submit Button -->
          <div class="flex items-center justify-end gap-3 pt-2">
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

  // Render Creation form for brand-new barcode
  function renderNewItemForm(barcode) {
    const container = document.getElementById("barcodeIntakeResultArea");
    if (!container) return;

    container.innerHTML = `
      <div class="bg-white rounded-2xl border-2 border-primary/70 p-5 shadow-md space-y-4">
        
        <!-- Header notice -->
        <div class="flex items-center justify-between pb-3 border-b border-slate-100 flex-wrap gap-2">
          <div class="flex items-center gap-2">
            <span class="w-8 h-8 rounded-lg bg-primary-fixed text-primary flex items-center justify-center">
              <span class="material-symbols-outlined text-lg">add_circle</span>
            </span>
            <div>
              <span class="px-2 py-0.5 rounded text-xs font-bold bg-primary-fixed text-on-primary-fixed">باركود جديد غير مسجل</span>
              <h4 class="font-title-lg font-bold text-on-surface mt-0.5">تسجيل صنف جديد في المخزن</h4>
            </div>
          </div>
          <div class="text-left font-numeric-table">
            <span class="text-xs text-slate-500 block">الباركود المقروء:</span>
            <span class="text-base font-black text-primary" dir="ltr">${escapeHtml(barcode)}</span>
          </div>
        </div>

        <form id="newBarcodeItemForm" onsubmit="BarcodeService.submitNewItem(event, '${escapeHtml(barcode)}')" class="space-y-4">
          
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <!-- Section Selection -->
            <div>
              <label class="block font-label-md font-bold text-on-surface mb-1">القسم / المخزن *</label>
              <select id="newItemSection" required onchange="BarcodeService.handleSectionChange()" class="w-full h-11 px-3 rounded-xl bg-slate-50 border border-slate-300 font-body-md focus:bg-white focus:ring-2 focus:ring-primary">
                <option value="chargers" selected>مخزن الشواحن والوصلات</option>
                <option value="headphones">قسم السماعات</option>
                <option value="speakers">قسم الصبات والمكبرات</option>
                <option value="phones">مخزن التلفونات والهواتف</option>
              </select>
            </div>

            <!-- Category Selection (Dynamic) -->
            <div>
              <label class="block font-label-md font-bold text-on-surface mb-1">التصنيف الداخلي *</label>
              <select id="newItemCategory" required class="w-full h-11 px-3 rounded-xl bg-slate-50 border border-slate-300 font-body-md focus:bg-white focus:ring-2 focus:ring-primary"></select>
            </div>

            <!-- Brand Name -->
            <div>
              <label class="block font-label-md font-bold text-on-surface mb-1">اسم الماركة / الشركة *</label>
              <input type="text" id="newItemBrand" required placeholder="مثال: Anker, Samsung, Joyroom" class="w-full h-11 px-3 rounded-xl bg-slate-50 border border-slate-300 font-body-md focus:bg-white focus:ring-2 focus:ring-primary" />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <!-- Item Name -->
            <div>
              <label class="block font-label-md font-bold text-on-surface mb-1">اسم الصنف والموديل *</label>
              <input type="text" id="newItemName" required placeholder="مثال: شاحن سريع 33W Type-C" class="w-full h-11 px-3 rounded-xl bg-slate-50 border border-slate-300 font-body-md focus:bg-white focus:ring-2 focus:ring-primary" />
            </div>

            <!-- Specs / Description -->
            <div>
              <label class="block font-label-md font-bold text-on-surface mb-1">المواصفات (اختياري)</label>
              <input type="text" id="newItemSpecs" placeholder="مثال: 33 وات / طول 1 متر / أسود" class="w-full h-11 px-3 rounded-xl bg-slate-50 border border-slate-300 font-body-md focus:bg-white focus:ring-2 focus:ring-primary" />
            </div>
          </div>

          <!-- Pricing and Initial Quantity -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block font-label-md font-bold text-on-surface mb-1">سعر الشراء (تكلفة الجملة) *</label>
              <input 
                type="number" 
                id="newItemCostPrice" 
                step="0.5" 
                min="0" 
                required 
                placeholder="0.00" 
                oninput="BarcodeService.updateNewItemCalculations()"
                class="w-full h-11 px-3 text-left font-numeric-table font-bold rounded-xl bg-slate-50 border border-slate-300 focus:bg-white focus:ring-2 focus:ring-primary" 
                dir="ltr"
              />
            </div>

            <div>
              <label class="block font-label-md font-bold text-on-surface mb-1">سعر البيع للجمهور *</label>
              <input 
                type="number" 
                id="newItemSalePrice" 
                step="0.5" 
                min="0" 
                required 
                placeholder="0.00" 
                oninput="BarcodeService.updateNewItemCalculations()"
                class="w-full h-11 px-3 text-left font-numeric-table font-bold rounded-xl bg-slate-50 border border-slate-300 focus:bg-white focus:ring-2 focus:ring-primary" 
                dir="ltr"
              />
            </div>

            <div>
              <label class="block font-label-md font-bold text-on-surface mb-1">الكمية المستلمة *</label>
              <input 
                type="number" 
                id="newItemInitialQty" 
                step="1" 
                min="1" 
                value="1" 
                required 
                oninput="BarcodeService.updateNewItemCalculations()"
                class="w-full h-11 px-3 text-center font-numeric-table font-bold rounded-xl bg-slate-50 border border-slate-300 focus:bg-white focus:ring-2 focus:ring-primary" 
              />
            </div>
          </div>

          <!-- Profit Margin Preview & Payment Options -->
          <div class="p-3.5 rounded-xl bg-slate-100 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <span class="text-xs text-slate-600 font-bold">هامش الربح المتوقع:</span>
              <span id="newItemMarginPreview" class="text-sm font-bold font-numeric-table text-slate-800">0.00 ج.م</span>
              <span class="text-slate-300">|</span>
              <span class="text-xs text-slate-600 font-bold">إجمالي الفاتورة:</span>
              <span id="newItemTotalCostPreview" class="text-sm font-bold font-numeric-table text-primary">0.00 ج.م</span>
            </div>

            <label class="flex items-center gap-2 cursor-pointer font-label-md text-slate-800">
              <input type="checkbox" id="newItemDeductDrawer" class="w-4 h-4 rounded text-primary focus:ring-primary accent-primary" />
              <span>خصم التكلفة من درج النقدية</span>
            </label>
          </div>

          <!-- Submit Button -->
          <div class="flex items-center justify-end gap-3 pt-2">
            <button 
              type="submit" 
              class="w-full sm:w-auto px-6 py-3 rounded-xl bg-primary hover:bg-primary-container text-white font-label-lg font-bold shadow-md flex items-center justify-center gap-2 transition-all">
              <span class="material-symbols-outlined text-xl">save</span>
              <span>حفظ الصنف وتثبيته بالمخزن</span>
            </button>
          </div>
        </form>

      </div>
    `;

    handleSectionChange();
    setTimeout(() => {
      document.getElementById("newItemBrand")?.focus();
    }, 50);
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

  // =========================================================================
  // 6. Form Submission Handlers: Restock & New Item
  // =========================================================================
  async function submitRestock(e, kind, id) {
    if (e) e.preventDefault();
    const DB = window.PosDB;
    if (!DB) return;

    const match = findProductByBarcode(document.getElementById("barcodeIntakeInput")?.value || "");
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

        logSessionIntake({
          name: item?.name || "صنف",
          barcode: item?.barcode || "",
          section: item?.section || "chargers",
          qtyAdded: addQty,
          totalCost: totalCost,
          time: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
        });
      }

      // Reset input and prepare for next scan immediately
      resetIntakeScreen();
    } catch (err) {
      playScannerBeep("error");
      window.AppLayout?.showToast?.("تعذر حفظ التوريد", err.message, true);
    }
  }

  async function submitNewItem(e, barcode) {
    if (e) e.preventDefault();
    const DB = window.PosDB;
    if (!DB) return;

    const section = document.getElementById("newItemSection")?.value || "chargers";
    const category = document.getElementById("newItemCategory")?.value || "CHARGER";
    const brand = document.getElementById("newItemBrand")?.value.trim() || "";
    const name = document.getElementById("newItemName")?.value.trim() || "";
    const specs = document.getElementById("newItemSpecs")?.value.trim() || "";
    const costPrice = parseFloat(document.getElementById("newItemCostPrice")?.value) || 0;
    const salePrice = parseFloat(document.getElementById("newItemSalePrice")?.value) || 0;
    const qty = parseInt(document.getElementById("newItemInitialQty")?.value, 10) || 1;
    const deduct = document.getElementById("newItemDeductDrawer")?.checked;

    if (!name) {
      window.AppLayout?.showToast?.("يرجى كتابة اسم الصنف", "", true);
      return;
    }

    try {
      if (section === "phones") {
        await DB.addPhone({
          brand,
          model: name,
          specs,
          condition: category === "NEW" ? "جديد كرتونة متبرشم" : "مستعمل بحالة ممتازة",
          color: specs || "افتراضي",
          imei1: barcode,
          costPrice,
          sellingPrice: salePrice,
          supplier: "توريد بالباركود",
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
          reason: `شراء بضاعة جديدة بالباركود: ${brand ? brand + " - " : ""}${name} (${qty} قطع)`,
          staffName: window.AppLayout?.getActiveStaffName?.() || "الكاشير"
        });
      }

      playScannerBeep("restock");
      window.AppLayout?.showToast?.("تم حفظ الصنف الجديد في المخزن", `${brand ? brand + " - " : ""}${name}`);

      logSessionIntake({
        name: `${brand ? brand + " - " : ""}${name}`,
        barcode,
        section,
        qtyAdded: qty,
        totalCost,
        time: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
      });

      resetIntakeScreen();
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
          <h4 class="font-title-md font-bold text-emerald-950">تم حفظ الصنف بنجاح!</h4>
          <p class="font-body-sm text-emerald-700 mt-1">القارئ جاهز الآن لمسح الصنف التالي...</p>
        </div>
      `;
    }
  }

  function logSessionIntake(entry) {
    sessionIntakeHistory.unshift(entry);
    renderRecentIntakeHistory();
  }

  function renderRecentIntakeHistory() {
    const container = document.getElementById("recentIntakeList");
    const summary = document.getElementById("recentIntakeSummary");
    if (!container) return;

    if (sessionIntakeHistory.length === 0) {
      container.innerHTML = `<div class="py-4 text-center text-xs text-slate-400">لم تتم إضافة أي أصناف في هذه الجلسة بعد.</div>`;
      if (summary) summary.textContent = "0 أصناف";
      return;
    }

    const totalQty = sessionIntakeHistory.reduce((acc, c) => acc + (c.qtyAdded || 0), 0);
    const totalCost = sessionIntakeHistory.reduce((acc, c) => acc + (c.totalCost || 0), 0);

    if (summary) {
      summary.textContent = `${sessionIntakeHistory.length} صنف (${totalQty} قطعة) • ${window.PosDB?.formatMoney(totalCost)} ج.م`;
    }

    container.innerHTML = sessionIntakeHistory.map((item) => `
      <div class="py-2.5 flex items-center justify-between gap-3 text-xs">
        <div class="min-w-0">
          <div class="font-bold text-slate-800 truncate">${escapeHtml(item.name)}</div>
          <div class="font-numeric-table text-slate-500 font-mono">${escapeHtml(item.barcode)} • ${escapeHtml(item.time)}</div>
        </div>
        <div class="flex items-center gap-3 shrink-0 font-numeric-table">
          <span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">+${item.qtyAdded} قطعة</span>
          <span class="font-bold text-slate-800">${window.PosDB?.formatMoney(item.totalCost)} ج.م</span>
        </div>
      </div>
    `).join("");
  }

  // =========================================================================
  // 7. Camera Barcode Scanning (Html5Qrcode Integration)
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

      // Prefer rear camera on mobile devices
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
        (errorMessage) => {
          // Frame parse error, ignore normal noisy frames
        }
      );

      // Check for torch capability
      try {
        const torchBtn = document.getElementById("cameraTorchBtn");
        // torch support check
        if (torchBtn) torchBtn.classList.remove("hidden");
      } catch (e) {}

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
    playScannerBeep("success");

    // If camera was opened to populate a specific input on a page
    if (targetInputForCamera) {
      const el = document.getElementById(targetInputForCamera);
      if (el) {
        el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        window.AppLayout?.showToast?.("تم التقاط الباركود بالكاميرا", text);
        closeCameraInputModal();
        return;
      }
    }

    // Otherwise, it was scanned in the main intake modal:
    const input = document.getElementById("barcodeIntakeInput");
    if (input) {
      input.value = text;
      lookupBarcode(text);
    }
  }

  // Camera popup for a specific input field
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

  // =========================================================================
  // 8. Helper: Escape HTML
  // =========================================================================
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
  // 9. Initialization & Subscriptions
  // =========================================================================
  function init() {
    initHardwareScannerListener();

    // Subscribe to DB inventory and phones to maintain real-time in-memory cache
    if (window.PosDB) {
      window.PosDB.subscribeAllInventory((items) => {
        inventoryCache = items || [];
      });
      window.PosDB.subscribePhones((phones) => {
        phonesCache = phones || [];
      });
    }

    // Keyboard shortcut F3 to open Barcode Intake Hub anywhere
    window.addEventListener("keydown", (e) => {
      if (e.key === "F3") {
        e.preventDefault();
        openBarcodeIntakeModal();
      }
    });
  }

  // Expose API globally
  window.BarcodeService = {
    init,
    openModal: openBarcodeIntakeModal,
    closeModal: closeBarcodeIntakeModal,
    lookupCurrentInput,
    toggleCameraScanner,
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
    findProductByBarcode
  };

  document.addEventListener("DOMContentLoaded", init);
})();
