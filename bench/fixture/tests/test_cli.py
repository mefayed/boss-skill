import io
import os
import unittest

from shop.cli import main

EXAMPLES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "examples")


def run(*argv):
    out = io.StringIO()
    code = main(["--data", EXAMPLES] + list(argv), out=out)
    return code, out.getvalue()


class CliTest(unittest.TestCase):
    def test_stock(self):
        code, out = run("stock")
        self.assertEqual(code, 0)
        self.assertIn("PEN-03", out)

    def test_report_text(self):
        code, out = run("report")
        self.assertEqual(code, 0)
        self.assertIn("Orders: 2", out)
        self.assertIn("Revenue: 131.08", out)

    def test_report_csv(self):
        code, out = run("report", "--csv")
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("sku,name,category,units,revenue\n"))

    def test_missing_data_dir(self):
        code = main(["--data", "/nonexistent", "stock"], out=io.StringIO())
        self.assertEqual(code, 1)
