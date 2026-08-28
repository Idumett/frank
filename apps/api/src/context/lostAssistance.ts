import crypto from 'node:crypto';
import type { ProductEntityV1, SelectedContextV1 } from '@frank/contracts';
import type { ProductDataPort } from '../productData/ProductDataPort.js';

type Location = { latitude: number; longitude: number; accuracyMeters: number };
type Place = Extract<ProductEntityV1, { entityType: 'known_place' }>;
type Hazard = Extract<ProductEntityV1, { entityType: 'hazard' }>;
type Pending =
  | { kind: 'save_place'; expiresAt: number; name: string; location: Location; capturedAt: string }
  | { kind: 'save_hazard'; expiresAt: number; hazardType: Hazard['hazardType']; description: string; location: Location; capturedAt: string }
  | { kind: 'delete'; expiresAt: number; entityType: 'known_place' | 'hazard'; id: string; label: string }
  | { kind: 'rename'; expiresAt: number; place: Place; name: string }
  | { kind: 'relocate'; expiresAt: number; place: Place; location: Location; capturedAt: string }
  | { kind: 'resolve'; expiresAt: number; hazard: Hazard };

export type LostAssistanceResult = { speak: string; action: string; data?: Record<string, unknown> };

export class LostAssistanceSession {
  private pending: Pending | null = null;

  constructor(private readonly store: ProductDataPort, private readonly ownerId: string) {}

  handle(text: string, context: SelectedContextV1 | undefined, requestId: string): LostAssistanceResult | null {
    const utterance = text.trim();
    const lower = utterance.toLowerCase();
    const location = selectedLocation(context);

    if (this.pending) {
      if (this.pending.expiresAt <= Date.now()) this.pending = null;
      else if (/^(yes|yeah|yep|confirm|do it|correct|that's right)\b/i.test(utterance))
        return this.confirm(requestId);
      else if (/^(no|nope|cancel|don't|do not|stop)\b/i.test(utterance)) {
        this.pending = null;
        return { speak: 'Cancelled.', action: 'confirmation_cancelled' };
      }
    }

    const savePlace = lower.match(/\b(?:save|remember)\s+(?:this\s+|here\s+as\s+|this\s+place\s+as\s+|place\s+as\s+)?(?:place\s+)?(?:as\s+)?([a-z][a-z0-9 '&-]{0,79})$/i);
    if (savePlace && !/\b(pothole|hazard|obstruction|roadworks|uneven)\b/i.test(lower)) {
      if (!location) return locationUnavailable('save that place');
      if (location.accuracyMeters > 100) return inaccurate(location, 'save a place');
      const name = cleanName(savePlace[1]);
      const existing = this.findPlace(name);
      if (existing) {
        this.pending = { kind: 'relocate', expiresAt: Date.now() + 120_000, place: existing, location, capturedAt: new Date().toISOString() };
        return { speak: `${name} is already saved. Update it to this location?`, action: 'confirm_relocate_place' };
      }
      this.pending = { kind: 'save_place', expiresAt: Date.now() + 120_000, name, location, capturedAt: new Date().toISOString() };
      return { speak: `Save this location as ${name}?`, action: 'confirm_save_place' };
    }

    const hazardType = parseHazard(lower);
    if (hazardType && /\b(remember|report|save|there is|there's)\b/i.test(lower)) {
      if (!location) return locationUnavailable('save that hazard');
      if (location.accuracyMeters > 50) return inaccurate(location, 'save a hazard');
      const description = hazardDescription(hazardType, utterance);
      this.pending = { kind: 'save_hazard', expiresAt: Date.now() + 120_000, hazardType, description, location, capturedAt: new Date().toISOString() };
      return { speak: `Remember a ${description} near here for 30 days?`, action: 'confirm_save_hazard' };
    }

    const rename = utterance.match(/\b(?:rename|change)\s+(.{1,80}?)\s+to\s+(.{1,80})$/i);
    if (rename) {
      const place = this.findPlace(rename[1]);
      if (!place) return { speak: `I couldn't find a saved place called ${cleanName(rename[1])}.`, action: 'not_found' };
      const name = cleanName(rename[2]);
      this.pending = { kind: 'rename', expiresAt: Date.now() + 120_000, place, name };
      return { speak: `Rename ${place.name} to ${name}?`, action: 'confirm_rename_place' };
    }

    const relocate = utterance.match(/\b(?:update|move|correct)\s+(.{1,80}?)\s+(?:to\s+)?(?:this location|here)$/i);
    if (relocate) {
      const place = this.findPlace(relocate[1]);
      if (!place) return { speak: `I couldn't find a saved place called ${cleanName(relocate[1])}.`, action: 'not_found' };
      if (!location) return locationUnavailable(`update ${place.name}`);
      if (location.accuracyMeters > 100) return inaccurate(location, 'update a place');
      this.pending = { kind: 'relocate', expiresAt: Date.now() + 120_000, place, location, capturedAt: new Date().toISOString() };
      return { speak: `Update ${place.name} to this location?`, action: 'confirm_relocate_place' };
    }

    const resolve = utterance.match(/\b(?:mark\s+)?(.{1,100}?)\s+(?:as\s+)?resolved$/i);
    if (resolve) {
      const hazard = this.findHazard(resolve[1]);
      if (!hazard) return { speak: `I couldn't find that active hazard report.`, action: 'not_found' };
      this.pending = { kind: 'resolve', expiresAt: Date.now() + 120_000, hazard };
      return { speak: `Mark ${hazard.description} as resolved?`, action: 'confirm_resolve_hazard' };
    }

    const remove = utterance.match(/\b(?:delete|forget|remove)\s+(?:the\s+)?(?:saved\s+)?(?:place\s+|hazard\s+)?(.{1,100})$/i);
    if (remove) {
      const label = cleanName(remove[1]);
      const entity = this.findPlace(label) ?? this.findHazard(label);
      if (!entity) return { speak: `I couldn't find ${label} in your saved places or hazards.`, action: 'not_found' };
      this.pending = { kind: 'delete', expiresAt: Date.now() + 120_000, entityType: entity.entityType, id: entity.id, label: entity.entityType === 'known_place' ? entity.name : entity.description };
      return { speak: `Delete ${this.pending.label}?`, action: 'confirm_delete' };
    }

    if (/\b(?:what|which|list|review|show)\b.*\b(saved places|known places|places i|places)\b/i.test(lower))
      return this.reviewPlaces();
    if (/\b(?:what|which|list|review|show)\b.*\b(hazards|potholes)\b/i.test(lower))
      return this.reviewHazards();
    if (/\bwhat(?:'s| is) nearby\b|\bnear me\b|\bnearby places\b/i.test(lower))
      return this.nearby(location);
    if (/\bwhere am i\b|\bmy location\b/i.test(lower)) return this.whereAmI(location);
    if (/\b(?:i am|i'm|im) lost\b|\bhelp me get back\b/i.test(lower)) return this.lost(location);
    return null;
  }

  private confirm(requestId: string): LostAssistanceResult {
    const pending = this.pending!;
    this.pending = null;
    const now = new Date().toISOString();
    if (pending.kind === 'delete') {
      const response = this.execute({ operation: 'delete', requestId, idempotencyKey: requestId, entityType: pending.entityType, entityId: pending.id });
      return response.ok && response.result.kind === 'deleted' && response.result.deleted
        ? { speak: `${pending.label} has been deleted.`, action: 'deleted' }
        : { speak: `I couldn't delete ${pending.label}.`, action: 'storage_error' };
    }
    if (pending.kind === 'rename') {
      const entity: Place = { ...pending.place, name: pending.name, updatedAt: now, provenance: provenance(requestId, now) };
      const response = this.execute({ operation: 'put', requestId, idempotencyKey: requestId, entity });
      return response.ok ? { speak: `Saved. ${pending.place.name} is now called ${pending.name}.`, action: 'place_renamed' } : storageFailure();
    }
    if (pending.kind === 'relocate') {
      const entity: Place = { ...pending.place, location: pending.location, updatedAt: now, confirmation: { confirmedBy: 'user', confirmedAt: now }, provenance: provenance(requestId, pending.capturedAt) };
      const response = this.execute({ operation: 'put', requestId, idempotencyKey: requestId, entity });
      return response.ok ? { speak: `Updated ${pending.place.name} to this location.`, action: 'place_relocated' } : storageFailure();
    }
    if (pending.kind === 'resolve') {
      const entity: Hazard = { ...pending.hazard, status: 'resolved', updatedAt: now, confirmation: { confirmedBy: 'user', confirmedAt: now }, provenance: provenance(requestId, now) };
      const response = this.execute({ operation: 'put', requestId, idempotencyKey: requestId, entity });
      return response.ok ? { speak: `Marked ${pending.hazard.description} as resolved.`, action: 'hazard_resolved' } : storageFailure();
    }
    if (pending.kind === 'save_place') {
      const entity: Place = { schemaVersion: '1', entityType: 'known_place', id: `place-${crypto.randomUUID()}`, ownerId: this.ownerId, createdAt: now, updatedAt: now, provenance: provenance(requestId, pending.capturedAt), name: pending.name, category: category(pending.name), location: pending.location, confirmation: { confirmedBy: 'user', confirmedAt: now }, status: 'active' };
      const response = this.execute({ operation: 'put', requestId, idempotencyKey: requestId, entity });
      return response.ok ? { speak: `Saved ${pending.name}.`, action: 'place_saved' } : storageFailure();
    }
    const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
    const entity: Hazard = { schemaVersion: '1', entityType: 'hazard', id: `hazard-${crypto.randomUUID()}`, ownerId: this.ownerId, createdAt: now, updatedAt: now, provenance: provenance(requestId, pending.capturedAt), hazardType: pending.hazardType, description: pending.description, location: pending.location, radiusMeters: 12, reportedAt: now, expiresAt: expiry, confirmation: { confirmedBy: 'user', confirmedAt: now }, status: 'active' };
    const response = this.execute({ operation: 'put', requestId, idempotencyKey: requestId, entity });
    return response.ok ? { speak: `Saved. I'll treat the ${pending.description} as a user report for 30 days.`, action: 'hazard_saved' } : storageFailure();
  }

  private whereAmI(location: Location | null) {
    if (!location) return locationUnavailable('work out where you are');
    const places = this.places().map((place) => ({ place, ...relative(location, place.location) })).sort(byDistance);
    const nearest = places[0];
    const hazard = this.nearHazard(location);
    if (!nearest) return { speak: `Your current location is available to about ${roundDistance(location.accuracyMeters)}, but you have no saved places nearby yet.${hazard}`, action: 'location_only' };
    const atThreshold = Math.max(30, location.accuracyMeters + nearest.place.location.accuracyMeters);
    const position = nearest.distanceMeters <= atThreshold
      ? `You appear to be at or near ${nearest.place.name}`
      : `You are about ${roundDistance(nearest.distanceMeters)} ${nearest.direction} of ${nearest.place.name}`;
    return { speak: `${position}. Location accuracy is about ${roundDistance(location.accuracyMeters)}.${hazard}`, action: 'location_assistance', data: { nearestPlaceId: nearest.place.id, distanceMeters: Math.round(nearest.distanceMeters) } };
  }

  private nearby(location: Location | null) {
    if (!location) return locationUnavailable('check nearby saved places');
    const nearby = this.places().map((place) => ({ place, ...relative(location, place.location) })).filter((item) => item.distanceMeters <= 1_000).sort(byDistance).slice(0, 3);
    if (!nearby.length) return { speak: `I don't have any user-confirmed places within one kilometre.${this.nearHazard(location)}`, action: 'no_nearby_places' };
    const list = nearby.map((item) => `${item.place.name}, about ${roundDistance(item.distanceMeters)} ${item.direction}`).join('; ');
    return { speak: `Nearby saved places: ${list}.${this.nearHazard(location)}`, action: 'nearby_places' };
  }

  private lost(location: Location | null) {
    if (!location) return { speak: `I can't access a current location. Pause somewhere safe and use your normal mobility or navigation method, or contact someone you trust.`, action: 'lost_location_unavailable' };
    const nearest = this.places().map((place) => ({ place, ...relative(location, place.location) })).sort(byDistance)[0];
    if (!nearest) return { speak: `I have your approximate location, but no confirmed place to orient you from. Pause somewhere safe and use your normal mobility or navigation method, or contact someone you trust.${this.nearHazard(location)}`, action: 'lost_no_known_place' };
    return { speak: `The nearest saved place is ${nearest.place.name}, about ${roundDistance(nearest.distanceMeters)} ${nearest.direction}. This is orientation only, not a route. Pause somewhere safe and use your normal mobility or navigation method to get there.${this.nearHazard(location)}`, action: 'lost_recovery' };
  }

  private reviewPlaces() {
    const places = this.places();
    return places.length ? { speak: `Your saved places are ${places.map((place) => place.name).join(', ')}. You can rename or delete any of them.`, action: 'places_reviewed' } : { speak: `You haven't saved any places yet.`, action: 'places_empty' };
  }

  private reviewHazards() {
    const hazards = this.hazards();
    return hazards.length ? { speak: `Your active user-reported hazards are ${hazards.map((hazard) => hazard.description).join(', ')}. You can delete any report.`, action: 'hazards_reviewed' } : { speak: `You have no active user-reported hazards.`, action: 'hazards_empty' };
  }

  private nearHazard(location: Location) {
    const item = this.hazards().map((hazard) => ({ hazard, ...relative(location, hazard.location) })).filter(({ hazard, distanceMeters }) => distanceMeters <= hazard.radiusMeters + location.accuracyMeters + hazard.location.accuracyMeters).sort(byDistance)[0];
    return item ? ` You previously reported ${article(item.hazard.description)} near here. Its exact position and current condition are unverified, so use your usual mobility method.` : '';
  }

  private places() { return this.list('known_place').filter((entity): entity is Place => entity.entityType === 'known_place' && entity.status === 'active'); }
  private hazards() { const now = Date.now(); return this.list('hazard').filter((entity): entity is Hazard => entity.entityType === 'hazard' && entity.status === 'active' && Date.parse(entity.expiresAt) > now); }
  private findPlace(name: string) { const wanted = cleanName(name).toLowerCase(); return this.places().find((place) => place.name.toLowerCase() === wanted); }
  private findHazard(label: string) { const wanted = cleanName(label).toLowerCase(); return this.hazards().find((hazard) => hazard.description.toLowerCase().includes(wanted) || hazard.hazardType.replace('_', ' ') === wanted); }
  private list(entityType: 'known_place' | 'hazard') { const response = this.execute({ operation: 'list', requestId: crypto.randomUUID(), entityType, limit: 100 }); return response.ok && response.result.kind === 'list' ? response.result.entities : []; }
  private execute(request: any) { return this.store.execute(this.ownerId, { schemaVersion: '1', ownerId: this.ownerId, ...request }); }
}

function selectedLocation(context?: SelectedContextV1): Location | null {
  const fact = context?.facts.find((item) => item.key === 'location');
  if (fact?.status !== 'known' || typeof fact.value !== 'object' || !fact.value) return null;
  const value = fact.value as Record<string, unknown>;
  return typeof value.latitude === 'number' && typeof value.longitude === 'number' && typeof value.accuracyMeters === 'number' ? value as Location : null;
}
function relative(from: Location, to: Location) { const lat1 = radians(from.latitude); const lat2 = radians(to.latitude); const dLat = lat2 - lat1; const dLon = radians(to.longitude - from.longitude); const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2; const distanceMeters = 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); const y = Math.sin(dLon) * Math.cos(lat2); const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon); const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; return { distanceMeters, direction: compass(bearing) }; }
function compass(bearing: number) { return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(bearing / 45) % 8]; }
function radians(value: number) { return value * Math.PI / 180; }
function byDistance(a: { distanceMeters: number }, b: { distanceMeters: number }) { return a.distanceMeters - b.distanceMeters; }
function roundDistance(meters: number) { if (meters < 20) return '20 metres'; if (meters < 1_000) return `${Math.round(meters / 10) * 10} metres`; return `${(meters / 1_000).toFixed(1)} kilometres`; }
function cleanName(value: string) { return value.trim().replace(/[?.!,]+$/, '').replace(/\s+/g, ' '); }
function category(name: string): Place['category'] { const value = name.toLowerCase(); return /\bhome|house\b/.test(value) ? 'home' : /\bgym|fitness\b/.test(value) ? 'gym' : /\bsupermarket|grocery|shop\b/.test(value) ? 'supermarket' : 'other'; }
function parseHazard(text: string): Hazard['hazardType'] | null { if (/\bpothole\b/.test(text)) return 'pothole'; if (/\buneven\b/.test(text)) return 'uneven_surface'; if (/\bobstruction|blocked|barrier\b/.test(text)) return 'obstruction'; if (/\broadworks|construction\b/.test(text)) return 'roadworks'; if (/\bhazard\b/.test(text)) return 'other'; return null; }
function hazardDescription(type: Hazard['hazardType'], text: string) { const base = type.replace('_', ' '); const match = text.match(/\b(?:pothole|uneven surface|obstruction|roadworks|hazard)\b.{0,80}/i); return cleanName(match?.[0] ?? base).slice(0, 300).toLowerCase(); }
function article(value: string) { return /^[aeiou]/i.test(value) ? `an ${value}` : `a ${value}`; }
function provenance(requestId: string, capturedAt: string) { return { source: 'frank_server' as const, requestId, capturedAt }; }
function locationUnavailable(action: string): LostAssistanceResult { return { speak: `I can't access a current location to ${action}. Frank still works without location; you can enable location permission when you want this feature.`, action: 'location_unavailable' }; }
function inaccurate(location: Location, action: string): LostAssistanceResult { return { speak: `Location accuracy is about ${roundDistance(location.accuracyMeters)}, which isn't precise enough to ${action} safely. Try again where the phone has a clearer location signal.`, action: 'location_inaccurate' }; }
function storageFailure(): LostAssistanceResult { return { speak: `I couldn't save that change. Please try again.`, action: 'storage_error' }; }
