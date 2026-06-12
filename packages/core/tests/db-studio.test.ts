import { describe, expect, it } from 'vitest';

import { STUDIO_MODELS, studioModel, validateStudioWrite } from '../src/db-studio';

describe('database studio registry', () => {
  it('never exposes auth, credential, or secret-bearing models', () => {
    const names = STUDIO_MODELS.map((model) => model.name.toLowerCase());
    for (const forbidden of [
      'user',
      'session',
      'account',
      'member',
      'invitation',
      'providercredential',
      'gatewayapikey',
      'scimtoken',
      'ssoprovider',
      'sendingdomain',
      'integration',
      'webhookendpoint',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('no exposed field smells like a secret', () => {
    for (const model of STUDIO_MODELS) {
      for (const field of model.fields) {
        expect(field.name.toLowerCase()).not.toMatch(/secret|token|key|password|hash/);
      }
    }
  });

  it('resolves models by name and rejects strangers', () => {
    expect(studioModel('contact')?.label).toBe('Contacts');
    expect(studioModel('providerCredential')).toBeNull();
    expect(studioModel('user')).toBeNull();
  });

  it('rejects unknown and non-editable fields loudly', () => {
    const contact = studioModel('contact')!;
    expect(validateStudioWrite(contact, { nope: 'x' })).toEqual({
      ok: false,
      error: 'unknown field: nope',
    });
    expect(validateStudioWrite(contact, { id: 'new-id' })).toEqual({
      ok: false,
      error: 'field is not editable: id',
    });
  });

  it('coerces and validates per field type', () => {
    const contact = studioModel('contact')!;
    const good = validateStudioWrite(contact, { score: '42', firstName: ' Ada ' });
    expect(good).toEqual({ ok: true, data: { score: 42, firstName: 'Ada' } });

    const bad = validateStudioWrite(contact, { score: 'many' });
    expect(bad.ok).toBe(false);

    const required = validateStudioWrite(contact, { email: '' });
    expect(required).toEqual({ ok: false, error: 'email is required' });
  });
});
