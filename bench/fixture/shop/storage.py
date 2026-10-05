"""JSON files for the catalog, orders and inventory."""

import json

from .errors import StorageError
from .inventory import Inventory
from .models import LineItem, Order, Product


def _read(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        raise StorageError("%s: %s" % (path, e)) from None


def _write(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")


def load_catalog(path):
    """Return {sku: Product}."""
    return {
        p["sku"]: Product(p["sku"], p["name"], p["price_cents"], category=p.get("category"))
        for p in _read(path)
    }


def save_catalog(path, catalog):
    """Write {sku: Product} to path."""
    _write(path, [
        {"sku": p.sku, "name": p.name, "price_cents": p.price_cents, "category": p.category}
        for p in catalog.values()
    ])


def load_orders(path):
    """Return a list of Order."""
    orders = []
    for o in _read(path):
        items = [LineItem(i["sku"], i["quantity"], i["unit_price_cents"]) for i in o["items"]]
        orders.append(Order(o["id"], o["customer"], o["created_at"], items, o["status"], o["total_cents"]))
    return orders


def save_orders(path, orders):
    """Write a list of Order to path."""
    _write(path, [
        {
            "id": o.id,
            "customer": o.customer,
            "created_at": o.created_at,
            "items": [
                {"sku": i.sku, "quantity": i.quantity, "unit_price_cents": i.unit_price_cents}
                for i in o.items
            ],
            "status": o.status,
            "total_cents": o.total_cents,
        }
        for o in orders
    ])


def load_inventory(path):
    """Return an Inventory."""
    return Inventory.from_dict(_read(path))


def save_inventory(path, inventory):
    """Write an Inventory to path."""
    _write(path, inventory.to_dict())
