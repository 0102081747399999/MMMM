// Unified Cloud Firestore Data Layer (mmmm-cba14) with Smart Availability Probe & Local Fallback
(function () {
  const fbApp = window.FirebaseApp || {};
  const db = fbApp.db || null;
  const config = fbApp.config || {};

  const STORAGE_PREFIX = "central_pos_v1_";
  let useLocalFallback = false;
  let probeCompleted = false;

  const statusState = {
    state: db ? "connecting" : "error", // 'connecting' | 'connected' | 'local_fallback' | 'error'
    errorCode: db ? null : "sdk-missing",
    errorMessage: db ? "" : "لم يتم تحميل Firebase SDK",
    rawDetail: "",
    listeners: new Set()
  };

  // In-memory listeners for localStorage fallback mode so UI stays reactive across tabs/operations
  const localListeners = new Map();

  function setStatus(state, errorCode = null, errorMessage = "", rawDetail = "") {
    statusState.state = state;
    statusState.errorCode = errorCode;
    statusState.errorMessage = errorMessage;
    statusState.rawDetail = rawDetail;
    statusState.listeners.forEach((fn) => {
      try {
        fn({ ...statusState });
      } catch (e) {
        console.error(e);
      }
    });
  }

  function onStatusChange(fn) {
    statusState.listeners.add(fn);
    fn({ ...statusState });
    return () => statusState.listeners.delete(fn);
  }

  function mapFirestoreError(err, rawMsg = "") {
    const code = err && err.code ? err.code : "unknown";
    let msg = "تعذر الاتصال بـ Cloud Firestore";
    if (code === "permission-denied") {
      if (rawMsg.includes("API has not been used") || rawMsg.includes("is disabled")) {
        msg = `خدمة Cloud Firestore API غير مفعلة بعد في مشروع ${config.projectId || ""} — يتم الحفظ محلياً مؤقتاً`;
      } else {
        msg = "قواعد الأمان (Firestore Rules) تمنع القراءة أو الكتابة حالياً — يتم الحفظ محلياً مؤقتاً";
      }
    } else if (code === "not-found" || code === "database-not-found") {
      msg = `قاعدة بيانات Cloud Firestore غير مُنشأة بعد في مشروع ${config.projectId || ""} — يتم الحفظ محلياً مؤقتاً`;
    } else if (code === "unavailable") {
      msg = "تعذر الوصول إلى خادم Firebase (تحقق من الاتصال بالإنترنت) — يتم الحفظ محلياً مؤقتاً";
    } else if (code === "invalid-config") {
      msg = "إعدادات مشروع Firebase غير صالحة — يتم الحفظ محلياً مؤقتاً";
    }
    return { code, msg };
  }

  // LocalStorage fallback helpers
  function readLocalCollection(name) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + name);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function writeLocalCollection(name, list) {
    try {
      localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(list));
    } catch (e) {
      console.error("localStorage write failed", e);
    }
    notifyLocalListeners(name);
  }

  function readLocalDocMap(name) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + name);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function writeLocalDocMap(name, map) {
    try {
      localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(map));
    } catch (e) {
      console.error("localStorage write failed", e);
    }
    notifyLocalListeners(name);
  }

  function notifyLocalListeners(name) {
    const fns = localListeners.get(name);
    if (fns) {
      fns.forEach((fn) => {
        try {
          fn();
        } catch (e) {
          console.error(e);
        }
      });
    }
  }

  function addLocalListener(name, fn) {
    if (!localListeners.has(name)) localListeners.set(name, new Set());
    localListeners.get(name).add(fn);
    return () => localListeners.get(name)?.delete(fn);
  }

  window.addEventListener("storage", (e) => {
    if (e.key && e.key.startsWith(STORAGE_PREFIX)) {
      const col = e.key.slice(STORAGE_PREFIX.length);
      notifyLocalListeners(col);
    }
  });

  // Fast REST probe to detect whether Firestore DB exists and rules allow access
  async function probeFirestore() {
    if (!db || !config.projectId || !config.apiKey) {
      useLocalFallback = true;
      probeCompleted = true;
      setStatus("error", "config-missing", "إعدادات Firebase غير مكتملة");
      return false;
    }

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/databases/(default)/documents/settings/store?key=${encodeURIComponent(config.apiKey)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const res = await fetch(url, { method: "GET", signal: controller.signal });
      clearTimeout(timer);

      if (res.ok) {
        useLocalFallback = false;
        probeCompleted = true;
        setStatus("connected");
        return true;
      }

      const body = await res.json().catch(() => ({}));
      const message = (body && body.error && body.error.message) || "";

      if (res.status === 404 && !message.includes("does not exist")) {
        // Database exists; just the document settings/store has not been created yet!
        useLocalFallback = false;
        probeCompleted = true;
        setStatus("connected");
        return true;
      }

      if (res.status === 404 && message.includes("does not exist")) {
        useLocalFallback = true;
        probeCompleted = true;
        const mapped = mapFirestoreError({ code: "database-not-found" }, message);
        setStatus("local_fallback", mapped.code, mapped.msg, message);
        return false;
      }

      if (res.status === 403) {
        useLocalFallback = true;
        probeCompleted = true;
        const mapped = mapFirestoreError({ code: "permission-denied" }, message);
        setStatus("local_fallback", mapped.code, mapped.msg, message);
        return false;
      }

      if (res.status === 400 || res.status === 401) {
        useLocalFallback = true;
        probeCompleted = true;
        const mapped = mapFirestoreError({ code: "invalid-config" }, message);
        setStatus("local_fallback", mapped.code, mapped.msg, message);
        return false;
      }

      useLocalFallback = true;
      probeCompleted = true;
      const mapped = mapFirestoreError({ code: "unavailable" }, message);
      setStatus("local_fallback", mapped.code, mapped.msg, message || `HTTP ${res.status}`);
      return false;
    } catch (err) {
      useLocalFallback = true;
      probeCompleted = true;
      const mapped = mapFirestoreError({ code: "unavailable" });
      setStatus("local_fallback", mapped.code, mapped.msg, err && err.message ? err.message : "");
      return false;
    }
  }

  const readyPromise = probeFirestore();

  function todayDateStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatTimeAr(ms) {
    const dt = ms ? new Date(ms) : new Date();
    return dt.toLocaleTimeString("ar-EG", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
  }

  function formatMoney(num) {
    const n = Number(num) || 0;
    return n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function genLocalId(prefix = "loc") {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  const DEFAULT_SETTINGS = {
    store: {
      storeName: "ريد ماجيك - الفرع الرئيسي",
      storeSubtitle: "للهواتف والإكسسوارات والمدفوعات"
    },
    shift: {
      isOpen: true,
      period: "morning",
      openingBalance: 0,
      openedAt: null,
      cashierName: "أدمن الوردية",
      cashierRole: "إدارة عامة",
      shiftNumber: ""
    },
    security: {
      adminPin: "",
      deletePolicy: "open",
      staffCommissionPercent: 15
    }
  };

  function subscribeCollection(collectionName, callback, filterFn = null, sortFn = null) {
    let unsubFirestore = null;
    let unsubLocal = null;
    let cancelled = false;

    const emitLocal = () => {
      let list = readLocalCollection(collectionName);
      if (filterFn) list = list.filter(filterFn);
      if (sortFn) list.sort(sortFn);
      else list.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      callback(list);
    };

    readyPromise.then((isOnline) => {
      if (cancelled) return;
      if (!isOnline || useLocalFallback || !db) {
        emitLocal();
        unsubLocal = addLocalListener(collectionName, emitLocal);
        return;
      }

      unsubFirestore = db.collection(collectionName).onSnapshot(
        (snapshot) => {
          setStatus("connected");
          let list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          if (filterFn) list = list.filter(filterFn);
          if (sortFn) list.sort(sortFn);
          else list.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
          callback(list);
        },
        (err) => {
          const mapped = mapFirestoreError(err);
          useLocalFallback = true;
          setStatus("local_fallback", mapped.code, mapped.msg);
          emitLocal();
          unsubLocal = addLocalListener(collectionName, emitLocal);
        }
      );
    });

    return () => {
      cancelled = true;
      if (unsubFirestore) unsubFirestore();
      if (unsubLocal) unsubLocal();
    };
  }

  // Settings
  function subscribeSettings(callback) {
    let unsubFirestore = null;
    let unsubLocal = null;
    let cancelled = false;

    const emitLocal = () => {
      const map = readLocalDocMap("settings");
      callback({
        store: { ...DEFAULT_SETTINGS.store, ...(map.store || {}) },
        shift: { ...DEFAULT_SETTINGS.shift, ...(map.shift || {}) },
        security: { ...DEFAULT_SETTINGS.security, ...(map.security || {}) }
      });
    };

    readyPromise.then((isOnline) => {
      if (cancelled) return;
      if (!isOnline || useLocalFallback || !db) {
        emitLocal();
        unsubLocal = addLocalListener("settings", emitLocal);
        return;
      }

      unsubFirestore = db.collection("settings").onSnapshot(
        (snapshot) => {
          setStatus("connected");
          const result = {
            store: { ...DEFAULT_SETTINGS.store },
            shift: { ...DEFAULT_SETTINGS.shift },
            security: { ...DEFAULT_SETTINGS.security }
          };
          snapshot.docs.forEach((doc) => {
            if (result[doc.id]) {
              result[doc.id] = { ...result[doc.id], ...doc.data() };
            }
          });
          callback(result);
        },
        (err) => {
          const mapped = mapFirestoreError(err);
          useLocalFallback = true;
          setStatus("local_fallback", mapped.code, mapped.msg);
          emitLocal();
          unsubLocal = addLocalListener("settings", emitLocal);
        }
      );
    });

    return () => {
      cancelled = true;
      if (unsubFirestore) unsubFirestore();
      if (unsubLocal) unsubLocal();
    };
  }

  async function saveSetting(docId, data) {
    await readyPromise;
    if (useLocalFallback || !db) {
      const map = readLocalDocMap("settings");
      map[docId] = { ...(map[docId] || {}), ...data, updatedAtMs: Date.now() };
      writeLocalDocMap("settings", map);
      return;
    }
    await db.collection("settings").doc(docId).set({ ...data, updatedAtMs: Date.now() }, { merge: true });
  }

  // Generic local/firestore collection CRUD helpers
  async function addDocTo(col, data) {
    await readyPromise;
    const now = Date.now();
    if (useLocalFallback || !db) {
      const list = readLocalCollection(col);
      const item = { id: genLocalId(col), ...data, createdAtMs: data.createdAtMs || now };
      list.unshift(item);
      writeLocalCollection(col, list);
      return item;
    }
    const ref = await db.collection(col).add({ ...data, createdAtMs: data.createdAtMs || now });
    return { id: ref.id, ...data };
  }

  async function updateDocIn(col, id, updates) {
    await readyPromise;
    const now = Date.now();
    if (useLocalFallback || !db) {
      const list = readLocalCollection(col);
      const idx = list.findIndex((x) => x.id === id);
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...updates, updatedAtMs: now };
        writeLocalCollection(col, list);
      }
      return;
    }
    await db.collection(col).doc(id).update({ ...updates, updatedAtMs: now });
  }

  async function deleteDocFrom(col, id) {
    await readyPromise;
    if (useLocalFallback || !db) {
      const list = readLocalCollection(col).filter((x) => x.id !== id);
      writeLocalCollection(col, list);
      return;
    }
    await db.collection(col).doc(id).delete();
  }

  // Staff CRUD
  function subscribeStaff(callback) {
    return subscribeCollection("staff", callback);
  }

  // Wallets (cash_1, cash_2, cash_3)
  function subscribeWallets(callback) {
    let unsubFirestore = null;
    let unsubLocal = null;
    let cancelled = false;

    const emitLocal = () => {
      callback(readLocalDocMap("wallets"));
    };

    readyPromise.then((isOnline) => {
      if (cancelled) return;
      if (!isOnline || useLocalFallback || !db) {
        emitLocal();
        unsubLocal = addLocalListener("wallets", emitLocal);
        return;
      }

      unsubFirestore = db.collection("wallets").onSnapshot(
        (snapshot) => {
          setStatus("connected");
          const map = {};
          snapshot.docs.forEach((doc) => {
            map[doc.id] = { id: doc.id, ...doc.data() };
          });
          callback(map);
        },
        (err) => {
          const mapped = mapFirestoreError(err);
          useLocalFallback = true;
          setStatus("local_fallback", mapped.code, mapped.msg);
          emitLocal();
          unsubLocal = addLocalListener("wallets", emitLocal);
        }
      );
    });

    return () => {
      cancelled = true;
      if (unsubFirestore) unsubFirestore();
      if (unsubLocal) unsubLocal();
    };
  }

  function subscribeWallet(walletId, callback) {
    return subscribeWallets((map) => {
      const doc = map[walletId] || { id: walletId, walletId, simNumber: "", openingBalance: 0, isActive: true };
      callback(doc);
    });
  }

  async function saveWallet(walletId, data) {
    await readyPromise;
    const now = Date.now();
    if (useLocalFallback || !db) {
      const map = readLocalDocMap("wallets");
      map[walletId] = { id: walletId, walletId, ...(map[walletId] || {}), ...data, updatedAtMs: now };
      writeLocalDocMap("wallets", map);
      return;
    }
    await db.collection("wallets").doc(walletId).set({ walletId, ...data, updatedAtMs: now }, { merge: true });
  }

  // Wallet Transactions
  function subscribeWalletTransactions(walletId, callback) {
    return subscribeCollection(
      "walletTransactions",
      callback,
      (t) => t.walletId === walletId,
      (a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0)
    );
  }

  function subscribeAllWalletTransactions(callback) {
    return subscribeCollection("walletTransactions", callback);
  }

  async function addWalletTx(tx) {
    const now = Date.now();
    return addDocTo("walletTransactions", {
      ...tx,
      dateStr: tx.dateStr || todayDateStr(),
      timeStr: tx.timeStr || formatTimeAr(now),
      createdAtMs: now
    });
  }

  // Inventory (chargers, headphones, speakers)
  function subscribeInventory(section, callback) {
    return subscribeCollection("inventory", callback, (i) => i.section === section);
  }

  function subscribeAllInventory(callback) {
    return subscribeCollection("inventory", callback);
  }

  async function sellInventoryItem({ item, qty = 1, unitPrice, paymentMethod = "نقدي (كاش)", customerName = "", customerPhone = "", staffName = "الكاشير" }) {
    await readyPromise;
    const now = Date.now();
    const dateStr = todayDateStr();
    const timeStr = formatTimeAr(now);
    const sellPrice = Number(unitPrice !== undefined ? unitPrice : item.salePrice) || 0;
    const costPrice = Number(item.costPrice) || 0;
    const totalAmount = sellPrice * qty;
    const profit = (sellPrice - costPrice) * qty;

    if (useLocalFallback || !db) {
      const inv = readLocalCollection("inventory");
      const idx = inv.findIndex((x) => x.id === item.id);
      if (idx === -1) throw new Error("الصنف غير موجود في المخزن");
      const curQty = Number(inv[idx].qty) || 0;
      if (curQty < qty) throw new Error("الكمية المتاحة في المخزن غير كافية");

      inv[idx] = { ...inv[idx], qty: curQty - qty, updatedAtMs: now };
      writeLocalCollection("inventory", inv);

      const saleId = genLocalId("sale");
      const sales = readLocalCollection("sales");
      sales.unshift({
        id: saleId,
        section: item.section,
        itemId: item.id,
        itemName: `${item.brand ? item.brand + " - " : ""}${item.name}`,
        qty,
        unitPrice: sellPrice,
        unitCost: costPrice,
        totalAmount,
        profit,
        paymentMethod,
        customerName,
        customerPhone,
        staffName,
        dateStr,
        timeStr,
        createdAtMs: now
      });
      writeLocalCollection("sales", sales);

      if (paymentMethod === "نقدي (كاش)") {
        const drawer = readLocalCollection("drawerTransactions");
        drawer.unshift({
          id: genLocalId("drw"),
          type: "sale",
          source: item.section,
          amount: totalAmount,
          direction: "in",
          reason: `بيع ${qty} × ${item.brand ? item.brand + " " : ""}${item.name}`,
          staffName,
          refId: saleId,
          dateStr,
          timeStr,
          createdAtMs: now
        });
        writeLocalCollection("drawerTransactions", drawer);
      }
      return;
    }

    await db.runTransaction(async (transaction) => {
      const itemRef = db.collection("inventory").doc(item.id);
      const snap = await transaction.get(itemRef);
      if (!snap.exists) throw new Error("الصنف غير موجود في المخزن");
      const currentQty = Number(snap.data().qty) || 0;
      if (currentQty < qty) throw new Error("الكمية المتاحة في المخزن غير كافية");

      transaction.update(itemRef, { qty: currentQty - qty, updatedAtMs: now });

      const saleRef = db.collection("sales").doc();
      transaction.set(saleRef, {
        section: item.section,
        itemId: item.id,
        itemName: `${item.brand ? item.brand + " - " : ""}${item.name}`,
        qty,
        unitPrice: sellPrice,
        unitCost: costPrice,
        totalAmount,
        profit,
        paymentMethod,
        customerName,
        customerPhone,
        staffName,
        dateStr,
        timeStr,
        createdAtMs: now
      });

      if (paymentMethod === "نقدي (كاش)") {
        const drawerRef = db.collection("drawerTransactions").doc();
        transaction.set(drawerRef, {
          type: "sale",
          source: item.section,
          amount: totalAmount,
          direction: "in",
          reason: `بيع ${qty} × ${item.brand ? item.brand + " " : ""}${item.name}`,
          staffName,
          refId: saleRef.id,
          dateStr,
          timeStr,
          createdAtMs: now
        });
      }
    });
  }

  // Phones
  function subscribePhones(callback) {
    return subscribeCollection("phones", callback);
  }

  async function addPhone(phone) {
    return addDocTo("phones", {
      ...phone,
      isSold: false,
      saleDetails: null,
      updatedAtMs: Date.now()
    });
  }

  async function sellPhone(phone, { buyer, buyerPhone, price, warranty, payment, staffName = "الكاشير" }) {
    await readyPromise;
    const now = Date.now();
    const dateStr = todayDateStr();
    const timeStr = formatTimeAr(now);
    const salePrice = Number(price) || Number(phone.sellingPrice) || 0;
    const costPrice = Number(phone.costPrice) || 0;

    if (useLocalFallback || !db) {
      const phones = readLocalCollection("phones");
      const idx = phones.findIndex((p) => p.id === phone.id);
      if (idx === -1) throw new Error("الهاتف غير موجود");
      if (phones[idx].isSold) throw new Error("تم بيع هذا الهاتف مسبقاً");

      const saleId = genLocalId("sale");
      let drawerTxId = null;

      const sales = readLocalCollection("sales");
      sales.unshift({
        id: saleId,
        section: "phones",
        itemId: phone.id,
        itemName: `${phone.brand} ${phone.model} (${phone.imei1})`,
        qty: 1,
        unitPrice: salePrice,
        unitCost: costPrice,
        totalAmount: salePrice,
        profit: salePrice - costPrice,
        paymentMethod: payment,
        customerName: buyer,
        customerPhone: buyerPhone,
        staffName,
        dateStr,
        timeStr,
        createdAtMs: now
      });
      writeLocalCollection("sales", sales);

      if (payment === "نقدي (كاش)") {
        drawerTxId = genLocalId("drw");
        const drawer = readLocalCollection("drawerTransactions");
        drawer.unshift({
          id: drawerTxId,
          type: "sale",
          source: "phones",
          amount: salePrice,
          direction: "in",
          reason: `بيع هاتف ${phone.brand} ${phone.model} (${phone.imei1})`,
          staffName,
          refId: saleId,
          dateStr,
          timeStr,
          createdAtMs: now
        });
        writeLocalCollection("drawerTransactions", drawer);
      }

      const saleDetails = {
        buyer,
        phone: buyerPhone,
        price: salePrice,
        warranty,
        payment,
        soldAt: new Date(now).toLocaleString("ar-EG"),
        soldDateStr: dateStr,
        saleId,
        drawerTxId
      };
      phones[idx] = { ...phones[idx], isSold: true, saleDetails, updatedAtMs: now };
      writeLocalCollection("phones", phones);
      return saleDetails;
    }

    let saleDetailsResult = null;
    await db.runTransaction(async (transaction) => {
      const phoneRef = db.collection("phones").doc(phone.id);
      const snap = await transaction.get(phoneRef);
      if (!snap.exists) throw new Error("الهاتف غير موجود");
      if (snap.data().isSold) throw new Error("تم بيع هذا الهاتف مسبقاً");

      const saleRef = db.collection("sales").doc();
      let drawerTxId = null;

      transaction.set(saleRef, {
        section: "phones",
        itemId: phone.id,
        itemName: `${phone.brand} ${phone.model} (${phone.imei1})`,
        qty: 1,
        unitPrice: salePrice,
        unitCost: costPrice,
        totalAmount: salePrice,
        profit: salePrice - costPrice,
        paymentMethod: payment,
        customerName: buyer,
        customerPhone: buyerPhone,
        staffName,
        dateStr,
        timeStr,
        createdAtMs: now
      });

      if (payment === "نقدي (كاش)") {
        const drawerRef = db.collection("drawerTransactions").doc();
        drawerTxId = drawerRef.id;
        transaction.set(drawerRef, {
          type: "sale",
          source: "phones",
          amount: salePrice,
          direction: "in",
          reason: `بيع هاتف ${phone.brand} ${phone.model} (${phone.imei1})`,
          staffName,
          refId: saleRef.id,
          dateStr,
          timeStr,
          createdAtMs: now
        });
      }

      saleDetailsResult = {
        buyer,
        phone: buyerPhone,
        price: salePrice,
        warranty,
        payment,
        soldAt: new Date(now).toLocaleString("ar-EG"),
        soldDateStr: dateStr,
        saleId: saleRef.id,
        drawerTxId
      };

      transaction.update(phoneRef, { isSold: true, saleDetails: saleDetailsResult, updatedAtMs: now });
    });

    return saleDetailsResult;
  }

  async function revertPhoneSale(phone) {
    await readyPromise;
    if (useLocalFallback || !db) {
      if (phone.saleDetails?.saleId) {
        writeLocalCollection("sales", readLocalCollection("sales").filter((s) => s.id !== phone.saleDetails.saleId));
      }
      if (phone.saleDetails?.drawerTxId) {
        writeLocalCollection("drawerTransactions", readLocalCollection("drawerTransactions").filter((d) => d.id !== phone.saleDetails.drawerTxId));
      }
      const phones = readLocalCollection("phones");
      const idx = phones.findIndex((p) => p.id === phone.id);
      if (idx !== -1) {
        phones[idx] = { ...phones[idx], isSold: false, saleDetails: null, updatedAtMs: Date.now() };
        writeLocalCollection("phones", phones);
      }
      return;
    }

    const batch = db.batch();
    const phoneRef = db.collection("phones").doc(phone.id);
    if (phone.saleDetails?.saleId) batch.delete(db.collection("sales").doc(phone.saleDetails.saleId));
    if (phone.saleDetails?.drawerTxId) batch.delete(db.collection("drawerTransactions").doc(phone.saleDetails.drawerTxId));
    batch.update(phoneRef, { isSold: false, saleDetails: null, updatedAtMs: Date.now() });
    await batch.commit();
  }

  // Global Quick POS Cart Checkout
  async function checkoutPosCart({ items, paymentMethod = "نقدي (كاش)", customerName = "", customerPhone = "", staffName = "الكاشير" }) {
    await readyPromise;
    const now = Date.now();
    const dateStr = todayDateStr();
    const timeStr = formatTimeAr(now);
    let grandTotal = 0;

    if (useLocalFallback || !db) {
      const inv = readLocalCollection("inventory");
      const phones = readLocalCollection("phones");
      const sales = readLocalCollection("sales");

      for (const line of items) {
        if (line.kind === "phone") {
          const p = phones.find((x) => x.id === line.id);
          if (!p) throw new Error(`العنصر "${line.title}" لم يعد موجوداً`);
          if (p.isSold) throw new Error(`الهاتف "${line.title}" تم بيعه مسبقاً`);
        } else {
          const item = inv.find((x) => x.id === line.id);
          if (!item) throw new Error(`العنصر "${line.title}" لم يعد موجوداً`);
          if ((Number(item.qty) || 0) < line.qty) throw new Error(`الكمية المتاحة من "${line.title}" غير كافية`);
        }
      }

      for (const line of items) {
        const lineTotal = line.unitPrice * line.qty;
        grandTotal += lineTotal;
        const saleId = genLocalId("sale");

        if (line.kind === "phone") {
          const pIdx = phones.findIndex((x) => x.id === line.id);
          const p = phones[pIdx];
          phones[pIdx] = {
            ...p,
            isSold: true,
            saleDetails: {
              buyer: customerName || "عميل نقدي",
              phone: customerPhone || "-",
              price: line.unitPrice,
              warranty: "فاتورة بيع سريعة",
              payment: paymentMethod,
              soldAt: new Date(now).toLocaleString("ar-EG"),
              soldDateStr: dateStr,
              saleId,
              drawerTxId: null
            },
            updatedAtMs: now
          };
          sales.unshift({
            id: saleId,
            section: "phones",
            itemId: line.id,
            itemName: line.title,
            qty: 1,
            unitPrice: line.unitPrice,
            unitCost: Number(p.costPrice) || 0,
            totalAmount: lineTotal,
            profit: lineTotal - (Number(p.costPrice) || 0),
            paymentMethod,
            customerName,
            customerPhone,
            staffName,
            dateStr,
            timeStr,
            createdAtMs: now
          });
        } else {
          const iIdx = inv.findIndex((x) => x.id === line.id);
          const item = inv[iIdx];
          inv[iIdx] = { ...item, qty: (Number(item.qty) || 0) - line.qty, updatedAtMs: now };
          sales.unshift({
            id: saleId,
            section: item.section,
            itemId: line.id,
            itemName: line.title,
            qty: line.qty,
            unitPrice: line.unitPrice,
            unitCost: Number(item.costPrice) || 0,
            totalAmount: lineTotal,
            profit: lineTotal - (Number(item.costPrice) || 0) * line.qty,
            paymentMethod,
            customerName,
            customerPhone,
            staffName,
            dateStr,
            timeStr,
            createdAtMs: now
          });
        }
      }

      writeLocalCollection("inventory", inv);
      writeLocalCollection("phones", phones);
      writeLocalCollection("sales", sales);

      if (paymentMethod === "نقدي (كاش)" && grandTotal > 0) {
        const drawer = readLocalCollection("drawerTransactions");
        drawer.unshift({
          id: genLocalId("drw"),
          type: "sale",
          source: "pos",
          amount: grandTotal,
          direction: "in",
          reason: `فاتورة مبيعات سريعة (${items.length} أصناف)${customerName ? " - " + customerName : ""}`,
          staffName,
          dateStr,
          timeStr,
          createdAtMs: now
        });
        writeLocalCollection("drawerTransactions", drawer);
      }

      return { grandTotal, dateStr, timeStr };
    }

    await db.runTransaction(async (transaction) => {
      const snaps = [];
      for (const line of items) {
        const col = line.kind === "phone" ? "phones" : "inventory";
        const ref = db.collection(col).doc(line.id);
        const snap = await transaction.get(ref);
        snaps.push({ line, ref, snap });
      }

      for (const entry of snaps) {
        if (!entry.snap.exists) throw new Error(`العنصر "${entry.line.title}" لم يعد موجوداً`);
        const data = entry.snap.data();
        if (entry.line.kind === "phone") {
          if (data.isSold) throw new Error(`الهاتف "${entry.line.title}" تم بيعه مسبقاً`);
        } else if ((Number(data.qty) || 0) < entry.line.qty) {
          throw new Error(`الكمية المتاحة من "${entry.line.title}" غير كافية`);
        }
      }

      for (const entry of snaps) {
        const { line, ref, snap } = entry;
        const data = snap.data();
        const lineTotal = line.unitPrice * line.qty;
        grandTotal += lineTotal;
        const saleRef = db.collection("sales").doc();

        if (line.kind === "phone") {
          transaction.update(ref, {
            isSold: true,
            saleDetails: {
              buyer: customerName || "عميل نقدي",
              phone: customerPhone || "-",
              price: line.unitPrice,
              warranty: "فاتورة بيع سريعة",
              payment: paymentMethod,
              soldAt: new Date(now).toLocaleString("ar-EG"),
              soldDateStr: dateStr,
              saleId: saleRef.id,
              drawerTxId: null
            },
            updatedAtMs: now
          });
          transaction.set(saleRef, {
            section: "phones",
            itemId: line.id,
            itemName: line.title,
            qty: 1,
            unitPrice: line.unitPrice,
            unitCost: Number(data.costPrice) || 0,
            totalAmount: lineTotal,
            profit: lineTotal - (Number(data.costPrice) || 0),
            paymentMethod,
            customerName,
            customerPhone,
            staffName,
            dateStr,
            timeStr,
            createdAtMs: now
          });
        } else {
          transaction.update(ref, { qty: (Number(data.qty) || 0) - line.qty, updatedAtMs: now });
          transaction.set(saleRef, {
            section: data.section,
            itemId: line.id,
            itemName: line.title,
            qty: line.qty,
            unitPrice: line.unitPrice,
            unitCost: Number(data.costPrice) || 0,
            totalAmount: lineTotal,
            profit: lineTotal - (Number(data.costPrice) || 0) * line.qty,
            paymentMethod,
            customerName,
            customerPhone,
            staffName,
            dateStr,
            timeStr,
            createdAtMs: now
          });
        }
      }

      if (paymentMethod === "نقدي (كاش)" && grandTotal > 0) {
        const drawerRef = db.collection("drawerTransactions").doc();
        transaction.set(drawerRef, {
          type: "sale",
          source: "pos",
          amount: grandTotal,
          direction: "in",
          reason: `فاتورة مبيعات سريعة (${items.length} أصناف)${customerName ? " - " + customerName : ""}`,
          staffName,
          dateStr,
          timeStr,
          createdAtMs: now
        });
      }
    });

    return { grandTotal, dateStr, timeStr };
  }

  // Sales & Drawer & Shift Closings
  function subscribeSales(callback) {
    return subscribeCollection("sales", callback);
  }

  function subscribeDrawerTransactions(callback) {
    return subscribeCollection("drawerTransactions", callback);
  }

  async function addDrawerTx(tx) {
    const now = Date.now();
    return addDocTo("drawerTransactions", {
      ...tx,
      dateStr: tx.dateStr || todayDateStr(),
      timeStr: tx.timeStr || formatTimeAr(now),
      createdAtMs: now
    });
  }

  function subscribeShiftClosings(callback) {
    return subscribeCollection("shiftClosings", callback);
  }

  async function saveShiftClosing(report) {
    const now = Date.now();
    return addDocTo("shiftClosings", {
      ...report,
      dateStr: todayDateStr(),
      closedAt: new Date(now).toLocaleString("ar-EG"),
      createdAtMs: now
    });
  }

  const LOCAL_LIST_COLLECTIONS = [
    "staff",
    "walletTransactions",
    "inventory",
    "phones",
    "sales",
    "drawerTransactions",
    "shiftClosings"
  ];
  const LOCAL_MAP_COLLECTIONS = ["settings", "wallets"];

  function getLocalDataSummary() {
    let total = 0;
    const details = {};
    LOCAL_MAP_COLLECTIONS.forEach((col) => {
      const map = readLocalDocMap(col);
      const count = Object.keys(map || {}).length;
      if (count > 0) details[col] = count;
      total += count;
    });
    LOCAL_LIST_COLLECTIONS.forEach((col) => {
      const list = readLocalCollection(col);
      const count = Array.isArray(list) ? list.length : 0;
      if (count > 0) details[col] = count;
      total += count;
    });
    return { total, details };
  }

  async function syncLocalToCloud() {
    await readyPromise;
    if (useLocalFallback || !db) {
      throw new Error("المزامنة السحابية غير متصلة حالياً — فعّل Cloud Firestore أولاً");
    }

    const ops = [];
    LOCAL_MAP_COLLECTIONS.forEach((col) => {
      const map = readLocalDocMap(col);
      Object.entries(map || {}).forEach(([docId, val]) => {
        if (!docId || !val || typeof val !== "object") return;
        const { id: _ignored, ...payload } = val;
        ops.push({ ref: db.collection(col).doc(docId), data: payload });
      });
    });

    LOCAL_LIST_COLLECTIONS.forEach((col) => {
      const list = readLocalCollection(col);
      (Array.isArray(list) ? list : []).forEach((item) => {
        if (!item || typeof item !== "object") return;
        const { id, ...payload } = item;
        const ref = id ? db.collection(col).doc(String(id)) : db.collection(col).doc();
        ops.push({ ref, data: payload });
      });
    });

    if (ops.length === 0) return { uploadedCount: 0 };

    const CHUNK_SIZE = 400;
    for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
      const batch = db.batch();
      ops.slice(i, i + CHUNK_SIZE).forEach(({ ref, data }) => {
        batch.set(ref, data, { merge: true });
      });
      await batch.commit();
    }

    [...LOCAL_MAP_COLLECTIONS, ...LOCAL_LIST_COLLECTIONS].forEach((col) => {
      try {
        localStorage.removeItem(STORAGE_PREFIX + col);
      } catch {}
    });

    return { uploadedCount: ops.length };
  }

  async function recheckConnection() {
    setStatus("connecting");
    return probeFirestore();
  }

  window.addEventListener("online", () => {
    if (useLocalFallback && statusState.errorCode === "unavailable") {
      recheckConnection();
    }
  });

  window.PosDB = {
    onStatusChange,
    recheckConnection,
    getStatus: () => ({ ...statusState }),
    isCloudConnected: () => statusState.state === "connected",
    getLocalDataSummary,
    syncLocalToCloud,
    todayDateStr,
    formatTimeAr,
    formatMoney,
    DEFAULT_SETTINGS,
    subscribeSettings,
    saveSetting,
    subscribeStaff,
    addStaff: (s) => addDocTo("staff", s),
    updateStaff: (id, u) => updateDocIn("staff", id, u),
    deleteStaff: (id) => deleteDocFrom("staff", id),
    subscribeWallets,
    subscribeWallet,
    saveWallet,
    subscribeWalletTransactions,
    subscribeAllWalletTransactions,
    addWalletTx,
    updateWalletTx: (id, u) => updateDocIn("walletTransactions", id, u),
    deleteWalletTx: (id) => deleteDocFrom("walletTransactions", id),
    subscribeInventory,
    subscribeAllInventory,
    addInventoryItem: (i) => addDocTo("inventory", { ...i, updatedAtMs: Date.now() }),
    updateInventoryItem: (id, u) => updateDocIn("inventory", id, u),
    deleteInventoryItem: (id) => deleteDocFrom("inventory", id),
    sellInventoryItem,
    subscribePhones,
    addPhone,
    updatePhone: (id, u) => updateDocIn("phones", id, u),
    deletePhone: (id) => deleteDocFrom("phones", id),
    sellPhone,
    revertPhoneSale,
    checkoutPosCart,
    subscribeSales,
    subscribeDrawerTransactions,
    addDrawerTx,
    updateDrawerTx: (id, u) => updateDocIn("drawerTransactions", id, u),
    deleteDrawerTx: (id) => deleteDocFrom("drawerTransactions", id),
    subscribeShiftClosings,
    saveShiftClosing
  };
})();
