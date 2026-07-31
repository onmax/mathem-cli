---
name: mathem-cli
description: Runs `mathem-cli` through `npx` to search and compare Mathem Sweden groceries by ingredients, allergens, nutrition, origin, availability, and price, then prepare and verify an authenticated cart. Use when researching Mathem products, prioritizing food quality, building or editing a Mathem cart, or preparing a grocery order while leaving checkout and payment to the user.
---

# Mathem CLI

1. Run `npx --yes mathem-cli --help`. Continue when help works.
2. Extract foods, quantities, budget, dietary constraints, quality criteria, and substitutions. For quality-sensitive food such as meat, shortlist products unless origin, cut, or production method makes the choice unambiguous.
3. Search with `npx --yes mathem-cli search "<query>" --limit <count>` and inspect candidates with `npx --yes mathem-cli product <id>`. Compare published ingredients, allergens, nutrition, origin, freshness, availability, and unit price.
4. Run `npx --yes mathem-cli list`. If authentication is required, run `npx --yes mathem-cli login` and let the user complete the Chrome flow. Continue when `list` returns JSON.
5. Mutate one item at a time with `npx --yes mathem-cli add <id> [quantity]`, `npx --yes mathem-cli update <quantity> <id>`, or `npx --yes mathem-cli delete <id>`. Verify each returned cart; after an uncertain result, run `list` before retrying.
6. Run `npx --yes mathem-cli list` and report the final items, quantities, totals, quality trade-offs, and unknown fields.

Rules:

- Prefer product IDs.
- Treat `null` as unknown and zero as measured zero.
- Treat private API failures as contract drift; preserve the last verified cart state.
- Stop at the verified cart. Checkout, payment, delivery slots, and order confirmation stay with the user.
