import json
import os
import tempfile
import unittest

from shop import storage
from shop.models import LineItem, Order, Product
from shop.report import render_csv, sales_summary


class BarcodeTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = os.path.join(self.dir.name, "catalog.json")

    def test_optional_field(self):
        self.assertIsNone(Product("A", "Thing", 100).barcode)
        self.assertEqual(Product("A", "Thing", 100, barcode="4006381333931").barcode, "4006381333931")

    def test_round_trip(self):
        catalog = {
            "A": Product("A", "Thing", 100, category="kitchen", barcode="4006381333931"),
            "B": Product("B", "Other", 200),
        }
        storage.save_catalog(self.path, catalog)
        loaded = storage.load_catalog(self.path)
        self.assertEqual(loaded["A"].barcode, "4006381333931")
        self.assertEqual(loaded["A"].category, "kitchen")
        self.assertIsNone(loaded["B"].barcode)

    def test_old_file_loads(self):
        with open(self.path, "w") as f:
            json.dump([{"sku": "A", "name": "Thing", "price_cents": 100, "category": "kitchen"}], f)
        self.assertIsNone(storage.load_catalog(self.path)["A"].barcode)

    def test_csv_last_column(self):
        catalog = {
            "A": Product("A", "Thing", 100, category="kitchen", barcode="4006381333931"),
            "B": Product("B", "Other", 200),
        }
        order = Order("o1", "ada", "2026-01-01", [LineItem("A", 1, 100), LineItem("B", 1, 200)], "paid", 300)
        lines = render_csv(sales_summary([order]), catalog).splitlines()
        self.assertEqual(lines[0], "sku,name,category,units,revenue,barcode")
        self.assertEqual(lines[1], "A,Thing,kitchen,1,1.00,4006381333931")
        self.assertEqual(lines[2], "B,Other,,1,2.00,")
