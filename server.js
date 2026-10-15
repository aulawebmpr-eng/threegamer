const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const crypto = require('crypto');
const questions = require('./questions');

const PORT = Number(process.env.PORT || 3000);
const QUESTION_SECONDS = 15;
const REVEAL_SECONDS = 4;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();

app.use(express.static(__dirname + '/public'));
app.get('/host', (_req, res) => res.sendFile(__dirname + '/public/host.html'));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

function cleanName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 18) || 'Jogador';
}

function makePin() {
  let pin;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(pin));
  return pin;
}

function getLanAddress() {
  const nets = os.networkInterfaces();
  const preferred = [];
  for (const [name, list] of Object.entries(nets)) {
    for (const net of list || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const ip = net.address;
      if (/^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) preferred.push(ip);
    }
  }
  return preferred[0] || 'localhost';
}

function roomPublic(room) {
  return {
    pin: room.pin,
    status: room.status,
    questionIndex: room.questionIndex,
    totalQuestions: questions.length,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      answered: p.answeredQuestion === room.questionIndex
    }))
  };
}

function leaderboard(room) {
  return [...room.players.values()]
    .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
    .map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score
    }));
}

function emitState(room) {
  io.to(room.pin).emit('room:state', roomPublic(room));
}

async function createRoom(hostSocket) {
  const pin = makePin();
  const hostIp = getLanAddress();
  const joinUrl = `http://${hostIp}:${PORT}/?pin=${pin}`;
  const qrDataUrl = await QRCode.toDataURL(joinUrl, {
    width: 460,
    margin: 2,
    errorCorrectionLevel: 'M'
  });

  const room = {
    pin,
    hostId: hostSocket.id,
    createdAt: Date.now(),
    status: 'lobby',
    questionIndex: -1,
    endsAt: 0,
    answers: new Map(),
    endTimer: null,
    players: new Map(),
    joinUrl,
    qrDataUrl
  };
  rooms.set(pin, room);
  hostSocket.join(pin);
  return room;
}

function endQuestion(room) {
  if (!room || room.status !== 'question') return;
  room.status = 'reveal';
  if (room.endTimer) clearTimeout(room.endTimer);
  room.endTimer = null;
  const q = questions[room.questionIndex];
  io.to(room.pin).emit('question:reveal', {
    questionIndex: room.questionIndex,
    correctAnswer: q.answer,
    leaderboard: leaderboard(room)
  });
  emitState(room);
  room.endTimer = setTimeout(() => {
    if (!rooms.has(room.pin)) return;
    if (room.questionIndex >= questions.length - 1) {
      room.status = 'finished';
      io.to(room.pin).emit('game:finished', { leaderboard: leaderboard(room) });
      emitState(room);
    } else {
      startQuestion(room);
    }
  }, REVEAL_SECONDS * 1000);
}

function startQuestion(room) {
  if (!room) return;
  if (room.endTimer) clearTimeout(room.endTimer);
  room.endTimer = null;
  room.questionIndex += 1;
  room.status = 'question';
  room.answers = new Map();
  room.endsAt = Date.now() + QUESTION_SECONDS * 1000;
  for (const p of room.players.values()) p.answeredQuestion = -1;
  const q = questions[room.questionIndex];
  io.to(room.pin).emit('question:start', {
    questionIndex: room.questionIndex,
    totalQuestions: questions.length,
    topic: q.topic,
    question: q.question,
    options: q.options,
    endsAt: room.endsAt,
    seconds: QUESTION_SECONDS
  });
  emitState(room);
  room.endTimer = setTimeout(() => endQuestion(room), QUESTION_SECONDS * 1000 + 150);
}

io.on('connection', socket => {
  socket.on('host:create', async (_payload, ack) => {
    try {
      const room = await createRoom(socket);
      ack({ ok: true, pin: room.pin, joinUrl: room.joinUrl, qrDataUrl: room.qrDataUrl });
      emitState(room);
    } catch (err) {
      ack({ ok: false, error: 'Não foi possível criar a sala.' });
    }
  });

  socket.on('host:next', () => {
    for (const room of rooms.values()) {
      if (room.hostId !== socket.id) continue;
      if (room.status === 'lobby') {
        if (!room.players.size) return socket.emit('toast', 'Entre com pelo menos 1 aluno antes de começar.');
        startQuestion(room);
      } else if (room.status === 'reveal') {
        startQuestion(room);
      }
    }
  });

  socket.on('host:finish', () => {
    for (const room of rooms.values()) {
      if (room.hostId !== socket.id) continue;
      if (room.endTimer) clearTimeout(room.endTimer);
      room.endTimer = null;
      room.status = 'finished';
      io.to(room.pin).emit('game:finished', { leaderboard: leaderboard(room) });
      emitState(room);
    }
  });

  socket.on('player:join', ({ pin, name, avatar }, ack) => {
    pin = String(pin || '').trim();
    const room = rooms.get(pin);
    if (!room) return ack({ ok: false, error: 'PIN não encontrado. Confira o código.' });
    if (room.status !== 'lobby') return ack({ ok: false, error: 'A partida já começou. Aguarde a próxima sala.' });
    const safeName = cleanName(name);
    const duplicate = [...room.players.values()].some(p => p.name.toLowerCase() === safeName.toLowerCase());
    const finalName = duplicate ? `${safeName.slice(0, 14)}${Math.floor(Math.random() * 90 + 10)}` : safeName;
    const player = {
      id: socket.id,
      name: finalName,
      avatar: String(avatar || 'monitor').slice(0, 30),
      score: 0,
      answeredQuestion: -1,
      joinedAt: Date.now()
    };
    room.players.set(socket.id, player);
    socket.join(pin);
    socket.data.pin = pin;
    socket.data.role = 'player';
    ack({ ok: true, pin, player: { id: player.id, name: player.name, avatar: player.avatar } });
    emitState(room);
    io.to(room.hostId).emit('toast', `${player.name} entrou na sala!`);
  });

  socket.on('player:answer', ({ choice }) => {
    const pin = socket.data.pin;
    const room = rooms.get(pin);
    if (!room || room.status !== 'question') return;
    const player = room.players.get(socket.id);
    if (!player || player.answeredQuestion === room.questionIndex) return;
    const q = questions[room.questionIndex];
    const now = Date.now();
    const correct = Number(choice) === q.answer;
    const remaining = Math.max(0, room.endsAt - now);
    const base = correct ? 600 : 0;
    const speedBonus = correct ? Math.round((remaining / (QUESTION_SECONDS * 1000)) * 400) : 0;
    const points = base + speedBonus;
    player.score += points;
    player.answeredQuestion = room.questionIndex;
    room.answers.set(socket.id, { choice: Number(choice), correct, points });
    socket.emit('answer:received', { correct, points });
    io.to(room.hostId).emit('answer:count', { answered: room.answers.size, total: room.players.size });
    emitState(room);
    if (room.answers.size === room.players.size) setTimeout(() => endQuestion(room), 700);
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      if (room.hostId === socket.id) {
        if (room.endTimer) clearTimeout(room.endTimer);
        rooms.delete(room.pin);
        io.to(room.pin).emit('room:closed');
        continue;
      }
      if (room.players.delete(socket.id)) emitState(room);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('====================================================');
  console.log(' TRREE GAMER • QUIZ WEB MULTIPLAYER');
  console.log('====================================================');
  console.log(` Professor: http://localhost:${PORT}/host`);
  console.log(` Aluno:     http://${getLanAddress()}:${PORT}/`);
  console.log('');
  console.log('Deixe esta janela aberta enquanto o jogo estiver rodando.');
  console.log('====================================================');
});
