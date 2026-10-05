"""Plain-text receipts for paid orders."""

from .errors import OrderStateError
from .money import fmt_cents
from .pricing import line_total


def render_receipt(order, catalog):
    """Receipt text for a paid order."""
    if order.status != "paid":
        raise OrderStateError("order %s is %s" % (order.id, order.status))
    lines = ["Order %s  %s  %s" % (order.id, order.created_at, order.customer)]
    for item in order.items:
        name = catalog[item.sku].name if item.sku in catalog else item.sku
        lines.append("%3d x %-20s @ %8s  %10s" % (
            item.quantity, name, fmt_cents(item.unit_price_cents), fmt_cents(line_total(item))))
    lines.append("Total: %s" % fmt_cents(order.total_cents))
    return "\n".join(lines) + "\n"
