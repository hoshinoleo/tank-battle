import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const WORLD = 720;
const TANK = 34;
const HALF = TANK / 2;
const SPEED = 178;
const BULLET_SPEED = 430;
const BULLET_RADIUS = 5;
const LOGIC_HZ = 60;
const BROADCAST_HZ = 20;
const POWERUP_TTL = 10;
const POWERUP_INTERVAL = 7;
const COLORS = ['#d94f45', '#4488d9', '#4fa867', '#d6b84c'];
const SHAPES = ['方塔', '长炮', '双履带', '圆徽'];
const SPAWNS = [
  { x: 64, y: 64, facing: 'down' },
  { x: WORLD - 64, y: 64, facing: 'down' },
  { x: 64, y: WORLD - 64, facing: 'up' },
  { x: WORLD - 64, y: WORLD - 64, facing: 'up' }
];
const POWERUPS = [
  { type: 'speed', name: '坦克加速', icon: '⚡', ttl: 8 },
  { type: 'bulletSpeed', name: '子弹加速', icon: '🚀', ttl: 8 },
  { type: 'triple', name: '子弹连发', icon: '🔫', ttl: 8 },
  { type: 'pierce', name: '穿甲弹', icon: '💥', ttl: 10 },
  { type: 'freeze', name: '暂停敌人', icon: '⏸️', ttl: 3 },
  { type: 'life', name: '加一条命', icon: '❤️' },
  { type: 'shield', name: '无敌', icon: '⭐', ttl: 5 }
];

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ['GET', 'POST'] } });
const rooms = new Map();
const socketToRoom = new Map();
const pveRooms = new Map();
const socketToPveRoom = new Map();

function cleanName(name) {
  const text = String(name || '玩家').trim().slice(0, 18);
  return text || '玩家';
}

function roomId() {
  let id = '';
  do {
    id = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(id) || pveRooms.has(id));
  return id;
}

function publicPvePlayer(player, room) {
  return {
    id: player.id,
    name: player.name,
    host: room.hostId === player.id
  };
}

function emitPveRoom(room) {
  io.to(`pve:${room.id}`).emit('pve_room_state', {
    roomId: room.id,
    status: room.status,
    hostId: room.hostId,
    players: room.players.map((player) => publicPvePlayer(player, room))
  });
}

function leaveExistingPve(socket) {
  if (socketToPveRoom.has(socket.id)) removePvePlayer(socket, true);
}

function createPveRoom(socket, name) {
  leaveExisting(socket);
  leaveExistingPve(socket);
  const id = roomId();
  const room = {
    id,
    players: [{ id: socket.id, name: cleanName(name) }],
    hostId: socket.id,
    status: 'waiting'
  };
  pveRooms.set(id, room);
  socketToPveRoom.set(socket.id, id);
  socket.join(`pve:${id}`);
  socket.emit('pve_room_created', { roomId: id });
  emitPveRoom(room);
  return id;
}

function checkRoom(id) {
  const roomId = String(id || '').trim();
  if (!/^\d{6}$/.test(roomId)) {
    return { ok: false, type: null, roomId, message: '房间号必须是 6 位数字。' };
  }
  if (rooms.has(roomId)) return { ok: true, type: 'pvp', roomId };
  if (pveRooms.has(roomId)) return { ok: true, type: 'pve', roomId };
  return { ok: false, type: null, roomId, message: '房间不存在。' };
}

function joinPveRoom(socket, id, name) {
  leaveExisting(socket);
  leaveExistingPve(socket);
  const key = String(id || '').trim();
  if (!/^\d{6}$/.test(key)) {
    socket.emit('pve_room_error', { message: '房间号必须是 6 位数字。' });
    return;
  }
  const room = pveRooms.get(key);
  if (!room) {
    socket.emit('pve_room_error', { message: 'PVE 房间不存在。' });
    return;
  }
  if (room.players.length >= 2) {
    socket.emit('pve_room_error', { message: 'PVE 房间已满，最多 2 人。' });
    return;
  }
  if (room.status !== 'waiting') {
    socket.emit('pve_room_error', { message: 'PVE 游戏已经开始，无法加入。' });
    return;
  }
  room.players.push({ id: socket.id, name: cleanName(name) });
  socketToPveRoom.set(socket.id, room.id);
  socket.join(`pve:${room.id}`);
  emitPveRoom(room);
}

function removePvePlayer(socket, silent = false) {
  const id = socketToPveRoom.get(socket.id);
  if (!id) return;
  const room = pveRooms.get(id);
  socketToPveRoom.delete(socket.id);
  socket.leave(`pve:${id}`);
  if (!room) return;
  room.players = room.players.filter((player) => player.id !== socket.id);
  if (room.players.length === 0 || room.hostId === socket.id) {
    if (room.players.length) io.to(`pve:${id}`).emit('pve_room_closed', { message: '房主已离开，PVE 房间已关闭。' });
    for (const player of room.players) socketToPveRoom.delete(player.id);
    pveRooms.delete(id);
    return;
  }
  room.status = 'waiting';
  if (!silent) io.to(`pve:${id}`).emit('pve_room_notice', { message: '队友已离开 PVE 房间。' });
  emitPveRoom(room);
}

function publicPlayer(player, room) {
  const tank = room.tanks.get(player.id);
  return {
    id: player.id,
    name: player.name,
    slot: player.slot,
    color: player.color,
    shape: player.shape,
    host: room.hostId === player.id,
    hp: tank ? Math.max(0, tank.hp) : 3,
    alive: tank ? tank.alive : true,
    kills: player.kills || 0
  };
}

function emitRoom(room) {
  io.to(room.id).emit('room_state', {
    roomId: room.id,
    status: room.status,
    hostId: room.hostId,
    powerupsEnabled: room.powerupsEnabled,
    players: room.players.map((player) => publicPlayer(player, room))
  });
}

function leaveExisting(socket) {
  const oldRoomId = socketToRoom.get(socket.id);
  if (oldRoomId) removePlayer(socket, true);
}

function createRoom(socket, name, powerupsEnabled = true) {
  leaveExisting(socket);
  leaveExistingPve(socket);
  const id = roomId();
  const player = {
    id: socket.id,
    name: cleanName(name),
    slot: 1,
    color: COLORS[0],
    shape: SHAPES[0],
    kills: 0
  };
  const room = {
    id,
    status: 'waiting',
    hostId: socket.id,
    players: [player],
    inputs: new Map([[socket.id, {}]]),
    tanks: new Map(),
    bullets: [],
    powerups: [],
    explosions: [],
    powerupsEnabled: Boolean(powerupsEnabled),
    lastPowerupAt: 0,
    winnerId: null
  };
  rooms.set(id, room);
  socketToRoom.set(socket.id, id);
  socket.join(id);
  socket.emit('room_created', { roomId: id });
  emitRoom(room);
}

function joinRoom(socket, id, name) {
  leaveExisting(socket);
  leaveExistingPve(socket);
  const key = String(id || '').trim();
  if (!/^\d{6}$/.test(key)) {
    socket.emit('room_error', { message: '房间号必须是 6 位数字。' });
    return;
  }
  const room = rooms.get(key);
  if (!room) {
    socket.emit('room_error', { message: '房间不存在。' });
    return;
  }
  if (room.players.length >= 4) {
    socket.emit('room_error', { message: '房间已满，最多 4 人。' });
    return;
  }
  if (room.status !== 'waiting') {
    socket.emit('room_error', { message: '游戏已经开始，无法加入。' });
    return;
  }
  const slot = room.players.length + 1;
  const player = {
    id: socket.id,
    name: cleanName(name),
    slot,
    color: COLORS[slot - 1],
    shape: SHAPES[slot - 1],
    kills: 0
  };
  room.players.push(player);
  room.inputs.set(socket.id, {});
  socketToRoom.set(socket.id, room.id);
  socket.join(room.id);
  emitRoom(room);
}

function pickSpawns(count) {
  if (count === 4) return SPAWNS.map((spawn, index) => ({ ...spawn, index }));
  const pool = SPAWNS.map((spawn, index) => ({ ...spawn, index }));
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function startGame(socket) {
  const room = rooms.get(socketToRoom.get(socket.id));
  if (!room) return;
  if (room.hostId !== socket.id) {
    socket.emit('room_error', { message: '只有房主可以开始游戏。' });
    return;
  }
  if (room.players.length < 2) {
    socket.emit('room_error', { message: '至少 2 人才能开始 PVP。' });
    return;
  }
  room.status = 'playing';
  room.bullets = [];
  room.powerups = [];
  room.explosions = [];
  room.winnerId = null;
  room.lastPowerupAt = Date.now() / 1000;
  room.players.forEach((player) => { player.kills = 0; });
  const spawns = pickSpawns(room.players.length);
  room.tanks = new Map(room.players.map((player, index) => {
    const spawn = spawns[index];
    return [player.id, {
      id: player.id,
      name: player.name,
      color: player.color,
      shape: player.shape,
      x: spawn.x,
      y: spawn.y,
      facing: spawn.facing,
      hp: 3,
      alive: true,
      lastShot: -99,
      effects: {},
      frozenUntil: 0,
      invulnerableUntil: Date.now() / 1000 + 1.5
    }];
  }));
  emitRoom(room);
  io.to(room.id).emit('pvp_started', { roomId: room.id, world: WORLD, powerupsEnabled: room.powerupsEnabled });
}

function facingVector(facing) {
  if (facing === 'up') return { dx: 0, dy: -1 };
  if (facing === 'down') return { dx: 0, dy: 1 };
  if (facing === 'left') return { dx: -1, dy: 0 };
  return { dx: 1, dy: 0 };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function tanksOverlap(a, b, x = a.x, y = a.y) {
  return Math.abs(x - b.x) < TANK && Math.abs(y - b.y) < TANK;
}

function canMove(room, tank, x, y) {
  if (x < HALF || y < HALF || x > WORLD - HALF || y > WORLD - HALF) return false;
  for (const other of room.tanks.values()) {
    if (other.id !== tank.id && other.alive && tanksOverlap(tank, other, x, y)) return false;
  }
  return true;
}

function effectActive(tank, type, now) {
  return (tank.effects[type] || 0) > now;
}

function shoot(room, tank, now) {
  const cooldown = effectActive(tank, 'triple', now) ? 0.42 : 0.55;
  if (!tank.alive || now - tank.lastShot < cooldown) return;
  tank.lastShot = now;
  const vector = facingVector(tank.facing);
  const spread = effectActive(tank, 'triple', now) ? [-7, 0, 7] : [0];
  for (const offset of spread) {
    room.bullets.push({
      id: `${tank.id}-${now}-${Math.random()}`,
      ownerId: tank.id,
      x: tank.x + vector.dx * 25 + (vector.dy ? offset : 0),
      y: tank.y + vector.dy * 25 + (vector.dx ? offset : 0),
      dx: vector.dx,
      dy: vector.dy,
      speed: effectActive(tank, 'bulletSpeed', now) ? BULLET_SPEED * 2 : BULLET_SPEED,
      pierce: effectActive(tank, 'pierce', now),
      age: 0
    });
  }
}

function applyPowerup(room, tank, powerup, now) {
  if (powerup.type === 'life') {
    tank.hp = Math.min(5, tank.hp + 1);
  } else if (powerup.type === 'freeze') {
    for (const other of room.tanks.values()) {
      if (other.id !== tank.id && other.alive) other.frozenUntil = now + powerup.ttl;
    }
  } else if (powerup.type === 'shield') {
    tank.invulnerableUntil = Math.max(tank.invulnerableUntil, now + powerup.ttl);
  } else {
    tank.effects[powerup.type] = now + powerup.ttl;
  }
  room.explosions.push({ x: powerup.x, y: powerup.y, type: 'power', t: now });
}

function updateTanks(room, dt, now) {
  for (const tank of room.tanks.values()) {
    if (!tank.alive || tank.frozenUntil > now) continue;
    const input = room.inputs.get(tank.id) || {};
    let mx = 0;
    let my = 0;
    if (input.up) my -= 1;
    if (input.down) my += 1;
    if (input.left) mx -= 1;
    if (input.right) mx += 1;
    if (mx || my) {
      if (Math.abs(mx) > Math.abs(my)) tank.facing = mx > 0 ? 'right' : 'left';
      if (Math.abs(my) >= Math.abs(mx)) tank.facing = my > 0 ? 'down' : 'up';
      const length = Math.hypot(mx, my) || 1;
      const boost = effectActive(tank, 'speed', now) ? 1.5 : 1;
      const nx = tank.x + (mx / length) * SPEED * boost * dt;
      const ny = tank.y + (my / length) * SPEED * boost * dt;
      if (canMove(room, tank, nx, tank.y)) tank.x = clamp(nx, HALF, WORLD - HALF);
      if (canMove(room, tank, tank.x, ny)) tank.y = clamp(ny, HALF, WORLD - HALF);
    }
    if (input.shoot) {
      shoot(room, tank, now);
      input.shoot = false;
    }
  }
}

function hitTank(bullet, tank) {
  return bullet.x + BULLET_RADIUS > tank.x - HALF &&
    bullet.x - BULLET_RADIUS < tank.x + HALF &&
    bullet.y + BULLET_RADIUS > tank.y - HALF &&
    bullet.y - BULLET_RADIUS < tank.y + HALF;
}

function damageTank(room, bullet, tank, now) {
  if (!tank.alive || tank.invulnerableUntil > now) return false;
  tank.hp -= 1;
  tank.invulnerableUntil = now + 0.6;
  room.explosions.push({ x: tank.x, y: tank.y, type: 'hit', t: now });
  if (tank.hp <= 0) {
    tank.alive = false;
    const killer = room.players.find((player) => player.id === bullet.ownerId);
    if (killer) killer.kills = (killer.kills || 0) + 1;
    room.explosions.push({ x: tank.x, y: tank.y, type: 'boom', t: now });
    io.to(tank.id).emit('spectator_mode', { message: '你的坦克被击毁，已进入观战模式。' });
  }
  return true;
}

function updateBullets(room, dt, now) {
  const next = [];
  for (const bullet of room.bullets) {
    bullet.age += dt;
    bullet.x += bullet.dx * bullet.speed * dt;
    bullet.y += bullet.dy * bullet.speed * dt;
    if (bullet.age > 4 || bullet.x < 0 || bullet.y < 0 || bullet.x > WORLD || bullet.y > WORLD) continue;
    let removed = false;
    for (const tank of room.tanks.values()) {
      if (tank.id !== bullet.ownerId && tank.alive && hitTank(bullet, tank)) {
        removed = damageTank(room, bullet, tank, now) && !bullet.pierce;
        break;
      }
    }
    if (!removed) next.push(bullet);
  }
  room.bullets = next;
}

function spawnPowerup(room, now) {
  if (!room.powerupsEnabled || now - room.lastPowerupAt < POWERUP_INTERVAL) return;
  room.lastPowerupAt = now;
  const base = POWERUPS[Math.floor(Math.random() * POWERUPS.length)];
  room.powerups.push({
    ...base,
    id: `p-${now}-${Math.random()}`,
    x: 64 + Math.random() * (WORLD - 128),
    y: 64 + Math.random() * (WORLD - 128),
    bornAt: now,
    expiresAt: now + POWERUP_TTL
  });
}

function updatePowerups(room, now) {
  const next = [];
  for (const powerup of room.powerups) {
    if (now >= powerup.expiresAt) continue;
    let taken = false;
    for (const tank of room.tanks.values()) {
      if (tank.alive && Math.hypot(tank.x - powerup.x, tank.y - powerup.y) < 30) {
        applyPowerup(room, tank, powerup, now);
        taken = true;
        break;
      }
    }
    if (!taken) next.push(powerup);
  }
  room.powerups = next;
}

function maybeFinish(room) {
  const alive = [...room.tanks.values()].filter((tank) => tank.alive);
  if (room.status === 'playing' && alive.length <= 1) {
    room.status = 'game_over';
    room.winnerId = alive[0]?.id || null;
    emitRoom(room);
    io.to(room.id).emit('pvp_game_over', {
      winnerId: room.winnerId,
      winnerName: alive[0]?.name || '无人',
      players: room.players.map((player) => publicPlayer(player, room))
    });
  }
}

function snapshot(room, now) {
  return {
    roomId: room.id,
    status: room.status,
    world: WORLD,
    tanks: [...room.tanks.values()].map((tank) => ({
      id: tank.id,
      name: tank.name,
      color: tank.color,
      shape: tank.shape,
      x: tank.x,
      y: tank.y,
      facing: tank.facing,
      hp: Math.max(0, tank.hp),
      alive: tank.alive,
      invulnerable: tank.invulnerableUntil > now,
      frozen: tank.frozenUntil > now,
      effects: Object.fromEntries(Object.entries(tank.effects).filter(([, until]) => until > now))
    })),
    bullets: room.bullets,
    powerups: room.powerups.map((powerup) => ({
      id: powerup.id,
      type: powerup.type,
      name: powerup.name,
      icon: powerup.icon,
      x: powerup.x,
      y: powerup.y,
      remaining: powerup.expiresAt - now
    })),
    explosions: room.explosions.filter((item) => now - item.t < 0.7).map((item) => ({
      x: item.x,
      y: item.y,
      type: item.type,
      age: now - item.t
    }))
  };
}

function tickRoom(room, dt, now) {
  if (room.status !== 'playing') return;
  updateTanks(room, dt, now);
  updateBullets(room, dt, now);
  spawnPowerup(room, now);
  updatePowerups(room, now);
  room.explosions = room.explosions.filter((item) => now - item.t < 0.7);
  maybeFinish(room);
}

function removePlayer(socket, silent = false) {
  const id = socketToRoom.get(socket.id);
  if (!id) return;
  const room = rooms.get(id);
  socketToRoom.delete(socket.id);
  socket.leave(id);
  if (!room) return;

  room.players = room.players.filter((player) => player.id !== socket.id);
  room.inputs.delete(socket.id);
  room.tanks.delete(socket.id);

  if (room.players.length === 0) {
    rooms.delete(id);
    return;
  }
  if (room.hostId === socket.id) room.hostId = room.players[0].id;
  if (room.status === 'playing' && room.players.length < 2) {
    room.status = 'game_over';
    room.winnerId = room.players[0]?.id || null;
    io.to(room.id).emit('pvp_game_over', {
      winnerId: room.winnerId,
      winnerName: room.players[0]?.name || '无人',
      players: room.players.map((player) => publicPlayer(player, room)),
      reason: '对手离开了房间。'
    });
  }
  if (!silent) io.to(room.id).emit('room_notice', { message: '有玩家离开房间。' });
  emitRoom(room);
}

function normalizePveState(state) {
  const list = (value, limit) => Array.isArray(value) ? value.slice(0, limit) : [];
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const tank = (value, enemy = false) => ({
    id: String(value?.id || ''),
    name: cleanName(value?.name),
    color: String(value?.color || '#888888').slice(0, 20),
    x: number(value?.x),
    y: number(value?.y),
    facing: ['up', 'down', 'left', 'right'].includes(value?.facing) ? value.facing : 'up',
    hp: number(value?.hp),
    alive: Boolean(value?.alive),
    ...(enemy ? { type: value?.type || null } : { kills: number(value?.kills), score: number(value?.score) }),
    hidden: Boolean(value?.hidden)
  });
  return {
    gameOver: Boolean(state?.gameOver),
    level: Math.max(1, number(state?.level, 1)),
    score: number(state?.score),
    baseAlive: Boolean(state?.baseAlive),
    players: list(state?.players, 2).map((value) => tank(value)),
    enemies: list(state?.enemies, 40).map((value) => tank(value, true)),
    bullets: list(state?.bullets, 300).map((value) => ({
      ownerId: String(value?.ownerId || ''),
      x: number(value?.x), y: number(value?.y), dx: number(value?.dx), dy: number(value?.dy)
    })),
    items: list(state?.items, 30).map((value) => ({
      type: String(value?.type || ''), x: number(value?.x), y: number(value?.y), remaining: Math.max(0, number(value?.remaining))
    })),
    explosions: list(state?.explosions, 100).map((value) => ({
      x: number(value?.x), y: number(value?.y), type: String(value?.type || ''), age: Math.max(0, number(value?.age))
    })),
    killed: number(state?.killed),
    levelKilled: number(state?.levelKilled),
    totalEnemies: number(state?.totalEnemies),
    playerCount: Math.max(1, Math.min(2, number(state?.playerCount, 1))),
    // The protocol's renderer extension: guests need the authoritative map layout.
    grid: Array.isArray(state?.grid) ? state.grid.slice(0, 15).map((row) => Array.isArray(row) ? row.slice(0, 15) : []) : [],
    base: state?.base && typeof state.base === 'object'
      ? { x: number(state.base.x, 7), y: number(state.base.y, 13), alive: Boolean(state.base.alive) }
      : { x: 7, y: 13, alive: Boolean(state?.baseAlive) }
  };
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ playerName, powerupsEnabled } = {}) => createRoom(socket, playerName, powerupsEnabled));
  socket.on('join_room', ({ roomId: id, playerName } = {}) => joinRoom(socket, id, playerName));
  socket.on('start_pvp', () => startGame(socket));
  socket.on('leave_room', () => removePlayer(socket));
  socket.on('set_room_options', ({ powerupsEnabled } = {}) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || !room.players.some((player) => player.id === socket.id) || room.status !== 'waiting') return;
    room.powerupsEnabled = Boolean(powerupsEnabled);
    emitRoom(room);
  });
  socket.on('player_input', ({ keys } = {}) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room) return;
    room.inputs.set(socket.id, {
      up: Boolean(keys?.up),
      down: Boolean(keys?.down),
      left: Boolean(keys?.left),
      right: Boolean(keys?.right),
      shoot: Boolean(keys?.shoot)
    });
  });
  socket.on('check_room', ({ roomId } = {}, acknowledge) => {
    const result = checkRoom(roomId);
    console.info(`[room] check ${result.roomId || '<empty>'}: ${result.type || 'not-found'}`);
    if (typeof acknowledge === 'function') acknowledge(result);
    else socket.emit('room_checked', result);
  });
  socket.on('create_pve_room', ({ playerName } = {}, acknowledge) => {
    console.info(`[pve] create requested by ${socket.id}`);
    try {
      const id = createPveRoom(socket, playerName);
      console.info(`[pve] room ${id} created by ${socket.id}`);
      if (typeof acknowledge === 'function') acknowledge({ ok: true, roomId: id });
    } catch (error) {
      console.error(`[pve] create failed for ${socket.id}`, error);
      const message = 'PVE 房间创建失败，请稍后重试。';
      socket.emit('pve_room_error', { message });
      if (typeof acknowledge === 'function') acknowledge({ ok: false, message });
    }
  });
  socket.on('join_pve_room', ({ roomId: id, playerName } = {}) => joinPveRoom(socket, id, playerName));
  socket.on('leave_pve_room', () => removePvePlayer(socket));
  socket.on('start_pve_game', () => {
    const room = pveRooms.get(socketToPveRoom.get(socket.id));
    if (!room || room.hostId !== socket.id || room.status !== 'waiting') return;
    room.status = 'playing';
    emitPveRoom(room);
    io.to(`pve:${room.id}`).emit('pve_game_started', { playerCount: room.players.length });
  });
  socket.on('pve_input', ({ keys } = {}) => {
    const room = pveRooms.get(socketToPveRoom.get(socket.id));
    if (!room || room.status !== 'playing' || room.hostId === socket.id) return;
    io.to(room.hostId).emit('pve_input', {
      playerId: socket.id,
      keys: {
        up: Boolean(keys?.up),
        down: Boolean(keys?.down),
        left: Boolean(keys?.left),
        right: Boolean(keys?.right),
        shoot: Boolean(keys?.shoot)
      }
    });
  });
  socket.on('pve_state', (state = {}) => {
    const room = pveRooms.get(socketToPveRoom.get(socket.id));
    if (!room || room.status !== 'playing' || room.hostId !== socket.id) return;
    const snapshot = normalizePveState(state);
    socket.to(`pve:${room.id}`).emit('pve_state', snapshot);
    if (snapshot.gameOver) {
      room.status = 'waiting';
      emitPveRoom(room);
    }
  });
  socket.on('disconnect', () => {
    removePlayer(socket, true);
    removePvePlayer(socket, true);
  });
});

let lastTick = Date.now();
setInterval(() => {
  const nowMs = Date.now();
  const dt = Math.min(0.05, (nowMs - lastTick) / 1000);
  lastTick = nowMs;
  const now = nowMs / 1000;
  for (const room of rooms.values()) tickRoom(room, dt, now);
}, 1000 / LOGIC_HZ);

setInterval(() => {
  const now = Date.now() / 1000;
  for (const room of rooms.values()) {
    if (room.status === 'playing' || room.status === 'game_over') {
      io.to(room.id).emit('pvp_state', snapshot(room, now));
    }
  }
}, 1000 / BROADCAST_HZ);

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

server.listen(PORT, () => {
  console.log(`坦克大战服务器已启动，端口 ${PORT}`);
});
