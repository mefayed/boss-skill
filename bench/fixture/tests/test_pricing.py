import unittest

from shop.models import LineItem, Order
from shop.pricing import line_total, order_total


class PricingTest(unittest.TestCase):
    def test_no_discount_below_threshold(self):
        self.assertEqual(line_total(LineItem("A", 9, 100)), 900)

    def test_bulk_discount(self):
        self.assertEqual(line_total(LineItem("A", 10, 100)), 900)
        self.assertEqual(line_total(LineItem("A", 12, 899)), 9709)

    def test_order_total(self):
        order = Order("o1", "ada", "2026-01-01", [LineItem("A", 2, 1250), LineItem("B", 1, 899)])
        self.assertEqual(order_total(order), 3399)
