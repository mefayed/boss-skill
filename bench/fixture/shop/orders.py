"""Order lifecycle: create, add/remove items, checkout, cancel."""

from .errors import OrderStateError, UnknownOrder, UnknownProduct
from .models import LineItem, Order
from .pricing import order_total


class OrderService:
    def __init__(self, catalog, inventory, orders=None):
        self.catalog = catalog
        self.inventory = inventory
        self.orders = {o.id: o for o in (orders or [])}

    def get(self, order_id):
        """Return the order or raise UnknownOrder."""
        try:
            return self.orders[order_id]
        except KeyError:
            raise UnknownOrder(order_id) from None

    def create_order(self, customer, created_at):
        """Start a new open order."""
        order = Order(id="o%d" % (len(self.orders) + 1), customer=customer, created_at=created_at)
        self.orders[order.id] = order
        return order

    def _open(self, order_id):
        order = self.get(order_id)
        if order.status != "open":
            raise OrderStateError("order %s is %s" % (order_id, order.status))
        return order

    def add_item(self, order_id, sku, quantity):
        """Add units of a product, reserving stock. Repeated SKUs merge into one line."""
        order = self._open(order_id)
        if sku not in self.catalog:
            raise UnknownProduct(sku)
        self.inventory.reserve(sku, quantity)
        item = order.find_item(sku)
        if item:
            item.quantity += quantity
        else:
            order.items.append(LineItem(sku, quantity, self.catalog[sku].price_cents))
        return order

    def remove_item(self, order_id, sku):
        """Drop a line and release its reservation."""
        order = self._open(order_id)
        item = order.find_item(sku)
        if item is None:
            raise UnknownProduct(sku)
        self.inventory.release(sku, item.quantity)
        order.items.remove(item)
        return order

    def checkout(self, order_id):
        """Pay for an open order: commit its stock and fix its total."""
        order = self._open(order_id)
        if not order.items:
            raise OrderStateError("order %s is empty" % order_id)
        for item in order.items:
            self.inventory.commit(item.sku, item.quantity)
        order.total_cents = order_total(order)
        order.status = "paid"
        return order

    def cancel(self, order_id):
        """Cancel an open order."""
        order = self._open(order_id)
        order.status = "cancelled"
        return order
