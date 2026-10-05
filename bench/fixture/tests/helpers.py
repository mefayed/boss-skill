"""Shared test fixtures."""

from shop.inventory import Inventory
from shop.models import Product
from shop.orders import OrderService


def make_catalog():
    return {
        "MUG-01": Product("MUG-01", "Enamel mug", 1250, category="kitchen"),
        "TEA-02": Product("TEA-02", "Loose leaf tea 100g", 899, category="pantry"),
        "PEN-03": Product("PEN-03", "Brass pen", 2400),
    }


def make_service(stock=None):
    inventory = Inventory(stock or {"MUG-01": 40, "TEA-02": 120, "PEN-03": 15})
    return OrderService(make_catalog(), inventory)
