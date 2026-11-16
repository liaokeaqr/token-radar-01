# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/liaokeaqr/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/liaokeaqr/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar: 40 pre-token protocols on the DefiLlama watchlist ranked by market-derived implied value, with a concrete farm plan for each. Implied value = TVL × category-or-global median market-cap/TVL multiple × growth × maturity. Model radar-2.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22 or later, stdlib only — no network, no clock, no randomness. The same snapshot always produces the same output. The program reads the sealed snapshot (`--input`), writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory, and serves the dashboard with no network at all.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
