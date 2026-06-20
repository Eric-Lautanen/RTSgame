import { Entity } from './entity.js';
import { UNITS } from '../data/units.js';
import { THEME } from '../data/theme.js';
import { Foundation } from './foundation.js';

const STATES = { IDLE: 'idle', MOVING: 'moving', BUILDING: 'building', REPAIRING: 'repairing' };

const AUTO_TASK_INTERVAL = 0.8;
const AUTO_TASK_RANGE = 1200;

export { STATES };

export class Builder extends Entity {
  constructor({ type, x, y, faction }) {
    const def = UNITS[type] || UNITS.builder;
    super({ type, x, y, faction, hp: def.hp, maxHp: def.hp, renderLayer: 'units' });
    this.def = def;
    this.weight = def.weight || 1;
    this.state = STATES.IDLE;
    this.speed = def.speed || 50;
    this.damage = 0;
    this.buildTarget = null;
    this._entities = null;
    this._resourceSystem = null;
    this.selected = false;
    this.driftPhase = Math.random() * Math.PI * 2;
    this.holdPosition = false;
    this.attackMove = false;
    this.destination = null;
    this.vx = 0;
    this.vy = 0;
    this.maxSpeed = def.speed || 50;
    this.steerStrength = 6;
    this.separationStrength = 100;
    this.arrivalRadius = 8;
    this.radius = 6;
    this.collisionRadius = 6;
    this.interactionRadius = 6;
    this.passable = false;
    this._taskCooldown = 0;
    this.buildQueue = [];
    this._retreating = false;
    this._savedState = null;
    this._savedBuildTarget = null;
    this._savedBuildQueue = [];
  }

  update(dt) {
    super.update(dt);

    this._checkFlee();

    switch (this.state) {
      case STATES.IDLE:
        this._taskCooldown -= dt;
        if (this._taskCooldown <= 0) {
          this._taskCooldown = AUTO_TASK_INTERVAL;
          if (!this.destination && this.buildQueue.length === 0) {
            this._autoFindTask();
          } else if (!this.destination && this.buildQueue.length > 0) {
            this._startNextInQueue();
          }
        }
        break;

      case STATES.MOVING:
        if (!this.buildTarget || !this.buildTarget.alive) {
          this._startNextInQueue();
          break;
        }
        if (!this.destination) this.destination = {};
        this.destination.x = this.buildTarget.x;
        this.destination.y = this.buildTarget.y;
        if (this.distanceTo(this.buildTarget) < (this.buildTarget.interactionRadius || 30)) {
          this.destination = null;
          if (this.buildTarget instanceof Foundation) {
            this.state = STATES.BUILDING;
          } else {
            this.state = STATES.REPAIRING;
          }
        }
        break;

      case STATES.BUILDING:
        if (!this.buildTarget || !this.buildTarget.alive) {
          this._startNextInQueue();
          break;
        }
        if (this.distanceTo(this.buildTarget) > (this.buildTarget.interactionRadius || 30)) {
          this.state = STATES.MOVING;
          break;
        }
        this._buildPulse();
        break;

      case STATES.REPAIRING:
        if (!this.buildTarget || !this.buildTarget.alive || this.buildTarget.hp >= this.buildTarget.maxHp) {
          this._startNextInQueue();
          break;
        }
        if (this.distanceTo(this.buildTarget) > (this.buildTarget.interactionRadius || 30)) {
          this.state = STATES.MOVING;
          break;
        }
        this._repairPulse();
        break;
    }
  }

  _checkFlee() {
    if (!this._entities) return;

    const THREAT_RANGE = 350;
    const SAFE_RANGE = 500;

    let nearestEnemy = null;
    let nearestDist = Infinity;
    for (const e of this._entities.values()) {
      if (!e.alive || e.faction === this.faction || e.faction === 'neutral') continue;
      if (e.renderLayer !== 'units') continue;
      if (!e.damage || e.damage <= 0) continue;
      const d = this.distanceTo(e);
      const range = this._retreating ? SAFE_RANGE : THREAT_RANGE;
      if (d < range && d < nearestDist) {
        nearestDist = d;
        nearestEnemy = e;
      }
    }

    if (nearestEnemy) {
      let nexus = null;
      let nexusDist = Infinity;
      for (const e of this._entities.values()) {
        if (!e.alive || e.faction !== this.faction || e.type !== 'nexus') continue;
        const d = this.distanceTo(e);
        if (d < nexusDist) {
          nexusDist = d;
          nexus = e;
        }
      }

      if (nexus) {
        if (!this._retreating) {
          this._retreating = true;
          this._savedState = this.state;
          this._savedBuildTarget = this.buildTarget;
          this._savedBuildQueue = [...this.buildQueue];
          this.buildTarget = null;
          this.buildQueue = [];
          this.state = STATES.IDLE;
        }
        if (!this.destination) this.destination = {};
        this.destination.x = nexus.x + (Math.random() - 0.5) * 40;
        this.destination.y = nexus.y + (Math.random() - 0.5) * 40;
        return;
      }
    }

    if (this._retreating) {
      this._retreating = false;
      this.buildQueue = (this._savedBuildQueue || []).filter(f => f && f.alive);
      this.buildTarget = (this._savedBuildTarget && this._savedBuildTarget.alive) ? this._savedBuildTarget : null;
      this._savedBuildTarget = null;
      this._savedBuildQueue = [];
      this.destination = null;
      if (this.buildTarget) {
        this.state = this._savedState || STATES.IDLE;
      } else {
        this._startNextInQueue();
      }
    }
  }

  _autoFindTask() {
    if (!this._entities) return;

    let nearestFoundation = null;
    let nearestFoundationDist = Infinity;
    let nearestCritical = null;
    let nearestCriticalDist = Infinity;
    let nearestDamaged = null;
    let nearestDamagedDist = Infinity;

    for (const e of this._entities.values()) {
      if (!e.alive || e.faction !== this.faction) continue;
      if (e.renderLayer !== 'buildings') continue;
      const dist = this.distanceTo(e);
      if (dist > AUTO_TASK_RANGE) continue;

      if (e instanceof Foundation && e.buildProgress < 1) {
        if (dist < nearestFoundationDist) {
          nearestFoundationDist = dist;
          nearestFoundation = e;
        }
      } else if (e.hp < e.maxHp && !e.resourceType) {
        if (e.hp < e.maxHp * 0.5) {
          if (dist < nearestCriticalDist) {
            nearestCriticalDist = dist;
            nearestCritical = e;
          }
        } else {
          if (dist < nearestDamagedDist) {
            nearestDamagedDist = dist;
            nearestDamaged = e;
          }
        }
      }
    }

    if (nearestCritical) {
      this.assignToRepair(nearestCritical, this._resourceSystem);
    } else if (nearestFoundation) {
      this.assignToBuild(nearestFoundation, this._resourceSystem, this._entities);
    } else if (nearestDamaged) {
      this.assignToRepair(nearestDamaged, this._resourceSystem);
    }
  }

  enqueueBuild(foundation, resourceSystem, entities) {
    this._resourceSystem = resourceSystem;
    this._entities = entities;
    if (this.state === STATES.IDLE && !this.buildTarget) {
      this.assignToBuild(foundation, resourceSystem, entities);
    } else {
      this.buildQueue.push(foundation);
    }
  }

  assignToBuild(foundation, resourceSystem, entities) {
    this.buildTarget = foundation;
    this._resourceSystem = resourceSystem;
    this._entities = entities;
    this.destination = null;
    this.state = STATES.MOVING;
  }

  assignToRepair(building, resourceSystem) {
    this.buildTarget = building;
    this._resourceSystem = resourceSystem;
    this.destination = null;
    this.state = STATES.MOVING;
  }

  _buildPulse() {
    if (this.buildTarget && this.buildTarget.alive && this._resourceSystem) {
      if (this.buildTarget.workersAssigned.indexOf(this) === -1) {
        this.buildTarget.workersAssigned.push(this);
      }
    }
  }

  _repairPulse() {
    if (!this.buildTarget || !this.buildTarget.alive || !this._resourceSystem) return;
    if (this.buildTarget.hp >= this.buildTarget.maxHp) return;
    this.buildTarget.hp = Math.min(this.buildTarget.maxHp, this.buildTarget.hp + 0.1);
  }

  _startNextInQueue() {
    this.buildTarget = null;
    this.destination = null;
    this.buildQueue = this.buildQueue.filter(f => f && f.alive && f instanceof Foundation && f.buildProgress < 1);
    if (this.buildQueue.length > 0) {
      const next = this.buildQueue.shift();
      this.assignToBuild(next, this._resourceSystem, this._entities);
    } else {
      this.state = STATES.IDLE;
    }
  }

  moveTo(x, y) {
    if (!this.destination) this.destination = { x, y };
    else { this.destination.x = x; this.destination.y = y; }
    this.buildTarget = null;
    this.buildQueue = [];
    this.state = STATES.IDLE;
  }

  render(renderer, ctx) {
    if (!this.alive) return;
    const drift = renderer.drawGhostDrift(this) * 0.75;
    const cx = this.x;
    const cy = this.y + drift;
    const s = 8;

    renderer.setGlow('#ffcc44', 10);
    ctx.fillStyle = '#ffcc44';
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx, cy + s);
    ctx.lineTo(cx - s, cy);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    renderer.clearGlow();

    renderer.setGlow('#ffaa00', 6);
    ctx.fillStyle = '#ffaa00';
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    renderer.clearGlow();

    ctx.strokeStyle = '#ffcc44';
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (this.hp < this.maxHp) {
      const bw = 20;
      const bh = 2;
      const bx = cx - bw / 2;
      const by = cy - 14;
      renderer.setGlow(THEME.SPECTER_WHITE, 3);
      ctx.fillStyle = '#ff446666';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#ffcc44';
      ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
      renderer.clearGlow();
    }
  }
}
