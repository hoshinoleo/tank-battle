import { Network } from './network.js';
import { Renderer } from './renderer.js';
import { Tank } from './tank.js';
import { UI } from './ui.js';

const canvas = document.getElementById('gameCanvas');
const network = new Network();
const renderer = new Renderer(canvas);
const ui = new UI(network);
const keys = { up: false, down: false, left: false, right: false, shoot: false };
const tankCache = new Map();
let state = { tanks: [], bullets: [], explosions: [], map: null, status: 'idle' };
let lastFrame = performance.now();
let lastInputSent = 0;
let audioContext = null;
let localSlot = null;

function clearKeys() {
  for (const key of Object.keys(keys)) keys[key] = false;
}

function keyToInput(event, pressed) {
  const code = event.code;
  let handled = true;
  const useP1 = localSlot === 1 || localSlot === null;
  const useP2 = localSlot === 2 || localSlot === null;
  if (useP1 && code === 'KeyW') keys.up = pressed;
  else if (useP1 && code === 'KeyS') keys.down = pressed;
  else if (useP1 && code === 'KeyA') keys.left = pressed;
  else if (useP1 && code === 'KeyD') keys.right = pressed;
  else if (useP1 && code === 'Space') keys.shoot = pressed;
  else if (useP2 && code === 'ArrowUp') keys.up = pressed;
  else if (useP2 && code === 'ArrowDown') keys.down = pressed;
  else if (useP2 && code === 'ArrowLeft') keys.left = pressed;
  else if (useP2 && code === 'ArrowRight') keys.right = pressed;
  else if (useP2 && code === 'Enter') keys.shoot = pressed;
  else handled = false;
  if (handled) event.preventDefault();
}

window.addEventListener('keydown', (event) => {
  unlockAudio();
  keyToInput(event, true);
});
window.addEventListener('keyup', (event) => keyToInput(event, false));
window.addEventListener('pointerdown', unlockAudio, { once: true });

function unlockAudio() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === 'suspended') audioContext.resume();
}

function tone(type) {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.connect(gain);
  gain.connect(audioContext.destination);

  if (type === 'shoot') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.08);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'explosion') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.32);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    osc.start(now);
    osc.stop(now + 0.35);
  } else if (type === 'wall' || type === 'hit') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(type === 'hit' ? 160 : 95, now);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.13);
  } else if (type === 'start') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.start(now);
    osc.stop(now + 0.2);
  }
}

network.on('room_created', ({ roomId }) => {
  ui.setRoom(roomId);
  ui.status('等待中 (1/2)');
  ui.showOverlay('房间已创建', `分享房间号 ${roomId}，等待第二名玩家加入...`);
});

network.on('player_joined', ({ roomId, status, players }) => {
  ui.setRoom(roomId);
  ui.status(status);
  ui.setPlayers(players);
  localSlot = players?.find((player) => player.id === network.id)?.slot || localSlot;
  clearKeys();
});

network.on('map_selected', ({ map }) => {
  ui.setMap(map);
  ui.status(`已选地图: ${map.name}`);
});

network.on('game_start', ({ roomId, map, players }) => {
  tankCache.clear();
  ui.setRoom(roomId);
  ui.setPlayers(players);
  localSlot = players?.find((player) => player.id === network.id)?.slot || localSlot;
  clearKeys();
  ui.setMap(map);
  ui.status('对局中');
  ui.showOverlay(map.name, `难度: ${map.difficulty} · 3秒后开始`);
  let remaining = 3;
  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(timer);
      ui.hideOverlay();
    } else {
      ui.showOverlay(map.name, `${remaining}秒后开始...`);
    }
  }, 1000);
});

network.on('game_state', (incoming) => {
  const tanks = incoming.tanks.map((tankData) => {
    let tank = tankCache.get(tankData.id);
    if (!tank) {
      tank = new Tank(tankData);
      tankCache.set(tankData.id, tank);
    } else {
      tank.update(tankData);
    }
    return tank;
  });
  state = { ...incoming, tanks };
  renderer.syncExplosions(incoming.explosions);
  const localTank = tanks.find((tank) => tank.id === network.id);
  ui.setHp(localTank?.hp);
  ui.setMap(incoming.map);
});

network.on('player_hit', ({ playerId, hp }) => {
  if (playerId === network.id) ui.setHp(hp);
});

network.on('player_killed', ({ victimId }) => {
  if (victimId === network.id) ui.showOverlay('坦克被摧毁', '等待对局结果...');
});

network.on('game_over', ({ winner, winnerName, leaderboard }) => {
  ui.status('游戏结束');
  ui.showOverlay('游戏结束', `${winnerName} 获得胜利！`, true);
  if (leaderboard) ui.setLeaderboard(leaderboard);
  if (winner === network.id) tone('start');
});

network.on('leaderboard', ({ entries }) => {
  ui.setLeaderboard(entries);
});

network.on('error', ({ message }) => {
  ui.status(message);
  ui.showOverlay('Notice', message);
});

network.on('sound', ({ type }) => {
  tone(type);
});

function sendInput(now) {
  if (now - lastInputSent > 33) {
    network.sendInput(keys);
    lastInputSent = now;
  }
}

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  sendInput(now);
  renderer.draw(state, network.id, 0.55, dt);
  requestAnimationFrame(frame);
}

ui.showOverlay('创建或加入房间', '需要两名玩家，满人自动开始对战。');
requestAnimationFrame(frame);
