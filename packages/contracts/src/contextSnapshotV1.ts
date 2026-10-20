import { z } from 'zod';
import { ConfidenceSchema, IsoDateTimeSchema, ImageQualitySchema } from './common.js';

export const ContextSnapshotVersionV1Schema = z.literal('1');
export const ContextProvenanceV1Schema = z
  .object({
    source: z.enum([
      'android_system',
      'android_sensor',
      'android_app',
      'ios_system',
      'ios_sensor',
      'ios_app',
    ]),
    collectedAt: IsoDateTimeSchema,
  })
  .strict();

export function contextValueV1Schema<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion('status', [
    z
      .object({
        status: z.literal('known'),
        value,
        observedAt: IsoDateTimeSchema,
        expiresAt: IsoDateTimeSchema,
        provenance: ContextProvenanceV1Schema,
      })
      .strict(),
    z
      .object({
        status: z.literal('unknown'),
        reason: z.enum(['unavailable', 'not_collected', 'not_supported']),
        provenance: ContextProvenanceV1Schema,
      })
      .strict(),
    z
      .object({
        status: z.literal('denied'),
        permission: z.enum(['microphone', 'camera', 'location', 'activity']),
        provenance: ContextProvenanceV1Schema,
      })
      .strict(),
    z
      .object({
        status: z.literal('stale'),
        lastObservedAt: IsoDateTimeSchema,
        expiredAt: IsoDateTimeSchema,
        provenance: ContextProvenanceV1Schema,
      })
      .strict(),
    z
      .object({
        status: z.literal('conflicting'),
        reason: z.enum(['sensor_disagreement', 'invalid_sequence', 'accuracy_mismatch']),
        sources: z.array(z.string().min(1).max(40)).min(2).max(4),
        provenance: ContextProvenanceV1Schema,
      })
      .strict(),
  ]);
}

const PermissionStateSchema = z.enum(['granted', 'approximate', 'not_requested']);
export const LocationContextV1Schema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().min(0).max(100_000),
    altitudeMeters: z.number().min(-500).max(10_000).optional(),
  })
  .strict();
export const MovementContextV1Schema = z
  .object({
    state: z.enum(['stationary', 'walking', 'vehicle', 'unknown']),
    confidence: ConfidenceSchema,
    speedMetersPerSecond: z.number().min(0).max(150).optional(),
    headingDegrees: z.number().min(0).lt(360).optional(),
  })
  .strict();
export const EvidenceContextV1Schema = z
  .object({
    frameId: z.string().min(8).max(100),
    capturedAt: IsoDateTimeSchema,
    ageMs: z.number().int().min(0).max(60_000),
    quality: z.union([ImageQualitySchema, z.literal('unknown')]),
  })
  .strict();

export const ContextSnapshotV1Schema = z
  .object({
    schemaVersion: ContextSnapshotVersionV1Schema,
    snapshotId: z.string().min(8).max(100),
    sessionId: z.string().min(1).max(200),
    capturedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    time: contextValueV1Schema(
      z
        .object({
          timezone: z.string().min(1).max(80),
          utcOffsetMinutes: z.number().int().min(-840).max(840),
        })
        .strict(),
    ),
    permissions: z
      .object({
        microphone: contextValueV1Schema(PermissionStateSchema),
        camera: contextValueV1Schema(PermissionStateSchema),
        location: contextValueV1Schema(PermissionStateSchema),
        activity: contextValueV1Schema(PermissionStateSchema),
      })
      .strict(),
    device: z
      .object({
        connectivity: contextValueV1Schema(z.enum(['offline', 'limited', 'online'])),
        screen: contextValueV1Schema(z.enum(['interactive', 'locked', 'off'])),
        headphones: contextValueV1Schema(z.boolean()),
        batteryPercent: contextValueV1Schema(z.number().int().min(0).max(100)),
        cameraAvailable: contextValueV1Schema(z.boolean()),
      })
      .strict(),
    app: contextValueV1Schema(
      z
        .object({
          state: z.enum(['idle', 'listening', 'thinking', 'speaking', 'error']),
          sessionOpen: z.boolean(),
        })
        .strict(),
    ),
    location: contextValueV1Schema(LocationContextV1Schema),
    movement: contextValueV1Schema(MovementContextV1Schema),
    evidence: contextValueV1Schema(EvidenceContextV1Schema),
  })
  .strict();

export const SelectedContextFactV1Schema = z
  .object({
    key: z.enum([
      'time',
      'location',
      'movement',
      'connectivity',
      'screen',
      'headphones',
      'battery',
      'camera',
      'microphone_permission',
      'location_permission',
      'app',
      'evidence',
    ]),
    status: z.enum(['known', 'unknown', 'denied', 'stale', 'conflicting']),
    value: z
      .union([
        z.string(),
        z.number(),
        z.boolean(),
        z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
      ])
      .optional(),
  })
  .strict();
export const SelectedContextV1Schema = z
  .object({
    schemaVersion: ContextSnapshotVersionV1Schema,
    snapshotId: z.string().min(8),
    selectedAt: IsoDateTimeSchema,
    facts: z.array(SelectedContextFactV1Schema).max(12),
  })
  .strict();

export type ContextSnapshotV1 = z.infer<typeof ContextSnapshotV1Schema>;
export type SelectedContextV1 = z.infer<typeof SelectedContextV1Schema>;
