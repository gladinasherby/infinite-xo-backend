const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: [
      process.env.FRONTEND_URL || "https://gladinasherby.github.io",
      "http://localhost:5173",
    ],
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

const PORT = process.env.PORT || 3001;

// Stores room data:
// {
//   code: {
//     createdAt: Date,
//     players: [socketId],
//     host: socketId
//   }
// }

const rooms = new Map();

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // CREATE ROOM
  socket.on("create_room", () => {
    let code;

    do {
      code = generateCode();
    } while (rooms.has(code));

    rooms.set(code, {
      createdAt: Date.now(),
      players: [socket.id],
      host: socket.id,
    });

    socket.join(code);

    socket.emit("room_created", code);

    console.log(`Room created: ${code}`);
  });

  // JOIN ROOM
  socket.on("join_room", (code) => {
    const room = rooms.get(code);

    if (!room) {
      socket.emit("join_error", "Room not found.");
      return;
    }

    // Room expiration check
    const ageMs = Date.now() - room.createdAt;

    if (ageMs > 5 * 60 * 1000) {
      rooms.delete(code);
      socket.emit("join_error", "Room code expired.");
      return;
    }

    // Prevent duplicate joins
    if (room.players.includes(socket.id)) {
      return;
    }

    // Max 2 players
    if (room.players.length >= 2) {
      socket.emit("join_error", "Room is full.");
      return;
    }

    room.players.push(socket.id);

    socket.join(code);

    console.log(`Player joined room: ${code}`);

    // Start game for both users
    io.to(code).emit("game_start", { code });
  });

  // GAME MOVES
  socket.on("make_move", (data) => {
    // data = {
    //   code,
    //   move,
    //   strokes
    // }

    socket.to(data.code).emit("remote_move", data);
  });

  // PLAY AGAIN
  socket.on("play_again", (data) => {
    socket.to(data.code).emit("remote_play_again", data);
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);

    for (const [code, room] of rooms.entries()) {
      if (room.players.includes(socket.id)) {
        socket.to(code).emit("player_left");

        rooms.delete(code);

        console.log(`Room deleted: ${code}`);

        break;
      }
    }
  });
});

// CLEANUP OLD UNUSED ROOMS
setInterval(() => {
  const now = Date.now();

  for (const [code, room] of rooms.entries()) {
    const expired = now - room.createdAt > 5 * 60 * 1000;

    if (expired && room.players.length < 2) {
      io.to(code).emit("join_error", "Room expired due to timeout.");

      rooms.delete(code);

      console.log(`Expired room deleted: ${code}`);
    }
  }
}, 60 * 1000);

app.get("/", (req, res) => {
  res.send("Infinite XO backend is running.");
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
