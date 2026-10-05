"""Plain data types used across the package."""

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class Product:
    sku: str
    name: str
    price_cents: int
    category: Optional[str] = None


@dataclass
class LineItem:
    sku: str
    quantity: int
    unit_price_cents: int


@dataclass
class Order:
    id: str
    customer: str
    created_at: str  # ISO date, YYYY-MM-DD
    items: List[LineItem] = field(default_factory=list)
    status: str = "open"
    total_cents: int = 0

    def find_item(self, sku):
        """Return the line for sku, or None."""
        for item in self.items:
            if item.sku == sku:
                return item
        return None
