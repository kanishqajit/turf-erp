# Turf Operations — the console

## What it is

A screen that sits on the counter of a football turf with three pitches, open
from six in the morning until ten at night. One person works it. Someone walks
in or rings up and asks *"is Pitch B free at seven?"* — this is the thing that
answers, takes the booking, runs the clock while the match is on, and takes the
money afterwards.

It is not a booking website. Nobody browsing at home ever sees it. It is a tool
for one operator under mild pressure, often mid-conversation, sometimes with a
queue. Almost every design decision in it follows from that.

---

## Why it looks the way it does

**The board is the product.** Everything else is a detail panel hanging off it.
The operator's whole job is reading a grid of time and answering questions
about it, so the grid gets the screen and the questions get answered without
leaving it.

**Answer before reading.** A booking's shape should say how long it is before
you parse a single digit. Cards are positioned by start time and sized by
duration, so a two-hour match is visibly twice a one-hour match. You can see
the shape of the evening across three pitches in one glance.

**One card, one state.** A cell never needs interpreting. It is open, or held,
or booked at the counter, or booked in the app, or blocked for maintenance —
told by fill, not by a legend you have to memorise.

**Never hide sellable time.** The board's cardinal sin would be making a slot
look unavailable when it isn't. Several rules exist purely to protect that, and
they are the fussiest logic in the front end.

**The card carries the job.** When a match is about to start, is running, or
has finished owing money, the card itself becomes the control. No hunting
through a second screen for the team that just walked in.

---

## The layers

```
state.js     one plain object, S. Nothing else holds state.
domain.js    pure reads over S — what's free, what a slot costs, what's owed
actions.js   every interaction; the only place that writes to S
render.js    paints the whole view from S; a 1s tick for the live parts
views/       availability · sessions · accounts · alerts · dashboard · settings
styles.css   design tokens at :root, dark theme under [data-theme="dark"]
```

No framework, no build step, no bundler. Plain ES modules the browser loads
directly. Editing a file and reloading is the whole dev loop.

### State

One object, `S`. Every view is a pure function of it. There is no component
state, no local state, nothing hidden in a closure — if something is on screen,
its cause is a field in `S`, which makes any layout question answerable by
reading one object in the console.

A small slice survives reloads in `localStorage`: theme, collapsed density,
which time bands are folded, pitch colour-coding, and check-ins.

### Interaction

Every clickable thing carries `data-act` and, where relevant, `data-id` /
`data-v`. Four listeners on `document` — click, submit, input, keydown — walk
up from the event target to the nearest `[data-act]` and switch on it.

This is why full repaints are safe. Nothing holds a handler, so nothing has to
be torn down or rebound; markup can be thrown away and replaced wholesale and
every control still works. Adding a button is one line of HTML and one `case`.

### Rendering

Any state change repaints the active view from scratch — no diffing. On a board
of ~50 cards this is imperceptible, and it buys the guarantee that the screen
can never disagree with `S`.

Three things survive a repaint by being explicitly preserved: scroll position of
the board and the session rail, focus, and caret position inside a text field.
Without that last one, typing a team name would put the cursor back at the start
on every keystroke.

Two things are exempt because repainting them every second would be absurd — the
red now-line, and the countdown and progress ring on a running match. Both are
nudged in place on a one-second tick.

Typing is a third case. A keystroke usually needs only a save button to
enable or grey out, so text inputs call a light `refreshGate()` that touches the
relevant buttons instead of repainting. *If you add a new dialog with a confirm
button, it must be named there or it will never enable* — a real bug, twice.

---

## The board

The main view. Three pitch columns against a time axis, with a red line at the
current minute.

**Two densities.** Expanded is the timeline: position means start, height means
duration. Collapsed is a uniform grid, one row per hour, every cell identical —
because "how long is this booking?" and "which of these is free?" are different
questions and want different shapes. Scanning for a free evening is much faster
against a regular grid than a ragged one. The choice persists.

**How free time is drawn** — the fussiest logic here, and all of it protects
against hiding sellable time:

- Contiguous free time is merged first, then cut into whole hours **measured
  from where the gap starts**. So a gap from 11:30 to 12:30 is one bookable
  hour, not two halves either side of noon.
- A leftover half hour is drawn as itself, at half height. There is no
  90-minute open bubble — nobody books one, and inventing one to tidy the
  layout would misrepresent what is on sale.
- A half hour is **dashed only** when a booking sits hard against both ends.
  That is the slot nobody can grow. A half hour next to an open hour is
  ordinary sellable time and looks ordinary.
- Collapsed, a part-booked hour **states its leftover** (`30m free`) rather
  than drawing a clipped half-cell. A number is read once and is exact; a
  stripe has to be measured by eye, and clipping it mangles the label
  underneath.

**The card scales by ratio.** Every measure derives from the card's own
height — corner radius, side padding, the two end times, the name band — so a
long booking is the hour card at a larger size rather than a stretched one with
dead space in the middle. The one ceiling is on the times: a column is about
262px wide and past roughly 30px the two ends crowd out the rail between them,
so the ratio governs until the width does.

**Overlapping cards split the column.** Two bookings that overlap sit side by
side rather than one hiding the other. This should be unreachable, but a hidden
booking is a match nobody knows about, which is worse than an ugly board.

---

## A match, from arrival to settled

The card becomes the control. Nothing here needs a second screen.

| | The card shows |
|---|---|
| **Arriving** | From 20 minutes before start, a `Check in` bar across its base |
| **Checked in** | `Undo` · `Start timer` |
| **Running** | Planning detail drops away; a countdown fills the card, its own outline is the progress ring, pause and end flank it |
| **Ended, owing** | Red. Name and number become the largest text on it — what you need to chase the money. `Call` · `Collect ₹x` |
| **Settled** | Fades to 42%, keeping one `Edit payment` chip in the corner. Hover restores it |

**Actions live in a tray along the base, not in a corner.** The corner is where
nothing looks, and these are the actions the card exists to offer.

**A running card carries no kind tag.** Whether it came from the counter or the
app is not the question while a match is on.

**Short cards shed, they don't overflow.** A card's height comes from its
duration, so an hour-long booking cannot fit the full composition plus a tray.
Below 90 minutes it drops the team line — which is on the tooltip and in the
panel anyway — and keeps the two things that cannot go: when it starts, and the
button.

**Money.** `Cash + UPI` is a tender type: choosing it swaps the amount field
for two and totals them live. Editing payment on a settled card opens the
payment sheet, not a refund flow — a card marked paid in error is not a refund,
and the operator shouldn't have to call it one to fix it. With money still due
it collects; with nothing due it reverses against the tender the money came in
on, and asks what happened.

---

## The other views

- **Sessions** — today as a live rail. What's in play, what's run over, what
  finished without anyone marking it.
- **Accounts** — the money. Filter by open, settled, refunded or closed;
  search by team or number; collect, refund, export.
- **Reminders** — nothing new, just noticing: sessions past their end with no
  final status, matches running over, money uncollected. A badge on the tab.
- **Dashboard** — utilisation by day and pitch, demand by hour.
- **Settings** — dark mode, pitch colour-coding, deposit policy.

---

## Theming

Light and dark are one system, not two stylesheets. Everything visual comes
from tokens at `:root`, redefined under `[data-theme="dark"]`.

The idea that makes it work is that **a fill is not the same thing as ink**.
`--ink` is the strongest text colour, so it inverts between themes — near-black
on paper, near-white on a dark page. Anything that painted a *surface* with it
and knocked a white label out of that surface turned white-on-white the moment
the theme flipped. So fills have their own tokens (`--fill-deep`, `--fill-open`,
`--fill-blocked`) that stay dark in both themes, and the knock-out label follows
the fill rather than the text colour.

The lime is untouched in either theme. It is the one thing on screen with a
colour, and it means the same thing in both.

The choice is stored per console — a shared counter terminal and a back-office
laptop can differ — and applied before the first paint so there is no white
flash on reload.

---

## Things that will bite you

- **A new confirm button must be registered in `refreshGate()`.** Typing
  repaints only the gate, so a button it doesn't know about stays disabled no
  matter what the user types.
- **A card cannot be taller than its cell.** Its height comes from duration.
  Force it open with a `min-height` and it spills over the neighbouring slot
  *and* out from under its own tray, which is anchored to the cell.
- **`z-index` on a card only means something inside `.schedule-board`.** The
  board is an isolated stacking context on purpose. A card that raises itself
  above its neighbours was also painting over the sticky header until it was.
- **Everything time-related reads `nowMin()`.** Two clocks drift; a countdown
  once disagreed with the ring drawn around it. There is a dev-only override,
  gated to localhost, for seeing the live states without waiting for a match:
  `localStorage.setItem('turf-erp:clock','18:45')`.
