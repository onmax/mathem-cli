import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import packageJson from "../package.json" with { type: "json" };
import { parsePositiveInteger, UsageError } from "../src/cli";
import { normalizeCart, normalizeProduct, productIdFromReference } from "../src/mathem";

const executable = resolve(import.meta.dirname, "..", packageJson.bin.mathem);

describe("argument parsing", () => {
  it("rejects invalid positive integers", () => {
    expect(() => parsePositiveInteger("0", "quantity")).toThrow(UsageError);
    expect(() => parsePositiveInteger("two", "quantity")).toThrow(UsageError);
  });
});

describe("Mathem normalization", () => {
  it("reads product ids and Mathem product URLs", () => {
    expect(productIdFromReference("8279")).toBe(8279);
    expect(
      productIdFromReference("https://www.mathem.se/se/products/8279-arla-r-grekisk-yoghurt/"),
    ).toBe(8279);
  });

  it("keeps published zero nutrition distinct from missing nutrition", () => {
    const product = normalizeProduct({
      id: 1,
      fullName: "Test product",
      detailedInfo: {
        local: [
          {
            language: "sv",
            nutritionInfoTable: {
              title: "per 100 g",
              rows: [{ key: "Sockerarter", value: "0 g" }],
            },
            contentsTable: { rows: [] },
          },
        ],
      },
    });

    expect(product.nutrition.sugars).toBe("0 g");
    expect(product.nutrition.fiber).toBeNull();
  });

  it("derives cart totals from Mathem summary semantics", () => {
    const cart = normalizeCart({
      productQuantityCount: 1,
      totalGrossAmount: "114.00",
      currency: "SEK",
      summaryLines: [
        {
          lines: [
            { name: "GrossAmount", grossAmount: "18.83" },
            { name: "ProductDiscounter", grossAmount: "-3.83" },
            { name: "GrossSubtotalAmount", grossAmount: "15.00" },
            { name: "GrossTotalAmount", grossAmount: "114.00" },
          ],
        },
      ],
      groups: [
        {
          items: [
            {
              quantity: 1,
              displayPriceTotal: "18.83",
              discountedDisplayPriceTotal: "15.00",
              product: {
                id: 380,
                fullName: "Garant Mango Fryst",
                currency: "SEK",
              },
            },
          ],
        },
      ],
    });

    expect(cart.totals).toEqual({
      items: "18.83",
      savings: "-3.83",
      subtotal: "15.00",
      total: "114.00",
      currency: "SEK",
    });
    expect(cart.items[0]?.linePrice).toEqual({
      amount: "15.00",
      originalAmount: "18.83",
      currency: "SEK",
    });
  });
});

describe("packaged executable", () => {
  it("prints help on stdout", () => {
    const result = spawnSync(process.execPath, [executable, "--help"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/mathem search/);
    expect(result.stderr).toBe("");
  });

  it("reports invocation errors on stderr", () => {
    const result = spawnSync(process.execPath, [executable], {
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/Error: Missing command/);
  });

  it("validates a multi-word search before network access", () => {
    const result = spawnSync(
      process.execPath,
      [executable, "search", "grekisk", "yoghurt", "--limit", "51"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/limit must be 50 or less/);
  });
});
