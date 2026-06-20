export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseScreenX = 0;
    this.mouseScreenY = 0;
    this.mouseWorldX = 0;
    this.mouseWorldY = 0;
    this.mouseButtons = { left: false, middle: false, right: false };
    this.scrollDelta = 0;
    this.clickStart = null;
    this.isDragging = false;
    this.selectionBox = null;
    this.isPointerLocked = false;
    this.events = [];
    this.touchDelta = { x: 0, y: 0 };
    this.middleDragDelta = { x: 0, y: 0 };
    this.pinchDelta = 0;
    this._touchMoved = false;
    this._pinchStart = 0;
    this._longPressed = false;
    this._longPressTimer = null;
    this._canLock = false;
    this._lockClickX = null;
    this._lockClickY = null;

    this._onKeyDown = (e) => {
      this.keys.add(e.key.toLowerCase());
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.key.toLowerCase());
    };
    this._onMouseMove = (e) => {
      if (this.isPointerLocked) {
        this.mouseScreenX += e.movementX;
        this.mouseScreenY += e.movementY;
      } else {
        this.mouseScreenX = e.clientX;
        this.mouseScreenY = e.clientY;
      }
      this.mouseScreenX = Math.max(0, Math.min(this.canvas.width, this.mouseScreenX));
      this.mouseScreenY = Math.max(0, Math.min(this.canvas.height, this.mouseScreenY));
      if (this.mouseButtons.middle) {
        this.middleDragDelta.x += e.movementX;
        this.middleDragDelta.y += e.movementY;
      }
      if (this.mouseButtons.left && this.clickStart) {
        this.selectionBox = {
          x1: Math.min(this.clickStart.x, this.mouseScreenX),
          y1: Math.min(this.clickStart.y, this.mouseScreenY),
          x2: Math.max(this.clickStart.x, this.mouseScreenX),
          y2: Math.max(this.clickStart.y, this.mouseScreenY),
        };
      }
    };
    this._onMouseDown = (e) => {
      if (!this.isPointerLocked) return;
      if (e.button === 0) this.mouseButtons.left = true;
      if (e.button === 1) this.mouseButtons.middle = true;
      if (e.button === 2) this.mouseButtons.right = true;
      if (e.button !== 1) this.clickStart = { x: this.mouseScreenX, y: this.mouseScreenY };
      this.isDragging = false;
      this.selectionBox = null;
      if (e.button === 1) { this.middleDragDelta.x = 0; this.middleDragDelta.y = 0; }
    };
    this._onMouseUp = (e) => {
      const btn = e.button;
      if (!this.isPointerLocked) {
        if (btn === 0) {
          this.mouseScreenX = e.clientX;
          this.mouseScreenY = e.clientY;
          this.events.push({ type: 'select', screenX: e.clientX, screenY: e.clientY, time: performance.now() });
        }
        return;
      }
      if (btn === 0) this.mouseButtons.left = false;
      if (btn === 1) this.mouseButtons.middle = false;
      if (btn === 2) this.mouseButtons.right = false;
      if (this.clickStart) {
        const dx = this.mouseScreenX - this.clickStart.x;
        const dy = this.mouseScreenY - this.clickStart.y;
        this.isDragging = Math.abs(dx) > 5 || Math.abs(dy) > 5;
        if (!this.isDragging && btn === 0) {
          this.events.push({ type: 'select', screenX: this.mouseScreenX, screenY: this.mouseScreenY, time: performance.now() });
        } else if (!this.isDragging && btn === 2) {
          this.events.push({ type: 'rightclick', screenX: this.mouseScreenX, screenY: this.mouseScreenY, time: performance.now() });
        } else if (this.selectionBox) {
          this.events.push({ type: 'boxselect', x1: this.selectionBox.x1, y1: this.selectionBox.y1, x2: this.selectionBox.x2, y2: this.selectionBox.y2 });
        }
      }
      this.clickStart = null;
      this.selectionBox = null;
    };
    this._onWheel = (e) => { if (!this.isPointerLocked) return; this.scrollDelta += Math.sign(e.deltaY); e.preventDefault(); };
    this._onContextMenu = (e) => { e.preventDefault(); };

    this._onCanvasClick = (e) => {
      if (!this.isPointerLocked && this._canLock) {
        this._lockClickX = e.clientX;
        this._lockClickY = e.clientY;
        this.canvas.requestPointerLock();
      }
    };
    this._onPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement === this.canvas;
      document.body.classList.toggle('pointer-locked', this.isPointerLocked);
      if (this.isPointerLocked) {
        if (this._lockClickX != null) {
          this.mouseScreenX = this._lockClickX;
          this.mouseScreenY = this._lockClickY;
          this._lockClickX = null;
          this._lockClickY = null;
        } else {
          this.mouseScreenX = this.canvas.width / 2;
          this.mouseScreenY = this.canvas.height / 2;
        }
      }
    };

    this._onTouchStart = (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this.mouseScreenX = t.clientX;
        this.mouseScreenY = t.clientY;
        this.clickStart = { x: this.mouseScreenX, y: this.mouseScreenY };
        this.isDragging = false;
        this.selectionBox = null;
        this._touchMoved = false;
        this._longPressed = false;
        this._longPressTimer = setTimeout(() => {
          this._longPressed = true;
        }, 300);
      } else if (e.touches.length === 2) {
        if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = null; }
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        this._pinchStart = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      }
    };
    this._onTouchMove = (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && !this._pinchStart) {
        const t = e.touches[0];
        const dx = t.clientX - this.mouseScreenX;
        const dy = t.clientY - this.mouseScreenY;
        this.mouseScreenX = t.clientX;
        this.mouseScreenY = t.clientY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          this._touchMoved = true;
          this.isDragging = true;
          if (!this._longPressed) {
            if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = null; }
            this.touchDelta.x += dx;
            this.touchDelta.y += dy;
          } else if (this.clickStart) {
            this.selectionBox = {
              x1: Math.min(this.clickStart.x, this.mouseScreenX),
              y1: Math.min(this.clickStart.y, this.mouseScreenY),
              x2: Math.max(this.clickStart.x, this.mouseScreenX),
              y2: Math.max(this.clickStart.y, this.mouseScreenY),
            };
          }
        }
      } else if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        if (this._pinchStart > 0) {
          this.pinchDelta += (this._pinchStart - dist) * 0.5;
        }
        this._pinchStart = dist;
        const cx = (t1.clientX + t2.clientX) / 2;
        const cy = (t1.clientY + t2.clientY) / 2;
        this.mouseScreenX = cx;
        this.mouseScreenY = cy;
      }
    };
    this._onTouchEnd = (e) => {
      e.preventDefault();
      if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = null; }
      if (this._longPressed && this.selectionBox) {
        this.events.push({ type: 'boxselect', x1: this.selectionBox.x1, y1: this.selectionBox.y1, x2: this.selectionBox.x2, y2: this.selectionBox.y2 });
      } else if (!this._touchMoved && this.clickStart) {
        this.events.push({ type: 'select', screenX: this.mouseScreenX, screenY: this.mouseScreenY, time: performance.now() });
      }
      if (e.touches.length < 2) this._pinchStart = 0;
      this.clickStart = null;
      this.selectionBox = null;
    };

    this.attach();
  }

  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this._onContextMenu);
    this.canvas.addEventListener('click', this._onCanvasClick);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this._onTouchEnd);
  }

  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
    this.canvas.removeEventListener('click', this._onCanvasClick);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    this.canvas.removeEventListener('touchstart', this._onTouchStart);
    this.canvas.removeEventListener('touchmove', this._onTouchMove);
    this.canvas.removeEventListener('touchend', this._onTouchEnd);
  }

  updateWorldPosition(camera) {
    const pos = camera.screenToWorld(this.mouseScreenX, this.mouseScreenY);
    this.mouseWorldX = pos.x;
    this.mouseWorldY = pos.y;
  }

  setCanLock(v) {
    this._canLock = v;
  }
}
