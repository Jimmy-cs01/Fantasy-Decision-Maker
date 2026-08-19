from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
LONG_RATE_PATH = ROOT / "data/processed/nflverse_long_play_rates_2018_2025.csv"
RATE_DENOMINATORS = {
    "receptions_20_29_yards": "receptions",
    "receptions_30_39_yards": "receptions",
    "receptions_40_plus_yards": "receptions",
    "receiving_touchdowns_40_plus_yards": "receiving_touchdowns",
    "receiving_touchdowns_50_plus_yards": "receiving_touchdowns",
    "rushes_40_plus_yards": "rush_attempts",
    "rushing_touchdowns_40_plus_yards": "rushing_touchdowns",
    "rushing_touchdowns_50_plus_yards": "rushing_touchdowns",
    "completions_40_plus_yards": "completions",
    "passing_touchdowns_40_plus_yards": "passing_touchdowns",
    "passing_touchdowns_50_plus_yards": "passing_touchdowns",
}


class LongPlayRateLookup:
    """Completed-season, strongly-shrunk long-play rates for scoring translation."""

    def __init__(self, frame: pd.DataFrame):
        self.by_player = frame.set_index("player_id", drop=False) if not frame.empty else frame
        self.position_rates: dict[str, dict[str, float]] = {}
        for position, rows in frame.groupby("historical_position", dropna=False):
            rates: dict[str, float] = {}
            for event, denominator in RATE_DENOMINATORS.items():
                rates[event] = float(rows[event].sum() / max(float(rows[denominator].sum()), 1.0))
            self.position_rates[str(position)] = rates

    @classmethod
    def load(cls, path: Path = LONG_RATE_PATH) -> "LongPlayRateLookup":
        if not path.exists():
            return cls(pd.DataFrame(columns=["player_id", "historical_position", *RATE_DENOMINATORS]))
        return cls(pd.read_csv(path, dtype={"player_id": "string"}))

    def expected(self, stats: Mapping[str, float], player_id: str, position: str) -> dict[str, float]:
        player: Mapping[str, Any] | None = None
        if not self.by_player.empty and player_id in self.by_player.index:
            selected = self.by_player.loc[player_id]
            player = selected.iloc[0] if isinstance(selected, pd.DataFrame) else selected
        priors = self.position_rates.get(position, {})
        output: dict[str, float] = {}
        for event, denominator in RATE_DENOMINATORS.items():
            rate_name = f"{event}_rate"
            rate = float(player.get(rate_name, priors.get(event, 0)) if player is not None else priors.get(event, 0))
            output[event] = max(0.0, float(stats.get(denominator, 0) or 0) * rate)
        return output
