const TICK = 1000 / 60;
const MAX_DELTA = 100;

import { SelectionSystem } from '../systems/selection.js';
import { MovementSystem } from '../systems/movement.js';
import { CombatSystem } from '../systems/combat.js';
import { ProductionSystem } from '../systems/production.js';
import { ResourceSystem } from '../systems/resources.js';
import { SaveSystem } from '../systems/save.js';
import { EconomySystem } from '../systems/economy.js';
import { PopulationSystem } from '../systems/population.js';
import { ConstructionSystem } from '../systems/construction.js';
import { ResearchSystem } from '../systems/research.js';
import { FogSystem } from '../systems/fog.js';
import { AISystem } from '../systems/ai.js';
import { ParticleSystem } from '../systems/particles.js';
import { EFFECTS } from '../data/effects.js';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../data/world.js';
import { Unit } from '../entities/unit.js';
import { Worker } from '../entities/worker.js';
import { Builder } from '../entities/builder.js';
import { ResourceNode } from '../entities/resource.js';
import { Foundation } from '../entities/foundation.js';
import { Building } from '../entities/building.js';
import { AGES, AGE_ORDER } from '../data/ages.js';
import { UNITS } from '../data/units.js';

export class Engine {
  constructor({ canvas, ctx, camera, input, renderer, hud, audio }) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.camera = camera;
    this.input = input;
    this.renderer = renderer;
    this.hud = hud;
    this.audio = audio;

    this.running = false;
    this.paused = false;
    this.lastTime = 0;
    this.accumulator = 0;
    this.frameId = null;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.frameId !== null) { cancelAnimationFrame(this.frameId); this.frameId = null; }
      } else if (this.running && this.lastTime > 0) {
        const elapsed = performance.now() - this.lastTime;
        if (elapsed > TICK * 2) this.accumulator += Math.min(elapsed * this.gameSpeed, 5000);
        this.lastTime = performance.now();
        this.frameId = requestAnimationFrame(this.loop);
        if (this.audio) this.audio.resume();
      }
    });

    this.entities = new Map();
    this.pendingAdd = [];
    this.pendingRemove = [];
    this.age = 0;
    this.gamePhase = 'menu';
    this.gameSpeed = 1;

    this.resources    = new ResourceSystem();
    this.selection    = new SelectionSystem();
    this.movement     = new MovementSystem();
    this.combat       = new CombatSystem();
    this.production   = new ProductionSystem(this.resources);
    this.economy      = new EconomySystem(this.resources);
    this.population   = new PopulationSystem();
    this.construction = new ConstructionSystem(this.resources);
    this.research     = new ResearchSystem();
    this.save         = new SaveSystem(this);
    this.fog          = new FogSystem(MAP_WIDTH, MAP_HEIGHT, TILE_SIZE);
    this.particles    = new ParticleSystem();
    this.ai           = new AISystem('enemy');
    this.ai.setEngine(this);
    this.resources.setSaveDirty(() => { this.save._dirty = true; });
    if (this.hud) this.hud.setEngine(this);

    this.systems = [
      this.combat,
      this.movement,
      this.production,
      this.resources,
      this.population,
      this.construction,
      this.research,
      this.fog,
      this.ai,
      this.save,
    ];

    this.factionAge = 'spectral_dawn';
    this.advancingAge = false;
    this.ageAdvanceTarget = null;
    this.ageAdvanceTimer = 0;
    this._ageHpMult = 1;
    this._ageDmgMult = 1;

    this.fps = 0;
    this.frameCount = 0;
    this.fpsTimer = 0;
    this.moveMarkers = [];
    this._lastNotif = null;
    this._prevKeys = new Set();
    this._shortcutCooldown = {};
    this._hpCache = new Map();
    this._hoveredEntityCached = null;
    this._lastHoverMX = -1;
    this._lastHoverMY = -1;
    this._popCache = { current: 0, cap: 10, dirty: true };
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  stop() {
    this.running = false;
    if (this.frameId !== null) { cancelAnimationFrame(this.frameId); this.frameId = null; }
    this.input.detach();
  }

  pause() { this.paused = true; }
  resume() {
    this.paused = false;
    this.accumulator = 0;
    this.lastTime = performance.now();
    if (this.input) { this.input.events.length = 0; this._prevKeys.clear(); }
  }

  startGame() {
    this.gamePhase = 'playing';
    this.resume();
    if (this.audio) this.audio.resume();
    if (this.hud) {
      this.hud._applySettings();
      this.hud._showStartMenu = false;
      this.hud._showPauseMenu = false;
    }
    if (this.input) this.input.setCanLock(true);
  }

  loadGame() {
    const data = this.save.load();
    if (data && this.save.deserialize(data)) {
      this.gamePhase = 'playing';
      this.resume();
      if (this.hud) {
        this.hud._showStartMenu = false;
        this.hud._showPauseMenu = false;
        this.hud.addEvent('Game restored from save');
      }
      if (this.input) this.input.setCanLock(true);
    } else if (this.hud) {
      this.hud.showNotification('Failed to load save — corrupt or incompatible');
    }
  }

  _processUIEvents() {
    this.input.updateWorldPosition(this.camera);
    const events = this.input.events;
    while (events.length > 0) {
      const evt = events.shift();
      if (evt.type === 'select' && this.hud && this.hud.handleClick(evt.screenX, evt.screenY)) {
        continue;
      }
    }
    if (this.gamePhase === 'paused' && this.input.keys.has('escape')) {
      this.gamePhase = 'playing';
      this.resume();
      if (this.hud) { this.hud._showPauseMenu = false; this.hud._showSettings = false; }
      this.input.keys.delete('escape');
    }
  }

  spawnEntity(entity) {
    this.pendingAdd.push(entity);
    this._popCache.dirty = true;
    if (this.save) this.save._dirty = true;
    return entity;
  }

  removeEntity(entity) {
    if (!this.pendingRemove.includes(entity.id)) {
      this.pendingRemove.push(entity.id);
    }
    this._popCache.dirty = true;
    if (this.save) this.save._dirty = true;
  }

  getEntity(id) { return this.entities.get(id); }

  addSystem(system) {
    this.systems.push(system);
    return this;
  }

  canAdvanceAge() {
    const idx = AGE_ORDER.indexOf(this.factionAge);
    if (idx >= AGE_ORDER.length - 1) return false;
    const nextAge = AGE_ORDER[idx + 1];
    const ageDef = AGES[nextAge];
    if (!ageDef) return false;
    if (!this.resources.canAfford(ageDef.cost)) return false;
    for (const req of ageDef.requiredBuildings) {
      let found = false;
      for (const e of this.entities.values()) {
        if (e.alive && e.faction === 'player' && e.type === req && e.renderLayer === 'buildings') { found = true; break; }
      }
      if (!found) return false;
    }
    return true;
  }

  startAgeAdvance() {
    const idx = AGE_ORDER.indexOf(this.factionAge);
    if (idx >= AGE_ORDER.length - 1) return;
    const nextAge = AGE_ORDER[idx + 1];
    const ageDef = AGES[nextAge];
    if (!ageDef || !this.resources.canAfford(ageDef.cost)) return;
    this.resources.spend(ageDef.cost);
    this.advancingAge = true;
    this.ageAdvanceTarget = nextAge;
    this.ageAdvanceTimer = ageDef.buildTime;
    if (this.audio) this.audio.ageAdvanceStart();
  }

  loop = (timestamp) => {
    if (!this.running) return;
    try {
      let delta = timestamp - this.lastTime;
      this.lastTime = timestamp;
      delta *= this.gameSpeed;
      if (delta > MAX_DELTA) delta = MAX_DELTA;

      this.accumulator += delta;
      while (this.accumulator >= TICK) {
        if (!this.paused && this.gamePhase === 'playing') {
          try { this.update(TICK / 1000); } catch (e) { console.error('update error:', e); this.pause(); break; }
        }
        this.accumulator -= TICK;
      }

      if (this.gamePhase !== 'playing') this._processUIEvents();

      this.flushSpawns();
      this.flushEntities();
      this.syncHUD();
      if (this.gamePhase === 'playing') this._checkWinLoss();
      this.renderer.drawFrame(this.entities, this.camera, this.moveMarkers, this.combat, this.construction, this.fog, this.particles);
      this.hud.render();

      this.frameCount++;
      this.fpsTimer += delta;
      if (this.fpsTimer >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.fpsTimer = 0;
        this.updateDebug();
      }
    } catch (e) {
      console.error('Game loop error:', e.message || e, e.stack || '');
      this.pause();
    }
    this.frameId = requestAnimationFrame(this.loop);
  }

  update(dt) {
    this.age += dt;
    this.camera.update(dt, this.input, this.hud);
    this._detectUnderAttack();
    this.construction.updateAllPower(this.entities, this.pendingAdd);
    this.production.productionMultiplier = this.research.getStatMultiplier('production');
    this.production.factionAge = this.factionAge;
    this.production.advancingAge = this.advancingAge;
    for (const entity of this.entities.values()) {
      entity.update(dt);
    }
    for (const system of this.systems) {
      system.update(this.entities, dt);
    }
    if (this.particles) this.particles.update(dt);
    this.processAgeAdvance(dt);
    this.processResearch(dt);
    this.processUpgrades();
    this.processInput();
    this.processKeys();
    this.processFoundations();
    this.construction.updateAllPower(this.entities, this.pendingAdd);
  }

  processAgeAdvance(dt) {
    if (!this.advancingAge || !this.ageAdvanceTarget) return;
    this.ageAdvanceTimer -= dt;
    if (this.ageAdvanceTimer <= 0) {
      this.factionAge = this.ageAdvanceTarget;
      this.advancingAge = false;
      this.ageAdvanceTarget = null;
      this.ageAdvanceTimer = 0;
      if (this.hud) this.hud.showNotification(`Age reached: ${AGES[this.factionAge]?.name || this.factionAge}`);
      if (this.audio) this.audio.ageAdvanceComplete();
      const ageDef = AGES[this.factionAge];
      if (ageDef && ageDef.bonuses) {
        for (const bonus of ageDef.bonuses) {
          if (bonus.type === 'unit_hp') this._ageHpMult *= bonus.value;
          else if (bonus.type === 'unit_damage') this._ageDmgMult *= bonus.value;
        }
      }
      this._applyAllBonuses();
      if (this.save) this.save._dirty = true;
    }
  }

  processResearch(dt) {
    const completed = this.research.update(dt);
    if (completed) {
      if (this.hud) this.hud.showNotification(`Research complete: ${completed.name}`);
      if (this.audio) this.audio.researchComplete();
      this.resources.incomeMultiplier = this.research.getStatMultiplier('energy');
      this._applyAllBonuses();
      if (this.save) this.save._dirty = true;
    }
  }

  processUpgrades() {
    for (const entity of this.entities.values()) {
      if (entity._upgradeJustCompleted) {
        entity._upgradeJustCompleted = false;
        if (this.audio) this.audio.upgradeComplete();
      }
    }
  }

  _bonusDmgMult() { return this.research.getStatMultiplier('weapons') * this._ageDmgMult; }
  _bonusHpMult() { return this.research.getStatMultiplier('armor') * this._ageHpMult; }
  _bonusGatherMult() { return this.research.getStatMultiplier('gathering'); }

  _applyBonusesToEntity(entity) {
    if (!entity || !entity.def) return;
    if (entity.renderLayer === 'buildings' && entity.type !== 'turret') return;
    const dmgMult = this._bonusDmgMult();
    const hpMult = this._bonusHpMult();
    const gatherMult = this._bonusGatherMult();
    if (dmgMult > 1 && entity.def.damage > 0) {
      entity.damage = Math.round(entity.def.damage * dmgMult);
    }
    if (hpMult > 1) {
      const levelHpMult = 1 + ((entity.level || 1) - 1) * 0.2;
      entity.maxHp = Math.round(entity.def.hp * levelHpMult * hpMult);
      entity.hp = Math.min(entity.hp, entity.maxHp);
    }
    if (gatherMult !== 1 && entity instanceof Worker) {
      entity.gatherMultiplier = gatherMult;
    }
  }

  _applyAllBonuses() {
    for (const entity of this.entities.values()) {
      if (entity.alive && entity.faction === 'player') this._applyBonusesToEntity(entity);
    }
  }

  processFoundations() {
    const completed = [];
    for (const entity of this.entities.values()) {
      if (!(entity instanceof Foundation)) continue;
      if (!entity.alive && entity.buildProgress >= 1 && !entity._spawned) {
        entity._spawned = true;
        completed.push(entity);
      }
    }
    for (const f of completed) {
      this.construction.onFoundationComplete(f, this);
    }
  }

  processInput() {
    this.input.updateWorldPosition(this.camera);
    const events = this.input.events;

    while (events.length > 0) {
      const evt = events.shift();
      if (evt.type === 'select') {
        if (this.hud && this.hud.handleClick(evt.screenX, evt.screenY)) {
          continue;
        }
        if (this.hud) this.hud._showSettings = false;
        const pos = this.camera.screenToWorld(evt.screenX, evt.screenY);

        let clickedEnemy = null;
        let enemyDist = Infinity;
        if (this.selection.count() > 0) {
          for (const entity of this.entities.values()) {
            if (!entity.alive || entity.faction === 'player' || entity.faction === 'neutral') continue;
            const dx = entity.x - pos.x;
            const dy = entity.y - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const clickRadius = Math.max(entity.interactionRadius || 0, 25);
            if (dist < clickRadius && dist < enemyDist) {
              enemyDist = dist;
              clickedEnemy = entity;
            }
          }
        }

        let nearest = null;
        let minDist = Infinity;
        for (const entity of this.entities.values()) {
          if (!entity.alive) continue;
          if (entity.faction !== 'player') continue;
          const dx = entity.x - pos.x;
          const dy = entity.y - pos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const clickRadius = Math.max(entity.interactionRadius || 0, 25);
          if (dist < clickRadius && dist < minDist) {
            minDist = dist;
            nearest = entity;
          }
        }
        const resourceNode = this._findResourceNodeAt(pos.x, pos.y);

        if (this.construction.isPlacing()) {
          const foundation = this.construction.confirmPlacement(this.entities);
          if (foundation) {
            this.spawnEntity(foundation);
            this._assignBuilderToFoundation(foundation);
            if (this.audio) this.audio.buildStart();
          } else {
            this.construction.cancelPlacement();
          }
        } else if (clickedEnemy && this.selection.count() > 0) {
          let attacked = false;
          for (const entity of this.selection.getSelected()) {
            if (entity.damage > 0) {
              entity.target = clickedEnemy;
              entity.attackMove = false;
              entity.holdPosition = false;
              entity.destination = null;
              entity._powerGuardTarget = false;
              entity._priorityTargetType = clickedEnemy.type;
              if (!attacked) { attacked = true; }
            }
          }
          if (attacked && this.audio) this.audio.attack();
        } else if (resourceNode && this.selection.count() > 0) {
          let assigned = false;
          for (const entity of this.selection.getSelected()) {
            if (!(entity instanceof Worker)) continue;
            if (entity.state === 'idle' || entity.state === 'moving') {
              if (resourceNode.addGatherer(entity)) {
                entity.assignTo(resourceNode, this.resources, this.entities);
                assigned = true;
              }
            }
          }
          if (assigned && this.audio) this.audio.gather();
          if (!assigned && !this._selectionHasWorker()) {
            const isAttackMove = this.input.keys.has('a');
            for (const entity of this.selection.getSelected()) {
              entity.target = null;
              entity.holdPosition = false;
              entity.attackMove = isAttackMove;
              entity.moveTo(pos.x, pos.y);
            }
            this.moveMarkers.push({ x: pos.x, y: pos.y, time: performance.now() });
            if (this.audio) this.audio.move();
          }
        } else if (nearest) {
          if (nearest instanceof Foundation && this.selection.count() > 0) {
            let assigned = false;
            for (const entity of this.selection.getSelected()) {
              if (entity instanceof Builder && entity.alive) {
                entity.assignToBuild(nearest, this.resources, this.entities);
                assigned = true;
              }
            }
            if (assigned && this.audio) this.audio.move();
          } else if (nearest instanceof Building && nearest.hp < nearest.maxHp && this.selection.count() > 0) {
            let assigned = false;
            for (const entity of this.selection.getSelected()) {
              if (entity instanceof Builder && entity.alive) {
                entity.assignToRepair(nearest, this.resources);
                assigned = true;
              }
            }
            if (assigned && this.audio) this.audio.move();
          } else {
            const isDouble = this.selection.handleClick(nearest, evt.time);
            if (isDouble) {
              this.selection.selectAllOfType(nearest.type, this.entities);
            } else {
              if (this.input.keys.has('shift')) {
                this.selection.selectEntity(nearest, true);
              } else {
                this.selection.selectEntity(nearest);
              }
            }
            if (this.audio) this.audio.selectUnit(nearest.def);
          }
        } else if (this.selection.count() > 0) {
          const selEntities = this.selection.getSelected();
          const allBuildings = selEntities.every(e => e.renderLayer === 'buildings' || !e.damage || e.damage <= 0);
          if (allBuildings) {
            if (this.hud) { this.hud._showTechTree = false; this.hud._showSettings = false; }
            this.selection.clearSelection();
            if (this.audio) this.audio.selectNone();
          } else {
            const isAttackMove = this.input.keys.has('a');
            for (const entity of selEntities) {
              entity.target = null;
              entity.holdPosition = false;
              entity.attackMove = isAttackMove;
              entity._powerGuardTarget = false;
              entity._priorityTargetType = null;
              entity.moveTo(pos.x, pos.y);
            }
            this.moveMarkers.push({ x: pos.x, y: pos.y, time: performance.now() });
            if (this.audio) this.audio.move();
          }
        } else {
          if (this.hud) { this.hud._showTechTree = false; this.hud._showSettings = false; }
          this.selection.clearSelection();
          if (this.audio) this.audio.selectNone();
        }
      } else if (evt.type === 'rightclick') {
        if (this.hud && this.hud._showTechTree) { this.hud._showTechTree = false; }
        const pos = this.camera.screenToWorld(evt.screenX, evt.screenY);
        if (this.selection.count() > 0) {
          let clickedEnemy = null;
          let enemyDist = Infinity;
          for (const entity of this.entities.values()) {
            if (!entity.alive || entity.faction === 'player' || entity.faction === 'neutral') continue;
            const dx = entity.x - pos.x;
            const dy = entity.y - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const clickRadius = Math.max(entity.interactionRadius || 0, 25);
            if (dist < clickRadius && dist < enemyDist) {
              enemyDist = dist;
              clickedEnemy = entity;
            }
          }
          if (clickedEnemy) {
            let attacked = false;
            for (const entity of this.selection.getSelected()) {
              if (entity.damage > 0) {
                entity.target = clickedEnemy;
                entity.attackMove = false;
                entity.holdPosition = false;
                entity.destination = null;
                entity._powerGuardTarget = false;
                entity._priorityTargetType = clickedEnemy.type;
                if (!attacked) { attacked = true; }
              }
            }
            if (attacked && this.audio) this.audio.attack();
          } else {
            const isAttackMove = this.input.keys.has('a');
            for (const entity of this.selection.getSelected()) {
              entity.target = null;
              entity.holdPosition = false;
              entity.attackMove = isAttackMove;
              entity._powerGuardTarget = false;
              entity._priorityTargetType = null;
              entity.moveTo(pos.x, pos.y);
            }
            this.moveMarkers.push({ x: pos.x, y: pos.y, time: performance.now() });
            if (this.audio) this.audio.move();
          }
        }
      } else if (evt.type === 'boxselect') {
        const add = this.input.keys.has('shift');
        this._handleBoxSelect(evt, add);
      }
    }
  }

  _assignBuilderToFoundation(foundation) {
    let nearestBuilder = null;
    let nearestDist = Infinity;
    for (const e of this.entities.values()) {
      if (!e.alive || !(e instanceof Builder) || e.faction !== 'player') continue;
      const d = e.distanceTo(foundation);
      if (d < nearestDist) {
        nearestDist = d;
        nearestBuilder = e;
      }
    }
    if (nearestBuilder) {
      nearestBuilder.enqueueBuild(foundation, this.resources, this.entities);
    }
  }

  _factionCanProduceBuilder(faction) {
    for (const e of this.entities.values()) {
      if (e.alive && e instanceof Builder && e.faction === faction) return false;
    }
    return true;
  }

  _selectionHasWorker() {
    for (const e of this.selection.getSelected()) {
      if (e instanceof Worker) return true;
    }
    return false;
  }

  _findResourceNodeAt(x, y) {
    let nearest = null;
    let minDist = 64;
    for (const entity of this.entities.values()) {
      if (!entity.alive) continue;
      if (!(entity instanceof ResourceNode)) continue;
      if (entity.amount <= 0) continue;
      const dx = entity.x - x;
      const dy = entity.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        nearest = entity;
      }
    }
    return nearest;
  }

  _handleBoxSelect(evt, addToSelection) {
    const tl = this.camera.screenToWorld(evt.x1, evt.y1);
    const br = this.camera.screenToWorld(evt.x2, evt.y2);
    const box = { x1: tl.x, y1: tl.y, x2: br.x, y2: br.y };
    this.selection.selectInBox(box, this.entities, addToSelection, 'player');
    if (this.selection.count() > 0 && this.audio) {
      this.audio.selectMultiple();
    }
  }

  processKeys() {
    const keys = this.input.keys;
    const now = performance.now();
    for (const key of keys) {
      if (!this._prevKeys.has(key)) {
        if (key === 'escape' && now - (this._shortcutCooldown.escape || 0) > 300) {
          this._shortcutCooldown.escape = now;
          if (this.hud) { this.hud._showTechTree = false; this.hud._showSettings = false; }
          if (this.construction.isPlacing()) {
            this.construction.cancelPlacement();
          }
          if (this.gamePhase === 'playing') {
            this.gamePhase = 'paused';
            this.pause();
            if (this.hud) this.hud._showPauseMenu = true;
          } else if (this.gamePhase !== 'paused') {
            this.selection.clearSelection();
          }
        } else if (key === 'delete' && now - (this._shortcutCooldown.delete || 0) > 300) {
          this._shortcutCooldown.delete = now;
          for (const entity of this.selection.getSelected()) {
            entity.die();
            this.removeEntity(entity);
          }
          this.selection.clearSelection();
        } else if (key === ' ' && now - (this._shortcutCooldown.space || 0) > 300) {
          this._shortcutCooldown.space = now;
          const sel = this.selection.getFirstSelected();
          if (sel) {
            this.camera.targetX = sel.x;
            this.camera.targetY = sel.y;
          }
          } else if (key === 'h' && now - (this._shortcutCooldown.h || 0) > 300) {
          this._shortcutCooldown.h = now;
          for (const entity of this.entities.values()) {
            if (entity.alive && entity.type === 'nexus' && entity.faction === 'player') {
              this.camera.targetX = entity.x;
              this.camera.targetY = entity.y;
              break;
            }
          }
        } else if (key === 's' && now - (this._shortcutCooldown.s || 0) > 300) {
          this._shortcutCooldown.s = now;
          for (const entity of this.selection.getSelected()) {
            entity.target = null;
            entity.destination = null;
            entity.attackMove = false;
            entity.holdPosition = false;
            entity._powerGuardTarget = false;
            entity._priorityTargetType = null;
          }
        }
      }
    }
    this._prevKeys.clear();
    for (const k of keys) this._prevKeys.add(k);
  }

  flushSpawns() {
    const spawns = this.production.flushSpawns();
    for (const s of spawns) {
      const def = s.type === 'shade' ? UNITS.shade : UNITS[s.type];
      const name = def?.name || s.type;
      if (this.hud) this.hud.addEvent(`Produced ${name}`);
      let unit;
      if (s.type === 'shade') {
        unit = new Worker({ type: s.type, x: s.x, y: s.y, faction: s.faction });
        if (s.faction === 'player') {
          unit._resourceSystem = this.resources;
        } else if (this.ai && this.ai.enabled) {
          unit._resourceSystem = this.ai.resourceSystem;
        }
        unit._entities = this.entities;
      } else if (s.type === 'builder') {
        if (!this._factionCanProduceBuilder(s.faction)) {
          if (this.hud) this.hud.showNotification('Builder already exists');
          const def = UNITS.builder;
          if (def && def.cost) {
            const rs = s.faction === 'player' ? this.resources : (this.ai?.resourceSystem || null);
            if (rs) rs.refund(def.cost);
          }
          continue;
        }
        unit = new Builder({ type: s.type, x: s.x, y: s.y, faction: s.faction });
        if (s.faction === 'player') {
          unit._resourceSystem = this.resources;
        } else if (this.ai && this.ai.enabled) {
          unit._resourceSystem = this.ai.resourceSystem;
        }
        unit._entities = this.entities;
      } else {
        unit = new Unit({ type: s.type, x: s.x, y: s.y, faction: s.faction });
      }
      this._applyResearchBonuses(unit);
      if (s.rallyPoint) {
        unit.moveTo(s.rallyPoint.x, s.rallyPoint.y);
      }
      this.spawnEntity(unit);
      if (s.faction === 'player' && this.audio) this.audio.unitComplete();
    }
  }

  _detectUnderAttack() {
    if (!this.hud) return;
    for (const id of this._hpCache.keys()) {
      const e = this.entities.get(id);
      if (!e || !e.alive || e.faction !== 'player') this._hpCache.delete(id);
    }
    for (const entity of this.entities.values()) {
      if (!entity.alive || entity.faction !== 'player') continue;
      const prev = this._hpCache.get(entity.id);
      if (prev !== undefined && prev !== entity.hp) {
        if (prev > entity.hp) {
          this.hud.showAttackAlert();
          if (this.audio) this.audio.underAttack();
          this._hpCache.set(entity.id, entity.hp);
          break;
        }
      }
      this._hpCache.set(entity.id, entity.hp);
    }
  }

  _applyResearchBonuses(entity) {
    this._applyBonusesToEntity(entity);
    if (entity && entity.def) {
      const hpMult = this._bonusHpMult();
      if (hpMult > 1) entity.hp = entity.maxHp;
    }
  }

  syncHUD() {
    this.hud.pointerLocked = this.input.isPointerLocked;
    if (this.hud.notification !== this._lastNotif) {
      this.hud._notifTimer = 0;
      this._lastNotif = this.hud.notification;
    }
    this.hud.mouseX = this.input.mouseScreenX;
    this.hud.mouseY = this.input.mouseScreenY;
    this.hud.selectionBox = this.input.selectionBox;
    this.hud.entities = this.entities;
    this.hud.camera = this.camera;
    this.hud.resources = {
      energy: Math.floor(this.resources.resources.energy),
      matter: Math.floor(this.resources.resources.matter),
    };

    if (this._popCache.dirty) {
      this.population.factionAge = this.factionAge;
      this.population.update(this.entities, 0);
      this._popCache.current = this.population._lastPop;
      this._popCache.cap = this.population.popCap;
      this._popCache.dirty = false;
    }
    this.hud.population = {
      current: this._popCache.current,
      cap: this._popCache.cap,
    };

    if (this.construction.isPlacing()) {
      this.construction.updateGhost(this.input.mouseWorldX, this.input.mouseWorldY, this.entities);
    }
    this.hud.construction = this.construction;
    this.hud.factionAge = this.factionAge;
    this.hud.advancingAge = this.advancingAge;
    this.hud.ageAdvanceTimer = this.ageAdvanceTimer;
    this.hud.research = this.research;
    this.hud.fog = this.fog;

    let hovered = this._hoveredEntityCached;
    const mx = this.input.mouseWorldX;
    const my = this.input.mouseWorldY;
    if (mx !== this._lastHoverMX || my !== this._lastHoverMY) {
      this._lastHoverMX = mx;
      this._lastHoverMY = my;
      let hoverDist = 25;
      hovered = null;
      for (const entity of this.entities.values()) {
        if (!entity.alive) continue;
        const dx = entity.x - mx;
        const dy = entity.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < hoverDist) {
          hoverDist = dist;
          hovered = entity;
        }
      }
      this._hoveredEntityCached = hovered;
    }
    this.hud.hoveredEntity = hovered;

    const sel = this.selection.getSelected();
    this.hud._selectedEntity = sel.length === 1 ? sel[0] : null;
    if (sel.length === 1) {
      const e = sel[0];
      if (e instanceof Building && e.productionQueue) {
        this.hud._productionTarget = e;
      } else {
        this.hud._productionTarget = null;
      }
    } else {
      this.hud._productionTarget = null;
    }
    if (sel.length === 1) {
      const e = sel[0];
      let info = `${e.def?.name || e.type}`;
      if (e.state) {
        info += `  [${e.state.toUpperCase()}]`;
      }
      if (e instanceof Worker && e.carriedAmount > 0) {
        info += ` ${e.carriedAmount}/${e.carryCapacity}`;
      }
      if (e.hp) info += `  HP: ${Math.ceil(e.hp)}/${e.maxHp}`;
      if (e.holdPosition) info += '  [HOLD]';
      if (e.attackMove) info += '  [ATTACK-MOVE]';
      this.hud.selectedInfo = info;
    } else if (sel.length > 1) {
      this.hud.selectedInfo = `${sel.length} units`;
    } else {
      this.hud.selectedInfo = null;
    }
  }

  markPopDirty() {
    this._popCache.dirty = true;
  }

  enableAI() {
    if (this.ai.enabled) return;
    let cx = this.ai.baseCenter.x;
    let cy = this.ai.baseCenter.y;
    if (!cx || !cy) {
      for (const e of this.entities.values()) {
        if (e.alive && e.type === 'nexus' && e.faction === this.ai.faction) {
          cx = e.x; cy = e.y; break;
        }
      }
    }
    if (!cx || !cy) {
      cx = 400 + Math.random() * (MAP_WIDTH - 800);
      cy = 400 + Math.random() * (MAP_HEIGHT - 800);
    }
    this.ai.enable(cx, cy);
  }

  disableAI() {
    this.ai.disable();
  }

  _checkWinLoss() {
    if (this.gamePhase === 'gameover') return;
    let playerNexusAlive = false;
    let enemyNexusAlive = false;
    for (const entity of this.entities.values()) {
      if (!entity.alive || entity.type !== 'nexus') continue;
      if (entity.faction === 'player') playerNexusAlive = true;
      else if (entity.faction === this.ai.faction) enemyNexusAlive = true;
    }
    if (!playerNexusAlive) {
      this.gamePhase = 'gameover';
      this._gameOverState = { won: false, reason: 'Your Nexus has been destroyed.' };
      this.pause();
      if (this.audio) this.audio.gameOverDefeat();
    } else if (this.ai.enabled && this.ai._initialSpawned && !enemyNexusAlive) {
      this.gamePhase = 'gameover';
      this._gameOverState = { won: true, reason: 'Enemy Nexus destroyed. Victory!' };
      this.pause();
      if (this.audio) this.audio.victory();
    }
  }

  flushEntities() {
    for (const entity of this.pendingAdd) {
      this.entities.set(entity.id, entity);
    }
    const hadAdd = this.pendingAdd.length > 0;
    this.pendingAdd.length = 0;

    const deadIds = [];
    for (const [id, entity] of this.entities) {
      if (!entity.alive && !this.pendingRemove.includes(id)) {
        if (entity._respawnTimer !== undefined && entity._respawnTimer > 0) continue;
        deadIds.push(id);
      }
    }
    for (const id of deadIds) {
      const entity = this.entities.get(id);
      if (entity && this.particles) {
        const effect = entity.renderLayer === 'buildings' ? EFFECTS.explosion : EFFECTS.death_burst;
        this.particles.emit(entity.x, entity.y, effect);
      }
      if (entity && !entity.resourceType && this.audio) this.audio.death();
      this.pendingRemove.push(id);
    }

    const hadRemove = this.pendingRemove.length > 0;
    for (const id of this.pendingRemove) {
      this.entities.delete(id);
    }
    this.pendingRemove.length = 0;

    if (hadAdd || hadRemove) {
      this._popCache.dirty = true;
      this.combat._powerFieldDirty = true;
    }
  }

  updateDebug() {
    const el = document.getElementById('debug');
    if (el) {
      const sel = this.selection.getFirstSelected();
      let info = `FPS: ${this.fps} | E: ${this.entities.size} | Sel: ${this.selection.count()} | Mkrs: ${this.moveMarkers.length}`;
      if (sel) {
        info += ` | ${sel.type} spd:${sel.speed} dst:${!!sel.destination} pos:${Math.round(sel.x)},${Math.round(sel.y)}`;
        if (sel.holdPosition) info += ' [HOLD]';
        if (sel.attackMove) info += ' [A-MOVE]';
      }
      el.textContent = info;
    }
  }
}
