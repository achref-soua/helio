/** The Shopify webhook topics Helio ingests into the CDP. */
export const SHOPIFY_TOPICS = ['customers/create', 'customers/update', 'orders/create'] as const;
export type ShopifyTopic = (typeof SHOPIFY_TOPICS)[number];

const encoder = new TextEncoder();

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/**
 * Verify Shopify's `X-Shopify-Hmac-Sha256` header — base64 HMAC-SHA256 of the
 * raw request body keyed by the app's API secret. Always check against the raw
 * body bytes, before any JSON re-serialization.
 */
export async function verifyShopifyHmac(
  secret: string,
  rawBody: string,
  header: string | undefined | null,
): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  return timingSafeEqual(base64(new Uint8Array(signature)), header);
}

/** A contact derived from a Shopify payload, ready to upsert into the CDP. */
export interface ShopifyContact {
  email: string;
  firstName?: string;
  lastName?: string;
  attributes: Record<string, string | number>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/** Map a Shopify `customers/create|update` payload to a CDP contact. */
export function shopifyContactFromCustomer(payload: unknown): ShopifyContact | null {
  const customer = asRecord(payload);
  const email = str(customer.email);
  if (!email) return null;
  const attributes: Record<string, string | number> = { shopify_source: 'customer' };
  const id = num(customer.id) ?? str(customer.id);
  if (id !== undefined) attributes.shopify_customer_id = id;
  const ordersCount = num(customer.orders_count);
  if (ordersCount !== undefined) attributes.shopify_orders_count = ordersCount;
  const totalSpent = num(customer.total_spent);
  if (totalSpent !== undefined) attributes.shopify_total_spent = totalSpent;
  return {
    email,
    firstName: str(customer.first_name),
    lastName: str(customer.last_name),
    attributes,
  };
}

/** Map a Shopify `orders/create` payload to a CDP contact with order traits. */
export function shopifyContactFromOrder(payload: unknown): ShopifyContact | null {
  const order = asRecord(payload);
  const customer = asRecord(order.customer);
  const email = str(order.email) ?? str(customer.email) ?? str(order.contact_email);
  if (!email) return null;
  const attributes: Record<string, string | number> = { shopify_source: 'order' };
  const orderName = str(order.name) ?? num(order.order_number);
  if (orderName !== undefined) attributes.shopify_last_order = orderName;
  const total = num(order.total_price);
  if (total !== undefined) attributes.shopify_last_order_value = total;
  const currency = str(order.currency);
  if (currency) attributes.shopify_currency = currency;
  return {
    email,
    firstName: str(customer.first_name),
    lastName: str(customer.last_name),
    attributes,
  };
}

/** The CDP contact for a topic, or null if the payload has no usable email. */
export function shopifyContactForTopic(topic: string, payload: unknown): ShopifyContact | null {
  if (topic === 'orders/create') return shopifyContactFromOrder(payload);
  if (topic === 'customers/create' || topic === 'customers/update') {
    return shopifyContactFromCustomer(payload);
  }
  return null;
}
