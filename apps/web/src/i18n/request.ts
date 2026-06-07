import { getRequestConfig } from 'next-intl/server';

/**
 * Single-locale setup for now: all UI strings are externalized from day one
 * so adding locales later is a translation task, not a refactor.
 */
export default getRequestConfig(async () => {
  const locale = 'en';
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
