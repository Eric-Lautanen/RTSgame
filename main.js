import { Engine } from './core/engine.js';
import { Renderer } from './core/renderer.js';
import { Camera } from './core/camera.js';
import { Input } from './core/input.js';
import { HUD } from './ui/hud.js';
import { Audio } from './audio/audio.js';
import { Unit } from './entities/unit.js';
import { Worker } from './entities/worker.js';
import { Builder } from './entities/builder.js';
import { Building } from './entities/building.js';
import { ResourceNode } from './entities/resource.js';
import { RESOURCE_NODES } from './data/resources.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const camera   = new Camera(canvas);
const input    = new Input(canvas);
const renderer = new Renderer(ctx, camera);
const hud      = new HUD(ctx, canvas);
const audio    = new Audio();

const engine   = new Engine({ canvas, ctx, camera, input, renderer, hud, audio });

import { MAP_WIDTH, MAP_HEIGHT } from './data/world.js';

camera.targetZoom = 1.2;

function rand(min, max) { return min + Math.random() * (max - min); }

function pickSpawnPosition() {
  const side = Math.floor(Math.random() * 4);
  const margin = 800;
  const rangeMin = MAP_WIDTH * 0.38;
  const rangeMax = MAP_WIDTH * 0.47;
  const dist = rand(rangeMin, rangeMax);
  const cx = MAP_WIDTH / 2;
  const cy = MAP_HEIGHT / 2;
  switch (side) {
    case 0: return { x: cx + dist, y: cy + rand(-dist * 0.35, dist * 0.35) };
    case 1: return { x: cx - dist, y: cy + rand(-dist * 0.35, dist * 0.35) };
    case 2: return { x: cx + rand(-dist * 0.35, dist * 0.35), y: cy + dist };
    default: return { x: cx + rand(-dist * 0.35, dist * 0.35), y: cy - dist };
  }
}

const playerSpawn = pickSpawnPosition();
let enemySpawn;
let attempts = 0;
do {
  enemySpawn = pickSpawnPosition();
  attempts++;
} while (
  Math.hypot(enemySpawn.x - playerSpawn.x, enemySpawn.y - playerSpawn.y) < MAP_WIDTH * 0.72 &&
  attempts < 40
);

function spawnNode(type, cx, cy, spread, excludeCenter, excludeRadius) {
  const def = RESOURCE_NODES[type];
  let x, y, nxAttempts = 0;
  do {
    x = cx + (Math.random() - 0.5) * spread;
    y = cy + (Math.random() - 0.5) * spread;
    x = Math.max(60, Math.min(MAP_WIDTH - 60, x));
    y = Math.max(60, Math.min(MAP_HEIGHT - 60, y));
    nxAttempts++;
    let blocked = false;
    if (excludeCenter && excludeRadius) {
      const dx = x - excludeCenter.x;
      const dy = y - excludeCenter.y;
      if (dx * dx + dy * dy < excludeRadius * excludeRadius) blocked = true;
    }
    if (!blocked) {
      const allEntities = [...engine.entities.values(), ...engine.pendingAdd];
      for (const e of allEntities) {
        if (!e.alive || e.passable) continue;
        const dx = e.x - x;
        const dy = e.y - y;
        if (e instanceof ResourceNode) {
          if (dx * dx + dy * dy < 192 * 192) { blocked = true; break; }
        } else {
          const minDist = (e.collisionRadius || 20) + 20;
          if (dx * dx + dy * dy < minDist * minDist) { blocked = true; break; }
        }
      }
    }
    if (!blocked) break;
  } while (nxAttempts < 20);
  const node = new ResourceNode({
    type, x, y,
    amount: def.maxAmount,
    resourceType: def.resourceType,
    color: def.color,
    glowColor: def.glowColor,
  });
  node.scale = def.scale;
  node._entities = engine.entities;
  engine.spawnEntity(node);
}

function spawnResourceClusters(cx, cy) {
  const excludeCenter = { x: cx, y: cy };
  const excludeRadius = 200;
  for (const type of ['energy_crystal', 'energy_crystal', 'matter_deposit']) {
    spawnNode(type, cx + (Math.random() - 0.5) * 600, cy + (Math.random() - 0.5) * 600, 120, excludeCenter, excludeRadius);
  }
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI * 2 / 4) * i + Math.random() * 0.5;
    const dist = 500 + Math.random() * 350;
    const type = i < 2 ? 'energy_crystal' : 'matter_deposit';
    spawnNode(type, cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, 200, excludeCenter, 0);
  }
}

const nexus = new Building({ type: 'nexus', x: playerSpawn.x, y: playerSpawn.y, faction: 'player' });
nexus.setResourceSystem(engine.resources);
engine.spawnEntity(nexus);
camera.x = playerSpawn.x; camera.targetX = playerSpawn.x;
camera.y = playerSpawn.y; camera.targetY = playerSpawn.y;

const builder = new Builder({ type: 'builder', x: playerSpawn.x - 120, y: playerSpawn.y + 80, faction: 'player' });
builder._entities = engine.entities;
builder._resourceSystem = engine.resources;
const worker = new Worker({ type: 'shade', x: playerSpawn.x - 80, y: playerSpawn.y + 60, faction: 'player' });
const wraith = new Unit({ type: 'wraith', x: playerSpawn.x + 80, y: playerSpawn.y - 60, faction: 'player' });
engine.spawnEntity(builder);
engine.spawnEntity(worker);
engine.spawnEntity(wraith);

engine.ai.enemySpawnPositions = [enemySpawn];
engine.ai.baseCenter = enemySpawn;

engine.flushSpawns();
engine.flushEntities();

spawnResourceClusters(playerSpawn.x, playerSpawn.y);
spawnResourceClusters(enemySpawn.x, enemySpawn.y);

engine.start();
engine.pause();
