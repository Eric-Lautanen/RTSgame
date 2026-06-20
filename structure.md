# Spectral RTS — Project Structure

## Root Files

- **index.html** — Entry HTML. Full-viewport canvas, debug overlay div, loads `main.js` as ES module.
- **main.js** — Entry point. Creates Engine, Camera, Renderer, Input, HUD, Audio. Spawns initial resource clusters, player nexus, worker, wraith, and specter. Starts the game loop.
- **server.vbs** — VBScript helper. Launches `python -m http.server 8080` in the project directory (Windows).
- **validate.mjs** — Standalone validation tool. Parses every `.js`/`.mjs` file for syntax errors, verifies imports resolve to existing files, checks named exports match, detects circular dependencies, and reports orphan files in `core/` and `ui/`.
- **ROADMAP.md** — Development roadmap & philosophy doc. Tracks feature completion across 15 phases (foundation, camera, input, entities, data, systems, economy, construction, tech tree, UI, AI, game modes, polish, content, distribution).

## `audio/`

- **audio.js** — Audio class using Web Audio API oscillators (no audio files). Provides `select()`, `selectMultiple()`, `selectUnit(def)`, `move()`, `attack()`, `death()`, `victory()` sounds. Reads `selectSound` from entity data definitions for unique per-unit tones.

## `core/`

- **camera.js** — Camera class. World-to-screen / screen-to-world transforms. WASD/arrow panning, edge-scroll, middle-mouse-drag, touch drag, scroll-wheel zoom (zooms toward cursor), pinch-to-zoom. Smooth lerp easing on position and zoom. Clamped to map bounds.
- **engine.js** — Engine class. Fixed-timestep game loop (60fps target, max delta clamped). Owns all systems (Selection, Movement, Combat, Production, Resources, Economy, Population, Construction, Save). Entity registry (`Map<id, Entity>`), deferred spawn/removal. Processes input events (select, box-select). Handles keyboard shortcuts (Escape, Delete, Space, H). Ties HUD sync, debug overlay, and production spawn flushing.
- **input.js** — Input class. Pointer-lock-based mouse capture (click canvas to lock). Tracks mouse position, button states, scroll delta, middle-mouse drag, pinch zoom. Generates `select` and `boxselect` events with click-vs-drag detection (~5px threshold). Touch support: single-touch drag pans, long-press+ drag for box-select, two-finger pinch zoom. Keyboard key tracking via `Set`. All event listeners can be detached cleanly.
- **renderer.js** — Renderer class. Canvas 2D drawing layer. Clears to void black. Applies camera transform. Draws background (stars, nebula, grid, map border). Collects entities by render layer (`background`, `buildings`, `units`, `projectiles`, `effects`) and renders in order. Draws energy trails, move markers, projectiles, construction ghost. Provides shared helpers: `setGlow/clearGlow`, `drawLine`, `drawPolygon`, `drawCircle`, `drawSpectralOrb` (spoke-based spectral orb with orbiting satellites, selection ring, essence glow), `drawGhostDrift` (sine-wave float), `flickerAlpha`.

## `data/`

- **ages.js** — Age definitions. 4 ages: Spectral Dawn (starting), Void Awakening (age 2), Quantum Reach (age 3), Eternity Singularity (age 4). Each has cost, buildTime, requiredBuildings, bonuses (hp/damage multipliers).
- **buildings.js** — Building definitions. 8 buildings: nexus, barracks, pylon, supply_depot, turret, research_spire, refinery, energy_condenser. Each has hp, footprint, cost, energyCost, supplyProvided, requiresAge, requiresBuilding, produces[], shape, colors, scale, buildTime.
- **effects.js** — Particle effect definitions. 4 effects: death_burst, spawn_shimmer, hit_flash, explosion. Each specifies particleCount, speed, lifetime, color, glowColor, size, shape.
- **projectiles.js** — Projectile definitions. 3 types: bolt (fast line), orb (slow homing circle), beam (instant). Each has speed, damage, color, glowColor, shape, lifetime.
- **resources.js** — Resource node definitions. 2 types: energy_crystal (cyan, max 500), matter_deposit (purple, max 400). Each has resourceType, maxAmount, gatherRate, color, glowColor, shape, scale.
- **theme.js** — Color palette constants. VOID (#03020a), SPECTER_CYAN, SPECTER_PURPLE, SPECTER_WHITE, ENEMY_RED, NEUTRAL_GREY, UI_GOLD, GRID (very faint cyan), BORDER, PANEL_BG.
- **units.js** — Unit definitions. 5 units: shade (worker, no damage), wraith (fast scout), specter (standard warrior), phantom (ranged), void_titan (heavy). Each has hp, speed, damage, range, attackSpeed, cost, supplyCost, requiresAge, requiresBuilding[], shape, colors, scale, buildTime, projectile type, selectSound sequence.
- **upgrades.js** — Upgrade/research definitions. 5 categories with multiple levels: weapons (3 levels, +15%/+30%/+45% damage), armor (3 levels, +10%/+20%/+30% HP), gathering (2 levels, +15%/+30% rate), production (2 levels, -10%/-20% build time), energy (3 levels, +20%/+40%/+60% income). Each has cost, researchTime, requiresAge, requiresBuilding.
- **world.js** — World constants. MAP_WIDTH=4000, MAP_HEIGHT=4000, TILE_SIZE=64, MAP_MARGIN=500.

## `entities/`

- **entity.js** — Base Entity class. Properties: id (auto-increment), type, x/y, faction, hp/maxHp, alive, renderLayer, age, speed, destination. Methods: `moveTo()`, `distanceTo()`, `die()`, `takeDamage()`, `update(dt)`, `render()`.
- **unit.js** — Unit class extends Entity. Added properties: def, damage, range, attackCooldown, attackSpeed, target, killCount, essenceGlow, holdPosition, attackMove, path, steering physics (vx/vy, maxSpeed, steerStrength, separationStrength, arrivalRadius, radius). `attack(target)`. Render: spectral orb via `drawSpectralOrb`, essence glow (brighter/larger per kill), health bar.
- **worker.js** — Worker class extends Entity. State machine: idle → moving (to node) → gathering (fill carry) → returning (to drop-off) → idle. Properties: carryCapacity (10), carriedAmount, carriedType, targetNode, dropOff, buildTarget, gatherTimer, assignedResourceType. Methods: `assignTo(node)`, `assignToBuild(foundation)`, `findDropOff(entities)`, auto-repeat gathering of same resource type. Render: dimmer spectral orb, resource carry orb (cyan/purple), health bar.
- **building.js** — Building class extends Entity. Properties: def, footprint, buildProgress (starts at 1 for completed), productionQueue, productionTimer, rallyPoint, level (1-3, upgradeable), maxLevel. Methods: `produce(unitType)`, `upgrade()` (costs scale per level, +20% HP), `scuttle()` (destroys + 50% cost refund). Render: multi-layered polygon (outer glow, inner body, rotating core), 3 orbiting satellites, gold level rings, selection highlight, build progress bar, health bar, production queue dots.
- **foundation.js** — Foundation class (under-construction building) extends Entity. Properties: buildingType, def, buildProgress (0→1), totalBuildTime, workersAssigned[] (up to 3, diminishing returns: speed = 1 + 0.3 * count). Render: wireframe polygon that fills in progressively, progress bar. On completion, triggers `ConstructionSystem.onFoundationComplete()` to spawn real Building.
- **resource.js** — ResourceNode class extends Entity. Properties: amount/maxAmount, resourceType, gatherRate, color/glowColor, gatherers[] (capped at 3). Methods: `canGather()`, `addGatherer()` (cap check), `removeGatherer()`. Dies when depleted. Render: 5 orbiting crystal cluster, shrinks with depletion, pulsing glow.

## `systems/`

- **ai.js** — AISystem class. Basic enemy AI. Ticks every 10 frames. States: idle → aggro (attack nearest enemy in range). Periodic attack waves every 60s (sends up to 5 attackers toward a target). Configurable difficulty (passive/normal/aggressive).
- **combat.js** — CombatSystem class. Manages unit targeting, auto-attack (nearest enemy when idle), attack cooldowns, projectile spawning from data definitions. Supports hold position and attack-move modes. Updates projectile positions (homing toward target), collision detection (damage at <8px), and removal. Renders projectiles as glowing lines toward target.
- **construction.js** — ConstructionSystem class. Building placement workflow: startPlacement → updateGhost (validates position) → confirmPlacement (spend resources, spawn Foundation, assign nearest idle worker). Validation checks: map bounds, building overlap, resource affordability. Ghost rendering (semi-transparent valid=cyan/invalid=red, dashed stroke). Handles foundation completion → spawns real Building.
- **economy.js** — EconomySystem class. Utility: `findNearestNode(x, y, type)` for resource nodes, `findNearestDropOff(x, y, faction)` for drop-off buildings (nexus, refinery, condenser).
- **fog.js** — FogSystem class. Grid-based fog of war. `Uint8Array` for explored and visible arrays. Updates visibility from entity visionRange. Methods: `isVisible(x,y)`, `isExplored(x,y)`.
- **movement.js** — MovementSystem class. Steering-based movement: seek force toward destination (with slowing radius), separation force between nearby units (avoid overlap, 2.5× radius). Hard collision resolution: pushes units out of buildings and resource nodes (using visual radius). Speed clamping, arrival stopping.
- **particles.js** — ParticleSystem class. Pre-allocated pool (max 500 particles). Object-pooled acquire/release. `emit(x, y, config)` reads from effect definitions. Each particle has position, velocity, lifetime, color, glow, size, alpha. Update advances and fades (linear alpha). Render as glowing circles.
- **population.js** — PopulationSystem class. Computes current population (sum of alive player units' supplyCost) and population cap (10 base + sum of player buildings' supplyProvided). `canProduce()` checks against cap.
- **production.js** — ProductionSystem class. Manages unit production queues. `queueUnit(entity, unitType)` spends resources and adds to queue. `cancelQueue()` refunds 50% cost. Update counts down productionTimer, spawns units via pendingSpawns[] (spawned adjacent to building). `flushSpawns()` consumed by Engine.
- **research.js** — ResearchSystem class. Upgrade research queue. `canResearch()` checks prerequisites (age, buildings). `queueResearch()` adds to queue with timer. Update counts down, applies upgrade when complete. `getStatMultiplier(category)` returns computed multiplier based on current upgrade level.
- **resources.js** — ResourceSystem class. Tracks energy/matter amounts. Methods: `canAfford(cost)`, `spend(cost)`, `refund(cost)` (50% back), `addResource()`, `addPassiveIncome()`. Update applies passive income per second.
- **save.js** — SaveSystem class. `localStorage`-based save/load. Serializes: entities (position, type, faction, hp, production queue, build progress, rally, killCount, state, carry), camera, resources, elapsed time. Auto-saves every 30s (only when unpaused). Handles QuotaExceededError. Namespace: `spectral_rts_save_0`.
- **selection.js** — SelectionSystem class. Manages selected entity set. Methods: `clearSelection()`, `selectEntity(entity, addToSelection)` (Shift-add), `selectInBox(box)` for drag-select, `selectAllOfType(type)` for double-click, `handleClick()` detects double-click (<300ms), `getSelected()`, `count()`.

## `ui/`

- **hud.js** — HUD class. Bottom resource bar (energy, matter, population). Command card with building buttons (pylon, supply_depot, barracks, turret, spire, refinery, condenser) — each checks affordability and prerequisites (locked dimmed with 🔒 and requirement label). Production panel on selected building (unit buttons with cost). Upgrade and Scuttle buttons on selected building. Cancellation ✕ button during placement. Crosshair cursor. Notification banner. Minimap (entities as dots/squares, camera viewport rect). Selection box overlay. Tooltip on hover. Selected info panel (unit name, state, HP, queue).
