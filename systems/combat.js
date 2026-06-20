import { PROJECTILES } from '../data/projectiles.js';

export class CombatSystem {
  constructor() {
    this.projectiles = [];
    this._powerFieldCache = new Map();
    this._pylonsCache = [];
    this._homesCache = { player: [], enemy: [] };
    this._powerFieldDirty = true;
  }

  _buildPowerCache(entities) {
    this._powerFieldCache.clear();
    this._pylonsCache.length = 0;
    this._homesCache = { player: [], enemy: [] };
    for (const e of entities.values()) {
      if (!e.alive) continue;
      if (e.renderLayer === 'buildings' && e.powerRadius > 0) {
        if (e.faction === 'player') this._homesCache.player.push(e);
        else this._homesCache.enemy.push(e);
      }
      if (e.powerRadius <= 0) continue;
      this._pylonsCache.push(e);
      for (const other of entities.values()) {
        if (other === e || !other.alive || other.faction !== e.faction) continue;
        const dx = e.x - other.x;
        const dy = e.y - other.y;
        if (dx * dx + dy * dy < e.powerRadius * e.powerRadius) {
          this._powerFieldCache.set(other.id, true);
        }
      }
    }
    this._powerFieldDirty = false;
  }

  _refreshListCaches(entities) {
    this._pylonsCache.length = 0;
    this._homesCache = { player: [], enemy: [] };
    for (const e of entities.values()) {
      if (!e.alive) continue;
      if (e.renderLayer === 'buildings') {
        if (e.powerRadius > 0) {
          if (e.faction === 'player') this._homesCache.player.push(e);
          else this._homesCache.enemy.push(e);
        }
      }
      if (e.powerRadius > 0) this._pylonsCache.push(e);
    }
  }

  update(entities, dt) {
    if (this._powerFieldDirty) this._buildPowerCache(entities);
    else this._refreshListCaches(entities);

    for (const entity of entities.values()) {
      if (!entity.alive || !entity.damage || entity.damage <= 0) continue;
      if (entity.powered === false) continue;

      if (entity.attackCooldown > 0) {
        entity.attackCooldown -= dt;
      }

      if (entity.target) {
        if (!entity.target.alive) {
          if (entity._priorityTargetType) {
            const searchRange = (entity.def?.visionRange || 400) * 3;
            const next = this._findEnemyOfType(entity, entities, entity._priorityTargetType, searchRange);
            if (next) {
              entity.target = next;
              entity.destination = null;
              continue;
            }
            entity._priorityTargetType = null;
          }
          entity.target = null;
          entity.destination = null;
          entity._orbitCenter = null;
          entity._orbitDest = null;
          if (entity.def?.swarm && !this._inPowerFieldCached(entity.x, entity.y, entity.faction)) {
            this._returnToPowerField(entity);
          }
          continue;
        }
        const dist = entity.distanceTo(entity.target);
        if (dist <= entity.range && entity.attackCooldown <= 0) {
          this.fireProjectile(entity, entity.target);
          entity.attackCooldown = entity.attackSpeed || 1;
        } else if (dist > entity.range && !entity.holdPosition) {
          if (entity._powerGuardTarget && !this._inPowerFieldCached(entity.x, entity.y, entity.faction)) {
            entity.target = null;
            entity._powerGuardTarget = false;
            this._returnToPowerField(entity);
          } else {
            entity.moveTo(entity.target.x, entity.target.y);
          }
        }
      }

      if (!entity.target && !entity.holdPosition && entity.renderLayer === 'buildings' && this._powerFieldCache.has(entity.id)) {
        const enemy = this.findNearestEnemy(entity, entities, entity.range);
        if (enemy) entity.target = enemy;
      }
      if (!entity.target && entity.def?.swarm && !entity.holdPosition) {
        const swarmRange = entity.def?.swarmRange || (entity.def?.visionRange || 400) * 1.5;
        const enemy = this.findNearestEnemy(entity, entities, swarmRange);
        if (enemy && (this._inPowerFieldCached(enemy.x, enemy.y, entity.faction) || this._inPowerFieldCached(entity.x, entity.y, entity.faction))) {
          entity.target = enemy;
          entity._powerGuardTarget = true;
          entity._orbitCenter = null;
          entity._orbitDest = null;
        }
      }
      if (!entity.target && entity._priorityTargetType) {
        const searchRange = Math.max(entity.range, entity.def?.visionRange || 300) * 2;
        const enemy = this._findEnemyOfType(entity, entities, entity._priorityTargetType, searchRange);
        if (enemy) {
          entity.target = enemy;
          entity._orbitCenter = null;
          entity._orbitDest = null;
        } else {
          entity._priorityTargetType = null;
          entity.attackMove = true;
        }
      }
      if (!entity.target && entity.attackMove) {
        const searchRange = Math.max(entity.range, entity.def?.visionRange || 300);
        const enemy = this.findNearestEnemy(entity, entities, searchRange);
        if (enemy) {
          entity.target = enemy;
          entity._orbitCenter = null;
          entity._orbitDest = null;
        }
      }

      if (!entity.target && entity.def?.swarm && !entity.holdPosition) {
        const orbitOwnsDestination = entity.destination && entity._orbitDest &&
          entity.destination.x === entity._orbitDest.x &&
          entity.destination.y === entity._orbitDest.y;
        const playerMovedUnit = entity.destination && !orbitOwnsDestination;

        if (playerMovedUnit) {
          entity._orbitCenter = null;
          entity._orbitDest = null;
        } else {
          let insideField = false;
          let nearestHome = null;
          let nearestDist = Infinity;
          for (const e of this._pylonsCache) {
            if (e.faction !== entity.faction) continue;
            const dx = entity.x - e.x;
            const dy = entity.y - e.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < e.powerRadius * e.powerRadius) insideField = true;
            if (d2 < nearestDist) { nearestDist = d2; nearestHome = e; }
          }

          if (!insideField) {
            entity._powerGuardTarget = false;
            entity._orbitCenter = null;
            entity._orbitDest = null;
            if (nearestHome) {
              const dx = entity.x - nearestHome.x;
              const dy = entity.y - nearestHome.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const returnR = (nearestHome.powerRadius || 200) * 0.8;
              // If already at center (dist~0), pick a random direction instead of NaN
              const nx = dist > 1 ? dx / dist : Math.cos(entity._orbitAngle || 0);
              const ny = dist > 1 ? dy / dist : Math.sin(entity._orbitAngle || 0);
              entity.moveTo(
                nearestHome.x + nx * returnR,
                nearestHome.y + ny * returnR
              );
            }
          } else {
            if (!entity._orbitCenter || !entity._orbitCenter.alive) {
              const homes = this._homesCache[entity.faction] || [];
              if (homes.length > 0) {
                entity._orbitCenter = homes[Math.floor(Math.random() * homes.length)];
                const maxR = entity._orbitCenter.powerRadius || 200;
                const buildingSize = entity._orbitCenter.collisionRadius || entity._orbitCenter.interactionRadius || 40;
                const minOrbit = buildingSize + 60;
                entity._orbitRadius = Math.max(minOrbit, maxR * (0.6 + Math.random() * 0.35));
                entity._orbitDirection = Math.random() < 0.5 ? 1 : -1;
                entity._orbitTimer = 10 + Math.random() * 8;
                const dx = entity.x - entity._orbitCenter.x;
                const dy = entity.y - entity._orbitCenter.y;
                entity._orbitAngle = Math.atan2(dy, dx);
              }
            }
            if (entity._orbitCenter) {
              const maxR = entity._orbitCenter.powerRadius || 200;
              const buildingSize = entity._orbitCenter.collisionRadius || entity._orbitCenter.interactionRadius || 40;
              const minOrbit = buildingSize + 60;
              const arcStep = (entity.speed || 60) * dt / entity._orbitRadius;
              entity._orbitAngle += entity._orbitDirection * arcStep;
              entity._orbitRadius += Math.sin(entity._orbitAngle * 0.5) * 0.3 * dt;
              entity._orbitRadius = Math.max(minOrbit, Math.min(entity._orbitRadius, maxR * 0.95));
              entity._orbitTimer -= dt;
              if (entity._orbitTimer <= 0) entity._orbitCenter = null;
              if (entity._orbitCenter) {
                const leadAngle = entity._orbitAngle + entity._orbitDirection * 0.25;
                const ox = entity._orbitCenter.x + Math.cos(leadAngle) * entity._orbitRadius;
                const oy = entity._orbitCenter.y + Math.sin(leadAngle) * entity._orbitRadius;
                entity._orbitDest = { x: ox, y: oy };
                entity.moveTo(ox, oy);
              }
            }
          }
        }
      }
    }

    this.updateProjectiles(dt, entities);

    this._healUnitsNearPylons(entities, dt);
  }

  _healUnitsNearPylons(entities, dt) {
    for (const entity of entities.values()) {
      if (!entity.alive || entity.faction !== 'player' || entity.renderLayer !== 'units' || entity.hp >= entity.maxHp) continue;
      for (const src of this._pylonsCache) {
        if (src.type !== 'pylon' || src.faction !== entity.faction || src.powerRadius <= 0) continue;
        const dx = entity.x - src.x;
        const dy = entity.y - src.y;
        if (dx * dx + dy * dy < src.powerRadius * src.powerRadius) {
          entity.hp = Math.min(entity.maxHp, entity.hp + 0.33 * dt);
          break;
        }
      }
    }
  }

  _returnToPowerField(entity) {
    let home = null;
    let homeDist = Infinity;
    for (const p of this._pylonsCache) {
      if (p.faction !== entity.faction || !p.alive) continue;
      const d = (p.x - entity.x) ** 2 + (p.y - entity.y) ** 2;
      if (d < homeDist) { homeDist = d; home = p; }
    }
    if (home) {
      const dx = entity.x - home.x;
      const dy = entity.y - home.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const returnR = (home.powerRadius || 200) * 0.8;
      const nx = dist > 1 ? dx / dist : Math.cos(entity._orbitAngle || 0);
      const ny = dist > 1 ? dy / dist : Math.sin(entity._orbitAngle || 0);
      entity.moveTo(home.x + nx * returnR, home.y + ny * returnR);
    }
  }

  _inPowerFieldCached(x, y, faction) {
    for (const src of this._pylonsCache) {
      if (src.faction !== faction) continue;
      const dx = x - src.x;
      const dy = y - src.y;
      if (dx * dx + dy * dy < src.powerRadius * src.powerRadius) return true;
    }
    return false;
  }

  _findEnemyOfType(entity, entities, type, searchRange) {
    let nearest = null;
    let minDist = searchRange;
    for (const other of entities.values()) {
      if (!other.alive) continue;
      if (!this._isEnemy(entity.faction, other.faction)) continue;
      if (other.type !== type) continue;
      const dist = entity.distanceTo(other);
      if (dist < minDist) {
        minDist = dist;
        nearest = other;
      }
    }
    return nearest;
  }

  _retaliate(target, source) {
    if (!source || !source.alive) return;
    if (!target.damage || target.damage <= 0) return;
    if (target.faction === source.faction) return;
    target.target = source;
    target.attackMove = false;
    target.holdPosition = false;
    target._powerGuardTarget = false;
    if (target.destination) target.destination = null;
  }

  _inFriendlyPowerField(entity, entities) {
    for (const other of entities.values()) {
      if (other === entity) continue;
      if (!other.alive || other.faction !== entity.faction) continue;
      const r = other.powerRadius || 0;
      if (r <= 0) continue;
      const dx = entity.x - other.x;
      const dy = entity.y - other.y;
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  }

  _inFriendlyPowerFieldXYZ(x, y, faction, entities) {
    for (const other of entities.values()) {
      if (!other.alive || other.faction !== faction) continue;
      const r = other.powerRadius || 0;
      if (r <= 0) continue;
      const dx = x - other.x;
      const dy = y - other.y;
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  }

  _isEnemy(myFaction, otherFaction) {
    if (!otherFaction || otherFaction === 'neutral') return false;
    return otherFaction !== myFaction;
  }

  findNearestEnemy(entity, entities, searchRange) {
    let nearest = null;
    let minDist = searchRange || entity.range || 200;
    for (const other of entities.values()) {
      if (!other.alive) continue;
      if (!this._isEnemy(entity.faction, other.faction)) continue;
      const dist = entity.distanceTo(other);
      if (dist < minDist) {
        minDist = dist;
        nearest = other;
      }
    }
    return nearest;
  }

  fireProjectile(source, target) {
    const def = source.def;
    const projDef = def?.projectile ? PROJECTILES[def.projectile] : null;
    if (projDef?.instant) {
      target.takeDamage(source.damage);
      this._retaliate(target, source);
      return;
    }
    this.projectiles.push({
      x: source.x,
      y: source.y,
      target,
      source,
      speed: projDef?.speed || 8,
      damage: source.damage,
      color: projDef?.color || source.def?.color || '#00ffcc',
      glowColor: projDef?.glowColor || source.def?.glowColor || '#00ffcc',
      shape: projDef?.shape || 'line',
      lifetime: projDef?.lifetime || 2,
      age: 0,
      alive: true,
    });
  }

  updateProjectiles(dt, entities) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;

      if (p.age >= p.lifetime || !p.target?.alive) {
        this.projectiles.splice(i, 1);
        continue;
      }

      const dx = p.target.x - p.x;
      const dy = p.target.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const hitRadius = Math.max(8, (p.target.collisionRadius || 6) + 8);
      if (dist < hitRadius) {
        p.target.takeDamage(p.damage);
        this._retaliate(p.target, p.source);
        this.projectiles.splice(i, 1);
        continue;
      }

      if (dist > 0) {
        const step = p.speed * dt;
        p.x += (dx / dist) * step;
        p.y += (dy / dist) * step;
      }
    }
  }

  renderProjectiles(ctx, renderer) {
    for (const p of this.projectiles) {
      renderer.setGlow(p.glowColor, 8);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      const ahead = 6;
      const dx = p.target.x - p.x;
      const dy = p.target.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        ctx.lineTo(
          p.x + (dx / dist) * ahead,
          p.y + (dy / dist) * ahead
        );
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      renderer.clearGlow();
    }
  }
}