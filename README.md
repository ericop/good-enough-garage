# Good Enough Garage 🔧

A roguelike deckbuilder set in an auto-repair shop. Every car ends on a commit: hit **Ship It** and hand it back without being sure you caught every fault. Triage a lot of impatient customers, diagnose hidden faults, repair, and gamble on shipping fast vs shipping right. Survive 5 days of rent.

## Play

- **No server needed:** just open `index.html` (it runs straight from `file://`).
- **Served:** point any static server at the folder.
- **Phone:** serve the folder and browse to your machine's IP, e.g. `http://192.168.0.107:8765`.

```bash
# optional: serve it locally
python3 -m http.server 8765
# then open http://localhost:8765
```

Add `?seed=1` to the URL for a reproducible run. Without a seed the game picks one and shows it in the stat bar.

## How to play

1. **Intake** a car from the lot (free) to pull it into a bay and see its complaint.
2. **Diagnose** (1 token) to uncover hidden faults, or gamble that there are none.
3. **Repair** revealed faults with a mechanic (a specialty match earns a bonus).
4. **Ship It** to get paid. Ship a car with faults still unfixed and it pays now but returns the next day, unhappy and with a refund clawback.

Clear each day's revenue quota to reach the between-day shop and upgrade your garage. Miss the quota (or let your reputation hit zero) and it is game over. Survive all 5 days to win.

## Tech

Two files, no build step, no dependencies, plain ES2020. `index.html` loads `game.js` as a classic script, so it works both served and from `file://`. All game state flows one way: `state` → `render` → `dispatch`. Randomness runs through a seeded PRNG, and `window.GEG` exposes a small debug API for automated testing.
