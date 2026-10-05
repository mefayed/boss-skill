# shop

A small order and inventory library for a single-store shop, with a CLI for
stock checks and sales reports. Python 3.9+, standard library only.

## Run

    python3 -m shop.cli --data examples stock
    python3 -m shop.cli --data examples report
    python3 -m shop.cli --data examples report --csv

## Test

    python3 -m unittest discover -s tests -t .

## Layout

- `shop/money.py` - parsing and formatting of money amounts
- `shop/models.py` - `Product`, `LineItem`, `Order`
- `shop/inventory.py` - stock on hand and reservations
- `shop/pricing.py` - line totals and the bulk discount
- `shop/orders.py` - `OrderService`: the order lifecycle
- `shop/storage.py` - JSON load/save for the catalog, orders and inventory
- `shop/report.py` - sales summary, text and CSV output
- `shop/receipt.py` - plain-text receipts
- `shop/cli.py` - command line entry point
- `shop/errors.py` - every exception the package raises

## Conventions

- Money is always an `int` number of cents. Never use floats for money.
- Errors the package raises on purpose subclass `ShopError` in `shop/errors.py`.
- Order lifecycle: `open` -> `paid`, or `open` -> `cancelled`.
  Adding an item reserves stock; paying commits it (takes it off the shelf);
  removing an item releases its reservation.
- Optional product fields default to `None`, are written to the catalog file,
  and are read with `.get()` so older files still load (see `category`).
- Every public function has a one-line docstring.
- New behaviour comes with a test in `tests/`.
