export class SelectionSystem {
  constructor() {
    this.selectedEntities = new Set();
    this.lastClickTime = 0;
    this.lastClickEntity = null;
  }

  clearSelection() {
    for (const entity of this.selectedEntities) {
      entity.selected = false;
    }
    this.selectedEntities.clear();
  }

  selectEntity(entity, addToSelection = false) {
    if (!addToSelection) this.clearSelection();
    entity.selected = true;
    this.selectedEntities.add(entity);
  }

  selectInBox(box, entities, addToSelection = false, faction = 'player') {
    if (!addToSelection) this.clearSelection();
    for (const entity of entities.values()) {
      if (!entity.alive) continue;
      if (entity.renderLayer !== 'units') continue;
      if (entity.faction !== faction) continue;
      if (
        entity.x >= box.x1 && entity.x <= box.x2 &&
        entity.y >= box.y1 && entity.y <= box.y2
      ) {
        entity.selected = true;
        this.selectedEntities.add(entity);
      }
    }
  }

  selectAllOfType(type, entities) {
    this.clearSelection();
    for (const entity of entities.values()) {
      if (!entity.alive) continue;
      if (entity.renderLayer !== 'units') continue;
      if (entity.type === type && entity.faction === 'player') {
        entity.selected = true;
        this.selectedEntities.add(entity);
      }
    }
  }

  handleClick(entity, now) {
    const isDoubleClick = entity === this.lastClickEntity && (now - this.lastClickTime) < 300;
    this.lastClickTime = now;
    this.lastClickEntity = entity;
    return isDoubleClick;
  }

  getSelected() {
    return Array.from(this.selectedEntities);
  }

  getFirstSelected() {
    return this.selectedEntities.values().next().value || null;
  }

  count() {
    return this.selectedEntities.size;
  }
}
