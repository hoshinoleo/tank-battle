const $ = (id) => document.getElementById(id);
const socket = io();
const WORLD = 720;
const GRID = 15;
const TILE = WORLD / GRID;
const TANK = 34;
const HALF = TANK / 2;
const keys = new Set();
const pvpCanvas = $('pvpCanvas');
const pveCanvas = $('pveCanvas');
const pvpCtx = pvpCanvas.getContext('2d');
const pveCtx = pveCanvas.getContext('2d');

const powerups = [
  { type: 'speed', name: '坦克加速', icon: '闪', desc: '移动速度提升 1.5 倍，持续 8 秒。' },
  { type: 'bulletSpeed', name: '子弹加速', icon: '箭', desc: '子弹速度翻倍，持续 8 秒。' },
  { type: 'triple', name: '子弹连发', icon: '枪', desc: '一次连续发射 3 发子弹，持续 8 秒。' },
  { type: 'pierce', name: '穿甲弹', icon: '爆', desc: '子弹可以打穿钢铁，持续 10 秒。' },
  { type: 'freeze', name: '暂停敌人', icon: '停', desc: '除自己外所有敌方坦克暂停行动 3 秒。' },
  { type: 'life', name: '加一条命', icon: '心', desc: '立即增加 1 点生命。' },
  { type: 'shield', name: '无敌', icon: '星', desc: '5 秒内不受任何伤害。' },
  { type: 'score', name: '增加积分', icon: '分', desc: 'PVE 专用，立即增加 500 分。' },
  { type: 'steelBase', name: '钢板强化', icon: '钢', desc: '老家周围砖块变成钢铁。' },
  { type: 'doubleBase', name: '加层保护', icon: '堡', desc: '老家外侧增加一圈砖块保护。' }
];

const enemyTypes = [
  { level: 1, name: '普通兵', color: '#52a36a', hp: 1, score: 500, water: false, pierce: false, speed: 94 },
  { level: 2, name: '水兵', color: '#447bd4', hp: 1, score: 1000, water: true, pierce: false, speed: 105 },
  { level: 3, name: '钢兵', color: '#8d65cc', hp: 1, score: 1500, water: true, pierce: true, speed: 112 },
  { level: 4, name: '精英', color: '#d84a42', hp: 2, score: 2000, water: true, pierce: true, speed: 122 }
];

const pveLevelConfigs = [
  [8, 2, 0, 0],
  [6, 4, 0, 0],
  [5, 5, 0, 0],
  [3, 5, 2, 0],
  [2, 4, 4, 0],
  [1, 3, 4, 2],
  [0, 2, 4, 4]
];

let view = 'lobby';
let pvpState = { status: 'idle', tanks: [], bullets: [], powerups: [], explosions: [] };
let pvpPlayers = [];
let pve = null;
let lastFrame = performance.now();
let lastInputSent = 0;
let modalAction = null;

function showView(next) {
  view = next;
  $('lobbyView').classList.toggle('hidden', next !== 'lobby');
  $('pvpView').classList.toggle('hidden', next !== 'pvp');
  $('pveView').classList.toggle('hidden', next !== 'pve');
  $('returnLobbyTop').classList.toggle('hidden', next === 'lobby');
  $('topStatus').textContent = next === 'lobby' ? '请选择模式' : next === 'pvp' ? 'PVP 在线对战' : 'PVE 人机对战';
}

function playerName() {
  return $('playerName').value.trim().slice(0, 18) || '玩家';
}

function showError(message) {
  $('lobbyError').textContent = message;
  showModal('提示', `<p>${message}</p>`, false);
}

function showModal(title, html, again = false, action = null) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  $('modalAgain').classList.toggle('hidden', !again);
  $('modal').classList.remove('hidden');
  modalAction = action;
}

function hideModal() {
  $('modal').classList.add('hidden');
}

function pvpKeys() {
  return {
    up: keys.has('KeyW') || keys.has('ArrowUp'),
    down: keys.has('KeyS') || keys.has('ArrowDown'),
    left: keys.has('KeyA') || keys.has('ArrowLeft'),
    right: keys.has('KeyD') || keys.has('ArrowRight'),
    shoot: keys.has('Space') || keys.has('Enter')
  };
}

window.addEventListener('keydown', (event) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'].includes(event.code)) {
    event.preventDefault();
    keys.add(event.code);
  }
});
window.addEventListener('keyup', (event) => keys.delete(event.code));

$('openPvp').addEventListener('click', () => showView('pvp'));
$('openPve').addEventListener('click', () => showView('pve'));
$('returnLobbyTop').addEventListener('click', returnLobby);
$('leaveRoom').addEventListener('click', returnLobby);
$('leavePve').addEventListener('click', returnLobby);
$('modalClose').addEventListener('click', hideModal);
$('modalLobby').addEventListener('click', () => { hideModal(); returnLobby(); });
$('modalAgain').addEventListener('click', () => {
  hideModal();
  if (modalAction) modalAction();
});
$('createRoom').addEventListener('click', () => {
  socket.emit('create_room', { playerName: playerName(), powerupsEnabled: $('pvpPowerups').checked });
});
$('joinRoom').addEventListener('click', () => joinPvp($('joinRoomId').value));
$('quickJoin').addEventListener('click', () => { showView('pvp'); joinPvp($('quickRoomId').value); });
$('startPvp').addEventListener('click', () => socket.emit('start_pvp'));
$('pvpPowerups').addEventListener('change', () => socket.emit('set_room_options', { powerupsEnabled: $('pvpPowerups').checked }));
$('startPve').addEventListener('click', () => startPve($('pveTwoPlayers').checked ? 2 : 1));
$('powerupBook').addEventListener('click', () => {
  showModal('道具图鉴', `<div class="book-grid">${powerups.map((item) => `<div><b>${item.icon} ${item.name}</b><span>${item.desc}</span></div>`).join('')}</div>`);
});

function joinPvp(id) {
  const roomId = String(id || '').trim();
  if (!/^\d{6}$/.test(roomId)) {
    showError('房间号格式错误，请输入 6 位数字。');
    return;
  }
  socket.emit('join_room', { roomId, playerName: playerName() });
}

function returnLobby() {
  if (view === 'pvp') socket.emit('leave_room');
  pve = null;
  pvpState = { status: 'idle', tanks: [], bullets: [], powerups: [], explosions: [] };
  $('roomIdLabel').textContent = '------';
  $('pvpPlayers').innerHTML = '';
  $('pvpOverlay').classList.remove('hidden');
  $('pvpOverlay').innerHTML = '<h2>PVP 房间</h2><p>创建房间或输入房间号加入。房主手动开始，至少 2 人，最多 4 人。</p>';
  showView('lobby');
}

socket.on('room_created', ({ roomId }) => {
  $('roomIdLabel').textContent = roomId;
  $('pvpOverlay').classList.remove('hidden');
  $('pvpOverlay').innerHTML = `<h2>房间已创建</h2><p>房间号：${roomId}。等待玩家加入后由房主点击开始游戏。</p>`;
});
socket.on('room_state', (state) => {
  pvpPlayers = state.players || [];
  $('roomIdLabel').textContent = state.roomId || '------';
  $('pvpPowerups').checked = Boolean(state.powerupsEnabled);
  renderPvpPlayers();
});
socket.on('room_error', ({ message }) => showError(message));
socket.on('room_notice', ({ message }) => $('topStatus').textContent = message);
socket.on('pvp_started', () => {
  $('pvpOverlay').classList.add('hidden');
  $('topStatus').textContent = 'PVP 对战中';
});
socket.on('pvp_state', (state) => { pvpState = state; });
socket.on('spectator_mode', ({ message }) => showModal('观战模式', `<p>${message}</p>`));
socket.on('pvp_game_over', ({ winnerName, reason, players }) => {
  if (players) pvpPlayers = players;
  renderPvpPlayers();
  showModal('游戏结束', `<p>${reason || `${winnerName} 获得胜利。`}</p>`, true, () => socket.emit('start_pvp'));
  $('pvpOverlay').classList.remove('hidden');
  $('pvpOverlay').innerHTML = `<h2>游戏结束</h2><p>${reason || `${winnerName} 获得胜利。`}</p>`;
});

function renderPvpPlayers() {
  $('pvpPlayers').innerHTML = pvpPlayers.map((player) => `
    <div class="player-row">
      <span class="color-dot" style="background:${player.color}"></span>
      <strong>${player.name}${player.host ? '（房主）' : ''}</strong>
      <span>血量 ${'♥'.repeat(Math.max(0, player.hp || 0)) || '观战'} · 击杀 ${player.kills || 0}</span>
    </div>
  `).join('');
}

function startPve(count) {
  const grid = generateMap();
  const base = { x: 7, y: 13, alive: true };
  pve = {
    grid,
    players: [
      makeTank('p1', '玩家1', '#d94f45', 5 * TILE + TILE / 2, 13 * TILE + TILE / 2, 'up', false),
      ...(count === 2 ? [makeTank('p2', '玩家2', '#4488d9', 9 * TILE + TILE / 2, 13 * TILE + TILE / 2, 'up', false)] : [])
    ],
    enemies: [],
    bullets: [],
    items: [],
    explosions: [],
    base,
    playerCount: count,
    level: 1,
    score: 0,
    killed: 0,
    levelKilled: 0,
    totalEnemies: count === 2 ? 15 : 10,
    enemyQueue: createLevelEnemyQueue(1, count === 2 ? 15 : 10),
    spawned: 0,
    lastSpawn: 0,
    lastPowerup: 0,
    over: false,
    result: '',
    levelTransition: null
  };
  protectBase('brick');
  $('pveOverlay').classList.add('hidden');
  updatePveHud();
}

function levelWeights(level) {
  if (level <= pveLevelConfigs.length) return pveLevelConfigs[level - 1];
  const extra = level - 8;
  const eliteShare = Math.min(0.48, 0.3 + extra * 0.02);
  const levelThreeShare = Math.min(0.4, 0.35 + extra * 0.01);
  const levelTwoShare = Math.max(0.1, 0.25 - extra * 0.015);
  const levelOneShare = Math.max(0.02, 1 - eliteShare - levelThreeShare - levelTwoShare);
  return [levelOneShare, levelTwoShare, levelThreeShare, eliteShare];
}

function scaleEnemyCounts(weights, total) {
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const exact = weights.map((value) => (value / weightTotal) * total);
  const counts = exact.map(Math.floor);
  let remaining = total - counts.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - counts[index] }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; index < remaining; index += 1) counts[order[index].index] += 1;
  return counts;
}

function createLevelEnemyQueue(level, total) {
  const counts = scaleEnemyCounts(levelWeights(level), total);
  const queue = counts.flatMap((count, typeIndex) => Array(count).fill(typeIndex));
  for (let index = queue.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [queue[index], queue[swapIndex]] = [queue[swapIndex], queue[index]];
  }
  return queue;
}

function beginNextPveLevel(now) {
  pve.level += 1;
  pve.grid = generateMap();
  pve.base.alive = true;
  pve.enemies = [];
  pve.bullets = [];
  pve.items = [];
  pve.spawned = 0;
  pve.levelKilled = 0;
  pve.lastSpawn = now;
  pve.lastPowerup = now;
  pve.enemyQueue = createLevelEnemyQueue(pve.level, pve.totalEnemies);
  pve.levelTransition = null;
  protectBase('brick');
  for (const player of pve.players) {
    const tx = Math.floor(player.x / TILE);
    const ty = Math.floor(player.y / TILE);
    if (pve.grid[ty]?.[tx] !== 'base') pve.grid[ty][tx] = 'empty';
  }
  $('pveOverlay').classList.add('hidden');
  console.log(`[功能一] 已进入 PVE 第 ${pve.level} 关`);
}

function completePveLevel(now) {
  if (pve.levelTransition) return;
  pve.levelTransition = { endsAt: now + 1.5 };
  $('pveOverlay').classList.remove('hidden');
  $('pveOverlay').innerHTML = `<h2>第 ${pve.level} 关通关！</h2><p>即将进入下一关。</p>`;
}

function makeTank(id, name, color, x, y, facing, enemy, type = null) {
  return {
    id, name, color, x, y, facing, enemy, type,
    hp: type?.hp || 1,
    alive: true,
    lastShot: -99,
    effects: {},
    frozenUntil: 0,
    aiTimer: 0,
    hidden: false
  };
}

function generateMap() {
  const grid = Array.from({ length: GRID }, () => Array(GRID).fill('empty'));
  for (let y = 1; y < GRID - 2; y += 1) {
    for (let x = 1; x < GRID - 1; x += 1) {
      const reserved = (y < 2 && (x < 2 || x > 12 || x === 7)) || (y > 11 && x >= 5 && x <= 9);
      if (reserved || Math.random() > 0.28) continue;
      const roll = Math.random();
      grid[y][x] = roll < 0.45 ? 'brick' : roll < 0.62 ? 'steel' : roll < 0.8 ? 'bush' : 'water';
    }
  }
  grid[13][7] = 'base';
  return grid;
}

function protectBase(kind) {
  if (!pve) return;
  const set = (x, y, tile) => {
    if (x >= 0 && y >= 0 && x < GRID && y < GRID && pve.grid[y][x] !== 'base') pve.grid[y][x] = tile;
  };
  const tile = kind === 'steel' ? 'steel' : 'brick';
  for (let y = 12; y <= 14; y += 1) {
    for (let x = 6; x <= 8; x += 1) {
      if (!(x === 7 && y === 13)) set(x, y, tile);
    }
  }
  if (kind === 'double') {
    for (let y = 11; y <= 14; y += 1) {
      for (let x = 5; x <= 9; x += 1) {
        if (x === 7 && y === 13) continue;
        if (y === 11 || x === 5 || x === 9) set(x, y, 'brick');
      }
    }
  }
}

function tileAt(x, y) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (!pve || tx < 0 || ty < 0 || tx >= GRID || ty >= GRID) return 'steel';
  return pve.grid[ty][tx];
}

function solidFor(tank, tile) {
  if (tile === 'empty' || tile === 'bush') return false;
  if (tile === 'water') return !(tank.enemy && tank.type?.water);
  return tile !== 'base';
}

function rectBlocked(tank, x, y) {
  const points = [
    [x - HALF, y - HALF], [x + HALF - 1, y - HALF],
    [x - HALF, y + HALF - 1], [x + HALF - 1, y + HALF - 1]
  ];
  if (x < HALF || y < HALF || x > WORLD - HALF || y > WORLD - HALF) return true;
  return points.some(([px, py]) => solidFor(tank, tileAt(px, py)));
}

function facingVector(facing) {
  if (facing === 'up') return { dx: 0, dy: -1 };
  if (facing === 'down') return { dx: 0, dy: 1 };
  if (facing === 'left') return { dx: -1, dy: 0 };
  return { dx: 1, dy: 0 };
}

function effectActive(tank, type, now) {
  return (tank.effects[type] || 0) > now;
}

function moveTank(tank, mx, my, dt, now) {
  if (!tank.alive || tank.frozenUntil > now) return;
  if (mx || my) {
    if (Math.abs(mx) > Math.abs(my)) tank.facing = mx > 0 ? 'right' : 'left';
    if (Math.abs(my) >= Math.abs(mx)) tank.facing = my > 0 ? 'down' : 'up';
    const len = Math.hypot(mx, my) || 1;
    const base = tank.enemy ? tank.type.speed : 150;
    const speed = base * (effectActive(tank, 'speed', now) ? 1.5 : 1);
    const nx = tank.x + (mx / len) * speed * dt;
    const ny = tank.y + (my / len) * speed * dt;
    if (!rectBlocked(tank, nx, tank.y)) tank.x = nx;
    if (!rectBlocked(tank, tank.x, ny)) tank.y = ny;
  }
  tank.hidden = tileAt(tank.x, tank.y) === 'bush';
}

function tankShoot(tank, now) {
  const cd = effectActive(tank, 'triple', now) ? 0.45 : tank.enemy ? 1.1 : 0.55;
  if (!tank.alive || now - tank.lastShot < cd) return;
  tank.lastShot = now;
  const vector = facingVector(tank.facing);
  const spread = effectActive(tank, 'triple', now) ? [-7, 0, 7] : [0];
  for (const offset of spread) {
    pve.bullets.push({
      ownerId: tank.id,
      enemy: tank.enemy,
      x: tank.x + vector.dx * 25 + (vector.dy ? offset : 0),
      y: tank.y + vector.dy * 25 + (vector.dx ? offset : 0),
      dx: vector.dx,
      dy: vector.dy,
      speed: effectActive(tank, 'bulletSpeed', now) ? 740 : 390,
      pierce: tank.type?.pierce || effectActive(tank, 'pierce', now),
      age: 0
    });
  }
}

function spawnEnemy(now) {
  if (!pve || pve.spawned >= pve.totalEnemies || now - pve.lastSpawn < 1.5 || pve.enemies.filter((e) => e.alive).length >= 5) return;
  pve.lastSpawn = now;
  pve.spawned += 1;
  const type = enemyTypes[pve.enemyQueue[pve.spawned - 1] ?? 0];
  const spots = [{ x: TILE / 2, y: TILE / 2 }, { x: 7 * TILE + TILE / 2, y: TILE / 2 }, { x: 14 * TILE + TILE / 2, y: TILE / 2 }];
  const spot = spots[Math.floor(Math.random() * spots.length)];
  pve.enemies.push(makeTank(`e${pve.spawned}`, type.name, type.color, spot.x, spot.y, 'down', true, { ...type }));
}

function updateEnemyAI(enemy, dt, now) {
  enemy.aiTimer -= dt;
  if (enemy.aiTimer <= 0) {
    enemy.aiTimer = 0.55 + Math.random() * 0.7;
    const target = pve.players.find((player) => player.alive && !player.hidden);
    if (target) {
      const horizontal = Math.abs(target.x - enemy.x) > Math.abs(target.y - enemy.y);
      enemy.intent = horizontal ? { mx: Math.sign(target.x - enemy.x), my: 0 } : { mx: 0, my: Math.sign(target.y - enemy.y) };
    }
    if (!target || Math.random() < 0.28) enemy.intent = [{ mx: 1, my: 0 }, { mx: -1, my: 0 }, { mx: 0, my: 1 }, { mx: 0, my: -1 }][Math.floor(Math.random() * 4)];
  }
  moveTank(enemy, enemy.intent?.mx || 0, enemy.intent?.my || 0, dt, now);
  if (Math.random() < 0.025 || Math.abs(enemy.x - (7 * TILE + TILE / 2)) < 30) tankShoot(enemy, now);
}

function updatePve(dt, now) {
  if (!pve || pve.over) return;
  if (pve.levelTransition) {
    if (now >= pve.levelTransition.endsAt) beginNextPveLevel(now);
    updatePveHud();
    return;
  }
  const p1 = pve.players[0];
  moveTank(p1, (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0), dt, now);
  if (keys.has('Space')) tankShoot(p1, now);
  const p2 = pve.players[1];
  if (p2) {
    moveTank(p2, (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0), (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0), dt, now);
    if (keys.has('Enter')) tankShoot(p2, now);
  }
  spawnEnemy(now);
  for (const enemy of pve.enemies) if (enemy.alive) updateEnemyAI(enemy, dt, now);
  updatePveBullets(dt, now);
  updatePvePowerups(now);
  maybeSpawnPvePowerup(now);
  pve.explosions = pve.explosions.filter((item) => now - item.t < 0.7);
  if (!pve.base.alive) endPve('游戏结束', `老家被打爆了 — 到达第 ${pve.level} 关。`);
  else if (pve.players.every((player) => !player.alive)) endPve('游戏结束', `所有玩家都被击败了 — 到达第 ${pve.level} 关。`);
  else if (pve.levelKilled >= pve.totalEnemies) completePveLevel(now);
  updatePveHud();
}

function updatePveBullets(dt, now) {
  const next = [];
  for (const bullet of pve.bullets) {
    bullet.age += dt;
    bullet.x += bullet.dx * bullet.speed * dt;
    bullet.y += bullet.dy * bullet.speed * dt;
    if (bullet.age > 4 || bullet.x < 0 || bullet.y < 0 || bullet.x > WORLD || bullet.y > WORLD) continue;
    const tx = Math.floor(bullet.x / TILE);
    const ty = Math.floor(bullet.y / TILE);
    const tile = pve.grid[ty]?.[tx] || 'steel';
    if (tile === 'base') {
      pve.base.alive = false;
      continue;
    }
    if (tile === 'brick' || tile === 'steel') {
      if (tile === 'brick' || bullet.pierce) pve.grid[ty][tx] = 'empty';
      if (!bullet.pierce) continue;
    }
    const targets = bullet.enemy ? pve.players : pve.enemies;
    let removed = false;
    for (const tank of targets) {
      if (tank.alive && Math.abs(bullet.x - tank.x) < HALF && Math.abs(bullet.y - tank.y) < HALF) {
        damagePveTank(tank, bullet, now);
        removed = !bullet.pierce;
        break;
      }
    }
    if (!removed) next.push(bullet);
  }
  pve.bullets = next;
}

function damagePveTank(tank, bullet, now) {
  if (!tank.enemy && effectActive(tank, 'shield', now)) return;
  tank.hp -= 1;
  pve.explosions.push({ x: tank.x, y: tank.y, t: now, type: 'hit' });
  if (tank.hp > 0) return;
  if (tank.enemy && tank.type.level === 4) {
    tank.type = { ...enemyTypes[0] };
    tank.name = tank.type.name;
    tank.color = tank.type.color;
    tank.hp = 1;
    return;
  }
  tank.alive = false;
  pve.explosions.push({ x: tank.x, y: tank.y, t: now, type: 'boom' });
  if (tank.enemy) {
    pve.killed += 1;
    pve.levelKilled += 1;
    pve.score += tank.type.score;
  }
}

function maybeSpawnPvePowerup(now) {
  if (now - pve.lastPowerup < 7) return;
  pve.lastPowerup = now;
  const list = powerups.filter((item) => true);
  const item = list[Math.floor(Math.random() * list.length)];
  pve.items.push({ ...item, x: 80 + Math.random() * 560, y: 80 + Math.random() * 500, bornAt: now, expiresAt: now + 10 });
}

function updatePvePowerups(now) {
  const next = [];
  for (const item of pve.items) {
    if (now >= item.expiresAt) continue;
    let taken = false;
    for (const player of pve.players) {
      if (player.alive && Math.hypot(player.x - item.x, player.y - item.y) < 30) {
        applyPvePowerup(player, item, now);
        taken = true;
      }
    }
    if (!taken) next.push(item);
  }
  pve.items = next;
}

function applyPvePowerup(player, item, now) {
  if (item.type === 'life') player.hp += 1;
  else if (item.type === 'score') pve.score += 500;
  else if (item.type === 'steelBase') protectBase('steel');
  else if (item.type === 'doubleBase') protectBase('double');
  else if (item.type === 'freeze') pve.enemies.forEach((enemy) => { enemy.frozenUntil = now + 3; });
  else if (item.type === 'shield') player.effects.shield = now + 5;
  else player.effects[item.type] = now + (item.type === 'pierce' ? 10 : 8);
}

function endPve(result, text) {
  if (!pve || pve.over) return;
  pve.over = true;
  pve.result = result;
  $('pveOverlay').classList.remove('hidden');
  $('pveOverlay').innerHTML = `<h2>${result}</h2><p>${text}</p>`;
  showModal(`PVE ${result}`, `<p>${text}</p><p>最终积分：${pve.score}</p>`, true, () => startPve($('pveTwoPlayers').checked ? 2 : 1));
}

function updatePveHud() {
  if (!pve) return;
  $('pveScore').textContent = `第 ${pve.level} 关 · 总积分：${pve.score}`;
  $('pveStats').innerHTML = `
    <div>本关敌人：${pve.levelKilled}/${pve.totalEnemies}</div>
    <div>场上敌人：${pve.enemies.filter((e) => e.alive).length}</div>
    <div>玩家血量：${pve.players.map((p) => `${p.name} ${'♥'.repeat(Math.max(0, p.hp)) || '阵亡'}`).join('　')}</div>
    <div>地图：随机基地防守</div>
  `;
}

function drawGround(ctx) {
  ctx.fillStyle = '#262a22';
  ctx.fillRect(0, 0, WORLD, WORLD);
  ctx.strokeStyle = 'rgba(255,255,255,.035)';
  for (let i = 0; i <= WORLD; i += TILE) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, WORLD);
    ctx.moveTo(0, i);
    ctx.lineTo(WORLD, i);
    ctx.stroke();
  }
}

function drawTank(ctx, tank, local = false, visibilityAlpha = 1) {
  if (!tank.alive) return;
  ctx.save();
  ctx.translate(tank.x, tank.y);
  ctx.globalAlpha = visibilityAlpha * (tank.invulnerable || effectActive(tank, 'shield', performance.now() / 1000) ? 0.68 : 1);
  ctx.fillStyle = tank.color;
  ctx.strokeStyle = local ? '#ffffff' : '#171914';
  ctx.lineWidth = local ? 3 : 2;
  ctx.fillRect(-17, -17, 34, 34);
  ctx.strokeRect(-17, -17, 34, 34);
  ctx.fillStyle = '#111';
  ctx.fillRect(-20, -14, 7, 28);
  ctx.fillRect(13, -14, 7, 28);
  ctx.rotate({ up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 }[tank.facing] || 0);
  ctx.fillStyle = '#20251d';
  ctx.fillRect(0, -5, 26, 10);
  ctx.restore();
  if (tank.name) {
    ctx.save();
    ctx.globalAlpha = visibilityAlpha;
    ctx.fillStyle = '#f4ecd0';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(tank.name, tank.x, tank.y - 25);
    ctx.restore();
  }
}

function drawBullets(ctx, bullets) {
  ctx.fillStyle = '#ffd36a';
  for (const bullet of bullets) {
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPowerups(ctx, items) {
  for (const item of items) {
    const blink = item.remaining !== undefined && item.remaining < 3 && Math.floor(performance.now() / 130) % 2 === 0;
    if (blink) continue;
    ctx.fillStyle = '#f8d763';
    ctx.strokeStyle = '#2c2410';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(item.x - 16, item.y - 16, 32, 32, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#2c2410';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.icon, item.x, item.y + 1);
  }
}

function drawExplosions(ctx, explosions) {
  for (const item of explosions) {
    const radius = 12 + item.age * 38;
    ctx.strokeStyle = `rgba(255,${120 - item.age * 80},50,${1 - item.age})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(item.x, item.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawPvp() {
  drawGround(pvpCtx);
  drawPowerups(pvpCtx, pvpState.powerups || []);
  for (const tank of pvpState.tanks || []) drawTank(pvpCtx, tank, tank.id === socket.id);
  drawBullets(pvpCtx, pvpState.bullets || []);
  drawExplosions(pvpCtx, pvpState.explosions || []);
}

function drawPve() {
  drawGround(pveCtx);
  if (!pve) return;
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const tile = pve.grid[y][x];
      if (tile === 'empty' || tile === 'bush') continue;
      const px = x * TILE;
      const py = y * TILE;
      if (tile === 'brick') pveCtx.fillStyle = '#8f5c34';
      if (tile === 'steel') pveCtx.fillStyle = '#a8acaa';
      if (tile === 'water') pveCtx.fillStyle = '#276f9f';
      if (tile === 'base') pveCtx.fillStyle = pve.base.alive ? '#d9c66b' : '#58302c';
      pveCtx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
      if (tile === 'base') {
        pveCtx.fillStyle = '#2d2514';
        pveCtx.font = '26px sans-serif';
        pveCtx.textAlign = 'center';
        pveCtx.fillText('旗', px + TILE / 2, py + 32);
      }
    }
  }
  drawPowerups(pveCtx, pve.items.map((item) => ({ ...item, remaining: item.expiresAt - performance.now() / 1000 })));
  for (const tank of pve.players) drawTank(pveCtx, tank, true, tank.hidden ? 0.3 : 1);
  for (const tank of pve.enemies) if (!tank.hidden) drawTank(pveCtx, tank, false);
  drawBullets(pveCtx, pve.bullets);
  drawExplosions(pveCtx, pve.explosions);
  pveCtx.save();
  pveCtx.globalAlpha = 0.78;
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      if (pve.grid[y][x] !== 'bush') continue;
      pveCtx.fillStyle = '#477842';
      pveCtx.fillRect(x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4);
    }
  }
  pveCtx.restore();
}

function frame(nowMs) {
  const dt = Math.min(0.05, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;
  const now = nowMs / 1000;
  if (view === 'pvp' && nowMs - lastInputSent > 33) {
    socket.emit('player_input', { keys: pvpKeys() });
    lastInputSent = nowMs;
  }
  updatePve(dt, now);
  drawPvp();
  drawPve();
  requestAnimationFrame(frame);
}

showView('lobby');
drawPvp();
drawPve();
requestAnimationFrame(frame);

console.log('[功能一] PVE 关卡制已加载：8 关起动态提升难度。');
console.log('[功能二] 草丛隐身与顶层遮挡渲染已加载。');
