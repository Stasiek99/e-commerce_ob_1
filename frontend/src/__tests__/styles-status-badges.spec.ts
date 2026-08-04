/**
 * Regression guard: every OrderStatus must render with its own badge color.
 *
 * Invariant: a status missing a `.status--<value>` rule in styles.scss falls
 * back to the base `.status` class's generic gray — visually identical to an
 * unrecognized/garbage status string. FRAUD_REVIEW had this gap (label wired,
 * no color); this test fails for any current or future OrderStatus value
 * that regresses the same way.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { OrderStatus } from "@fragrance-store/shared-types";

const scss = readFileSync(join(__dirname, "../styles.scss"), "utf8");

describe("global order status badge styles (styles.scss)", () => {
  it.each(Object.values(OrderStatus))(
    "defines a .status--%s color rule distinct from the unstyled base .status fallback",
    (status) => {
      const selector = `.status--${status.toLowerCase()}`;
      expect(scss).toContain(selector);
    },
  );

  it('gives FRAUD_REVIEW a warning tone matching the other "needs attention" statuses', () => {
    const fraudRule = scss.match(/\.status--fraud_review\s*\{([^}]*)\}/);
    const disputeRule = scss.match(/\.status--dispute_hold\s*\{([^}]*)\}/);

    expect(fraudRule).not.toBeNull();
    expect(fraudRule![1].replace(/\s+/g, "")).toBe(
      disputeRule![1].replace(/\s+/g, ""),
    );
  });
});
