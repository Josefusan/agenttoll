// Header hygiene in isolation (no workerd): mirrors the unit tests in
// crates/agenttoll-gateway/src/proxy.rs.

import { describe, expect, test } from 'vitest';
import { originRequestHeaders, stripHopByHop } from '../src/proxy';

const opts = { origin: 'http://o:4000', preserveHost: false, peer: '10.0.0.9', proto: 'http' };

describe('proxy header hygiene', () => {
  test('strips hop-by-hop and Connection-listed headers', () => {
    const h = new Headers([
      ['connection', 'close, x-secret'],
      ['x-secret', '1'],
      ['upgrade', 'h2c'],
      ['te', 'trailers'],
      ['accept', '*/*'],
    ]);
    stripHopByHop(h);
    expect([...h.keys()]).toEqual(['accept']);
  });

  test('origin headers drop payment and spoofed agenttoll headers', () => {
    const incoming = new Headers([
      ['host', 'acme.dev'],
      ['payment-signature', 'abc'],
      ['x-payment', 'abc'],
      ['x-agenttoll-paid', '1'],
      ['X-AgentToll-Agent', 'me'],
      ['x-forwarded-for', '1.1.1.1'],
      ['cookie', 'a=b'],
    ]);
    const h = originRequestHeaders(incoming, opts);
    for (const gone of ['payment-signature', 'x-payment', 'x-agenttoll-paid', 'x-agenttoll-agent', 'host']) {
      expect(h.has(gone), `${gone} should be stripped`).toBe(false);
    }
    expect(h.get('x-forwarded-host')).toBe('acme.dev');
    expect(h.get('x-forwarded-for')).toBe('1.1.1.1, 10.0.0.9');
    expect(h.get('x-forwarded-proto')).toBe('http');
    expect(h.get('cookie')).toBe('a=b');
  });

  test('preserve_host cannot override Host at the edge; the client host is still forwarded', () => {
    const h = originRequestHeaders(new Headers([['host', 'acme.dev']]), { ...opts, preserveHost: true, peer: null });
    expect(h.has('host')).toBe(false);
    expect(h.get('x-forwarded-host')).toBe('acme.dev');
    expect(h.has('x-forwarded-for')).toBe(false);
  });
});
