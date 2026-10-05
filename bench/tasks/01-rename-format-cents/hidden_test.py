import os
import unittest

from shop import money
from shop.models import LineItem, Order, Product
from shop.receipt import render_receipt
from shop.report import render_text, sales_summary

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD = "fmt" + "_cents"


class RenameTest(unittest.TestCase):
    def test_new_name(self):
        self.assertEqual(money.format_cents(1234), "12.34")
        self.assertEqual(money.format_cents(-50), "-0.50")

    def test_old_name_gone(self):
        self.assertFalse(hasattr(money, OLD))
        leftovers = []
        for sub in ("shop", "tests"):
            for dirpath, _, files in os.walk(os.path.join(ROOT, sub)):
                for name in files:
                    path = os.path.join(dirpath, name)
                    if name.endswith(".py") and os.path.abspath(path) != os.path.abspath(__file__):
                        with open(path) as f:
                            if OLD in f.read():
                                leftovers.append(path)
        self.assertEqual(leftovers, [])

    def test_callers_still_work(self):
        catalog = {"A": Product("A", "Thing", 1250)}
        order = Order("o1", "ada", "2026-01-01", [LineItem("A", 2, 1250)], "paid", 2500)
        self.assertIn("Total: 25.00", render_receipt(order, catalog))
        self.assertIn("Revenue: 25.00", render_text(sales_summary([order]), catalog))
