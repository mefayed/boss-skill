"""Money helpers. Amounts are always int cents."""

from .errors import ShopError


def parse_money(text):
    """Parse '12.34' or '12' into cents."""
    text = text.strip()
    negative = text.startswith("-")
    if negative:
        text = text[1:]
    whole, _, frac = text.partition(".")
    if not whole.isdigit() or (frac and not frac.isdigit()) or len(frac) > 2:
        raise ShopError("not a money amount: %r" % text)
    cents = int(whole) * 100 + int(frac.ljust(2, "0") or 0)
    return -cents if negative else cents


def fmt_cents(cents):
    """Format cents as '12.34'."""
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return "%s%d.%02d" % (sign, cents // 100, cents % 100)


def percent_of(cents, percent):
    """Return percent% of cents, rounded half up to the cent."""
    return (cents * percent + 50) // 100
