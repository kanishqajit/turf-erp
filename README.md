# Turf Operations — booking console

An operator console for a multi-pitch football turf: slot availability, live
session tracking, cash collection reminders and a utilisation dashboard.

**Live:** https://turf-erp-omega.vercel.app

> **Status: front-end prototype.** There is no backend. All state lives in one
> JavaScript object in the browser tab and resets on refresh. The availability
> grid is generated from a deterministic hash, not real bookings. See
> [What's missing](#whats-missing) before planning production work.

---

## Running it

No build step, no dependencies. Any static file server works:

```bash
python -m http.server 5174
```

Then open `http://localhost:5174`.

The server sends caching headers that Chrome honours aggressively — if an edit
doesn't show up, hard-reload with **Ctrl+Shift+R**.

## Layout

| File | What's in it |
|---|---|
| `index.html` | Shell only — a topbar, a view container and a modal container |
| `app.js` | All data, state, view rendering and event handling |
| `styles.css` | Design tokens plus every component class |
| `CLAUDE.md` | Architecture and conventions — **read this before editing** |

## The four views

**Availability** — sells slots. Two modes: *All pitches* (one date, pitches as
columns — the default, because the common counter question is "anything free
6–10pm?") and *One pitch* (one pitch across seven days). Hours group into
collapsible bands: Morning, Afternoon, Evening, Late night.

**Sessions** — runs the day. Per-pitch timelines, a table of every session with
inline match/payment controls, and a sticky *Live now* rail of in-progress
matches.

**Reminders** — what needs doing: matches not started, overtime, cash to collect.

**Dashboard** — utilisation, demand by hour, today's bookings.

**Settings** — optional per-pitch colour coding, off by default.

## What's missing

Honest list, roughly by importance:

- **No backend or persistence.** Refresh loses everything.
- **No auth.** The header avatar is hardcoded text; anyone with the URL has full
  manager access.
- **No multi-user sync.** Two staff on two devices see two diverging realities.
- **No real payments.** "Collect money" flips a field.
- **No discount control.** Any user can settle a ₹4,800 booking for ₹100 with no
  reason recorded and no cap — the widest risk in the product.
- **No search or reschedule.** Both start to hurt past ~20 bookings/day.
- **Desktop only.** No mobile layout, though the staff who need it most are
  walking between pitches.

## Deploying

```bash
vercel deploy --prod
```

`serve.py` is excluded via `.vercelignore`.

## Contributing

Read `CLAUDE.md` first — it documents the conventions and a couple of traps that
have bitten this codebase more than once. Keep changes in the existing vanilla
JS style; there is deliberately no framework or build step.
