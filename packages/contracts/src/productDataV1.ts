import { z } from 'zod';
import { IsoDateTimeSchema } from './common.js';

export const ProductDataVersionV1Schema = z.literal('1');
export const ProductEntityTypeV1Schema = z.enum([
  'user_profile',
  'session',
  'memory',
  'conversation_turn',
  'preferences',
  'known_place',
  'hazard',
]);

export const ProductProvenanceV1Schema = z.object({
  source: z.enum(['frank_android', 'frank_server', 'chivora_fixture', 'migration']),
  requestId: z.string().min(8),
  provider: z.string().min(1).optional(),
  capturedAt: IsoDateTimeSchema.optional(),
});

const entityBase = z.object({
  schemaVersion: ProductDataVersionV1Schema,
  id: z.string().min(1).max(200),
  ownerId: z.string().min(1).max(200),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  provenance: ProductProvenanceV1Schema,
});

export const UserProfileEntityV1Schema = entityBase.extend({
  entityType: z.literal('user_profile'),
  displayName: z.string().min(1).max(200).optional(),
  locale: z.string().min(2).max(30).optional(),
});
export const SessionEntityV1Schema = entityBase.extend({
  entityType: z.literal('session'),
  deviceId: z.string().min(1).max(200).optional(),
  lastSeenAt: IsoDateTimeSchema,
});
export const MemoryEntityV1Schema = entityBase.extend({
  entityType: z.literal('memory'),
  memoryType: z.enum(['text', 'object', 'scene', 'mixed']),
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(20_000),
  tags: z.array(z.string().min(1).max(100)).max(50).default([]),
  mediaRef: z.string().max(2_000).optional(),
  embeddingRef: z.string().max(500).optional(),
});
export const ConversationTurnEntityV1Schema = entityBase.extend({
  entityType: z.literal('conversation_turn'),
  sessionId: z.string().min(1).max(200),
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1).max(20_000),
});
export const PreferencesEntityV1Schema = entityBase.extend({
  entityType: z.literal('preferences'),
  sessionId: z.string().min(1).max(200),
  tts: z.object({
    languageCode: z.string().min(2).max(30).optional(),
    voiceName: z.string().min(3).max(200).optional(),
    speakingRate: z.number().min(0.5).max(2).optional(),
    pitch: z.number().min(-20).max(20).optional(),
  }),
});

const SavedLocationV1Schema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(1_000),
});
const UserConfirmationV1Schema = z.object({
  confirmedBy: z.literal('user'),
  confirmedAt: IsoDateTimeSchema,
});
export const KnownPlaceEntityV1Schema = entityBase.extend({
  entityType: z.literal('known_place'),
  name: z.string().trim().min(1).max(80),
  category: z.enum(['home', 'gym', 'supermarket', 'other']),
  location: SavedLocationV1Schema,
  confirmation: UserConfirmationV1Schema,
  status: z.enum(['active', 'archived']).default('active'),
  notes: z.string().trim().max(500).optional(),
});
export const HazardEntityV1Schema = entityBase.extend({
  entityType: z.literal('hazard'),
  hazardType: z.enum(['pothole', 'uneven_surface', 'obstruction', 'roadworks', 'other']),
  description: z.string().trim().min(1).max(300),
  location: SavedLocationV1Schema,
  radiusMeters: z.number().min(1).max(100),
  reportedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  confirmation: UserConfirmationV1Schema,
  status: z.enum(['active', 'resolved']).default('active'),
});

export const ProductEntityV1Schema = z.discriminatedUnion('entityType', [
  UserProfileEntityV1Schema,
  SessionEntityV1Schema,
  MemoryEntityV1Schema,
  ConversationTurnEntityV1Schema,
  PreferencesEntityV1Schema,
  KnownPlaceEntityV1Schema,
  HazardEntityV1Schema,
]).superRefine((entity, ctx) => {
  if (Date.parse(entity.updatedAt) < Date.parse(entity.createdAt))
    ctx.addIssue({ code: 'custom', path: ['updatedAt'], message: 'updatedAt precedes createdAt' });
  if (entity.entityType === 'hazard' && Date.parse(entity.expiresAt) <= Date.parse(entity.reportedAt))
    ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Hazard expiry must follow its report time' });
});

const requestBase = z.object({
  schemaVersion: ProductDataVersionV1Schema,
  requestId: z.string().min(8).max(200),
  ownerId: z.string().min(1).max(200),
});
export const ProductDataRequestV1Schema = z.discriminatedUnion('operation', [
  requestBase.extend({
    operation: z.literal('put'),
    idempotencyKey: z.string().min(8).max(200),
    entity: ProductEntityV1Schema,
  }),
  requestBase.extend({
    operation: z.literal('get'),
    entityType: ProductEntityTypeV1Schema,
    entityId: z.string().min(1).max(200),
  }),
  requestBase.extend({
    operation: z.literal('list'),
    entityType: ProductEntityTypeV1Schema,
    sessionId: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  requestBase.extend({
    operation: z.literal('delete'),
    idempotencyKey: z.string().min(8).max(200),
    entityType: ProductEntityTypeV1Schema,
    entityId: z.string().min(1).max(200),
  }),
]);

export const ProductDataErrorCodeV1Schema = z.enum([
  'invalid_request',
  'unauthorised',
  'not_found',
  'idempotency_conflict',
  'storage_unavailable',
]);
const responseBase = z.object({
  schemaVersion: ProductDataVersionV1Schema,
  requestId: z.string().min(8),
});
export const ProductDataResponseV1Schema = z.discriminatedUnion('ok', [
  responseBase.extend({
    ok: z.literal(true),
    result: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('entity'), entity: ProductEntityV1Schema }),
      z.object({ kind: z.literal('list'), entities: z.array(ProductEntityV1Schema) }),
      z.object({ kind: z.literal('deleted'), deleted: z.boolean() }),
    ]),
    idempotentReplay: z.boolean().default(false),
  }),
  responseBase.extend({
    ok: z.literal(false),
    error: z.object({
      code: ProductDataErrorCodeV1Schema,
      message: z.string().min(1).max(500),
      retryable: z.boolean(),
    }),
  }),
]);

export type ProductEntityV1 = z.infer<typeof ProductEntityV1Schema>;
export type ProductDataRequestV1 = z.infer<typeof ProductDataRequestV1Schema>;
export type ProductDataResponseV1 = z.infer<typeof ProductDataResponseV1Schema>;
