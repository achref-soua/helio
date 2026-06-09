import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  shopifyContactForTopic,
  shopifyContactFromCustomer,
  shopifyContactFromOrder,
  verifyShopifyHmac,
} from '../src/shopify';

// Independent reference signature (Node crypto) to check our Web Crypto impl.
const sign = (secret: string, body: string) =>
  createHmac('sha256', secret).update(body).digest('base64');

describe('verifyShopifyHmac', () => {
  const body = '{"email":"ada@example.com"}';

  it('accepts a valid signature and rejects everything else', async () => {
    expect(await verifyShopifyHmac('shh', body, sign('shh', body))).toBe(true);
    expect(await verifyShopifyHmac('shh', body, sign('wrong', body))).toBe(false);
    expect(await verifyShopifyHmac('shh', `${body} `, sign('shh', body))).toBe(false);
    expect(await verifyShopifyHmac('shh', body, undefined)).toBe(false);
    expect(await verifyShopifyHmac('shh', body, '')).toBe(false);
  });
});

describe('shopifyContactFromCustomer', () => {
  it('maps a customer payload, carrying order stats as traits', () => {
    const contact = shopifyContactFromCustomer({
      id: 123,
      email: 'Grace@example.com ',
      first_name: 'Grace',
      last_name: 'Hopper',
      orders_count: 4,
      total_spent: '420.50',
    });
    expect(contact).toEqual({
      email: 'Grace@example.com',
      firstName: 'Grace',
      lastName: 'Hopper',
      attributes: {
        shopify_source: 'customer',
        shopify_customer_id: 123,
        shopify_orders_count: 4,
        shopify_total_spent: 420.5,
      },
    });
  });

  it('returns null without an email', () => {
    expect(shopifyContactFromCustomer({ first_name: 'NoEmail' })).toBeNull();
    expect(shopifyContactFromCustomer(null)).toBeNull();
  });
});

describe('shopifyContactFromOrder', () => {
  it('derives the contact from the order customer and records order traits', () => {
    const contact = shopifyContactFromOrder({
      email: 'ada@example.com',
      name: '#1001',
      total_price: '99.00',
      currency: 'USD',
      customer: { first_name: 'Ada', last_name: 'Lovelace' },
    });
    expect(contact).toEqual({
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      attributes: {
        shopify_source: 'order',
        shopify_last_order: '#1001',
        shopify_last_order_value: 99,
        shopify_currency: 'USD',
      },
    });
  });

  it('falls back to the customer email and returns null when none exists', () => {
    expect(shopifyContactFromOrder({ customer: { email: 'c@example.com' } })?.email).toBe(
      'c@example.com',
    );
    expect(shopifyContactFromOrder({ total_price: '10' })).toBeNull();
  });
});

describe('shopifyContactForTopic', () => {
  it('routes topics to the right mapper and ignores unknown topics', () => {
    expect(shopifyContactForTopic('customers/create', { email: 'a@b.co' })?.email).toBe('a@b.co');
    expect(
      shopifyContactForTopic('orders/create', { email: 'a@b.co' })?.attributes.shopify_source,
    ).toBe('order');
    expect(shopifyContactForTopic('products/create', { email: 'a@b.co' })).toBeNull();
  });
});
