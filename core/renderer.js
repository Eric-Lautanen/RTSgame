import { THEME } from '../data/theme.js';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../data/world.js';

export class Renderer {
  constructor(ctx, camera) {
    this.ctx = ctx;
    this.camera = camera;
    this._trails = new Map();
    this._stars = this._generateStars(500);
    this._nebula = this._generateNebula(12);
    this._nebulaCanvas = null;
    this._nebulaNeedsRedraw = true;
    this.glowEnabled = false;
  }

  _generateStars(count) {
    const stars = [];
    const tints = [THEME.SPECTER_WHITE, THEME.SPECTER_CYAN, THEME.SPECTER_PURPLE];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * MAP_WIDTH,
        y: Math.random() * MAP_HEIGHT,
        r: 0.3 + Math.random() * 1.5,
        a: 0.15 + Math.random() * 0.5,
        speed: 0.3 + Math.random() * 0.8,
        phase: Math.random() * Math.PI * 2,
        color: tints[Math.floor(Math.random() * tints.length)],
      });
    }
    return stars;
  }

  clear() {
    const ctx = this.ctx;
    ctx.fillStyle = THEME.VOID;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  _getVisibleBounds() {
    const c = this.camera;
    const cw = this.ctx.canvas.width;
    const ch = this.ctx.canvas.height;
    const halfW = (cw / 2) / c.zoom;
    const halfH = (ch / 2) / c.zoom;
    const margin = 150;
    return {
      x1: c.x - halfW - margin,
      y1: c.y - halfH - margin,
      x2: c.x + halfW + margin,
      y2: c.y + halfH + margin,
    };
  }

  _isVisible(entity, bounds) {
    const radius = entity.collisionRadius || (entity.def?.scale || 1) * 25;
    return entity.x + radius >= bounds.x1 && entity.x - radius <= bounds.x2
        && entity.y + radius >= bounds.y1 && entity.y - radius <= bounds.y2;
  }

  setGlow(color, blur) {
    if (this.glowEnabled && blur > 0) {
      this.ctx.shadowBlur = blur;
      this.ctx.shadowColor = color;
    }
  }

  clearGlow() {
    if (this.glowEnabled) {
      this.ctx.shadowBlur = 0;
      this.ctx.shadowColor = 'transparent';
    }
  }

  drawFrame(entities, camera, markers, combatSystem, constructionSystem, fogSystem, particleSystem) {
    const ctx = this.ctx;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    ctx.save();

    this.clear();
    this.drawStars(ctx);

    const c = camera;
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(c.zoom, c.zoom);
    ctx.translate(-c.x, -c.y);

    this.drawNebula(ctx);
    this.drawBackground(ctx, c);

    const bounds = this._getVisibleBounds();
    const buckets = { background: [], buildings: [], units: [], projectiles: [], effects: [] };
    for (const entity of entities.values()) {
      if (entity.alive) {
        const layer = entity.renderLayer;
        if (buckets[layer]) buckets[layer].push(entity);
        else buckets.units.push(entity);
      }
    }

    for (const entity of buckets.units) {
      if (entity.speed > 0) this.drawEnergyTrail(entity, ctx);
    }
    for (const entity of buckets.buildings) {
      if (entity.speed > 0) this.drawEnergyTrail(entity, ctx);
    }

    for (const layer of ['background', 'buildings', 'units', 'projectiles', 'effects']) {
      for (const entity of buckets[layer]) {
        if (this._isVisible(entity, bounds)) {
          entity.render(this, ctx);
        }
      }
    }

    const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 300);
    for (const entity of buckets.units) {
      if (entity.faction === 'player' || entity.faction === 'neutral') continue;
      if (this._isVisible(entity, bounds)) {
        const r = (entity.def?.scale || 1) * 18;
        this.setGlow('#ff4466', 12 * pulse);
        ctx.strokeStyle = '#ff4466';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.7 * pulse;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.arc(entity.x, entity.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        this.clearGlow();
      }
    }

    if (combatSystem) {
      combatSystem.renderProjectiles(ctx, this);
    }

    if (markers) {
      const now = performance.now();
      for (let i = markers.length - 1; i >= 0; i--) {
        const m = markers[i];
        const age = now - m.time;
        if (age > 800) { markers.splice(i, 1); continue; }
        this.drawMoveMarker(ctx, m.x, m.y, age);
      }
    }

    if (constructionSystem) {
      constructionSystem.renderGhost(this, ctx, entities);
      constructionSystem.renderPowerOverlay(this, ctx, entities);
    }

    if (fogSystem && fogSystem.enabled) {
      fogSystem.render(ctx, c);
    }

    if (particleSystem) {
      particleSystem.render(this, ctx);
    }

    ctx.restore();

    this._updateTrails(entities);
  }

  _generateNebula(count) {
    const nebula = [];
    const tints = ['#00ffcc', '#aa88ff', '#e8eaff'];
    for (let i = 0; i < count; i++) {
      nebula.push({
        x: Math.random() * MAP_WIDTH,
        y: Math.random() * MAP_HEIGHT,
        r: 40 + Math.random() * 100,
        a: 0.02 + Math.random() * 0.04,
        speed: 0.05 + Math.random() * 0.1,
        phase: Math.random() * Math.PI * 2,
        color: tints[i % tints.length],
        driftX: (Math.random() - 0.5) * 0.3,
        driftY: (Math.random() - 0.5) * 0.3,
      });
    }
    return nebula;
  }

  _renderNebulaToCanvas() {
    const margin = 200;
    const w = MAP_WIDTH + margin * 2;
    const h = MAP_HEIGHT + margin * 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const nctx = canvas.getContext('2d');
    for (const n of this._nebula) {
      const nx = n.x + margin;
      const ny = n.y + margin;
      const grad = nctx.createRadialGradient(nx, ny, 0, nx, ny, n.r);
      grad.addColorStop(0, n.color);
      grad.addColorStop(1, 'transparent');
      nctx.fillStyle = grad;
      nctx.globalAlpha = n.a;
      nctx.fillRect(nx - n.r, ny - n.r, n.r * 2, n.r * 2);
    }
    nctx.globalAlpha = 1;
    this._nebulaCanvas = canvas;
    this._nebulaNeedsRedraw = false;
  }

  drawNebula(ctx) {
    if (this._nebulaNeedsRedraw || !this._nebulaCanvas) {
      this._renderNebulaToCanvas();
    }
    if (!this._nebulaCanvas) return;
    const t = performance.now() / 1000;
    const globalDriftX = Math.sin(t * 0.02) * 15;
    const globalDriftY = Math.cos(t * 0.015) * 10;
    ctx.globalAlpha = 0.6;
    ctx.drawImage(this._nebulaCanvas, -200 + globalDriftX, -200 + globalDriftY);
    ctx.globalAlpha = 1;
  }

  drawStars(ctx) {
    const t = performance.now() / 1000;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    for (const s of this._stars) {
      const sx = ((s.x % cw) + cw) % cw;
      const sy = ((s.y % ch) + ch) % ch;
      const flicker = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
      ctx.fillStyle = s.color;
      ctx.globalAlpha = s.a * flicker * 0.7;
      ctx.beginPath();
      ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawBackground(ctx, camera) {
    const bounds = this._getVisibleBounds();
    const gs = TILE_SIZE;
    const startX = Math.max(0, Math.floor(bounds.x1 / gs) * gs);
    const endX = Math.min(MAP_WIDTH, Math.ceil(bounds.x2 / gs) * gs);
    const startY = Math.max(0, Math.floor(bounds.y1 / gs) * gs);
    const endY = Math.min(MAP_HEIGHT, Math.ceil(bounds.y2 / gs) * gs);

    ctx.strokeStyle = THEME.GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += gs) {
      ctx.moveTo(x, startY); ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += gs) {
      ctx.moveTo(startX, y); ctx.lineTo(endX, y);
    }
    ctx.stroke();

    ctx.strokeStyle = THEME.BORDER;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  }

  drawMoveMarker(ctx, x, y, age) {
    const t = Math.min(1, age / 400);
    const r = 4 + t * 14;
    const a = (1 - t) * 0.5;
    ctx.strokeStyle = THEME.SPECTER_CYAN;
    ctx.globalAlpha = a;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawLine(x1, y1, x2, y2, color, width = 1) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  drawPolygon(points, strokeColor, fillColor, alpha = 1) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
    if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.stroke(); }
    ctx.globalAlpha = 1;
  }

  drawCircle(x, y, r, color, alpha = 1) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawSpectralOrb(ctx, x, y, color, glowColor, scale, age, selected, shape = 'circle', essenceGlow = 0) {
    const s = scale * 14;
    const pulse = 0.7 + 0.3 * Math.sin(age * 2);
    const cx = x;
    const cy = y;

    const numSpokes = 10;
    for (let i = 0; i < numSpokes; i++) {
      const angle = (Math.PI * 2 / numSpokes) * i + age * 0.8;
      const innerR = s * 0.55;
      const outerR = s * 0.85 + Math.sin(age * 3 + i * 1.5) * 4;
      ctx.strokeStyle = color;
      ctx.globalAlpha = (0.12 + 0.08 * Math.sin(age * 2 + i)) * pulse;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
      ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
      ctx.stroke();
    }

    this._drawOrbCore(ctx, cx, cy, shape, s * 0.4 * pulse, color, glowColor);

    ctx.fillStyle = glowColor;
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(age * 3);
    this._drawOrbCore(ctx, cx, cy, shape, s * 0.12, glowColor, glowColor);

    for (let i = 0; i < 3; i++) {
      const a = (Math.PI * 2 / 3) * i + age * 1.2;
      const dist = s * 0.5 + Math.sin(age * 2 + i) * 4;
      const px = cx + Math.cos(a) * dist;
      const py = cy + Math.sin(a) * dist;
      ctx.fillStyle = glowColor;
      ctx.globalAlpha = (0.25 + 0.15 * Math.sin(age * 2 + i * 2)) * pulse;
      ctx.beginPath();
      ctx.arc(px, py, 1.5 + Math.sin(age * 3 + i) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (selected) {
      ctx.strokeStyle = THEME.SPECTER_CYAN;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(cx, cy, s * 1.1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.globalAlpha = 1;
  }

  _drawOrbCore(ctx, cx, cy, shape, radius, fillColor, glowColor) {
    const sides = shape === 'triangle' ? 3 : shape === 'diamond' ? 4 : shape === 'hexagon' ? 6 : shape === 'octagon' ? 8 : shape === 'square' ? 4 : 0;
    ctx.globalAlpha = 0.85;

    if (sides === 0) {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, glowColor);
      grad.addColorStop(0.3, fillColor);
      grad.addColorStop(0.7, fillColor + '66');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const rotOffset = shape === 'diamond' ? Math.PI / 4 : -Math.PI / 2;
    ctx.fillStyle = fillColor;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = (Math.PI * 2 / sides) * i + rotOffset;
      const px = cx + Math.cos(a) * radius;
      const py = cy + Math.sin(a) * radius;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  drawEnergyTrail(entity, ctx) {
    const trail = this._trails.get(entity.id);
    if (!trail || trail.count < 2) return;
    const color = entity.def?.color || THEME.SPECTER_CYAN;
    const glow = entity.def?.glowColor || color;
    const head = trail.head;
    const count = trail.count;
    const len = trail.points.length;

    for (let i = 1; i < count; i++) {
      const idx0 = (head - count + i - 1 + len) % len;
      const idx1 = (head - count + i + len) % len;
      const frac = i / count;
      ctx.lineWidth = 3;
      ctx.strokeStyle = glow;
      ctx.globalAlpha = frac * 0.08;
      ctx.beginPath();
      ctx.moveTo(trail.points[idx0].x, trail.points[idx0].y);
      ctx.lineTo(trail.points[idx1].x, trail.points[idx1].y);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.globalAlpha = frac * 0.25;
      ctx.beginPath();
      ctx.moveTo(trail.points[idx0].x, trail.points[idx0].y);
      ctx.lineTo(trail.points[idx1].x, trail.points[idx1].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _updateTrails(entities) {
    for (const entity of entities.values()) {
      if (!entity.alive) {
        this._trails.delete(entity.id);
        continue;
      }
      if (!entity.speed || entity.speed <= 0) continue;
      let trail = this._trails.get(entity.id);
      if (!trail) {
        trail = { points: new Array(20), head: 0, count: 0 };
        this._trails.set(entity.id, trail);
      }
      trail.points[trail.head] = { x: entity.x, y: entity.y };
      trail.head = (trail.head + 1) % 20;
      if (trail.count < 20) trail.count++;
    }
    for (const id of this._trails.keys()) {
      const e = entities.get(id);
      if (!e || !e.alive) this._trails.delete(id);
    }
  }

  drawGhostDrift(entity) {
    const phase = entity.driftPhase || 0;
    return Math.sin((entity.age || 0) * 3 + phase) * 2;
  }

  flickerAlpha(baseAlpha, time, rate = 4) {
    return baseAlpha * (0.6 + 0.4 * Math.sin(time * rate));
  }

}
