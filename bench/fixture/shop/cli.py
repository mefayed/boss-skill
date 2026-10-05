"""Command line entry point: python3 -m shop.cli --data DIR <command>."""

import argparse
import os
import sys

from . import report, storage
from .errors import ShopError


def build_parser():
    """Argument parser for the CLI."""
    parser = argparse.ArgumentParser(prog="shop")
    parser.add_argument("--data", default=".", help="directory holding catalog.json, orders.json, inventory.json")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("stock", help="units on hand per SKU")
    rep = sub.add_parser("report", help="sales summary over paid orders")
    rep.add_argument("--csv", action="store_true", help="CSV instead of text")
    return parser


def cmd_stock(args, out):
    catalog = storage.load_catalog(os.path.join(args.data, "catalog.json"))
    inventory = storage.load_inventory(os.path.join(args.data, "inventory.json"))
    for sku in sorted(catalog):
        out.write("%-8s %-20s %5d\n" % (sku, catalog[sku].name, inventory.on_hand.get(sku, 0)))


def cmd_report(args, out):
    catalog = storage.load_catalog(os.path.join(args.data, "catalog.json"))
    orders = storage.load_orders(os.path.join(args.data, "orders.json"))
    summary = report.sales_summary(orders)
    out.write(report.render_csv(summary, catalog) if args.csv else report.render_text(summary, catalog))


def main(argv=None, out=None):
    """Run the CLI; returns the exit code."""
    out = out or sys.stdout
    args = build_parser().parse_args(argv)
    try:
        {"stock": cmd_stock, "report": cmd_report}[args.command](args, out)
    except ShopError as e:
        sys.stderr.write("error: %s\n" % e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
