"""Exceptions raised by the shop package. Callers catch ShopError."""


class ShopError(Exception):
    """Base class for every error the shop package raises on purpose."""


class UnknownProduct(ShopError):
    """The SKU is not in the catalog."""


class UnknownOrder(ShopError):
    """No order has that id."""


class OutOfStock(ShopError):
    """Not enough available stock to reserve."""


class OrderStateError(ShopError):
    """The operation is not allowed in the order's current status."""


class StorageError(ShopError):
    """A data file is missing or malformed."""
