# Turf Operations — project overview

A counter-staff console for running a three-pitch football turf: what is free,
what is booked, what is playing right now, and who still owes money.

This is the short version. `README.md` covers security, deployment and the
hardening detail; this file explains what the thing *is* and how it hangs
together.

---

## The shape of it

```
server.mjs          HTTP + routing + auth middleware
server/store.mjs    the domain — every business rule lives here
client/             vanilla ES modules, no framework, no build step
  state.js            one S object; preferences persist to localStorage
  domain.js           derived reads over S (availability, pricing, money)
  actions.js          every data-act handler; the only place that mutates
  render.js           full repaint on change + a 1s tick for live things
  views/              availability · sessions · accounts · alerts · dashboard · settings
styles.css          one stylesheet, tokens at :root, dark under [data-theme]
tests/              18 tests, node:test, no runner to install
```

Rendering is deliberately dumb: any state change repaints the view from
scratch. Scroll position, focus and caret are preserved across the repaint.
Only two things update in place, because repainting three columns of cards
every second would be absurd — the now-line and the running-match countdown.

---

## Core concepts

**Pitches** — three, fixed: Pitch A (7-a-side, ₹1,800/hr), Pitch B (5-a-side,
₹1,200/hr), Main Ground (11-a-side, ₹3,200/hr). Trading hours 06:00–22:00.

**Price** = rate × hours, plus a flat ₹300 if the booking ends after 18:00
(floodlights). One rule, in `store.mjs`, mirrored once in `domain.js` so the
console quotes what the server will bill. A test pins the two together.

**Booking** — a date, pitch, start and end. Status moves
`upcoming → running → done`, with `noshow` and `cancelled` as exits. Anything
that runs backwards is a *reversal*: manager role, a written reason, and an
audit row.

**Hold** — a soft reservation that expires by itself after 20 minutes. It
blocks the slot while it lives and cannot be confirmed once dead.

**Block** — maintenance. Removes a sellable slot, manager-only, audited.

**Payment** — an append-only ledger of events (`payment` / `refund`), each with
a mode (Cash / UPI / Card), a reference for non-cash, and an idempotency key.
Balances are derived by summing the ledger, never stored. Nothing is ever
edited or deleted; a correction is a reversing entry that says why.

---

## The board

The availability view is the main surface. Two ways to read the day:

- **Timeline** — cards positioned by start time and sized by duration, so the
  shape of the day is legible before you read a number.
- **Collapsed** — one row per hour, every cell the same size, for scanning
  what's free without scrolling. A part-booked hour states its leftover
  (`30m free`) rather than drawing a clipped half-cell.

**How open time is drawn.** Contiguous free time is merged first, then cut into
whole hours *measured from where the gap starts* — so 11:30–12:30 is one
bookable hour, not two halves either side of noon. A leftover half hour is
drawn as itself; there is no 90-minute open bubble, because nobody books one.
A half hour is dashed **only** when a booking sits hard against both ends —
the slot nobody can grow.

**The card scales by ratio.** Every measure derives from the card's own
height — radius `.18`, side padding `.15`, the two ends `.27`, band `.27` — so
a two-hour booking is the hour card at a larger size rather than a stretched
one. The one ceiling is on the times: a board column is ~262px wide and past
about 30px the two ends stop fitting, so the ratio governs until the width
does.

---

## A match, from arrival to settled

The card carries the whole lifecycle. No other screen is needed.

| State | What the card becomes |
|---|---|
| **Arriving** | 20 min before start: a `Check in` tray across its base |
| **Checked in** | `Undo` · `Start timer` |
| **Running** | Drops the planning detail, rebuilds around a countdown; the card's own outline is the progress ring, with pause and end flanking it |
| **Ended, owing** | Red; name and number become the largest text; `Call` · `Collect ₹x` |
| **Settled** | Recedes to 42%, keeping one `Edit payment` chip in the corner |

Check-in is client-side only — the server has no arrival status, just
`upcoming / running / done / noshow`. Starting the timer is the real
transition and goes through the audited API. There is no pause in the data
model: stopping returns the session to `upcoming`.

**Editing payment** on a settled card opens the payment sheet, not a refund
flow — a card marked paid in error is not a refund. With money still
outstanding it collects; with nothing outstanding it reverses against the
tender the money was taken in, manager-only, with a reason. The ledger stays
append-only either way.

**Split tender** — `Cash + UPI` posts two ledger entries rather than one, which
is what keeps the per-mode totals right for till reconciliation and caps a
later reversal to the tender it came from.

---

## The other views

- **Sessions** — today's matches as a live rail: what's in play, what's
  overtime, what needs a final status.
- **Accounts** — the money ledger. Filter by open / settled / refunded /
  closed, collect, refund, export.
- **Reminders** — derived alerts: sessions past their end without a status,
  matches running over, money uncollected.
- **Dashboard** — utilisation by day and pitch, demand by hour.
- **Settings** — dark mode, pitch colour-coding, the deposit policy (shared,
  manager-only, audited).

---

## Design system

The visual language comes from the **Turf Operations** design system on
claude.ai/design, and it is authoritative — where the console and the system
disagreed, the system won. `styles.css` carries its rules and its tokens.

Light and dark are one system, not two. The trick is that a *fill* is a
different thing from *ink*: `--ink` is the strongest text colour and inverts
between themes, so anything painting a surface with it and knocking a white
label out went white-on-white in dark. The system separates them —
`--fill-deep`, `--fill-open`, `--fill-blocked` — defined light at `:root` and
retuned under `[data-theme="dark"]`, so the knock-out label follows the fill
into either theme. The lime is untouched in both: it is the one thing on
screen with a colour and it does the same job either way.

---

## Roles

| | Operator | Manager | Owner |
|---|---|---|---|
| Book, hold, collect | ✓ | ✓ | ✓ |
| Release, maintenance, reversals, discounts | | ✓ | ✓ |
| Discounts above 20% | | | ✓ |
| Create and revoke staff | | | ✓ |

Sessions are `HttpOnly` + `SameSite=Strict`, CSRF-protected, 30-minute idle
timeout, 12-hour absolute expiry. Every privileged action writes an audit row
with a before/after snapshot and the reason given.

---

## Running it

```bash
npm start                       # or: npm run dev  (node --watch)
npm test                        # 18 tests
npm run check                   # syntax across every source file, then tests
node scripts/seed-users.mjs     # test accounts; passwords printed once
```

The console runs at `http://localhost:5180`.

A development-only clock override lives in `nowMin()`, hard-gated to
localhost, for seeing the live states without waiting for a real match:

```js
localStorage.setItem('turf-erp:clock', '18:45'); location.reload()
```

---

## Things worth knowing before changing anything

- **The ledger is append-only.** Corrections are reversing entries. Do not add
  an UPDATE path to `payment_events`; the till reconciliation depends on the
  history being complete.
- **Pitch rates exist in two tiers** (`client/constants.js` and
  `server/store.mjs`). A test pins them together; the real fix is the server
  sending them in `/api/state`.
- **The board's card height comes from duration**, not from the design
  system's fixed demo heights. A live composition that needs more room than
  its duration allows must shrink, not force the cell open — forcing it spills
  the card over its neighbour and out from under its own tray.
- **Bare `z-index` on a card is only meaningful inside its own stacking
  context.** `.schedule-board` is isolated for exactly this reason; a card
  that raises itself above its neighbours was also clearing the sticky header.
