import unittest

from shop.errors import OrderStateError, OutOfStock, UnknownOrder, UnknownProduct
from tests.helpers import make_service


class OrdersTest(unittest.TestCase):
    def test_add_item_reserves_stock(self):
        svc = make_service()
        order = svc.create_order("ada", "2026-01-01")
        svc.add_item(order.id, "PEN-03", 4)
        svc.add_item(order.id, "PEN-03", 1)
        self.assertEqual(order.items[0].quantity, 5)
        self.assertEqual(svc.inventory.available("PEN-03"), 10)

    def test_remove_item_releases_stock(self):
        svc = make_service()
        order = svc.create_order("ada", "2026-01-01")
        svc.add_item(order.id, "PEN-03", 4)
        svc.remove_item(order.id, "PEN-03")
        self.assertEqual(svc.inventory.available("PEN-03"), 15)
        self.assertEqual(order.items, [])

    def test_checkout_commits_and_totals(self):
        svc = make_service()
        order = svc.create_order("ada", "2026-01-01")
        svc.add_item(order.id, "TEA-02", 12)
        svc.checkout(order.id)
        self.assertEqual(order.status, "paid")
        self.assertEqual(order.total_cents, 9709)
        self.assertEqual(svc.inventory.on_hand["TEA-02"], 108)

    def test_out_of_stock(self):
        svc = make_service()
        order = svc.create_order("ada", "2026-01-01")
        with self.assertRaises(OutOfStock):
            svc.add_item(order.id, "PEN-03", 16)

    def test_cancel_marks_cancelled(self):
        svc = make_service()
        order = svc.create_order("ada", "2026-01-01")
        svc.cancel(order.id)
        self.assertEqual(order.status, "cancelled")

    def test_paid_order_is_frozen(self):
        svc = make_service()
        order = svc.create_order("ada", "2026-01-01")
        svc.add_item(order.id, "MUG-01", 1)
        svc.checkout(order.id)
        with self.assertRaises(OrderStateError):
            svc.add_item(order.id, "MUG-01", 1)
        with self.assertRaises(OrderStateError):
            svc.cancel(order.id)

    def test_unknowns(self):
        svc = make_service()
        with self.assertRaises(UnknownOrder):
            svc.get("nope")
        order = svc.create_order("ada", "2026-01-01")
        with self.assertRaises(UnknownProduct):
            svc.add_item(order.id, "NOPE", 1)
