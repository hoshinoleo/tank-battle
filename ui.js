export class UI {
  constructor(network) {
    this.network = network;
    this.roomId = null;
    this.players = [];
    this.elements = {
      playerName: document.getElementById('playerName'),
      joinRoomId: document.getElementById('joinRoomId'),
      createRoom: document.getElementById('createRoom'),
      joinRoom: document.getElementById('joinRoom'),
      randomMap: document.getElementById('randomMap'),
      leaveRoom: document.getElementById('leaveRoom'),
      roomStatus: document.getElementById('roomStatus'),
      roomIdLabel: document.getElementById('roomIdLabel'),
      shareButton: document.getElementById('shareButton'),
      overlay: document.getElementById('overlay'),
      overlayTitle: document.getElementById('overlayTitle'),
      overlayText: document.getElementById('overlayText'),
      playAgain: document.getElementById('playAgain'),
      backToLobby: document.getElementById('backToLobby'),
      hpPanel: document.getElementById('hpPanel'),
      mapPanel: document.getElementById('mapPanel'),
      leaderboard: document.getElementById('leaderboard'),
      playersList: document.getElementById('playersList'),
      refreshLeaderboard: document.getElementById('refreshLeaderboard'),
      resetStats: document.getElementById('resetStats'),
      currentStats: document.getElementById('currentStats')
    };
    this.bind();
  }

  bind() {
    this.elements.createRoom.addEventListener('click', () => this.network.createRoom(this.playerName()));
    this.elements.joinRoom.addEventListener('click', () => this.network.joinRoom(this.elements.joinRoomId.value.trim(), this.playerName()));
    this.elements.randomMap.addEventListener('click', () => this.network.randomMap());
    this.elements.refreshLeaderboard.addEventListener('click', () => this.network.requestLeaderboard());
    this.elements.playAgain.addEventListener('click', () => this.network.playAgain());
    this.elements.backToLobby.addEventListener('click', () => this.network.leaveRoom());
    this.elements.leaveRoom.addEventListener('click', () => this.network.leaveRoom());
    this.elements.resetStats.addEventListener('click', () => {
      if (window.confirm('重置所有战绩？')) this.network.resetStats();
    });
    this.elements.shareButton.addEventListener('click', async () => {
      if (!this.roomId) return;
      const text = `加入我的坦克大战房间：${this.roomId}`;
      try {
        await navigator.clipboard.writeText(text);
        this.status('房间号已复制');
      } catch {
        window.prompt('复制房间号', this.roomId);
      }
    });
  }

  playerName() {
    return this.elements.playerName.value.trim() || '玩家';
  }

  setRoom(roomId) {
    this.roomId = roomId;
    this.elements.roomIdLabel.textContent = roomId || '------';
  }

  status(text) {
    this.elements.roomStatus.textContent = text;
  }

  setPlayers(players) {
    this.players = players || [];
    this.elements.playersList.innerHTML = this.players.map((player) => `
      <div class="player-pill">
        <span><i class="dot" style="background:${player.color}"></i>${escapeHtml(player.name)}</span>
        <strong>P${player.slot}</strong>
      </div>
    `).join('') || '<span>等待玩家加入</span>';
  }

  showOverlay(title, text, gameOver = false) {
    this.elements.overlay.classList.toggle('game-over', gameOver);
    this.elements.overlay.classList.remove('hidden');
    this.elements.overlayTitle.textContent = title;
    this.elements.overlayText.textContent = text;
  }

  hideOverlay() {
    this.elements.overlay.classList.remove('game-over');
    this.elements.overlay.classList.add('hidden');
  }

  setMap(map) {
    this.elements.mapPanel.textContent = map ? `地图: ${map.name} (${map.difficulty})` : '地图: 随机';
  }

  setHp(hp) {
    if (typeof hp !== 'number') {
      this.elements.hpPanel.textContent = '血量: ---';
      return;
    }
    const full = '♥'.repeat(Math.max(0, hp));
    const empty = '♡'.repeat(Math.max(0, 3 - hp));
    this.elements.hpPanel.textContent = `血量: ${full}${empty}`;
  }

  setLeaderboard(entries) {
    this.elements.leaderboard.innerHTML = (entries || []).map((entry) => {
      const rate = entry.gamesPlayed ? Math.round((entry.wins / entry.gamesPlayed) * 100) : 0;
      return `<li><strong>${escapeHtml(entry.name)}</strong><span>${entry.wins}-${entry.losses} 胜/负 | ${rate}% | ${entry.kills} 杀</span></li>`;
    }).join('') || '<li><span>暂无对战记录</span></li>';

    const mine = (entries || []).find((entry) => entry.name === this.playerName());
    if (mine) {
      this.elements.currentStats.innerHTML = `
        <span>局数</span><strong>${mine.gamesPlayed}</strong>
        <span>胜场</span><strong>${mine.wins}</strong>
        <span>击杀</span><strong>${mine.kills}</strong>
        <span>伤害</span><strong>${mine.totalDamageDealt}</strong>
      `;
    }
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}
