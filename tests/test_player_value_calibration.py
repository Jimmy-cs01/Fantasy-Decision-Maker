import json
import unittest

from scripts import calibrate_player_values as calibration


class PlayerValueCalibrationTests(unittest.TestCase):
    def test_historical_cmc_fixture_is_the_permanent_scale(self):
        settings = json.loads(calibration.CALIBRATION_PATH.read_text())
        benchmark = calibration.cmc_raw(settings)
        self.assertAlmostEqual(benchmark, 315.228, places=3)
        self.assertEqual(calibration.value(benchmark, benchmark, anchor=True), 100.0)
        self.assertEqual(calibration.value(benchmark, benchmark), 99.9)

    def test_value_clamps_and_tiers_are_deterministic(self):
        self.assertEqual(calibration.value(-1, 315), 0.0)
        self.assertEqual(calibration.value(10_000, 315), 99.9)
        self.assertEqual(calibration.tier(84), "Elite Fantasy Asset")
        self.assertEqual(calibration.tier(4), "Replacement / Waiver")

    def test_display_calibration_is_monotonic_and_expands_the_middle(self):
        benchmark = 315.228
        self.assertGreater(calibration.value(benchmark * 0.25, benchmark), 25)
        self.assertLess(
            calibration.value(benchmark * 0.1, benchmark),
            calibration.value(benchmark * 0.25, benchmark),
        )


if __name__ == "__main__":
    unittest.main()
