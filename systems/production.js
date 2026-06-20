import { UNITS } from '../data/units.js';
import { AGE_ORDER } from '../data/ages.js';

export class ProductionSystem {
  constructor(resourceSystem) {
    this.resources = resourceSystem;
    this.pendingSpawns = [];
    this.productionMultiplier = 1;
    this.factionAge = 'spectral_dawn';
    this.advancingAge = false;
  }

  canQueue(entity, unitType, entities) {
    const def = UNITS[unitType];
    if (!def) return false;
    if (!this.resources.canAfford(def.cost)) return false;
    if (unitType === 'builder') {
      let builderExists = false;
      for (const e of entities.values()) {
        if (e.alive && e.type === 'builder' && e.faction === 'player') {
          builderExists = true;
          break;
        }
      }
      if (builderExists) return false;
    }
    if (def.requiresAge) {
      if (AGE_ORDER.indexOf(this.factionAge) < AGE_ORDER.indexOf(def.requiresAge)) return false;
    }
    if (def.requiresBuilding && def.requiresBuilding.length > 0) {
      for (const req of def.requiresBuilding) {
        let found = false;
        for (const e of entities.values()) {
          if (e.alive && e.type === req && e.renderLayer === 'buildings' && e.faction === 'player') { found = true; break; }
        }
        if (!found) return false;
      }
    }
    return true;
  }

  queueUnit(entity, unitType) {
    const def = UNITS[unitType];
    if (!def) return false;
    if (entity.type === 'nexus' && this.advancingAge) return false;
    if (!this.resources.spend(def.cost)) return false;
    entity.productionQueue.push(unitType);
    if (entity.productionTimer <= 0) {
      entity.productionTimer = (def.buildTime || 5) * this.productionMultiplier;
    }
    return true;
  }

  cancelQueue(entity, index = 0) {
    if (index < 0 || index >= entity.productionQueue.length) return;
    const unitType = entity.productionQueue.splice(index, 1)[0];
    const def = UNITS[unitType];
    if (def && def.cost) {
      this.resources.refund(def.cost);
    }
  }

  update(entities, dt) {
    for (const entity of entities.values()) {
      if (!entity.alive || !entity.productionQueue) continue;

      if (entity.productionQueue.length > 0) {
        if (entity.powered === false) continue;
        entity.productionTimer -= dt;
        if (entity.productionTimer <= 0) {
          const unitType = entity.productionQueue.shift();
          const def = UNITS[unitType];
          const spawnX = entity.x + 40 + (Math.random() - 0.5) * 20;
          const spawnY = entity.y + 40 + (Math.random() - 0.5) * 20;
          this.pendingSpawns.push({
            type: unitType,
            x: spawnX,
            y: spawnY,
            faction: entity.faction,
            rallyPoint: entity.rallyPoint,
          });
          entity.productionTimer = def ? (def.buildTime || 5) * this.productionMultiplier : 5;
        }
      }
    }
  }

  flushSpawns() {
    const spawns = this.pendingSpawns;
    this.pendingSpawns = [];
    return spawns;
  }
}
