let _nextId = 1;

export function resetEntityId() {
  _nextId = 1;
}

export class Entity {
  constructor({ type, x, y, faction, hp, maxHp, renderLayer = 'units' }) {
    this.id = _nextId++;
    this.type = type;
    this.x = x;
    this.y = y;
    this.faction = faction;
    this.hp = hp;
    this.maxHp = maxHp;
    this.alive = true;
    this.renderLayer = renderLayer;
    this.age = 0;
    this.speed = 0;
    this.destination = null;

    // Collision contract — every subclass should override these in its constructor.
    // collisionRadius: hard physical radius. Movers are always pushed out of this.
    // passable: if true, movers phase through entirely (floor decals, FX, etc).
    // interactionRadius: how close a unit needs to get to "use" this entity.
    //   Must be >= collisionRadius so workers stop adjacent, never inside.
    // weight: determines push priority in collisions. Heavier entities push lighter ones.
    //   Non-movers (buildings, resources) implicitly have near-infinite weight.
    this.collisionRadius = 0;
    this.passable = false;
    this.interactionRadius = 0;
    this.weight = 1;
  }

  moveTo(x, y) {
    if (!this.destination) this.destination = { x, y };
    else { this.destination.x = x; this.destination.y = y; }
  }

  distanceTo(other) {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  die() {
    this.alive = false;
  }

  takeDamage(amount) {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    }
  }

  update(dt) {
    this.age += dt;
  }

  render(renderer, ctx) {
  }
}