import { Entity } from './entity.js';
import { THEME } from '../data/theme.js';
import { UNITS } from '../data/units.js';

const STATES = { IDLE: 'idle', MOVING: 'moving', GATHERING: 'gathering', RETURNING: 'returning' };

export { STATES };

export class Worker extends Entity {
  constructor({ type, x, y, faction }) {
    const def = UNITS[type] || UNITS.shade;
    super({ type, x, y, faction, hp: def.hp, maxHp: def.hp, renderLayer: 'units' });
    this.def = def;
    this.weight = def.weight || 1;
    this.carryCapacity = 10;
    this.carriedAmount = 0;
    this.carriedType = null;
    this.state = STATES.IDLE;
    this.speed = def.speed || 60;
    this.damage = 0;
    this.range = 0;
    this.attackCooldown = 0;
    this.targetNode = null;
    this.dropOff = null;
    this._entities = null;
    this._resourceSystem = null;
    this.gatherMultiplier = 1;
    this.gatherTimer = 0;
    this.gatherInterval = 1;
    this.assignedResourceType = null;
    this.selected = false;
    this._assignedNode = null;
    this._idleRetryTimer = 0;
    this.driftPhase = Math.random() * Math.PI * 2;
    this.holdPosition = false;
    this.attackMove = false;
    this.destination = null;
    this.vx = 0;
    this.vy = 0;
    this.maxSpeed = def.speed || 60;
    this.steerStrength = 6;
    this.separationStrength = 200;
    this.arrivalRadius = 14;
    this.radius = 6;
    this.collisionRadius = 6;
    this.interactionRadius = 6;
    this.passable = false;
        this._gatherOffset = { x: (Math.random() - 0.5) * 50, y: (Math.random() - 0.5) * 50 };
  }

  findDropOff(entities) {
    if (!entities) return null;
    let nearest = null;
    let minDist = Infinity;
    for (const e of entities.values()) {
      if (!e.alive || e.faction !== this.faction || e.renderLayer !== 'buildings') continue;
      const type = e.type;
      if (type === 'nexus' || type === 'supply_depot' || type === 'refinery' || type === 'energy_condenser') {
        const dx = e.x - this.x;
        const dy = e.y - this.y;
        const d = dx * dx + dy * dy;
        if (d < minDist) {
          minDist = d;
          nearest = e;
        }
      }
    }
    return nearest;
  }

  update(dt) {
    super.update(dt);

    switch (this.state) {
      case STATES.IDLE:
        if (!this._entities || !this._resourceSystem) break;
          this._idleRetryTimer -= dt;
          if (this._idleRetryTimer <= 0) {
            this._idleRetryTimer = 0.15 + Math.random() * 0.15;
          this._tryAutoRepeat();
        }
        break;

      case STATES.MOVING:
        if (!this.targetNode || !this.targetNode.alive || this.targetNode.amount <= 0) {
          this.targetNode = null;
          if (!this.destination) {
            this._tryAutoRepeat();
          }
          break;
        }
        if (this.distanceTo(this.targetNode) < (this.targetNode.interactionRadius || 20)) {
          this.destination = null;
          this.state = STATES.GATHERING;
          this.gatherTimer = 0;
        } else {
          if (!this.destination) this.destination = {};
          this.destination.x = this.targetNode.x + this._gatherOffset.x;
          this.destination.y = this.targetNode.y + this._gatherOffset.y;
        }
        break;

      case STATES.GATHERING:
        if (!this.targetNode || !this.targetNode.alive || this.targetNode.amount <= 0) {
          this.targetNode = null;
          if (this.carriedAmount > 0) {
            this.state = STATES.RETURNING;
            this.dropOff = this.findDropOff(this._entities);
            this.destination = null;
          } else {
            this.carriedType = null;
            this._tryAutoRepeat();
          }
          break;
        }
        this.destination = null;
        this.gatherTimer -= dt;
        if (this.gatherTimer <= 0) {
          this.gatherTimer = this.gatherInterval / (this.gatherMultiplier || 1);
          const gather = Math.min(2, this.targetNode.amount, this.carryCapacity - this.carriedAmount);
          if (gather > 0) {
            this.carriedAmount += gather;
            this.targetNode.amount -= gather;
            this.carriedType = this.targetNode.resourceType;
          }
          if (this.carriedAmount >= this.carryCapacity) {
            this.state = STATES.RETURNING;
            this.dropOff = this.findDropOff(this._entities);
            this.destination = null;
          }
        }
        break;

      case STATES.RETURNING:
        if (!this.dropOff || !this.dropOff.alive) {
          this.dropOff = this.findDropOff(this._entities);
          if (!this.dropOff) {
            this.destination = null;
            this.state = STATES.IDLE;
            break;
          }
        }
        if (!this.destination) this.destination = {};
        this.destination.x = this.dropOff.x + this._gatherOffset.x;
        this.destination.y = this.dropOff.y + this._gatherOffset.y;
        if (this.distanceTo(this.dropOff) < (this.dropOff.interactionRadius || 30)) {
          this.destination = null;
          this._deposit();
        }
        break;


    }
  }

  _deposit() {
    if (this.carriedAmount > 0 && this.dropOff && this._resourceSystem) {
      this._resourceSystem.addResource(this.carriedType, this.carriedAmount);
    }
    this.carriedAmount = 0;
    this.carriedType = null;
    this.dropOff = null;
    this.targetNode = null;
    this.destination = null;

    this._tryAutoRepeat();
  }

  _calcPreferredType() {
    if (!this._resourceSystem) return null;
    const e = this._resourceSystem.resources.energy || 0;
    const m = this._resourceSystem.resources.matter || 0;
    if (m > 0 && e < m * 0.7) return 'energy';
    if (e > 0 && m < e * 0.5) return 'matter';
    return null;
  }

  _tryAutoRepeat() {
    if (!this._entities || !this._resourceSystem) {
      this.state = STATES.IDLE;
      return;
    }

    const preferredType = this._calcPreferredType();
    const tryNode = (node) => {
      if (node && node.addGatherer(this)) return node;
      return null;
    };
    let nextNode = null;

    if (this._assignedNode && this._assignedNode.alive && this._assignedNode.amount > 0) {
      if (!preferredType || this._assignedNode.resourceType === preferredType) {
        nextNode = tryNode(this._assignedNode);
      }
    }

    if (!nextNode && preferredType) nextNode = tryNode(this._findNodeToGather(preferredType));
    if (!nextNode && preferredType) nextNode = tryNode(this._findNodeToGather(preferredType === 'energy' ? 'matter' : 'energy'));
    if (!nextNode && this._assignedNode && this._assignedNode.alive && this._assignedNode.amount > 0) {
      nextNode = tryNode(this._assignedNode);
    }
    if (!nextNode) nextNode = tryNode(this._findNodeToGather(null));

    if (!nextNode) {
      this.state = STATES.IDLE;
      return;
    }

    if (nextNode.resourceType !== this.assignedResourceType) {
      this.assignedResourceType = nextNode.resourceType;
    }

    this._assignedNode = nextNode;
    this.targetNode = nextNode;
    this._gatherOffset = { x: (Math.random() - 0.5) * 24, y: (Math.random() - 0.5) * 24 };
    this.destination = { x: nextNode.x + this._gatherOffset.x, y: nextNode.y + this._gatherOffset.y };
    this.state = STATES.MOVING;
  }

  _findBaseNexus() {
    if (!this._entities) return null;
    for (const e of this._entities.values()) {
      if (e.alive && e.type === 'nexus' && e.faction === this.faction) return e;
    }
    return null;
  }

  _findNodeToGather(preferredType) {
    let nearest = null;
    let bestScore = Infinity;
    const dropOff = this.findDropOff(this._entities);
    const nexus = this._findBaseNexus();
    for (const entity of this._entities.values()) {
      if (!entity.alive || !entity.resourceType) continue;
      if (entity.amount <= 0) continue;
      if (preferredType && entity.resourceType !== preferredType) continue;
      if (!entity.canGather || !entity.canGather()) continue;
      const wx = entity.x - this.x;
      const wy = entity.y - this.y;
      let tripScore = wx * wx + wy * wy;
      if (dropOff) {
        const rx = entity.x - dropOff.x;
        const ry = entity.y - dropOff.y;
        tripScore += rx * rx + ry * ry;
      }
      if (tripScore < bestScore) {
        bestScore = tripScore;
        nearest = entity;
      }
    }
    return nearest;
  }

  moveTo(x, y) {
    if (!this.destination) this.destination = { x, y };
    else { this.destination.x = x; this.destination.y = y; }
    this.targetNode = null;
    this._assignedNode = null;
    this.dropOff = null;
    this.carriedType = null;
    this.carriedAmount = 0;
    this._idleRetryTimer = 1.5; // delay auto-repeat after manual move
    this.state = STATES.MOVING;
  }

  assignTo(node, resourceSystem, entities) {
    this.targetNode = node;
    this._assignedNode = node;
    this._resourceSystem = resourceSystem;
    this._entities = entities;
    this.destination = null;
    this.carriedAmount = 0;
    this.carriedType = null;
    this.assignedResourceType = node.resourceType;
    this.state = STATES.MOVING;
        this._gatherOffset = { x: (Math.random() - 0.5) * 24, y: (Math.random() - 0.5) * 24 };
  }

  render(renderer, ctx) {
    if (!this.alive) return;
    const drift = renderer.drawGhostDrift(this) * 0.75;
    const cx = this.x;
    const cy = this.y + drift;
    renderer.drawSpectralOrb(ctx, cx, cy, '#5588aa', '#446688', 0.6, this.age, this.selected, 'circle');

    if (this.carriedAmount > 0 && this.carriedType) {
      const color = this.carriedType === 'energy' ? THEME.SPECTER_CYAN : THEME.SPECTER_PURPLE;
      const bob = Math.sin(this.age * 4) * 3;
      renderer.setGlow(color, 6);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(cx + 10, cy - 8 + bob, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      renderer.clearGlow();
    }

    if (this.hp < this.maxHp) {
      const bw = 20;
      const bh = 2;
      const bx = cx - bw / 2;
      const by = cy - 14;
      renderer.setGlow(THEME.SPECTER_WHITE, 3);
      ctx.fillStyle = '#ff446666';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = THEME.SPECTER_CYAN;
      ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
      renderer.clearGlow();
    }
  }
}