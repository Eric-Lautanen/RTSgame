import { ResourceNode } from '../entities/resource.js';

export class EconomySystem {
  constructor(resourceSystem) {
    this.resources = resourceSystem;
  }

  update(entities, dt) {
    // Economy update is handled by the ResourceSystem directly
  }

  findNearestNode(x, y, type, entities) {
    let nearest = null;
    let minDist = Infinity;
    for (const entity of entities.values()) {
      if (!entity.alive || !(entity instanceof ResourceNode)) continue;
      if (entity.amount <= 0) continue;
      if (type && entity.resourceType !== type) continue;
      const dx = entity.x - x;
      const dy = entity.y - y;
      const dist = dx * dx + dy * dy;
      if (dist < minDist) {
        minDist = dist;
        nearest = entity;
      }
    }
    return nearest;
  }

  findNearestDropOff(x, y, faction, entities) {
    let nearest = null;
    let minDist = Infinity;
    for (const entity of entities.values()) {
      if (!entity.alive || entity.faction !== faction || entity.renderLayer !== 'buildings') continue;
      const type = entity.type;
      if (type === 'nexus' || type === 'supply_depot') {
        const dx = entity.x - x;
        const dy = entity.y - y;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
          minDist = dist;
          nearest = entity;
        }
      }
    }
    return nearest;
  }
}
