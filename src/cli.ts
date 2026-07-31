import { cac } from "cac";

import packageJson from "../package.json" with { type: "json" };
import * as mathem from "./mathem";

const NO_OUTPUT = Symbol("no-output");

export class UsageError extends Error {}

export async function runCli(args: readonly string[]): Promise<number> {
  const cli = createCli();

  try {
    const parsed = cli.parse(["node", "mathem", ...args], { run: false });

    if (parsed.options.help || parsed.options.version) {
      return 0;
    }

    if (!cli.matchedCommand) {
      throw new UsageError(args[0] ? `Unknown command: ${args[0]}` : "Missing command.");
    }

    const result = await cli.runMatchedCommand();
    if (result !== NO_OUTPUT) {
      writeLine(process.stdout, JSON.stringify(result, null, 2) ?? "null");
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeLine(process.stderr, `Error: ${message}`);

    if (error instanceof UsageError || (error instanceof Error && error.name === "CACError")) {
      return 2;
    }
    return error instanceof mathem.MathemError ? error.exitCode : 1;
  }
}

export function parsePositiveInteger(value: string | undefined, label: string): number {
  if (!/^\d+$/.test(value ?? "")) {
    throw new UsageError(`${label} must be a positive integer`);
  }

  const number = Number(value);
  if (number < 1) {
    throw new UsageError(`${label} must be a positive integer`);
  }

  return number;
}

function createCli() {
  const cli = cac("mathem");

  cli.command("login", "Open Chrome to authenticate with Mathem").action(() =>
    mathem.login({
      onStatus: (message) => writeLine(process.stderr, message),
    }),
  );

  cli.command("list", "Return the authenticated cart").action(() => mathem.getCart());

  cli
    .command("search <query> [...queryParts]", "Search the Mathem catalog")
    .option("--limit <count>", "Maximum number of products", { default: "5" })
    .action((query: string, queryParts: string[], options: { limit: string }) => {
      const limit = parsePositiveInteger(options.limit, "limit");
      if (limit > 50) {
        throw new UsageError("limit must be 50 or less");
      }
      return mathem.searchProducts([query, ...queryParts].join(" "), { limit });
    });

  cli
    .command("product <reference>", "Return one product by ID or Mathem URL")
    .action((reference: string) => mathem.getProduct(reference));

  cli
    .command("add <reference> [quantity]", "Add a product and return the resulting cart")
    .action((reference: string, quantity = "1") =>
      mathem.addToCart(reference, parsePositiveInteger(quantity, "quantity")),
    );

  cli
    .command(
      "update <quantity> <reference> [...referenceParts]",
      "Set a cart quantity and return the resulting cart",
    )
    .action((quantity: string, reference: string, referenceParts: string[]) =>
      mathem.updateCart(
        [reference, ...referenceParts].join(" "),
        parsePositiveInteger(quantity, "quantity"),
      ),
    );

  cli
    .command(
      "delete <reference> [...referenceParts]",
      "Remove a product and return the resulting cart",
    )
    .action((reference: string, referenceParts: string[]) =>
      mathem.deleteFromCart([reference, ...referenceParts].join(" ")),
    );

  cli.command("help", "Display help").action(() => {
    cli.unsetMatchedCommand();
    cli.outputHelp();
    return NO_OUTPUT;
  });

  cli.help();
  cli.version(packageJson.version);

  return cli;
}

function writeLine(stream: NodeJS.WritableStream, value: string): void {
  stream.write(`${value}\n`);
}
