# CLAUDE.md

Guidance for AI coding agents working in this repo. Read it before editing —
several conventions here are deliberate and a couple of traps have caused real
bugs more than once.

## What this is

A single-page operator console for a football turf, written as **vanilla
HTML/CSS/JS with no framework, no build step and no dependencies**. Three files
do everything: `index.html` (shell), `app.js` (all logic), `styles.css` (all
styling). Keep it that way unless the human explicitly asks otherwise — adding a
bundler or framework is not an improvement here, it's a rewrite.

All data is mock. `S` is the single state object; a real API would replace the
generators in `app.js`, not the rendering.

## Architecture

**One state object, full re-render.** Every interaction mutates `S`, then calls
`render()`, which rebuilds the topbar, the active view and the modal layer from
template strings. There is no virtual DOM and no diffing. This is fine at this
scale — don't introduce reactivity.

**Delegated events.** There are no inline handlers. Every interactive element
carries `data-act="..."` plus optional `data-v` / `data-id` / `data-pi` /
`data-di` / `data-hi`, and a single document-level listener switches on
`data-act`. Add a `case`, don't attach a listener.

**Views** are functions returning HTML strings, registered in `VIEWS` and listed
in `TABS`. `LIVE_VIEWS` is the set that re-renders every second for clocks and
countdowns; everything else only repaints the topbar on the tick.

### Full re-render has consequences

Because the DOM is thrown away every second on live views, `render()` explicitly
restores:

- **Focus and caret** for the focused element, by `id`
- **Scroll position** of panes listed in `SCROLL_PANES`, by `id`
- **Sticky-header condense state**, via `syncStuck()`

If you add a scrollable container or a focusable field that must survive the
tick, wire it into those mechanisms. A container that "scrolls but snaps back"
is this, every time.

## Conventions

**Escape everything interpolated.** `esc()` on any user-supplied or data value
going into a template string, including attribute values.

**Time.** One clock across the whole app: 12-hour, whole hours without `:00`.
Use `t12(min)` for a moment and `rng12(a, b)` for a range — they produce `6PM`,
`6:30PM`, `6–7PM`, `11AM–12PM`. Helpers `hourT12(h)` / `hourRng12(h)` take an
hour number. Minutes-since-midnight is the internal unit throughout. The only
24-hour string is the value fed to `<input type="date">`, via `isoDate()`.

**Money.** `money(n)` → `₹1,800`, always. Never format inline.

**Dates.** `TODAY` is the fixed demo date. A day is addressable as
`(weekOffset, dayIndex)` or as a plain offset from today — `goToDayOffset(n)`
converts. Parse date-input values with `daysFromIso()`, which works in local
time; `new Date('2026-08-15')` parses as UTC and can land a day early.

**Styling.** Use the CSS custom properties in `:root`. Per-pitch colour is
carried by `--tint-bg / --tint-line / --tint-fg / --tint-soft / --tint-chip /
--tint-chip-fg`, emitted by `tintVars()`. Any container using those tokens must
declare all of them — `.daycard` hardcodes paper/ink and still declares the full
set, because `color-mix()` against an undefined variable is invalid and silently
drops the whole declaration.

## Traps

**Generic class names collide with modifiers.** This has caused two real bugs:

- `.app` was the root container *and* the "booked in app" bubble modifier, so
  every lime bubble inherited `min-height: 100vh`.
- `.live` was a view class *and* `.pitchhead.live`, so live pitch headers
  rendered as tall centred columns.

Keep modifiers compound (`.scard.live`) or namespaced (`.bub.via-app`). Never
add a bare single-word rule that could match a modifier elsewhere.

**Measure layout with overlap, not `top`.** Under `align-items: center`, items on
the same flex row have different `top` values. Comparing tops to detect wrapping
gives false positives — compare vertical overlap.

**Don't trust a screenshot after an edit.** The dev server's caching means Chrome
often serves a stale `app.js` against fresh CSS. Hard-reload, or fetch with
`{cache:'reload'}` before reloading, and verify against the DOM.

## Design rationale

Decisions that look arbitrary but aren't. Changing them without cause will make
the tool worse for the staff using it.

- **Day-first availability.** The most common counter question is *"anything free
  at 7pm?"* across all pitches. One-pitch-at-a-time made that three clicks and a
  memory test.
- **Both axes stay locked while scrolling.** The sticky header carries the date
  *and* the pitch columns (or the pitch *and* the weekday columns). Not knowing
  which column you're about to book is the failure this prevents. Once stuck the
  header condenses — chips move up beside the date rather than disappearing.
- **Each session appears exactly once.** It used to render three times, each with
  duplicate controls; that duplication *was* the navigation problem. Cards live
  in the Live rail, the list in the table, timelines are overview only.
- **Payment-due sessions stay on the Live rail until collected.** Closes the leak
  where a match ends, everyone leaves, and nobody chased the cash.
- **Friction belongs on high-stakes actions.** A fake 4-digit PIN once guarded
  blocking an empty hour while releasing a paying booking took one click. The PIN
  is gone. A discount-approval gate is the biggest remaining gap — see README.
- **Pitch colours are opt-in**, off by default, from a fixed palette so every
  choice stays legible against the ink + lime base. No colour wheel.

## Verifying a change

There are no tests. Verify in a browser and check the DOM rather than eyeballing:

1. Serve the folder and hard-reload.
2. Check the console is clean.
3. Assert the actual result — computed styles, element counts, text content —
   rather than declaring it works.
4. Exercise both availability modes, both collapsed and expanded bands, and at
   least one narrow viewport. Layout regressions here are usually flex-wrap or a
   sticky offset.
