const MAX_PARTICLES = 500;

export class ParticleSystem {
  constructor() {
    this.pool = [];
    this.active = [];
    this._preallocate();
  }

  _preallocate() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push(this._createParticle());
    }
  }

  _createParticle() {
    return { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, color: '', glowColor: '', size: 0, alpha: 1, alive: false };
  }

  _acquire() {
    if (this.pool.length > 0) {
      const p = this.pool.pop();
      p.alive = true;
      return p;
    }
    const p = this._createParticle();
    p.alive = true;
    return p;
  }

  _release(p) {
    p.alive = false;
    if (this.pool.length < MAX_PARTICLES) {
      this.pool.push(p);
    }
  }

  emit(x, y, config) {
    const count = Math.min(config.particleCount || 10, 20);
    for (let i = 0; i < count; i++) {
      const p = this._acquire();
      p.x = x;
      p.y = y;
      const angle = Math.random() * Math.PI * 2;
      const speed = (config.speed || 2) * (0.5 + Math.random() * 0.5);
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 0;
      p.maxLife = (config.lifetime || 1) * (0.5 + Math.random() * 0.5);
      p.color = config.color || '#00ffcc';
      p.glowColor = config.glowColor || '#00ffcc';
      p.size = (config.size || 3) * (0.5 + Math.random() * 0.5);
      p.alpha = 1;
      this.active.push(p);
    }
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this._release(p);
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha = 1 - p.life / p.maxLife;
    }
  }

  render(renderer, ctx) {
    for (const p of this.active) {
      renderer.setGlow(p.glowColor, 8);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      renderer.clearGlow();
    }
  }
}
