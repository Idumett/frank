import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProductDataRequestV1Schema, ProductDataResponseV1Schema } from '@frank/contracts';

const fixture = (name: string) =>
  JSON.parse(
    fs.readFileSync(
      new URL(`../../../docs/conformance/product-data-v1/${name}`, import.meta.url),
      'utf8',
    ),
  );

describe('Chivora V1 conformance fixtures', () => {
  it('keeps example requests and responses inside the published contract', () => {
    expect(ProductDataRequestV1Schema.parse(fixture('put-memory.request.json')).operation).toBe(
      'put',
    );
    expect(ProductDataResponseV1Schema.parse(fixture('put-memory.response.json')).ok).toBe(true);
  });
});
