# Spectral RTS

[![Play Demo](https://img.shields.io/badge/Play-Demo-8A2BE2)](https://eric-lautanen.github.io/RTSgame/)

A browser-based real-time strategy game built with vanilla JavaScript and Canvas 2D. Set in a void-themed spectral universe with particle effects, fog of war, tech trees, and AI opponents.

## Features

- **4 Ages** — Advance through Spectral Dawn, Void Awakening, Quantum Reach, and Eternity Singularity
- **5 Unit Types** — Shade (worker), Wraith (scout), Specter (warrior), Phantom (ranged), Void Titan (heavy)
- **8 Buildings** — Nexus, Barracks, Pylon, Supply Depot, Turret, Research Spire, Refinery, Energy Condenser
- **Research System** — Weapons, armor, gathering, production, and energy upgrades (3 levels each)
- **Fog of War** — Grid-based visibility system
- **AI Opponent** — Configurable difficulty (passive/normal/aggressive) with periodic attack waves
- **Particle Effects** — Object-pooled particle system with death bursts, spawn shimmers, hit flashes, explosions
- **Audio** — Web Audio API synthesized sounds (no asset files needed)
- **Save/Load** — localStorage-based persistence with auto-save

## How to Play

1. Serve the directory with any HTTP server:
   ```
   python -m http.server 8080
   ```
2. Open `http://localhost:8080` in a browser.
3. Click the canvas to lock the pointer.
4. Select units with left-click (Shift to add, drag for box-select, double-click for all of type).
5. Right-click to move/attack.
6. Use the HUD at the bottom to build structures and produce units.

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrow keys | Pan camera |
| Scroll wheel | Zoom (toward cursor) |
| Middle mouse drag | Pan camera |
| Escape | Deselect / cancel placement |
| Delete | Scuttle selected building |
| Space | Recenter on selection |
| H | Recenter on nexus |

## Tech Stack

- Pure JavaScript (ES Modules, no frameworks)
- Canvas 2D rendering
- Web Audio API
- localStorage for persistence
- VBScript helper for Windows dev server
