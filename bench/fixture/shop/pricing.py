"""Line and order totals. Lines of BULK_THRESHOLD or more units get BULK_PERCENT off."""

from .money import percent_of

BULK_THRESHOLD = 10
BULK_PERCENT = 10


def line_total(item):
    """Total for one line in cents, bulk discount applied."""
    subtotal = item.unit_price_cents * item.quantity
    if item.quantity >= BULK_THRESHOLD:
        subtotal -= percent_of(subtotal, BULK_PERCENT)
    return subtotal


def order_total(order):
    """Sum of line totals in cents."""
    return sum(line_total(item) for item in order.items)
