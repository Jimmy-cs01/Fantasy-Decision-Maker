# Jimmy GM analytics foundation

## Current production pipeline

Production remains explicitly selected through `ACTIVE_PROJECTION_MODEL_VERSION`; its default is `v2`.

`v2` builds leakage-safe player-week features from prior games, prior seasons, schedule context, age/draft context, and rolling 3/5 windows. Position-specific XGBoost models predict PPR and stat components. The saved PPR residual distribution supplies the displayed floor/ceiling offsets. Current projections then pass through opportunity and Vegas reconciliation before `final_projection_ppr` is consumed by Player Value, Trade Finder, Start / Sit, and Season Outlook.

The experimental v3 family adds play-by-play opportunity, explicit opportunity-before-efficiency components, depth/role confidence, snap context, team opportunity budgets, TD-opportunity modeling, and exact component scoring. The intended hierarchy is:

```text
pregame game/team context
  -> team volume budgets
  -> player role and opportunity shares
  -> sample-shrunk efficiency and TD conversion
  -> coherent fantasy components
  -> exact PPR score
  -> independent Vegas arbitration
```

The current v3.3 inference artifact is not safe to promote: its non-refilling role-weighted team allocation can discard opportunity and produced a 14.7-attempt, 7.27-PPG Lamar Jackson projection. The v3.3.1 repair applies current-team context before allocation, refills Week 1 budgets, uses robust Week 1 team context, and gates QBs using current depth roles. It is still experimental.

## Permanent evaluation commands

- `npm run model:scoreboard` writes a chronological, model-comparable scoreboard to `data/processed/projection_evaluation_scoreboard.json`.
- `npm run model:sanity-scoreboard` audits current projections for component, volume, depth, team, and QB failures.
- `npm run model:v3.3.1:compare` generates a local-only current-player v3.3.1 comparison. It performs no Supabase or production writes.
- `npm run value:calibrate` reports current and historical Player Value calibration.
- `npm run value:archetypes` reports production/future decomposition for representative young-player profiles.

The projection scoreboard includes MAE, RMSE, median absolute error, bias, Pearson, Spearman, R², catastrophic miss rates, position metrics, weekly top-player capture, same-position start/sit accuracy/regret, objective role-change slices, expanding-window quantile calibration, and confidence-bucket audits. Every learned calibration uses prior validation seasons only.

## Uncertainty and confidence

Floor/ceiling are residual quantiles, not direct quantile models. Expanding-window checks determine whether those offsets are calibrated. Because fantasy outcomes contain a large point mass at zero, the report includes both strict and inclusive quantile frequencies.

The legacy High/Medium/Low heuristic is retained in production for compatibility, but the scoreboard separately evaluates it. The experimental replacement estimates expected absolute error from pregame position, projection, history, and role-stability cells fitted only on prior folds, then assigns confidence by risk tercile. It must be promoted separately after UI and inference integration are validated.

## Player Value components

The displayed value remains backward compatible, but the result now exposes separate concepts:

- `productionValue`: projected distribution, ROS games, dynamic league replacement, scarcity, and opportunity confidence.
- `fundamentalValue`: production plus bounded age, draft-capital, current-role, and proven historical-ceiling context.
- `futureAssetAdjustment`: fundamental minus production.
- `marketValue`: nullable and intentionally absent until an independent, licensed market source exists.
- `jimmyEdge`: nullable fundamental-minus-market comparison.

Age/draft adjustments never alter projected fantasy points. League replacement is calculated from teams, starting slots, FLEX/SUPERFLEX, and bench demand, with a generic fallback when no league is selected. Trade Finder's existing lineup optimization remains the roster-specific marginal-value layer.

## Promotion policy

An experimental model cannot become active from `generated_at`. Promotion requires explicit active-model selection and must pass chronological accuracy, catastrophic misses, role-change performance, calibrated uncertainty, exact component scoring, team opportunity coherence, missing-data safety, and current-player football sanity. A severe unresolved warning blocks promotion even when MAE improves.
