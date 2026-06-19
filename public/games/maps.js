export const MAP_SIZE = 26;
export const TILE_SIZE = 24;

function makeEmpty() {
  return Array.from({ length: MAP_SIZE }, () => Array(MAP_SIZE).fill(0));
}

function border(grid) {
  for (let i = 0; i < MAP_SIZE; i += 1) {
    grid[0][i] = 2;
    grid[MAP_SIZE - 1][i] = 2;
    grid[i][0] = 2;
    grid[i][MAP_SIZE - 1] = 2;
  }
}

function setSpawn(grid) {
  grid[23][2] = 3;
  grid[2][23] = 4;
}

function scatter(grid, points, value) {
  for (const [x, y] of points) {
    if ((x === 2 && y === 23) || (x === 23 && y === 2)) continue;
    grid[y][x] = value;
  }
}

function openField() {
  const g = makeEmpty();
  border(g);
  scatter(g, [[7, 7], [8, 7], [17, 18], [18, 18], [12, 11], [13, 11], [12, 14], [13, 14], [5, 17], [20, 8]], 1);
  scatter(g, [[12, 12], [13, 13]], 2);
  setSpawn(g);
  return g;
}

function garden() {
  const g = makeEmpty();
  border(g);
  for (let i = 4; i <= 21; i += 4) {
    g[6][i] = 1;
    g[19][25 - i] = 1;
    g[i][10] = 1;
    g[25 - i][15] = 1;
  }
  scatter(g, [[12, 8], [13, 8], [12, 17], [13, 17], [8, 12], [17, 13]], 2);
  setSpawn(g);
  return g;
}

function fortress() {
  const g = makeEmpty();
  border(g);
  for (let x = 3; x <= 9; x += 1) {
    g[18][x] = 1;
    g[21][x] = 1;
    g[4][25 - x] = 1;
    g[7][25 - x] = 1;
  }
  for (let y = 8; y <= 17; y += 1) {
    if (y !== 12 && y !== 13) {
      g[y][8] = 2;
      g[y][17] = 2;
    }
  }
  for (let x = 10; x <= 15; x += 1) {
    if (x !== 12 && x !== 13) {
      g[12][x] = 1;
      g[13][x] = 1;
    }
  }
  setSpawn(g);
  return g;
}

function maze() {
  const g = makeEmpty();
  border(g);
  for (let y = 3; y <= 22; y += 2) {
    for (let x = 2; x <= 23; x += 1) {
      if ((x + y) % 7 !== 0) g[y][x] = 1;
    }
  }
  for (let x = 5; x <= 20; x += 5) {
    for (let y = 4; y <= 21; y += 1) {
      if (y % 6 !== 0) g[y][x] = 1;
    }
  }
  scatter(g, [[12, 12], [13, 12], [12, 13], [13, 13]], 2);
  setSpawn(g);
  g[23][2] = 3;
  g[22][2] = 0;
  g[23][3] = 0;
  g[2][23] = 4;
  g[3][23] = 0;
  g[2][22] = 0;
  return g;
}

function labyrinth() {
  const g = makeEmpty();
  border(g);
  for (let y = 2; y <= 23; y += 3) {
    for (let x = 2; x <= 23; x += 1) {
      g[y][x] = x % 5 === 0 ? 2 : 1;
    }
  }
  for (let x = 3; x <= 22; x += 4) {
    for (let y = 2; y <= 23; y += 1) {
      if (y % 7 !== 0) g[y][x] = x % 8 === 3 ? 2 : 1;
    }
  }
  for (const [x, y] of [[2, 23], [3, 23], [2, 22], [23, 2], [22, 2], [23, 3], [12, 12], [13, 13]]) {
    g[y][x] = 0;
  }
  setSpawn(g);
  return g;
}

function doom() {
  const g = makeEmpty();
  border(g);
  for (let y = 3; y <= 22; y += 1) {
    for (let x = 3; x <= 22; x += 1) {
      if (x % 4 === 0 || y % 4 === 0) g[y][x] = 1;
      if ((x === 8 || x === 17 || y === 8 || y === 17) && (x + y) % 3 !== 0) g[y][x] = 2;
    }
  }
  for (const [x, y] of [
    [2, 23], [3, 23], [4, 23], [2, 22], [2, 21], [5, 21],
    [23, 2], [22, 2], [21, 2], [23, 3], [23, 4], [20, 4],
    [12, 12], [13, 12], [12, 13], [13, 13], [6, 6], [19, 19],
    [10, 15], [15, 10], [10, 10], [15, 15]
  ]) {
    g[y][x] = 0;
  }
  setSpawn(g);
  return g;
}

export const MAPS = [
  {
    id: 1,
    name: 'Open Field',
    difficulty: 'EASY',
    bushes: [[4, 4], [9, 16], [21, 21], [16, 5]],
    grid: openField()
  },
  {
    id: 2,
    name: 'Garden',
    difficulty: 'EASY',
    bushes: [[5, 5], [6, 5], [20, 20], [19, 20], [13, 4], [4, 13], [21, 11]],
    grid: garden()
  },
  {
    id: 3,
    name: 'Fortress',
    difficulty: 'MEDIUM',
    bushes: [[11, 11], [14, 14]],
    grid: fortress()
  },
  {
    id: 4,
    name: 'Maze',
    difficulty: 'MEDIUM',
    bushes: [[2, 10], [23, 15]],
    grid: maze()
  },
  {
    id: 5,
    name: 'Labyrinth',
    difficulty: 'HARD',
    bushes: [[6, 12], [19, 13]],
    grid: labyrinth()
  },
  {
    id: 6,
    name: 'Fortress of Doom',
    difficulty: 'HARD',
    bushes: [[5, 18], [18, 5]],
    grid: doom()
  }
];
