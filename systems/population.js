import { AGES } from '../data/ages.js';

export class PopulationSystem {
  constructor() {
    this.popCap = 10;
    this.factionAge = 'spectral_dawn';
  }

  getCurrentPop(entities) {
    let pop = 0;
    for (const entity of entities.values()) {
      if (!entity.alive || entity.faction !== 'player') continue;
      if (entity.renderLayer !== 'units') continue;
      pop += entity.def?.supplyCost || 1;
    }
    return pop;
  }

  getPopCap(entities) {
    let cap = 10;
    for (const entity of entities.values()) {
      if (!entity.alive || entity.faction !== 'player') continue;
      if (entity.renderLayer !== 'buildings') continue;
      cap += entity.def?.supplyProvided || 0;
    }
    return cap;
  }

  getUnitCount(type, entities) {
    let count = 0;
    for (const entity of entities.values()) {
      if (entity.alive && entity.faction === 'player' && entity.type === type) count++;
      if (entity.alive && entity.productionQueue) {
        for (const q of entity.productionQueue) {
          if (q === type) count++;
        }
      }
    }
    return count;
  }

  getUnitCap(type) {
    const ageDef = AGES[this.factionAge];
    return ageDef?.unitCaps?.[type] || Infinity;
  }

  canProduce(entities, supplyCost, type) {
    if (this.getCurrentPop(entities) + supplyCost > this.getPopCap(entities)) return false;
    if (type) {
      const cap = this.getUnitCap(type);
      if (cap !== Infinity && this.getUnitCount(type, entities) >= cap) return false;
    }
    return true;
  }

  update(entities, dt) {
    let cap = 10;
    let pop = 0;
    for (const entity of entities.values()) {
      if (!entity.alive || entity.faction !== 'player') continue;
      if (entity.renderLayer === 'units') {
        pop += entity.def?.supplyCost || 1;
      } else if (entity.renderLayer === 'buildings') {
        cap += entity.def?.supplyProvided || 0;
      }
    }
    this._lastPop = pop;
    this.popCap = cap;
  }
}