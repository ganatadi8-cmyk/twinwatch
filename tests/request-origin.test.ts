import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSameOriginRequest } from '../lib/request-origin.ts';

test('same-origin requests use the incoming host even when Next.js normalises the URL', () => {
  assert.equal(isSameOriginRequest(new Request('http://localhost:3009/api/sessions', {
    headers: { host: '127.0.0.1:3009', origin: 'http://127.0.0.1:3009' },
  })), true);
  assert.equal(isSameOriginRequest(new Request('http://localhost:3000/api/sessions', {
    headers: { host: 'twinwatch.example', origin: 'https://twinwatch.example', 'x-forwarded-proto': 'https' },
  })), true);
});

test('cross-site, malformed and protocol-mismatched requests are rejected', () => {
  const url = 'https://twinwatch.example/api/sessions';
  const cases: Record<string, string>[] = [
    { origin: 'https://other.example' },
    { origin: 'null' },
    { origin: 'https://twinwatch.example/path' },
    { origin: 'http://twinwatch.example' },
    { origin: 'https://twinwatch.example', 'sec-fetch-site': 'cross-site' },
  ];
  for (const headers of cases) {
    assert.equal(isSameOriginRequest(new Request(url, { headers })), false);
  }
});
