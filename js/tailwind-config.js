window.tailwind = window.tailwind || {};
window.tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Prompt Navy & Sky Blue + Stitch semantic tokens
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
