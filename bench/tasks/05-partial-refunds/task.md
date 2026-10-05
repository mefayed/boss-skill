We need partial refunds. Add `OrderService.refund(order_id, sku, quantity)` for paid orders. It returns the refunded amount in cents.

Rules:
- Only paid orders can be refunded, and you can't refund more units of a line than were bought, counting earlier refunds. Raise a new `RefundError` (a `ShopError`) in those cases.
- Refunded units go back on the shelf.
- The customer gets back what they actually paid for those units, so the bulk discount counts. When a line is refunded in several goes, the refunds have to add up to exactly that line's total: no lost or extra cents.
- Refunds have to survive saving and loading orders.
- The sales report should show net numbers: units and revenue after refunds, overall and per SKU.
