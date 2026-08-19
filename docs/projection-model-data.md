# Jimmy GM projection data

Jimmy's neutral football projection is built before league scoring. League rules are applied downstream to projected components, and live Vegas remains an independent reconciliation signal. Historical evaluation uses chronological folds: train through 2021/2022/2023/2024 and validate 2022/2023/2024/2025 respectively.

## Data inventory

| Family | Source | Coverage | Local rows | Transformation and leakage rule | Consumers |
|---|---|---:|---:|---|---|
| Weekly player statistics | nflverse weekly player stats | 2012–2025 | 81,141 | Position-normalized box score; Week N target only, never a Week N feature | v1–v4, profiles |
| Play-by-play opportunity | nflverse/nflfastR PBP | 2018–2025 | 41,047 player-weeks, 105 aggregate fields | Red zone, goal line, game script, EPA, shares; all rolling values shifted before Week N | v3+ |
| Offensive snaps | nflverse PFR-derived snap counts | 2018–2025 locally | 55,970 source rows; 47,491 weekly-stat matches | Official count and percentage; prior-game/rolling features are shifted; missing is distinct from zero | v3.2+, v4+, profiles |
| Model-ready player weeks | Jimmy feature pipeline | 2018–2025 | 45,580 rows, 440 columns | Chronological rolling windows and explicit missingness | v3+ |
| Weekly rosters | nflverse | 2018–2025 | Included in 112,907 availability rows | Weekly canonical team/status snapshot | v4/v4.1 |
| Historical depth | nflverse depth charts | 2018–2025 | 81.34% of model player-weeks | Pregame rank; missing remains explicit | v4/v4.1 |
| Injury/practice | nflverse injuries | 2018–2025 | 15.00% of all player-weeks have an observed record | Only updates timestamped at least 24 hours before kickoff | v4.1 |
| Current roster/depth | Sleeper plus canonical current-role snapshot | Current inference only | Current player pool | Never used as a historical target; canonical team is resolved before allocation | Current inference |
| Schedule/game context | nflverse schedule | Historical/current | Team-week | Home/away and rest are known pregame | v3+ |
| Vegas | Stored odds and player props | Current, availability-dependent | Game/player | Independent post-model arbitration; never counted twice | Reconciliation |

See [model-v4-data-source-audit.md](./model-v4-data-source-audit.md) for source licensing, timestamp quality, rejected route sources, and the 24-hour cutoff policy.

## SNAP feature family

The canonical percentage is stored on a 0–1 scale and displayed as a percentage. The historical importer now merges snaps by GSIS player, season, week, season type, and canonical team; it intentionally does not trust synthetic `game_id` values across feeds.

| Feature | Construction | Missing handling | Models |
|---|---|---|---|
| `snap_pct_last_1` | Previous game's offensive snap percentage | Missing indicator; never zero-filled as observed usage | v3.2+ |
| `snap_pct_last_3/5/8` | Shifted rolling mean | Available observations only | SNAP experiments/v4 hierarchy |
| `snap_pct_delta_1`, `snap_pct_trend_3` | Prior change and prior-vs-rolling difference | Neutral when history is absent | Role detection/experiments |
| room-relative snap | Player prior share relative to same-team position room | Explicit missing/history flags | v4+ |
| snap stability | Shifted five-game standard deviation plus season/career priors | Requires at least two observed games | SNAP-first research |
| projected next-game snap | Position-aware XGBoost trained only on earlier seasons | Falls back to observed prior snap when no fitted estimate exists | SNAP-first experiment only |

Measured 2018–2025 database coverage after the backfill is 98.81%–99.87% per season. The model-ready data has prior-snap coverage of approximately 96.49%.

## SNAP experiment result

On 2022–2024 model selection rows, next-game snap MAE improved from 12.16 percentage points without snap history to 11.28 with the full leakage-safe family. Starter MAE improved from 11.17 to 10.23; rising/falling-role MAE improved to 14.52/14.62. Feeding projected snap into the hierarchy helped less than retaining the complete historical SNAP family directly.

The best 60% v3.3.2 / 40% SNAP-persistence hierarchy scored MAE 4.2880, RMSE 5.9768, and Spearman 0.7011 across 22,955 validation rows. It remains experimental because it still suppressed 33 stable high-snap current starters by more than 1.5 PPR points. Production therefore remains v3.3.2.

## Missing and unsupported data

- Reliable complete routes-run history is not available across the training window. Snaps are not labeled or treated as routes.
- Official game-day inactive information published inside the 24-hour cutoff is excluded from the 24-hour model. A future 90-minute model must be trained and labeled separately.
- Missing injury, depth, SNAP, or role evidence is represented as missing/unknown, not as poor performance or zero usage.
- Direct PPR, component PPR, team opportunity budgets, and reconciled final PPR remain separately auditable.
