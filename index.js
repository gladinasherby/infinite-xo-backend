const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Stores room data: { code: { createdAt: Date, players: [socketId], host: socketId } }
const rooms = new Map();

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('create_room', () => {
    let code;
    do {
      code = generateCode();
    } while (rooms.has(code));

    rooms.set(code, {
      createdAt: Date.now(),
      players: [socket.id],
      host: socket.id
    });

    socket.join(code);
    socket.emit('room_created', code);
  });

  socket.on('join_room', (code) => {
    const room = rooms.get(code);
    
    if (!room) {
      socket.emit('join_error', 'Room not found.');
      return;
    }

    const ageMs = Date.now() - room.createdAt;
    if (ageMs > 5 * 60 * 1000) {
      rooms.delete(code);
      socket.emit('join_error', 'Room code expired.');
      return;
    }

    if (room.players.length >= 2) {
      socket.emit('join_error', 'Room is full.');
      return;
    }

    room.players.push(socket.id);
    socket.join(code);
    
    // The host is always X, the joiner is O.
    io.to(code).emit('game_start', { code });
  });

  socket.on('make_move', (data) => {
    // data: { code, move: index, strokes: null | Array }
    socket.to(data.code).emit('remote_move', data);
  });

  socket.on('play_again', (data) => {
    // optional play again logic
    socket.to(data.code).emit('remote_play_again', data);
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    for (const [code, room] of rooms.entries()) {
      if (room.players.includes(socket.id)) {
        io.to(code).emit('player_left');
        rooms.delete(code);
      }
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.createdAt > 5 * 60 * 1000 && room.players.length < 2) {
      io.to(code).emit('join_error', 'Room expired due to timeout.');
      rooms.delete(code);
    }
  }
}, 60 * 1000);

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
