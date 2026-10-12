/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "var(--bg-app)",
        canvas: {
          DEFAULT: "var(--bg-canvas)",
          dots: "var(--canvas-grid-dot)",
        },
        surface: {
          DEFAULT: "var(--bg-surface-primary)",
          primary: "var(--bg-surface-primary)",
          secondary: "var(--bg-surface-secondary)",
          tertiary: "var(--bg-surface-tertiary)",
          hover: "var(--bg-surface-hover)",
          active: "var(--bg-surface-active)",
        },
        border: {
          DEFAULT: "var(--border-subtle)",
          subtle: "var(--border-subtle)",
          medium: "var(--border-medium)",
          strong: "var(--border-strong)",
          focus: "var(--border-focus)",
        },
        text: {
          DEFAULT: "var(--text-primary)",
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          inverse: "var(--text-inverse)",
        },
        accent: {
          DEFAULT: "var(--accent-primary)",
          primary: "var(--accent-primary)",
          hover: "var(--accent-hover)",
          subtle: "var(--accent-subtle)",
          border: "var(--accent-border)",
        },
        state: {
          running: {
            text: "var(--state-running-text)",
            bg: "var(--state-running-bg)",
            border: "var(--state-running-border)",
          },
          success: {
            text: "var(--state-success-text)",
            bg: "var(--state-success-bg)",
            border: "var(--state-success-border)",
          },
          failure: {
            text: "var(--state-failure-text)",
            bg: "var(--state-failure-bg)",
            border: "var(--state-failure-border)",
          },
          paused: {
            text: "var(--state-paused-text)",
            bg: "var(--state-paused-bg)",
            border: "var(--state-paused-border)",
          },
          idle: {
            text: "var(--state-idle-text)",
            bg: "var(--state-idle-bg)",
            border: "var(--state-idle-border)",
          },
          bp: {
            text: "var(--state-bp-text)",
            bg: "var(--state-bp-bg)",
            border: "var(--state-bp-border)",
          },
          fault: {
            text: "var(--state-fault-text)",
            bg: "var(--state-fault-bg)",
            border: "var(--state-fault-border)",
          },
        },
        cat: {
          action: {
            text: "var(--cat-action-text)",
            bg: "var(--cat-action-bg)",
            border: "var(--cat-action-border)",
          },
          condition: {
            text: "var(--cat-condition-text)",
            bg: "var(--cat-condition-bg)",
            border: "var(--cat-condition-border)",
          },
          control: {
            text: "var(--cat-control-text)",
            bg: "var(--cat-control-bg)",
            border: "var(--cat-control-border)",
          },
          decorator: {
            text: "var(--cat-decorator-text)",
            bg: "var(--cat-decorator-bg)",
            border: "var(--cat-decorator-border)",
          },
          subtree: {
            text: "var(--cat-subtree-text)",
            bg: "var(--cat-subtree-bg)",
            border: "var(--cat-subtree-border)",
          },
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Fira Code"', "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
