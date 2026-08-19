# Model v4.1 pregame availability audit

## Cutoff and source policy

All model features use a standardized cutoff 24 hours before kickoff. The local
foundation uses nflverse weekly rosters, depth charts, and injury reports, joined
through GSIS identifiers. Weekly roster `INA` status is retained as an audit event
but excluded from the 24-hour feature set because its publication time cannot be
proven before cutoff.

The source review found no stable, freely redistributable structured archive that
provides official game-day inactive lists, practice-squad elevations, and starter
transactions with both GSIS identity and event timestamps across 2018–2025.
nflverse weekly rosters are available from 2002 and injuries/depth data are useful,
but the transaction dataset requested in nflverse-data remains an open feature
request. Official game-day inactive lists are generally published after the 24-hour
cutoff and therefore belong in a separate future 90-minute model, not this dataset.

## Normalized data

`player_week_availability_events_v4_1.csv.gz` is a long event audit table.
`player_week_availability_v4_1.csv.gz` is a full-roster feature panel. It contains
112,907 player-weeks and 127,560 events for 2018–2025, with zero duplicate logical
keys. It explicitly distinguishes known pre-cutoff absence, structural roster
unavailability, missing evidence, and game-day-only status.

Derived features include prior-only vacated rush/target share, active room size,
top competitor absence, starter-ahead absence, team change, return from reserve,
depth movement, and a probabilistic starter transition signal.

## Findings

Availability features reduced chronological opportunity-share-change MAE from
0.068516 to 0.062011. Large-rise recall increased from 0.002825 to 0.105327, but
precision was only 0.486940 for the regression threshold and rising-class precision
was 0.338692. This supports a continuous model feature, not a hard override.

The best historical forecast was the frozen 60% v3.3.2 / 40% v4.1 starter ensemble:
MAE 4.2923, RMSE 5.9823, Spearman 0.7000. It eliminated historical target/pass
coherence violations. Current inference nevertheless suppressed 56 starters by
more than 1.5 PPG, including multiple stable elite players. Public 24-hour evidence
did not explain those reductions, so promotion is blocked.

Production remains v3.3.2. No remote data, environment, or deployment changes were
made.
