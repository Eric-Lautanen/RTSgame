export class ResourceSystem {
  constructor() {
    this.resources = {
      energy: 500,
      matter: 300,
    };
    this.passiveIncome = {
      energy: 0,
      matter: 0,
    };
    this.incomeMultiplier = 1;
  }

  canAfford(cost) {
    if (!cost) return true;
    for (const [key, val] of Object.entries(cost)) {
      if ((this.resources[key] || 0) < val) return false;
    }
    return true;
  }

  spend(cost) {
    if (!this.canAfford(cost)) return false;
    for (const [key, val] of Object.entries(cost)) {
      this.resources[key] -= val;
    }
    return true;
  }

  refund(cost) {
    if (!cost) return;
    for (const [key, val] of Object.entries(cost)) {
      this.resources[key] = (this.resources[key] || 0) + Math.floor(val * 0.5);
    }
  }

  setSaveDirty(fn) { this._markDirty = fn; }

  addResource(type, amount) {
    if (type !== 'energy' && type !== 'matter') {
      console.warn(`Unknown resource type: "${type}"`);
      return;
    }
    this.resources[type] += amount;
    if (this._markDirty) this._markDirty();
  }

  addPassiveIncome(type, amount) {
    this.passiveIncome[type] = (this.passiveIncome[type] || 0) + amount;
  }

  update(dt) {
    for (const [key, val] of Object.entries(this.passiveIncome)) {
      if (val > 0) {
        this.resources[key] = (this.resources[key] || 0) + val * dt * this.incomeMultiplier;
      }
    }
  }
}
