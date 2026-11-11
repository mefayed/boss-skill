import contextlib
import io
import json
import os
import shutil
import tempfile
import unittest

from shop.cli import main

EXAMPLES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "examples")


class RestockTest(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.data = os.path.join(d.name, "data")
        shutil.copytree(EXAMPLES, self.data)
        self.inv_path = os.path.join(self.data, "inventory.json")

    def inventory_text(self):
        with open(self.inv_path) as f:
            return f.read()

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stderr(err):
            try:
                code = main(["--data", self.data] + list(argv), out=out)
            except SystemExit as e:
                code = e.code
        return code, out.getvalue(), err.getvalue()

    def test_restock_then_stock_shows_20(self):
        rc, _, _ = self.run_cli("restock", "PEN-03", "5")
        self.assertEqual(rc, 0, "restock command did not exit 0")
        _, out, _ = self.run_cli("stock")
        line = [l for l in out.splitlines() if "PEN-03" in l][0]
        self.assertTrue(line.rstrip().endswith("20"), "stock after restock did not end in 20")

    def test_inventory_file_updated(self):
        self.run_cli("restock", "PEN-03", "5")
        on_hand = json.loads(self.inventory_text())["on_hand"]
        self.assertEqual(on_hand["PEN-03"], 20, "inventory file did not end with PEN-03 at 20")

    def test_unknown_sku_errors(self):
        before = self.inventory_text()
        rc, _, err = self.run_cli("restock", "NOPE-99", "5")
        self.assertEqual(rc, 1, "unknown SKU did not exit 1")
        self.assertIn("error:", err)
        self.assertNotIn("Traceback", err)
        self.assertEqual(self.inventory_text(), before, "unknown SKU changed the inventory file")

    def test_qty_below_one_errors(self):
        before = self.inventory_text()
        rc, _, err = self.run_cli("restock", "PEN-03", "0")
        self.assertNotIn(rc, (0, None), "quantity 0 did not fail")
        self.assertNotIn("Traceback", err)
        self.assertEqual(self.inventory_text(), before, "quantity 0 changed the inventory file")
