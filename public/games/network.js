export class Network {
  constructor() {
    this.socket = window.io();
  }

  on(event, handler) {
    this.socket.on(event, handler);
  }

  createRoom(playerName) {
    this.socket.emit('create_room', { playerName });
  }

  joinRoom(roomId, playerName) {
    this.socket.emit('join_game', { roomId, playerName });
  }

  sendInput(keys) {
    this.socket.emit('player_input', { keys });
  }

  requestLeaderboard() {
    this.socket.emit('request_leaderboard', {});
  }

  randomMap() {
    this.socket.emit('random_map');
  }

  playAgain() {
    this.socket.emit('play_again');
  }

  leaveRoom() {
    this.socket.emit('leave_room');
  }

  resetStats() {
    this.socket.emit('reset_stats');
  }

  get id() {
    return this.socket.id;
  }
}
