# mathem-cli

Search Mathem products and prepare a grocery cart from the terminal. Results are structured JSON, including ingredients, allergens, nutrition, origin, availability, and pricing when Mathem provides them.

> [!NOTE]
> This unofficial project uses Mathem's private web endpoints, which can change without notice. It prepares and verifies the cart; checkout, payment, and delivery remain manual.

## Install for agents

Install the bundled skill globally:

```bash
npx skills add onmax/mathem-cli --global --skill mathem-cli --yes
```

The skill teaches compatible coding agents to install and use the CLI, compare products, and prepare a verified cart.

## Use

Requires Node.js 24+, Google Chrome, and a Mathem account.

```bash
npx --yes mathem-cli login
npx --yes mathem-cli search "grekisk yoghurt" --limit 3
npx --yes mathem-cli product 8279
npx --yes mathem-cli add 8279
npx --yes mathem-cli list
npx --yes mathem-cli update 2 8279
npx --yes mathem-cli delete 8279
```

`login` opens Chrome so you can authenticate; the CLI never asks for your password. Search and cart commands write JSON to stdout, and every mutation returns the updated cart. Product IDs are preferred, but `update` and `delete` also accept a unique name fragment.

> [!CAUTION]
> Login stores authenticated cookies in `~/.mathem-cli/session.json`. Never share or commit that file; delete it and sign out from Mathem to revoke access.

## Development

```bash
vp install
vp check
vp pack
vp test run
```
