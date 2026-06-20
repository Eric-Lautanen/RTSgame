import { Entity } from './entity.js';

const MAX_GATHERERS = 5;

const RESPAWN_DELAY = 15;

export class ResourceNode extends Entity {
  constructor({ type, x, y, amount, resourceType, color, glowColor, scale }) {
    super({
      type,
      x,
      y,
      faction: 'neutral',
      hp: 0,
      maxHp: 0,
      renderLayer: 'buildings',
    });

    this.amount      = amount;
    this.maxAmount   = amount;
    this.resourceType = resourceType;
    this.gatherRate  = 2;
    this.color       = color    || '#00ffcc';
    this.glowColor   = glowColor || '#00ffcc';
    this.gatherers   = [];
    this.scale = scale || 1;
    this._spawnX = x;
    this._spawnY = y;
    this._respawnTimer = 0;

    const visualR = 12 * this.scale;
    this.collisionRadius  = visualR;
    this.interactionRadius = visualR + 24;
    this.passable = false;
  }

  canGather() {
    return this.alive && this.amount > 0 && this.gatherers.length < MAX_GATHERERS;
  }

  addGatherer(worker) {
    if (this.gatherers.length >= MAX_GATHERERS) return false;
    if (this.gatherers.includes(worker)) return true;
    this.gatherers.push(worker);
    return true;
  }

  update(dt) {
    super.update(dt);
    if (this._respawnTimer > 0) {
      this._respawnTimer -= dt;
      if (this._respawnTimer <= 0) {
        this.amount = Math.ceil(this.maxAmount * 0.8);
        let rx = this._spawnX + (Math.random() - 0.5) * 80;
        let ry = this._spawnY + (Math.random() - 0.5) * 80;
        if (this._entities) {
          for (let r = 0; r < 10; r++) {
            let blocked = false;
            for (const e of this._entities.values()) {
              if (e === this || !e.alive || e.passable) continue;
              const dx = e.x - rx;
              const dy = e.y - ry;
              if (e instanceof ResourceNode) {
                if (dx * dx + dy * dy < 192 * 192) { blocked = true; break; }
              }
              if (e.renderLayer === 'buildings' && !e.resourceType) {
                const minDist = (e.collisionRadius || 20) + 20;
                if (dx * dx + dy * dy < minDist * minDist) { blocked = true; break; }
              }
            }
            if (!blocked) break;
            rx = this._spawnX + (Math.random() - 0.5) * 80;
            ry = this._spawnY + (Math.random() - 0.5) * 80;
          }
        }
        this.x = rx;
        this.y = ry;
        this.alive = true;
        this._respawnTimer = 0;
      }
      return;
    }
    if (this.amount <= 0 && this.alive) {
      this.alive = false;
      this.gatherers = [];
      this._respawnTimer = RESPAWN_DELAY + Math.random() * 5;
    }
    this.gatherers = this.gatherers.filter(w => w.alive && (w.targetNode === this || w._assignedNode === this));
  }

  render(renderer, ctx) {
    if (!this.alive) return;
    const fullness = Math.max(0.2, this.amount / this.maxAmount);
    const pulse = 0.7 + 0.3 * Math.sin(this.age * 2);
    const s = 12 * this.scale * fullness;

    renderer.setGlow(this.glowColor, 15 * pulse);
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
    ctx.globalAlpha = 0.15 * pulse;

    for (let i = 0; i < 5; i++) {
      const angle = (Math.PI * 2 / 5) * i + this.age * 0.5;
      const px = this.x + Math.cos(angle) * s;
      const py = this.y + Math.sin(angle) * s;
      ctx.beginPath();
      ctx.arc(px, py, 3 * fullness, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    renderer.clearGlow();
  }
}