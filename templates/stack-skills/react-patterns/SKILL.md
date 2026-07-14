---
name: react-patterns
description: React 18/19 component patterns — hooks discipline, Server/Client component boundaries, Suspense and error boundaries, form actions, state-location decisions, and accessibility-first composition. Use when writing or reviewing React function components, custom hooks, or JSX/TSX in this layer. Not for React Native, and not for router-specific data loading (Next.js App Router, Remix) — those follow the router's own docs.
---

# react-patterns

Idiomatic React 18/19 patterns for component trees, state placement, and
composition. Applies to plain React and any router on top of it (Next.js
App Router, Remix, React Router) — router-specific loader/action conventions
are out of scope; follow the router's own docs for those.

## Core principles

1. **Render is a pure function of props and state.** Derive values during
   render; don't mirror them into a second `useState` updated by
   `useEffect` — that adds a render cycle and can desync.
2. **Side effects stay outside render** — event handlers or `useEffect`,
   never the render body itself.
3. **Compose, don't inherit.** React has no component inheritance model —
   use `children`, render props, or component props instead.

## Hooks discipline

- Hooks only at the top level, never inside a condition, loop, or nested
  function.
- Every subscription, interval, or listener gets a matching cleanup
  function.
- Use the functional updater (`setX(prev => prev + 1)`) whenever new state
  depends on old state.
- Default position: don't memoize. Add `useMemo`/`useCallback` only when a
  profiler or a dependency chain proves it's needed — an unconditional
  equality check on every render is not free.
- Extract a custom hook only once the same hook sequence appears in 2+
  components; a one-off wrapper adds indirection without payoff.

## Where state lives

```
Used by one component?              -> useState inside it
Used by parent + a few descendants? -> lift to the nearest common ancestor
Used across distant branches AND
  low-frequency reads (theme, locale)? -> React Context
High-frequency updates shared
  across the tree?                  -> external store (Zustand, Jotai, Redux Toolkit)
Derived from a server?              -> server-state library (TanStack Query, SWR, RSC fetch)
```

Most pages need neither context nor a global store — resist the abstraction
until duplicated prop-lifting actually hurts.

## Server / Client component boundaries (RSC)

- Server Components are the default: async, never ship JS for themselves.
  Opt a subtree into the client with `"use client"` only where it needs
  interactivity or browser APIs.
- Server → Client: pass serializable props or `children`, never a function
  or class instance.
- Client → Server: invoke Server Actions via `<form action={...}>` or from
  an event handler.
- Never `import` a Server Component from inside a Client Component file —
  compose them via `children` instead.

## Suspense and error boundaries

- Place `<Suspense>` boundaries close to the data they gate, not at the
  route root, so unrelated content isn't blocked by one slow fetch.
- Error Boundary is still a class-component API in React itself; use
  `react-error-boundary` for a hook-friendly wrapper if the project already
  depends on it — don't add the dependency just for this.
- A boundary catches errors thrown during render, lifecycle methods, and
  constructors of its children — **not** errors from event handlers or
  `async` code; those need their own try/catch.

## Forms

- **React 19 form actions** (`useActionState` from `react`, or
  `useFormState` from `react-dom` on React 18) are the preferred shape for
  new form code — the server action does validation and returns the error
  shape the component renders.
- **Controlled inputs** only when the value drives other UI, needs
  per-keystroke formatting, or does real-time validation. Otherwise prefer
  uncontrolled + form actions.
- **Complex forms** (multi-step, dynamic field arrays, cross-field
  validation) belong in an existing form library the project already uses
  (React Hook Form, TanStack Form) — hand-rolled state management for a
  form past trivial complexity is a maintenance trap. Don't introduce a new
  form library if the project has one; match it.

## Data fetching

| Need | Reach for |
|---|---|
| Per-request data in an RSC-capable framework | `await fetch()` in the Server Component |
| Client-side cache + mutations + invalidation | TanStack Query |
| Lightweight client cache + revalidation | SWR |
| Real-time | Server-Sent Events, WebSockets, or the library's subscription API |
| One-off fire-and-forget | `fetch()` inside an event handler |

Avoid `useEffect` + `fetch` for application data — no cache, no retry, no
Suspense integration, and a real risk of race conditions on fast
navigation. Match whichever of the above the project has already adopted;
don't introduce a second data-fetching library alongside an existing one.

## Composition patterns

- **Slot via `children`**: `<Layout><Header /><Main>{content}</Main></Layout>`.
- **Named slots**: pass distinct elements as separate props
  (`<Page header={<Nav />} sidebar={<Filters />}>`).
- **Compound components** share state via Context internally
  (`<Tabs><Tabs.List>…`) — reach for this only when the project's existing
  component library already uses the pattern; don't introduce it solo.
- **Render prop / function-as-child** is useful when the parent must pass
  parameters into the rendered output; a custom hook returning the same
  shape is usually the cleaner modern equivalent.

## Performance

- Wrap in `React.memo` only when the component re-renders often, its props
  are usually unchanged between renders, AND its render is measurably
  expensive — `React.memo` itself adds an equality check every render, so
  it's a net loss when props differ most of the time.
- Split Context by concern (one context per changing value) so a themed
  change doesn't re-render every context consumer, including unrelated
  ones.
- Give list items a stable `key` (a real id, never the array index).
  Virtualize lists once the visible item count regularly exceeds ~50
  non-trivial rows.

## Accessibility

- Reach for semantic HTML (`<button>`, `<a>`, `<nav>`, `<main>`) before
  adding `role` attributes.
- Every interactive element must be keyboard-reachable.
- Inputs need a real label (`<label htmlFor>` or `aria-label` when only an
  icon is shown).
- Manage focus explicitly on route changes and modal open/close.

## Rules

- Derived state lives in the render body, not in a `useEffect`-synced
  `useState`.
- A hook sequence duplicated across 2+ components gets extracted; a
  one-off wrapper does not.
- No new state-management or form library introduced solo — match what the
  project already uses.
- Every list `key` is a stable id; index-as-key is a defect, not a style
  nit.
