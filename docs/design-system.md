# Design System

This document describes the design language and token system used across the Bilibili Subtitle Vocabulary extension UI.

The design language is called **Apple Utility**: neutral, task-first, system-native, and low-noise. It is optimized for a learning tool that must stay readable inside a browser extension popup, a dense settings page, and a video overlay.

All product tokens live under the `bsv-*` namespace and are defined in `bilibili-vocab-extension/react-ui/src/styles/tokens.css`. Component classes are defined in `bilibili-vocab-extension/react-ui/src/styles/ui.css`.

## Tokens

### Colors

#### Background / Surface

| Token | Description |
|-------|-------------|
| `--bsv-bg` | Core canvas, using the Apple-like neutral `#f5f5f7` in light mode. |
| `--bsv-surface` | Primary raised surface color. |
| `--bsv-surface-elevated` | Elevated surface, slightly warmer/lighter. |
| `--bsv-surface-sunken` | Depressed or grouped surface. |
| `--bsv-surface-overlay` | Semi-transparent overlay background. |
| `--bsv-surface-hover` | Hover state for interactive surfaces. |
| `--bsv-surface-active` | Active/pressed surface state. |
| `--bsv-surface-selected` | Selected or highlighted surface state. |
| `--bsv-surface-disabled` | Disabled surface background. |

#### Foreground

| Token | Description |
|-------|-------------|
| `--bsv-fg` | Primary text and icons. |
| `--bsv-muted` | Secondary/muted text. |
| `--bsv-subtle` | Tertiary or helper text. |
| `--bsv-fg-on-accent` | Text color used on top of accent backgrounds. |
| `--bsv-fg-disabled` | Disabled text color. |

#### Accent

| Token | Description |
|-------|-------------|
| `--bsv-accent` | Primary system blue accent (`#0071e3`). |
| `--bsv-accent-soft` | Lighter accent for hover/gradients. |
| `--bsv-accent-hover` | Accent hover state. |
| `--bsv-accent-active` | Accent active/pressed state. |
| `--bsv-accent-subtle` | Subtle accent tint for backgrounds. |
| `--bsv-accent-foreground` | Foreground color on accent elements. |

#### Semantic

| Token | Description |
|-------|-------------|
| `--bsv-success` | Positive state. |
| `--bsv-success-soft` | Subtle success background tint. |
| `--bsv-warning` | Caution state. |
| `--bsv-warning-soft` | Subtle warning background tint. |
| `--bsv-error` | Error / destructive state. |
| `--bsv-error-soft` | Subtle error background tint. |
| `--bsv-info` | Informational state. |
| `--bsv-info-soft` | Subtle info background tint. |

#### Focus

| Token | Description |
|-------|-------------|
| `--bsv-focus` | Focus indicator color. |
| `--bsv-focus-ring` | Focus ring color. |
| `--bsv-focus-ring-offset` | Offset/shield color for focus rings. |

#### Borders

| Token | Description |
|-------|-------------|
| `--bsv-border` | Default border color. |
| `--bsv-border-soft` | Subtle/divider border color. |
| `--bsv-border-strong` | Emphasized border color. |

#### Glow & Selection

| Token | Description |
|-------|-------------|
| `--bsv-glow-accent` | Accent glow shadow. |
| `--bsv-glow-success` | Success glow shadow. |
| `--bsv-glow-warning` | Warning glow shadow. |
| `--bsv-glow-error` | Error glow shadow. |
| `--bsv-selection-bg` | Text selection background. |
| `--bsv-selection-fg` | Text selection foreground. |

### Spacing

All spacing values are based on a 4px grid.

| Token | Value |
|-------|-------|
| `--bsv-space-1` | 4px |
| `--bsv-space-2` | 8px |
| `--bsv-space-3` | 12px |
| `--bsv-space-4` | 16px |
| `--bsv-space-5` | 20px |
| `--bsv-space-6` | 24px |
| `--bsv-space-8` | 32px |
| `--bsv-space-10` | 40px |
| `--bsv-space-12` | 48px |

### Radius

| Token | Value |
|-------|-------|
| `--bsv-radius-xs` | 3px |
| `--bsv-radius-sm` | 5px |
| `--bsv-radius-md` | 8px |
| `--bsv-radius-lg` | 12px |
| `--bsv-radius-xl` | 16px |
| `--bsv-radius-2xl` | 20px |
| `--bsv-radius-full` | 9999px |

### Shadows

| Token | Description |
|-------|-------------|
| `--bsv-shadow-xs` | Subtle 1px elevation. |
| `--bsv-shadow-sm` | Small card/button elevation. |
| `--bsv-shadow-md` | Card hover / dropdown elevation. |
| `--bsv-shadow-lg` | Modal / panel elevation. |
| `--bsv-shadow-xl` | Large overlay / toast elevation. |

### Typography

#### Font Families

| Token | Stack |
|-------|-------|
| `--bsv-font-display` | `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif` |
| `--bsv-font-body` | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif` |
| `--bsv-font-mono` | `"JetBrains Mono", ui-monospace, "Cascadia Code", "Source Code Pro", monospace` |

#### Font Sizes

| Token | Value |
|-------|-------|
| `--bsv-font-size-2xs` | 11px |
| `--bsv-font-size-xs` | 12px |
| `--bsv-font-size-sm` | 13px |
| `--bsv-font-size-base` | 14px |
| `--bsv-font-size-md` | 15px |
| `--bsv-font-size-lg` | 18px |
| `--bsv-font-size-xl` | 20px |
| `--bsv-font-size-2xl` | 24px |
| `--bsv-font-size-3xl` | 30px |

#### Font Weights

| Token | Value |
|-------|-------|
| `--bsv-font-weight-normal` | 400 |
| `--bsv-font-weight-medium` | 500 |
| `--bsv-font-weight-semibold` | 600 |
| `--bsv-font-weight-bold` | 700 |

#### Line Heights

| Token | Value |
|-------|-------|
| `--bsv-line-height-tight` | 1.2 |
| `--bsv-line-height-normal` | 1.5 |
| `--bsv-line-height-relaxed` | 1.65 |

#### Letter Spacing

| Token | Value |
|-------|-------|
| `--bsv-letter-spacing-tight` | 0 |
| `--bsv-letter-spacing-normal` | 0 |
| `--bsv-letter-spacing-wide` | 0.02em |
| `--bsv-letter-spacing-wider` | 0.06em |

### Motion

#### Durations

| Token | Value |
|-------|-------|
| `--bsv-duration-instant` | 80ms |
| `--bsv-duration-fast` | 140ms |
| `--bsv-duration-normal` | 200ms |
| `--bsv-duration-slow` | 300ms |

#### Easings

| Token | Curve |
|-------|-------|
| `--bsv-easing-standard` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--bsv-easing-out` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `--bsv-easing-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| `--bsv-easing-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` |

### Z-Index

| Token | Value |
|-------|-------|
| `--bsv-z-base` | 0 |
| `--bsv-z-dropdown` | 100 |
| `--bsv-z-sticky` | 200 |
| `--bsv-z-overlay` | 1000 |
| `--bsv-z-modal` | 1100 |
| `--bsv-z-toast` | 1200 |

## Component Classes

### Layout

| Class | Usage |
|-------|-------|
| `.panel` | Default content container with border, surface background, and subtle shadow. Add `data-interactive` for hover lift. |
| `.stack` | Vertical grid layout with consistent internal spacing. |
| `.stagger-enter` | Entrance animation that fades and rises; delay is derived from sibling order (`:nth-child`). |
| `.inline` | Horizontal flex layout with `space-between` alignment. Use `.wrap` to allow wrapping. |
| `.grid-two` | Two-column grid. Collapses to a single column on narrow viewports. |
| `.popup-shell` | Constrained wrapper for the extension popup. Default width targets a task-first popup around 650px. |
| `.popup-appbar` | Compact popup top bar with brand, current profile, sync state, and an icon settings action. |
| `.popup-primary-flow` | Popup first-screen task flow: site control, quick review, subtitle navigation, then metrics. |
| `.popup-more` | Collapsible advanced popup area for secondary display and tuning controls. |
| `.settings-shell` | Two-column settings page wrapper (sidebar + main). |
| `.settings-sidebar` | Sticky sidebar panel for settings navigation. |
| `.settings-main` | Main content area of the settings page. |
| `.settings-toolbar` | Compact settings header with current profile, sync status, and primary actions. |
| `.settings-list` | System-settings style grouped list surface for dense configuration content. |
| `.bsv-overlay-tabs` | Overlay segmented tab control for learning, controls, and display panels. |

### Typography / Entry Surfaces

| Class | Usage |
|-------|-------|
| `.studio-hero` | Legacy hero surface. Avoid for Popup and Options task flows. |
| `.studio-title` | Legacy large title. Prefer compact section headings in task surfaces. |
| `.studio-subtitle` | Muted descriptive text below a title. Keep concise in dense settings panels. |

### Controls

| Class | Usage |
|-------|-------|
| `.btn` | Base button. Use with `.primary`, `.secondary`, `.ghost`, or `.danger` for variants. |
| `.btn.primary` | Filled accent button for primary actions. |
| `.btn.secondary` | Outlined accent button. |
| `.btn.ghost` | Transparent button; combine with `.danger` or `.warn` for tonal emphasis. |
| `.btn.danger` | Outlined error button (also `.ghost.danger`). |
| `.field` | Form field wrapper that styles `input`, `select`, `textarea`, and range inputs. |
| `.switch-row` | Labeled toggle row containing a styled checkbox. |
| `.badge` | Inline pill label. Modifiers: `.good`, `.warn`, `.error`. |
| `.status-pill` | Rounded status indicator. Modifiers: `.good`, `.warn`. |

### Feedback

| Class | Usage |
|-------|-------|
| `.skeleton` | Loading placeholder with a shimmer animation. |
| `.save-bar` | Bar showing unsaved-change status with an optional undo progress indicator. |
| `.status-text` | Small status line. Modifiers: `--success`, `--error`, `--warning`, `--info`. |

## Dark Mode

Dark mode tokens are redefined in `tokens.css`.

- **Popup / Options pages**: activate dark mode by setting `data-bsv-theme="dark"` on `body.v3-page` (selector: `body.v3-page[data-bsv-theme="dark"]`).
- **Overlay**: activate dark mode by setting `data-theme="dark"` on `.bsv-overlay-root`.

The dark theme uses neutral dark surfaces with the same system blue accent and adjusted semantic colors for adequate contrast.

## Accessibility Minimum

The UI layer applies the following baseline accessibility rules:

- **Visible focus**: `:focus-visible` removes the default outline and renders a high-contrast ring using `--bsv-focus-ring` and `--bsv-focus-ring-offset`.
- **Icon-only buttons**: must include an `aria-label` describing the action.
- **Custom toggles**: the `.switch-row` checkbox should be associated with a visible label; where a custom toggle is used, apply `role="switch"` and `aria-checked`.
- **Status regions**: use `aria-live` for dynamic status text so assistive technologies announce updates.
