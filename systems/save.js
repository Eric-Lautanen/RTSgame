import { Worker } from '../entities/worker.js';
import { Builder } from '../entities/builder.js';
import { Unit } from '../entities/unit.js';
import { Building } from '../entities/building.js';
import { Foundation } from '../entities/foundation.js';
import { ResourceNode } from '../entities/resource.js';
import { resetEntityId } from '../entities/entity.js';
import { BUILDINGS } from '../data/buildings.js';

const SAVE_KEY = 'spectral_rts_save_0';
const AUTO_SAVE_INTERVAL = 15;

export class SaveSystem {
  constructor(engine) {
    this.engine = engine;
    this.timer = 0;
    this.lastSave = null;
    this._dirty = false;
  }

  save() {
    try {
      const data = this.serialize();
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      this.lastSave = Date.now();
      return true;
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('Save failed: localStorage quota exceeded');
      }
      return false;
    }
  }

  load() {
    try {
      const json = localStorage.getItem(SAVE_KEY);
      if (!json) return null;
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  hasSave() {
    return localStorage.getItem(SAVE_KEY) !== null;
  }

  deleteSave() {
    localStorage.removeItem(SAVE_KEY);
  }

  update(dt) {
    if (!this._dirty) return;
    this.timer += dt;
    if (this.timer >= AUTO_SAVE_INTERVAL) {
      this.timer = 0;
      if (this.engine && !this.engine.paused) {
        this.save();
        if (this.engine.hud) this.engine.hud.addEvent('Game saved');
        this._dirty = false;
      }
    }
  }

  serialize() {
    const eng = this.engine;
    if (!eng) return null;
    const entityData = [];
    for (const entity of eng.entities.values()) {
      const d = {
        type: entity.type,
        x: entity.x, y: entity.y,
        faction: entity.faction,
        hp: entity.hp, maxHp: entity.maxHp,
        level: entity.level,
        powered: entity.powered,
        renderLayer: entity.renderLayer,
      };
      if (entity.productionQueue) d.productionQueue = entity.productionQueue;
      if (entity.productionTimer !== undefined) d.productionTimer = entity.productionTimer;
      if (entity.buildProgress !== undefined) d.buildProgress = entity.buildProgress;
      if (entity.rallyPoint) d.rallyPoint = entity.rallyPoint;
      if (entity.killCount) d.killCount = entity.killCount;
      if (entity.state !== undefined) d.state = entity.state;
      if (entity.carriedAmount > 0) d.carriedAmount = entity.carriedAmount;
      if (entity.carriedType) d.carriedType = entity.carriedType;
      if (entity.buildingType) d.buildingType = entity.buildingType;
      if (entity.amount !== undefined) d.amount = entity.amount;
      if (entity.resourceType) d.resourceType = entity.resourceType;
      if (entity.upgrading) { d.upgrading = true; d.upgradeTimer = entity.upgradeTimer; }
      entityData.push(d);
    }
    return {
      version: 2,
      timestamp: Date.now(),
      elapsed: eng.age || 0,
      camera: { x: eng.camera?.x || 0, y: eng.camera?.y || 0, zoom: eng.camera?.zoom || 1 },
      resources: { ...(eng.resources?.resources || { energy: 500, matter: 300 }) },
      passiveIncome: { ...(eng.resources?.passiveIncome || { energy: 0, matter: 0 }) },
      incomeMultiplier: eng.resources?.incomeMultiplier || 1,
      factionAge: eng.factionAge || 'spectral_dawn',
      advancingAge: eng.advancingAge || false,
      ageAdvanceTimer: eng.ageAdvanceTimer || 0,
      research: {
        completed: eng.research ? [...eng.research.completed] : [],
        upgradeLevels: eng.research ? { ...eng.research.upgradeLevels } : {},
        queue: eng.research ? eng.research.queue.map(q => ({ ...q })) : [],
      },
      entities: entityData,
    };
  }

  deserialize(data) {
    const eng = this.engine;
    if (!data || !eng) return false;

    for (const entity of eng.entities.values()) {
      entity.die();
    }
    eng.entities.clear();
    eng.pendingAdd = [];
    eng.pendingRemove = [];
    resetEntityId();

    if (data.resources) eng.resources.resources = { ...data.resources };
    if (data.passiveIncome) eng.resources.passiveIncome = { ...data.passiveIncome };
    if (data.incomeMultiplier !== undefined) eng.resources.incomeMultiplier = data.incomeMultiplier;

    if (data.camera) {
      eng.camera.x = data.camera.x; eng.camera.targetX = data.camera.x;
      eng.camera.y = data.camera.y; eng.camera.targetY = data.camera.y;
      eng.camera.zoom = data.camera.zoom; eng.camera.targetZoom = data.camera.zoom;
    }
    if (data.elapsed) eng.age = data.elapsed;
    if (data.factionAge) eng.factionAge = data.factionAge;
    eng.advancingAge = data.advancingAge || false;
    eng.ageAdvanceTimer = data.ageAdvanceTimer || 0;

    if (data.research) {
      eng.research.completed = new Set(data.research.completed || []);
      eng.research.upgradeLevels = { ...(data.research.upgradeLevels || {}) };
      eng.research.queue = (data.research.queue || []).map(q => ({ ...q }));
    }

    if (data.entities) {
      for (const ed of data.entities) {
        let entity = null;
        const rl = ed.renderLayer;
        const isKnownBuilding = ed.type && !!BUILDINGS[ed.type];
        if (ed.type === 'foundation') {
          entity = new Foundation({ buildingType: ed.buildingType || 'pylon', x: ed.x, y: ed.y, faction: ed.faction });
          if (ed.buildProgress !== undefined) entity.buildProgress = ed.buildProgress;
        } else if ((rl === 'buildings' || isKnownBuilding) && ed.type !== 'foundation') {
          entity = new Building({ type: ed.type, x: ed.x, y: ed.y, faction: ed.faction });
          if (ed.level && ed.level > 1) { entity.level = ed.level; entity.maxHp = ed.maxHp || entity.maxHp; entity.hp = Math.min(entity.hp, entity.maxHp); }
          if (ed.powered !== undefined) entity.powered = ed.powered;
          if (ed.productionQueue) entity.productionQueue = ed.productionQueue;
          if (ed.productionTimer !== undefined) entity.productionTimer = ed.productionTimer;
          if (ed.rallyPoint) entity.rallyPoint = ed.rallyPoint;
          if (ed.upgrading) { entity.upgrading = true; entity.upgradeTimer = ed.upgradeTimer || 0; }
        } else if (ed.type === 'builder') {
          entity = new Builder({ type: ed.type, x: ed.x, y: ed.y, faction: ed.faction });
          if (ed.faction === 'player') {
            entity._resourceSystem = eng.resources;
          } else if (ed.faction === 'enemy') {
            entity._resourceSystem = eng.ai?.resourceSystem || null;
          }
          entity._entities = eng.entities;
          entity.state = 'idle';
        } else if (ed.type === 'shade' || (rl === 'units' && ed.type !== 'foundation')) {
          if (ed.type === 'shade') {
            entity = new Worker({ type: ed.type, x: ed.x, y: ed.y, faction: ed.faction });
            if (ed.carriedAmount > 0) entity.carriedAmount = ed.carriedAmount;
            if (ed.carriedType) entity.carriedType = ed.carriedType;
            if (ed.faction === 'player') {
              entity._resourceSystem = eng.resources;
            } else if (ed.faction === 'enemy') {
              entity._resourceSystem = eng.ai?.resourceSystem || null;
            }
          } else {
            entity = new Unit({ type: ed.type, x: ed.x, y: ed.y, faction: ed.faction });
            if (ed.killCount) entity.killCount = ed.killCount;
          }
        } else if (ed.resourceType || ed.amount !== undefined) {
          entity = new ResourceNode({
            type: ed.type, x: ed.x, y: ed.y,
            amount: ed.amount || 0, resourceType: ed.resourceType || 'energy',
            color: '#00ffcc', glowColor: '#00ffcc',
          });
        } else {
          entity = new Unit({ type: ed.type, x: ed.x, y: ed.y, faction: ed.faction });
          if (ed.killCount) entity.killCount = ed.killCount;
        }
        if (entity) {
          entity.hp = Math.min(ed.hp || entity.maxHp, entity.maxHp);
          if (entity instanceof Worker || entity instanceof Builder) {
            entity._entities = eng.entities;
          }
          eng.spawnEntity(entity);
        }
      }
    }
    this._dirty = false;
    return true;
  }
}
