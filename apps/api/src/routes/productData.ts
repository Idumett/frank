import type { FastifyInstance } from 'fastify';
import { ProductDataRequestV1Schema, ProductDataResponseV1Schema } from '@frank/contracts';
import type { ProductDataPort } from '../productData/ProductDataPort.js';

export async function productDataRoutes(app: FastifyInstance, store: ProductDataPort) {
  app.post('/v1/product-data', async (req, reply) => {
    const parsed = ProductDataRequestV1Schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(
        ProductDataResponseV1Schema.parse({
          schemaVersion: '1',
          requestId: req.id,
          ok: false,
          error: {
            code: 'invalid_request',
            message: 'Request does not match the V1 product-data contract',
            retryable: false,
          },
        }),
      );
    }
    const response = ProductDataResponseV1Schema.parse(store.execute(req.userId, parsed.data));
    const status = response.ok
      ? 200
      : response.error.code === 'unauthorised'
        ? 403
        : response.error.code === 'not_found'
          ? 404
          : response.error.code === 'idempotency_conflict'
            ? 409
            : 503;
    return reply.code(status).send(response);
  });
}
