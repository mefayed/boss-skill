import json
import os
import tempfile
import unittest

from shop import storage
from shop.errors import StorageError
from shop.inventory import Inventory
from tests.helpers import make_catalog, make_service


class StorageTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def path(self, name):
        return os.path.join(self.dir.name, name)

    def test_catalog_round_trip(self):
        storage.save_catalog(self.path("c.json"), make_catalog())
        loaded = storage.load_catalog(self.path("c.json"))
        self.assertEqual(loaded, make_catalog())

    def test_old_catalog_without_category_loads(self):
        with open(self.path("c.json"), "w") as f:
            json.dump([{"sku": "A", "name": "Thing", "price_cents": 100}], f)
        self.assertIsNone(storage.load_catalog(self.path("c.json"))["A"].category)

    def test_orders_round_trip(self):
        svc = make_service()
        order = svc.create_order("ada", "2026-01-01")
        svc.add_item(order.id, "TEA-02", 12)
        svc.checkout(order.id)
        storage.save_orders(self.path("o.json"), [order])
        self.assertEqual(storage.load_orders(self.path("o.json")), [order])

    def test_inventory_round_trip(self):
        storage.save_inventory(self.path("i.json"), Inventory({"A": 3}, {"A": 1}))
        self.assertEqual(storage.load_inventory(self.path("i.json")).available("A"), 2)

    def test_bad_file(self):
        with open(self.path("bad.json"), "w") as f:
            f.write("{nope")
        with self.assertRaises(StorageError):
            storage.load_orders(self.path("bad.json"))
        with self.assertRaises(StorageError):
            storage.load_catalog(self.path("missing.json"))
