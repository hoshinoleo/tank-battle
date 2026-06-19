import { MAP_SIZE, TILE_SIZE } from './maps.js';
import { Particle } from './particle.js';

const WORLD_SIZE = MAP_SIZE * TILE_SIZE;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.shake = 0;
    this.lastExplosions = new Set();
  }

  addExplosion(x, y, strong = false) {
    const count = strong ? 46 : 18;
    const colors = ['#ffcf4a', '#ff7b2f', '#df3d27', '#f2eee0'];
    for (let i = 0; i < count; i += 1) {
      this.particles.push(new Particle(
        x,
        y,
        colors[i % colors.length],
        80 + Math.random() * (strong ? 260 : 130),
        Math.random() * Math.PI * 2,
        0.35 + Math.random() * 0.45,
        3 + Math.random() * 5
      ));
    }
    this.shake = Math.max(this.shake, strong ? 12 : 6);
  }

  syncExplosions(explosions) {
    for (const explosion of explosions || []) {
      const key = `${Math.round(explosion.x)}-${Math.round(explosion.y)}-${explosion.type}`;
      if (!this.lastExplosions.has(key) && explosion.age < 0.18) {
        this.addExplosion(explosion.x, explosion.y, explosion.type === 'destroyed');
      }
      this.lastExplosions.add(key);
    }
    if (this.lastExplosions.size > 80) this.lastExplosions.clear();
  }

  draw(state, localPlayerId, alpha, dt) {
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.shake > 0.1) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= 0.86;
    }
    this.drawGrass(ctx);
    if (state?.map) this.drawMap(ctx, state.map);
    for (const tank of state?.tanks || []) {
      if (typeof tank.interpolate === 'function') tank.interpolate(alpha);
      this.drawTank(ctx, tank, tank.id === localPlayerId);
    }
    for (const bullet of state?.bullets || []) {
      this.drawBullet(ctx, bullet);
    }
    this.updateParticles(dt);
    this.drawMinimap(ctx, state, localPlayerId);
    ctx.restore();
  }

  drawGrass(ctx) {
    ctx.fillStyle = '#213c22';
    ctx.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= MAP_SIZE; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * TILE_SIZE, 0);
      ctx.lineTo(i * TILE_SIZE, WORLD_SIZE);
      ctx.moveTo(0, i * TILE_SIZE);
      ctx.lineTo(WORLD_SIZE, i * TILE_SIZE);
      ctx.stroke();
    }
  }

  drawMap(ctx, map) {
    for (const [x, y] of map.bushes || []) {
      ctx.fillStyle = 'rgba(35, 94, 41, 0.55)';
      ctx.beginPath();
      ctx.arc(x * TILE_SIZE + 12, y * TILE_SIZE + 12, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let y = 0; y < map.grid.length; y += 1) {
      for (let x = 0; x < map.grid[y].length; x += 1) {
        const tile = map.grid[y][x];
        if (tile === 1) this.drawBrick(ctx, x, y);
        if (tile === 2) this.drawSteel(ctx, x, y);
      }
    }
  }

  drawBrick(ctx, x, y) {
    const px = x * TILE_SIZE;
    const py = y * TILE_SIZE;
    ctx.fillStyle = '#8f4f2e';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.strokeStyle = '#4d2819';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py + 8);
    ctx.lineTo(px + TILE_SIZE, py + 8);
    ctx.moveTo(px, py + 16);
    ctx.lineTo(px + TILE_SIZE, py + 16);
    ctx.moveTo(px + 12, py);
    ctx.lineTo(px + 12, py + 8);
    ctx.moveTo(px + 6, py + 8);
    ctx.lineTo(px + 6, py + 16);
    ctx.moveTo(px + 18, py + 16);
    ctx.lineTo(px + 18, py + TILE_SIZE);
    ctx.stroke();
  }

  drawSteel(ctx, x, y) {
    const px = x * TILE_SIZE;
    const py = y * TILE_SIZE;
    const gradient = ctx.createLinearGradient(px, py, px + TILE_SIZE, py + TILE_SIZE);
    gradient.addColorStop(0, '#d9dde0');
    gradient.addColorStop(0.5, '#7f8a90');
    gradient.addColorStop(1, '#eef1f2');
    ctx.fillStyle = gradient;
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    ctx.strokeStyle = '#4b565c';
    ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(px + 4, py + 4, 5, 5);
    ctx.fillRect(px + 15, py + 15, 5, 5);
  }

  drawTank(ctx, tank, isLocal) {
    if (!tank.alive) return;
    const x = tank.renderX ?? tank.x;
    const y = tank.renderY ?? tank.y;
    const flashing = tank.invulnerable && Math.floor(performance.now() / 90) % 2 === 0;
    ctx.save();
    ctx.translate(x, y);
    const angle = { up: -Math.PI / 2, right: 0, down: Math.PI / 2, left: Math.PI }[tank.facing] ?? 0;
    ctx.rotate(angle);
    ctx.globalAlpha = flashing ? 0.48 : 1;
    const body = tank.color === 'red' ? '#d94a4a' : '#3979e6';
    const trim = tank.color === 'red' ? '#ff9292' : '#8ab6ff';
    ctx.fillStyle = '#121814';
    ctx.fillRect(-18, -17, 9, 34);
    ctx.fillRect(9, -17, 9, 34);
    ctx.fillStyle = body;
    ctx.fillRect(-13, -14, 26, 28);
    ctx.fillStyle = trim;
    ctx.fillRect(-7, -8, 14, 16);
    ctx.fillStyle = '#1a1d19';
    ctx.fillRect(3, -4, 25, 8);
    ctx.fillStyle = '#111';
    for (let i = -12; i <= 12; i += 8) {
      ctx.fillRect(-18, i, 9, 3);
      ctx.fillRect(9, i, 9, 3);
    }
    if (isLocal) {
      ctx.strokeStyle = '#f0c64f';
      ctx.lineWidth = 2;
      ctx.strokeRect(-21, -21, 42, 42);
    }
    ctx.restore();
  }

  drawBullet(ctx, bullet) {
    const glow = ctx.createRadialGradient(bullet.x, bullet.y, 1, bullet.x, bullet.y, 12);
    glow.addColorStop(0, '#fff7a0');
    glow.addColorStop(0.4, '#ffd23c');
    glow.addColorStop(1, 'rgba(255,210,60,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe14f';
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  updateParticles(dt) {
    for (const particle of this.particles) {
      particle.update(dt);
      particle.draw(this.ctx);
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  drawMinimap(ctx, state, localPlayerId) {
    if (!state?.map) return;
    const size = 132;
    const x0 = WORLD_SIZE - size - 12;
    const y0 = 12;
    const scale = size / WORLD_SIZE;
    ctx.fillStyle = 'rgba(8, 12, 9, 0.82)';
    ctx.fillRect(x0 - 6, y0 - 6, size + 12, size + 12);
    for (let y = 0; y < MAP_SIZE; y += 1) {
      for (let x = 0; x < MAP_SIZE; x += 1) {
        const tile = state.map.grid[y][x];
        if (tile === 1 || tile === 2) {
          ctx.fillStyle = tile === 1 ? '#9a5937' : '#b7c1c7';
          ctx.fillRect(x0 + x * TILE_SIZE * scale, y0 + y * TILE_SIZE * scale, TILE_SIZE * scale, TILE_SIZE * scale);
        }
      }
    }
    for (const tank of state.tanks || []) {
      if (!tank.alive) continue;
      ctx.fillStyle = tank.id === localPlayerId ? '#f0c64f' : tank.color;
      ctx.beginPath();
      ctx.arc(x0 + tank.x * scale, y0 + tank.y * scale, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#d7e4d4';
    ctx.strokeRect(x0, y0, size, size);
  }
}
