import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MAPS, MAP_SIZE, TILE_SIZE } from './public/games/maps.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const PORT = Number(process.env.PORT || 3000);
const LOGIC_HZ = 60;
const BROADCAST_HZ = 20;
const TANK_SIZE = 34;
const HALF_TANK = TANK_SIZE / 2;
const TANK_ACCEL = 950;
const TANK_FRICTION = 9;
const TANK_MAX_SPEED = 165;
const BULLET_SPEED = 430;
const BULLET_RADIUS = 5;
const SHOOT_COOLDOWN = 0.5;
const INVULNERABLE_TIME = 1;
const MAX_BULLETS_PER_TANK = 3;
const COUNTDOWN_SECONDS = 3;
const RECORDS_FILE = path.join(__dirname, 'data', 'records.json');

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST'] }
});

const rooms = new Map();
const socketToRoom = new Map();

function ensureRecordsFile() {
  fs.mkdirSync(path.dirname(RECORDS_FILE), { recursive: true });
  if (!fs.existsSync(RECORDS_FILE)) {
    fs.writeFileSync(RECORDS_FILE, JSON.stringify({ players: {} }, null, 2));
  }
}

function readRecords() {
  ensureRecordsFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8'));
    if (!parsed.players || typeof parsed.players !== 'object') {
      return { players: {} };
    }
    return parsed;
  } catch {
    return { players: {} };
  }
}

function writeRecords(records) {
  ensureRecordsFile();
  fs.writeFileSync(RECORDS_FILE, JSON.stringify(records, null, 2));
}

function cleanName(name) {
  const text = String(name || 'Player').trim().slice(0, 18);
  return text || 'Player';
}

function defaultStats(name) {
  return {
    name,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    kills: 0,
    deaths: 0,
    totalDamageDealt: 0
  };
}

function updateRecords(winner, loser, room) {
  const records = readRecords();
  for (const player of [winner, loser]) {
    if (!records.players[player.name]) {
      records.players[player.name] = defaultStats(player.name);
    }
  }

  const winnerStats = records.players[winner.name];
  const loserStats = records.players[loser.name];
  winnerStats.gamesPlayed += 1;
  winnerStats.wins += 1;
  winnerStats.kills += 1;
  winnerStats.totalDamageDealt += room.damageDealt.get(winner.id) || 0;

  loserStats.gamesPlayed += 1;
  loserStats.losses += 1;
  loserStats.deaths += 1;
  loserStats.totalDamageDealt += room.damageDealt.get(loser.id) || 0;

  writeRecords(records);
  return { winner: winnerStats, loser: loserStats };
}

function leaderboardEntries() {
  const records = readRecords();
  return Object.values(records.players)
    .map((entry) => ({
      ...entry,
      winRate: entry.gamesPlayed ? entry.wins / entry.gamesPlayed : 0
    }))
    .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || b.kills - a.kills || a.name.localeCompare(b.name))
    .slice(0, 20);
}

function emitLeaderboard(target = io) {
  target.emit('leaderboard', { entries: leaderboardEntries() });
}

function makeRoomId() {
  let id = '';
  do {
    id = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(id));
  return id;
}

function cloneMap(map) {
  return {
    id: map.id,
    name: map.name,
    difficulty: map.difficulty,
    bushes: map.bushes,
    grid: map.grid.map((row) => row.slice())
  };
}

function findSpawn(map, marker) {
  for (let y = 0; y < map.grid.length; y += 1) {
    for (let x = 0; x < map.grid[y].length; x += 1) {
      if (map.grid[y][x] === marker) {
        return { x: x * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2 };
      }
    }
  }
  return marker === 3 ? { x: 64, y: 560 } : { x: 560, y: 64 };
}

function randomMap() {
  return cloneMap(MAPS[Math.floor(Math.random() * MAPS.length)]);
}

function chooseDifferentMap(currentMapId = null) {
  if (MAPS.length < 2) return randomMap();
  let selected = randomMap();
  while (selected.id === currentMapId) selected = randomMap();
  return selected;
}

function createTank(player, spawn, facing) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    facing,
    hp: 3,
    invulnerableUntil: 0,
    lastShotAt: -99,
    alive: true
  };
}

function publicPlayers(room) {
  return room.players.map((player) => ({
    id: player.id,
    name: player.name,
    color: player.color,
    slot: player.slot
  }));
}

function tileAt(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_SIZE || ty >= MAP_SIZE) {
    return 2;
  }
  return map.grid[ty][tx];
}

function isSolid(tile) {
  return tile === 1 || tile === 2;
}

function rectHitsWall(map, x, y, size) {
  const left = Math.floor((x - size / 2) / TILE_SIZE);
  const right = Math.floor((x + size / 2 - 1) / TILE_SIZE);
  const top = Math.floor((y - size / 2) / TILE_SIZE);
  const bottom = Math.floor((y + size / 2 - 1) / TILE_SIZE);
  for (let ty = top; ty <= bottom; ty += 1) {
    for (let tx = left; tx <= right; tx += 1) {
      if (isSolid(tileAt(map, tx, ty))) {
        return true;
      }
    }
  }
  return false;
}

function tanksOverlap(a, b, ax = a.x, ay = a.y) {
  return Math.abs(ax - b.x) < TANK_SIZE && Math.abs(ay - b.y) < TANK_SIZE;
}

function clampTankPosition(tank) {
  const max = MAP_SIZE * TILE_SIZE - HALF_TANK;
  tank.x = Math.max(HALF_TANK, Math.min(max, tank.x));
  tank.y = Math.max(HALF_TANK, Math.min(max, tank.y));
}

function canTankOccupy(room, tank, x, y) {
  if (x < HALF_TANK || y < HALF_TANK || x > MAP_SIZE * TILE_SIZE - HALF_TANK || y > MAP_SIZE * TILE_SIZE - HALF_TANK) {
    return false;
  }
  if (rectHitsWall(room.map, x, y, TANK_SIZE)) {
    return false;
  }
  for (const other of room.tanks.values()) {
    if (other.id !== tank.id && other.alive && tanksOverlap(tank, other, x, y)) {
      return false;
    }
  }
  return true;
}

function applyInput(room, tank, dt, now) {
  const input = room.inputs.get(tank.id) || {};
  let ax = 0;
  let ay = 0;
  if (input.up) ay -= 1;
  if (input.down) ay += 1;
  if (input.left) ax -= 1;
  if (input.right) ax += 1;

  if (ax !== 0 || ay !== 0) {
    if (Math.abs(ax) > Math.abs(ay)) tank.facing = ax > 0 ? 'right' : 'left';
    if (Math.abs(ay) >= Math.abs(ax)) tank.facing = ay > 0 ? 'down' : 'up';
    if (ax !== 0 && ay !== 0) {
      const inv = Math.SQRT1_2;
      ax *= inv;
      ay *= inv;
    }
    tank.vx += ax * TANK_ACCEL * dt;
    tank.vy += ay * TANK_ACCEL * dt;
  }

  const speed = Math.hypot(tank.vx, tank.vy);
  if (speed > TANK_MAX_SPEED) {
    tank.vx = (tank.vx / speed) * TANK_MAX_SPEED;
    tank.vy = (tank.vy / speed) * TANK_MAX_SPEED;
  }

  const damping = Math.max(0, 1 - TANK_FRICTION * dt);
  tank.vx *= damping;
  tank.vy *= damping;

  const nextX = tank.x + tank.vx * dt;
  if (canTankOccupy(room, tank, nextX, tank.y)) {
    tank.x = nextX;
  } else {
    tank.vx = 0;
  }

  const nextY = tank.y + tank.vy * dt;
  if (canTankOccupy(room, tank, tank.x, nextY)) {
    tank.y = nextY;
  } else {
    tank.vy = 0;
  }
  clampTankPosition(tank);

  if (input.shoot) {
    shoot(room, tank, now);
    input.shoot = false;
  }
}

function facingVector(facing) {
  if (facing === 'up') return { dx: 0, dy: -1 };
  if (facing === 'down') return { dx: 0, dy: 1 };
  if (facing === 'left') return { dx: -1, dy: 0 };
  return { dx: 1, dy: 0 };
}

function shoot(room, tank, now) {
  if (!tank.alive || now - tank.lastShotAt < SHOOT_COOLDOWN) return;
  const activeCount = room.bullets.filter((bullet) => bullet.ownerId === tank.id).length;
  if (activeCount >= MAX_BULLETS_PER_TANK) return;

  const vector = facingVector(tank.facing);
  tank.lastShotAt = now;
  room.bullets.push({
    id: `${tank.id}-${now}-${Math.random()}`,
    ownerId: tank.id,
    x: tank.x + vector.dx * (HALF_TANK + 8),
    y: tank.y + vector.dy * (HALF_TANK + 8),
    dx: vector.dx,
    dy: vector.dy,
    bounces: 0,
    age: 0
  });
  io.to(room.id).emit('sound', { type: 'shoot', x: tank.x, y: tank.y });
}

function circleHitsTank(bullet, tank) {
  return (
    bullet.x + BULLET_RADIUS > tank.x - HALF_TANK &&
    bullet.x - BULLET_RADIUS < tank.x + HALF_TANK &&
    bullet.y + BULLET_RADIUS > tank.y - HALF_TANK &&
    bullet.y - BULLET_RADIUS < tank.y + HALF_TANK
  );
}

function damageTank(room, bullet, tank, now) {
  if (!tank.alive || now < tank.invulnerableUntil) return false;
  tank.hp -= 1;
  tank.invulnerableUntil = now + INVULNERABLE_TIME;
  room.damageDealt.set(bullet.ownerId, (room.damageDealt.get(bullet.ownerId) || 0) + 1);
  io.to(room.id).emit('player_hit', { playerId: tank.id, hp: tank.hp });
  room.explosions.push({ x: tank.x, y: tank.y, t: now, type: 'hit' });
  io.to(room.id).emit('sound', { type: 'hit', x: tank.x, y: tank.y });

  if (tank.hp <= 0) {
    tank.alive = false;
    const killer = room.players.find((player) => player.id === bullet.ownerId) || null;
    io.to(room.id).emit('player_killed', { killerId: bullet.ownerId, victimId: tank.id });
    room.explosions.push({ x: tank.x, y: tank.y, t: now, type: 'destroyed' });
    io.to(room.id).emit('sound', { type: 'explosion', x: tank.x, y: tank.y });
    endGame(room, killer?.id || null);
  }
  return true;
}

function updateBullets(room, dt, now) {
  const survivors = [];
  for (const bullet of room.bullets) {
    bullet.age += dt;
    bullet.x += bullet.dx * BULLET_SPEED * dt;
    bullet.y += bullet.dy * BULLET_SPEED * dt;

    if (bullet.age > 5 || bullet.x < 0 || bullet.y < 0 || bullet.x > MAP_SIZE * TILE_SIZE || bullet.y > MAP_SIZE * TILE_SIZE) {
      continue;
    }

    let removed = false;
    for (const tank of room.tanks.values()) {
      if (tank.id !== bullet.ownerId && tank.alive && circleHitsTank(bullet, tank)) {
        removed = damageTank(room, bullet, tank, now);
        break;
      }
    }
    if (removed) continue;

    const tx = Math.floor(bullet.x / TILE_SIZE);
    const ty = Math.floor(bullet.y / TILE_SIZE);
    const tile = tileAt(room.map, tx, ty);
    if (tile === 1) {
      room.map.grid[ty][tx] = 0;
      room.explosions.push({ x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2, t: now, type: 'wall' });
      io.to(room.id).emit('sound', { type: 'wall', x: bullet.x, y: bullet.y });
      continue;
    }
    if (tile === 2) {
      if (bullet.bounces < 1) {
        const prevX = bullet.x - bullet.dx * BULLET_SPEED * dt;
        const prevY = bullet.y - bullet.dy * BULLET_SPEED * dt;
        const prevTx = Math.floor(prevX / TILE_SIZE);
        const prevTy = Math.floor(prevY / TILE_SIZE);
        if (prevTx !== tx) bullet.dx *= -1;
        if (prevTy !== ty) bullet.dy *= -1;
        if (prevTx === tx && prevTy === ty) {
          bullet.dx *= -1;
          bullet.dy *= -1;
        }
        bullet.x = prevX;
        bullet.y = prevY;
        bullet.bounces += 1;
        io.to(room.id).emit('sound', { type: 'wall', x: bullet.x, y: bullet.y });
        survivors.push(bullet);
      }
      continue;
    }
    survivors.push(bullet);
  }
  room.bullets = survivors;
}

function startCountdown(room) {
  room.status = 'countdown';
  room.map = room.nextMap ? cloneMap(room.nextMap) : randomMap();
  room.nextMap = null;
  room.bullets = [];
  room.explosions = [];
  room.inputs = new Map(room.players.map((player) => [player.id, {}]));
  room.damageDealt = new Map(room.players.map((player) => [player.id, 0]));
  const p1Spawn = findSpawn(room.map, 3);
  const p2Spawn = findSpawn(room.map, 4);
  room.tanks = new Map([
    [room.players[0].id, createTank(room.players[0], p1Spawn, 'up')],
    [room.players[1].id, createTank(room.players[1], p2Spawn, 'down')]
  ]);
  room.countdownStart = Date.now();
  io.to(room.id).emit('game_start', {
    roomId: room.id,
    countdown: COUNTDOWN_SECONDS,
    map: room.map,
    players: publicPlayers(room)
  });
  io.to(room.id).emit('sound', { type: 'start' });
}

function endGame(room, winnerId, forcedLoser = null) {
  if (room.status === 'game_over') return;
  room.status = 'game_over';
  const winner = room.players.find((player) => player.id === winnerId) || room.players.find((player) => room.tanks.get(player.id)?.alive) || room.players[0];
  const loser = forcedLoser || room.players.find((player) => player.id !== winner.id) || room.players[0];
  const stats = updateRecords(winner, loser, room);
  io.to(room.id).emit('game_over', {
    winner: winner.id,
    winnerName: winner.name,
    stats,
    leaderboard: leaderboardEntries()
  });
  emitLeaderboard(io);
}

function selectRandomMap(room) {
  room.nextMap = chooseDifferentMap(room.nextMap?.id || room.map?.id || null);
  io.to(room.id).emit('map_selected', {
    roomId: room.id,
    map: {
      id: room.nextMap.id,
      name: room.nextMap.name,
      difficulty: room.nextMap.difficulty
    }
  });
}

function roomSnapshot(room, now) {
  return {
    roomId: room.id,
    status: room.status,
    map: room.map,
    countdownRemaining: room.status === 'countdown'
      ? Math.max(0, COUNTDOWN_SECONDS - (now - (room.countdownStart / 1000)))
      : 0,
    tanks: [...room.tanks.values()].map((tank) => ({
      id: tank.id,
      name: tank.name,
      color: tank.color,
      x: tank.x,
      y: tank.y,
      facing: tank.facing,
      hp: Math.max(0, tank.hp),
      alive: tank.alive,
      invulnerable: now < tank.invulnerableUntil
    })),
    bullets: room.bullets.map((bullet) => ({
      x: bullet.x,
      y: bullet.y,
      dx: bullet.dx,
      dy: bullet.dy,
      ownerId: bullet.ownerId
    })),
    explosions: room.explosions.filter((explosion) => now - explosion.t < 0.8).map((explosion) => ({
      x: explosion.x,
      y: explosion.y,
      type: explosion.type,
      age: now - explosion.t
    }))
  };
}

function tickRoom(room, dt, now) {
  if (room.status === 'countdown') {
    if ((Date.now() - room.countdownStart) / 1000 >= COUNTDOWN_SECONDS) {
      room.status = 'playing';
    }
  }

  if (room.status !== 'playing') return;
  for (const tank of room.tanks.values()) {
    if (tank.alive) applyInput(room, tank, dt, now);
  }
  updateBullets(room, dt, now);
  room.explosions = room.explosions.filter((explosion) => now - explosion.t < 0.8);
}

function createRoom(socket, playerName) {
  const roomId = makeRoomId();
  const player = { id: socket.id, name: cleanName(playerName), color: 'blue', slot: 1 };
  const room = {
    id: roomId,
    status: 'waiting',
    players: [player],
    inputs: new Map([[socket.id, {}]]),
    tanks: new Map(),
    bullets: [],
    explosions: [],
    map: null,
    damageDealt: new Map(),
    countdownStart: 0,
    nextMap: null
  };
  rooms.set(roomId, room);
  socketToRoom.set(socket.id, roomId);
  socket.join(roomId);
  socket.emit('room_created', { roomId });
  io.to(roomId).emit('player_joined', { roomId, status: 'Waiting (1/2)', playerId: socket.id, players: publicPlayers(room) });
}

function joinRoom(socket, roomId, playerName) {
  const room = rooms.get(String(roomId || '').trim());
  if (!room) {
    socket.emit('error', { message: '房间不存在。' });
    return;
  }
  if (room.players.length >= 2) {
    socket.emit('error', { message: '房间已满。' });
    return;
  }
  if (room.status !== 'waiting') {
    socket.emit('error', { message: '游戏已开始。' });
    return;
  }
  const player = { id: socket.id, name: cleanName(playerName), color: 'red', slot: 2 };
  room.players.push(player);
  room.inputs.set(socket.id, {});
  socketToRoom.set(socket.id, room.id);
  socket.join(room.id);
  io.to(room.id).emit('player_joined', { roomId: room.id, status: 'Waiting (2/2)', playerId: socket.id, players: publicPlayers(room) });
  startCountdown(room);
}

io.on('connection', (socket) => {
  emitLeaderboard(socket);

  socket.on('create_room', ({ playerName } = {}) => {
    if (socketToRoom.has(socket.id)) {
      socket.emit('error', { message: '你已在房间中。' });
      return;
    }
    createRoom(socket, playerName);
  });

  socket.on('join_game', ({ roomId, playerName } = {}) => {
    if (socketToRoom.has(socket.id)) {
      socket.emit('error', { message: 'You are already in a room.' });
      return;
    }
    if (!/^\d{6}$/.test(String(roomId || '').trim())) {
      socket.emit('error', { message: '请输入6位房间号。' });
      return;
    }
    joinRoom(socket, roomId, playerName);
  });

  socket.on('player_input', ({ keys } = {}) => {
    const roomId = socketToRoom.get(socket.id);
    const room = rooms.get(roomId);
    if (!room) return;
    room.inputs.set(socket.id, {
      up: Boolean(keys?.up),
      down: Boolean(keys?.down),
      left: Boolean(keys?.left),
      right: Boolean(keys?.right),
      shoot: Boolean(keys?.shoot)
    });
  });

  socket.on('request_leaderboard', () => {
    emitLeaderboard(socket);
  });

  socket.on('random_map', () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || room.status !== 'waiting') {
      socket.emit('error', { message: '只能在等待时选择随机地图。' });
      return;
    }
    selectRandomMap(room);
  });

  socket.on('play_again', () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (room && room.players.length === 2 && room.status === 'game_over') {
      startCountdown(room);
    }
  });

  socket.on('leave_room', () => {
    removePlayer(socket);
  });

  socket.on('reset_stats', () => {
    writeRecords({ players: {} });
    emitLeaderboard(io);
  });

  socket.on('disconnect', () => {
    removePlayer(socket);
  });
});

function removePlayer(socket) {
  const roomId = socketToRoom.get(socket.id);
  if (!roomId) return;
  const room = rooms.get(roomId);
  socketToRoom.delete(socket.id);
  socket.leave(roomId);
  if (!room) return;

  const leaving = room.players.find((player) => player.id === socket.id);

  if (room.status === 'playing' || room.status === 'countdown') {
    const remaining = room.players.find((player) => player.id !== socket.id);
    if (remaining) {
      endGame(room, remaining.id, leaving);
      io.to(room.id).emit('error', { message: `${leaving?.name || '有玩家'} 断开了连接。` });
    }
  }

  room.players = room.players.filter((player) => player.id !== socket.id);
  room.inputs.delete(socket.id);

  if (room.players.length === 0) {
    rooms.delete(roomId);
    return;
  }

  if (room.status === 'waiting') {
    io.to(room.id).emit('player_joined', { roomId: room.id, status: 'Waiting (1/2)', players: publicPlayers(room) });
  }
}

let lastTick = Date.now();
setInterval(() => {
  const nowMs = Date.now();
  const dt = Math.min(0.05, (nowMs - lastTick) / 1000);
  lastTick = nowMs;
  const now = nowMs / 1000;
  for (const room of rooms.values()) {
    tickRoom(room, dt, now);
  }
}, 1000 / LOGIC_HZ);

setInterval(() => {
  const now = Date.now() / 1000;
  for (const room of rooms.values()) {
    if (room.status === 'countdown' || room.status === 'playing' || room.status === 'game_over') {
      io.to(room.id).emit('game_state', roomSnapshot(room, now));
    }
  }
}, 1000 / BROADCAST_HZ);

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

server.listen(PORT, () => {
  ensureRecordsFile();
  console.log(`Tank Battle server running on port ${PORT}`);
});
