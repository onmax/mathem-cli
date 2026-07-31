import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { chromium, type BrowserContext } from "playwright-core";

const BASE_URL = "https://www.mathem.se";
const STATE_DIR = join(homedir(), ".mathem-cli");
const PROFILE_DIR = join(STATE_DIR, "profile");
const SESSION_FILE = join(STATE_DIR, "session.json");
const PUBLIC_API_HEADERS = {
  accept: "application/json",
  "x-client-app": "tienda-web",
  "x-country": "se",
  "x-language": "sv",
  "x-requested-case": "camel",
};

type SessionCookie = Awaited<ReturnType<BrowserContext["cookies"]>>[number];

interface SessionRecord {
  cookies: SessionCookie[];
  savedAt: string;
}

interface InfoRow {
  key: string;
  value: unknown;
}

interface InfoTable {
  title?: string;
  rows?: InfoRow[];
  disclaimers?: unknown;
}

interface LocalProductInfo {
  language?: string;
  shortDescription?: string;
  descriptionFromSupplier?: string;
  nutritionInfoTable?: InfoTable;
  contentsTable?: InfoTable;
  hazards?: unknown;
}

interface MathemProduct {
  id: number;
  fullName?: string;
  brand?: string;
  name?: string;
  nameExtra?: string;
  frontUrl?: string;
  grossPrice?: unknown;
  currency?: string;
  grossUnitPrice?: unknown;
  unitPriceQuantityAbbreviation?: string;
  unitPriceQuantityName?: string;
  discount?: unknown;
  promotion?: unknown;
  promotions?: unknown;
  bottleDeposit?: unknown;
  availability?: unknown;
  clientClassifiers?: unknown;
  detailedInfo?: {
    country?: string;
    local?: LocalProductInfo[];
  };
  categories?: unknown;
  images?: unknown;
  isRestricted?: boolean;
  restrictionAgeLimit?: number;
  pills?: unknown;
  bonusInfo?: unknown;
  metadata?: unknown;
  isExemptFromThirdPartyMarketing?: boolean;
}

interface CartProduct {
  id: number;
  fullName?: string;
  name?: string;
  brand?: string;
  nameExtra?: string;
  frontUrl?: string;
  grossPrice?: unknown;
  currency?: string;
}

interface CartItem {
  product: CartProduct;
  quantity: number;
  discountedDisplayPriceTotal?: unknown;
  displayPriceTotal?: unknown;
}

interface CartSummaryLine {
  name?: string;
  grossAmount?: unknown;
}

interface MathemCart {
  id?: unknown;
  productQuantityCount?: number;
  totalGrossAmount?: unknown;
  currency?: string;
  groups?: Array<{ items?: CartItem[] }>;
  summaryLines?: Array<{ lines?: CartSummaryLine[] }>;
}

export class MathemError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

export async function login({
  onStatus = () => {},
}: {
  onStatus?: (message: string) => void;
} = {}) {
  await mkdir(PROFILE_DIR, { recursive: true, mode: 0o700 });
  await chmod(STATE_DIR, 0o700);
  await chmod(PROFILE_DIR, 0o700);

  const executablePath = process.env.MATHEM_CHROME_PATH;
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
    chromiumSandbox: true,
    headless: false,
  });
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    onStatus("Opening Chrome. Complete the Mathem login in the browser.");
    await page.goto(`${BASE_URL}/se/user/login/`);
    await page.waitForFunction(
      () => document.querySelector('a[href="/se/account/"]') !== null,
      undefined,
      { timeout: 0 },
    );

    const cookies = await context.cookies(BASE_URL);
    const savedAt = new Date().toISOString();
    await writeFile(SESSION_FILE, JSON.stringify({ cookies, savedAt } satisfies SessionRecord), {
      mode: 0o600,
    });
    await chmod(SESSION_FILE, 0o600);

    return {
      loggedIn: true,
      savedAt,
      sessionFile: "~/.mathem-cli/session.json",
    };
  } finally {
    await context.close();
  }
}

export async function getCart() {
  return normalizeCart(await readCart());
}

export async function searchProducts(query: string, { limit = 5 }: { limit?: number } = {}) {
  const results = await request<{ items?: Array<{ id: number; type: string }> }>(
    `/api/v1/search/mixed/?q=${encodeURIComponent(query)}`,
  );
  const matches = (results.items ?? []).filter(({ type }) => type === "product").slice(0, limit);
  const products = await Promise.all(matches.map(({ id }) => readProduct(id)));

  return {
    query,
    returned: products.length,
    products: products.map(normalizeProduct),
  };
}

export async function getProduct(reference: string) {
  return normalizeProduct(await readProduct(productIdFromReference(reference)));
}

export async function addToCart(reference: string, quantity = 1) {
  const productId = productIdFromReference(reference);
  await changeQuantity(productId, quantity);

  return {
    action: "add",
    productId,
    quantity,
    cart: await getCart(),
  };
}

export async function updateCart(reference: string, quantity: number) {
  const cart = await readCart();
  const item = findCartItem(cart, reference);
  const difference = quantity - item.quantity;

  if (difference !== 0) {
    await changeQuantity(item.product.id, difference);
  }

  return {
    action: "update",
    productId: item.product.id,
    quantity,
    cart: await getCart(),
  };
}

export async function deleteFromCart(reference: string) {
  const cart = await readCart();
  const item = findCartItem(cart, reference);
  await changeQuantity(item.product.id, -item.quantity);

  return {
    action: "delete",
    productId: item.product.id,
    removedQuantity: item.quantity,
    cart: await getCart(),
  };
}

async function readCart(): Promise<MathemCart> {
  return request("/api/v1/cart/?group-by=categories", {
    authenticated: true,
  });
}

async function readProduct(productId: number): Promise<MathemProduct> {
  return request(`/api/v1/products/${productId}/`);
}

async function changeQuantity(productId: number, quantity: number): Promise<void> {
  await request("/api/v1/cart/items/?group-by=categories", {
    authenticated: true,
    method: "POST",
    body: JSON.stringify({
      items: [{ productId, quantity, trackingLocation: "Cart" }],
    }),
  });
}

async function request<T>(
  path: string,
  {
    authenticated = false,
    ...options
  }: RequestInit & {
    authenticated?: boolean;
  } = {},
): Promise<T> {
  const cookies = authenticated ? await loadSession() : [];
  const headers = new Headers(PUBLIC_API_HEADERS);

  if (authenticated) {
    setHeaders(headers, authenticatedHeaders(cookies));
  }
  if (options.body) {
    headers.set("content-type", "application/json");
  }
  setHeaders(headers, options.headers);

  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(30_000),
      headers,
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new MathemError("Mathem request timed out after 30 seconds");
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new MathemError(`Could not reach Mathem: ${message}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new MathemError("Session expired. Run: mathem login");
  }

  if (!response.ok) {
    throw new MathemError(`Mathem request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function loadSession(): Promise<SessionCookie[]> {
  try {
    await chmod(STATE_DIR, 0o700);
    await chmod(SESSION_FILE, 0o600);
    const session = JSON.parse(await readFile(SESSION_FILE, "utf8")) as Partial<SessionRecord>;

    if (!Array.isArray(session.cookies)) {
      throw new TypeError("Session cookies are missing");
    }

    return session.cookies;
  } catch {
    throw new MathemError("Not logged in. Run: mathem login");
  }
}

function authenticatedHeaders(cookies: SessionCookie[]): Record<string, string> {
  const csrfToken = cookies.find(({ name }) => name === "csrftoken")?.value;
  const cookie = cookies
    .filter(({ domain }) => domain.endsWith("mathem.se"))
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");

  return {
    cookie,
    referer: `${BASE_URL}/se/cart/`,
    "x-csrftoken": csrfToken ?? "",
  };
}

function setHeaders(target: Headers, source: HeadersInit | undefined): void {
  new Headers(source).forEach((value, key) => target.set(key, value));
}

function findCartItem(cart: MathemCart, reference: string): CartItem {
  const items = flattenCartItems(cart);
  const numericId = /^\d+$/.test(reference) ? Number(reference) : null;
  const query = reference.toLocaleLowerCase("sv");
  const item = items.find(
    ({ product }) =>
      product.id === numericId ||
      (product.name ?? "").toLocaleLowerCase("sv").includes(query) ||
      (product.fullName ?? "").toLocaleLowerCase("sv").includes(query),
  );

  if (!item) {
    throw new MathemError(`Product not found in cart: ${reference}`);
  }

  return item;
}

function flattenCartItems(cart: MathemCart): CartItem[] {
  return (cart.groups ?? []).flatMap((group) => group.items ?? []);
}

export function productIdFromReference(value: string): number {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const match = value.match(/\/products\/(\d+)(?:-|\/|$)/);
  if (!match) {
    throw new MathemError(`Could not read product id: ${value}`, 2);
  }

  return Number(match[1]);
}

export function normalizeCart(cart: MathemCart) {
  const summaryLines = (cart.summaryLines ?? []).flatMap((section) => section.lines ?? []);
  const summaryAmount = (name: string) =>
    summaryLines.find((line) => line.name === name)?.grossAmount ?? null;

  return {
    id: cart.id,
    count: cart.productQuantityCount ?? 0,
    totals: {
      items: summaryAmount("GrossAmount"),
      savings: summaryAmount("ProductDiscounter"),
      subtotal: summaryAmount("GrossSubtotalAmount"),
      total: summaryAmount("GrossTotalAmount") ?? cart.totalGrossAmount ?? null,
      currency: cart.currency ?? "SEK",
    },
    items: flattenCartItems(cart).map((item) => ({
      productId: item.product.id,
      fullName: item.product.fullName,
      brand: item.product.brand,
      size: item.product.nameExtra,
      url: item.product.frontUrl,
      quantity: item.quantity,
      unitPrice: {
        amount: item.product.grossPrice,
        currency: item.product.currency,
      },
      linePrice: {
        amount: item.discountedDisplayPriceTotal ?? item.displayPriceTotal ?? null,
        originalAmount: item.displayPriceTotal ?? null,
        currency: item.product.currency ?? cart.currency ?? "SEK",
      },
    })),
    summary: cart.summaryLines ?? [],
  };
}

export function normalizeProduct(product: MathemProduct) {
  const local =
    product.detailedInfo?.local?.find(({ language }) => language === "sv") ??
    product.detailedInfo?.local?.[0] ??
    {};
  const nutritionRows = local.nutritionInfoTable?.rows ?? [];
  const detailRows = local.contentsTable?.rows ?? [];
  const nutritionValue = (key: string) =>
    nutritionRows.find((row) => row.key === key)?.value ?? null;
  const detailValue = (key: string) => detailRows.find((row) => row.key === key)?.value ?? null;

  return {
    id: product.id,
    fullName: product.fullName,
    brand: product.brand,
    name: product.name,
    size: product.nameExtra,
    url: product.frontUrl,
    price: {
      amount: product.grossPrice,
      currency: product.currency,
      unitAmount: product.grossUnitPrice,
      unit: product.unitPriceQuantityAbbreviation,
      unitName: product.unitPriceQuantityName,
      discount: product.discount,
      promotion: product.promotion,
      promotions: product.promotions,
      bottleDeposit: product.bottleDeposit,
    },
    availability: product.availability,
    classifiers: product.clientClassifiers,
    origin: {
      countryCode: product.detailedInfo?.country ?? null,
      handledIn: detailValue("Hanterad i"),
    },
    descriptions: {
      short: local.shortDescription ?? null,
      supplier: local.descriptionFromSupplier ?? null,
    },
    ingredients: detailValue("Ingredienser"),
    allergens: detailValue("Allergener"),
    nutrition: {
      basis: local.nutritionInfoTable?.title ?? null,
      energy: nutritionValue("Energi"),
      fat: nutritionValue("Fett"),
      saturatedFat: nutritionValue("Mättat fett"),
      carbohydrates: nutritionValue("Kolhydrater"),
      sugars: nutritionValue("Sockerarter"),
      fiber: nutritionValue("Fiber"),
      protein: nutritionValue("Protein"),
      salt: nutritionValue("Salt"),
      rows: nutritionRows,
      disclaimers: local.nutritionInfoTable?.disclaimers ?? null,
    },
    freshnessGuarantee: detailValue("Färskvarugaranti"),
    deliveryDays: detailValue("Leveransdagar"),
    variableWeight: detailValue("Varierande vikt"),
    supplier: detailValue("Leverantör"),
    contact: detailValue("Kontaktuppgifter"),
    details: {
      values: Object.fromEntries(detailRows.map(({ key, value }) => [key, value])),
      rows: detailRows,
      disclaimers: local.contentsTable?.disclaimers ?? null,
    },
    hazards: local.hazards ?? null,
    categories: product.categories,
    images: product.images,
    restrictions: {
      isRestricted: product.isRestricted,
      ageLimit: product.restrictionAgeLimit,
    },
    pills: product.pills,
    bonusInfo: product.bonusInfo,
    metadata: product.metadata,
    isExemptFromThirdPartyMarketing: product.isExemptFromThirdPartyMarketing,
  };
}
