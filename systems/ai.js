import { Unit } from '../entities/unit.js';
import { Building } from '../entities/building.js';
import { Worker } from '../entities/worker.js';
import { Builder } from '../entities/builder.js';
import { ResourceNode } from '../entities/resource.js';
import { ResourceSystem } from './resources.js';
import { Foundation } from '../entities/foundation.js';
import { UNITS } from '../data/units.js';
import { ENEMY_UNITS } from '../data/enemies.js';
import { BUILDINGS } from '../data/buildings.js';
import { AGES, AGE_ORDER } from '../data/ages.js';
import { UPGRADES } from '../data/upgrades.js';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../data/world.js';

const DIFFICULTY = {
  passive:    { workerBoost: 0.8, buildMult: 1.4, prodMult: 1.3, waveMult: 1.5, waveRatio: 0.30, minReserve: 0.50 },
  normal:     { workerBoost: 1.0, buildMult: 1.0, prodMult: 1.0, waveMult: 1.0, waveRatio: 0.45, minReserve: 0.40 },
  aggressive: { workerBoost: 1.3, buildMult: 0.7, prodMult: 0.7, waveMult: 0.7, waveRatio: 0.60, minReserve: 0.30 },
};

const STRATEGIES = ['balanced', 'turtle', 'swarm', 'tech'];

const AI_BUILDABLE = ['pylon', 'supply_depot', 'barracks', 'turret', 'research_spire'];

const AI_RESEARCH_PRIORITY = {
  balanced: ['production', 'weapons', 'armor', 'gathering', 'energy'],
  swarm:    ['gathering', 'production', 'weapons', 'armor', 'energy'],
  turtle:   ['armor', 'production', 'weapons', 'energy', 'gathering'],
  tech:     ['energy', 'production', 'weapons', 'armor', 'gathering'],
};

export class AISystem {
  constructor(faction = 'enemy') {
    this.faction = faction;
    this.enabled = false;
    this.difficulty = 'normal';
    this.engine = null;
    this.baseCenter = { x: 500, y: 500 };
    this.resourceSystem = null;
    this.buildQueue = [];
    this.prodQueue = [];
    this.buildTimer = 0;
    this.prodTimer = 0;
    this.attackWaveTimer = 0;
    this._initialSpawned = false;
    this.strategy = 'balanced';
    this.lastWaveTime = 0;
    this.scoutSent = false;
    this.buildPhase = 0;
    this.underAttack = false;
    this.gatherTimer = 0;
    this.factionAge = 'spectral_dawn';
    this._researchQueue = [];
    this._researchTimer = 0;
    this._ageAdvanceTimer = 0;
    this._advancingAge = false;
    this._researched = new Set();
    this._upgradeLevels = { weapons: 0, armor: 0, gathering: 0, production: 0, energy: 0 };
    this._respawnTimer = null;
    this._builderMissing = false;
    this.enemySpawnPositions = [];
    this._harassTimer = 0;
    this._lastTargetType = null;
    this._targetFailCount = 0;
    this._playerComp = { melee: 0, ranged: 0, heavy: 0, buildings: {} };
    this._lastWaveSurvivors = [];
    this._forwardBasePos = null;
  }

  setEngine(engine) {
    this.engine = engine;
  }

  enable(x, y) {
    this.enabled = true;
    this.baseCenter = { x, y };
    if (!this.resourceSystem) {
      this.resourceSystem = new ResourceSystem();
      this.resourceSystem.resources = { energy: 500, matter: 300 };
      this.resourceSystem.addPassiveIncome('energy', 1);
      this.resourceSystem.addPassiveIncome('matter', 0.5);
    }
    this.buildQueue = [];
    this.prodQueue = [];
    this.strategy = STRATEGIES[Math.floor(Math.random() * STRATEGIES.length)];
    this.buildTimer = 40 + Math.random() * 10;
    this.prodTimer = 55 + Math.random() * 15;
    this.attackWaveTimer = 45 + Math.random() * 20;
    this._initialSpawned = false;
    this.scoutSent = false;
    this.buildPhase = 0;
    this.underAttack = false;
    this.gatherTimer = 0;
    this.factionAge = 'spectral_dawn';
    this._researchQueue = [];
    this._researchTimer = 0;
    this._ageAdvanceTimer = 0;
    this._advancingAge = false;
    this._researched = new Set();
    this._upgradeLevels = { weapons: 0, armor: 0, gathering: 0, production: 0, energy: 0 };
    this._respawnTimer = null;
    this._builderMissing = false;
    this._advancementTimer = 0;
    this._nexusProduceTimer = 0;
    this._scountTimer = 0;
    this._harassTimer = 30 + Math.random() * 20;
    this._lastTargetType = null;
    this._targetFailCount = 0;
    this._playerComp = { melee: 0, ranged: 0, heavy: 0, buildings: {} };
    this._lastWaveSurvivors = [];
    this._forwardBasePos = null;
  }

  disable() {
    this.enabled = false;
    this._initialSpawned = false;
    this._respawnTimer = null;
    this._builderMissing = false;
    this.factionAge = 'spectral_dawn';
    this.resourceSystem = null;
    if (!this.engine) return;
    const toRemove = [];
    for (const entity of this.engine.entities.values()) {
      if (entity.alive && entity.faction === this.faction) {
        toRemove.push(entity);
      }
    }
    for (const e of toRemove) {
      e.die();
      this.engine.removeEntity(e);
    }
  }

  _canAfford(cost) {
    return this.resourceSystem && this.resourceSystem.canAfford(cost);
  }

  _spend(cost) {
    return this.resourceSystem && this.resourceSystem.spend(cost);
  }

  _getReserveFloor(entities) {
    let floor = { energy: 40, matter: 20 };

    const myWorkers = this._countMyUnits(entities, e => e instanceof Worker && e.alive);
    const workerTarget = this._workerTarget(entities);

    if (myWorkers < workerTarget * 0.5) {
      floor.energy = Math.max(floor.energy, 80);
      floor.matter = Math.max(floor.matter, 40);
    }

    const idx = AGE_ORDER.indexOf(this.factionAge);
    if (idx < AGE_ORDER.length - 1 && !this._advancingAge) {
      const nextAge = AGE_ORDER[idx + 1];
      const nextCost = AGES[nextAge]?.cost;
      if (nextCost) {
        const nextDef = AGES[nextAge];
        let allReqMet = true;
        if (nextDef && nextDef.requiredBuildings) {
          for (const req of nextDef.requiredBuildings) {
            if (this._countMyBuildings(this.engine.entities, req) === 0) {
              allReqMet = false;
              break;
            }
          }
        }
        if (allReqMet) {
          floor.energy = Math.max(floor.energy, Math.round(nextCost.energy * 0.2));
          floor.matter = Math.max(floor.matter, Math.round(nextCost.matter * 0.2));
        }
      }
    }

    if (this.strategy === 'turtle') {
      floor.energy = Math.round(floor.energy * 1.15);
      floor.matter = Math.round(floor.matter * 1.15);
    }
    if (this.strategy === 'swarm') {
      floor.energy = Math.round(floor.energy * 0.65);
      floor.matter = Math.round(floor.matter * 0.65);
    }
    if (this.underAttack) {
      floor.energy = Math.round(floor.energy * 0.3);
      floor.matter = Math.round(floor.matter * 0.3);
    }

    return floor;
  }

  _canSpend(cost, entities) {
    if (!this._canAfford(cost)) return false;
    const floor = this._getReserveFloor(entities);
    const after = {
      energy: (this.resourceSystem.resources.energy || 0) - (cost.energy || 0),
      matter: (this.resourceSystem.resources.matter || 0) - (cost.matter || 0),
    };
    return after.energy >= floor.energy && after.matter >= floor.matter;
  }

  _workerTarget(entities) {
    const pylonCount = this._countMyBuildings(entities, 'pylon');
    const diff = DIFFICULTY[this.difficulty] || DIFFICULTY.normal;
    const base = Math.min(20, 6 + pylonCount * 2);
    return Math.round(base * diff.workerBoost);
  }

  _isBuildingUnlocked(type) {
    const def = BUILDINGS[type];
    if (!def) return false;
    if (def.requiresBuilding && def.requiresBuilding.length > 0) {
      for (const req of def.requiresBuilding) {
        if (this._countMyBuildings(this.engine.entities, req) === 0) return false;
      }
    }
    return true;
  }

  _isUnitUnlocked(type) {
    const def = ENEMY_UNITS[type];
    if (!def) return false;
    if (def.requiresAge && AGE_ORDER.indexOf(this.factionAge) < AGE_ORDER.indexOf(def.requiresAge)) return false;
    if (def.requiresBuilding && def.requiresBuilding.length > 0) {
      for (const req of def.requiresBuilding) {
        if (this._countMyBuildings(this.engine.entities, req) === 0) return false;
      }
    }
    return true;
  }

  _atEnemyUnitCap(type, entities) {
    const ageDef = AGES[this.factionAge];
    const cap = ageDef?.enemyUnitCaps?.[type];
    if (!cap) return false;
    let count = 0;
    for (const e of entities.values()) {
      if (e.alive && e.faction === this.faction && e.type === type) count++;
      if (e.alive && e.productionQueue) {
        for (const q of e.productionQueue) {
          if (q === type) count++;
        }
      }
    }
    for (const q of this.prodQueue) {
      if (q.type === type) count++;
    }
    return count >= cap;
  }

  update(entities, dt) {
    if (!this.enabled || !this.engine) return;
    if (!this._initialSpawned) {
      this._spawnInitialBase();
      return;
    }

    if (!this.resourceSystem) return;

    const diff = DIFFICULTY[this.difficulty] || DIFFICULTY.normal;

    this._processAgeAdvance(dt);
    this._processResearch(dt);
    this._assignGatherers(entities);
    this._assessSituation(entities);
    this._defendBase(entities);
    this._processBuildQueue(dt);
    this._processProdQueue(dt);

    this._advancementTimer = (this._advancementTimer || 0) + dt;
    if (this._advancementTimer >= 6) {
      this._advancementTimer = 0;
      if (!this._advancingAge) this._tryStartAgeAdvance(entities);
      if (this._researchQueue.length === 0) this._tryQueueResearch();
    }

    this._nexusProduceTimer = (this._nexusProduceTimer || 0) + dt;
    const nexusInterval = Math.max(4, 7 - AGE_ORDER.indexOf(this.factionAge) * 1.2);
    if (this._nexusProduceTimer >= nexusInterval && this._countMyBuildings(entities, 'nexus') > 0) {
      this._nexusProduceTimer = 0;
      this._enqueueNexusProduce(entities);
    }

    const builderAlive = this._hasAliveBuilder(entities);
    if (!builderAlive && this._countMyBuildings(entities, 'nexus') > 0) {
      this._builderMissing = true;
      this._tryProduceBuilder(entities);
      this.buildTimer = Math.min(this.buildTimer, 0.5);
    } else if (builderAlive) {
      this._builderMissing = false;
    }

    this.buildTimer -= dt;
    if (this.buildTimer <= 0) {
      this.buildTimer = this._nextBuildInterval(diff) * diff.buildMult;
      if (builderAlive) this._enqueueBuild(entities);
    }

    this.prodTimer -= dt;
    if (this.prodTimer <= 0) {
      this.prodTimer = this._nextProdInterval(diff) * diff.prodMult;
      this._enqueueProduce(entities, diff);
    }

    this.attackWaveTimer -= dt;
    if (this.attackWaveTimer <= 0) {
      this.attackWaveTimer = this._nextWaveInterval(diff) * diff.waveMult;
      this._sendAttackWave(entities, diff);
    }

    this._scountTimer = (this._scountTimer || 0) + dt;
    if (this._scountTimer >= 30 && this._countMyBuildings(entities, 'nexus') > 0) {
      this._scountTimer = 0;
      this._sendScout(entities);
      this.scoutSent = true;
    }

    this.lastWaveTime += dt;

    this._harassTimer -= dt;
    if (this._harassTimer <= 0 && this._countMyBuildings(entities, 'barracks') > 0) {
      this._harassTimer = 25 + Math.random() * 15 + AGE_ORDER.indexOf(this.factionAge) * 5;
      this._sendHarass(entities);
    }

    // Regroup survivors from last wave back to staging area
    this._regroupSurvivors(entities);

    const myNexusCount = this._countMyBuildings(entities, 'nexus');
    if (myNexusCount === 0) {
      if (this._respawnTimer === null) {
        this._respawnTimer = 45 + Math.random() * 30;
      } else {
        this._respawnTimer -= dt;
        if (this._respawnTimer <= 0) {
          this._respawnTimer = null;
          this._respawnBase(entities);
        }
      }
    }
  }

  _respawnBase(entities) {
    const margin = 500;
    const side = Math.floor(Math.random() * 4);
    let rx, ry;
    const range = MAP_WIDTH * 0.2;
    switch (side) {
      case 0: rx = margin + Math.random() * range; ry = margin + Math.random() * (MAP_HEIGHT - margin * 2); break;
      case 1: rx = MAP_WIDTH - margin - Math.random() * range; ry = margin + Math.random() * (MAP_HEIGHT - margin * 2); break;
      case 2: rx = margin + Math.random() * (MAP_WIDTH - margin * 2); ry = margin + Math.random() * range; break;
      default: rx = margin + Math.random() * (MAP_WIDTH - margin * 2); ry = MAP_HEIGHT - margin - Math.random() * range; break;
    }
    const nexusDef = BUILDINGS.nexus;
    const nexusFp = nexusDef.footprint || { w: 2, h: 2 };
    const nexusHalfW = (nexusFp.w * TILE_SIZE) / 2;
    const nexusHalfH = (nexusFp.h * TILE_SIZE) / 2;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!this._placementBlocked(rx, ry, nexusHalfW, nexusHalfH, Math.max(nexusHalfW, nexusHalfH), entities)) break;
      rx += (Math.random() - 0.5) * 400;
      ry += (Math.random() - 0.5) * 400;
      rx = Math.max(200, Math.min(MAP_WIDTH - 200, rx));
      ry = Math.max(200, Math.min(MAP_HEIGHT - 200, ry));
    }
    this.baseCenter = { x: rx, y: ry };
    const nexus = new Building({ type: 'nexus', x: rx, y: ry, faction: this.faction });
    nexus.powered = true;
    this.engine.spawnEntity(nexus);
    const respawnBuilder = new Builder({ type: 'builder', x: rx - 60, y: ry + 70, faction: this.faction });
    respawnBuilder._resourceSystem = this.resourceSystem;
    respawnBuilder._entities = this.engine.entities;
    this.engine.spawnEntity(respawnBuilder);

    for (let i = 0; i < 3; i++) {
      const w = new Worker({ type: 'shade', x: rx + (Math.random() - 0.5) * 80, y: ry + 60 + Math.random() * 30, faction: this.faction });
      w._resourceSystem = this.resourceSystem; w._entities = this.engine.entities;
      this.engine.spawnEntity(w);
    }
    this._initialSpawned = true;
    this.scoutSent = false;
    this.buildTimer = 5;
    this.prodTimer = 10;
    this.attackWaveTimer = 30;
    if (this.engine && this.engine.hud) this.engine.hud.addEvent('Enemy base detected in new sector');
  }

  _patrolIdleUnits(entities) {
    const now = performance.now();
    if (this._lastPatrolTime && (now - this._lastPatrolTime) < 2000) return;
    this._lastPatrolTime = now;

    const myNexus = [];
    for (const e of entities.values()) {
      if (e.alive && e.type === 'nexus' && e.faction === this.faction) {
        myNexus.push(e);
      }
    }
    if (myNexus.length === 0) return;
    const baseX = myNexus[0].x;
    const baseY = myNexus[0].y;

    let patrolled = 0;
    for (const e of entities.values()) {
      if (!e.alive || e.faction !== this.faction) continue;
      if (!e.damage || e.damage <= 0) continue;
      if (e.destination || e.target) continue;
      const dx = e.x - baseX;
      const dy = e.y - baseY;
      if (dx * dx + dy * dy > 350 * 350) continue;
      if (patrolled++ >= 8) break;
      const guardAngle = Math.random() * Math.PI * 2;
      const guardDist = 80 + Math.random() * 200;
      e.attackMove = true;
      e.holdPosition = false;
      e.moveTo(baseX + Math.cos(guardAngle) * guardDist, baseY + Math.sin(guardAngle) * guardDist);
    }
  }

  _defendBase(entities) {
    if (!this.underAttack) {
      this._patrolIdleUnits(entities);
      return;
    }

    const myAttackers = [];
    for (const e of entities.values()) {
      if (!e.alive || e.faction !== this.faction) continue;
      if (e.damage && e.damage > 0) myAttackers.push(e);
    }

    // Count how many enemies are actually inside our base
    let enemyCount = 0;
    const defRange = 450;
    let nearestEnemy = null;
    let nearestDist = Infinity;

    for (const e of entities.values()) {
      if (!e.alive || e.faction !== 'player') continue;
      if (!e.damage || e.damage <= 0) continue;
      const dx = e.x - this.baseCenter.x;
      const dy = e.y - this.baseCenter.y;
      const d = dx * dx + dy * dy;
      if (d < defRange * defRange) {
        enemyCount++;
        if (d < nearestDist) { nearestDist = d; nearestEnemy = e; }
      }
    }

    if (!nearestEnemy) {
      for (const e of entities.values()) {
        if (!e.alive || e.faction !== 'player') continue;
        if (e.renderLayer !== 'buildings') continue;
        const dx = e.x - this.baseCenter.x;
        const dy = e.y - this.baseCenter.y;
        const d = dx * dx + dy * dy;
        if (d < defRange * defRange && d < nearestDist) {
          nearestDist = d;
          nearestEnemy = e;
        }
      }
    }

    if (nearestEnemy) {
      // Scale recall aggressiveness to how outnumbered we are
      const myNearby = myAttackers.filter(u => {
        const dx = u.x - this.baseCenter.x;
        const dy = u.y - this.baseCenter.y;
        return dx * dx + dy * dy < defRange * defRange;
      }).length;

      const threatLevel = enemyCount / Math.max(1, myNearby);
      // Recall more units when heavily outnumbered (up to 80% vs old 40%)
      const recallRatio = Math.min(0.85, 0.45 + threatLevel * 0.2);

      const idleDefenders = myAttackers.filter(u =>
        !u.destination || u.distanceTo(nearestEnemy) > 500
      );
      const recallCount = Math.min(idleDefenders.length, Math.ceil(myAttackers.length * recallRatio));
      for (let i = 0; i < recallCount; i++) {
        const u = idleDefenders[i];
        if (u.distanceTo(nearestEnemy) > 200) {
          u.attackMove = true;
          u.holdPosition = false;
          u.moveTo(nearestEnemy.x, nearestEnemy.y);
        }
      }
    }
  }

  _processAgeAdvance(dt) {
    if (!this._advancingAge) return;
    this._ageAdvanceTimer -= dt;
    if (this._ageAdvanceTimer <= 0) {
      this.factionAge = this._ageAdvanceTarget;
      this._advancingAge = false;
      this._ageAdvanceTarget = null;
      this._ageAdvanceTimer = 0;
      if (this.engine) this._tryStartAgeAdvance(this.engine.entities);
    }
  }

  _tryStartAgeAdvance(entities) {
    const idx = AGE_ORDER.indexOf(this.factionAge);
    if (idx >= AGE_ORDER.length - 1) return;
    const nextAge = AGE_ORDER[idx + 1];
    const ageDef = AGES[nextAge];
    if (!ageDef) return;

    const myWorkers = this._countMyUnits(entities, e => e instanceof Worker);
    const workerTarget = this._workerTarget(entities);
    if (myWorkers < Math.ceil(workerTarget * 0.6)) return;

    for (const req of ageDef.requiredBuildings) {
      if (this._countMyBuildings(this.engine.entities, req) === 0) {
        if (BUILDINGS[req] && this._canSpend(BUILDINGS[req].cost, entities) && !this.buildQueue.some(q => q.type === req)) {
          this._enqueueSpecificBuild(entities, req);
        }
        return;
      }
    }

    if (!this._canAfford(ageDef.cost)) return;
    this._spend(ageDef.cost);
    this._advancingAge = true;
    this._ageAdvanceTarget = nextAge;
    this._ageAdvanceTimer = ageDef.buildTime;
  }

  _placementBlocked(bx, by, halfW, halfH, halfFp, entities) {
    const check = (list) => {
      for (const e of list) {
        if (!e.alive || e.passable) continue;
        const dx = (e.x || 0) - bx;
        const dy = (e.y || 0) - by;
        if (e.renderLayer === 'buildings' && e.footprint) {
          const eFp = e.footprint;
          const eHalfW = (eFp.w * TILE_SIZE) / 2;
          const eHalfH = (eFp.h * TILE_SIZE) / 2;
          if (Math.abs(e.x - bx) < halfW + eHalfW && Math.abs(e.y - by) < halfH + eHalfH) return true;
        } else {
          if (dx * dx + dy * dy < (halfFp + 10) * (halfFp + 10)) return true;
        }
      }
      return false;
    };
    if (check(entities.values())) return true;
    if (this.engine && check(this.engine.pendingAdd)) return true;
    for (const q of this.buildQueue) {
      const qDef = BUILDINGS[q.type];
      const qFp = qDef ? (qDef.footprint || { w: 2, h: 2 }) : { w: 2, h: 2 };
      const qHalfW = (qFp.w * TILE_SIZE) / 2;
      const qHalfH = (qFp.h * TILE_SIZE) / 2;
      if (Math.abs(q.x - bx) < halfW + qHalfW && Math.abs(q.y - by) < halfH + qHalfH) return true;
    }
    return false;
  }

  _tooCloseToBuilding(bx, by, halfW, halfH, entities, skipTypes) {
    const gap = TILE_SIZE * 2;
    const check = (list) => {
      for (const e of list) {
        if (!e.alive || e.faction !== this.faction) continue;
        if (e.renderLayer !== 'buildings' || e instanceof Foundation || e.resourceType) continue;
        if (skipTypes && skipTypes.includes(e.type)) continue;
        const eFp = e.footprint || { w: 2, h: 2 };
        const eHalfW = (eFp.w * TILE_SIZE) / 2;
        const eHalfH = (eFp.h * TILE_SIZE) / 2;
        if (Math.abs(e.x - bx) < halfW + eHalfW + gap && Math.abs(e.y - by) < halfH + eHalfH + gap) return true;
      }
      return false;
    };
    if (check(entities.values())) return true;
    if (this.engine && check(this.engine.pendingAdd)) return true;
    for (const q of this.buildQueue) {
      if (skipTypes && skipTypes.includes(q.type)) continue;
      const qDef = BUILDINGS[q.type];
      const qFp = qDef ? (qDef.footprint || { w: 2, h: 2 }) : { w: 2, h: 2 };
      const qHalfW = (qFp.w * TILE_SIZE) / 2;
      const qHalfH = (qFp.h * TILE_SIZE) / 2;
      if (Math.abs(q.x - bx) < halfW + qHalfW + gap && Math.abs(q.y - by) < halfH + qHalfH + gap) return true;
    }
    return false;
  }

  _enqueueSpecificBuild(entities, type) {
    if (!this._hasAliveBuilder(entities)) return;
    const def = BUILDINGS[type];
    if (!def || !this._canSpend(def.cost, entities)) return;
    if (this.buildQueue.some(q => q.type === type)) return;

    const cx = this.baseCenter.x;
    const cy = this.baseCenter.y;
    const fp = def.footprint || { w: 2, h: 2 };
    const halfW = (fp.w * TILE_SIZE) / 2;
    const halfH = (fp.h * TILE_SIZE) / 2;
    const halfFp = Math.max(halfW, halfH);
    const margin = halfFp + 20;
    let bx, by;
    let foundSpot = false;

    for (let attempt = 0; attempt < 20; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 100 + Math.random() * 250;
      bx = cx + Math.cos(angle) * dist;
      by = cy + Math.sin(angle) * dist;
      if (bx < margin || bx > MAP_WIDTH - margin || by < margin || by > MAP_HEIGHT - margin) continue;
      if (this._placementBlocked(bx, by, halfW, halfH, halfFp, entities)) continue;
      if (this._tooCloseToBuilding(bx, by, halfW, halfH, entities)) continue;
      for (const e of entities.values()) {
        if (!e.alive || e.faction !== this.faction) continue;
        if (e.powerRadius > 0 && e.powered) {
          const dx = e.x - bx;
          const dy = e.y - by;
          if (dx * dx + dy * dy < e.powerRadius * e.powerRadius) { foundSpot = true; break; }
        }
      }
      if (foundSpot) break;
    }

    if (!foundSpot) return;

    this._spend(def.cost);
    this.buildQueue.push({
      type, x: bx, y: by,
      timer: (def.buildTime || 5),
    });
  }

  _processResearch(dt) {
    if (this._researchQueue.length === 0) return;
    this._researchTimer -= dt;
    if (this._researchTimer <= 0) {
      const upgrade = this._researchQueue.shift();
      this._researched.add(upgrade.name);
      this._upgradeLevels[upgrade.category] = (this._upgradeLevels[upgrade.category] || 0) + 1;
      if (this._researchQueue.length > 0) {
        this._researchTimer = this._researchQueue[0].researchTime;
      }
    }
  }

  _tryQueueResearch() {
    const catOrder = AI_RESEARCH_PRIORITY[this.strategy] || AI_RESEARCH_PRIORITY.balanced;
    for (const cat of catOrder) {
      const currentLevel = this._upgradeLevels[cat] || 0;
      const nextKey = Object.keys(UPGRADES).find(k => UPGRADES[k].category === cat && UPGRADES[k].level === currentLevel + 1);
      if (!nextKey) continue;
      const upgrade = UPGRADES[nextKey];
      if (this._researched.has(upgrade.name)) continue;
      if (upgrade.requiresAge && AGE_ORDER.indexOf(this.factionAge) < AGE_ORDER.indexOf(upgrade.requiresAge)) continue;
      if (upgrade.requiresBuilding && this._countMyBuildings(this.engine.entities, upgrade.requiresBuilding) === 0) continue;
      if (!this._canAfford(upgrade.cost)) continue;
      this._spend(upgrade.cost);
      this._researchQueue.push({ ...upgrade });
      this._researchTimer = upgrade.researchTime;
      break;
    }
  }

  _assignGatherers(entities) {
    this.gatherTimer += 0.1;
    if (this.gatherTimer < 1) return;
    this.gatherTimer = 0;

    const myWorkers = [];
    for (const e of entities.values()) {
      if (!e.alive || e.faction !== this.faction) continue;
      if (e instanceof Worker) myWorkers.push(e);
    }

    const aiDropOff = this._findAINearestDropOff(entities);

    const onEnergy = [];
    const onMatter = [];
    const idleWorkers = [];
    for (const w of myWorkers) {
      if (w.state === 'idle' || (w.state === 'moving' && w.targetNode && !w.targetNode.alive)) {
        idleWorkers.push(w);
      } else if (w.assignedResourceType === 'energy') {
        onEnergy.push(w);
      } else if (w.assignedResourceType === 'matter') {
        onMatter.push(w);
      } else if (w.targetNode && w.targetNode.resourceType === 'energy') {
        onEnergy.push(w);
      } else if (w.targetNode && w.targetNode.resourceType === 'matter') {
        onMatter.push(w);
      }
    }

    const energyRes = this.resourceSystem.resources.energy;
    const matterRes = this.resourceSystem.resources.matter;
    const desiredRatio = matterRes > 0 ? Math.min(2, Math.max(0.5, energyRes / matterRes)) : 1;
    const totalGathering = onEnergy.length + onMatter.length;
    const desiredEnergy = totalGathering > 0 ? Math.round(totalGathering * (desiredRatio / (1 + desiredRatio))) : Math.ceil(totalGathering * 0.5);

    for (const w of idleWorkers) {
      const needEnergy = onEnergy.length < desiredEnergy;
      const preferredType = needEnergy ? 'energy' : 'matter';
      let nearest = null;
      let bestScore = Infinity;
      for (const e of entities.values()) {
        if (!e.alive || !(e instanceof ResourceNode)) continue;
        if (e.amount <= 0) continue;
        if (!e.canGather || !e.canGather()) continue;
        if (e.resourceType !== preferredType) continue;
        const dx = e.x - this.baseCenter.x;
        const dy = e.y - this.baseCenter.y;
        let score = dx * dx + dy * dy;
        if (aiDropOff) {
          const rx = e.x - aiDropOff.x;
          const ry = e.y - aiDropOff.y;
          score += rx * rx + ry * ry;
        }
        const nGatherers = e.gatherers ? e.gatherers.filter(g => g.alive).length : 0;
        score += nGatherers * nGatherers * 10000;
        if (score < bestScore) {
          bestScore = score;
          nearest = e;
        }
      }
      if (!nearest) {
        for (const e of entities.values()) {
          if (!e.alive || !(e instanceof ResourceNode)) continue;
          if (e.amount <= 0) continue;
          if (!e.canGather || !e.canGather()) continue;
          const dx = e.x - this.baseCenter.x;
          const dy = e.y - this.baseCenter.y;
          let score = dx * dx + dy * dy;
          if (aiDropOff) {
            const rx = e.x - aiDropOff.x;
            const ry = e.y - aiDropOff.y;
            score += rx * rx + ry * ry;
          }
          const nGatherers = e.gatherers ? e.gatherers.filter(g => g.alive).length : 0;
          score += nGatherers * nGatherers * 10000;
          if (score < bestScore) {
            bestScore = score;
            nearest = e;
          }
        }
      }
      if (nearest && nearest.addGatherer(w)) {
        w.assignTo(nearest, this.resourceSystem, entities);
        if (nearest.resourceType === 'energy') onEnergy.push(w);
        else onMatter.push(w);
      }
    }

    if (totalGathering > 0) {
      if (onEnergy.length === 0 || (energyRes < 80 && onEnergy.length < totalGathering * 0.25)) {
        const toSwitch = onMatter.filter(w => w.state !== 'returning');
        const switchCount = Math.max(1, Math.ceil(toSwitch.length * 0.4));
        for (const w of toSwitch.slice(0, switchCount)) {
          let nearest = null;
          let bestScore = Infinity;
          for (const e of entities.values()) {
            if (!e.alive || !(e instanceof ResourceNode) || e.resourceType !== 'energy') continue;
            if (e.amount <= 0 || !e.canGather || !e.canGather()) continue;
            const dx = e.x - this.baseCenter.x;
            const dy = e.y - this.baseCenter.y;
            let score = dx * dx + dy * dy;
            if (aiDropOff) {
              const rx = e.x - aiDropOff.x;
              const ry = e.y - aiDropOff.y;
              score += rx * rx + ry * ry;
            }
            const nGatherers = e.gatherers ? e.gatherers.filter(g => g.alive).length : 0;
            score += nGatherers * nGatherers * 10000;
            if (score < bestScore) { bestScore = score; nearest = e; }
          }
          if (nearest && nearest.addGatherer(w)) {
            w.assignTo(nearest, this.resourceSystem, entities);
            onEnergy.push(w);
          }
        }
      }
      if (onMatter.length === 0 || (matterRes < 40 && onMatter.length < totalGathering * 0.25)) {
        const toSwitch = onEnergy.filter(w => w.state !== 'returning');
        const switchCount = Math.max(1, Math.ceil(toSwitch.length * 0.4));
        for (const w of toSwitch.slice(0, switchCount)) {
          let nearest = null;
          let bestScore = Infinity;
          for (const e of entities.values()) {
            if (!e.alive || !(e instanceof ResourceNode) || e.resourceType !== 'matter') continue;
            if (e.amount <= 0 || !e.canGather || !e.canGather()) continue;
            const dx = e.x - this.baseCenter.x;
            const dy = e.y - this.baseCenter.y;
            let score = dx * dx + dy * dy;
            if (aiDropOff) {
              const rx = e.x - aiDropOff.x;
              const ry = e.y - aiDropOff.y;
              score += rx * rx + ry * ry;
            }
            const nGatherers = e.gatherers ? e.gatherers.filter(g => g.alive).length : 0;
            score += nGatherers * nGatherers * 10000;
            if (score < bestScore) { bestScore = score; nearest = e; }
          }
          if (nearest && nearest.addGatherer(w)) {
            w.assignTo(nearest, this.resourceSystem, entities);
            onMatter.push(w);
          }
        }
      }
    }

    const myBuilders = [];
    const myFoundations = [];
    for (const e of entities.values()) {
      if (e.alive && e instanceof Foundation && e.faction === this.faction && e.buildProgress < 1) {
        myFoundations.push(e);
      }
      if (e.alive && e instanceof Builder && e.faction === this.faction) {
        myBuilders.push(e);
      }
    }

    for (const b of myBuilders) {
      if (b.state === 'idle' && myFoundations.length > 0) {
        const f = myFoundations[0];
        b.assignToBuild(f, this.resourceSystem, entities);
        myFoundations.shift();
      }
    }
  }

  _assessSituation(entities) {
    const myBuildings = [];
    let enemyInBase = false;
    let playerMilitaryStrength = 0;
    let playerEcoStrength = 0;
    let myMilitaryStrength = 0;
    const comp = { melee: 0, ranged: 0, heavy: 0, buildings: {} };

    for (const e of entities.values()) {
      if (!e.alive) continue;

      if (e.faction === this.faction && e.renderLayer === 'buildings') {
        myBuildings.push(e);
      }

      if (e.faction === 'player') {
        if (e.damage && e.damage > 0) {
          playerMilitaryStrength += (e.damage * (e.maxHp || 1));
          if ((e.range || 0) >= 100) comp.ranged++;
          else comp.melee++;
          if ((e.armor || 0) >= 5 || (e.maxHp || 0) >= 200) comp.heavy++;
        }
        if (e instanceof Worker) playerEcoStrength += 1;
        if (e.renderLayer === 'buildings') {
          comp.buildings[e.type] = (comp.buildings[e.type] || 0) + 1;
        }
      }

      if (e.faction === this.faction && e.damage && e.damage > 0) {
        myMilitaryStrength += (e.damage * (e.maxHp || 1));
      }

      if (e.faction !== this.faction && e.faction !== 'neutral' && e.renderLayer === 'units') {
        for (const b of myBuildings) {
          const dx = e.x - b.x;
          const dy = e.y - b.y;
          if (dx * dx + dy * dy < 200 * 200) {
            enemyInBase = true;
            break;
          }
        }
      }
    }
    this._playerComp = comp;
    this._playerEcoStrength = playerEcoStrength;

    this.underAttack = enemyInBase;
    this.buildPhase = Math.min(6, Math.floor(this._countMyBuildings(entities, 'pylon') / 2));

    const militaryRatio = myMilitaryStrength / Math.max(1, playerMilitaryStrength);
    if (militaryRatio < 0.5 && this.strategy !== 'turtle') {
      this._priorStrategy = this._priorStrategy || this.strategy;
      this.strategy = 'turtle';
    } else if (militaryRatio >= 0.9 && this._priorStrategy) {
      this.strategy = this._priorStrategy;
      this._priorStrategy = null;
    }

    if (comp.ranged > comp.melee * 1.5 && this.strategy === 'balanced') {
      this.strategy = 'swarm';
    }
    if (comp.heavy > 4 && this.strategy === 'balanced') {
      this.strategy = 'tech';
    }

    this._playerMilitaryStrength = playerMilitaryStrength;
    this._myMilitaryStrength = myMilitaryStrength;
  }

  _nextBuildInterval(diff) {
    const ageIdx = AGE_ORDER.indexOf(this.factionAge);
    const ecoScale = Math.max(0.4, 1 - ageIdx * 0.15);
    const base = 14 * ecoScale;
    const jitter = (Math.random() - 0.5) * 4;
    let interval = Math.max(4, base + jitter);
    if (this.underAttack) interval = Math.max(2, interval * 0.3);
    if (this.strategy === 'swarm') interval *= 1.0;
    if (this.strategy === 'turtle') interval *= 0.65;
    if (this.strategy === 'tech') interval *= 0.85;

    const myAttackers = this._myMilitaryStrength || 0;
    const playerStr = this._playerMilitaryStrength || 1;
    if (myAttackers > playerStr * 2) interval *= 0.7;
    return interval;
  }

  _nextProdInterval(diff) {
    const ageIdx = AGE_ORDER.indexOf(this.factionAge);
    const ecoScale = Math.max(0.3, 1 - ageIdx * 0.18);
    const base = 10 * ecoScale;
    const jitter = (Math.random() - 0.5) * 3;
    let interval = Math.max(3, base + jitter);
    if (this.strategy === 'swarm') interval *= 0.5;
    if (this.strategy === 'turtle') interval *= 1.25;
    if (this.strategy === 'tech') interval *= 1.10;

    const barracksCount = this._countMyBuildings(this.engine?.entities || new Map(), 'barracks');
    if (barracksCount >= 3) interval *= 0.8;
    if (barracksCount >= 5) interval *= 0.7;
    return interval;
  }

  _nextWaveInterval(diff) {
    const ageIdx = AGE_ORDER.indexOf(this.factionAge);
    const base = 35 - ageIdx * 4;
    const jitter = (Math.random() - 0.5) * 8;
    let interval = Math.max(12, base + jitter);
    if (this.strategy === 'swarm') interval *= 0.70;
    if (this.strategy === 'turtle') interval *= 1.20;
    if (this.strategy === 'tech') interval *= 0.90;
    if (this.lastWaveTime < 12) interval *= 1.5;
    const milRatio = (this._myMilitaryStrength || 0) / Math.max(1, this._playerMilitaryStrength || 1);
    if (milRatio > 2.5) interval *= 0.6;
    if (milRatio > 5.0) interval *= 0.5;
    return interval;
  }

  _spawnInitialBase() {
    this._initialSpawned = true;
    const eng = this.engine;
    if (!eng) return;
    const cx = this.baseCenter.x;
    const cy = this.baseCenter.y;

    const nexus = new Building({ type: 'nexus', x: cx, y: cy, faction: this.faction });
    nexus.powered = true;
    eng.spawnEntity(nexus);

    const builder = new Builder({ type: 'builder', x: cx - 60, y: cy + 70, faction: this.faction });
    builder._resourceSystem = this.resourceSystem;
    builder._entities = eng.entities;
    eng.spawnEntity(builder);

    for (let i = 0; i < 2; i++) {
      const ox = (Math.random() - 0.5) * 100;
      const oy = 60 + Math.random() * 40;
      const w = new Worker({ type: 'shade', x: cx + ox, y: cy + oy, faction: this.faction });
      w._resourceSystem = this.resourceSystem;
      w._entities = eng.entities;
      eng.spawnEntity(w);
    }
  }

  _processBuildQueue(dt) {
    for (let i = this.buildQueue.length - 1; i >= 0; i--) {
      const item = this.buildQueue[i];
      item.timer -= dt;
      if (item.timer <= 0) {
        const def = BUILDINGS[item.type];
        if (def) {
          const f = new Foundation({ buildingType: item.type, x: item.x, y: item.y, faction: this.faction });
          this.engine.spawnEntity(f);
        }
        if (item.type === 'barracks') {
          this._enqueueProduceNear(item.x, item.y);
        }
        this.buildQueue.splice(i, 1);
      }
    }
  }

  _processProdQueue(dt) {
    for (let i = this.prodQueue.length - 1; i >= 0; i--) {
      const item = this.prodQueue[i];
      item.timer -= dt;
      if (item.timer <= 0) {
        this._spawnUnitNear(item.type, item.x, item.y);
        this.prodQueue.splice(i, 1);
      }
    }
  }

  _enqueueBuild(entities) {
    if (!this._hasAliveBuilder(entities)) return;
    const types = AI_BUILDABLE.filter(t => this._isBuildingUnlocked(t));
    if (types.length === 0) types.push('pylon');

    const counts = {};
    for (const t of types) counts[t] = this._countMyBuildings(entities, t);

    const supplyUsed = this._supplyUsed(entities);
    const supplyCap = this._supplyCap(entities);
    const supplyPct = supplyCap > 0 ? supplyUsed / supplyCap : 0;
    const hasBarracks = counts['barracks'] > 0;
    const hasResearch = counts['research_spire'] > 0;
    const pylonCount = counts['pylon'] || 0;
    const turretCount = counts['turret'] || 0;

    const myWorkers = this._countMyUnits(entities, e => e instanceof Worker);
    const workerTarget = this._workerTarget(entities);
    const workerPct = myWorkers / Math.max(1, workerTarget);

    const nextAgeIdx = AGE_ORDER.indexOf(this.factionAge) + 1;
    const nextAge = nextAgeIdx < AGE_ORDER.length ? AGE_ORDER[nextAgeIdx] : null;
    const nextAgeDef = nextAge ? AGES[nextAge] : null;

    let choice = null;

    if (workerPct < 0.5) {
      return;
    }

    if (pylonCount === 0 && this._canSpend(BUILDINGS.pylon.cost, entities)) {
      choice = 'pylon';
    } else if (pylonCount < 2 && this._canSpend(BUILDINGS.pylon.cost, entities)) {
      choice = 'pylon';
    } else if (counts['barracks'] < (this.strategy === 'swarm' ? 6 : (this.strategy === 'tech' ? 3 : 4)) && this._canSpend(BUILDINGS.barracks.cost, entities)) {
      choice = 'barracks';
    } else if (!hasResearch && AGE_ORDER.indexOf(this.factionAge) >= 2 && this._canAfford(BUILDINGS.research_spire.cost)) {
      choice = 'research_spire';
    } else if (turretCount < (this.strategy === 'turtle' ? 4 : 2) && hasBarracks && AGE_ORDER.indexOf(this.factionAge) >= 1 && this._canSpend(BUILDINGS.turret.cost, entities)) {
      choice = 'turret';
    } else if (nextAgeDef && nextAgeDef.requiredBuildings) {
      for (const req of nextAgeDef.requiredBuildings) {
        if (counts[req] === 0 && BUILDINGS[req]) {
          const canUseReserve = (req === 'barracks' || req === 'research_spire');
          if (canUseReserve ? this._canAfford(BUILDINGS[req].cost) : this._canSpend(BUILDINGS[req].cost, entities)) {
            choice = req;
            break;
          }
        }
      }
    }

    if (!choice) {
      if (pylonCount < 1) {
        choice = 'pylon';
      } else if (!hasBarracks && workerPct >= 0.85) {
        if (this._canSpend(BUILDINGS.barracks.cost, entities)) {
          choice = 'barracks';
        } else if (supplyPct > 0.6 && this._canSpend(BUILDINGS.pylon.cost, entities)) {
          choice = 'pylon';
        }
      } else if (supplyPct > 0.8 && pylonCount < 4 && this._canSpend(BUILDINGS.pylon.cost, entities)) {
        choice = 'pylon';
      } else if (supplyPct > 0.65 && counts['supply_depot'] < 5 && this._canSpend(BUILDINGS.supply_depot.cost, entities)) {
        choice = 'supply_depot';
      } else if (hasBarracks && !hasResearch && workerPct >= 0.7 && this._canSpend(BUILDINGS.research_spire.cost, entities)) {
        choice = 'research_spire';
      } else if (hasBarracks && turretCount < (this.strategy === 'turtle' ? 8 : 4) && this._canSpend(BUILDINGS.turret.cost, entities)) {
        choice = 'turret';
      } else if (pylonCount < 1 && this._canSpend(BUILDINGS.pylon.cost, entities)) {
        choice = 'pylon';
      } else if (workerPct >= 0.6) {
        const weights = this._buildWeights(this.strategy, counts);
        let cum = 0;
        const r = Math.random();
        for (let i = 0; i < types.length; i++) {
          const w = i < weights.length ? weights[i] : 0.1;
          cum += w;
          if (r < cum) { choice = types[i]; break; }
        }
      }
    }

    if (!choice || !BUILDINGS[choice]) return;
    if (this.buildQueue.some(q => q.type === choice) && choice !== 'turret' && choice !== 'pylon') {
      const alt = types.find(t => t !== choice && !this.buildQueue.some(q => q.type === t) && BUILDINGS[t]);
      if (alt) choice = alt;
    }
    if (!this._canAfford(BUILDINGS[choice].cost)) return;

    const def = BUILDINGS[choice];
    const cx = this.baseCenter.x;
    const cy = this.baseCenter.y;
    const fp = def.footprint || { w: 2, h: 2 };
    const halfW = (fp.w * TILE_SIZE) / 2;
    const halfH = (fp.h * TILE_SIZE) / 2;
    const halfFp = Math.max(halfW, halfH);
    const margin = halfFp + 20;
    let bx, by;
    let foundSpot = false;

    if (choice === 'supply_depot') {
      let nearestNode = null;
      let nearestDist = Infinity;
      for (const e of entities.values()) {
        if (!e.alive || !e.resourceType) continue;
        if (e.amount <= 0) continue;
        const dx = e.x - cx;
        const dy = e.y - cy;
        const d = dx * dx + dy * dy;
        if (d < nearestDist) { nearestDist = d; nearestNode = e; }
      }
      if (nearestNode) {
        for (let attempt = 0; attempt < 10; attempt++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 50 + Math.random() * 60;
          bx = nearestNode.x + Math.cos(angle) * dist;
          by = nearestNode.y + Math.sin(angle) * dist;
          if (bx < margin || bx > MAP_WIDTH - margin || by < margin || by > MAP_HEIGHT - margin) continue;
          if (this._placementBlocked(bx, by, halfW, halfH, halfFp, entities)) continue;
          if (this._tooCloseToBuilding(bx, by, halfW, halfH, entities)) continue;
          for (const e of entities.values()) {
            if (!e.alive || e.faction !== this.faction) continue;
            if (e.powerRadius > 0 && e.powered) {
              const dx = e.x - bx;
              const dy = e.y - by;
              if (dx * dx + dy * dy < e.powerRadius * e.powerRadius) { foundSpot = true; break; }
            }
          }
          if (foundSpot) break;
        }
      }
    }

    if (!foundSpot) {
      if (choice === 'pylon') {
        const powerSources = [];
        for (const e of entities.values()) {
          if (!e.alive || e.faction !== this.faction) continue;
          if (e.powerRadius > 0 && e.powered) powerSources.push(e);
        }
        if (powerSources.length === 0) {
          powerSources.push({ x: cx, y: cy, powerRadius: BUILDINGS.nexus.powerRadius || 320 });
        }
        powerSources.sort((a, b) => {
          const da = (a.x - cx) * (a.x - cx) + (a.y - cy) * (a.y - cy);
          const db = (b.x - cx) * (b.x - cx) + (b.y - cy) * (b.y - cy);
          return db - da;
        });
        const pylonPositions = [];
        for (const e of entities.values()) {
          if (!e.alive || e.faction !== this.faction || e.type !== 'pylon') continue;
          pylonPositions.push({ x: e.x, y: e.y, id: e.id });
        }
        const minPylonDist = 240;
        for (const src of powerSources) {
          const edgeRadius = src.powerRadius * (0.78 + Math.random() * 0.17);
          for (let attempt = 0; attempt < 12; attempt++) {
            const angle = (attempt / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
            bx = src.x + Math.cos(angle) * edgeRadius;
            by = src.y + Math.sin(angle) * edgeRadius;
            if (bx < margin || bx > MAP_WIDTH - margin || by < margin || by > MAP_HEIGHT - margin) continue;
            if (this._placementBlocked(bx, by, halfW, halfH, halfFp, entities)) continue;
            let tooClose = false;
            for (const pp of pylonPositions) {
              if (pp.id === src.id) continue;
              const dx = pp.x - bx;
              const dy = pp.y - by;
              if (dx * dx + dy * dy < minPylonDist * minPylonDist) { tooClose = true; break; }
            }
            if (tooClose) continue;
            if (this._tooCloseToBuilding(bx, by, halfW, halfH, entities, ['pylon'])) continue;
            foundSpot = true;
            break;
          }
          if (foundSpot) break;
        }
      } else {
        for (let attempt = 0; attempt < 25; attempt++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 60 + Math.random() * 380;
          bx = cx + Math.cos(angle) * dist;
          by = cy + Math.sin(angle) * dist;
          if (bx < margin || bx > MAP_WIDTH - margin || by < margin || by > MAP_HEIGHT - margin) continue;
          if (this._placementBlocked(bx, by, halfW, halfH, halfFp, entities)) continue;
          if (this._tooCloseToBuilding(bx, by, halfW, halfH, entities)) continue;
          for (const e of entities.values()) {
            if (!e.alive || e.faction !== this.faction) continue;
            if (e.powerRadius > 0 && e.powered) {
              const dx = e.x - bx;
              const dy = e.y - by;
              if (dx * dx + dy * dy < e.powerRadius * e.powerRadius) { foundSpot = true; break; }
            }
          }
          if (foundSpot) break;
        }
      }
    }

    if (!foundSpot) return;

    this._spend(def.cost);
    this.buildQueue.push({
      type: choice, x: bx, y: by,
      timer: (def.buildTime || 5),
    });
  }

  _buildWeights(strategy, counts) {
    const maxBarracks = strategy === 'swarm' ? 6 : (strategy === 'tech' ? 3 : 4);
    const maxTurrets = strategy === 'turtle' ? 8 : 4;

    let base;
    if (strategy === 'turtle') {
      base = { pylon: 0.12, supply_depot: 0.12, barracks: 0.15, turret: 0.42, research_spire: 0.19 };
    } else if (strategy === 'swarm') {
      base = { pylon: 0.18, supply_depot: 0.08, barracks: 0.46, turret: 0.08, research_spire: 0.20 };
    } else if (strategy === 'tech') {
      base = { pylon: 0.10, supply_depot: 0.08, barracks: 0.18, turret: 0.10, research_spire: 0.54 };
    } else {
      base = { pylon: 0.15, supply_depot: 0.10, barracks: 0.32, turret: 0.22, research_spire: 0.21 };
    }

    const adjusted = { ...base };
    if ((counts.barracks || 0) >= maxBarracks) adjusted.barracks *= 0.1;
    else if ((counts.barracks || 0) >= maxBarracks - 1) adjusted.barracks *= 0.5;
    if ((counts.turret || 0) >= maxTurrets) adjusted.turret *= 0.15;
    if ((counts.research_spire || 0) >= 1) adjusted.research_spire *= 0.1;
    if ((counts.supply_depot || 0) >= 5) adjusted.supply_depot *= 0.15;
    if ((counts.pylon || 0) >= 4) adjusted.pylon *= 0.3;

    const total = AI_BUILDABLE.reduce((s, k) => s + (adjusted[k] || 0), 0);
    return AI_BUILDABLE.map(k => total > 0 ? (adjusted[k] || 0) / total : 1 / AI_BUILDABLE.length);
  }

  _tryProduceBuilder(entities) {
    const nexusList = [];
    for (const e of entities.values()) {
      if (e.alive && e.type === 'nexus' && e.faction === this.faction) nexusList.push(e);
    }
    if (nexusList.length === 0 || this._advancingAge) return;

    for (const n of nexusList) {
      if (n.productionQueue && n.productionQueue.includes('builder')) return;
    }

    const builderDef = UNITS.builder;
    if (!builderDef || !this._canAfford(builderDef.cost)) return;
    if (this._supplyUsed(entities) + 1 > this._supplyCap(entities)) return;

    const nexus = nexusList[0];
    nexus.productionQueue.push('builder');
    if (nexus.productionTimer <= 0) {
      nexus.productionTimer = builderDef.buildTime || 15;
    }
    this._spend(builderDef.cost);
    this._builderMissing = false;
  }

  _enqueueNexusProduce(entities) {
    const nexusList = [];
    for (const e of entities.values()) {
      if (e.alive && e.type === 'nexus' && e.faction === this.faction) nexusList.push(e);
    }
    if (nexusList.length === 0) return;
    const nexus = nexusList[0];

    if (this._advancingAge) return;

    const myWorkers = [];
    for (const e of entities.values()) {
      if (e.alive && e.faction === this.faction && e instanceof Worker) myWorkers.push(e);
    }

    const workerTarget = this._workerTarget(entities);
    const queuedWorkers = this._queuedWorkerCount(entities);
    const totalWorkers = myWorkers.length + queuedWorkers;

    if (this._builderMissing) {
      this._tryProduceBuilder(entities);
      return;
    }

    const ageIdx = AGE_ORDER.indexOf(this.factionAge);
    const workerTimer = Math.max(3, 6 - ageIdx * 0.8);

    // Batch produce workers: queue up to 2 at once when economy is strong
    if (totalWorkers < workerTarget && !this._atEnemyUnitCap('shade', entities)) {
      const workerCost = { energy: 25, matter: 10 };
      const wantToQueue = Math.min(2, workerTarget - totalWorkers);
      for (let i = 0; i < wantToQueue; i++) {
        if (!this._canAfford(workerCost)) break;
        if (this._supplyUsed(entities) + queuedWorkers + i + 1 > this._supplyCap(entities)) break;
        nexus.productionQueue.push('shade');
        if (nexus.productionTimer <= 0) {
          nexus.productionTimer = workerTimer;
        }
        this._spend(workerCost);
      }
      return;
    }

    const myAttackers = [];
    for (const e of entities.values()) {
      if (!e.alive || e.faction !== this.faction) continue;
      if (e.damage && e.damage > 0) myAttackers.push(e);
    }

    const hasBarracks = this._countMyBuildings(entities, 'barracks') > 0;

    // If at worker target and have strong economy, spam void scouts from nexus too
    if (hasBarracks && myAttackers.length >= 6 && ageIdx >= 1 && this.resourceSystem.resources.energy > 200) {
      const scoutDef = ENEMY_UNITS.void_scout;
      const scoutCost = scoutDef?.cost || { energy: 40, matter: 20 };
      const wantScouts = Math.min(3, Math.floor((this.resourceSystem.resources.energy - 150) / scoutCost.energy));
      for (let i = 0; i < wantScouts; i++) {
        if (this._atEnemyUnitCap('void_scout', entities)) break;
        if (!this._canSpend(scoutCost, entities)) break;
        if (this._supplyUsed(entities) + 1 > this._supplyCap(entities)) break;
        const wx = nexus.x + 40 + (Math.random() - 0.5) * 20;
        const wy = nexus.y + 60 + Math.random() * 20;
        const e = new Unit({ type: 'void_scout', x: wx, y: wy, faction: this.faction });
        const def = ENEMY_UNITS.void_scout;
        e.def = def; e.hp = def.hp; e.maxHp = def.hp; e.damage = def.damage;
        e.range = def.range; e.attackSpeed = def.attackSpeed; e.attackCooldown = 0;
        e.speed = def.speed; e.maxSpeed = def.speed; e.color = def.color;
        e.glowColor = def.glowColor; e.scale = def.scale;
        e.collisionRadius = (def.scale || 1) * 6;
        e.weight = def.weight || 1;
        e.attackMove = true;
        this._spend(scoutCost);
        this._applyAIBonuses(e);
        this.engine.spawnEntity(e);
      }
      return;
    }

    const defenderTarget = hasBarracks ? 6 : 4;
    if (myAttackers.length < defenderTarget && !this._atEnemyUnitCap('void_scout', entities)) {
      const scoutDef = ENEMY_UNITS.void_scout;
      const scoutCost = scoutDef?.cost || { energy: 50, matter: 25 };
      if (this._canSpend(scoutCost, entities) && this._supplyUsed(entities) + 1 <= this._supplyCap(entities)) {
        const wx = nexus.x + 40 + (Math.random() - 0.5) * 20;
        const wy = nexus.y + 60 + Math.random() * 20;
        const e = new Unit({ type: 'void_scout', x: wx, y: wy, faction: this.faction });
        const def = ENEMY_UNITS.void_scout;
        e.def = def; e.hp = def.hp; e.maxHp = def.hp; e.damage = def.damage;
        e.range = def.range; e.attackSpeed = def.attackSpeed; e.attackCooldown = 0;
        e.speed = def.speed; e.maxSpeed = def.speed; e.color = def.color;
        e.glowColor = def.glowColor; e.scale = def.scale;
        e.collisionRadius = (def.scale || 1) * 6;
        e.weight = def.weight || 1;
        e.attackMove = true;
        this._spend(scoutCost);
        this._applyAIBonuses(e);
        this.engine.spawnEntity(e);
      }
    }
  }

  _enqueueProduce(entities, diff) {
    const barracksCount = this._countMyBuildings(entities, 'barracks');
    if (barracksCount === 0) return;

    const myWorkers = this._countMyUnits(entities, e => e instanceof Worker);
    const workerTarget = this._workerTarget(entities);
    if (myWorkers < workerTarget * 0.6) return;

    const unitTypes = ENEMY_UNITS;
    const available = Object.keys(unitTypes).filter(t => this._isUnitUnlocked(t));
    if (available.length === 0) return;

    const rankUnits = (list) => {
      let playerRangedCount = 0;
      let playerMeleeCount = 0;
      let playerArmorSum = 0;
      for (const e of entities.values()) {
        if (!e.alive || e.faction !== 'player' || !e.damage) continue;
        if ((e.range || 0) >= 100) playerRangedCount++;
        else playerMeleeCount++;
        playerArmorSum += (e.armor || 0);
      }
      const playerHeavy = playerArmorSum / Math.max(1, playerRangedCount + playerMeleeCount) > 5;
      const playerMostlyRanged = playerRangedCount > playerMeleeCount;

      return list.sort((a, b) => {
        const ua = unitTypes[a];
        const ub = unitTypes[b];
        let scoreA = 0, scoreB = 0;

        const costA = ua.cost ? (ua.cost.energy + ua.cost.matter) : ua.hp;
        const costB = ub.cost ? (ub.cost.energy + ub.cost.matter) : ub.hp;
        scoreA += costA * 0.5;
        scoreB += costB * 0.5;

        const aIsRanged = (ua.range || 0) >= 100;
        const bIsRanged = (ub.range || 0) >= 100;
        if (playerMostlyRanged) {
          if (!aIsRanged) scoreA += 30;
          if (!bIsRanged) scoreB += 30;
        } else {
          if (aIsRanged) scoreA += 30;
          if (bIsRanged) scoreB += 30;
        }

        if (playerHeavy) {
          scoreA += (ua.damage || 0) * 2;
          scoreB += (ub.damage || 0) * 2;
        }

        return scoreB - scoreA;
      });
    };

    const ranged = available.filter(t => (unitTypes[t].range || 0) >= 100);
    const melee = available.filter(t => (unitTypes[t].range || 0) < 100);

    let playerNexus = null;
    for (const e of entities.values()) {
      if (e.alive && e.type === 'nexus' && e.faction === 'player') {
        playerNexus = e; break;
      }
    }

    let nearPlayer = false;
    if (playerNexus) {
      const dx = this.baseCenter.x - playerNexus.x;
      const dy = this.baseCenter.y - playerNexus.y;
      nearPlayer = Math.sqrt(dx * dx + dy * dy) < 1200;
    }

    const supplyFree = this._supplyCap(entities) - this._supplyUsed(entities);
    const ageIdx = AGE_ORDER.indexOf(this.factionAge);
    // Scale production per barracks: each barracks produces 1-2 units per tick
    const perBarracks = (ageIdx >= 2 || this.strategy === 'swarm') ? 2 : 1;
    const maxToProduce = Math.min(
      barracksCount * perBarracks,
      Math.max(0, Math.floor(supplyFree / 2)),
      nearPlayer ? 8 : 6
    );
    if (maxToProduce < 1) return;

    const barracksList = [];
    for (const e of entities.values()) {
      if (e.alive && e.type === 'barracks' && e.faction === this.faction) {
        barracksList.push(e);
      }
    }

    let pool = rankUnits(available);

    for (let i = 0; i < maxToProduce; i++) {
      const b = barracksList[i % barracksList.length];
      const sx = b.x + 50 + (Math.random() - 0.5) * 40;
      const sy = b.y + 50 + (Math.random() - 0.5) * 40;

      const type = pool[i % pool.length];
      const def = unitTypes[type];
      if (!def || this._atEnemyUnitCap(type, entities)) continue;

      const cost = def.cost || { energy: Math.round(def.hp * 0.8), matter: Math.round(def.hp * 0.4) };
      if (!this._canSpend(cost, entities)) continue;

      this._spend(cost);
      this.prodQueue.push({
        type, x: sx, y: sy,
        timer: Math.max(3, (def.hp * 0.05)),
      });
    }
  }

  _enqueueProduceNear(x, y) {
    const myWorkers = this._countMyUnits(this.engine?.entities || new Map(), e => e instanceof Worker);
    const workerTarget = this._workerTarget(this.engine?.entities || new Map());
    if (myWorkers < workerTarget * 0.5) return;

    const types = Object.keys(ENEMY_UNITS).filter(t => this._isUnitUnlocked(t));
    if (types.length === 0) return;
    const type = types[Math.floor(Math.random() * types.length)];
    const def = ENEMY_UNITS[type];
    if (!def) return;
    if (this._atEnemyUnitCap(type, this.engine?.entities)) return;
    const cost = def.cost || { energy: Math.round(def.hp * 0.8), matter: Math.round(def.hp * 0.4) };
    if (!this._canSpend(cost, this.engine?.entities || new Map())) return;
    this._spend(cost);
    this.prodQueue.push({
      type, x: x + 50, y: y + 50,
      timer: Math.max(5, Math.round(def.hp * 0.06)),
    });
  }

  _sendScout(entities) {
    const myWorkers = this._countMyUnits(entities, e => e instanceof Worker);
    const workerTarget = this._workerTarget(entities);
    if (myWorkers < workerTarget * 0.6) return;

    let targetX = this.baseCenter.x + 600;
    let targetY = this.baseCenter.y;
    let scoutType = 'null_mage';
    let foundPlayer = false;

    for (const e of entities.values()) {
      if (e.alive && e.type === 'nexus' && e.faction === 'player') {
        const dx = e.x - this.baseCenter.x;
        const dy = e.y - this.baseCenter.y;
        // Cache last known player nexus position for smarter wave targeting
        this._lastKnownPlayerBase = { x: e.x, y: e.y };
        targetX = e.x + (Math.random() - 0.5) * 200;
        targetY = e.y + (Math.random() - 0.5) * 200;
        const dist = Math.sqrt(dx * dx + dy * dy);
        scoutType = dist > 2000 ? 'void_scout' : 'entropy_soldier';
        foundPlayer = true;
        break;
      }
    }

    // If we haven't found the player yet, explore toward last known position or map center
    if (!foundPlayer) {
      if (this._lastKnownPlayerBase) {
        targetX = this._lastKnownPlayerBase.x + (Math.random() - 0.5) * 400;
        targetY = this._lastKnownPlayerBase.y + (Math.random() - 0.5) * 400;
      } else {
        // Explore a quadrant we haven't checked recently
        targetX = MAP_WIDTH * (0.25 + Math.random() * 0.5);
        targetY = MAP_HEIGHT * (0.25 + Math.random() * 0.5);
      }
      scoutType = 'void_scout';
    }
    const def = ENEMY_UNITS[scoutType];
    if (!def) return;
    if (this._atEnemyUnitCap(scoutType, entities)) return;
    const e = new Unit({ type: scoutType, x: this.baseCenter.x + 30, y: this.baseCenter.y + 30, faction: this.faction });
    e.def = def;
    e.hp = def.hp;
    e.maxHp = def.hp;
    e.damage = def.damage;
    e.range = def.range;
    e.attackSpeed = def.attackSpeed;
    e.attackCooldown = 0;
    e.speed = def.speed;
    e.maxSpeed = def.speed;
    e.color = def.color;
    e.glowColor = def.glowColor;
    e.scale = def.scale;
    e.collisionRadius = (def.scale || 1) * 6;
    e.weight = def.weight || 1;
    e.attackMove = true;
    e.moveTo(targetX, targetY);
    this._applyAIBonuses(e);
    this.engine.spawnEntity(e);
  }

  _regroupSurvivors(entities) {
    const rally = this._rallyPoint(entities);
    for (const e of entities.values()) {
      if (!e.alive || e.faction !== this.faction) continue;
      if (!e._waveSent) continue;
      if (e.destination || e.target) continue;
      if (e.hp < e.maxHp * 0.6) {
        e.attackMove = false;
        e.holdPosition = false;
        e.moveTo(rally.x + (Math.random() - 0.5) * 60, rally.y + (Math.random() - 0.5) * 60);
        e._waveSent = false;
        e._waveTarget = null;
      }
    }
  }

  _sendHarass(entities) {
    const myWorkers = this._countMyUnits(entities, e => e instanceof Worker);
    const workerTarget = this._workerTarget(entities);
    if (myWorkers < workerTarget * 0.6) return;

    const myFastUnits = [];
    for (const e of entities.values()) {
      if (!e.alive || e.faction !== this.faction) continue;
      if (!e.damage || e.damage <= 0) continue;
      if ((e.speed || 0) >= 100) myFastUnits.push(e);
    }
    if (myFastUnits.length < 2) return;

    let playerNexusPos = null;
    let playerWorkers = [];
    for (const e of entities.values()) {
      if (!e.alive || e.faction !== 'player') continue;
      if (e.type === 'nexus') playerNexusPos = { x: e.x, y: e.y };
      if (e instanceof Worker) playerWorkers.push(e);
    }
    if (!playerNexusPos && this._lastKnownPlayerBase) {
      playerNexusPos = this._lastKnownPlayerBase;
    }
    if (!playerNexusPos) return;

    // Send 2-3 fast units to harass worker lines
    const squadSize = Math.min(3, Math.floor(myFastUnits.length / 3));
    const sent = myFastUnits.sort(() => Math.random() - 0.5).slice(0, squadSize);
    let target = null;

    // Target a worker that's far from the nexus
    if (playerWorkers.length > 0) {
      const distant = playerWorkers
        .filter(w => w.alive)
        .sort((a, b) => {
          const da = Math.sqrt((a.x - playerNexusPos.x) ** 2 + (a.y - playerNexusPos.y) ** 2);
          const db = Math.sqrt((b.x - playerNexusPos.x) ** 2 + (b.y - playerNexusPos.y) ** 2);
          return db - da;
        });
      if (distant.length > 0) target = distant[0];
    }

    const tX = target ? target.x : (playerNexusPos.x + 100);
    const tY = target ? target.y : (playerNexusPos.y + 100);

    for (const u of sent) {
      u.attackMove = true;
      u.holdPosition = false;
      u.moveTo(tX + (Math.random() - 0.5) * 80, tY + (Math.random() - 0.5) * 80);
    }
  }

  _sendAttackWave(entities, diff) {
    const myWorkers = this._countMyUnits(entities, e => e instanceof Worker);
    const workerTarget = this._workerTarget(entities);
    if (myWorkers < workerTarget * 0.5) return;

    const myAttackers = [];
    for (const e of entities.values()) {
      if (!e.alive || e.faction !== this.faction) continue;
      if (!e.damage || e.damage <= 0) continue;
      myAttackers.push(e);
    }

    const ageIdx = AGE_ORDER.indexOf(this.factionAge);

    const poolThreshold = Math.max(4, 5 + ageIdx * 3 + (this.strategy === 'swarm' ? 3 : 0));
    if (myAttackers.length < poolThreshold) return;

    let sendPct = 0.70 + ageIdx * 0.03;
    if (this.strategy === 'swarm') sendPct = Math.min(0.90, sendPct + 0.10);
    if (this.strategy === 'turtle') sendPct = Math.min(0.65, sendPct - 0.10);
    if (this.underAttack) sendPct = Math.min(0.50, sendPct * 0.5);

    const reserveCount = Math.max(1, Math.ceil(myAttackers.length * 0.15));
    const waveSize = Math.min(
      Math.ceil(myAttackers.length * sendPct),
      myAttackers.length - reserveCount
    );
    if (waveSize < 1) return;

    let playerNexusPos = null;
    let playerBuildings = [];

    for (const e of entities.values()) {
      if (!e.alive || e.faction !== 'player') continue;
      if (e.type === 'nexus') playerNexusPos = { x: e.x, y: e.y };
      if (e.renderLayer === 'buildings') playerBuildings.push(e);
    }

    if (!playerNexusPos) {
      if (this._lastKnownPlayerBase) {
        playerNexusPos = this._lastKnownPlayerBase;
      } else {
        return;
      }
    }

    // Build target candidates with variety
    const hasElite = myAttackers.some(u => u.scale > 1.5);
    const targetCandidates = [];

    if (playerNexusPos) {
      targetCandidates.push({ type: 'nexus', x: playerNexusPos.x, y: playerNexusPos.y, score: 5 + ageIdx });
    }

    for (const b of playerBuildings) {
      let score = 0;
      if (b.type === 'barracks') score = 8;
      else if (b.type === 'research_spire') score = hasElite ? 4 : 7;
      else if (b.type === 'pylon') score = 6;
      else if (b.type === 'supply_depot') score = 5;
      else if (b.type === 'turret') score = 4;
      if (score > 0) targetCandidates.push({ type: b.type, x: b.x, y: b.y, score });
    }

    // Avoid hitting the same target type repeatedly
    if (this._lastTargetType && this._targetFailCount > 1) {
      for (const c of targetCandidates) {
        if (c.type === this._lastTargetType) c.score *= 0.3;
      }
    }

    if (this.strategy === 'swarm') {
      for (const c of targetCandidates) { if (c.type === 'nexus') c.score += 3; }
    } else if (this.strategy === 'tech') {
      for (const c of targetCandidates) { if (c.type === 'research_spire') c.score += 5; }
    } else if (this.strategy === 'turtle') {
      for (const c of targetCandidates) { if (c.type === 'pylon' || c.type === 'supply_depot') c.score += 2; }
    }

    // If player has many workers, target eco buildings
    if ((this._playerEcoStrength || 0) > 8) {
      for (const c of targetCandidates) {
        if (c.type === 'supply_depot') c.score += 3;
      }
    }

    // If player rushed heavy units, counter with tech damage
    if (this._playerComp.heavy > 3) {
      for (const c of targetCandidates) {
        if (c.type === 'research_spire') c.score += 3;
      }
    }

    for (const c of targetCandidates) { c.score += Math.random() * 4; }
    targetCandidates.sort((a, b) => b.score - a.score);

    const primaryTarget = targetCandidates[0];
    const secondaryTarget = targetCandidates.find(c => c !== primaryTarget) || primaryTarget;
    this._lastTargetType = primaryTarget?.type;

    const ranged = [];
    const melee = [];
    for (const u of myAttackers) {
      if (u.range >= 100) ranged.push(u);
      else melee.push(u);
    }

    // Multi-angle flanking: groups approach from offset approach vectors
    const useMultiPr = waveSize >= 6 && (this.strategy === 'swarm' || ageIdx >= 1);
    const groups = useMultiPr ? 2 : 1;
    const targetsPerGroup = useMultiPr ? [
      Math.floor(waveSize * (this.strategy === 'swarm' ? 0.55 : 0.65)),
      waveSize - Math.floor(waveSize * (this.strategy === 'swarm' ? 0.55 : 0.65))
    ] : [waveSize];

    const baseAngle = Math.atan2(
      (primaryTarget?.y || playerNexusPos.y) - this.baseCenter.y,
      (primaryTarget?.x || playerNexusPos.x) - this.baseCenter.x
    );

    for (let g = 0; g < groups; g++) {
      const tObj = g === 0 ? primaryTarget : secondaryTarget;
      const tX = tObj ? tObj.x : (playerNexusPos?.x || this.baseCenter.x + 400);
      const tY = tObj ? tObj.y : this.baseCenter.y;
      const groupSize = targetsPerGroup[g];

      const sent = [];
      let meleeIdx = 0, rangedIdx = 0;
      const shuffledMelee = [...melee].sort(() => Math.random() - 0.5);
      const shuffledRanged = [...ranged].sort(() => Math.random() - 0.5);
      while (sent.length < groupSize) {
        if (meleeIdx < shuffledMelee.length && (rangedIdx >= shuffledRanged.length || sent.length % 3 !== 2)) {
          sent.push(shuffledMelee[meleeIdx++]);
        } else if (rangedIdx < shuffledRanged.length) {
          sent.push(shuffledRanged[rangedIdx++]);
        } else break;
      }

      // Flank offset: approach from a different angle than the direct line
      const flankAngleOffset = g === 0 ? 0 : (Math.random() > 0.5 ? 0.6 : -0.6);
      const approachAngle = baseAngle + flankAngleOffset;
      const rallyDist = 250 + Math.random() * 100;

      // Rally point offset from target, so the group approaches from a specific direction
      const rallyX = tX + Math.cos(approachAngle + Math.PI) * rallyDist;
      const rallyY = tY + Math.sin(approachAngle + Math.PI) * rallyDist;

      const spread = 60 + Math.random() * 40;
      for (let idx = 0; idx < sent.length; idx++) {
        const unit = sent[idx];
        // First move to the flank rally point, then attack-move to target
        const ox = (Math.random() - 0.5) * spread;
        const oy = (Math.random() - 0.5) * spread;
        unit.attackMove = true;
        unit.holdPosition = false;
        unit.moveTo(rallyX + ox, rallyY + oy);
        // Tag survivors for regroup tracking
        unit._waveSent = true;
        unit._waveTarget = { x: tX, y: tY };
      }
    }

    if (this.engine && this.engine.hud) {
      const label = waveSize >= 8 ? 'large' : (waveSize >= 4 ? 'medium' : 'small');
      this.engine.hud.addEvent(`Enemy ${label} attack wave (${waveSize} units)`);
    }

    if (this._myMilitaryStrength > this._playerMilitaryStrength * 1.8) {
      this.attackWaveTimer = Math.min(this.attackWaveTimer, this._nextWaveInterval(diff) * 0.5);
    }

    this.lastWaveTime = 0;

    // Forward base when sending big waves
    if (waveSize >= 6 && playerNexusPos && this._hasAliveBuilder(entities) && this._canAfford(BUILDINGS.pylon.cost)) {
      this._tryForwardPylon(playerNexusPos.x, playerNexusPos.y, entities);
    }
  }

  _tryForwardPylon(px, py, entities) {
    const pylonDef = BUILDINGS.pylon;
    if (!pylonDef || !this._canSpend(pylonDef.cost, entities)) return;

    let builder = null;
    for (const e of entities.values()) {
      if (e.alive && e instanceof Builder && e.faction === this.faction) {
        builder = e;
        break;
      }
    }
    if (!builder) return;

    const fp = pylonDef.footprint || { w: 1, h: 1 };
    const halfW = (fp.w * TILE_SIZE) / 2;
    const halfH = (fp.h * TILE_SIZE) / 2;
    const halfFp = Math.max(halfW, halfH);
    const margin = halfFp + 20;

    for (let attempt = 0; attempt < 15; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 80 + Math.random() * 120;
      const bx = px + Math.cos(angle) * dist;
      const by = py + Math.sin(angle) * dist;
      if (bx < margin || bx > MAP_WIDTH - margin || by < margin || by > MAP_HEIGHT - margin) continue;
      if (this._placementBlocked(bx, by, halfW, halfH, halfFp, entities)) continue;
      let inPower = false;
      for (const e of entities.values()) {
        if (!e.alive || e.faction !== this.faction) continue;
        if (e.powerRadius > 0 && e.powered) {
          const dx = e.x - bx;
          const dy = e.y - by;
          if (dx * dx + dy * dy < e.powerRadius * e.powerRadius) { inPower = true; break; }
        }
      }
      if (!inPower) continue;
      this._spend(pylonDef.cost);
      this.buildQueue.push({ type: 'pylon', x: bx, y: by, timer: pylonDef.buildTime || 4 });
      builder.moveTo(bx, by);
      this._forwardBasePos = { x: bx, y: by };
      break;
    }

    // Also queue a turret near the forward pylon if we have barracks
    if (this._forwardBasePos && this._countMyBuildings(entities, 'barracks') > 0 && this._countMyBuildings(entities, 'turret') >= 2) {
      const turretDef = BUILDINGS.turret;
      if (turretDef && this._canSpend(turretDef.cost, entities) && this._isBuildingUnlocked('turret')) {
        const tFp = turretDef.footprint || { w: 1, h: 1 };
        const tHalfW = (tFp.w * TILE_SIZE) / 2;
        const tHalfH = (tFp.h * TILE_SIZE) / 2;
        const tHalfFp = Math.max(tHalfW, tHalfH);
        const tMargin = tHalfFp + 20;
        for (let attempt = 0; attempt < 10; attempt++) {
          const a2 = Math.random() * Math.PI * 2;
          const d2 = 40 + Math.random() * 50;
          const tx = this._forwardBasePos.x + Math.cos(a2) * d2;
          const ty = this._forwardBasePos.y + Math.sin(a2) * d2;
          if (tx < tMargin || tx > MAP_WIDTH - tMargin || ty < tMargin || ty > MAP_HEIGHT - tMargin) continue;
          if (this._placementBlocked(tx, ty, tHalfW, tHalfH, tHalfFp, entities)) continue;
          if (this._tooCloseToBuilding(tx, ty, tHalfW, tHalfH, entities)) continue;
          let turretInPower = false;
          for (const e of entities.values()) {
            if (!e.alive || e.faction !== this.faction) continue;
            if (e.powerRadius > 0 && e.powered) {
              const dx = e.x - tx;
              const dy = e.y - ty;
              if (dx * dx + dy * dy < e.powerRadius * e.powerRadius) { turretInPower = true; break; }
            }
          }
          if (!turretInPower) continue;
          this._spend(turretDef.cost);
          this.buildQueue.push({ type: 'turret', x: tx, y: ty, timer: turretDef.buildTime || 5 });
          break;
        }
      }
    }
  }

  _applyAIBonuses(entity) {
    if (!entity || !entity.def) return;
    if (entity.renderLayer === 'buildings' && entity.type !== 'turret') return;
    const dmgMult = 1 + (this._upgradeLevels.weapons || 0) * 0.15;
    const hpMult = 1 + (this._upgradeLevels.armor || 0) * 0.1;
    if (dmgMult > 1 && entity.def.damage > 0) {
      entity.damage = Math.round(entity.def.damage * dmgMult);
    }
    if (hpMult > 1) {
      entity.maxHp = Math.round(entity.def.hp * hpMult);
      entity.hp = entity.maxHp;
    }
  }

  _rallyPoint(entities) {
    // Staging area in front of base, shifting toward known enemy direction
    let rallyAngle = 0;
    if (this._lastKnownPlayerBase) {
      const dx = this._lastKnownPlayerBase.x - this.baseCenter.x;
      const dy = this._lastKnownPlayerBase.y - this.baseCenter.y;
      rallyAngle = Math.atan2(dy, dx);
    }
    const dist = 120 + Math.random() * 40;
    return {
      x: this.baseCenter.x + Math.cos(rallyAngle) * dist,
      y: this.baseCenter.y + Math.sin(rallyAngle) * dist,
    };
  }

  _spawnUnitNear(type, x, y) {
    const def = ENEMY_UNITS[type];
    if (!def || !this.engine) return;
    const e = new Unit({ type, x, y, faction: this.faction });
    e.def = def;
    e.hp = def.hp;
    e.maxHp = def.hp;
    e.damage = def.damage;
    e.range = def.range;
    e.attackSpeed = def.attackSpeed;
    e.attackCooldown = 0;
    e.speed = def.speed;
    e.maxSpeed = def.speed;
    e.color = def.color;
    e.glowColor = def.glowColor;
    e.scale = def.scale;
    e.collisionRadius = (def.scale || 1) * 6;
    e.weight = def.weight || 1;
    this._applyAIBonuses(e);
    // Rally to staging area so units pool before the next wave
    const rally = this._rallyPoint(this.engine.entities);
    e.holdPosition = false;
    e.attackMove = false;
    e.moveTo(rally.x + (Math.random() - 0.5) * 60, rally.y + (Math.random() - 0.5) * 60);
    this.engine.spawnEntity(e);
  }

  _findAINearestDropOff(entities) {
    let nearest = null;
    let minDist = Infinity;
    for (const e of entities.values()) {
      if (!e.alive || e.faction !== this.faction) continue;
      if (e.type === 'nexus' || e.type === 'supply_depot') {
        const dx = e.x - this.baseCenter.x;
        const dy = e.y - this.baseCenter.y;
        const d = dx * dx + dy * dy;
        if (d < minDist) { minDist = d; nearest = e; }
      }
    }
    return nearest;
  }

  _hasAliveBuilder(entities) {
    for (const e of entities.values()) {
      if (e.alive && e instanceof Builder && e.faction === this.faction) return true;
    }
    return false;
  }

  _countMyUnits(entities, predicate) {
    let count = 0;
    for (const e of entities.values()) {
      if (e.alive && e.faction === this.faction && predicate(e)) count++;
    }
    return count;
  }

  _countMyBuildings(entities, type) {
    let count = 0;
    for (const e of entities.values()) {
      if (e.alive && e.faction === this.faction && e.type === type) count++;
    }
    return count;
  }

  _supplyUsed(entities) {
    let used = 0;
    for (const e of entities.values()) {
      if (!e.alive || e.faction !== this.faction) continue;
      if (e instanceof Worker || e instanceof Builder) used += 1;
      else if (e.def?.supplyCost) used += e.def.supplyCost;
    }
    return used;
  }

  _supplyCap(entities) {
    let cap = 10;
    for (const e of entities.values()) {
      if (!e.alive || e.faction !== this.faction) continue;
      if (e.renderLayer === 'buildings' && e.def?.supplyProvided) {
        cap += e.def.supplyProvided;
      }
    }
    return cap;
  }

  _queuedWorkerCount(entities) {
    let count = 0;
    for (const e of entities.values()) {
      if (!e.alive || e.faction !== this.faction) continue;
      if (e.productionQueue) {
        count += e.productionQueue.filter(q => q === 'shade').length;
      }
    }
    return count;
  }
}