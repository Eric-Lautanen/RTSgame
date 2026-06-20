import { Entity } from './entity.js';
import { BUILDINGS } from '../data/buildings.js';
import { THEME } from '../data/theme.js';

export class Building extends Entity {
  constructor({ type, x, y, faction }) {
    const def = BUILDINGS[type];
    super({
      type,
      x,
      y,
      faction,
      hp: def.hp,
      maxHp: def.hp,
      renderLayer: 'buildings',
    });

    this.def = def;
    this.footprint = def.footprint || { w: 2, h: 2 };
    this.buildTime = def.buildTime || 5;
    this.buildProgress = 1;
    this.productionQueue = [];
    this.productionTimer = 0;
    this.rallyPoint = { x: x + 40, y: y + 40 };
    this.selected = false;
    this.level = 1;
    this.maxLevel = 3;
    this.powered = true;
    this.powerRadius = def.powerRadius || 0;
    this.upgrading = false;
    this.upgradeTimer = 0;
    this.upgradeDuration = def.upgradeTime || 8;
    this._upgradeJustCompleted = false;

    // Combat stats — only turrets and defensive buildings use these
    this.damage = def.damage || 0;
    this.range = def.range || 0;
    this.attackSpeed = def.attackSpeed || 0;
    this.attackCooldown = 0;
    this.target = null;
    this.holdPosition = false;
    this.attackMove = false;

    // Visual radius is def.scale * 20 (matches the `s` variable in render()).
    // interactionRadius is slightly larger so units stop just outside the shell.
    const visualR = (def.scale || 1) * 20;
    this.collisionRadius = visualR;
    this.interactionRadius = visualR + 10;
    this.passable = false;
  }

  produce(unitType) {
    this.productionQueue.push(unitType);
  }

  canUpgrade(rs) {
    if (this.level >= this.maxLevel) return false;
    if (this.upgrading) return false;
    const cost = this._getUpgradeCost();
    return !rs || rs.canAfford(cost);
  }

  startUpgrade(rs) {
    if (this.level >= this.maxLevel) return false;
    if (this.upgrading) return false;
    const cost = this._getUpgradeCost();
    if (rs && !rs.canAfford(cost)) return false;
    if (rs) rs.spend(cost);
    this.upgrading = true;
    this.upgradeTimer = this.upgradeDuration;
    return true;
  }

  _getUpgradeCost() {
    const base = this.def.upgradeCost || { energy: 200, matter: 150 };
    return {
      energy: Math.floor(base.energy * this.level),
      matter: Math.floor(base.matter * this.level),
    };
  }

  _applyUpgrade() {
    this.level++;
    const hpBonus = 1 + (this.level - 1) * 0.2;
    this.maxHp = Math.floor(this.def.hp * hpBonus);
    this.hp = this.maxHp;
    this.upgrading = false;
    this.upgradeTimer = 0;
    this._upgradeJustCompleted = true;
  }

  canScuttle() {
    return this.def?.scuttleable !== false;
  }

  scuttle(resources) {
    if (!this.alive || !this.canScuttle()) return;
    const def = this.def;
    if (def && def.cost && resources) {
      resources.refund(def.cost);
    }
    this.die();
  }

  setResourceSystem(rs) {
    this._resources = rs;
  }

  update(dt) {
    super.update(dt);
    if (this.upgrading) {
      this.upgradeTimer -= dt;
      if (this.upgradeTimer <= 0) {
        this._applyUpgrade();
      }
    }
  }

  render(renderer, ctx) {
    if (!this.alive) return;

    const def = this.def;
    const pulse = 0.7 + 0.3 * Math.sin(this.age * 2);
    const s = def.scale * 20;

    const shape = def.shape || 'hexagon';
    const sides = shape === 'hexagon' ? 6 : shape === 'octagon' ? 8 : shape === 'square' ? 4 : 6;

    renderer.setGlow(def.glowColor, 16 * pulse);
    ctx.strokeStyle = def.color;
    ctx.fillStyle = def.color;
    ctx.globalAlpha = 0.08 * pulse;
    this._drawPoly(ctx, this.x, this.y, sides, s, 0);
    ctx.fill();
    ctx.globalAlpha = 1;
    renderer.clearGlow();

    renderer.setGlow(def.glowColor, 8 * pulse);
    ctx.strokeStyle = def.color;
    ctx.globalAlpha = 0.4 + 0.3 * pulse;
    ctx.lineWidth = 1.5;
    this._drawPoly(ctx, this.x, this.y, sides, s * 0.85, this.age * 0.3);
    ctx.stroke();
    renderer.clearGlow();

    const innerRot = -this.age * 0.5;
    ctx.strokeStyle = def.glowColor;
    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(this.age * 3);
    ctx.lineWidth = 1;
    this._drawPoly(ctx, this.x, this.y, sides, s * 0.45, innerRot);
    ctx.stroke();

    const coreR = s * 0.15 * (0.8 + 0.2 * Math.sin(this.age * 4));
    renderer.setGlow(def.glowColor, 12 * pulse);
    ctx.fillStyle = def.glowColor;
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(this.age * 2);
    ctx.beginPath();
    ctx.arc(this.x, this.y, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    renderer.clearGlow();

    for (let i = 0; i < 3; i++) {
      const a = (Math.PI * 2 / 3) * i + this.age * 1.5;
      const dist = s * 0.6 + Math.sin(this.age * 2 + i) * 6;
      ctx.fillStyle = def.glowColor;
      ctx.globalAlpha = (0.2 + 0.15 * Math.sin(this.age * 3 + i * 2)) * pulse;
      ctx.beginPath();
      ctx.arc(this.x + Math.cos(a) * dist, this.y + Math.sin(a) * dist, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (this.level > 1) {
      for (let i = 0; i < this.level - 1; i++) {
        const ringR = s * 0.3 + i * 6;
        ctx.strokeStyle = THEME.UI_GOLD;
        ctx.globalAlpha = 0.15 + 0.1 * Math.sin(this.age * 2 + i);
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    if (!this.powered) {
      ctx.fillStyle = '#ff446688';
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      ctx.arc(this.x, this.y, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (this.selected) {
      renderer.setGlow(THEME.SPECTER_CYAN, 25);
      ctx.strokeStyle = THEME.SPECTER_CYAN;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      ctx.strokeRect(this.x - s, this.y - s, s * 2, s * 2);
      ctx.globalAlpha = 1;
      renderer.clearGlow();
    }

    if (this.buildProgress < 1) {
      const bw = 40;
      const bh = 3;
      const bx = this.x - bw / 2;
      const by = this.y - 30;
      ctx.fillStyle = '#55667766';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = THEME.SPECTER_CYAN;
      ctx.fillRect(bx, by, bw * this.buildProgress, bh);
    }

    if (this.hp < this.maxHp) {
      const bw = 40;
      const bh = 3;
      const bx = this.x - bw / 2;
      const by = this.y - 35;
      renderer.setGlow(THEME.SPECTER_WHITE, 4);
      ctx.fillStyle = '#ff446666';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = THEME.SPECTER_CYAN;
      ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
      renderer.clearGlow();
    }

    if (this.productionQueue.length > 0) {
      const count = Math.min(this.productionQueue.length, 5);
      const startX = this.x - (count - 1) * 5;
      for (let i = 0; i < count; i++) {
        ctx.fillStyle = THEME.SPECTER_CYAN;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(startX + i * 10, this.y + def.scale * 22 + 6, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  _drawPoly(ctx, cx, cy, sides, radius, rotation) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = (Math.PI * 2 / sides) * i - Math.PI / 2 + rotation;
      const px = cx + radius * Math.cos(a);
      const py = cy + radius * Math.sin(a);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
}