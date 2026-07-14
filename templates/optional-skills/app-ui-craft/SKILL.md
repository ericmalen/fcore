---
name: app-ui-craft
description: Product-UI craft for application interfaces — forms, data tables, dashboards, admin panels, internal tools, and CRUD screens. Covers layout discipline, form UX, table design, loading/empty/error states, feedback, keyboard access, and responsive app shells. Use whenever building or restyling any web app screen users work in (not just marketing pages) — including when the user says "build a page/app/dashboard/tool", "add a form/table", or "make this look better", even if they never say the word "design".
---

# App UI Craft

Application UIs fail differently than marketing pages. Nobody abandons an internal tool because the hero image is bland — they abandon it because the form loses their input, the table is unreadable, and errors say "Something went wrong." This skill is the craft floor for screens people *work* in: get the structure, states, and feedback right, and even a visually plain app feels professional. Pair with a visual-design skill (e.g. `frontend-design`) for aesthetics; this skill makes the result *usable*.

The patterns below are shown as HTML/CSS but map directly to any framework (React, Vue, Svelte, server-rendered).

## Layout discipline

Inconsistent spacing is the single biggest "AI-generated" tell in app UIs. Pick a spacing scale (multiples of 4px or 8px) and use only those values — for padding, gaps, margins, everything. When two nearby elements use 13px and 18px gaps, users can't articulate the problem but they feel it.

- Constrain line lengths and content: forms ~480–640px max-width, reading content ~65ch. Full-bleed forms on a 1440px screen read as broken.
- Align to a grid. Left edges of labels, inputs, and buttons should share vertical lines. Misalignment reads as sloppiness faster than any color choice.
- Group with whitespace, not boxes. Related fields sit closer together than unrelated groups; you rarely need a border or card around every section.
- Type scale: apps need fewer sizes than you think — one page title, one section heading, body, and one small/muted size. Use muted color (not tiny size) for secondary text, and keep body text ≥ 14px.

## Forms

Forms are where users do the actual work, so friction here is friction with the whole product.

- Label every input, above the field, connected via `for`/`id`. Placeholder text is not a label — it vanishes on focus and screen readers can't rely on it.
- Mark required fields with a visible indicator plus `required`/`aria-required`. If most fields are required, mark the optional ones instead.
- Validate on blur or submit, not on every keystroke — flagging "invalid email" while the user is mid-typing is hostile. After the first submit attempt, revalidating live is fine.
- Tie errors to fields: `aria-describedby` pointing at the error element, `aria-invalid` on the input, `role="alert"` on the message. Error text says how to fix it ("Enter a date after the start date"), never just "Invalid".

```html
<label for="email">Email <span aria-hidden="true">*</span></label>
<input id="email" type="email" required aria-required="true"
       aria-describedby="email-error" aria-invalid="true"
       autocomplete="email" />
<p id="email-error" role="alert">Enter an email like name@company.com.</p>
```

- Use `autocomplete` attributes and the right input types (`email`, `tel`, `date`, `number`) — free mobile keyboards and autofill.
- One primary button per form, visually dominant, labeled with the action ("Save changes", not "Submit"). Secondary actions are visually quieter. Destructive actions get distinct styling and a confirm step or undo.
- On submit: disable the button and change its label ("Saving…") so double-clicks don't double-submit and the user knows something happened.

## Data tables

Tables are the heart of most internal tools, and the most commonly botched element.

- Alignment carries meaning: left-align text, right-align numbers (with `font-variant-numeric: tabular-nums` so digits line up), and align headers with their column data. Never center-align everything.
- Headers: distinct but quiet — muted small-caps or medium weight, not a heavy colored bar. Use `<th scope="col">` for real header semantics.
- Density: comfortable row height ~44–52px for scanning; compact (~36px) when users compare many rows. Zebra stripes or row hover — not both.
- Row actions: keep 1–2 visible, overflow the rest into a menu. Whole-row click targets need a real link or button inside for keyboard users.
- Long tables: sticky header (`position: sticky; top: 0`), pagination or virtualization past a few hundred rows, and a visible count ("142 candidates").
- Sorting/filtering: show current sort direction on the header (and `aria-sort`), reflect active filters as visible, dismissible chips — invisible filter state makes users think data is missing.

## The four states

Every view backed by async data has four states, and shipping only the success state is the most common app-UI failure. Design all four:

1. **Loading** — skeleton placeholders shaped like the content beat a lone spinner; they set expectations and prevent layout shift. Show instantly, don't flash (if data arrives <150ms, skip the skeleton).
2. **Empty** — an invitation, not a dead end: say what belongs here and give the action that creates it ("No candidates yet. Import a CSV or add one manually."). First-run empty ≠ filtered-to-nothing empty ("No matches — clear filters").
3. **Error** — plain language: what failed, whether their data is safe, and a retry action. Never a bare "Error" or a stack trace.
4. **Success with data** — the state you were already building.

## Feedback and interaction

Every user action gets a visible response within 100ms, even if the work takes longer.

- Async status changes announce via `aria-live="polite"` (toasts, "Saved" indicators). Reserve `assertive` for urgent errors.
- Prefer undo over confirmation dialogs for reversible actions; reserve confirms for genuinely destructive ones, and name the object ("Delete 3 candidates?").
- Keyboard is a first-class input in work tools: visible focus states on everything interactive (never `outline: none` without a replacement), `Escape` closes overlays, modals trap focus and restore it to the trigger on close (`role="dialog"`, `aria-modal="true"`).
- Real elements: `<button>` for actions, `<a href>` for navigation. A `div onclick` has no keyboard support, no focus, no semantics — this one substitution fixes half of a11y review findings.
- Touch targets ≥ 44×44px with ≥ 8px between adjacent targets.

## Structure and responsiveness

- Landmarks: one `<header>`, `<nav>`, one `<main>`, headings in order (h1 → h2, no skips). Screen readers and future maintainers both navigate by these.
- App shell: sidebar collapses to a drawer or bottom nav below ~768px; content area gets `min-width: 0` so it can actually shrink (the classic flexbox overflow bug).
- Tables on small screens: horizontal scroll inside their own container (`overflow-x: auto` on a wrapper — never the page body) or reflow to cards. Test at 375px.
- Use `min-height: 100dvh`, not `100vh` (mobile browser chrome), and don't fix the page height — app content grows.

## Performance guardrails

- Animate only `transform` and `opacity`; animating `width`/`height`/`top` forces layout on every frame.
- Respect `prefers-reduced-motion: reduce` — gate nonessential animation behind the media query.
- `backdrop-filter: blur()` only on fixed/sticky elements (nav, overlays), never on scrolling content — it repaints continuously on mobile.
- Scroll-triggered reveals use `IntersectionObserver`, not scroll listeners.
- Subtle transitions (100–200ms) on hover/focus/state changes make an app feel responsive; long entrance animations on a tool people open 20× a day make it feel slow. Match motion to usage frequency.

## Pre-ship checklist

- Spacing uses only scale values; labels/inputs/buttons share alignment lines
- Every input has a connected visible label; errors are linked, specific, and announced
- Numbers right-aligned with tabular figures; table headers are real `<th>`
- Loading, empty, error, and success states all exist for every async view
- Submit buttons show pending state; no double-submit
- Tab through the page: everything reachable, focus visible, Escape closes overlays, modals restore focus
- 375px wide: no page-level horizontal scroll; touch targets ≥ 44px
- Reduced motion respected; only transform/opacity animated
