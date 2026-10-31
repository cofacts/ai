// ⚙️ Generated from design/tokens.json by scripts/build-tokens.ts — do not edit. Run `pnpm tokens`.

/**
 * Custom class names for tailwind-merge, so cn() merges Cofacts utilities correctly.
 * Colors are listed per prefix: `bg-base` is a color, `text-base` is not.
 */
export const twMergeColors = {
  "text": [
    "text-primary",
    "text-secondary",
    "text-tertiary",
    "text-disabled",
    "text-inverse",
    "text-link",
    "text-on-accent",
    "text-on-secondary",
    "text-on-status",
    "text-on-dark",
    "text-on-dark-muted",
    "text-on-info",
    "text-on-line",
    "icon-default",
    "icon-muted",
    "icon-inverse",
    "icon-brand",
    "icon-on-accent",
    "icon-on-secondary",
    "icon-on-dark",
    "icon-on-line",
    "status-incorrect",
    "status-correct",
    "status-opinion",
    "status-outofscope"
  ],
  "bg": [
    "surface-base",
    "surface-raised",
    "surface-selected",
    "surface-inverse",
    "surface-secondary",
    "surface-accent",
    "surface-accent-subtle",
    "surface-accent-fold",
    "surface-dark",
    "surface-dark-raised",
    "surface-on-dark",
    "surface-info",
    "surface-info-strong",
    "surface-line",
    "status-incorrect",
    "status-correct",
    "status-opinion",
    "status-outofscope",
    "overlay-scrim"
  ],
  "border": [
    "border-subtle",
    "border-control",
    "border-strong",
    "border-accent",
    "border-inverse",
    "border-on-dark",
    "border-on-dark-strong"
  ]
}

export const twMergeTheme = {
  "text": [
    "ui-l",
    "ui-l-bold",
    "ui-m",
    "ui-m-bold",
    "ui-s",
    "ui-s-bold",
    "ui-xs",
    "ui-xs-bold",
    "body-l",
    "body-m",
    "body-s",
    "caption",
    "heading-xl",
    "heading-l",
    "heading-m",
    "heading-s",
    "heading-xs"
  ],
  "radius": [
    "2",
    "5",
    "10",
    "full"
  ],
  "shadow": [
    "btn"
  ]
}

/** Token lists for the Storybook foundations page. */
export const designTokens = {
  "semanticColors": [
    {
      "name": "text-primary",
      "classes": [
        "text-text-primary"
      ],
      "light": "#111827",
      "dark": "#f3f4f6",
      "fixed": false
    },
    {
      "name": "text-secondary",
      "classes": [
        "text-text-secondary"
      ],
      "light": "#374151",
      "dark": "#d1d5db",
      "fixed": false
    },
    {
      "name": "text-tertiary",
      "classes": [
        "text-text-tertiary"
      ],
      "light": "#6b7280",
      "dark": "#9ca3af",
      "fixed": false
    },
    {
      "name": "text-disabled",
      "classes": [
        "text-text-disabled"
      ],
      "light": "#9ca3af",
      "dark": "#4b5563",
      "fixed": false
    },
    {
      "name": "text-inverse",
      "classes": [
        "text-text-inverse"
      ],
      "light": "#ffffff",
      "dark": "#111827",
      "fixed": false
    },
    {
      "name": "text-link",
      "classes": [
        "text-text-link"
      ],
      "light": "#1673d1",
      "dark": "#42a0ff",
      "fixed": false
    },
    {
      "name": "text-on-accent",
      "classes": [
        "text-text-on-accent"
      ],
      "light": "#111827",
      "dark": "#111827",
      "fixed": true
    },
    {
      "name": "text-on-secondary",
      "classes": [
        "text-text-on-secondary"
      ],
      "light": "#ffffff",
      "dark": "#f3f4f6",
      "fixed": false
    },
    {
      "name": "text-on-status",
      "classes": [
        "text-text-on-status"
      ],
      "light": "#ffffff",
      "dark": "#111827",
      "fixed": false
    },
    {
      "name": "text-on-dark",
      "classes": [
        "text-text-on-dark"
      ],
      "light": "#f3f4f6",
      "dark": "#f3f4f6",
      "fixed": true
    },
    {
      "name": "text-on-dark-muted",
      "classes": [
        "text-text-on-dark-muted"
      ],
      "light": "#9ca3af",
      "dark": "#9ca3af",
      "fixed": true
    },
    {
      "name": "text-on-info",
      "classes": [
        "text-text-on-info"
      ],
      "light": "#111827",
      "dark": "#111827",
      "fixed": true
    },
    {
      "name": "text-on-line",
      "classes": [
        "text-text-on-line"
      ],
      "light": "#ffffff",
      "dark": "#ffffff",
      "fixed": true
    },
    {
      "name": "surface-base",
      "classes": [
        "bg-surface-base"
      ],
      "light": "#ffffff",
      "dark": "#111827",
      "fixed": false
    },
    {
      "name": "surface-raised",
      "classes": [
        "bg-surface-raised"
      ],
      "light": "#f3f4f6",
      "dark": "#1f2937",
      "fixed": false
    },
    {
      "name": "surface-selected",
      "classes": [
        "bg-surface-selected"
      ],
      "light": "#e5e7eb",
      "dark": "#374151",
      "fixed": false
    },
    {
      "name": "surface-inverse",
      "classes": [
        "bg-surface-inverse"
      ],
      "light": "#1f2937",
      "dark": "#f3f4f6",
      "fixed": false
    },
    {
      "name": "surface-secondary",
      "classes": [
        "bg-surface-secondary"
      ],
      "light": "#1f2937",
      "dark": "#374151",
      "fixed": false
    },
    {
      "name": "surface-accent",
      "classes": [
        "bg-surface-accent"
      ],
      "light": "#ffb600",
      "dark": "#ffb600",
      "fixed": true
    },
    {
      "name": "surface-accent-subtle",
      "classes": [
        "bg-surface-accent-subtle"
      ],
      "light": "#ffeaba",
      "dark": "#e9a802",
      "fixed": false
    },
    {
      "name": "surface-accent-fold",
      "classes": [
        "bg-surface-accent-fold"
      ],
      "light": "#ff9200",
      "dark": "#ff9200",
      "fixed": true
    },
    {
      "name": "surface-dark",
      "classes": [
        "bg-surface-dark"
      ],
      "light": "#111827",
      "dark": "#111827",
      "fixed": true
    },
    {
      "name": "surface-dark-raised",
      "classes": [
        "bg-surface-dark-raised"
      ],
      "light": "#1f2937",
      "dark": "#1f2937",
      "fixed": true
    },
    {
      "name": "surface-on-dark",
      "classes": [
        "bg-surface-on-dark"
      ],
      "light": "#ffffff",
      "dark": "#ffffff",
      "fixed": true
    },
    {
      "name": "surface-info",
      "classes": [
        "bg-surface-info"
      ],
      "light": "#1789fc",
      "dark": "#1789fc",
      "fixed": true
    },
    {
      "name": "surface-info-strong",
      "classes": [
        "bg-surface-info-strong"
      ],
      "light": "#1673d1",
      "dark": "#1673d1",
      "fixed": true
    },
    {
      "name": "surface-line",
      "classes": [
        "bg-surface-line"
      ],
      "light": "#06c755",
      "dark": "#06c755",
      "fixed": true
    },
    {
      "name": "border-subtle",
      "classes": [
        "border-border-subtle"
      ],
      "light": "#d1d5db",
      "dark": "#374151",
      "fixed": false
    },
    {
      "name": "border-control",
      "classes": [
        "border-border-control"
      ],
      "light": "#6b7280",
      "dark": "#9ca3af",
      "fixed": false
    },
    {
      "name": "border-strong",
      "classes": [
        "border-border-strong"
      ],
      "light": "#111827",
      "dark": "#f3f4f6",
      "fixed": false
    },
    {
      "name": "border-accent",
      "classes": [
        "border-border-accent"
      ],
      "light": "#ffb600",
      "dark": "#ffb600",
      "fixed": true
    },
    {
      "name": "border-inverse",
      "classes": [
        "border-border-inverse"
      ],
      "light": "#ffffff",
      "dark": "#111827",
      "fixed": false
    },
    {
      "name": "border-focus",
      "classes": [],
      "light": "#111827",
      "dark": "#f3f4f6",
      "fixed": false
    },
    {
      "name": "border-focus-outer",
      "classes": [],
      "light": "#ffb600",
      "dark": "#ffb600",
      "fixed": true
    },
    {
      "name": "border-on-dark",
      "classes": [
        "border-border-on-dark"
      ],
      "light": "#374151",
      "dark": "#374151",
      "fixed": true
    },
    {
      "name": "border-on-dark-strong",
      "classes": [
        "border-border-on-dark-strong"
      ],
      "light": "#f3f4f6",
      "dark": "#f3f4f6",
      "fixed": true
    },
    {
      "name": "icon-default",
      "classes": [
        "text-icon-default"
      ],
      "light": "#111827",
      "dark": "#f3f4f6",
      "fixed": false
    },
    {
      "name": "icon-muted",
      "classes": [
        "text-icon-muted"
      ],
      "light": "#6b7280",
      "dark": "#9ca3af",
      "fixed": false
    },
    {
      "name": "icon-inverse",
      "classes": [
        "text-icon-inverse"
      ],
      "light": "#ffffff",
      "dark": "#111827",
      "fixed": false
    },
    {
      "name": "icon-brand",
      "classes": [
        "text-icon-brand"
      ],
      "light": "#ffb600",
      "dark": "#ffb600",
      "fixed": true
    },
    {
      "name": "icon-on-accent",
      "classes": [
        "text-icon-on-accent"
      ],
      "light": "#111827",
      "dark": "#111827",
      "fixed": true
    },
    {
      "name": "icon-on-secondary",
      "classes": [
        "text-icon-on-secondary"
      ],
      "light": "#ffffff",
      "dark": "#f3f4f6",
      "fixed": false
    },
    {
      "name": "icon-on-dark",
      "classes": [
        "text-icon-on-dark"
      ],
      "light": "#f3f4f6",
      "dark": "#f3f4f6",
      "fixed": true
    },
    {
      "name": "icon-on-line",
      "classes": [
        "text-icon-on-line"
      ],
      "light": "#ffffff",
      "dark": "#ffffff",
      "fixed": true
    },
    {
      "name": "status-incorrect",
      "classes": [
        "text-status-incorrect",
        "bg-status-incorrect"
      ],
      "light": "#df3324",
      "dark": "#ff8a81",
      "fixed": false
    },
    {
      "name": "status-correct",
      "classes": [
        "text-status-correct",
        "bg-status-correct"
      ],
      "light": "#06865b",
      "dark": "#39dea6",
      "fixed": false
    },
    {
      "name": "status-opinion",
      "classes": [
        "text-status-opinion",
        "bg-status-opinion"
      ],
      "light": "#1673d1",
      "dark": "#42a0ff",
      "fixed": false
    },
    {
      "name": "status-outofscope",
      "classes": [
        "text-status-outofscope",
        "bg-status-outofscope"
      ],
      "light": "#7c45d6",
      "dark": "#aa80ee",
      "fixed": false
    },
    {
      "name": "chart-series-1",
      "classes": [],
      "light": "#ffb600",
      "dark": "#ffb600",
      "fixed": true
    },
    {
      "name": "chart-series-2",
      "classes": [],
      "light": "#1789fc",
      "dark": "#1789fc",
      "fixed": true
    },
    {
      "name": "overlay-scrim",
      "classes": [
        "bg-overlay-scrim"
      ],
      "light": "#11182780",
      "dark": "#11182780",
      "fixed": true
    }
  ],
  "typography": [
    {
      "name": "type-ui-l",
      "className": "text-ui-l",
      "size": 18,
      "weight": 400,
      "lineHeight": "1"
    },
    {
      "name": "type-ui-l-bold",
      "className": "text-ui-l-bold",
      "size": 18,
      "weight": 700,
      "lineHeight": "1"
    },
    {
      "name": "type-ui-m",
      "className": "text-ui-m",
      "size": 16,
      "weight": 400,
      "lineHeight": "1"
    },
    {
      "name": "type-ui-m-bold",
      "className": "text-ui-m-bold",
      "size": 16,
      "weight": 700,
      "lineHeight": "1"
    },
    {
      "name": "type-ui-s",
      "className": "text-ui-s",
      "size": 14,
      "weight": 400,
      "lineHeight": "1"
    },
    {
      "name": "type-ui-s-bold",
      "className": "text-ui-s-bold",
      "size": 14,
      "weight": 700,
      "lineHeight": "1"
    },
    {
      "name": "type-ui-xs",
      "className": "text-ui-xs",
      "size": 12,
      "weight": 400,
      "lineHeight": "1"
    },
    {
      "name": "type-ui-xs-bold",
      "className": "text-ui-xs-bold",
      "size": 12,
      "weight": 700,
      "lineHeight": "1"
    },
    {
      "name": "type-body-l",
      "className": "text-body-l",
      "size": 18,
      "weight": 400,
      "lineHeight": "32px"
    },
    {
      "name": "type-body-m",
      "className": "text-body-m",
      "size": 16,
      "weight": 400,
      "lineHeight": "28px"
    },
    {
      "name": "type-body-s",
      "className": "text-body-s",
      "size": 14,
      "weight": 400,
      "lineHeight": "24px"
    },
    {
      "name": "type-caption",
      "className": "text-caption",
      "size": 12,
      "weight": 400,
      "lineHeight": "20px"
    },
    {
      "name": "type-heading-xl",
      "className": "text-heading-xl",
      "size": 36,
      "weight": 700,
      "lineHeight": "44px"
    },
    {
      "name": "type-heading-l",
      "className": "text-heading-l",
      "size": 28,
      "weight": 700,
      "lineHeight": "36px"
    },
    {
      "name": "type-heading-m",
      "className": "text-heading-m",
      "size": 24,
      "weight": 700,
      "lineHeight": "32px"
    },
    {
      "name": "type-heading-s",
      "className": "text-heading-s",
      "size": 18,
      "weight": 700,
      "lineHeight": "24px"
    },
    {
      "name": "type-heading-xs",
      "className": "text-heading-xs",
      "size": 16,
      "weight": 700,
      "lineHeight": "24px"
    }
  ],
  "spacing": [
    {
      "name": "spacing-2",
      "value": 2
    },
    {
      "name": "spacing-4",
      "value": 4
    },
    {
      "name": "spacing-8",
      "value": 8
    },
    {
      "name": "spacing-12",
      "value": 12
    },
    {
      "name": "spacing-16",
      "value": 16
    },
    {
      "name": "spacing-20",
      "value": 20
    },
    {
      "name": "spacing-24",
      "value": 24
    },
    {
      "name": "spacing-32",
      "value": 32
    },
    {
      "name": "spacing-48",
      "value": 48
    },
    {
      "name": "spacing-64",
      "value": 64
    },
    {
      "name": "spacing-120",
      "value": 120
    }
  ],
  "radius": [
    {
      "name": "RADIUS-2",
      "key": "2",
      "value": 2,
      "className": "rounded-2"
    },
    {
      "name": "RADIUS-5",
      "key": "5",
      "value": 5,
      "className": "rounded-5"
    },
    {
      "name": "RADIUS-10",
      "key": "10",
      "value": 10,
      "className": "rounded-10"
    },
    {
      "name": "RADIUS-100",
      "key": "full",
      "value": 100,
      "className": "rounded-full"
    }
  ],
  "shadows": [
    {
      "name": "btn-shadow",
      "key": "btn",
      "css": "2px 2px 6px 0px rgba(0, 0, 0, 0.07)",
      "className": "shadow-btn"
    }
  ]
} as const
