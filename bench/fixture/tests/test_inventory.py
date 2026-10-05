import unittest

from shop.errors import OutOfStock
from shop.inventory import Inventory


class InventoryTest(unittest.TestCase):
    def test_reserve_and_release(self):
        inv = Inventory({"A": 5})
        inv.reserve("A", 3)
        self.assertEqual(inv.available("A"), 2)
        inv.release("A", 3)
        self.assertEqual(inv.available("A"), 5)

    def test_reserve_too_many(self):
        inv = Inventory({"A": 2})
        with self.assertRaises(OutOfStock):
            inv.reserve("A", 3)

    def test_commit_takes_units_off_the_shelf(self):
        inv = Inventory({"A": 5})
        inv.reserve("A", 2)
        inv.commit("A", 2)
        self.assertEqual(inv.on_hand["A"], 3)
        self.assertEqual(inv.available("A"), 3)

    def test_round_trip(self):
        inv = Inventory({"A": 5}, {"A": 1})
        self.assertEqual(Inventory.from_dict(inv.to_dict()).available("A"), 4)
