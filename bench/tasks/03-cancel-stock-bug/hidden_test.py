import unittest

from shop.inventory import Inventory
from shop.models import Product
from shop.orders import OrderService


def service():
    catalog = {"PEN-03": Product("PEN-03", "Brass pen", 2400)}
    return OrderService(catalog, Inventory({"PEN-03": 15}))


class CancelReleasesStockTest(unittest.TestCase):
    def test_cancelled_order_gives_stock_back(self):
        svc = service()
        first = svc.create_order("ada", "2026-01-01")
        svc.add_item(first.id, "PEN-03", 15)
        svc.cancel(first.id)
        self.assertEqual(svc.inventory.available("PEN-03"), 15)
        second = svc.create_order("lin", "2026-01-02")
        svc.add_item(second.id, "PEN-03", 15)
        svc.checkout(second.id)
        self.assertEqual(svc.inventory.on_hand["PEN-03"], 0)

    def test_many_cancels_do_not_leak(self):
        svc = service()
        for i in range(5):
            order = svc.create_order("c%d" % i, "2026-01-01")
            svc.add_item(order.id, "PEN-03", 10)
            svc.cancel(order.id)
        self.assertEqual(svc.inventory.available("PEN-03"), 15)
        self.assertEqual(svc.inventory.on_hand["PEN-03"], 15)
