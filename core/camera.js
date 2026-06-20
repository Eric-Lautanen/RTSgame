import { MAP_WIDTH, MAP_HEIGHT } from '../data/world.js';

export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = MAP_WIDTH / 2;
    this.y = MAP_HEIGHT / 2;
    this.zoom = 1;
    this.targetX = this.x;
    this.targetY = this.y;
    this.targetZoom = this.zoom;
    this.minZoom = 0.3;
    this.maxZoom = 3;
    this.panSpeed = 600;
    this.edgeScrollMargin = 40;
    this.zoomSmooth = 0.1;
    this.panSmooth = 0.08;
  }

  worldToScreen(wx, wy) {
    const c = this.canvas;
    return {
      x: (wx - this.x) * this.zoom + c.width / 2,
      y: (wy - this.y) * this.zoom + c.height / 2,
    };
  }

  screenToWorld(sx, sy) {
    const c = this.canvas;
    return {
      x: (sx - c.width / 2) / this.zoom + this.x,
      y: (sy - c.height / 2) / this.zoom + this.y,
    };
  }

  update(dt, input, hud) {
    if (!input) return;

    const keys = input.keys;
    let dx = 0, dy = 0;

    if (keys.has('arrowup')) dy = -1;
    if (keys.has('arrowdown')) dy = 1;
    if (keys.has('arrowleft')) dx = -1;
    if (keys.has('arrowright')) dx = 1;

    if (input.isPointerLocked) {
      const mx = input.mouseScreenX;
      const my = input.mouseScreenY;
      const margin = this.edgeScrollMargin;
      const cw = this.canvas.width;
      const ch = this.canvas.height;
      const overUI = hud && hud.isOverUI(mx, my);
      if (!overUI) {
        if (mx < margin) dx = -1;
        if (mx > cw - margin) dx = 1;
        if (my < margin) dy = -1;
        if (my > ch - margin) dy = 1;
      }
    }

    if (dx !== 0 || dy !== 0) {
      const len = Math.sqrt(dx * dx + dy * dy);
      this.targetX += (dx / len) * this.panSpeed * dt / this.zoom;
      this.targetY += (dy / len) * this.panSpeed * dt / this.zoom;
    }

    if (input.middleDragDelta && (input.middleDragDelta.x !== 0 || input.middleDragDelta.y !== 0)) {
      this.targetX -= input.middleDragDelta.x / this.zoom;
      this.targetY -= input.middleDragDelta.y / this.zoom;
      input.middleDragDelta.x = 0;
      input.middleDragDelta.y = 0;
    }

    if (input.touchDelta) {
      this.targetX -= input.touchDelta.x / this.zoom;
      this.targetY -= input.touchDelta.y / this.zoom;
      input.touchDelta.x = 0;
      input.touchDelta.y = 0;
    }

    if (input.scrollDelta !== 0) {
      const zoomFactor = 1 - input.scrollDelta * 0.05;
      const before = this.screenToWorld(input.mouseScreenX, input.mouseScreenY);
      this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom * zoomFactor));
      const after = this.screenToWorld(input.mouseScreenX, input.mouseScreenY);
      this.targetX += before.x - after.x;
      this.targetY += before.y - after.y;
      input.scrollDelta = 0;
    }

    if (input.pinchDelta !== 0) {
      const factor = 1 + input.pinchDelta * 0.008;
      const before = this.screenToWorld(input.mouseScreenX, input.mouseScreenY);
      this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom * factor));
      const after = this.screenToWorld(input.mouseScreenX, input.mouseScreenY);
      this.targetX += before.x - after.x;
      this.targetY += before.y - after.y;
      input.pinchDelta = 0;
    }

    this.x += (this.targetX - this.x) * this.panSmooth;
    this.y += (this.targetY - this.y) * this.panSmooth;
    this.zoom += (this.targetZoom - this.zoom) * this.zoomSmooth;

    this.clamp();
  }

  clamp() {
    this.x = Math.max(0, Math.min(MAP_WIDTH, this.x));
    this.y = Math.max(0, Math.min(MAP_HEIGHT, this.y));
    this.targetX = Math.max(0, Math.min(MAP_WIDTH, this.targetX));
    this.targetY = Math.max(0, Math.min(MAP_HEIGHT, this.targetY));
  }
}
