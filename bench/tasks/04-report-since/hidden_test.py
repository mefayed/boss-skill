import contextlib
import io
import json
import os
import tempfile
import unittest

from shop.cli import main

CATALOG = [
    {"sku": "MUG-01", "name": "Enamel mug", "price_cents": 1250, "category": "kitchen"},
    {"sku": "TEA-02", "name": "Loose leaf tea 100g", "price_cents": 899, "category": "pantry"},
]
ORDERS = [
    {"id": "o1", "customer": "ada", "created_at": "2026-02-11", "status": "paid", "total_cents": 3399,
     "items": [{"sku": "MUG-01", "quantity": 2, "unit_price_cents": 1250},
               {"sku": "TEA-02", "quantity": 1, "unit_price_cents": 899}]},
    {"id": "o2", "customer": "lin", "created_at": "2026-03-02", "status": "paid", "total_cents": 9709,
     "items": [{"sku": "TEA-02", "quantity": 12, "unit_price_cents": 899}]},
    {"id": "o3", "customer": "sam", "created_at": "2026-03-05", "status": "cancelled", "total_cents": 0,
     "items": [{"sku": "MUG-01", "quantity": 1, "unit_price_cents": 1250}]},
]


class SinceTest(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.data = d.name
        for name, content in (("catalog.json", CATALOG), ("orders.json", ORDERS),
                              ("inventory.json", {"on_hand": {}, "reserved": {}})):
            with open(os.path.join(self.data, name), "w") as f:
                json.dump(content, f)

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stderr(err):
            try:
                code = main(["--data", self.data, "report"] + list(argv), out=out)
            except SystemExit as e:
                code = e.code
        return code, out.getvalue(), err.getvalue()

    def test_without_since_unchanged(self):
        code, out, _ = self.run_cli()
        self.assertEqual(code, 0)
        self.assertIn("Orders: 2", out)
        self.assertIn("Revenue: 131.08", out)

    def test_since_is_inclusive(self):
        code, out, _ = self.run_cli("--since", "2026-03-02")
        self.assertEqual(code, 0)
        self.assertIn("Orders: 1", out)
        self.assertIn("Units: 12", out)
        self.assertIn("Revenue: 97.09", out)

    def test_since_after_everything(self):
        code, out, _ = self.run_cli("--since", "2026-03-03")
        self.assertEqual(code, 0)
        self.assertIn("Orders: 0", out)
        self.assertIn("Revenue: 0.00", out)

    def test_since_with_csv(self):
        code, out, _ = self.run_cli("--csv", "--since", "2026-03-01")
        self.assertEqual(code, 0)
        lines = out.splitlines()
        self.assertEqual(lines[0], "sku,name,category,units,revenue")
        self.assertEqual(lines[1:], ["TEA-02,Loose leaf tea 100g,pantry,12,97.09"])

    def test_bad_date(self):
        for bad in ("03/01/2026", "2026-13-01", "yesterday"):
            code, _, err = self.run_cli("--since", bad)
            self.assertNotIn(code, (0, None), bad)
            self.assertNotIn("Traceback", err)
            self.assertTrue(err.strip(), "expected an error message for %r" % bad)
