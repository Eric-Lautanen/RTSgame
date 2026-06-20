import { Entity } from './entity.js';
import { BUILDINGS } from '../data/buildings.js';
import { THEME } from '../data/theme.js';

export class Foundation extends Entity {
  constructor({ buildingType, x, y, faction }) {
    const def = BUILDINGS[buildingType];
    const fp = def ? Math.floor(def.hp * 0.5) : 99999;
    super({ type: 'foundation', x, y, faction, hp: fp, maxHp: fp, renderLayer: 'buildings' });
    this.buildingType = buildingType;
    this.def = def;
    this.buildProgress = 0;
    this.totalBuildTime = def?.buildTime || 5;
    this.workersAssigned = [];
    this.footprint = def?.footprint || { w: 2, h: 2 };
    this.shape = def?.shape || 'hexagon';
    this.color = def?.color || '#00ffcc';
    this.glowColor = def?.glowColor || '#00ffcc';
    this.scale = def?.scale || 1;
    this.collisionRadius = (def?.scale || 1) * 20;
    this.interactionRadius = this.collisionRadius + 10;
  }

  update(dt) {
    super.update(dt);
    this.workersAssigned = this.workersAssigned.filter(w => w.alive && w.buildTarget === this);
    const numWorkers = this.workersAssigned.length;
    if (numWorkers > 0) {
      const speed = 1 + 0.3 * (numWorkers - 1);
      this.buildProgress += (dt / this.totalBuildTime) * speed;
      if (this.buildProgress >= 1) {
        this.buildProgress = 1;
        this.die();
      }
    }
  }

  render(renderer, ctx) {
    if (!this.alive) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.age * 3);
    const s = this.scale * 20;

    renderer.setGlow(this.glowColor, 8 * pulse);
    ctx.strokeStyle = this.color;
    ctx.globalAlpha = 0.3 + 0.3 * pulse;

    const shape = this.shape;
    const sides = shape === 'hexagon' ? 6 : shape === 'octagon' ? 8 : shape === 'square' ? 4 : 6;
    const drawSides = Math.max(3, Math.ceil(sides * this.buildProgress));

    ctx.lineWidth = 1.5;
    for (let i = 0; i < drawSides; i++) {
      const a = (Math.PI * 2 / sides) * i - Math.PI / 2;
      const nextA = (Math.PI * 2 / sides) * ((i + 1) % sides) - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(this.x + s * Math.cos(a), this.y + s * Math.sin(a));
      ctx.lineTo(this.x + s * Math.cos(nextA), this.y + s * Math.sin(nextA));
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    renderer.clearGlow();

    if (this.buildProgress < 1) {
      const bw = 40;
      const bh = 3;
      const bx = this.x - bw / 2;
      const by = this.y - s - 10;
      ctx.fillStyle = '#55667766';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = THEME.SPECTER_CYAN;
      ctx.fillRect(bx, by, bw * this.buildProgress, bh);
    }
  }
}
