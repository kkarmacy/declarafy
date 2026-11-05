import os
import unittest
from unittest.mock import patch

from openharness_runner import _enabled


class RunnerGateTests(unittest.TestCase):
    def test_runner_is_disabled_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(_enabled())

    def test_runner_requires_both_independent_flags(self):
        with patch.dict(os.environ, {"OPENHARNESS_RUNNER_ENABLED": "1"}, clear=True):
            self.assertFalse(_enabled())
        with patch.dict(os.environ, {"OPENHARNESS_EXECUTION_ENABLED": "1"}, clear=True):
            self.assertFalse(_enabled())

    def test_runner_requires_both_flags_explicitly_enabled(self):
        with patch.dict(os.environ, {
            "OPENHARNESS_RUNNER_ENABLED": "1",
            "OPENHARNESS_EXECUTION_ENABLED": "1",
        }, clear=True):
            self.assertTrue(_enabled())
