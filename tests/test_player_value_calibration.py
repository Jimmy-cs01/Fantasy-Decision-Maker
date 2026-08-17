import json
import unittest

from scripts import calibrate_player_values as calibration


class PlayerValueCalibrationTests(unittest.TestCase):
    def test_generic_historical_reference_is_not_a_player_anchor(self):
        settings = json.loads(calibration.CALIBRATION_PATH.read_text())
        self.assertNotIn("cmc2019", settings)
        self.assertAlmostEqual(calibration.value(315, settings), 49.0, places=1)

    def test_value_soft_floor_tail_and_tiers_are_deterministic(self):
        settings = json.loads(calibration.CALIBRATION_PATH.read_text())
        self.assertGreater(calibration.value(-1, settings), 0.0)
        self.assertEqual(calibration.value(-10_000, settings), 0.0)
        self.assertGreater(calibration.value(450, settings), 50)
        self.assertLessEqual(calibration.value(10_000, settings), 55)
        self.assertEqual(calibration.tier(42), "Elite Fantasy Asset")
        self.assertEqual(calibration.tier(4), "Bench Value")

    def test_display_calibration_is_monotonic(self):
        settings = json.loads(calibration.CALIBRATION_PATH.read_text())
        values = [calibration.value(raw, settings) for raw in [-500, -100, 0, 50, 150, 315, 500]]
        self.assertEqual(values, sorted(values))


if __name__ == "__main__":
    unittest.main()
