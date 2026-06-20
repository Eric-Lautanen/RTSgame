import { BUILDINGS } from '../data/buildings.js';
import { THEME } from '../data/theme.js';
import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from '../data/world.js';
import { Foundation } from '../entities/foundation.js';
import { Building } from '../entities/building.js';
import { Worker } from '../entities/worker.js';

const BUILDABLE_RANGE = 500;

export class ConstructionSystem {
  constructor(resourceSystem) {
    this.resources = resourceSystem;
    this.activeType = null;
    this.ghost = null;
    this.buildQueue = [];
    this.showPowerOverlay = true;
    this._activeSources = new Set();
    this._powerParent = new Map();
  }

  startPlacement(buildingType) {
    if (!BUILDINGS[buildingType]) return;
    this.activeType = buildingType;
    this.ghost = { type: buildingType, x: 0, y: 0, valid: false };
  }

  cancelPlacement() {
    this.activeType = null;
    this.ghost = null;
  }

  isInPowerField(x, y, entities) {
    for (const src of this._activeSources) {
      const dx = src.x - x;
      const dy = src.y - y;
      if (dx * dx + dy * dy < src.powerRadius * src.powerRadius) return true;
    }
    return false;
  }

  updateAllPower(entities, pendingAdd = []) {
    const allSources = [];
    for (const entity of entities.values()) {
      if (!entity.alive) continue;
      if (entity.powerRadius > 0) allSources.push(entity);
    }
    for (const entity of pendingAdd) {
      if (!entity.alive) continue;
      if (entity.powerRadius > 0) allSources.push(entity);
    }

    const active = new Set();
    const parent = new Map();
    const queue = [];

    for (const src of allSources) {
      if (src.type === 'nexus') {
        active.add(src);
        queue.push(src);
      }
    }

    while (queue.length > 0) {
      const cur = queue.shift();
      for (const src of allSources) {
        if (active.has(src)) continue;
        const dx = src.x - cur.x;
        const dy = src.y - cur.y;
        if (dx * dx + dy * dy < cur.powerRadius * cur.powerRadius) {
          active.add(src);
          parent.set(src, cur);
          queue.push(src);
        }
      }
    }

    this._activeSources = active;
    this._powerParent = parent;

    for (const entity of entities.values()) {
      if (!entity.alive || entity.renderLayer !== 'buildings') continue;
      if (entity.powerRadius > 0) {
        entity.powered = active.has(entity);
      } else {
        let powered = false;
        for (const src of active) {
          const dx = src.x - entity.x;
          const dy = src.y - entity.y;
          if (dx * dx + dy * dy < src.powerRadius * src.powerRadius) { powered = true; break; }
        }
        entity.powered = powered;
      }
    }
  }

  isPlacing() {
    return this.activeType !== null;
  }

  updateGhost(worldX, worldY, entities) {
    if (!this.isPlacing() || !this.ghost) return;
    this.ghost.x = worldX;
    this.ghost.y = worldY;
    this.ghost.valid = this.isValid(worldX, worldY, entities);
  }

  isValid(x, y, entities) {
    const def = BUILDINGS[this.activeType];
    if (!def) return false;

    const fp = def.footprint || { w: 2, h: 2 };
    const halfW = (fp.w * TILE_SIZE) / 2;
    const halfH = (fp.h * TILE_SIZE) / 2;

    if (x - halfW < 0 || x + halfW > MAP_WIDTH || y - halfH < 0 || y + halfH > MAP_HEIGHT) return false;

    if (!this._isNearBuildableArea(x, y, entities)) return false;

    for (const entity of entities.values()) {
      if (!entity.alive) continue;
      if (entity.renderLayer === 'buildings') {
        const eFp = entity.footprint || { w: 2, h: 2 };
        const eHalfW = (eFp.w * TILE_SIZE) / 2;
        const eHalfH = (eFp.h * TILE_SIZE) / 2;
        if (Math.abs(entity.x - x) < halfW + eHalfW && Math.abs(entity.y - y) < halfH + eHalfH) return false;
      }
      if (!entity.passable && entity.renderLayer !== 'buildings') {
        if (Math.abs(entity.x - x) < halfW + (entity.collisionRadius || 6) && Math.abs(entity.y - y) < halfH + (entity.collisionRadius || 6)) return false;
      }
    }

    if (!this.isInPowerField(x, y, entities)) return false;

    if (!this.resources.canAfford(def.cost)) return false;

    return true;
  }

  _isNearBuildableArea(x, y, entities) {
    for (const entity of entities.values()) {
      if (!entity.alive || entity.faction !== 'player') continue;
      if (entity.renderLayer !== 'buildings') continue;
      if (entity.passable) continue;
      const dx = entity.x - x;
      const dy = entity.y - y;
      if (Math.sqrt(dx * dx + dy * dy) < BUILDABLE_RANGE) return true;
    }
    return false;
  }

  confirmPlacement(entities) {
    if (!this.isPlacing() || !this.ghost || !this.ghost.valid) return null;
    const def = BUILDINGS[this.activeType];
    if (!def) return null;
    if (!this.resources.spend(def.cost)) return null;

    const foundation = new Foundation({
      buildingType: this.activeType,
      x: this.ghost.x,
      y: this.ghost.y,
      faction: 'player',
    });

    this.cancelPlacement();
    return foundation;
  }

  update(entities, dt) {
    // Construction completion is handled in engine.processFoundations
  }

  onFoundationComplete(foundation, engine) {
    const building = new Building({
      type: foundation.buildingType,
      x: foundation.x,
      y: foundation.y,
      faction: foundation.faction,
    });
    building.setResourceSystem(this.resources);
    engine.spawnEntity(building);
    if (engine.save) engine.save._dirty = true;
    if (engine.audio) engine.audio.buildComplete();

    if (foundation.buildingType === 'refinery') {
      for (const e of engine.entities.values()) {
        if (e.alive && e instanceof Worker && e.faction === foundation.faction) {
          e.carryCapacity += 2;
        }
      }
    } else if (foundation.buildingType === 'energy_condenser') {
      for (const e of engine.entities.values()) {
        if (e.alive && e.type === 'turret' && e.faction === foundation.faction) {
          e.range = Math.round(e.range * 1.05);
        }
      }
    }
  }

  renderGhost(renderer, ctx, entities) {
    if (!this.isPlacing() || !this.ghost) return;
    const g = this.ghost;
    const def = BUILDINGS[g.type];
    if (!def) return;

    const valid = g.valid;
    const inPower = entities ? this.isInPowerField(g.x, g.y, entities) : true;
    const hasPowerField = def.powerRadius > 0;
    const color = valid ? (hasPowerField ? THEME.SPECTER_CYAN : (inPower ? THEME.SPECTER_CYAN : THEME.UI_GOLD)) : THEME.ENEMY_RED;
    const alpha = 0.4;

    renderer.setGlow(color, 10);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;

    const s = (def.scale || 1) * 20;
    const shape = def.shape || 'hexagon';
    const sides = shape === 'hexagon' ? 6 : shape === 'octagon' ? 8 : shape === 'square' ? 4 : 6;

    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = (Math.PI * 2 / sides) * i - Math.PI / 2;
      const px = g.x + s * Math.cos(a);
      const py = g.y + s * Math.sin(a);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    renderer.clearGlow();

    if (!inPower && !hasPowerField) {
      ctx.fillStyle = THEME.UI_GOLD;
      ctx.globalAlpha = 0.8;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚠ Needs power field', g.x, g.y + s + 14);
      ctx.globalAlpha = 1;
    }
  }

  renderPowerOverlay(renderer, ctx, entities) {
    if (!this.showPowerOverlay) return;

    const now = performance.now();
    const active = this._activeSources;

    for (const src of active) {
      renderer.setGlow(THEME.SPECTER_CYAN, 5);
      ctx.strokeStyle = THEME.SPECTER_CYAN;
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      ctx.lineDashOffset = -now * 0.015;
      ctx.beginPath();
      ctx.arc(src.x, src.y, src.powerRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.globalAlpha = 1;
      renderer.clearGlow();
    }

    for (const src of active) {
      if (src.type === 'nexus') continue;
      const parentSrc = this._powerParent.get(src);
      if (!parentSrc || !active.has(parentSrc)) continue;
      this._drawBolt(renderer, ctx, parentSrc.x, parentSrc.y, src.x, src.y, parentSrc.id, src.id, now);
    }

    for (const entity of entities.values()) {
      if (!entity.alive || entity.renderLayer !== 'buildings' || entity.type === 'foundation' || entity.resourceType) continue;
      if (entity.powerRadius > 0) continue;
      if (!entity.powered) continue;
      let closest = null;
      let closestD2 = Infinity;
      for (const src of active) {
        const dx = src.x - entity.x;
        const dy = src.y - entity.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= src.powerRadius * src.powerRadius && d2 < closestD2) {
          closestD2 = d2;
          closest = src;
        }
      }
      if (!closest) continue;
      this._drawBolt(renderer, ctx, closest.x, closest.y, entity.x, entity.y, closest.id, entity.id, now);
    }
  }

  _drawBolt(renderer, ctx, x1, y1, x2, y2, id1, id2, time) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;
    const seed = id1 * 7 + id2 * 13;

    renderer.setGlow(THEME.SPECTER_CYAN, 4);
    ctx.strokeStyle = THEME.SPECTER_CYAN;
    ctx.globalAlpha = 0.1;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 14]);
    ctx.lineDashOffset = -time * 0.02 + seed;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    ctx.globalAlpha = 1;
    renderer.clearGlow();
  }
}
