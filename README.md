# Tank Battle

Authoritative two-player multiplayer tank battle game built with Node.js, Express, Socket.io, and vanilla JavaScript Canvas.

## Run

```sh
npm install
npm start
```

The server listens on `PORT` from `.env` or the environment, defaulting to `3000`.

## Play

Open `http://localhost:3000` in two browser windows or on two devices. One player creates a room and shares the six-digit room ID; the second player joins that room. The game starts automatically after both players are present.

- Player 1: WASD to move, Space to shoot
- Player 2: Arrow keys to move, Enter to shoot

Battle records are stored in `data/records.json`.
