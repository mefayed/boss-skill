"""Stock on hand and reservations held by open orders."""

from .errors import OutOfStock, ShopError


class Inventory:
    def __init__(self, on_hand=None, reserved=None):
        self.on_hand = dict(on_hand or {})
        self.reserved = dict(reserved or {})

    def available(self, sku):
        """Units that can still be reserved."""
        return self.on_hand.get(sku, 0) - self.reserved.get(sku, 0)

    def add_stock(self, sku, quantity):
        """Put quantity units on the shelf."""
        if quantity <= 0:
            raise ShopError("quantity must be positive")
        self.on_hand[sku] = self.on_hand.get(sku, 0) + quantity

    def reserve(self, sku, quantity):
        """Hold quantity units for an open order."""
        if quantity > self.available(sku):
            raise OutOfStock("%s: want %d, have %d" % (sku, quantity, self.available(sku)))
        self.reserved[sku] = self.reserved.get(sku, 0) + quantity

    def release(self, sku, quantity):
        """Give back a reservation."""
        self.reserved[sku] = max(0, self.reserved.get(sku, 0) - quantity)

    def commit(self, sku, quantity):
        """Turn a reservation into a sale: the units leave the shelf."""
        self.release(sku, quantity)
        self.on_hand[sku] = self.on_hand.get(sku, 0) - quantity

    def to_dict(self):
        """Serializable form."""
        return {"on_hand": dict(self.on_hand), "reserved": dict(self.reserved)}

    @classmethod
    def from_dict(cls, data):
        """Inverse of to_dict."""
        return cls(data.get("on_hand"), data.get("reserved"))
