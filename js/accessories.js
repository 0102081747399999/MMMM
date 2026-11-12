// Shared Inventory Module for Chargers & Cables, Headphones, and Speakers
(function () {
  const { escapeHtml, showToast, openModal, closeModal, requirePinIfProtected } = window.AppLayout;
  const DB = window.PosDB;

  const SECTION_CONFIGS = {
    chargers: {
      pageId: "chargers",
      barcodePrefix: "CAB-",
      emptyTitle: "لا توجد أصناف مسجلة في قسم الشواحن والوصلات حالياً",
      emptyText: "المخزن فارغ وجاهز لجرد البضاعة الفعلية للمحل. يمكنك البدء بإضافة صنف جديد يدوياً أو بواسطة قارئ الباركود.",
      addTitle: "إضافة صنف جديد لمخزن الشواحن والوصلات",
      nameLabel: "اسم الموديل والمواصفات",
      namePlaceholder: "مثال: شاحن سريع 33W Type-C قماش مضاد للقطع",
      specsLabel: "مواصفات إضافية (اختياري)",
      specsPlaceholder: "مثال: 33 وات / طول 1 متر",
      categories: [
        { key: "CHARGER", label: "شاحن كامل (Charger)", icon: "charging_station", badge: "bg-primary-fixed text-on-primary-fixed" },
        { key: "HEAD", label: "رأس شاحن (Charger Head)", icon: "electrical_services", badge: "bg-secondary-fixed text-on-secondary-fixed" },
        { key: "TYPE_C", label: "وصلة شحن عريضة (Type-C)", icon: "usb", badge: "bg-tertiary-fixed text-on-tertiary-fixed-variant" },
        { key: "MICRO", label: "وصلة شحن عادية (Micro USB)", icon: "cable", badge: "bg-surface-container-low text-on-surface-variant" },
        { key: "LIGHTNING", label: "وصلة شحن رفيعة (Lightning / iPhone)", icon: "bolt", badge: "bg-warning-container text-on-warning-container" }
      ]
    },
    headphones: {
      pageId: "headphones",
      barcodePrefix: "HDP-",
      emptyTitle: "لا توجد سماعات مسجلة في المخزن حالياً",
      emptyText: "القسم فارغ وجاهز لإدخال منتجات السماعات (جلدة، عظم، بلوتوث) وتحديد المواصفات والأسعار والكميات.",
      addTitle: "إضافة سماعة جديدة للمخزن",
      nameLabel: "اسم المنتج / السماعة",
      namePlaceholder: "مثال: AirPods Pro 2 / سماعة سلكية أصلية",
      specsLabel: "نوع الوصلة / المواصفات",
      specsPlaceholder: "مثال: Bluetooth 5.3 / Type-C / جاك 3.5mm",
      categories: [
        { key: "IN_EAR", label: "سماعة جلدة (In-Ear)", icon: "earbuds", badge: "bg-primary-fixed text-on-primary-fixed" },
        { key: "BONE", label: "سماعة عظم (Bone Conduction)", icon: "hearing", badge: "bg-secondary-fixed text-on-secondary-fixed" },
        { key: "BLUETOOTH", label: "سماعة بلوتوث (Wireless)", icon: "bluetooth_audio", badge: "bg-tertiary-fixed text-on-tertiary-fixed-variant" }
      ]
    },
    speakers: {
      pageId: "speakers",
      barcodePrefix: "SPK-",
      emptyTitle: "لا توجد صبات أو مكبرات صوت مسجلة حالياً",
      emptyText: "جدول الجرد فارغ بانتظار الإدخال. أضف موديلات الصبات الصغيرة والوسط والكبيرة لبدء البيع والمراقبة.",
      addTitle: "إضافة صب / مكبر صوت جديد",
      nameLabel: "اسم الموديل",
      namePlaceholder: "مثال: KTS-1236 / صب جي بي إل تشارج",
      specsLabel: "المواصفات / القدرة",
      specsPlaceholder: "مثال: 20 وات • بلوتوث • فلاشة",
      categories: [
        { key: "SMALL", label: "صب صغير (Small Speaker)", icon: "speaker", badge: "bg-primary-fixed text-on-primary-fixed" },
        { key: "MEDIUM", label: "صب وسط (Medium Speaker)", icon: "speaker_group", badge: "bg-tertiary-fixed text-on-tertiary-fixed-variant" },
        { key: "LARGE", label: "صب كبير (Large / Party)", icon: "surround_sound", badge: "bg-warning-container text-on-warning-container" }
      ]
    }
  };

  let sectionKey = "chargers";
  let cfg = SECTION_CONFIGS.chargers;
  const state = {
    items: [],
    currentFilter: "ALL",
    searchQuery: "",
    editingId: null,
    pendingDeleteId: null,
    sellingItem: null
  };

  function getCategoryInfo(key) {
    return cfg.categories.find((c) => c.key === key) || { label: key, badge: "bg-surface-container-low text-on-surface" };
  }

  function renderCategoryTabsAndSelect() {
    const tabsEl = document.getElementById("filterTabs");
    const selectEl = document.getElementById("itemCategory");
    if (tabsEl) {
      const allBtn = `
        <button type="button" data-filter="ALL" onclick="AccessoriesPage.setFilter('ALL')" class="filter-btn flex items-center gap-2 px-4 py-2 rounded-lg font-label-lg whitespace-nowrap transition-colors ${state.currentFilter === "ALL" ? "bg-primary text-white shadow-sm" : "bg-white text-on-surface hover:bg-surface-container-low border border-slate-200"}">
          <span class="material-symbols-outlined text-lg">widgets</span>
          <span>الكل</span>
          <span id="badgeCount_ALL" class="px-1.5 py-0.5 rounded-full text-xs ${state.currentFilter === "ALL" ? "bg-primary-container text-white" : "bg-surface-container-low text-on-surface-variant"}">0</span>
        </button>
      `;
      const catBtns = cfg.categories
        .map((c) => {
          const isAct = state.currentFilter === c.key;
          return `
            <button type="button" data-filter="${c.key}" onclick="AccessoriesPage.setFilter('${c.key}')" class="filter-btn flex items-center gap-2 px-4 py-2 rounded-lg font-label-lg whitespace-nowrap transition-colors ${isAct ? "bg-primary text-white shadow-sm" : "bg-white text-on-surface hover:bg-surface-container-low border border-slate-200"}">
              <span class="material-symbols-outlined text-lg">${c.icon}</span>
              <span>${escapeHtml(c.label)}</span>
              <span id="badgeCount_${c.key}" class="px-1.5 py-0.5 rounded-full text-xs ${isAct ? "bg-primary-container text-white" : "bg-surface-container-low text-on-surface-variant"}">0</span>
            </button>
          `;
        })
        .join("");
      tabsEl.innerHTML = allBtn + catBtns;
    }

    if (selectEl) {
      selectEl.innerHTML =
        `<option value="" disabled selected>-- اختر التصنيف من القائمة --</option>` +
        cfg.categories.map((c) => `<option value="${c.key}">${escapeHtml(c.label)}</option>`).join("");
    }
  }

  function updateMetrics() {
    const items = state.items;
    const totalTypes = items.length;
    const totalQty = items.reduce((acc, i) => acc + (Number(i.qty) || 0), 0);
    const wholesaleVal = items.reduce((acc, i) => acc + (Number(i.costPrice) || 0) * (Number(i.qty) || 0), 0);
    const retailVal = items.reduce((acc, i) => acc + (Number(i.salePrice) || 0) * (Number(i.qty) || 0), 0);
    const projectedProfit = retailVal - wholesaleVal;

    document.getElementById("metricTotalTypes").textContent = totalTypes;
    document.getElementById("metricTotalQty").innerHTML = `${totalQty} <span class="font-body-sm text-on-surface-variant">قطعة</span>`;
    document.getElementById("metricWholesaleTotal").innerHTML = `${DB.formatMoney(wholesaleVal)} <span class="font-body-sm text-on-surface-variant">ج.م</span>`;
    document.getElementById("metricProfitTotal").innerHTML = `${DB.formatMoney(projectedProfit)} <span class="font-body-sm text-on-surface-variant">ج.م</span>`;

    const allBadge = document.getElementById("badgeCount_ALL");
    if (allBadge) allBadge.textContent = totalTypes;
    cfg.categories.forEach((c) => {
      const b = document.getElementById(`badgeCount_${c.key}`);
      if (b) b.textContent = items.filter((i) => i.category === c.key).length;
    });
  }

  function renderTable() {
    const tbody = document.getElementById("inventoryTableBody");
    const emptyState = document.getElementById("emptyState");
    const filterInfo = document.getElementById("filteredItemsCount");

    let filtered = state.items.slice();
    if (state.currentFilter !== "ALL") {
      filtered = filtered.filter((i) => i.category === state.currentFilter);
    }
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          (i.barcode || "").toLowerCase().includes(q) ||
          (i.brand || "").toLowerCase().includes(q) ||
          (i.name || "").toLowerCase().includes(q) ||
          (i.specs || "").toLowerCase().includes(q)
      );
    }

    if (filterInfo) {
      filterInfo.textContent = `عرض ${filtered.length} من إجمالي ${state.items.length} صنف`;
    }

    if (filtered.length === 0) {
      tbody.innerHTML = "";
      emptyState.classList.remove("hidden");
      return;
    }

    emptyState.classList.add("hidden");
    tbody.innerHTML = filtered
      .map((item, idx) => {
        const cost = Number(item.costPrice) || 0;
        const sale = Number(item.salePrice) || 0;
        const qty = Number(item.qty) || 0;
        const margin = sale - cost;
        const marginPct = cost > 0 ? ((margin / cost) * 100).toFixed(0) : "0";
        const catInfo = getCategoryInfo(item.category);

        let stockChip = "";
        if (qty <= 0) {
          stockChip = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-error-container text-on-error-container"><span class="w-1.5 h-1.5 rounded-full bg-error"></span>نفذت الكمية</span>`;
        } else if (qty <= 4) {
          stockChip = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-warning-container text-on-warning-container"><span class="w-1.5 h-1.5 rounded-full bg-warning"></span>مخزون حرج (${qty})</span>`;
        } else {
          stockChip = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-tertiary-fixed text-on-tertiary-fixed-variant"><span class="w-1.5 h-1.5 rounded-full bg-tertiary"></span>متوفر (${qty})</span>`;
        }

        const rowBg = idx % 2 === 0 ? "bg-white" : "bg-slate-50/70";
        return `
          <tr class="${rowBg} hover:bg-primary-fixed/20 transition-colors border-b border-slate-100">
            <td class="py-3 px-4 font-numeric-table text-body-sm font-bold text-on-surface">
              <div class="flex items-center gap-1.5">
                <span class="material-symbols-outlined text-outline text-base">barcode</span>
                <span>${escapeHtml(item.barcode || "-")}</span>
              </div>
            </td>
            <td class="py-3 px-4">
              <span class="font-title-md text-on-surface font-bold block">${escapeHtml(item.name)}</span>
              ${item.specs ? `<span class="font-body-sm text-on-surface-variant block">${escapeHtml(item.specs)}</span>` : ""}
            </td>
            <td class="py-3 px-4">
              <span class="px-2.5 py-1 rounded bg-surface-container-low text-on-surface font-label-md font-semibold">${escapeHtml(item.brand || "-")}</span>
            </td>
            <td class="py-3 px-4">
              <span class="px-2.5 py-0.5 rounded text-xs font-semibold ${catInfo.badge}">${escapeHtml(catInfo.label)}</span>
            </td>
            <td class="py-3 px-4 text-left font-numeric-table text-on-surface-variant">${DB.formatMoney(cost)} ج.م</td>
            <td class="py-3 px-4 text-left font-numeric-table text-on-surface font-bold">${DB.formatMoney(sale)} ج.م</td>
            <td class="py-3 px-4 text-left font-numeric-table ${margin >= 0 ? "text-tertiary" : "text-error"} font-semibold">
              +${DB.formatMoney(margin)} (${marginPct}%)
            </td>
            <td class="py-3 px-4 text-center font-numeric-table text-title-md font-bold text-on-surface">${qty}</td>
            <td class="py-3 px-4 text-center">${stockChip}</td>
            <td class="py-3 px-4 text-left">
              <div class="flex items-center justify-end gap-1">
                <button type="button" onclick="AccessoriesPage.openSellModal('${item.id}')" title="بيع سريع" class="p-1.5 rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant hover:bg-tertiary hover:text-white transition-colors">
                  <span class="material-symbols-outlined text-lg">point_of_sale</span>
                </button>
                <button type="button" onclick="AccessoriesPage.openEditItemModal('${item.id}')" title="تعديل الصنف" class="p-1.5 rounded-lg bg-surface-container-low text-on-surface hover:bg-surface-container transition-colors">
                  <span class="material-symbols-outlined text-lg">edit</span>
                </button>
                <button type="button" onclick="AccessoriesPage.triggerDelete('${item.id}')" title="حذف الصنف" class="p-1.5 rounded-lg bg-error-container/40 text-error hover:bg-error hover:text-white transition-colors">
                  <span class="material-symbols-outlined text-lg">delete</span>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function setFilter(cat) {
    state.currentFilter = cat;
    renderCategoryTabsAndSelect();
    updateMetrics();
    renderTable();
  }

  function generateAutoBarcode() {
    const rand = Math.floor(10000000 + Math.random() * 90000000);
    document.getElementById("itemBarcode").value = cfg.barcodePrefix + rand;
  }

  function calculateProjectedMargin() {
    const cost = parseFloat(document.getElementById("itemCostPrice")?.value) || 0;
    const sale = parseFloat(document.getElementById("itemSalePrice")?.value) || 0;
    const qty = parseInt(document.getElementById("itemInitialQty")?.value, 10) || 0;
    const diff = sale - cost;
    const pct = cost > 0 ? ((diff / cost) * 100).toFixed(1) : "0";
    const preview = document.getElementById("marginPreviewVal");
    if (preview) {
      if (diff >= 0) {
        preview.textContent = `${DB.formatMoney(diff)} ج.م (+${pct}%)`;
        preview.className = "font-numeric-table text-tertiary font-bold";
      } else {
        preview.textContent = `${DB.formatMoney(diff)} ج.م (${pct}%) خسارة`;
        preview.className = "font-numeric-table text-error font-bold";
      }
    }
    const costTotalEl = document.getElementById("stockTotalCostText");
    if (costTotalEl) {
      costTotalEl.textContent = `${DB.formatMoney(cost * qty)} ج.م`;
    }
  }

  function checkBarcodeDuplicate() {
    const code = document.getElementById("itemBarcode")?.value.trim().toLowerCase();
    const noticeEl = document.getElementById("itemBarcodeDuplicateNotice");
    if (!noticeEl) return;

    if (!code) {
      noticeEl.classList.add("hidden");
      return;
    }

    const dup = state.items.find((i) => i.id !== state.editingId && i.barcode && i.barcode.toLowerCase() === code);
    if (dup) {
      noticeEl.innerHTML = `
        <div class="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-center justify-between">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="material-symbols-outlined text-amber-600 text-base shrink-0">info</span>
            <span class="truncate">الباركود مسجل مسبقاً للصنف: <strong>${escapeHtml(dup.brand ? dup.brand + " - " : "")}${escapeHtml(dup.name)}</strong> (الرصيد: ${dup.qty})</span>
          </div>
          <button type="button" onclick="BarcodeService.openModal('${escapeHtml(code)}')" class="shrink-0 px-2 py-1 rounded bg-amber-600 text-white font-bold hover:bg-amber-700">فتح لتوريد كمية إضافية</button>
        </div>
      `;
      noticeEl.classList.remove("hidden");
    } else {
      noticeEl.classList.add("hidden");
    }
  }

  function openAddItemModal(initialBarcode = "") {
    state.editingId = null;
    document.getElementById("itemModalTitle").textContent = cfg.addTitle;
    document.getElementById("itemModalSubmitText").textContent = "حفظ الصنف في المخزن";
    document.getElementById("newItemForm").reset();
    document.getElementById("itemInitialQty").value = 1;
    const chk = document.getElementById("itemDeductFromDrawer");
    if (chk) chk.checked = false;
    const optRow = document.getElementById("stockPaymentOptionRow");
    if (optRow) optRow.classList.remove("hidden");
    const noticeEl = document.getElementById("itemBarcodeDuplicateNotice");
    if (noticeEl) noticeEl.classList.add("hidden");

    if (initialBarcode) {
      document.getElementById("itemBarcode").value = initialBarcode;
    }

    calculateProjectedMargin();
    openModal("addItemModal");
    setTimeout(() => {
      const barcodeEl = document.getElementById("itemBarcode");
      if (initialBarcode || (barcodeEl && barcodeEl.value)) {
        document.getElementById("itemBrand")?.focus();
      } else {
        barcodeEl?.focus();
      }
    }, 80);
  }

  function openEditItemModal(id) {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    state.editingId = id;
    document.getElementById("itemModalTitle").textContent = "تعديل بيانات الصنف والمخزون";
    document.getElementById("itemModalSubmitText").textContent = "حفظ التعديلات";

    document.getElementById("itemBarcode").value = item.barcode || "";
    document.getElementById("itemBrand").value = item.brand || "";
    document.getElementById("itemName").value = item.name || "";
    document.getElementById("itemCategory").value = item.category || "";
    document.getElementById("itemSpecs").value = item.specs || "";
    document.getElementById("itemCostPrice").value = item.costPrice ?? 0;
    document.getElementById("itemSalePrice").value = item.salePrice ?? 0;
    document.getElementById("itemInitialQty").value = item.qty ?? 0;
    const optRow = document.getElementById("stockPaymentOptionRow");
    if (optRow) optRow.classList.add("hidden");
    calculateProjectedMargin();
    openModal("addItemModal");
  }

  async function handleSaveItem(e) {
    e.preventDefault();
    let barcode = document.getElementById("itemBarcode").value.trim();
    if (!barcode) {
      barcode = cfg.barcodePrefix + Math.floor(100000 + Math.random() * 900000);
    }
    const brand = document.getElementById("itemBrand").value.trim();
    const name = document.getElementById("itemName").value.trim();
    const category = document.getElementById("itemCategory").value;
    const specs = document.getElementById("itemSpecs").value.trim();
    const costPrice = parseFloat(document.getElementById("itemCostPrice").value) || 0;
    const salePrice = parseFloat(document.getElementById("itemSalePrice").value) || 0;
    const qty = parseInt(document.getElementById("itemInitialQty").value, 10) || 0;

    if (!name || !category) {
      showToast("يرجى استكمال الحقول المطلوبة", "", true);
      return;
    }

    const dup = state.items.find(
      (i) => i.id !== state.editingId && i.barcode && i.barcode.toLowerCase() === barcode.toLowerCase()
    );
    if (dup) {
      showToast("كود الصنف مسجل مسبقاً", "اكتب باركوداً مختلفاً", true);
      return;
    }

    try {
      if (state.editingId) {
        await DB.updateInventoryItem(state.editingId, {
          barcode,
          brand,
          name,
          category,
          specs,
          costPrice,
          salePrice,
          qty
        });
        showToast("تم تحديث الصنف في المخزن", `${brand ? brand + " - " : ""}${name}`);
      } else {
        await DB.addInventoryItem({
          section: sectionKey,
          barcode,
          brand,
          name,
          category,
          specs,
          costPrice,
          salePrice,
          qty
        });
        const deductFromDrawer = document.getElementById("itemDeductFromDrawer")?.checked;
        const totalCost = costPrice * qty;
        if (deductFromDrawer && totalCost > 0) {
          await DB.addDrawerTx({
            type: "expense",
            source: sectionKey,
            amount: totalCost,
            direction: "out",
            reason: `شراء/توريد بضاعة: ${brand ? brand + " - " : ""}${name} (${qty} قطعة بسعر جملة ${DB.formatMoney(costPrice)} ج.م)`,
            staffName: window.AppLayout.getActiveStaffName()
          });
          showToast("تمت إضافة الصنف وقيد منصرف البضاعة بالخزينة", `خصم ${DB.formatMoney(totalCost)} ج.م من الدرج`);
        } else {
          showToast("تمت إضافة الصنف لقاعدة البيانات", `${brand ? brand + " - " : ""}${name}`);
        }
      }
      closeModal("addItemModal");
    } catch (err) {
      showToast("تعذر حفظ الصنف", err.message, true);
    }
  }

  function openSellModal(id) {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    if ((Number(item.qty) || 0) <= 0) {
      showToast("الكمية نافذة من المخزن!", "يرجى تعديل الكمية قبل البيع", true);
      return;
    }
    state.sellingItem = item;
    document.getElementById("quickSellItemTitle").textContent = `${item.brand ? item.brand + " - " : ""}${item.name}`;
    document.getElementById("quickSellAvail").textContent = `المتاح بالمخزن: ${item.qty} قطعة`;
    document.getElementById("quickSellQty").value = 1;
    document.getElementById("quickSellQty").max = item.qty;
    document.getElementById("quickSellUnitPrice").value = item.salePrice || 0;
    updateQuickSellTotal();
    openModal("quickSellModal");
  }

  function updateQuickSellTotal() {
    const q = parseInt(document.getElementById("quickSellQty").value, 10) || 1;
    const p = parseFloat(document.getElementById("quickSellUnitPrice").value) || 0;
    document.getElementById("quickSellTotalDisplay").textContent = `${DB.formatMoney(q * p)} ج.م`;
  }

  async function handleQuickSellSubmit(e) {
    e.preventDefault();
    if (!state.sellingItem) return;
    const qty = parseInt(document.getElementById("quickSellQty").value, 10) || 1;
    const unitPrice = parseFloat(document.getElementById("quickSellUnitPrice").value) || 0;
    const paymentMethod = document.querySelector('input[name="quickSellPay"]:checked')?.value || "نقدي (كاش)";

    try {
      await DB.sellInventoryItem({
        item: state.sellingItem,
        qty,
        unitPrice,
        paymentMethod,
        staffName: window.AppLayout.getActiveStaffName()
      });
      closeModal("quickSellModal");
      showToast("تم تسجيل البيع وتحديث المخزن والخزينة", `${qty} × ${state.sellingItem.name} = ${DB.formatMoney(qty * unitPrice)} ج.م`);
      state.sellingItem = null;
    } catch (err) {
      showToast("تعذر إتمام البيع", err.message, true);
    }
  }

  function triggerDelete(id) {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    requirePinIfProtected(() => {
      state.pendingDeleteId = id;
      document.getElementById("deleteItemTitle").textContent = `${item.brand ? item.brand + " - " : ""}${item.name}`;
      document.getElementById("deleteItemSku").textContent = `كود: ${item.barcode || "-"} | الكمية الحالية: ${item.qty}`;
      openModal("deleteModal");
    });
  }

  async function executeDelete() {
    if (!state.pendingDeleteId) return;
    try {
      await DB.deleteInventoryItem(state.pendingDeleteId);
      state.pendingDeleteId = null;
      closeModal("deleteModal");
      showToast("تم حذف الصنف نهائياً من المخزن");
    } catch (err) {
      showToast("تعذر الحذف", err.message, true);
    }
  }

  function init() {
    sectionKey = document.body.dataset.section || "chargers";
    cfg = SECTION_CONFIGS[sectionKey] || SECTION_CONFIGS.chargers;
    window.AppLayout.init(cfg.pageId);

    const setTxt = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };
    setTxt("emptyStateTitle", cfg.emptyTitle);
    setTxt("emptyStateText", cfg.emptyText);
    setTxt("itemNameLabel", cfg.nameLabel);
    setTxt("itemSpecsLabel", cfg.specsLabel);

    const nameInp = document.getElementById("itemName");
    const specsInp = document.getElementById("itemSpecs");
    if (nameInp) nameInp.placeholder = cfg.namePlaceholder;
    if (specsInp) specsInp.placeholder = cfg.specsPlaceholder;

    renderCategoryTabsAndSelect();

    DB.subscribeInventory(sectionKey, (items) => {
      state.items = items;
      updateMetrics();
      renderTable();
    });

    document.getElementById("searchInput")?.addEventListener("input", (e) => {
      state.searchQuery = e.target.value.trim();
      renderTable();
    });
    document.getElementById("itemBarcode")?.addEventListener("input", checkBarcodeDuplicate);
    document.getElementById("itemBarcode")?.addEventListener("change", checkBarcodeDuplicate);
    document.getElementById("itemInitialQty")?.addEventListener("input", calculateProjectedMargin);
    document.getElementById("itemCostPrice")?.addEventListener("input", calculateProjectedMargin);
    document.getElementById("itemSalePrice")?.addEventListener("input", calculateProjectedMargin);
    document.getElementById("newItemForm")?.addEventListener("submit", handleSaveItem);
    document.getElementById("quickSellForm")?.addEventListener("submit", handleQuickSellSubmit);
    document.getElementById("quickSellQty")?.addEventListener("input", updateQuickSellTotal);
    document.getElementById("quickSellUnitPrice")?.addEventListener("input", updateQuickSellTotal);

    window.addEventListener("keydown", (e) => {
      if (e.key === "F2") {
        e.preventDefault();
        document.getElementById("searchInput")?.focus();
      }
    });
  }

  window.AccessoriesPage = {
    setFilter,
    generateAutoBarcode,
    calculateProjectedMargin,
    openAddItemModal,
    openEditItemModal,
    openSellModal,
    triggerDelete,
    executeDelete
  };

  document.addEventListener("DOMContentLoaded", init);
})();
