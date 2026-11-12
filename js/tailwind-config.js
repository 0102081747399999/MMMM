// Central POS - Multi-Theme & Dark Onyx Configuration
(function () {
  const THEMES = {
    "dark-onyx": {
      id: "dark-onyx",
      name: "الأسود الداكن الفاخر (Dark Slate / Onyx)",
      desc: "تصميم داكن فخم مع تباين عالي ولمسات تيتانيوم وسماوي مثلج",
      badge: "الخيار المختار ★",
      previewHex: ["#090d16", "#162032", "#38bdf8"],
      colors: {
        "navy-dark": "#090d16",
        "navy-card": "#121824",
        "sky-accent": "#38bdf8",
        "sky-primary": "#2563eb",

        "surface-tint": "#0284c7",
        "primary": "#0284c7",
        "on-primary": "#ffffff",
        "primary-container": "#0369a1",
        "on-primary-container": "#f0f9ff",
        "primary-fixed": "#162032",
        "primary-fixed-dim": "#38bdf8",
        "on-primary-fixed": "#e0f2fe",
        "on-primary-fixed-variant": "#bae6fd",
        "inverse-primary": "#38bdf8",

        "secondary": "#94a3b8",
        "on-secondary": "#090d16",
        "secondary-container": "#1e293b",
        "on-secondary-container": "#f1f5f9",
        "secondary-fixed": "#1e293b",
        "secondary-fixed-dim": "#334155",
        "on-secondary-fixed": "#f8fafc",
        "on-secondary-fixed-variant": "#cbd5e1",

        "tertiary": "#10b981",
        "on-tertiary": "#ffffff",
        "tertiary-container": "#059669",
        "on-tertiary-container": "#ecfdf5",
        "tertiary-fixed": "#132e27",
        "tertiary-fixed-dim": "#34d399",
        "on-tertiary-fixed": "#a7f3d0",
        "on-tertiary-fixed-variant": "#6ee7b7",

        "error": "#f43f5e",
        "on-error": "#ffffff",
        "error-container": "#881337",
        "on-error-container": "#ffe4e6",

        "warning": "#f59e0b",
        "warning-container": "#78350f",
        "on-warning-container": "#fef3c7",

        "background": "#090d16",
        "on-background": "#f8fafc",
        "surface": "#090d16",
        "surface-bright": "#121824",
        "surface-dim": "#090d16",
        "surface-variant": "#162032",
        "surface-container-lowest": "#090d16",
        "surface-container-low": "#0f172a",
        "surface-container": "#162032",
        "surface-container-high": "#1e293b",
        "surface-container-highest": "#334155",
        "on-surface": "#f8fafc",
        "on-surface-variant": "#94a3b8",

        "inverse-surface": "#f8fafc",
        "inverse-on-surface": "#090d16",

        "outline": "#64748b",
        "outline-variant": "#1f293d"
      }
    },
    "red-magic": {
      id: "red-magic",
      name: "ريد ماجيك القرمزي (Red Magic Crimson)",
      desc: "مطابق لشعار وهوية المتجر باللون القرمزي والأسود الرياضي",
      badge: "هوية المتجر",
      previewHex: ["#0e090c", "#20131d", "#f43f5e"],
      colors: {
        "navy-dark": "#0e090c",
        "navy-card": "#1c1218",
        "sky-accent": "#f43f5e",
        "sky-primary": "#e11d48",

        "surface-tint": "#e11d48",
        "primary": "#e11d48",
        "on-primary": "#ffffff",
        "primary-container": "#be123c",
        "on-primary-container": "#fff1f2",
        "primary-fixed": "#2c121c",
        "primary-fixed-dim": "#fb7185",
        "on-primary-fixed": "#ffe4e6",
        "on-primary-fixed-variant": "#fda4af",
        "inverse-primary": "#fb7185",

        "secondary": "#94a3b8",
        "on-secondary": "#0e090c",
        "secondary-container": "#1f1820",
        "on-secondary-container": "#f1f5f9",
        "secondary-fixed": "#1f1820",
        "secondary-fixed-dim": "#334155",
        "on-secondary-fixed": "#f8fafc",
        "on-secondary-fixed-variant": "#cbd5e1",

        "tertiary": "#10b981",
        "on-tertiary": "#ffffff",
        "tertiary-container": "#059669",
        "on-tertiary-container": "#ecfdf5",
        "tertiary-fixed": "#132e27",
        "tertiary-fixed-dim": "#34d399",
        "on-tertiary-fixed": "#a7f3d0",
        "on-tertiary-fixed-variant": "#6ee7b7",

        "error": "#f43f5e",
        "on-error": "#ffffff",
        "error-container": "#881337",
        "on-error-container": "#ffe4e6",

        "warning": "#f59e0b",
        "warning-container": "#78350f",
        "on-warning-container": "#fef3c7",

        "background": "#0e090c",
        "on-background": "#f8fafc",
        "surface": "#0e090c",
        "surface-bright": "#1a1217",
        "surface-dim": "#0e090c",
        "surface-variant": "#261720",
        "surface-container-lowest": "#0e090c",
        "surface-container-low": "#150d13",
        "surface-container": "#20131d",
        "surface-container-high": "#2b1927",
        "surface-container-highest": "#3d2237",
        "on-surface": "#f8fafc",
        "on-surface-variant": "#fda4af",

        "inverse-surface": "#f8fafc",
        "inverse-on-surface": "#0e090c",

        "outline": "#881337",
        "outline-variant": "#4c0519"
      }
    },
    "emerald": {
      id: "emerald",
      name: "الزمردي المالي (Emerald Green POS)",
      desc: "طابع كاشير ونظام مالي باللون الأخضر المريح للعين",
      badge: "مالي وهادئ",
      previewHex: ["#061a14", "#0e3126", "#10b981"],
      colors: {
        "navy-dark": "#061a14",
        "navy-card": "#0c2c22",
        "sky-accent": "#34d399",
        "sky-primary": "#059669",

        "surface-tint": "#059669",
        "primary": "#059669",
        "on-primary": "#ffffff",
        "primary-container": "#047857",
        "on-primary-container": "#ecfdf5",
        "primary-fixed": "#103d30",
        "primary-fixed-dim": "#34d399",
        "on-primary-fixed": "#d1fae5",
        "on-primary-fixed-variant": "#a7f3d0",
        "inverse-primary": "#34d399",

        "secondary": "#94a3b8",
        "on-secondary": "#061a14",
        "secondary-container": "#122a21",
        "on-secondary-container": "#f1f5f9",
        "secondary-fixed": "#122a21",
        "secondary-fixed-dim": "#334155",
        "on-secondary-fixed": "#f8fafc",
        "on-secondary-fixed-variant": "#cbd5e1",

        "tertiary": "#10b981",
        "on-tertiary": "#ffffff",
        "tertiary-container": "#059669",
        "on-tertiary-container": "#ecfdf5",
        "tertiary-fixed": "#132e27",
        "tertiary-fixed-dim": "#34d399",
        "on-tertiary-fixed": "#a7f3d0",
        "on-tertiary-fixed-variant": "#6ee7b7",

        "error": "#f43f5e",
        "on-error": "#ffffff",
        "error-container": "#881337",
        "on-error-container": "#ffe4e6",

        "warning": "#f59e0b",
        "warning-container": "#78350f",
        "on-warning-container": "#fef3c7",

        "background": "#061a14",
        "on-background": "#f8fafc",
        "surface": "#061a14",
        "surface-bright": "#0c2c22",
        "surface-dim": "#061a14",
        "surface-variant": "#12382c",
        "surface-container-lowest": "#061a14",
        "surface-container-low": "#09231b",
        "surface-container": "#0e3126",
        "surface-container-high": "#144032",
        "surface-container-highest": "#1c5341",
        "on-surface": "#f8fafc",
        "on-surface-variant": "#6ee7b7",

        "inverse-surface": "#f8fafc",
        "inverse-on-surface": "#061a14",

        "outline": "#065f46",
        "outline-variant": "#047857"
      }
    },
    "royal-purple": {
      id: "royal-purple",
      name: "البنفسجي الملكي الحديث (Royal Violet)",
      desc: "مظهر عصري أنيق ومميز للمحلات الحديثة",
      badge: "عصري وفاخر",
      previewHex: ["#10091e", "#1f1338", "#c084fc"],
      colors: {
        "navy-dark": "#10091e",
        "navy-card": "#1d1233",
        "sky-accent": "#c084fc",
        "sky-primary": "#9333ea",

        "surface-tint": "#9333ea",
        "primary": "#9333ea",
        "on-primary": "#ffffff",
        "primary-container": "#7e22ce",
        "on-primary-container": "#faf5ff",
        "primary-fixed": "#2c174d",
        "primary-fixed-dim": "#c084fc",
        "on-primary-fixed": "#f3e8ff",
        "on-primary-fixed-variant": "#e9d5ff",
        "inverse-primary": "#c084fc",

        "secondary": "#94a3b8",
        "on-secondary": "#10091e",
        "secondary-container": "#1f1730",
        "on-secondary-container": "#f1f5f9",
        "secondary-fixed": "#1f1730",
        "secondary-fixed-dim": "#334155",
        "on-secondary-fixed": "#f8fafc",
        "on-secondary-fixed-variant": "#cbd5e1",

        "tertiary": "#10b981",
        "on-tertiary": "#ffffff",
        "tertiary-container": "#059669",
        "on-tertiary-container": "#ecfdf5",
        "tertiary-fixed": "#132e27",
        "tertiary-fixed-dim": "#34d399",
        "on-tertiary-fixed": "#a7f3d0",
        "on-tertiary-fixed-variant": "#6ee7b7",

        "error": "#f43f5e",
        "on-error": "#ffffff",
        "error-container": "#881337",
        "on-error-container": "#ffe4e6",

        "warning": "#f59e0b",
        "warning-container": "#78350f",
        "on-warning-container": "#fef3c7",

        "background": "#10091e",
        "on-background": "#f8fafc",
        "surface": "#10091e",
        "surface-bright": "#1d1233",
        "surface-dim": "#10091e",
        "surface-variant": "#261742",
        "surface-container-lowest": "#10091e",
        "surface-container-low": "#150d26",
        "surface-container": "#1f1338",
        "surface-container-high": "#2c1a4d",
        "surface-container-highest": "#3d246c",
        "on-surface": "#f8fafc",
        "on-surface-variant": "#d8b4fe",

        "inverse-surface": "#f8fafc",
        "inverse-on-surface": "#10091e",

        "outline": "#581c87",
        "outline-variant": "#6b21a8"
      }
    },
    "classic-navy": {
      id: "classic-navy",
      name: "الكحلي والسماوي الأصلي (Classic Navy & Sky Blue)",
      desc: "الثيم الأزرق الافتراضي الأصلي للنظام",
      badge: "الأصلي",
      previewHex: ["#0F172A", "#1E293B", "#38BDF8"],
      colors: {
        "navy-dark": "#0F172A",
        "navy-card": "#1E293B",
        "sky-accent": "#38BDF8",
        "sky-primary": "#0284C7",

        "surface-tint": "#0284C7",
        "primary": "#0284C7",
        "on-primary": "#ffffff",
        "primary-container": "#0369A1",
        "on-primary-container": "#f0f9ff",
        "primary-fixed": "#e0f2fe",
        "primary-fixed-dim": "#38BDF8",
        "on-primary-fixed": "#0c4a6e",
        "on-primary-fixed-variant": "#075985",
        "inverse-primary": "#38BDF8",

        "secondary": "#475569",
        "on-secondary": "#ffffff",
        "secondary-container": "#e2e8f0",
        "on-secondary-container": "#334155",
        "secondary-fixed": "#e2e8f0",
        "secondary-fixed-dim": "#cbd5e1",
        "on-secondary-fixed": "#0F172A",
        "on-secondary-fixed-variant": "#334155",

        "tertiary": "#059669",
        "on-tertiary": "#ffffff",
        "tertiary-container": "#10B981",
        "on-tertiary-container": "#ecfdf5",
        "tertiary-fixed": "#d1fae5",
        "tertiary-fixed-dim": "#34d399",
        "on-tertiary-fixed": "#064e3b",
        "on-tertiary-fixed-variant": "#065f46",

        "error": "#dc2626",
        "on-error": "#ffffff",
        "error-container": "#fee2e2",
        "on-error-container": "#991b1b",

        "warning": "#d97706",
        "warning-container": "#fef3c7",
        "on-warning-container": "#92400e",

        "background": "#f8fafc",
        "on-background": "#0F172A",
        "surface": "#f8fafc",
        "surface-bright": "#ffffff",
        "surface-dim": "#e2e8f0",
        "surface-variant": "#e2e8f0",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#f1f5f9",
        "surface-container": "#e2e8f0",
        "surface-container-high": "#e2e8f0",
        "surface-container-highest": "#cbd5e1",
        "on-surface": "#0F172A",
        "on-surface-variant": "#475569",

        "inverse-surface": "#0F172A",
        "inverse-on-surface": "#f1f5f9",

        "outline": "#64748b",
        "outline-variant": "#cbd5e1"
      }
    },
    "vanilla": {
      id: "vanilla",
      name: "الفانيلا والبيج الفاخر (Vanilla Cream & Gold)",
      desc: "مظهر فاتح ناعم ومريح بدرجات البيج والفانيلا الدافئة والكراميل",
      badge: "فاتح وناعم",
      previewHex: ["#fbf8f2", "#f2ece1", "#b45309"],
      colors: {
        "navy-dark": "#292524",
        "navy-card": "#3f3f46",
        "sky-accent": "#d97706",
        "sky-primary": "#b45309",

        "surface-tint": "#b45309",
        "primary": "#b45309",
        "on-primary": "#ffffff",
        "primary-container": "#92400e",
        "on-primary-container": "#fef3c7",
        "primary-fixed": "#fef3c7",
        "primary-fixed-dim": "#fde68a",
        "on-primary-fixed": "#78350f",
        "on-primary-fixed-variant": "#92400e",
        "inverse-primary": "#fde68a",

        "secondary": "#78716c",
        "on-secondary": "#ffffff",
        "secondary-container": "#f5f5f4",
        "on-secondary-container": "#44403c",
        "secondary-fixed": "#e7e5e4",
        "secondary-fixed-dim": "#d6d3d1",
        "on-secondary-fixed": "#292524",
        "on-secondary-fixed-variant": "#44403c",

        "tertiary": "#059669",
        "on-tertiary": "#ffffff",
        "tertiary-container": "#10B981",
        "on-tertiary-container": "#ecfdf5",
        "tertiary-fixed": "#d1fae5",
        "tertiary-fixed-dim": "#34d399",
        "on-tertiary-fixed": "#064e3b",
        "on-tertiary-fixed-variant": "#065f46",

        "error": "#dc2626",
        "on-error": "#ffffff",
        "error-container": "#fee2e2",
        "on-error-container": "#991b1b",

        "warning": "#d97706",
        "warning-container": "#fef3c7",
        "on-warning-container": "#92400e",

        "background": "#fbf8f2",
        "on-background": "#292524",
        "surface": "#fbf8f2",
        "surface-bright": "#ffffff",
        "surface-dim": "#f2ece1",
        "surface-variant": "#f2ece1",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#f7f3eb",
        "surface-container": "#f2ece1",
        "surface-container-high": "#e5ded3",
        "surface-container-highest": "#d6cec2",
        "on-surface": "#292524",
        "on-surface-variant": "#57534e",

        "inverse-surface": "#292524",
        "inverse-on-surface": "#fbf8f2",

        "outline": "#78716c",
        "outline-variant": "#e7e5e4"
      }
    }
  };

  // Determine active theme (Default: 'red-magic' - مطابق لهوية المحل)
  const savedThemeId = (function () {
    try {
      const stored = localStorage.getItem("pos_color_theme");
      if (stored && stored !== "dark-onyx" && THEMES[stored]) return stored;
    } catch (e) {}
    try {
      localStorage.setItem("pos_color_theme", "red-magic");
    } catch (e) {}
    return "red-magic";
  })();

  const activeTheme = THEMES[savedThemeId] || THEMES["red-magic"];

  // Synchronously set data-theme attribute on <html> to prevent layout flash
  try {
    if (document.documentElement) {
      document.documentElement.setAttribute("data-theme", activeTheme.id);
    }
  } catch (e) {}

  // Expose global helper APIs
  window.POS_THEMES = THEMES;
  window.getPosTheme = function () {
    return localStorage.getItem("pos_color_theme") || "red-magic";
  };
  window.setPosTheme = function (themeId) {
    if (!THEMES[themeId]) return false;
    try {
      localStorage.setItem("pos_color_theme", themeId);
      document.documentElement.setAttribute("data-theme", themeId);
      return true;
    } catch (e) {
      return false;
    }
  };

  // Configure Tailwind
  window.tailwind = window.tailwind || {};
  window.tailwind.config = {
    darkMode: "class",
    theme: {
      extend: {
        colors: {
          ...activeTheme.colors
        },
        borderRadius: {
          DEFAULT: "0.25rem",
          lg: "0.5rem",
          xl: "0.75rem",
          full: "9999px"
        },
        spacing: {
          "margin-mobile": "1rem",
          "space-lg": "1.25rem",
          "margin": "1.5rem",
          "space-xs": "0.25rem",
          "space-md": "0.75rem",
          "gutter": "1rem",
          "space-sm": "0.5rem",
          "space-xl": "2rem",
          "gutter-mobile": "0.75rem"
        },
        fontFamily: {
          sans: ["Cairo", "Readex Pro", "sans-serif"],
          "display-lg": ["Cairo", "Readex Pro", "sans-serif"],
          "headline-lg": ["Cairo", "Readex Pro", "sans-serif"],
          "headline-md": ["Cairo", "Readex Pro", "sans-serif"],
          "title-lg": ["Cairo", "Readex Pro", "sans-serif"],
          "title-md": ["Cairo", "Readex Pro", "sans-serif"],
          "body-lg": ["Cairo", "Readex Pro", "sans-serif"],
          "body-md": ["Cairo", "Readex Pro", "sans-serif"],
          "body-sm": ["Cairo", "Readex Pro", "sans-serif"],
          "label-lg": ["Cairo", "Readex Pro", "sans-serif"],
          "label-md": ["Cairo", "Readex Pro", "sans-serif"],
          "numeric-table": ["Readex Pro", "Cairo", "monospace"]
        },
        fontSize: {
          "display-lg": ["30px", { lineHeight: "38px", fontWeight: "700" }],
          "headline-lg": ["24px", { lineHeight: "32px", fontWeight: "700" }],
          "headline-md": ["20px", { lineHeight: "28px", fontWeight: "700" }],
          "title-lg": ["18px", { lineHeight: "26px", fontWeight: "700" }],
          "title-md": ["15px", { lineHeight: "22px", fontWeight: "600" }],
          "body-lg": ["15px", { lineHeight: "22px", fontWeight: "400" }],
          "body-md": ["13px", { lineHeight: "20px", fontWeight: "400" }],
          "body-sm": ["12px", { lineHeight: "18px", fontWeight: "400" }],
          "label-lg": ["13px", { lineHeight: "18px", fontWeight: "600" }],
          "label-md": ["11px", { lineHeight: "16px", fontWeight: "500" }],
          "numeric-table": ["13px", { lineHeight: "18px", fontWeight: "600" }]
        }
      }
    }
  };
})();
