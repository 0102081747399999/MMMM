// Phone Sales & IMEI Inventory Page Logic (phones.html)
(function () {
  const { escapeHtml, showToast, openModal, closeModal, requirePinIfProtected, openPrintWindow } = window.AppLayout;
  const DB = window.PosDB;

  const state = {
    devices: [],
    editingDeviceId: null,
    pendingDeleteDevice: null,
    pendingSellDevice: null,
    pendingRevertDevice: null
  };

  function resetForm() {
    const form = document.getElementById("newPhoneForm");
    if (form) form.reset();
    state.editingDeviceId = null;
    const submitTxt = document.getElementById("submitDeviceText");
    if (submitTxt) submitTxt.textContent = "حفظ الهاتف وتثبيت السيريال بالمخزن";
    const dateInput = document.getElementById("deviceDate");
    if (dateInput) dateInput.value = DB.todayDateStr();
  }

  function scrollToForm() {
    const card = document.getElementById("phoneEntryFormCard");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("deviceModel")?.focus();
  }

  function generateTempImei(targetInputId) {
    const suffix = Math.floor(1000000 + Math.random() * 9000000);
    const imei = "86429305" + suffix;
    const inp = document.getElementById(targetInputId);
    if (inp) {
      inp.value = imei.substring(0, 15);
      inp.focus();
      showToast("تم توليد سيريال مؤقت", inp.value);
    }
  }

  async function handleDeviceSubmit(e) {
    e.preventDefault();
    const brand = document.getElementById("deviceBrand").value;
    const model = document.getElementById("deviceModel").value.trim();
    const specs = document.getElementById("deviceSpecs").value;
    const condition = document.getElementById("deviceCondition").value;
    const color = document.getElementById("deviceColor").value.trim();
    const imei1 = document.getElementById("deviceImei1").value.trim();
    const imei2 = document.getElementById("deviceImei2").value.trim();
    const costPrice = parseFloat(document.getElementById("deviceCost").value) || 0;
    const sellingPrice = parseFloat(document.getElementById("deviceSellingPrice").value) || 0;
    const supplier = document.getElementById("deviceSupplier").value.trim() || "توريد مباشر";
    const receivedDate = document.getElementById("deviceDate").value || DB.todayDateStr();

    const duplicate = state.devices.find(
      (d) => d.id !== state.editingDeviceId && (d.imei1 === imei1 || (imei2 && d.imei2 === imei2))
    );
    if (duplicate) {
      showToast("خطأ: رقم السيريال (IMEI) مسجل مسبقاً!", `الجهاز المسجل: ${duplicate.brand} ${duplicate.model}`, true);
      return;
    }

    const payload = {
      brand,
      model,
      specs,
      condition,
      color,
      imei1,
      imei2,
      costPrice,
      sellingPrice,
      supplier,
      receivedDate
    };

    try {
      if (state.editingDeviceId) {
        await DB.updatePhone(state.editingDeviceId, payload);
        showToast("تم تحديث بيانات الهاتف بنجاح", `${brand} ${model}`);
      } else {
        await DB.addPhone(payload);
        showToast("تم تسجيل الهاتف في المخزن برقم IMEI", `${brand} ${model}`);
      }
      resetForm();
    } catch (err) {
      showToast("تعذر حفظ بيانات الهاتف", err.message, true);
    }
  }

  function renderDevices() {
    const tbody = document.getElementById("inventoryTableBody");
    const emptyState = document.getElementById("emptyStatePlaceholder");
    const searchTerm = (document.getElementById("tableSearchInput")?.value || "").toLowerCase().trim();
    const statusFilter = document.getElementById("filterStatus")?.value || "all";

    const filtered = state.devices.filter((d) => {
      const matchSearch =
        !searchTerm ||
        (d.model || "").toLowerCase().includes(searchTerm) ||
        (d.brand || "").toLowerCase().includes(searchTerm) ||
        (d.imei1 || "").includes(searchTerm) ||
        (d.imei2 && d.imei2.includes(searchTerm)) ||
        (d.color || "").toLowerCase().includes(searchTerm);
      const matchStatus =
        statusFilter === "all" ? true : statusFilter === "available" ? !d.isSold : Boolean(d.isSold);
      return matchSearch && matchStatus;
    });

    const total = state.devices.length;
    const avail = state.devices.filter((d) => !d.isSold).length;
    const sold = state.devices.filter((d) => d.isSold).length;
    const invVal = state.devices
      .filter((d) => !d.isSold)
      .reduce((acc, cur) => acc + (Number(cur.costPrice) || 0), 0);

    document.getElementById("statTotalDevices").textContent = total;
    document.getElementById("statAvailableDevices").textContent = avail;
    document.getElementById("statSoldDevices").textContent = sold;
    document.getElementById("statInventoryValue").textContent = DB.formatMoney(invVal);
    document.getElementById("visibleDevicesCount").textContent = filtered.length;

    if (filtered.length === 0) {
      tbody.innerHTML = "";
      emptyState.classList.remove("hidden");
      const h3 = emptyState.querySelector("h3");
      const p = emptyState.querySelector("p");
      if (state.devices.length > 0) {
        h3.textContent = "لا توجد هواتف تطابق البحث أو الفلتر";
        p.textContent = "جرّب البحث برقم IMEI مختلف أو تغيير فلتر الحالة.";
      } else {
        h3.textContent = "لا توجد هواتف مسجلة في المخزن حالياً";
        p.textContent = "سجّل أول هاتف في النظام بواسطة السيريال أو IMEI عبر نموذج الإدخال أعلاه لتوثيق ملكية الجهاز وطباعة فواتير الضمان.";
      }
      return;
    }

    emptyState.classList.add("hidden");
    tbody.innerHTML = filtered
      .map((item, idx) => {
        const zebra = idx % 2 === 0 ? "bg-white" : "bg-slate-50/70";
        const isNew = (item.condition || "").includes("جديد");
        return `
          <tr class="${zebra} hover:bg-primary-fixed/20 transition-colors border-b border-slate-100">
            <td class="py-3 px-4">
              <div class="flex flex-col">
                <div class="flex items-center gap-1.5 font-numeric-table text-body-md text-primary font-bold" dir="ltr">
                  <span class="material-symbols-outlined text-base">tag</span>
                  <span>${escapeHtml(item.imei1)}</span>
                </div>
                ${item.imei2 ? `<span class="font-numeric-table text-body-sm text-outline pr-5" dir="ltr">IMEI 2: ${escapeHtml(item.imei2)}</span>` : ""}
              </div>
            </td>
            <td class="py-3 px-4">
              <div class="flex flex-col">
                <span class="font-title-md text-on-surface font-bold">${escapeHtml(item.model)}</span>
                <span class="font-body-sm text-on-surface-variant">${escapeHtml(item.brand)}</span>
              </div>
            </td>
            <td class="py-3 px-4">
              <div class="flex flex-col">
                <span class="font-body-md font-medium text-on-surface">${escapeHtml(item.specs)}</span>
                <span class="font-body-sm text-outline">اللون: ${escapeHtml(item.color)}</span>
              </div>
            </td>
            <td class="py-3 px-4">
              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${isNew ? "bg-tertiary-fixed text-on-tertiary-fixed-variant" : "bg-surface-container-low text-on-surface-variant"}">
                ${escapeHtml(item.condition)}
              </span>
            </td>
            <td class="py-3 px-4 text-left font-numeric-table text-on-surface">${DB.formatMoney(item.costPrice)} <span class="text-xs text-outline">ج.م</span></td>
            <td class="py-3 px-4 text-left font-numeric-table text-primary font-bold">${DB.formatMoney(item.sellingPrice)} <span class="text-xs font-normal">ج.م</span></td>
            <td class="py-3 px-4 text-center">
              ${
                item.isSold
                  ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary-container text-on-secondary-container text-xs font-bold"><span class="w-1.5 h-1.5 rounded-full bg-secondary"></span>تم البيع</span>`
                  : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant text-xs font-bold"><span class="w-1.5 h-1.5 rounded-full bg-tertiary"></span>متاح للبيع</span>`
              }
            </td>
            <td class="py-3 px-4 text-center">
              <div class="flex items-center justify-center gap-1.5 flex-wrap">
                ${
                  !item.isSold
                    ? `
                  <button type="button" onclick="PhonesPage.openSellModal('${item.id}')" title="إتمام بيع وطباعة فاتورة" class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-tertiary hover:bg-tertiary-container text-white text-xs font-semibold shadow-sm transition-all">
                    <span class="material-symbols-outlined text-base">shopping_cart_checkout</span>
                    <span>بيع وفاتورة</span>
                  </button>
                  <button type="button" onclick="PhonesPage.editDevice('${item.id}')" title="تعديل بيانات الهاتف" class="p-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface-variant transition-colors">
                    <span class="material-symbols-outlined text-base">edit</span>
                  </button>
                `
                    : `
                  <button type="button" onclick="PhonesPage.reprintReceipt('${item.id}')" title="طباعة فاتورة البيع" class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface text-xs font-semibold transition-colors">
                    <span class="material-symbols-outlined text-base">print</span>
                    <span>الفاتورة</span>
                  </button>
                  <button type="button" onclick="PhonesPage.openRevertModal('${item.id}')" title="تغيير الحالة إلى متاح" class="p-1.5 rounded-lg bg-warning-container/60 hover:bg-warning-container text-on-warning-container transition-colors">
                    <span class="material-symbols-outlined text-base">undo</span>
                  </button>
                `
                }
                <button type="button" onclick="PhonesPage.openDeleteModal('${item.id}')" title="حذف الهاتف" class="p-1.5 rounded-lg bg-error-container/40 hover:bg-error hover:text-white text-error transition-colors">
                  <span class="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function editDevice(id) {
    const item = state.devices.find((d) => d.id === id);
    if (!item) return;
    state.editingDeviceId = id;

    document.getElementById("deviceBrand").value = item.brand || "";
    document.getElementById("deviceModel").value = item.model || "";
    document.getElementById("deviceSpecs").value = item.specs || "";
    document.getElementById("deviceCondition").value = item.condition || "جديد كرتونة متبرشم";
    document.getElementById("deviceColor").value = item.color || "";
    document.getElementById("deviceImei1").value = item.imei1 || "";
    document.getElementById("deviceImei2").value = item.imei2 || "";
    document.getElementById("deviceCost").value = item.costPrice ?? 0;
    document.getElementById("deviceSellingPrice").value = item.sellingPrice ?? 0;
    document.getElementById("deviceSupplier").value = item.supplier || "";
    document.getElementById("deviceDate").value = item.receivedDate || DB.todayDateStr();

    document.getElementById("submitDeviceText").textContent = "تحديث بيانات الهاتف والسيريال";
    scrollToForm();
  }

  function openDeleteModal(id) {
    const item = state.devices.find((d) => d.id === id);
    if (!item) return;
    requirePinIfProtected(() => {
      state.pendingDeleteDevice = item;
      document.getElementById("deleteTargetModel").textContent = `${item.model} (${item.brand})`;
      document.getElementById("deleteTargetImei").textContent = item.imei1;
      openModal("deleteModal");
    });
  }

  async function executeDeviceDelete() {
    if (!state.pendingDeleteDevice) return;
    try {
      await DB.deletePhone(state.pendingDeleteDevice.id);
      state.pendingDeleteDevice = null;
      closeModal("deleteModal");
      showToast("تم حذف الهاتف وسجل IMEI نهائياً");
    } catch (err) {
      showToast("تعذر الحذف", err.message, true);
    }
  }

  function openSellModal(id) {
    const item = state.devices.find((d) => d.id === id);
    if (!item) return;
    state.pendingSellDevice = item;
    document.getElementById("sellDeviceName").textContent = `${item.brand} - ${item.model}`;
    document.getElementById("sellDeviceSuggestedPrice").textContent = `${DB.formatMoney(item.sellingPrice)} ج.م`;
    document.getElementById("sellDeviceImei1").textContent = item.imei1;
    document.getElementById("sellDeviceCondition").textContent = item.condition;
    document.getElementById("finalSalePrice").value = item.sellingPrice || 0;
    document.getElementById("buyerName").value = "";
    document.getElementById("buyerPhone").value = "";
    openModal("sellModal");
  }

  async function handleSellSubmit(e) {
    e.preventDefault();
    if (!state.pendingSellDevice) return;
    const buyer = document.getElementById("buyerName").value.trim();
    const buyerPhone = document.getElementById("buyerPhone").value.trim();
    const price = parseFloat(document.getElementById("finalSalePrice").value) || state.pendingSellDevice.sellingPrice;
    const warranty = document.getElementById("warrantyDuration").value;
    const payment = document.querySelector('input[name="paymentType"]:checked')?.value || "نقدي (كاش)";

    const targetPhone = { ...state.pendingSellDevice };
    try {
      const details = await DB.sellPhone(targetPhone, {
        buyer,
        buyerPhone,
        price,
        warranty,
        payment,
        staffName: window.AppLayout.getActiveStaffName()
      });
      targetPhone.isSold = true;
      targetPhone.saleDetails = details;
      state.pendingSellDevice = null;
      closeModal("sellModal");
      showToast("تم تسجيل البيع وتحديث الخزينة", `${targetPhone.brand} ${targetPhone.model}`);
      printWarrantyInvoice(targetPhone);
    } catch (err) {
      showToast("تعذر إتمام البيع", err.message, true);
    }
  }

  function openRevertModal(id) {
    const item = state.devices.find((d) => d.id === id);
    if (!item) return;
    requirePinIfProtected(() => {
      state.pendingRevertDevice = item;
      document.getElementById("revertTargetModel").textContent = `${item.brand} ${item.model} (${item.imei1})`;
      openModal("revertModal");
    });
  }

  async function executeRevertStatus() {
    if (!state.pendingRevertDevice) return;
    try {
      await DB.revertPhoneSale(state.pendingRevertDevice);
      state.pendingRevertDevice = null;
      closeModal("revertModal");
      showToast("تمت إعادة الهاتف لحالة متاح للبيع");
    } catch (err) {
      showToast("تعذر تغيير الحالة", err.message, true);
    }
  }

  function reprintReceipt(id) {
    const item = state.devices.find((d) => d.id === id);
    if (item && item.saleDetails) {
      printWarrantyInvoice(item);
    }
  }

  function printWarrantyInvoice(device) {
    const details = device.saleDetails || {};
    const storeName = (window.AppLayout.getSettings().store?.storeName) || "سنترال تيك للاتصالات والإلكترونيات";
    const bodyHtml = `
      <div style="text-align:center;border-bottom:2px dashed #94a3b8;padding-bottom:10px;margin-bottom:12px;">
        <h2 style="margin:0;font-size:18px;">${escapeHtml(storeName)}</h2>
        <p style="margin:3px 0;font-size:12px;color:#475569;">فاتورة بيع هاتف وضمان السيريال الرسمي</p>
      </div>
      <div style="font-size:13px;line-height:1.9;">
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin-bottom:6px;">
          <strong>رقم الفاتورة: #INV-${escapeHtml((device.imei1 || "000000").slice(-6))}</strong>
          <span>${escapeHtml(details.soldAt || DB.todayDateStr())}</span>
        </div>
        <div><span style="color:#64748b;">العميل:</span> <strong>${escapeHtml(details.buyer || "زبون عام")}</strong> (${escapeHtml(details.phone || "-")})</div>
        <div><span style="color:#64748b;">الجهاز:</span> ${escapeHtml(device.brand)} ${escapeHtml(device.model)} - ${escapeHtml(device.specs)}</div>
        <div><span style="color:#64748b;">اللون والحالة:</span> ${escapeHtml(device.color)} (${escapeHtml(device.condition)})</div>
        <div style="font-family:monospace;background:#f1f5f9;padding:8px;border-radius:6px;margin:8px 0;text-align:center;font-weight:bold;" dir="ltr">
          IMEI 1: ${escapeHtml(device.imei1)}
          ${device.imei2 ? `<br/>IMEI 2: ${escapeHtml(device.imei2)}` : ""}
        </div>
        <div><span style="color:#64748b;">مدة الضمان:</span> ${escapeHtml(details.warranty || "فحص")}</div>
        <div><span style="color:#64748b;">وسيلة الدفع:</span> ${escapeHtml(details.payment || "نقدي")}</div>
        <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:16px;padding-top:10px;border-top:2px dashed #94a3b8;margin-top:10px;">
          <span>المبلغ الإجمالي المسدد:</span>
          <span>${DB.formatMoney(details.price || device.sellingPrice)} ج.م</span>
        </div>
      </div>
      <div style="text-align:center;border-top:1px solid #e2e8f0;padding-top:10px;margin-top:14px;font-size:11px;color:#64748b;">
        شكراً لتعاملكم معنا • احتفظ بهذا الإيصال لتفعيل الضمان
      </div>
    `;
    openPrintWindow(`فاتورة ضمان - ${device.model}`, bodyHtml);
  }

  function runQuickAudit() {
    const totalCount = state.devices.length;
    const available = state.devices.filter((d) => !d.isSold).length;
    showToast(`اكتمل الجرد السريع`, `${available} جهاز متاح للبيع من إجمالي ${totalCount} جهاز`);
  }

  function init() {
    window.AppLayout.init("phones");
    const dateInput = document.getElementById("deviceDate");
    if (dateInput) dateInput.value = DB.todayDateStr();

    DB.subscribePhones((list) => {
      state.devices = list;
      renderDevices();
    });

    document.getElementById("newPhoneForm")?.addEventListener("submit", handleDeviceSubmit);
    document.getElementById("sellPhoneForm")?.addEventListener("submit", handleSellSubmit);
    document.getElementById("tableSearchInput")?.addEventListener("input", renderDevices);
    document.getElementById("filterStatus")?.addEventListener("change", renderDevices);
  }

  window.PhonesPage = {
    resetForm,
    scrollToForm,
    generateTempImei,
    editDevice,
    openDeleteModal,
    executeDeviceDelete,
    openSellModal,
    openRevertModal,
    executeRevertStatus,
    reprintReceipt,
    runQuickAudit
  };

  document.addEventListener("DOMContentLoaded", init);
})();
