# Product Design System — darkworld.website

This document defines interaction and visual rules for the Namma Bill POS web platform. `src/app/globals.css`, `src/theme.css`, and existing components are the implementation reference; update this specification when the product's design system intentionally changes.

## Visual direction

Use a calm, precise business-tool aesthetic: legible financial data, clear hierarchy, and low-friction workflows. Existing UI uses a light, subtly tinted canvas, restrained violet accents, translucent navigation, and compact information cards. Keep decorative effects subordinate to the task. Invoice print output is a separate document surface and must remain high contrast and paper-friendly.

### Principles

1. Make amounts, stock, tax, status, and next actions easy to scan.
2. Prefer familiar tables and forms over decorative dashboards.
3. Keep irreversible or financial actions explicit and reviewable.
4. Use consistent interaction patterns across modules.
5. Preserve accessibility when using color, icons, animation, or compact layouts.

## Color

Use existing CSS custom properties as the canonical source; do not duplicate raw values in each component. The product's violet brand is currently `#5543d1` in app metadata; confirm exact semantic variables in `src/theme.css` before extending.

| Token | Intent | Usage |
|---|---|---|
| `--accent` | Primary brand/action | Primary buttons, selected navigation, focus ring |
| `--accent-soft` | Quiet brand surface | Selected chips, banners, subtle highlights |
| `--ink` | Primary text | Body, headings, key values |
| `--muted` | Secondary text | Hints, labels, supporting metadata |
| `--page` | Page canvas | Main background beneath panels |
| `--line` | Borders/dividers | Inputs, cards, tables |
| Semantic success/warning/danger | Status only | Payment, stock, validation, and system states |

Do not communicate status by color alone; pair with text or icon labels. Keep invoice print black/neutral on white unless the selected invoice theme explicitly controls the document.

## Typography

- Use the current system sans-serif stack for application UI; avoid adding a remote font dependency without a performance and licensing decision.
- Use a clear type scale: page title, section title, body, compact metadata, and small table labels.
- Numeric columns should use tabular figures when available; align currency values consistently.
- Use sentence case for actions, navigation, and alerts. Avoid all-caps except compact table headers where already established.
- Keep long business/customer names readable and wrap safely.

## Spacing and layout

- Use a consistent 4px base spacing rhythm; common steps are 4, 8, 12, 16, 24, 32, and 40px.
- Use a centered, fluid content area with readable maximum width; allow tables and billing line items to use available width.
- Desktop uses a persistent side navigation and a compact top bar. Mobile uses the existing compact/mobile navigation and a single-column content flow.
- Group related inputs and actions; separate destructive actions visually and position them away from primary save/issue controls.
- Cards are for grouped context, not every piece of content. Avoid nested card-within-card layouts.
- Use existing border radius and shadow tokens consistently; reserve stronger elevation for overlays and dialogs.

## Reusable components

Use or extend existing shared components before creating a module-specific variant:

- App shell, desktop sidebar, top bar, mobile navigation, tenant/theme controls.
- Page header with title, concise description, and one primary action.
- Buttons: primary, secondary, quiet, destructive; consistent size and disabled/loading states.
- Text/select/date/number inputs with labels, help text, and field-level errors.
- Search input with clear affordance and keyboard access.
- Tables with sortable/accessible headers where sorting exists, aligned numeric cells, and mobile overflow strategy.
- Status badge with text and semantic color.
- Summary metric with label, value, and optional trend/description.
- Toast for transient completion/failure; persistent inline alert for errors that require action.
- Modal/dialog for confirmation or short tasks only; use a full page for complex forms.
- Invoice preview/document template separated from app navigation and screen styling.

## Navigation

- Preserve one canonical route/view state so navigation, browser back/forward, and refresh stay consistent.
- Group navigation by task frequency; do not expose admin-only actions to staff.
- Make the current location explicit and keep a consistent page title.
- Mobile navigation must remain reachable without obscuring primary content or keyboard focus.
- Global search should expose result type and enough context to choose the right record; avoid revealing records outside the user's tenant or customer scope.

## Forms

- Use persistent labels; placeholder text is not a label.
- Mark required fields and units/currency/quantity format.
- Validate on submit and, for simple fields, on blur after first submission; avoid noisy validation on every keystroke.
- Preserve safe values after validation or network failure.
- For financial confirmation, display line-level values, tax, discount, total, amount paid, and remaining balance before commit.
- Disable duplicate submissions while pending and announce completion/failure.
- Destructive actions require a confirmation that names the affected object and consequence.

## Loading, empty, and error states

- **Loading:** keep layout stable with a local spinner/skeleton and explicit action context; do not show a global blocking overlay for background refresh.
- **Empty:** explain why the list is empty and offer a permission-appropriate next step.
- **No results:** distinguish search/filter no-match from a truly empty dataset and offer clear/reset.
- **Error:** inline alerts for recoverable load failures, field messages for validation, and concise toast feedback for completed actions. Never display raw stack/provider/database messages.
- **Permission denied:** provide a clear explanation without exposing hidden data or admin-only paths.
- **Network loss:** do not represent an unconfirmed mutation as saved. For financial writes, allow the user to reconcile uncertain outcomes before resubmitting.

## Interactions and motion

- Use short, purposeful transitions for menu/dialog open and state changes; honor `prefers-reduced-motion`.
- Avoid animation that delays checkout, table scanning, or keyboard navigation.
- Provide hover, focus-visible, pressed, disabled, and loading states.
- Keep confirmation dialogs interruptive only for high-impact actions.
- Use optimistic updates only for reversible, low-risk UI state. Financial state should reflect server confirmation.

## Responsive behavior

- Support narrow phones, larger phones, tablets, and desktop; verify at approximately 320px, 375px, 768px, and 1280px widths.
- Checkout controls remain usable with touch input; totals and confirmation action remain visible without covering editable line items.
- Tables may scroll horizontally or transform into labeled rows; never clip critical amounts/statuses.
- Forms stack on small viewports and keep logical DOM/tab order.
- Dialogs fit within viewport height and scroll internally when necessary.
- Invoice documents use dedicated print styles for A4 and configured thermal widths; avoid printing application chrome.

## Accessibility

- Target WCAG 2.2 AA contrast and keyboard interaction.
- Use semantic headings, landmarks, labels, table headers, and buttons/links with correct roles.
- Maintain visible focus; do not remove outlines without a clear replacement.
- Announce async status and validation errors using appropriate live regions.
- Ensure dialogs trap focus, close predictably, and restore focus to the trigger.
- Provide text alternatives for icons and informative images; hide decorative icons from assistive technology.
- Respect reduced motion, browser zoom, and text resizing.

## Page-level layout guidance

| Page | Layout emphasis |
|---|---|
| Sign-in | Single centered form, workspace slug clearly explained, generic credential failure |
| Dashboard | Small set of useful metrics and direct links; no chart without an actionable purpose |
| Billing | Customer and item selection first; totals and final confirmation remain prominent |
| Invoices | Search/filter above compact list; detail and print view preserve invoice snapshot |
| Inventory | Fast product search, stock/status scan, admin-only mutation affordances |
| Customers | Search and identity details; sensitive fields shown only to authorized users |
| Accounting | Clear received, due, and billed totals; distinguish payment history from invoice totals |
| Admin/settings | Group related settings, explain impact, audit important changes |
| Customer portal | Minimal navigation; only the signed-in customer's documents and decisions |
| Agent/assistant | State exactly what is sent to the configured provider and require explicit confirmation for bill drafts |

## Approval notes

The precise brand palette, supported viewport/browser matrix, and official font are product decisions. Until approved, retain the current CSS tokens and system font rather than inventing a redesign.
