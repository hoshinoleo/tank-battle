export class Tank {
  constructor(data) {
    Object.assign(this, data);
    this.previous = { x: data.x, y: data.y };
    this.renderX = data.x;
    this.renderY = data.y;
  }

  update(data) {
    this.previous = { x: this.renderX, y: this.renderY };
    Object.assign(this, data);
  }

  interpolate(alpha) {
    this.renderX = this.previous.x + (this.x - this.previous.x) * alpha;
    this.renderY = this.previous.y + (this.y - this.previous.y) * alpha;
  }
}
