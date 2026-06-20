import { Entity } from './entity.js';
import { UNITS } from '../data/units.js';
import { THEME } from '../data/theme.js';

export class Unit extends Entity {
  constructor({ type, x, y, faction }) {
    const def = UNITS[type] || UNITS.wraith;
    super({
      type,
      x,
      y,
      faction,
      hp: def.hp,
      maxHp: def.hp,
      renderLayer: 'units',
    });

    this.def = def;
    this.weight = def.weight || 1;
    this.speed = def.speed;
    this.damage = def.damage;
    this.range = def.range;
    this.attackCooldown = 0;
    this.attackSpeed = def.attackSpeed || 1;
    this.target = null;
    this.destination = null;
    this.selected = false;
    this.driftPhase = Math.random() * Math.PI * 2;
    this.killCount = 0;
    this.holdPosition = false;
    this.attackMove = false;
    this.vx = 0;
    this.vy = 0;
    this.maxSpeed = def.speed || 80;
    this.steerStrength = 8;
    this.separationStrength = 120;
    this.arrivalRadius = 8;
    this.radius = 6;
    this.collisionRadius = 6;
    this.interactionRadius = 6;
    this.passable = false;
  }

  update(dt) {
    super.update(dt);

    if (this.attackCooldown > 0) {
      this.attackCooldown -= dt;
    }
  }

  render(renderer, ctx) {
    if (!this.alive) return;

    const def = this.def;
    const drift = renderer.drawGhostDrift(this);
    const cx = this.x;
    const cy = this.y + drift;

    const essenceScale = def.scale * Math.min(1.3, 1 + this.killCount * 0.01);
    const essenceGlow = this.killCount > 0 ? this.killCount * 0.08 : 0;

    renderer.drawSpectralOrb(ctx, cx, cy, def.color, def.glowColor, essenceScale, this.age, this.selected, def.shape, essenceGlow);

    if (this.hp < this.maxHp) {
      const bw = 24 * essenceScale;
      const bh = 3;
      const bx = cx - bw / 2;
      const by = cy - essenceScale * 20;
      renderer.setGlow(THEME.SPECTER_WHITE, 4);
      ctx.fillStyle = '#ff446666';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = THEME.SPECTER_CYAN;
      ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
      renderer.clearGlow();
    }
  }

}