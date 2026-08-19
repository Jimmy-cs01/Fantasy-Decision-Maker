# Model v4 historical pregame data audit

Prediction policy: a weekly feature must be observable at least 24 hours before the scheduled kickoff. Records without a trustworthy observation timestamp may be used only when the source is explicitly a pregame weekly publication. Game-week snaps, participation, and box-score/PBP outcomes are always shifted to a prior game.

| Source | Coverage/granularity | Useful fields | Pregame use | Join | License/access | Decision |
|---|---|---|---|---|---|---|
| nflverse `weekly_rosters` | 2002+, player/week | team, roster status, position, IDs, experience, draft number | Weekly roster snapshot; accepted as that week's assignment/status | GSIS plus Sleeper/PFR crosswalks | Public GitHub release; NFL Shield v2-derived | Imported for 2018–2025 |
| nflverse `injuries` | 2009+, player/week with `date_modified` | report status, practice status, injuries | Only records with `date_modified <= kickoff - 24h` | GSIS | Public nflverse release | Imported for 2018–2025 |
| nflverse `depth_charts` | 2001+, weekly/date-oriented | formation, position, depth rank | Weekly pregame publication; missing remains explicit | GSIS | Public nflverse release | Imported for 2018–2025; refreshed for 2026 |
| nflverse PFR snap counts | 2012+, player/game | offensive snaps, team snaps, percentage | Prior games only; Week N never predicts Week N | PFR→GSIS mapping | Public nflverse release; PFR-derived | Already integrated and shifted |
| nflverse PBP | 1999+, play-level | usage, designed rush/scramble, game script, red zone | Prior games only | GSIS | CC BY 4.0 | Already integrated for 2018–2025 |
| nflverse participation | 2016+, but completeness/source changes by season | players on field, formations | Prior games only; not suitable as a complete historical route source | GSIS/PBP IDs | NGS/FTN; recent FTN data CC BY-SA 4.0 | Rejected for route features because coverage is not uniform |
| nflverse trades | 2010+, transaction date | trade date and teams | Usable before kickoff, but player join is primarily PFR and covers trades only | PFR→GSIS | Public nflverse/nfldata release | Audited; weekly roster snapshots are broader and preferred |
| Sleeper player API | Current snapshot | current team, status, depth metadata, Sleeper ID | Current inference only; no trustworthy historical snapshot archive | Sleeper↔GSIS canonical identity | Public read-only API | Current fallback only; never historical training |
| Pro Football Reference direct scraping | Various | snaps, starters, injuries | Timestamp/reproducibility varies | PFR | Site terms and scraper fragility | Rejected; use nflverse's structured releases instead |
| Paid injury/roster APIs | Provider-dependent | timestamped transactions/inactives/practice | Potentially strong | Provider IDs | Requires credentials/license not present | Not used |
| Kaggle/community snapshots | Dataset-dependent | possible injury/depth history | Provenance and timestamp risk | Usually names | Unclear | Rejected unless a specific dataset proves provenance |

## Measured local coverage

The `pregame_role_state_v1` build contains 45,580 player-weeks from 2018–2025:

- weekly roster coverage: 99.8728%
- depth-chart coverage: 81.3449%
- pre-cutoff injury-record coverage: 15.0022%
- canonical team conflicts after stable-ID resolution: 0
- logical duplicate rows: 0
- observed team changes: 1,168

Injury coverage is the percentage of all fantasy-player weeks with an injury/practice record, not the source's completeness for injured players. A missing injury record remains “not observed”; it is not encoded as confirmed healthy.

## Leakage boundaries

- The target week's PBP, snaps, and participation are forbidden.
- Injury updates after the 24-hour cutoff are forbidden.
- A transaction or team assignment must be effective in the weekly roster snapshot before the predicted game.
- Current Sleeper data is forbidden in historical rows.
- Missing depth, injury, practice, and roster states have separate availability indicators.
- Names are never used as model identity when GSIS is available.
