import { THEME } from '../data/theme.js';
import { MAP_WIDTH, MAP_HEIGHT } from '../data/world.js';
import { BUILDINGS } from '../data/buildings.js';
import { UNITS } from '../data/units.js';
import { UPGRADES } from '../data/upgrades.js';
import { AGES, AGE_ORDER } from '../data/ages.js';
import { Worker } from '../entities/worker.js';
import { Builder } from '../entities/builder.js';
import { Building } from '../entities/building.js';

const BUILD_BUTTONS = ['pylon', 'supply_depot', 'barracks', 'turret', 'research_spire', 'refinery', 'energy_condenser'];
const SHORTCUT_KEYS = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U'];
const EVENT_LOG_MAX = 8;
const SETTINGS_KEY = 'spectral_rts_settings';

export class HUD {
  constructor(ctx, canvas) {
    this.ctx = ctx;
    this.canvas = canvas;
    this.resources = { energy: 0, matter: 0 };
    this._displayEnergy = 0;
    this._displayMatter = 0;
    this.population = { current: 0, cap: 10 };
    this.selectedInfo = null;
    this.minimapWidth = 160;
    this.minimapHeight = 160;
    this.minimapMargin = 10;
    this.pointerLocked = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this.selectionBox = null;
    this.notification = null;
    this._notifTimer = 0;
    this.entities = null;
    this.camera = null;
    this.hoveredEntity = null;
    this.construction = null;
    this.engine = null;
    this._buttons = [];
    this._selectedEntity = null;
    this._productionTarget = null;
    this.factionAge = 'spectral_dawn';
    this.advancingAge = false;
    this.ageAdvanceTimer = 0;
    this._showTechTree = false;
    this._showSettings = false;
    this.research = null;
    this._events = [];
    this._attackAlertTimer = 0;
    this.fog = null;
    this._showStartMenu = true;
    this._showPauseMenu = false;
    this.settings = {
      fogEnabled: true,
      glowEnabled: true,
      powerOverlay: false,
      enemyAI: false,
    };
    this._loadSettings();
  }

  _loadSettings() {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) Object.assign(this.settings, JSON.parse(saved));
    } catch {}
  }

  _saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {}
  }

  setEngine(engine) {
    this.engine = engine;
    this._applySettings();
  }

  _applySettings() {
    this._saveSettings();
    if (this.engine) {
      if (this.engine.fog) this.engine.fog.enabled = this.settings.fogEnabled;
      if (this.engine.renderer) this.engine.renderer.glowEnabled = this.settings.glowEnabled;
      if (this.construction) this.construction.showPowerOverlay = this.settings.powerOverlay;
      if (this.engine.ai) {
        if (this.settings.enemyAI && !this.engine.ai.enabled) {
          this.engine.enableAI();
          this.addEvent('Enemy AI activated');
        } else if (!this.settings.enemyAI && this.engine.ai.enabled) {
          this.engine.disableAI();
          this.addEvent('Enemy AI deactivated');
        }
      }
    }
  }

  addEvent(text) {
    this._events.push({ text, time: performance.now() });
    if (this._events.length > EVENT_LOG_MAX) this._events.shift();
  }

  showAttackAlert() {
    this._attackAlertTimer = 90;
  }

  showNotification(text) {
    this.notification = text;
    this._notifTimer = 0;
  }

  render() {
    const ctx = this.ctx;
    ctx.save();
    this._buttons = [];

    if (this._showStartMenu) {
      this.drawStartMenu(ctx);
      ctx.restore();
      return;
    }

    const lerpE = (this.resources.energy - this._displayEnergy) * 0.08;
    const lerpM = (this.resources.matter - this._displayMatter) * 0.08;
    if (Math.abs(lerpE) < 0.5) this._displayEnergy = this.resources.energy;
    else this._displayEnergy += lerpE;
    if (Math.abs(lerpM) < 0.5) this._displayMatter = this.resources.matter;
    else this._displayMatter += lerpM;
    if (this._displayEnergy < 0) this._displayEnergy = this.resources.energy;
    if (this._displayMatter < 0) this._displayMatter = this.resources.matter;

    if (this._attackAlertTimer > 0) this._attackAlertTimer--;

    if (this._showTechTree) {
      this.drawTechTree(ctx);
      const hoveredBtn = this._findButtonUnderMouse();
      this.canvas.style.cursor = hoveredBtn ? 'pointer' : 'default';
      ctx.restore();
      return;
    }

    this.drawResourceBar(ctx);
    this.drawUnitButtons(ctx);
    this.drawCommandCard(ctx);
    this.drawMinimap(ctx);
    this.drawSelectedInfo(ctx);
    this.drawEventLog(ctx);

    if (this.selectionBox) {
      this.drawSelectionBox(ctx);
    }

    if (this.pointerLocked) {
      this.drawCrosshair(ctx);
    }

    if (this.notification) {
      this.drawNotification(ctx);
    }

    if (this.hoveredEntity) {
      this.drawTooltip(ctx);
    }

    const hoveredBtn = this._findButtonUnderMouse();
    if (hoveredBtn) {
      this.drawButtonTooltip(ctx, hoveredBtn);
    }

    if (this._showPauseMenu) {
      this.drawPauseMenu(ctx);
    }

    if (this.engine && this.engine.gamePhase === 'gameover') {
      this.drawGameOver(ctx);
    }

    ctx.restore();
  }

  isOverUI(mx, my) {
    for (const btn of this._buttons) {
      const pad = 15;
      if (mx >= btn.x - pad && mx <= btn.x + btn.w + pad && my >= btn.y - pad && my <= btn.y + btn.h + pad) return true;
    }
    return false;
  }

  _isBuildingUnlocked(type) {
    const def = BUILDINGS[type];
    if (!def) return false;
    if (def.requiresAge) {
      if (AGE_ORDER.indexOf(this.factionAge) < AGE_ORDER.indexOf(def.requiresAge)) return false;
    }
    if (!def.requiresBuilding || def.requiresBuilding.length === 0) return true;
    if (!this.entities) return false;
    for (const req of def.requiresBuilding) {
      let found = false;
      for (const e of this.entities.values()) {
        if (e.alive && e.type === req && e.renderLayer === 'buildings') { found = true; break; }
      }
      if (!found) return false;
    }
    return true;
  }

  handleClick(sx, sy) {
    const { minimapWidth: mw, minimapHeight: mh, minimapMargin: mm } = this;
    const mx = this.canvas.width - mw - mm;
    const my = this.canvas.height - mh - mm - 32;
    if (sx >= mx && sx <= mx + mw && sy >= my && sy <= my + mh && this.camera) {
      const worldX = (sx - mx) / mw * MAP_WIDTH;
      const worldY = (sy - my) / mh * MAP_HEIGHT;
      this.camera.targetX = worldX;
      this.camera.targetY = worldY;
      return true;
    }

    for (const btn of this._buttons) {
      if (sx >= btn.x && sx <= btn.x + btn.w && sy >= btn.y && sy <= btn.y + btn.h) {
        if (btn.action === 'build') {
          if (this.construction) {
            if (!this._isBuildingUnlocked(btn.buildingType)) {
              const def = BUILDINGS[btn.buildingType];
              if (def) {
                const needs = [];
                if (def.requiresAge) {
                  const ageDef = AGES[def.requiresAge];
                  if (ageDef) needs.push(`age: ${ageDef.name}`);
                }
                if (def.requiresBuilding && def.requiresBuilding.length > 0) {
                  const names = def.requiresBuilding.map(b => BUILDINGS[b]?.name || b);
                  needs.push(`requires: ${names.join(', ')}`);
                }
                this.showNotification(`Locked — ${needs.join(', ')}`);
              }
              if (this.engine?.audio) this.engine.audio.placementError();
              return true;
            }
            const def = BUILDINGS[btn.buildingType];
            if (!this.engine || !this.engine.resources.canAfford(def.cost)) {
              this.showNotification('Insufficient resources');
              if (this.engine?.audio) this.engine.audio.uiError();
              return true;
            }
            this.construction.startPlacement(btn.buildingType);
            if (this.engine?.audio) this.engine.audio.uiClick();
          }
          return true;
        }
        if (btn.action === 'produce') {
          if (this.engine && this._productionTarget && btn.unitType) {
            if (this._productionTarget.type === 'nexus' && this.advancingAge) return true;
            const def = UNITS[btn.unitType];
            if (!def) return true;
            if (!this.engine.resources.canAfford(def.cost)) {
              this.showNotification('Insufficient resources');
              if (this.engine?.audio) this.engine.audio.uiError();
              return true;
            }
            if (!this.engine.population.canProduce(this.engine.entities, def.supplyCost || 1, btn.unitType)) {
              this.showNotification('Unit limit reached for this age');
              if (this.engine?.audio) this.engine.audio.uiError();
              return true;
            }
            if (this.engine.production.queueUnit(this._productionTarget, btn.unitType)) {
              this.showNotification(`Producing ${def.name}`);
              if (this.engine?.audio) this.engine.audio.queueUnit();
            }
          }
          return true;
        }
        if (btn.action === 'upgrade') {
          if (this.engine && this._selectedEntity && this._selectedEntity.startUpgrade) {
            if (!this._selectedEntity.startUpgrade(this.engine.resources)) {
              this.showNotification('Cannot upgrade — insufficient resources or already upgrading');
              if (this.engine?.audio) this.engine.audio.uiError();
            } else if (this.engine?.audio) {
              this.engine.audio.upgradeStart();
            }
          }
          return true;
        }
        if (btn.action === 'cancel_placement') {
          if (this.construction) this.construction.cancelPlacement();
          if (this.engine?.audio) this.engine.audio.uiClose();
          return true;
        }
        if (btn.action === 'scuttle') {
          if (this.engine && this._selectedEntity && this._selectedEntity.canScuttle && this._selectedEntity.canScuttle()) {
            this._selectedEntity.scuttle(this.engine.resources);
            if (this.engine?.audio) this.engine.audio.scuttle();
          }
          return true;
        }
        if (btn.action === 'research') {
          if (this._showTechTree) {
            this._showTechTree = false;
            if (this.engine?.audio) this.engine.audio.uiClose();
          } else if (this.engine) {
            this._showTechTree = true;
            if (this.engine?.audio) this.engine.audio.uiClick();
          }
          return true;
        }
        if (btn.action === 'tech_tree_research') {
          if (btn.upgradeKey && this.engine && this.research) {
            const upgrade = UPGRADES[btn.upgradeKey];
            if (upgrade && this.research.canResearch(upgrade, this.factionAge, this.entities)) {
              this.research.queueResearch(upgrade);
              if (this.engine?.audio) this.engine.audio.researchStart();
            }
          } else {
            if (this._showTechTree) {
              this._showTechTree = false;
              if (this.engine?.audio) this.engine.audio.uiClose();
            } else if (this.engine) {
              this._showTechTree = true;
              if (this.engine?.audio) this.engine.audio.uiClick();
            }
          }
          return true;
        }
        if (btn.action === 'close_tech_tree') {
          this._showTechTree = false;
          if (this.engine?.audio) this.engine.audio.uiClose();
          return true;
        }
        if (btn.action === 'advance_age') {
          if (this.engine) this.engine.startAgeAdvance();
          return true;
        }
        if (btn.action === 'cancel_research') {
          if (this.research && this.research.queue.length > 0) {
            const cancelled = this.research.queue.shift();
            if (this.engine && cancelled.cost) this.engine.resources.refund(cancelled.cost);
            if (this.engine?.audio) this.engine.audio.uiClose();
          }
          return true;
        }
        if (btn.action === 'toggle_settings') {
          const wasOpen = this._showSettings;
          this._showSettings = !wasOpen;
          if (this.engine?.audio) {
            if (!wasOpen) this.engine.audio.uiToggleOn();
            else this.engine.audio.uiToggleOff();
          }
          return true;
        }
        if (btn.action === 'toggle_setting') {
          const key = btn.setting;
          const wasOn = this.settings[key];
          this.settings[key] = !wasOn;
          this._applySettings();
          if (this.engine?.audio) {
            if (!wasOn) this.engine.audio.uiToggleOn();
            else this.engine.audio.uiToggleOff();
          }
          return true;
        }
        if (btn.action === 'new_game') {
          this._showSettings = false;
          if (this.engine?.audio) this.engine.audio.uiClick();
          if (this.engine) this.engine.startGame();
          return true;
        }
        if (btn.action === 'restore_game') {
          this._showSettings = false;
          if (this.engine?.audio) this.engine.audio.uiClick();
          if (this.engine) this.engine.loadGame();
          return true;
        }
        if (btn.action === 'back_to_menu') {
          if (this.engine?.audio) this.engine.audio.uiClick();
          this._showStartMenu = true;
          if (this.engine) {
            this.engine.stop();
            this.engine.gamePhase = 'menu';
          }
          location.reload();
          return true;
        }
        if (btn.action === 'resume') {
          this._showPauseMenu = false;
          this._showSettings = false;
          if (this.engine?.audio) this.engine.audio.uiClick();
          if (this.engine) { this.engine.gamePhase = 'playing'; this.engine.resume(); }
          return true;
        }
        if (btn.action === 'quit_to_menu') {
          this._showPauseMenu = false;
          this._showSettings = false;
          this._showStartMenu = true;
          if (this.engine) {
            if (this.engine?.audio) this.engine.audio.uiClose();
            if (this.engine.ai) this.engine.disableAI();
            this.engine.gamePhase = 'menu';
            this.engine.pause();
          }
          return true;
        }
        if (btn.action === 'set_volume') {
          if (this.engine && this.engine.audio) {
            const pct = (sx - btn.x) / btn.w;
            const vol = Math.max(0, Math.min(1, pct));
            this.engine.audio.volume = vol;
          }
          return true;
        }
        if (btn.action === 'set_speed') {
          if (this.engine) {
            this.engine.gameSpeed = this.engine.gameSpeed >= 2 ? 1 : 2;
            if (this.engine.audio) this.engine.audio.uiToggleOn();
          }
          return true;
        }
        if (btn.action === 'select_type') {
          if (this.engine && btn.unitType) {
            this.engine.selection.selectAllOfType(btn.unitType, this.engine.entities);
            if (this.engine.audio) {
              const first = this.engine.selection.getFirstSelected();
              if (first && first.def) this.engine.audio.selectUnit(first.def);
              else this.engine.audio.uiClick();
            }
          }
          return true;
        }
        if (btn.action === 'select_idle_workers') {
          if (this.engine) {
            this.engine.selection.clearSelection();
            for (const e of this.engine.entities.values()) {
              if (e.alive && e.faction === 'player' && e instanceof Worker && e.state === 'idle') {
                e.selected = true;
                this.engine.selection.selectedEntities.add(e);
              }
            }
            if (this.engine.audio) this.engine.audio.selectMultiple();
          }
          return true;
        }
        if (btn.action === 'select_idle_builders') {
          if (this.engine) {
            this.engine.selection.clearSelection();
            for (const e of this.engine.entities.values()) {
              if (e.alive && e.faction === 'player' && e instanceof Builder && e.state === 'idle') {
                e.selected = true;
                this.engine.selection.selectedEntities.add(e);
              }
            }
            if (this.engine.audio) this.engine.audio.selectMultiple();
          }
          return true;
        }
        return true;
      }
    }
    return false;
  }

  drawUnitButtons(ctx) {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;

    const types = {};
    let idleWorkers = 0;
    let idleBuilders = 0;
    if (this.entities) {
      for (const e of this.entities.values()) {
        if (!e.alive || e.faction !== 'player') continue;
        if (e.renderLayer !== 'units') continue;
        const key = e.type || 'unknown';
        if (!types[key]) types[key] = { count: 0, def: e.def, type: e.type };
        types[key].count++;
        if (e instanceof Worker && e.state === 'idle') idleWorkers++;
        if (e instanceof Builder && e.state === 'idle') idleBuilders++;
      }
    }

    const keys = Object.keys(types).sort();
    const btnSize = 38;
    const gap = 4;
    const panelX = 6;
    const totalBtns = (idleWorkers > 0 ? 1 : 0) + (idleBuilders > 0 ? 1 : 0) + keys.length;
    const totalH = totalBtns * btnSize + (totalBtns - 1) * gap;
    const topMargin = 40;
    const bottomMargin = 200;
    const availH = ch - topMargin - bottomMargin;
    const centerY = topMargin + availH / 2;
    const startY = Math.round(centerY + (totalBtns - 1) * (btnSize + gap) / 2);
    let y = startY;

    if (idleWorkers > 0) {
      this._buttons.push({ x: panelX, y, w: btnSize, h: btnSize, action: 'select_idle_workers' });
      ctx.fillStyle = '#0a1a0a';
      ctx.strokeStyle = THEME.UI_GOLD;
      ctx.lineWidth = 1;
      ctx.fillRect(panelX, y, btnSize, btnSize);
      ctx.strokeRect(panelX, y, btnSize, btnSize);
      ctx.fillStyle = THEME.UI_GOLD;
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('W!', panelX + btnSize / 2, y + btnSize / 2 - 2);
      ctx.font = '9px monospace';
      ctx.fillStyle = THEME.SPECTER_WHITE;
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'right';
      ctx.fillText(String(idleWorkers), panelX + btnSize - 2, y + btnSize - 2);
      y -= btnSize + gap;
    }

    if (idleBuilders > 0) {
      this._buttons.push({ x: panelX, y, w: btnSize, h: btnSize, action: 'select_idle_builders' });
      ctx.fillStyle = '#1a1a0a';
      ctx.strokeStyle = '#ffcc44';
      ctx.lineWidth = 1;
      ctx.fillRect(panelX, y, btnSize, btnSize);
      ctx.strokeRect(panelX, y, btnSize, btnSize);
      ctx.fillStyle = '#ffcc44';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('B!', panelX + btnSize / 2, y + btnSize / 2 - 2);
      ctx.font = '9px monospace';
      ctx.fillStyle = THEME.SPECTER_WHITE;
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'right';
      ctx.fillText(String(idleBuilders), panelX + btnSize - 2, y + btnSize - 2);
      y -= btnSize + gap;
    }

    for (const key of keys) {
      const info = types[key];
      const def = info.def;
      const color = def?.color || '#00ffcc';
      const glowColor = def?.glowColor || color;
      const shape = def?.shape || 'circle';
      const displayName = def?.name || key;

      this._buttons.push({ x: panelX, y, w: btnSize, h: btnSize, action: 'select_type', unitType: key });
      ctx.fillStyle = '#0a0a15';
      ctx.strokeStyle = THEME.GRID;
      ctx.lineWidth = 1;
      ctx.fillRect(panelX, y, btnSize, btnSize);
      ctx.strokeRect(panelX, y, btnSize, btnSize);

      const cx = panelX + btnSize / 2;
      const cy = y + btnSize / 2;
      const s = 8;
      const sides = shape === 'hexagon' ? 6 : shape === 'octagon' ? 8 : shape === 'square' ? 4 : shape === 'diamond' ? 4 : 0;
      if (sides > 0) {
        const rot = shape === 'diamond' ? Math.PI / 4 : 0;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
          const a = (Math.PI * 2 / sides) * i + rot;
          const px = cx + Math.cos(a) * s;
          const py = cy + Math.sin(a) * s;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(cx, cy, s, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = THEME.SPECTER_WHITE;
      ctx.font = '9px monospace';
      const cap = this.engine?.population?.getUnitCap(key);
      const atCap = cap !== undefined && cap !== Infinity && info.count >= cap;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = atCap ? THEME.UI_GOLD : THEME.SPECTER_WHITE;
      ctx.fillText(atCap ? `${info.count}/${cap}` : String(info.count), panelX + btnSize - 2, y + btnSize - 2);

      if (atCap) {
        ctx.fillStyle = THEME.UI_GOLD + '22';
        ctx.fillRect(panelX, y, btnSize, btnSize);
      }

      y -= btnSize + gap;
    }
  }

  drawCommandCard(ctx) {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const S = 1.5;
    const cardY = ch - Math.round(120 * S);
    const cardH = Math.round(88 * S);
    const cardX = 10;
    const btnSize = Math.round(64 * S);
    const gap = Math.round(6 * S);
    const cols = BUILD_BUTTONS.length;
    const totalW = cols * btnSize + (cols - 1) * gap;

    ctx.fillStyle = THEME.PANEL_BG;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(cardX, cardY, totalW + Math.round(24 * S), cardH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = THEME.GRID;
    ctx.lineWidth = 1;
    ctx.strokeRect(cardX, cardY, totalW + Math.round(24 * S), cardH);

    for (let i = 0; i < cols; i++) {
      const type = BUILD_BUTTONS[i];
      const def = BUILDINGS[type];
      if (!def) continue;

      const bx = cardX + Math.round(8 * S) + i * (btnSize + gap);
      const by = cardY + (cardH - btnSize) / 2;
      const placing = this.construction && this.construction.isPlacing() && this.construction.activeType === type;
      const canAfford = this.engine && this.engine.resources.canAfford(def.cost);
      const unlocked = this._isBuildingUnlocked(type);

      this._buttons.push({ x: bx, y: by, w: btnSize, h: btnSize, action: 'build', buildingType: type });

      const active = placing || (canAfford && unlocked);
      const locked = !unlocked;
      const dimFactor = locked ? 0.25 : (canAfford ? 1 : 0.45);

      ctx.fillStyle = placing ? THEME.SPECTER_CYAN + '33' : (active ? '#050510' : '#0a0a15');
      ctx.strokeStyle = placing ? THEME.SPECTER_CYAN : (active ? THEME.GRID : (locked ? '#553333' : '#445566'));
      ctx.lineWidth = placing ? 1.5 : 1;
      ctx.globalAlpha = dimFactor;
      ctx.fillRect(bx, by, btnSize, btnSize);
      ctx.strokeRect(bx, by, btnSize, btnSize);
      ctx.globalAlpha = 1;

      const cx = bx + btnSize / 2;
      const cy = by + btnSize / 2 - Math.round(6 * S);
      const s = def.scale * 3 * S;
      const shape = def.shape || 'hexagon';
      const sides = shape === 'hexagon' ? 6 : shape === 'octagon' ? 8 : shape === 'square' ? 4 : 6;

      const iconColor = locked ? '#553333' : (placing ? THEME.SPECTER_CYAN : def.color);
      ctx.strokeStyle = iconColor;
      ctx.fillStyle = iconColor;
      ctx.globalAlpha = locked ? 0.15 : (canAfford ? 0.6 : 0.2);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let j = 0; j < sides; j++) {
        const a = (Math.PI * 2 / sides) * j - Math.PI / 2;
        const px = cx + s * Math.cos(a);
        const py = cy + s * Math.sin(a);
        j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = THEME.NEUTRAL_GREY;
      ctx.globalAlpha = 0.5;
      ctx.font = `${Math.round(7 * S)}px monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(SHORTCUT_KEYS[i], bx + Math.round(3 * S), by + Math.round(3 * S));
      ctx.globalAlpha = 1;

      if (locked) {
        ctx.fillStyle = THEME.ENEMY_RED;
        ctx.globalAlpha = 0.6;
        ctx.font = `${Math.round(14 * S)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔒', cx, cy);
        ctx.globalAlpha = 1;
        ctx.font = `${Math.round(6 * S)}px monospace`;
        ctx.fillStyle = '#aa6677';
        ctx.textBaseline = 'bottom';
        const reqs = (def.requiresBuilding || []).join(',');
        ctx.fillText(reqs, cx, by + btnSize - 2);
      } else {
        ctx.fillStyle = canAfford ? THEME.SPECTER_WHITE : '#556677';
        ctx.font = `${Math.round(8 * S)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(def.name, cx, by + btnSize - 2);
      }

      const costStr = `⚡${def.cost?.energy || 0} ◆${def.cost?.matter || 0}`;
      ctx.fillStyle = canAfford ? THEME.NEUTRAL_GREY : '#445566';
      ctx.font = `${Math.round(7 * S)}px monospace`;
      ctx.textBaseline = 'top';
      ctx.fillText(costStr, cx, by + 2);
    }

    if (this.construction && this.construction.isPlacing()) {
      const cancelX = cardX + totalW + Math.round(14 * S);
      const cancelY = cardY + Math.round(4 * S);
      const cancelW = Math.round(16 * S);
      const cancelH = Math.round(16 * S);
      this._buttons.push({ x: cancelX, y: cancelY, w: cancelW, h: cancelH, action: 'cancel_placement' });
      ctx.fillStyle = THEME.ENEMY_RED + '66';
      ctx.strokeStyle = THEME.ENEMY_RED;
      ctx.lineWidth = 1;
      ctx.fillRect(cancelX, cancelY, cancelW, cancelH);
      ctx.strokeRect(cancelX, cancelY, cancelW, cancelH);
      ctx.fillStyle = THEME.ENEMY_RED;
      ctx.font = `${Math.round(11 * S)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✕', cancelX + cancelW / 2, cancelY + cancelH / 2);
    }
  }

  drawSelectedInfo(ctx) {
    const sel = this._selectedEntity;
    if (!sel) {
      if (this.selectedInfo) {
        const cx = ctx.canvas.width / 2;
        const y = ctx.canvas.height - 32;
        ctx.fillStyle = THEME.SPECTER_WHITE;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '13px monospace';
        ctx.fillText(this.selectedInfo, cx, y + 16);
      }
      return;
    }

    if (!this.camera) return;

    const sp = this.camera.worldToScreen(sel.x, sel.y);
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const bsr = (sel.def?.scale || 1) * 20 * this.camera.zoom;

    if (sel instanceof Building) {
      const S = 1.5;
      const panelW = Math.round(300 * S);
      const panelH = Math.round(190 * S);

      let panelX = sp.x + bsr + 15;
      let panelY = sp.y - bsr - panelH + 30;

      if (panelX + panelW > cw - 10) panelX = sp.x - bsr - panelW - 15;
      if (panelY < 36) panelY = sp.y + bsr + 15;
      if (panelY + panelH > ch - 10) panelY = ch - panelH - 10;
      panelX = Math.max(10, Math.min(cw - panelW - 10, panelX));

      ctx.fillStyle = THEME.PANEL_BG;
      ctx.globalAlpha = 0.92;
      ctx.fillRect(panelX, panelY, panelW, panelH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = THEME.SPECTER_CYAN;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.strokeRect(panelX, panelY, panelW, panelH);
      ctx.globalAlpha = 1;

      const name = sel.def?.name || sel.type || 'Unknown';
      ctx.fillStyle = THEME.SPECTER_WHITE;
      ctx.font = `bold ${Math.round(14 * S)}px monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(name, panelX + Math.round(10 * S), panelY + Math.round(8 * S));

      const hp = `HP: ${Math.ceil(sel.hp)}/${sel.maxHp}`;
      ctx.fillStyle = THEME.NEUTRAL_GREY;
      ctx.font = `${Math.round(11 * S)}px monospace`;
      ctx.fillText(hp, panelX + Math.round(10 * S), panelY + Math.round(28 * S));

      const hpPct = sel.hp / sel.maxHp;
      const hpColor = hpPct > 0.5 ? THEME.SPECTER_CYAN : (hpPct > 0.25 ? THEME.UI_GOLD : THEME.ENEMY_RED);
      const hpBarX = panelX + Math.round(10 * S);
      const hpBarY = panelY + Math.round(42 * S);
      const hpBarW = panelW - Math.round(20 * S);
      const hpBarH = Math.round(4 * S);
      ctx.fillStyle = '#33111166';
      ctx.fillRect(hpBarX, hpBarY, hpBarW, hpBarH);
      ctx.fillStyle = hpColor;
      ctx.fillRect(hpBarX, hpBarY, hpBarW * hpPct, hpBarH);

      if (sel.type !== 'nexus' && sel.type !== 'pylon') {
        const powerColor = sel.powered ? THEME.SPECTER_CYAN : THEME.ENEMY_RED;
        const powerText = sel.powered ? '⚡ Powered' : '⛔ Unpowered';
        ctx.fillStyle = powerColor;
        ctx.font = `${Math.round(10 * S)}px monospace`;
        ctx.fillText(powerText, panelX + panelW - Math.round(90 * S), panelY + Math.round(28 * S));
      }

      if (sel.productionQueue && sel.productionQueue.length > 0) {
        ctx.fillStyle = THEME.SPECTER_CYAN;
        ctx.font = `${Math.round(10 * S)}px monospace`;
        ctx.fillText(`Queue: ${sel.productionQueue.length}`, panelX + Math.round(140 * S), panelY + Math.round(28 * S));

        const firstType = sel.productionQueue[0];
        const unitDef = UNITS[firstType];
        if (unitDef && unitDef.buildTime) {
          const totalTime = unitDef.buildTime;
          const remaining = Math.max(0, sel.productionTimer);
          const progress = Math.min(1, Math.max(0, 1 - remaining / totalTime));

          const pbx = panelX + Math.round(10 * S);
          const pby = panelY + Math.round(50 * S);
          const pbw = panelW - Math.round(20 * S);
          const pbh = Math.round(12 * S);

          ctx.fillStyle = '#050510';
          ctx.fillRect(pbx, pby, pbw, pbh);
          ctx.fillStyle = THEME.SPECTER_CYAN;
          ctx.globalAlpha = 0.7;
          ctx.fillRect(pbx + 1, pby + 1, (pbw - 2) * progress, pbh - 2);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = THEME.GRID;
          ctx.lineWidth = 1;
          ctx.strokeRect(pbx, pby, pbw, pbh);

          ctx.fillStyle = THEME.SPECTER_WHITE;
          ctx.font = `${Math.round(8 * S)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${unitDef.name}  ${Math.floor(progress * 100)}%`, pbx + pbw / 2, pby + pbh / 2);
          ctx.textAlign = 'left';
        }
      }

      this._buttons = this._buttons.filter(b => b.action !== 'produce');

      const produces = sel.def?.produces || [];
      if (produces.length > 0) {
        const btnAreaX = panelX + Math.round(10 * S);
        const btnAreaW = panelW - Math.round(20 * S);
        const labelY = panelY + Math.round(68 * S);
        const btnH = Math.round(32 * S);
        const gap = Math.round(6 * S);
        const cols = Math.min(produces.length, 3);
        const btnW = Math.floor((btnAreaW - (cols - 1) * gap) / cols);

        ctx.fillStyle = THEME.NEUTRAL_GREY;
        ctx.font = `${Math.round(10 * S)}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Produce:', btnAreaX, labelY);

        const startY = labelY + Math.round(16 * S);
        for (let i = 0; i < produces.length; i++) {
          const unitType = produces[i];
          const unitDef = UNITS[unitType];
          if (!unitDef) continue;
          const col = i % cols;
          const row = Math.floor(i / cols);
          const bx = btnAreaX + col * (btnW + gap);
          const by = startY + row * (btnH + gap);

          const prereqOk = this.engine && this.engine.production.canQueue(sel, unitType, this.engine.entities);
          const canProd = prereqOk && this.engine.resources.canAfford(unitDef.cost)
            && this.engine.population.canProduce(this.engine.entities, unitDef.supplyCost || 1, unitType);

          this._buttons.push({ x: bx, y: by, w: btnW, h: btnH, action: 'produce', unitType });

          ctx.fillStyle = canProd ? '#101025' : '#0a0a15';
          ctx.strokeStyle = canProd ? THEME.SPECTER_CYAN : '#334455';
          ctx.globalAlpha = canProd ? 0.8 : 0.5;
          ctx.lineWidth = 1;
          ctx.fillRect(bx, by, btnW, btnH);
          ctx.strokeRect(bx, by, btnW, btnH);
          ctx.globalAlpha = 1;

          ctx.fillStyle = canProd ? THEME.SPECTER_WHITE : '#556677';
          ctx.font = `${Math.round(11 * S)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(unitDef.name, bx + btnW / 2, by + Math.round(11 * S));
          ctx.font = `${Math.round(9 * S)}px monospace`;
          ctx.fillStyle = canProd ? THEME.NEUTRAL_GREY : '#445566';
          ctx.fillText(`⚡${unitDef.cost?.energy||0} ◆${unitDef.cost?.matter||0}`, bx + btnW / 2, by + Math.round(25 * S));
          ctx.textAlign = 'left';
        }
      }

      if (sel.level !== undefined && sel.maxLevel) {
        if (sel.upgrading) {
          const ux = panelX + panelW - Math.round(66 * S);
          const uy = panelY + Math.round(6 * S);
          const uw = Math.round(58 * S);
          const uh = Math.round(22 * S);
          const progress = sel.upgradeDuration > 0 ? 1 - sel.upgradeTimer / sel.upgradeDuration : 0;
          ctx.fillStyle = '#050510';
          ctx.fillRect(ux, uy, uw, uh);
          ctx.fillStyle = THEME.UI_GOLD;
          ctx.globalAlpha = 0.6;
          ctx.fillRect(ux + 1, uy + 1, (uw - 2) * progress, uh - 2);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = THEME.UI_GOLD;
          ctx.lineWidth = 1;
          ctx.strokeRect(ux, uy, uw, uh);
          ctx.fillStyle = THEME.UI_GOLD;
          ctx.font = `${Math.round(8 * S)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`Lv.${sel.level}→${sel.level+1}`, ux + uw / 2, uy + uh / 2);
          ctx.textAlign = 'left';
        } else if (sel.level < sel.maxLevel) {
          const ux = panelX + panelW - Math.round(66 * S);
          const uy = panelY + Math.round(6 * S);
          const uw = Math.round(58 * S);
          const uh = Math.round(22 * S);
          this._buttons.push({ x: ux, y: uy, w: uw, h: uh, action: 'upgrade' });
          ctx.fillStyle = THEME.UI_GOLD + '44';
          ctx.strokeStyle = THEME.UI_GOLD;
          ctx.lineWidth = 1;
          ctx.fillRect(ux, uy, uw, uh);
          ctx.strokeRect(ux, uy, uw, uh);
          ctx.fillStyle = THEME.UI_GOLD;
          ctx.font = `${Math.round(10 * S)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`↑ Lv.${sel.level + 1}`, ux + uw / 2, uy + uh / 2);
          ctx.textAlign = 'left';
        }
      }

      const btnRowY = panelY + panelH - Math.round(24 * S);
      const btnRow2Y = panelY + panelH - Math.round(46 * S);

      if (sel.type === 'nexus' && this.engine && !this.advancingAge) {
        const canAdvance = this.engine.canAdvanceAge();
        const ageIdx = AGE_ORDER.indexOf(this.factionAge);
        const nextAgeDef = ageIdx < AGE_ORDER.length - 1 ? AGES[AGE_ORDER[ageIdx + 1]] : null;
        if (nextAgeDef) {
          const ax = panelX + Math.round(10 * S);
          const ay = btnRow2Y;
          const aw = Math.round(140 * S);
          const ah = Math.round(18 * S);
          this._buttons.push({ x: ax, y: ay, w: aw, h: ah, action: 'advance_age' });
          ctx.fillStyle = canAdvance ? THEME.UI_GOLD + '44' : '#44556644';
          ctx.strokeStyle = canAdvance ? THEME.UI_GOLD : '#556677';
          ctx.lineWidth = 1;
          ctx.fillRect(ax, ay, aw, ah);
          ctx.strokeRect(ax, ay, aw, ah);
          ctx.fillStyle = canAdvance ? THEME.UI_GOLD : '#889999';
          ctx.font = `${Math.round(9 * S)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`↑ ${nextAgeDef.name}  ⚡${nextAgeDef.cost?.energy||0} ◆${nextAgeDef.cost?.matter||0}`, ax + aw / 2, ay + ah / 2);
          ctx.textAlign = 'left';
        }
      }

      if (sel.type === 'research_spire') {
        const rx = panelX + Math.round(10 * S);
        const ry = btnRow2Y;
        const rw = Math.round(120 * S);
        const rh = Math.round(18 * S);
        this._buttons.push({ x: rx, y: ry, w: rw, h: rh, action: 'research' });
        ctx.fillStyle = this._showTechTree ? THEME.ENEMY_RED + '44' : THEME.SPECTER_PURPLE + '44';
        ctx.strokeStyle = this._showTechTree ? THEME.ENEMY_RED : THEME.SPECTER_PURPLE;
        ctx.lineWidth = 1;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.fillStyle = THEME.SPECTER_PURPLE;
        ctx.font = `${Math.round(9 * S)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this._showTechTree ? '✕ Close Tech' : '🔬 Tech Tree', rx + rw / 2, ry + rh / 2);
        ctx.textAlign = 'left';
      }

      if (this.research && this.research.queue.length > 0 && sel.type === 'research_spire') {
        const qx = panelX + Math.round(130 * S);
        const qy = btnRow2Y;
        const qw = Math.round(60 * S);
        const qh = Math.round(18 * S);
        this._buttons.push({ x: qx, y: qy, w: qw, h: qh, action: 'cancel_research' });
        ctx.fillStyle = THEME.ENEMY_RED + '44';
        ctx.strokeStyle = THEME.ENEMY_RED;
        ctx.lineWidth = 1;
        ctx.fillRect(qx, qy, qw, qh);
        ctx.strokeRect(qx, qy, qw, qh);
        ctx.fillStyle = THEME.ENEMY_RED;
        ctx.font = `${Math.round(9 * S)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✕ Cancel', qx + qw / 2, qy + qh / 2);
        ctx.textAlign = 'left';
      }

      if (sel.canScuttle()) {
        const scuttleX = panelX + panelW - 96;
        const scuttleY = btnRowY;
        const scuttleW = 86;
        const scuttleH = 18;
        this._buttons.push({ x: scuttleX, y: scuttleY, w: scuttleW, h: scuttleH, action: 'scuttle' });
        ctx.fillStyle = THEME.ENEMY_RED + '44';
        ctx.strokeStyle = THEME.ENEMY_RED;
        ctx.lineWidth = 1;
        ctx.fillRect(scuttleX, scuttleY, scuttleW, scuttleH);
        ctx.strokeRect(scuttleX, scuttleY, scuttleW, scuttleH);
        ctx.fillStyle = THEME.ENEMY_RED;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✕ Scuttle', scuttleX + scuttleW / 2, scuttleY + scuttleH / 2);
        ctx.textAlign = 'left';
      }
    } else if (sel instanceof Builder) {
      const panelW = 200;
      const panelH = 50;
      let panelX = sp.x + bsr + 10;
      let panelY = sp.y - bsr - panelH + 20;
      if (panelX + panelW > cw - 10) panelX = sp.x - bsr - panelW - 10;
      if (panelY < 36) panelY = sp.y + bsr + 10;
      panelX = Math.max(10, Math.min(cw - panelW - 10, panelX));
      ctx.fillStyle = THEME.PANEL_BG;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(panelX, panelY, panelW, panelH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffcc44';
      ctx.lineWidth = 1;
      ctx.strokeRect(panelX, panelY, panelW, panelH);
      const name = sel.def?.name || sel.type || 'Unknown';
      ctx.fillStyle = '#ffcc44';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(name, panelX + 8, panelY + 6);
      const state = sel.state || 'idle';
      ctx.fillStyle = THEME.NEUTRAL_GREY;
      ctx.font = '11px monospace';
      ctx.fillText(`State: ${state.toUpperCase()}`, panelX + 8, panelY + 26);
      if (sel.hp < sel.maxHp) {
        ctx.fillStyle = '#33111166';
        ctx.fillRect(panelX + 8, panelY + 40, panelW - 16, 3);
        ctx.fillStyle = '#ffcc44';
        ctx.fillRect(panelX + 8, panelY + 40, (panelW - 16) * (sel.hp / sel.maxHp), 3);
      }
    } else if (sel instanceof Worker) {
      const panelW = 220;
      const panelH = 60;

      let panelX = sp.x + bsr + 10;
      let panelY = sp.y - bsr - panelH + 20;

      if (panelX + panelW > cw - 10) panelX = sp.x - bsr - panelW - 10;
      if (panelY < 36) panelY = sp.y + bsr + 10;
      panelX = Math.max(10, Math.min(cw - panelW - 10, panelX));

      ctx.fillStyle = THEME.PANEL_BG;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(panelX, panelY, panelW, panelH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = THEME.GRID;
      ctx.lineWidth = 1;
      ctx.strokeRect(panelX, panelY, panelW, panelH);

      const name = sel.def?.name || sel.type || 'Unknown';
      ctx.fillStyle = THEME.SPECTER_WHITE;
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(name, panelX + 8, panelY + 6);

      const state = sel.state || 'idle';
      ctx.fillStyle = THEME.NEUTRAL_GREY;
      ctx.font = '11px monospace';
      let info = `State: ${state.toUpperCase()}`;
      if (sel.carriedAmount > 0) info += `  ${sel.carriedAmount}/${sel.carryCapacity}`;
      ctx.fillText(info, panelX + 8, panelY + 26);

      if (sel.hp < sel.maxHp) {
        ctx.fillStyle = '#33111166';
        ctx.fillRect(panelX + 8, panelY + 44, panelW - 16, 3);
        ctx.fillStyle = THEME.SPECTER_CYAN;
        ctx.fillRect(panelX + 8, panelY + 44, (panelW - 16) * (sel.hp / sel.maxHp), 3);
      }
    }
  }

  drawResourceBar(ctx) {
    const w = ctx.canvas.width;
    const h = 32;

    ctx.fillStyle = THEME.PANEL_BG;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = THEME.SPECTER_CYAN;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, h); ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = THEME.SPECTER_CYAN;
    ctx.font = '13px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(`⚡ ${Math.floor(this._displayEnergy)}`, 16, h / 2);
    ctx.fillStyle = THEME.SPECTER_PURPLE;
    ctx.fillText(`◆ ${Math.floor(this._displayMatter)}`, 140, h / 2);
    const nearCap = this.population.current >= this.population.cap - 2;
    ctx.fillStyle = nearCap ? THEME.ENEMY_RED : THEME.SPECTER_WHITE;
    ctx.fillText(`◈ ${this.population.current}/${this.population.cap}`, 270, h / 2);

    if (this.engine) {
      const totalSec = Math.floor(this.engine.age);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      const timeStr = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
      const speed = this.engine.gameSpeed || 1;
      ctx.fillStyle = THEME.NEUTRAL_GREY;
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${speed > 1 ? speed + 'x ' : ''}${timeStr}`, 390, h / 2);
    }

    const ageDef = AGES[this.factionAge];
    ctx.fillStyle = THEME.SPECTER_PURPLE;
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    const ageLabel = `[${ageDef?.name || this.factionAge}]`;
    const ageX = ctx.canvas.width - Math.round(120 * 1.5);
    ctx.fillText(ageLabel, ageX, h / 2);

    const gearX = ctx.canvas.width - 28;
    const gearY = 4;
    const gearS = 22;
    const techX = gearX - gearS - 4;
    this._buttons.push({ x: techX, y: gearY, w: gearS, h: gearS, action: 'tech_tree_research', upgradeKey: null });
    ctx.fillStyle = this._showTechTree ? THEME.SPECTER_PURPLE : THEME.NEUTRAL_GREY;
    ctx.globalAlpha = this._showTechTree ? 1 : 0.6;
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔬', techX + gearS / 2, gearY + gearS / 2 + 1);
    ctx.globalAlpha = 1;

    this._buttons.push({ x: gearX, y: gearY, w: gearS, h: gearS, action: 'toggle_settings' });
    ctx.fillStyle = this._showSettings ? THEME.SPECTER_CYAN : THEME.NEUTRAL_GREY;
    ctx.globalAlpha = this._showSettings ? 1 : 0.6;
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚙', gearX + gearS / 2, gearY + gearS / 2 + 1);
    ctx.globalAlpha = 1;

    if (this.advancingAge) {
      const speed = this.engine?.gameSpeed || 1;
      const remaining = Math.max(0, Math.ceil(this.ageAdvanceTimer / speed));
      ctx.fillStyle = THEME.UI_GOLD;
      ctx.textAlign = 'center';
      ctx.fillText(`⏳ Age advancing... ${remaining}s`, ctx.canvas.width / 2, h / 2);
    }

    if (this.construction && this.construction.isPlacing()) {
      const def = this.construction.activeType;
      ctx.fillStyle = THEME.UI_GOLD;
      ctx.textAlign = 'right';
      ctx.fillText(`PLACE: ${def.toUpperCase()}  click to place  ESC cancel`, ctx.canvas.width - 16, h / 2);
    }

    if (this._showSettings) {
      const menuX = ctx.canvas.width - 210;
      const menuY = 36;
      const menuW = 200;
      const items = [
        { label: 'Fog of War', key: 'fogEnabled' },
        { label: 'Glow Effects', key: 'glowEnabled' },
        { label: 'Power Overlay', key: 'powerOverlay' },
        { label: 'Enemy AI', key: 'enemyAI' },
      ];
      let panelH = items.length * 30 + 10;
      if (this.engine) panelH += 60;

      ctx.fillStyle = '#03020aee';
      ctx.fillRect(menuX, menuY, menuW, panelH);
      ctx.strokeStyle = THEME.SPECTER_CYAN;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.strokeRect(menuX, menuY, menuW, panelH);
      ctx.globalAlpha = 1;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const iy = menuY + 5 + i * 30;
        const ix = menuX + 8;
        const iw = menuW - 16;
        const ih = 24;
        const on = this.settings[item.key];

        this._buttons.push({ x: ix, y: iy, w: iw, h: ih, action: 'toggle_setting', setting: item.key });

        ctx.fillStyle = on ? '#0a1a0a' : '#0a0a0a';
        ctx.strokeStyle = on ? THEME.SPECTER_CYAN : THEME.GRID;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1;
        ctx.fillRect(ix, iy, iw, ih);
        ctx.strokeRect(ix, iy, iw, ih);
        ctx.globalAlpha = 1;

        ctx.fillStyle = on ? THEME.SPECTER_CYAN : THEME.NEUTRAL_GREY;
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${on ? '☑' : '☐'} ${item.label}`, ix + 6, iy + ih / 2);
      }

      if (this.engine) {
        let yy = menuY + 5 + items.length * 30 + 4;
        ctx.fillStyle = THEME.NEUTRAL_GREY;
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const vol = this.engine.audio?.volume || 0.3;
        ctx.fillText(`Volume: ${Math.round(vol * 100)}%`, menuX + 8, yy);
        const volX = menuX + 120;
        const volW = menuW - 136;
        const volH = 8;
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(volX, yy - 3, volW, volH);
        ctx.strokeStyle = THEME.GRID;
        ctx.lineWidth = 1;
        ctx.strokeRect(volX, yy - 3, volW, volH);
        ctx.fillStyle = THEME.SPECTER_CYAN;
        ctx.fillRect(volX + 1, yy - 2, (volW - 2) * (vol / 1), volH - 2);
        this._buttons.push({ x: volX, y: yy - 3, w: volW, h: volH, action: 'set_volume' });

        yy += 22;
        const speed = this.engine.gameSpeed || 1;
        ctx.fillStyle = THEME.NEUTRAL_GREY;
        ctx.fillText(`Speed: ${speed}x`, menuX + 8, yy);
        const spdX = menuX + 120;
        const spdW = menuW - 136;
        const spdH = 8;
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(spdX, yy - 3, spdW, spdH);
        ctx.strokeStyle = THEME.GRID;
        ctx.lineWidth = 1;
        ctx.strokeRect(spdX, yy - 3, spdW, spdH);
        ctx.fillStyle = speed >= 2 ? THEME.UI_GOLD : THEME.SPECTER_CYAN;
        ctx.fillRect(spdX + 1, yy - 2, (spdW - 2) * (speed / 2), spdH - 2);
        this._buttons.push({ x: spdX, y: yy - 3, w: spdW, h: spdH, action: 'set_speed' });
      }
    }
  }

  drawTechTree(ctx) {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const pad = 20;
    const panelX = pad;
    const panelY = 40;
    const panelW = cw - pad * 2;
    const panelH = ch - panelY - pad;

    ctx.fillStyle = '#03020aee';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = THEME.SPECTER_PURPLE;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.strokeRect(panelX, panelY, panelW, panelH);
    ctx.globalAlpha = 1;

    ctx.fillStyle = THEME.SPECTER_WHITE;
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('TECH TREE — Research Upgrades', cw / 2, panelY + 10);

    const closeBtn = { x: panelX + panelW - 50, y: panelY + 8, w: 40, h: 20, action: 'close_tech_tree' };
    this._buttons.push(closeBtn);
    ctx.fillStyle = THEME.ENEMY_RED + '66';
    ctx.strokeStyle = THEME.ENEMY_RED;
    ctx.lineWidth = 1;
    ctx.fillRect(closeBtn.x, closeBtn.y, closeBtn.w, closeBtn.h);
    ctx.strokeRect(closeBtn.x, closeBtn.y, closeBtn.w, closeBtn.h);
    ctx.fillStyle = THEME.ENEMY_RED;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', closeBtn.x + closeBtn.w / 2, closeBtn.y + closeBtn.h / 2);

    const categories = ['weapons', 'armor', 'gathering', 'production', 'energy'];
    const catLabels = { weapons: 'Weapons', armor: 'Armor', gathering: 'Gathering', production: 'Production', energy: 'Energy' };
    const upgrades = Object.entries(UPGRADES);
    const cols = 5;
    const colW = (panelW - 40) / cols;
    const startX = panelX + 20;
    const cardY = panelY + 50;
    const cardH = panelH - 80;

    for (let ci = 0; ci < cols; ci++) {
      const cat = categories[ci];
      const catUpgrades = upgrades.filter(([, u]) => u.category === cat).sort((a, b) => a[1].level - b[1].level);
      const cx = startX + ci * colW;
      const cwCol = colW - 8;

      ctx.fillStyle = THEME.SPECTER_WHITE;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(catLabels[cat] || cat, cx + cwCol / 2, cardY - 2);

      let yy = cardY + 22;
      for (const [key, upgrade] of catUpgrades) {
        const currentLevel = this.research ? this.research.upgradeLevels[cat] || 0 : 0;
        const isResearched = upgrade.level <= currentLevel;
        const isNext = upgrade.level === currentLevel + 1;
        const isQueued = this.research && this.research.queue.some(q => q.category === cat && q.level === upgrade.level);
        const canResearch = this.research && this.research.canResearch(upgrade, this.factionAge, this.entities);

        const bh = 54;
        const by = yy;

        if (by + bh > panelY + panelH - 10) break;

        ctx.fillStyle = isResearched ? '#0a1a0a' : (isQueued ? '#1a1a0a' : (canResearch ? '#0a0a1a' : '#0a0a0a'));
        ctx.strokeStyle = isResearched ? THEME.SPECTER_CYAN : (isQueued ? THEME.UI_GOLD : (canResearch ? '#445566' : '#333333'));
        ctx.globalAlpha = isResearched ? 0.6 : (canResearch ? 0.8 : 0.35);
        ctx.lineWidth = 1;
        ctx.fillRect(cx, by, cwCol, bh);
        ctx.strokeRect(cx, by, cwCol, bh);
        ctx.globalAlpha = 1;

        ctx.fillStyle = isResearched ? THEME.SPECTER_CYAN : (canResearch ? THEME.SPECTER_WHITE : '#556677');
        ctx.font = '12px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const lbl = `${isResearched ? '✓ ' : ''}${upgrade.name}`;
        ctx.fillText(lbl, cx + 4, by + 2);

        ctx.fillStyle = THEME.NEUTRAL_GREY;
        ctx.font = '10px monospace';
        ctx.fillText(`⚡${upgrade.cost?.energy||0} ◆${upgrade.cost?.matter||0}`, cx + 4, by + 16);

        if (isResearched) {
          ctx.fillStyle = THEME.SPECTER_CYAN;
          ctx.font = '10px monospace';
          ctx.fillText('COMPLETED', cx + 4, by + 30);
        } else if (isQueued) {
          ctx.fillStyle = THEME.UI_GOLD;
          ctx.font = '10px monospace';
          const timer = this.research.queue[0].timer || 0;
          ctx.fillText(`Researching... ${Math.ceil(timer)}s`, cx + 4, by + 30);
        } else if (isNext && canResearch) {
          this._buttons.push({ x: cx + 4, y: by + 30, w: cwCol - 8, h: 18, action: 'tech_tree_research', upgradeKey: key });
          ctx.fillStyle = THEME.SPECTER_PURPLE + '66';
          ctx.strokeStyle = THEME.SPECTER_PURPLE;
          ctx.lineWidth = 1;
          ctx.fillRect(cx + 4, by + 30, cwCol - 8, 18);
          ctx.strokeRect(cx + 4, by + 30, cwCol - 8, 18);
          ctx.fillStyle = THEME.SPECTER_PURPLE;
          ctx.font = '11px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('Research', cx + cwCol / 2, by + 33);
          ctx.textAlign = 'left';
        } else if (!isNext) {
          ctx.fillStyle = '#555555';
          ctx.font = '10px monospace';
          ctx.fillText(`Requires Lv.${currentLevel + 1} first`, cx + 4, by + 30);
        } else {
          ctx.fillStyle = THEME.ENEMY_RED;
          ctx.font = '10px monospace';
          ctx.fillText('Locked', cx + 4, by + 30);
        }

        yy = by + bh + 6;
      }
    }

    if (this.research && this.research.queue.length > 0) {
      const current = this.research.queue[0];
      const progress = current.researchTime > 0 ? 1 - current.timer / current.researchTime : 0;
      const pbx = panelX + 20;
      const pby = panelY + panelH - 30;
      const pbw = panelW - 40;
      const pbh = 14;
      ctx.fillStyle = '#050510';
      ctx.fillRect(pbx, pby, pbw, pbh);
      ctx.fillStyle = THEME.SPECTER_PURPLE;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(pbx + 1, pby + 1, (pbw - 2) * progress, pbh - 2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = THEME.GRID;
      ctx.lineWidth = 1;
      ctx.strokeRect(pbx, pby, pbw, pbh);
      ctx.fillStyle = THEME.SPECTER_WHITE;
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Researching: ${current.name}  ${Math.floor(progress * 100)}%`, pbx + pbw / 2, pby + pbh / 2);
      ctx.textAlign = 'left';
    }

  }

  drawSelectionBox(ctx) {
    const b = this.selectionBox;
    ctx.strokeStyle = THEME.SPECTER_CYAN;
    ctx.fillStyle = THEME.SPECTER_CYAN;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.1;
    ctx.fillRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
    ctx.globalAlpha = 1;
  }

  drawCrosshair(ctx) {
    const cx = this.mouseX;
    const cy = this.mouseY;
    const r = 10;
    const gap = 4;
    const len = 14;

    ctx.strokeStyle = THEME.SPECTER_CYAN;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(cx, cy - gap); ctx.lineTo(cx, cy - gap - len);
    ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
    ctx.moveTo(cx - gap, cy); ctx.lineTo(cx - gap - len, cy);
    ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
    ctx.stroke();

    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = THEME.SPECTER_CYAN;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawNotification(ctx) {
    const w = ctx.canvas.width;
    const alpha = this._notifTimer > 160 ? (1 - (this._notifTimer - 160) / 20) : 1;
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = THEME.PANEL_BG;
    ctx.fillRect(w / 2 - 200, 60, 400, 28);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = THEME.ENEMY_RED;
    ctx.globalAlpha = alpha * 0.4;
    ctx.lineWidth = 1;
    ctx.strokeRect(w / 2 - 200, 60, 400, 28);
    ctx.globalAlpha = 1;
    ctx.fillStyle = THEME.ENEMY_RED;
    ctx.globalAlpha = alpha;
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.notification, w / 2, 74);
    ctx.globalAlpha = 1;
    this._notifTimer += 1;
    if (this._notifTimer > 180) {
      this.notification = null;
      this._notifTimer = 0;
    }
  }

  drawMinimap(ctx) {
    const { minimapWidth: mw, minimapHeight: mh, minimapMargin: mm } = this;
    const mx = ctx.canvas.width - mw - mm;
    const my = ctx.canvas.height - mh - mm - 32;

    ctx.fillStyle = '#02040a';
    ctx.fillRect(mx, my, mw, mh);

    if (this._attackAlertTimer > 0) {
      const pulse = 0.3 + 0.7 * Math.abs(Math.sin(performance.now() / 150));
      ctx.strokeStyle = THEME.ENEMY_RED;
      ctx.globalAlpha = pulse * 0.7;
      ctx.lineWidth = 2;
      ctx.strokeRect(mx - 1, my - 1, mw + 2, mh + 2);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = THEME.GRID;
    ctx.lineWidth = 1;
    ctx.strokeRect(mx, my, mw, mh);

    const scaleX = mw / MAP_WIDTH;
    const scaleY = mh / MAP_HEIGHT;

    if (this.entities) {
      for (const entity of this.entities.values()) {
        if (!entity.alive) continue;
        const ex = mx + entity.x * scaleX;
        const ey = my + entity.y * scaleY;
        const isBuilding = entity.renderLayer === 'buildings';
        const isPlayer = entity.faction === 'player';
        const isSelected = entity.selected;
        const isResource = !!entity.resourceType;
        if (isResource) {
          ctx.fillStyle = entity.color || THEME.NEUTRAL_GREY;
          ctx.globalAlpha = 0.7;
          ctx.fillRect(ex - 2, ey - 2, 4, 4);
        } else if (isBuilding) {
          ctx.fillStyle = isPlayer ? THEME.SPECTER_CYAN : THEME.ENEMY_RED;
          ctx.globalAlpha = isSelected ? 0.9 : 0.5;
          ctx.fillRect(ex - 2, ey - 2, 4, 4);
        } else {
          ctx.fillStyle = isPlayer ? THEME.SPECTER_CYAN : THEME.ENEMY_RED;
          ctx.globalAlpha = isSelected ? 1 : 0.6;
          ctx.beginPath();
          ctx.arc(ex, ey, isSelected ? 2.5 : 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    if (this.camera) {
      const vx = mx + (this.camera.x - ctx.canvas.width / 2 / this.camera.zoom) * scaleX;
      const vy = my + (this.camera.y - ctx.canvas.height / 2 / this.camera.zoom) * scaleY;
      const vw = (ctx.canvas.width / this.camera.zoom) * scaleX;
      const vh = (ctx.canvas.height / this.camera.zoom) * scaleY;
      ctx.strokeStyle = THEME.SPECTER_WHITE;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(vx, vy, vw, vh);
      ctx.globalAlpha = 1;
    }
  }

  drawEventLog(ctx) {
    if (this._events.length === 0) return;
    const x = 10;
    const y = 42;
    const logH = Math.min(this._events.length, 8) * 16 + 8;
    ctx.fillStyle = THEME.PANEL_BG;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x, y, 260, logH);
    ctx.globalAlpha = 1;
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const now = performance.now();
    let staleCount = 0;
    for (let i = this._events.length - 1; i >= 0; i--) {
      const age = (now - this._events[i].time) / 1000;
      if (age > 15) { staleCount = i + 1; break; }
    }
    if (staleCount > 0) this._events.splice(0, staleCount);
    for (let i = 0; i < this._events.length; i++) {
      const age = (now - this._events[i].time) / 1000;
      const alpha = Math.max(0.3, 1 - age / 12);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = i === this._events.length - 1 ? THEME.SPECTER_CYAN : THEME.NEUTRAL_GREY;
      ctx.fillText(this._events[i].text, x + 6, y + 6 + i * 16);
    }
    ctx.globalAlpha = 1;
  }

  drawTooltip(ctx) {
    const e = this.hoveredEntity;
    let text = e.def?.name || e.type || 'Unknown';
    if (e.state) {
      text += `  [${e.state.toUpperCase()}]`;
    }
    if (e instanceof Worker && e.carriedAmount > 0) {
      text += ` ${e.carriedAmount}/${e.carryCapacity}`;
    }

    const mx = this.mouseX;
    const my = this.mouseY;
    const hx = mx + 16;
    const hy = my + 16;

    ctx.font = '11px monospace';
    const metrics = ctx.measureText(text);
    const pad = 6;
    const bw = metrics.width + pad * 2;
    const bh = 18;

    ctx.fillStyle = '#03020acc';
    ctx.fillRect(hx, hy, bw, bh);
    ctx.strokeStyle = THEME.SPECTER_CYAN;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.strokeRect(hx, hy, bw, bh);
    ctx.globalAlpha = 1;

    ctx.fillStyle = THEME.SPECTER_WHITE;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, hx + pad, hy + bh / 2);
  }

  _findButtonUnderMouse() {
    const mx = this.mouseX;
    const my = this.mouseY;
    for (const btn of this._buttons) {
      if (mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h) {
        return btn;
      }
    }
    return null;
  }

  _getButtonTooltip(btn) {
    if (!btn || !btn.action) return null;
    if (btn.action === 'build') {
      const def = BUILDINGS[btn.buildingType];
      if (!def) return null;
      const lines = [def.name];
      if (!this._isBuildingUnlocked(btn.buildingType)) {
        if (def.requiresAge) {
          const ageDef = AGES[def.requiresAge];
          lines.push(`\u2192 Age: ${ageDef?.name || def.requiresAge}`);
        }
        if (def.requiresBuilding && def.requiresBuilding.length > 0) {
          const names = def.requiresBuilding.map(b => BUILDINGS[b]?.name || b);
          lines.push(`\u2192 Requires: ${names.join(', ')}`);
        }
        return lines.join('\n');
      }
      if (this.engine && !this.engine.resources.canAfford(def.cost)) {
        lines.push('Insufficient resources');
        return lines.join('\n');
      }
      return null;
    }
    if (btn.action === 'produce') {
      const def = UNITS[btn.unitType];
      if (!def || !this.engine) return null;
      const lines = [def.name];
      const canQueue = this.engine.production.canQueue(this._productionTarget, btn.unitType, this.engine.entities);
      if (!canQueue) {
        if (def.requiresAge) {
          const ageDef = AGES[def.requiresAge];
          lines.push(`\u2192 Age: ${ageDef?.name || def.requiresAge}`);
        }
        if (def.requiresBuilding && def.requiresBuilding.length > 0) {
          const names = def.requiresBuilding.map(b => BUILDINGS[b]?.name || b);
          lines.push(`\u2192 Requires: ${names.join(', ')}`);
        }
        return lines.join('\n');
      }
      if (!this.engine.resources.canAfford(def.cost)) {
        lines.push('Insufficient resources');
        return lines.join('\n');
      }
      if (!this.engine.population.canProduce(this.engine.entities, def.supplyCost || 1, btn.unitType)) {
        const count = this.engine.population.getUnitCount(btn.unitType, this.engine.entities);
        const cap = this.engine.population.getUnitCap(btn.unitType);
        lines.push(`Limit: ${count}/${cap === Infinity ? '∞' : cap}`);
        return lines.join('\n');
      }
      return null;
    }
    if (btn.action === 'tech_tree_research') {
      if (!this.research) return null;
      const upgrade = UPGRADES[btn.upgradeKey];
      if (!upgrade) return null;
      const currentLevel = this.research.upgradeLevels[upgrade.category] || 0;
      const lines = [upgrade.name];
      if (upgrade.level > currentLevel + 1) {
        lines.push(`\u2192 Research Lv.${currentLevel + 1} first`);
        return lines.join('\n');
      }
      if (this.research.completed.has(upgrade.name)) {
        lines.push('Already completed');
        return lines.join('\n');
      }
      const canResearch = this.research.canResearch(upgrade, this.factionAge, this.entities);
      if (!canResearch) {
        if (upgrade.requiresAge) {
          const ageDef = AGES[upgrade.requiresAge];
          lines.push(`\u2192 Age: ${ageDef?.name || upgrade.requiresAge}`);
        }
        if (upgrade.requiresBuilding) {
          const name = BUILDINGS[upgrade.requiresBuilding]?.name || upgrade.requiresBuilding;
          lines.push(`\u2192 Requires: ${name}`);
        }
        return lines.join('\n');
      }
      return null;
    }
    if (btn.action === 'upgrade') {
      const sel = this._selectedEntity;
      if (!sel) return null;
      const cost = sel._getUpgradeCost ? sel._getUpgradeCost() : null;
      if (!cost) return null;
      if (sel.level >= sel.maxLevel) return 'Already max level';
      if (sel.upgrading) return 'Upgrade in progress';
      return `Upgrade to Lv.${sel.level + 1}\n\u26A1${cost.energy} \u25C6${cost.matter}`;
    }
    if (btn.action === 'advance_age') {
      if (!this.engine) return null;
      const ageIdx = AGE_ORDER.indexOf(this.factionAge);
      if (ageIdx < 0 || ageIdx >= AGE_ORDER.length - 1) return null;
      const nextAgeDef = AGES[AGE_ORDER[ageIdx + 1]];
      if (!nextAgeDef) return null;
      const canAfford = this.engine.resources.canAfford(nextAgeDef.cost);
      const lines = [nextAgeDef.name];
      if (nextAgeDef.requiredBuildings && nextAgeDef.requiredBuildings.length > 0) {
        const names = nextAgeDef.requiredBuildings.map(b => BUILDINGS[b]?.name || b);
        lines.push(`\u2192 Requires: ${names.join(', ')}`);
      }
      if (!canAfford) {
        lines.push(`\u26A1${nextAgeDef.cost?.energy || 0} \u25C6${nextAgeDef.cost?.matter || 0}`);
      }
      return lines.join('\n');
    }
    if (btn.action === 'scuttle') {
      return 'Destroy building\nRefunds 50% of cost';
    }
    if (btn.action === 'research') {
      return 'Open Tech Tree';
    }
    if (btn.action === 'cancel_research') {
      return 'Cancel current research';
    }
    if (btn.action === 'select_type') {
      const def = UNITS[btn.unitType];
      if (!def) return btn.unitType;
      const lines = [def.name || btn.unitType];
      if (def.description) lines.push(def.description);
      const count = this._getUnitCount(btn.unitType);
      const cap = this.engine?.population?.getUnitCap(btn.unitType);
      lines.push(`Built: ${count}${cap && cap !== Infinity ? `/${cap}` : ''}`);
      return lines.join('\n');
    }
    if (btn.action === 'select_idle_workers') {
      return 'Select idle workers';
    }
    if (btn.action === 'select_idle_builders') {
      return 'Select idle builder';
    }
    return null;
  }

  drawButtonTooltip(ctx, btn) {
    const text = this._getButtonTooltip(btn);
    if (!text) return;
    const lines = text.split('\n');
    const mx = this.mouseX;
    const my = this.mouseY;
    const hx = mx + 12;
    const hy = my + 12;
    const lineH = 16;
    const pad = 6;
    ctx.font = '11px monospace';
    let maxW = 0;
    for (const line of lines) {
      const m = ctx.measureText(line);
      if (m.width > maxW) maxW = m.width;
    }
    const bw = maxW + pad * 2;
    const bh = lines.length * lineH + pad;
    ctx.fillStyle = '#03020acc';
    ctx.fillRect(hx, hy, bw, bh);
    ctx.strokeStyle = THEME.SPECTER_CYAN;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.strokeRect(hx, hy, bw, bh);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? THEME.SPECTER_WHITE : '#aa88ff';
      ctx.fillText(lines[i], hx + pad, hy + pad + i * lineH);
    }
  }

  _getUnitCount(type) {
    if (!this.entities) return 0;
    let count = 0;
    for (const e of this.entities.values()) {
      if (e.alive && e.faction === 'player' && e.type === type) count++;
    }
    return count;
  }

  drawStartMenu(ctx) {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    ctx.fillStyle = '#03020a';
    ctx.fillRect(0, 0, cw, ch);

    ctx.fillStyle = THEME.SPECTER_CYAN;
    ctx.font = 'bold 42px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SPECTRAL RTS', cw / 2, ch / 2 - 80);

    ctx.fillStyle = THEME.NEUTRAL_GREY;
    ctx.font = '14px monospace';
    ctx.fillText('A ghostly real-time strategy game', cw / 2, ch / 2 - 40);

    const bw = 220;
    const bh = 44;
    const bx = cw / 2 - bw / 2;
    const by = ch / 2 + 10;
    this._buttons.push({ x: bx, y: by, w: bw, h: bh, action: 'new_game' });
    ctx.fillStyle = '#0a0a1a';
    ctx.strokeStyle = THEME.SPECTER_CYAN;
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = THEME.SPECTER_CYAN;
    ctx.font = '18px monospace';
    ctx.fillText('NEW GAME', cw / 2, by + bh / 2);

    let sy = by + bh + 14;

    if (this.engine?.save?.hasSave()) {
      this._buttons.push({ x: bx, y: sy, w: bw, h: bh, action: 'restore_game' });
      ctx.fillStyle = '#0a1a0a';
      ctx.strokeStyle = THEME.UI_GOLD;
      ctx.lineWidth = 1.5;
      ctx.fillRect(bx, sy, bw, bh);
      ctx.strokeRect(bx, sy, bw, bh);
      ctx.fillStyle = THEME.UI_GOLD;
      ctx.font = '16px monospace';
      ctx.fillText('RESTORE GAME', cw / 2, sy + bh / 2);
      sy += bh + 14;
    }

    this._buttons.push({ x: bx, y: sy, w: bw, h: bh, action: 'toggle_settings' });
    ctx.fillStyle = '#0a0a1a';
    ctx.strokeStyle = THEME.GRID;
    ctx.lineWidth = 1;
    ctx.fillRect(bx, sy, bw, bh);
    ctx.strokeRect(bx, sy, bw, bh);
    ctx.fillStyle = THEME.NEUTRAL_GREY;
    ctx.font = '16px monospace';
    ctx.fillText('SETTINGS', cw / 2, sy + bh / 2);

    if (this._showSettings) {
      const menuX = cw / 2 - 130;
      const menuY = sy + bh + 10;
      const menuW = 260;
      const items = [
        { label: 'Fog of War', key: 'fogEnabled' },
        { label: 'Glow Effects', key: 'glowEnabled' },
        { label: 'Power Overlay', key: 'powerOverlay' },
        { label: 'Enemy AI', key: 'enemyAI' },
      ];
      let panelH = items.length * 34 + 10;
      if (this.engine) panelH += 60;
      ctx.fillStyle = '#03020aee';
      ctx.fillRect(menuX, menuY, menuW, panelH);
      ctx.strokeStyle = THEME.SPECTER_CYAN;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.strokeRect(menuX, menuY, menuW, panelH);
      ctx.globalAlpha = 1;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const iy = menuY + 5 + i * 34;
        const ix = menuX + 8;
        const iw = menuW - 16;
        const ih = 28;
        const on = this.settings[item.key];
        this._buttons.push({ x: ix, y: iy, w: iw, h: ih, action: 'toggle_setting', setting: item.key });
        ctx.fillStyle = on ? '#0a1a0a' : '#0a0a0a';
        ctx.strokeStyle = on ? THEME.SPECTER_CYAN : THEME.GRID;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1;
        ctx.fillRect(ix, iy, iw, ih);
        ctx.strokeRect(ix, iy, iw, ih);
        ctx.globalAlpha = 1;
        ctx.fillStyle = on ? THEME.SPECTER_CYAN : THEME.NEUTRAL_GREY;
        ctx.font = '13px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${on ? '☑' : '☐'} ${item.label}`, ix + 8, iy + ih / 2);
      }
      if (this.engine) {
        const vol = this.engine.audio?.volume || 0.3;
        const speed = this.engine.gameSpeed || 1;
        let yy = menuY + 5 + items.length * 34 + 4;
        ctx.fillStyle = THEME.NEUTRAL_GREY;
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Volume: ${Math.round(vol * 100)}%`, menuX + 8, yy);
        const volX = menuX + 160;
        const volW = menuW - 176;
        const volH = 10;
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(volX, yy - 4, volW, volH);
        ctx.strokeStyle = THEME.GRID;
        ctx.lineWidth = 1;
        ctx.strokeRect(volX, yy - 4, volW, volH);
        ctx.fillStyle = THEME.SPECTER_CYAN;
        ctx.fillRect(volX + 1, yy - 3, (volW - 2) * vol, volH - 2);
        this._buttons.push({ x: volX, y: yy - 4, w: volW, h: volH, action: 'set_volume' });

        yy += 24;
        ctx.fillStyle = THEME.NEUTRAL_GREY;
        ctx.fillText(`Speed: ${speed}x`, menuX + 8, yy);
        const spdX = menuX + 160;
        const spdW = menuW - 176;
        const spdH = 10;
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(spdX, yy - 4, spdW, spdH);
        ctx.strokeStyle = THEME.GRID;
        ctx.lineWidth = 1;
        ctx.strokeRect(spdX, yy - 4, spdW, spdH);
        ctx.fillStyle = speed >= 2 ? THEME.UI_GOLD : THEME.SPECTER_CYAN;
        ctx.fillRect(spdX + 1, yy - 3, (spdW - 2) * (speed / 2), spdH - 2);
        this._buttons.push({ x: spdX, y: yy - 4, w: spdW, h: spdH, action: 'set_speed' });
      }
    }
  }

  drawPauseMenu(ctx) {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    ctx.fillStyle = '#000000cc';
    ctx.fillRect(0, 0, cw, ch);

    ctx.fillStyle = THEME.SPECTER_WHITE;
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PAUSED', cw / 2, ch / 2 - 80);

    const bw = 220;
    const bh = 44;
    const bx = cw / 2 - bw / 2;
    let by = ch / 2 - 10;

    this._buttons.push({ x: bx, y: by, w: bw, h: bh, action: 'resume' });
    ctx.fillStyle = '#0a0a1a';
    ctx.strokeStyle = THEME.SPECTER_CYAN;
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = THEME.SPECTER_CYAN;
    ctx.font = '18px monospace';
    ctx.fillText('RESUME', cw / 2, by + bh / 2);

    by += bh + 12;
    this._buttons.push({ x: bx, y: by, w: bw, h: bh, action: 'toggle_settings' });
    ctx.fillStyle = '#0a0a1a';
    ctx.strokeStyle = THEME.GRID;
    ctx.lineWidth = 1;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = THEME.NEUTRAL_GREY;
    ctx.font = '16px monospace';
    ctx.fillText('SETTINGS', cw / 2, by + bh / 2);

    by += bh + 12;
    this._buttons.push({ x: bx, y: by, w: bw, h: bh, action: 'quit_to_menu' });
    ctx.fillStyle = '#0a0a0a';
    ctx.strokeStyle = THEME.ENEMY_RED;
    ctx.lineWidth = 1;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = THEME.ENEMY_RED;
    ctx.font = '16px monospace';
    ctx.fillText('QUIT TO MENU', cw / 2, by + bh / 2);

    if (this._showSettings) {
      this._drawSettingsPanel(ctx, cw, ch);
    }
  }

  _drawSettingsPanel(ctx, cw, ch) {
    const menuX = cw / 2 - 150;
    const menuY = ch / 2 + 60;
    const menuW = 300;
    const items = [
      { label: 'Fog of War', key: 'fogEnabled' },
      { label: 'Glow Effects', key: 'glowEnabled' },
      { label: 'Power Overlay', key: 'powerOverlay' },
      { label: 'Enemy AI', key: 'enemyAI' },
    ];
    let panelH = items.length * 32 + 10;
    if (this.engine) {
      panelH += 80;
    }

    ctx.fillStyle = '#03020aee';
    ctx.fillRect(menuX, menuY, menuW, panelH);
    ctx.strokeStyle = THEME.SPECTER_CYAN;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.strokeRect(menuX, menuY, menuW, panelH);
    ctx.globalAlpha = 1;

    ctx.fillStyle = THEME.SPECTER_WHITE;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('SETTINGS', cw / 2, menuY + 4);

    let yy = menuY + 24;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const ix = menuX + 10;
      const iw = menuW - 20;
      const ih = 24;
      const on = this.settings[item.key];
      this._buttons.push({ x: ix, y: yy, w: iw, h: ih, action: 'toggle_setting', setting: item.key });
      ctx.fillStyle = on ? '#0a1a0a' : '#0a0a0a';
      ctx.strokeStyle = on ? THEME.SPECTER_CYAN : THEME.GRID;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.fillRect(ix, yy, iw, ih);
      ctx.strokeRect(ix, yy, iw, ih);
      ctx.globalAlpha = 1;
      ctx.fillStyle = on ? THEME.SPECTER_CYAN : THEME.NEUTRAL_GREY;
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${on ? '☑' : '☐'} ${item.label}`, ix + 6, yy + ih / 2);
      yy += 30;
    }

    if (this.engine) {
      yy += 4;
      ctx.fillStyle = THEME.NEUTRAL_GREY;
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Volume: ${Math.round(this.engine.audio?.volume * 100 || 0)}%`, menuX + 10, yy);
      const volX = menuX + 180;
      const volW = 100;
      const volH = 10;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(volX, yy - 4, volW, volH);
      ctx.strokeStyle = THEME.GRID;
      ctx.lineWidth = 1;
      ctx.strokeRect(volX, yy - 4, volW, volH);
      ctx.fillStyle = THEME.SPECTER_CYAN;
      const volPct = (this.engine.audio?.volume || 0.3) / 1;
      ctx.fillRect(volX + 1, yy - 3, (volW - 2) * volPct, volH - 2);
      this._buttons.push({ x: volX, y: yy - 4, w: volW, h: volH, action: 'set_volume' });

      yy += 22;
      const speed = this.engine.gameSpeed || 1;
      ctx.fillStyle = THEME.NEUTRAL_GREY;
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Game Speed: ${speed}x`, menuX + 10, yy);
      const spdX = menuX + 180;
      const spdW = 100;
      const spdH = 10;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(spdX, yy - 4, spdW, spdH);
      ctx.strokeStyle = THEME.GRID;
      ctx.lineWidth = 1;
      ctx.strokeRect(spdX, yy - 4, spdW, spdH);
      ctx.fillStyle = speed >= 2 ? THEME.UI_GOLD : THEME.SPECTER_CYAN;
      ctx.fillRect(spdX + 1, yy - 3, (spdW - 2) * (speed / 2), spdH - 2);
      this._buttons.push({ x: spdX, y: yy - 4, w: spdW, h: spdH, action: 'set_speed' });
    }
  }

  drawGameOver(ctx) {
    const go = this.engine?._gameOverState;
    if (!go) return;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    ctx.fillStyle = '#000000cc';
    ctx.fillRect(0, 0, cw, ch);
    const won = go.won;
    ctx.fillStyle = won ? THEME.SPECTER_CYAN : THEME.ENEMY_RED;
    ctx.font = 'bold 48px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(won ? 'VICTORY' : 'DEFEAT', cw / 2, ch / 2 - 60);
    ctx.fillStyle = THEME.SPECTER_WHITE;
    ctx.font = '18px monospace';
    ctx.fillText(go.reason || '', cw / 2, ch / 2 - 15);

    const bw = 200;
    const bh = 38;
    const bx = cw / 2 - bw / 2;
    const by = ch / 2 + 35;
    this._buttons.push({ x: bx, y: by, w: bw, h: bh, action: 'back_to_menu' });
    ctx.fillStyle = '#0a0a1a';
    ctx.strokeStyle = THEME.SPECTER_CYAN;
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = THEME.SPECTER_CYAN;
    ctx.font = '16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BACK TO MENU', cw / 2, by + bh / 2);
  }
}
