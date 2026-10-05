import unittest

from shop.errors import ShopError
from shop.money import fmt_cents, parse_money, percent_of


class MoneyTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(parse_money("12.34"), 1234)
        self.assertEqual(parse_money("12"), 1200)
        self.assertEqual(parse_money("0.5"), 50)
        self.assertEqual(parse_money("-1.05"), -105)

    def test_parse_rejects_garbage(self):
        for bad in ["", "abc", "1.234", "1.x"]:
            with self.assertRaises(ShopError):
                parse_money(bad)

    def test_format(self):
        self.assertEqual(fmt_cents(1234), "12.34")
        self.assertEqual(fmt_cents(5), "0.05")
        self.assertEqual(fmt_cents(-50), "-0.50")

    def test_percent_of_rounds_half_up(self):
        self.assertEqual(percent_of(1000, 10), 100)
        self.assertEqual(percent_of(10788, 10), 1079)
        self.assertEqual(percent_of(5, 10), 1)
