import os
import tempfile
import unittest

from shop import storage
from shop.errors import ShopError
from shop.inventory import Inventory
from shop.models import Product
from shop.orders import OrderService
from shop.report import sales_summary

try:
    from shop.errors import RefundError
except ImportError:  # keeps the other tests running so the failure is readable
    RefundError = None


def catalog():
    return {
        "TEA-02": Product("TEA-02", "Loose leaf tea 100g", 899),
        "MUG-01": Product("MUG-01", "Enamel mug", 1250),
    }


def paid_order(svc, sku="TEA-02", quantity=10):
    order = svc.create_order("ada", "2026-01-01")
    svc.add_item(order.id, sku, quantity)
    svc.checkout(order.id)
    return order


def service():
    return OrderService(catalog(), Inventory({"TEA-02": 120, "MUG-01": 40}))


LINE_TOTAL = 8091  # 10 x 899 = 8990, minus 10% bulk discount (899)


class RefundTest(unittest.TestCase):
    def test_error_type(self):
        self.assertIsNotNone(RefundError, "shop.errors.RefundError is missing")
        self.assertTrue(issubclass(RefundError, ShopError))

    def test_partial_refunds_add_up_exactly(self):
        svc = service()
        order = paid_order(svc)
        self.assertEqual(order.total_cents, LINE_TOTAL)
        amounts = [svc.refund(order.id, "TEA-02", q) for q in (3, 3, 4)]
        self.assertEqual(sum(amounts), LINE_TOTAL)
        for q, amount in zip((3, 3, 4), amounts):
            self.assertTrue(isinstance(amount, int))
            self.assertLess(abs(amount - LINE_TOTAL * q / 10), 1, amounts)

    def test_units_go_back_on_the_shelf(self):
        svc = service()
        order = paid_order(svc)
        self.assertEqual(svc.inventory.on_hand["TEA-02"], 110)
        svc.refund(order.id, "TEA-02", 3)
        self.assertEqual(svc.inventory.on_hand["TEA-02"], 113)
        self.assertEqual(svc.inventory.available("TEA-02"), 113)

    def test_cannot_over_refund(self):
        svc = service()
        order = paid_order(svc)
        svc.refund(order.id, "TEA-02", 3)
        with self.assertRaises(RefundError or Exception):
            svc.refund(order.id, "TEA-02", 8)
        self.assertEqual(svc.inventory.on_hand["TEA-02"], 113)
        svc.refund(order.id, "TEA-02", 7)
        with self.assertRaises(RefundError or Exception):
            svc.refund(order.id, "TEA-02", 1)

    def test_only_paid_orders(self):
        svc = service()
        open_order = svc.create_order("ada", "2026-01-01")
        svc.add_item(open_order.id, "TEA-02", 2)
        with self.assertRaises(RefundError or Exception):
            svc.refund(open_order.id, "TEA-02", 1)
        svc.cancel(open_order.id)
        with self.assertRaises(RefundError or Exception):
            svc.refund(open_order.id, "TEA-02", 1)

    def test_refunds_survive_save_and_load(self):
        svc = service()
        order = paid_order(svc)
        first = svc.refund(order.id, "TEA-02", 3)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "orders.json")
            storage.save_orders(path, list(svc.orders.values()))
            loaded = storage.load_orders(path)
        svc2 = OrderService(catalog(), Inventory({"TEA-02": 113, "MUG-01": 40}), loaded)
        with self.assertRaises(RefundError or Exception):
            svc2.refund(order.id, "TEA-02", 8)
        rest = svc2.refund(order.id, "TEA-02", 7)
        self.assertEqual(first + rest, LINE_TOTAL)

    def test_report_is_net_of_refunds(self):
        svc = service()
        order = paid_order(svc)
        other = paid_order(svc, "MUG-01", 2)
        first = svc.refund(order.id, "TEA-02", 3)
        s = sales_summary(list(svc.orders.values()))
        self.assertEqual(s["units"], 7 + 2)
        self.assertEqual(s["revenue_cents"], LINE_TOTAL - first + 2500)
        self.assertEqual(s["by_sku"]["TEA-02"]["units"], 7)
        self.assertEqual(s["by_sku"]["TEA-02"]["revenue_cents"], LINE_TOTAL - first)
        self.assertEqual(s["by_sku"]["MUG-01"]["units"], 2)
        self.assertEqual(s["by_sku"]["MUG-01"]["revenue_cents"], 2500)
        svc.refund(order.id, "TEA-02", 7)
        s = sales_summary(list(svc.orders.values()))
        self.assertEqual(s["revenue_cents"], 2500)
        self.assertEqual(s["units"], 2)
        self.assertEqual(other.total_cents, 2500)
