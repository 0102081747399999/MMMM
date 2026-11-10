// Firebase Configuration & Initialization (mmmm-cba14)
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyB31mQ6dNXHn6Oi67gnKCChh1pkoAXxaYI",
    authDomain: "mmmm-cba14.firebaseapp.com",
    projectId: "mmmm-cba14",
    storageBucket: "mmmm-cba14.firebasestorage.app",
    messagingSenderId: "38625964396",
    appId: "1:38625964396:web:1eb3e1923a6651d02fc349",
    measurementId: "G-7WZ82X3E8V"
  };

  if (typeof firebase === "undefined") {
    console.error("Firebase SDK failed to load. Check internet connection.");
    window.FirebaseApp = { app: null, db: null, analytics: null, config: firebaseConfig };
    return;
  }

  const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();

  // Enable local offline persistence across tabs when supported
  db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code !== "failed-precondition" && err.code !== "unimplemented") {
      console.warn("Firestore persistence warning:", err.code);
    }
  });

  // Analytics only runs over http/https (avoid errors on file://)
  let analytics = null;
  try {
    if (window.location.protocol.startsWith("http") && typeof firebase.analytics === "function") {
      analytics = firebase.analytics();
    }
  } catch (err) {
    console.info("Firebase Analytics skipped:", err.message);
  }

  window.FirebaseApp = {
    app,
    db,
    analytics,
    config: firebaseConfig
  };
})();
