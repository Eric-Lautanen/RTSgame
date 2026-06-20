import { MAP_WIDTH, MAP_HEIGHT } from '../data/world.js';

const _seek = { x: 0, y: 0 };
const _sep  = { x: 0, y: 0 };
const _push = { x: 0, y: 0 };
const _avoid = { x: 0, y: 0 };
const _fwd  = { x: 0, y: 0 };
const _stuckTimer = new Map();
const _nearbySeen = new Set();
const _nearbyResult = [];
const CELL  = 200;

const FRICTION = 0.88;
const BASE_STEER = 8;
const SLOW_RADIUS = 60;
const STUCK_TIME = 0.25;

const SEP_MULT = 3.5;
const SEP_RANGE_PAD = 30;

// Weight-based push: heavier entities push lighter ones out of the way.
// Returns fraction of push/force that should affect `entity` vs `other`.
function getWeightRatio(entity, other) {
  const wSelf = entity.weight || 1;
  const wOther = other.weight || (other.vx !== undefined ? 1 : 9999);
  return wOther / (wSelf + wOther);
}

function applyFriction(entity) {
  entity.vx *= FRICTION;
  entity.vy *= FRICTION;
  if (Math.abs(entity.vx) < 0.5 && Math.abs(entity.vy) < 0.5) {
    entity.vx = 0; entity.vy = 0;
  }
}

function cellKey(x, y) {
  return `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
}

function buildSpatialHash(entities) {
  const hash = new Map();
  for (const e of entities.values()) {
    if (!e.alive || e.passable) continue;
    if (!e.collisionRadius) continue;
    const k = cellKey(e.x, e.y);
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k).push(e);
  }
  return hash;
}

function getNearby(hash, x, y, radius) {
  _nearbySeen.clear();
  _nearbyResult.length = 0;
  const r = Math.ceil(radius / CELL) + 1;
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      const k = `${cx + dx},${cy + dy}`;
      const bucket = hash.get(k);
      if (bucket) {
        for (const e of bucket) {
          if (!_nearbySeen.has(e.id)) {
            _nearbySeen.add(e.id);
            _nearbyResult.push(e);
          }
        }
      }
    }
  }
  return _nearbyResult;
}

export class MovementSystem {
  update(entities, dt) {
    const movers = [];
    for (const e of entities.values()) {
      if (e.alive && e.vx !== undefined) movers.push(e);
    }

    const hash = buildSpatialHash(entities);

    for (const [id, _] of _stuckTimer) {
      const e = entities.get(id);
      if (!e || !e.alive) _stuckTimer.delete(id);
    }

    for (const entity of movers) {
      if (!isFinite(entity.x) || !isFinite(entity.y)) { entity.x = 200; entity.y = 200; entity.vx = 0; entity.vy = 0; }
      {
        const eRad = entity.radius || 6;
        const maxSpd = entity.maxSpeed || 80;
        const nearby = getNearby(hash, entity.x, entity.y, 140);
        for (const other of nearby) {
          if (other === entity || other.passable || other.vx !== undefined || other.resourceType) continue;
          const otherR = other.collisionRadius || 0;
          if (otherR === 0) continue;
          const margin = eRad + otherR;
          const nx = entity.x - other.x;
          const ny = entity.y - other.y;
          const d2 = nx * nx + ny * ny;
          if (d2 < margin * margin) {
            let nxHat = nx, nyHat = ny, dist = Math.sqrt(d2);
            if (d2 < 0.001) {
              const angle = Math.random() * Math.PI * 2;
              nxHat = Math.cos(angle); nyHat = Math.sin(angle);
              dist = margin;
            }
            entity.x += (nxHat / dist) * (margin - dist) * 0.9;
            entity.y += (nyHat / dist) * (margin - dist) * 0.9;
            entity.vx += (nxHat / dist) * maxSpd * 0.6;
            entity.vy += (nyHat / dist) * maxSpd * 0.6;
          }
        }
      }
      const hasDest = entity.destination && isFinite(entity.destination.x) && isFinite(entity.destination.y);
      const moving  = entity.vx !== 0 || entity.vy !== 0;
      if (!hasDest && !moving) continue;
      _seek.x = 0; _seek.y = 0;
      _sep.x = 0; _sep.y = 0;
      _fwd.x = 0; _fwd.y = 0;
      _avoid.x = 0; _avoid.y = 0;

      const maxSpd  = entity.maxSpeed  || 80;
      const sepStr  = entity.separationStrength || 3;
      const steerK  = (entity.steerStrength || BASE_STEER) * dt;
      const eRad    = entity.radius || 6;

      if (hasDest) {
        const dx = entity.destination.x - entity.x;
        const dy = entity.destination.y - entity.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const arrR = entity.arrivalRadius || 8;

        if (dist < arrR) {
          entity.destination = null;
          _seek.x = 0; _seek.y = 0;
          applyFriction(entity);
        } else {
          const desiredSpd = dist < SLOW_RADIUS ? maxSpd * (dist / SLOW_RADIUS) : maxSpd;
          const inv = 1 / dist;
          const desVX = dx * inv * desiredSpd;
          const desVY = dy * inv * desiredSpd;
          _seek.x = (desVX - entity.vx) * steerK;
          _seek.y = (desVY - entity.vy) * steerK;
        }
      } else {
        _seek.x = 0; _seek.y = 0;
        applyFriction(entity);
        if (entity.vx === 0 && entity.vy === 0) continue;
      }

      _sep.x = 0; _sep.y = 0;
      let sepN = 0;
      const minD = (eRad + eRad) * SEP_MULT;
      const sepRange = minD + SEP_RANGE_PAD;
      { const nearby = getNearby(hash, entity.x, entity.y, sepRange);
        for (const other of nearby) {
          if (other === entity || !other.alive || other.vx === undefined) continue;
          const nx = entity.x - other.x;
          const ny = entity.y - other.y;
          const d2 = nx * nx + ny * ny;
          const otherMinD = (eRad + (other.radius || 6)) * SEP_MULT;
          if (d2 > 0 && d2 < otherMinD * otherMinD) {
            const d = Math.sqrt(d2);
            const wr = getWeightRatio(entity, other);
            const strength = (1 - d / otherMinD) * sepStr * wr;
            _sep.x += (nx / d) * strength;
            _sep.y += (ny / d) * strength;
            sepN++;
          }
        }
      }
      if (sepN > 1) { _sep.x /= Math.sqrt(sepN); _sep.y /= Math.sqrt(sepN); }

      _fwd.x = 0; _fwd.y = 0;
      const dest = entity.destination;
      if (dest) {
        const destDx = dest.x - entity.x;
        const destDy = dest.y - entity.y;
        const destDist = Math.sqrt(destDx * destDx + destDy * destDy);
        if (destDist > 0.1) {
          const destNx = destDx / destDist;
          const destNy = destDy / destDist;
          const destLen2 = destDist * destDist;
          const nearby = getNearby(hash, entity.x, entity.y, eRad + 160);
          for (const other of nearby) {
            if (other === entity || other.passable || !other.alive) continue;
            const otherR = other.collisionRadius || (other.radius || 6);
            if (otherR === 0) continue;
            const ox = other.x - entity.x;
            const oy = other.y - entity.y;
            const t = (ox * destDx + oy * destDy) / destLen2;
            if (t < 0 || t > 1.4) continue;
            const closestX = entity.x + destDx * t;
            const closestY = entity.y + destDy * t;
            const sepX = other.x - closestX;
            const sepY = other.y - closestY;
            const sepDist = Math.sqrt(sepX * sepX + sepY * sepY);
            const minDist = eRad + otherR + 6;
            if (sepDist < minDist) {
              const invSep = sepDist > 0.001 ? 1 / sepDist : 1;
              const toObsNx = sepX * invSep;
              const toObsNy = sepY * invSep;
              const seekToward = _seek.x * toObsNx + _seek.y * toObsNy;
              if (seekToward > 0) {
                _seek.x -= seekToward * toObsNx * 0.85;
                _seek.y -= seekToward * toObsNy * 0.85;
              }
              const perpX = -toObsNy;
              const perpY = toObsNx;
              const dotLeft = perpX * destNx + perpY * destNy;
              const dotRight = (-perpX) * destNx + (-perpY) * destNy;
              const dir = dotLeft >= dotRight ? 1 : -1;
              const distFactor = 1 - Math.min(1, sepDist / minDist);
              const aheadFactor = t < 1 ? 1 : Math.max(0, 1 - (t - 1) * 5);
              const strength = distFactor * aheadFactor * maxSpd * 0.5;
              _fwd.x += perpX * dir * strength;
              _fwd.y += perpY * dir * strength;
            }
          }
        }
      }

      if (!isFinite(entity.vx) || !isFinite(entity.vy)) { entity.vx = 0; entity.vy = 0; }
      entity.vx += _seek.x + _sep.x * dt + _fwd.x * dt;
      entity.vy += _seek.y + _sep.y * dt + _fwd.y * dt;

      const spd = Math.sqrt(entity.vx * entity.vx + entity.vy * entity.vy);
      if (spd > maxSpd) {
        const inv = maxSpd / spd;
        entity.vx *= inv;
        entity.vy *= inv;
      }

      if (entity.destination && spd < maxSpd * 0.2) {
        const t = _stuckTimer.get(entity.id) || 0;
        const next = t + dt;
        _stuckTimer.set(entity.id, next);
        if (next > STUCK_TIME) {
          _avoid.x = 0; _avoid.y = 0;
          let avoidN = 0;
          const neighbors = getNearby(hash, entity.x, entity.y, 80);
          for (const other of neighbors) {
            if (other === entity || !other.alive || other.passable) continue;
            const otherR = other.collisionRadius || (other.radius || 6);
            if (otherR === 0) continue;
            const dx = entity.x - other.x;
            const dy = entity.y - other.y;
            const d2 = dx * dx + dy * dy;
            const avoidRange = (eRad + otherR) * 3 + 20;
            if (d2 > 0 && d2 < avoidRange * avoidRange) {
              const d = Math.sqrt(d2);
              const strength = (1 - d / avoidRange) * (1 - d / avoidRange);
              _avoid.x += (dx / d) * strength;
              _avoid.y += (dy / d) * strength;
              avoidN++;
            }
          }
          if (avoidN > 0) {
            _avoid.x /= avoidN;
            _avoid.y /= avoidN;
            const avoidMag = Math.sqrt(_avoid.x * _avoid.x + _avoid.y * _avoid.y);
            if (avoidMag > 0.01 && entity.destination) {
              const destDx = entity.destination.x - entity.x;
              const destDy = entity.destination.y - entity.y;
              const destDist = Math.sqrt(destDx * destDx + destDy * destDy);
              if (destDist > 0) {
                const destNX = destDx / destDist;
                const destNY = destDy / destDist;
                const dot = _avoid.x * destNX + _avoid.y * destNY;
                if (dot < 0.5) {
                  const perpX = -destNY;
                  const perpY = destNX;
                  const perpDot = _avoid.x * perpX + _avoid.y * perpY;
                  if (Math.abs(perpDot) > 0.1) {
                    const sign = perpDot > 0 ? 1 : -1;
                    _avoid.x = destNX * Math.max(0, 0.5 - dot) + perpX * sign * 0.8;
                    _avoid.y = destNY * Math.max(0, 0.5 - dot) + perpY * sign * 0.8;
                  }
                }
              }
              const am = Math.sqrt(_avoid.x * _avoid.x + _avoid.y * _avoid.y);
              if (am > 0.01) {
                entity.vx += (_avoid.x / am) * maxSpd * 1.5;
                entity.vy += (_avoid.y / am) * maxSpd * 1.5;
              }
            }
          } else {
            const angle = Math.random() * Math.PI * 2;
            entity.vx += Math.cos(angle) * maxSpd * 0.8;
            entity.vy += Math.sin(angle) * maxSpd * 0.8;
          }
          _stuckTimer.set(entity.id, 0);
        }
      } else if (spd >= maxSpd * 0.2) {
        _stuckTimer.set(entity.id, 0);
      }

      const anticipateDist = eRad + maxSpd * dt + 1;
      {
        const nearby = getNearby(hash, entity.x, entity.y, anticipateDist + 120);
        for (const other of nearby) {
          if (other === entity || other.passable) continue;
          const otherR = other.collisionRadius || 0;
          if (otherR === 0) continue;
          const margin = eRad + otherR;
          const ox = entity.x - other.x;
          const oy = entity.y - other.y;
          const d2 = ox * ox + oy * oy;
          const preMoveRange = margin + maxSpd * dt + 1;
          if (d2 < preMoveRange * preMoveRange && d2 !== 0) {
            if (d2 < margin * margin) {
              if (d2 < 0.001) {
                entity.x += margin * 0.5;
              } else {
                const d = Math.sqrt(d2);
                const nx = ox / d;
                const ny = oy / d;
                const dot = entity.vx * nx + entity.vy * ny;
                if (dot < 0) {
                  const wr = getWeightRatio(entity, other);
                  entity.vx -= dot * nx * 0.8 * wr;
                  entity.vy -= dot * ny * 0.8 * wr;
                  entity.vx += Math.abs(dot) * (-ny) * 0.4 * wr;
                  entity.vy += Math.abs(dot) * nx * 0.4 * wr;
                }
              }
            }
          }
        }
      }

      if (!isFinite(entity.vx) || !isFinite(entity.vy)) { entity.vx = 0; entity.vy = 0; }
      if (!isFinite(entity.x) || !isFinite(entity.y)) { entity.x = 200; entity.y = 200; }
      entity.x += entity.vx * dt;
      entity.y += entity.vy * dt;

      {
        const nearby = getNearby(hash, entity.x, entity.y, 140);
        for (const other of nearby) {
          if (other === entity || other.passable) continue;
          const otherR = other.collisionRadius || 0;
          if (otherR === 0) continue;
          const margin = eRad + otherR;
          const nx = entity.x - other.x;
          const ny = entity.y - other.y;
          const d2 = nx * nx + ny * ny;
          if (d2 < margin * margin) {
            let nxHat = nx, nyHat = ny, dist = Math.sqrt(d2);
            if (d2 < 0.001) {
              const angle = Math.random() * Math.PI * 2;
              nxHat = Math.cos(angle); nyHat = Math.sin(angle);
              dist = margin;
              entity.x += nxHat * margin * 0.5;
              entity.y += nyHat * margin * 0.5;
            } else {
              const d = dist;
              const wr = getWeightRatio(entity, other);
              const push = (margin - d) * wr;
              entity.x += (nx / d) * push;
              entity.y += (ny / d) * push;
              const dot = entity.vx * (nx / d) + entity.vy * (ny / d);
              if (dot < 0) {
                entity.vx -= dot * (nx / d) * 0.8 * wr;
                entity.vy -= dot * (ny / d) * 0.8 * wr;
                entity.vx += Math.abs(dot) * (-ny / d) * 0.4 * wr;
                entity.vy += Math.abs(dot) * (nx / d) * 0.4 * wr;
              }
            }
            if (other.vx === undefined) {
              entity.vx += (nxHat / dist) * maxSpd * 0.4;
              entity.vy += (nyHat / dist) * maxSpd * 0.4;
            }
          }
        }
      }

      const clampMargin = entity.collisionRadius || 6;
      if (!isFinite(entity.x) || !isFinite(entity.y)) { entity.x = 200; entity.y = 200; }
      entity.x = Math.max(clampMargin, Math.min(MAP_WIDTH - clampMargin, entity.x));
      entity.y = Math.max(clampMargin, Math.min(MAP_HEIGHT - clampMargin, entity.y));
    }
  }
}
