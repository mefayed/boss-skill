import unittest

from shop.errors import OrderStateError
from shop.receipt import render_receipt
from tests.helpers import make_catalog, make_service


class ReceiptTest(unittest.TestCase):
    def test_receipt(self):
        svc = make_service()
        order = svc.create_order("ada", "2026-01-01")
        svc.add_item(order.id, "TEA-02", 12)
        svc.checkout(order.id)
        text = render_receipt(order, make_catalog())
        self.assertIn("12 x Loose leaf tea 100g", text)
        self.assertIn("Total: 97.09", text)

    def test_open_order_has_no_receipt(self):
        svc = make_service()
        order = svc.create_order("ada", "2026-01-01")
        with self.assertRaises(OrderStateError):
            render_receipt(order, make_catalog())
