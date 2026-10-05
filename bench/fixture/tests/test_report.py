import unittest

from shop.report import render_csv, render_text, sales_summary
from tests.helpers import make_catalog, make_service


def paid_orders():
    svc = make_service()
    a = svc.create_order("ada", "2026-02-11")
    svc.add_item(a.id, "MUG-01", 2)
    svc.add_item(a.id, "TEA-02", 1)
    svc.checkout(a.id)
    b = svc.create_order("lin", "2026-03-02")
    svc.add_item(b.id, "TEA-02", 12)
    svc.checkout(b.id)
    c = svc.create_order("sam", "2026-03-05")
    svc.add_item(c.id, "PEN-03", 1)
    return list(svc.orders.values())


class ReportTest(unittest.TestCase):
    def test_summary_counts_paid_only(self):
        s = sales_summary(paid_orders())
        self.assertEqual(s["orders"], 2)
        self.assertEqual(s["units"], 15)
        self.assertEqual(s["revenue_cents"], 13108)
        self.assertEqual(s["by_sku"]["TEA-02"], {"units": 13, "revenue_cents": 10608})

    def test_text(self):
        text = render_text(sales_summary(paid_orders()), make_catalog())
        self.assertIn("Revenue: 131.08", text)
        self.assertIn("Enamel mug", text)

    def test_csv(self):
        lines = render_csv(sales_summary(paid_orders()), make_catalog()).splitlines()
        self.assertEqual(lines[0], "sku,name,category,units,revenue")
        self.assertEqual(lines[1], "MUG-01,Enamel mug,kitchen,2,25.00")
