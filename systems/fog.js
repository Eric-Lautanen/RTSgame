export class FogSystem {
  constructor(mapWidth, mapHeight, tileSize = 64) {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.tileSize = tileSize;
    this.cols = Math.ceil(mapWidth / tileSize);
    this.rows = Math.ceil(mapHeight / tileSize);
    this.explored = new Uint8Array(this.cols * this.rows);
    this.visible = new Uint8Array(this.cols * this.rows);
    this._tileCache = new Map();
    this.enabled = false;
  }

  update(entities) {
    if (!this.enabled) return;
    this.visible.fill(0);
    const changed = new Map();

    for (const entity of entities.values()) {
      if (!entity.alive) continue;
      const cx = Math.floor(entity.x / this.tileSize);
      const cy = Math.floor(entity.y / this.tileSize);
      const key = entity.id;
      const prev = this._tileCache.get(key);
      if (prev && prev[0] === cx && prev[1] === cy) continue;
      this._tileCache.set(key, [cx, cy]);
      changed.set(key, entity);
    }

    for (const key of this._tileCache.keys()) {
      const e = entities.get(key);
      if (!e || !e.alive) this._tileCache.delete(key);
    }

    // Only process entities that moved since last frame
    for (const entity of changed.values()) {
      const visionRange = entity.def?.visionRange || 300;
      const visionTiles = Math.ceil(visionRange / this.tileSize);
      const cx = Math.floor(entity.x / this.tileSize);
      const cy = Math.floor(entity.y / this.tileSize);

      const startCol = Math.max(0, cx - visionTiles);
      const endCol = Math.min(this.cols - 1, cx + visionTiles);
      const startRow = Math.max(0, cy - visionTiles);
      const endRow = Math.min(this.rows - 1, cy + visionTiles);

      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          const dx = (c - cx) * this.tileSize;
          const dy = (r - cy) * this.tileSize;
          if (dx * dx + dy * dy <= visionRange * visionRange) {
            const idx = r * this.cols + c;
            this.visible[idx] = 1;
            this.explored[idx] = 1;
          }
        }
      }
    }
  }

  isVisible(x, y) {
    const c = Math.floor(x / this.tileSize);
    const r = Math.floor(y / this.tileSize);
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return false;
    return this.visible[r * this.cols + c] === 1;
  }

  isExplored(x, y) {
    const c = Math.floor(x / this.tileSize);
    const r = Math.floor(y / this.tileSize);
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return false;
    return this.explored[r * this.cols + c] === 1;
  }

  render(ctx, camera) {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;

    const startCol = Math.max(0, Math.floor((camera.x - cw / 2 / camera.zoom) / this.tileSize) - 1);
    const endCol = Math.min(this.cols, Math.ceil((camera.x + cw / 2 / camera.zoom) / this.tileSize) + 1);
    const startRow = Math.max(0, Math.floor((camera.y - ch / 2 / camera.zoom) / this.tileSize) - 1);
    const endRow = Math.min(this.rows, Math.ceil((camera.y + ch / 2 / camera.zoom) / this.tileSize) + 1);

    ctx.fillStyle = '#07041a';
    for (let r = startRow; r < endRow; r++) {
      for (let c = startCol; c < endCol; c++) {
        const idx = r * this.cols + c;
        if (this.explored[idx]) {
          if (!this.visible[idx]) {
            ctx.globalAlpha = 0.6;
            ctx.fillRect(c * this.tileSize, r * this.tileSize, this.tileSize, this.tileSize);
          }
        } else {
          ctx.globalAlpha = 1;
          ctx.fillRect(c * this.tileSize, r * this.tileSize, this.tileSize, this.tileSize);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
