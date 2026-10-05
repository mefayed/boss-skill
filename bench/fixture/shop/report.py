"""Sales summary over paid orders, as text or CSV."""

import csv
import io

from .money import fmt_cents
from .pricing import line_total


def sales_summary(orders):
    """Totals over paid orders: order count, units, revenue, and per-SKU units/revenue."""
    summary = {"orders": 0, "units": 0, "revenue_cents": 0, "by_sku": {}}
    for order in orders:
        if order.status != "paid":
            continue
        summary["orders"] += 1
        for item in order.items:
            row = summary["by_sku"].setdefault(item.sku, {"units": 0, "revenue_cents": 0})
            amount = line_total(item)
            row["units"] += item.quantity
            row["revenue_cents"] += amount
            summary["units"] += item.quantity
            summary["revenue_cents"] += amount
    return summary


def render_text(summary, catalog):
    """Human-readable report."""
    lines = [
        "Orders: %d" % summary["orders"],
        "Units: %d" % summary["units"],
        "Revenue: %s" % fmt_cents(summary["revenue_cents"]),
    ]
    for sku in sorted(summary["by_sku"]):
        row = summary["by_sku"][sku]
        name = catalog[sku].name if sku in catalog else sku
        lines.append("  %-8s %-20s %4d  %10s" % (sku, name, row["units"], fmt_cents(row["revenue_cents"])))
    return "\n".join(lines) + "\n"


def render_csv(summary, catalog):
    """CSV with one row per SKU."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(["sku", "name", "category", "units", "revenue"])
    for sku in sorted(summary["by_sku"]):
        row = summary["by_sku"][sku]
        product = catalog.get(sku)
        writer.writerow([
            sku,
            product.name if product else "",
            (product.category or "") if product else "",
            row["units"],
            fmt_cents(row["revenue_cents"]),
        ])
    return out.getvalue()
