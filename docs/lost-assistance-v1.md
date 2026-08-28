# Lost Assistance V1

Lost Assistance uses a fresh Context Snapshot location and the authenticated user's confirmed product data. It does not collect a route or retain raw location history.

## Supported voice flows

- “Where am I?” reports the nearest confirmed place, straight-line distance, compass direction, and current GPS accuracy.
- “What’s nearby?” lists up to three confirmed places within one kilometre.
- “I’m lost” gives one orientation reference and asks the user to pause somewhere safe and use their normal mobility, navigation, or trusted-contact method.
- “Save this place as gym” captures the current point and requires a separate confirmation before writing it.
- Places can be listed, renamed, moved to the current point, and deleted, each with explicit confirmation for mutations.
- Potholes, uneven surfaces, obstructions, and roadworks can be reported at the current point. Reports require confirmation, expire after 30 days, and can be reviewed, resolved, or deleted.

## Boundaries

Distances use a local Haversine calculation and directions are eight-point compass bearings. These describe relative orientation, not a walkable or accessible route. Frank does not provide turns, infer which side of a road an item is on, direct a road crossing, or claim that a hazard still exists. Hazard reminders always identify the information as a previous, unverified user report.

Places require location accuracy of 100 metres or better. Hazards require 50 metres or better. The stored point includes the accuracy supplied by Android, user-confirmation time, capture provenance, creation and update times, and owner ID. There is no background location permission in this version.
