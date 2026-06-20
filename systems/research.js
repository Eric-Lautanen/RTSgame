import { AGE_ORDER } from '../data/ages.js';
import { UPGRADES } from '../data/upgrades.js';

export class ResearchSystem {
  constructor() {
    this.queue = [];
    this.completed = new Set();
    this.upgradeLevels = {
      weapons: 0,
      armor: 0,
      gathering: 0,
      production: 0,
      energy: 0,
    };
  }

  canResearch(upgrade, factionAge, entities) {
    if (this.completed.has(upgrade.name)) return false;
    if (upgrade.requiresAge && AGE_ORDER.indexOf(factionAge) < AGE_ORDER.indexOf(upgrade.requiresAge)) return false;
    if (upgrade.requiresBuilding) {
      let found = false;
      for (const e of entities.values()) {
        if (e.alive && e.type === upgrade.requiresBuilding && e.renderLayer === 'buildings' && e.faction === 'player') { found = true; break; }
      }
      if (!found) return false;
    }
    return true;
  }

  queueResearch(upgrade) {
    this.queue.push({ ...upgrade, timer: upgrade.researchTime });
  }

  update(dt) {
    if (this.queue.length === 0) return null;
    const current = this.queue[0];
    current.timer -= dt;
    if (current.timer <= 0) {
      this.queue.shift();
      this.completed.add(current.name);
      this.upgradeLevels[current.category] = (this.upgradeLevels[current.category] || 0) + 1;
      return current;
    }
    return null;
  }

  getStatMultiplier(category) {
    const level = this.upgradeLevels[category] || 0;
    if (level === 0) return 1;
    // Find the highest completed upgrade in this category and return its effect
    let mult = 1;
    for (const [key, upgrade] of Object.entries(UPGRADES)) {
      if (upgrade.category === category && upgrade.level === level && this.completed.has(upgrade.name)) {
        for (const effect of upgrade.effects) {
          const v = effect.value;
          if (effect.type === 'production_mult') { mult *= v; }
          else { mult *= v; }
        }
        break;
      }
    }
    return mult;
  }
}
