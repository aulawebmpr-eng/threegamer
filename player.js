const socket = io();
const $ = id => document.getElementById(id);

const AVATARS = [
  { id: 'mouse', name: 'Mouse', icon: '🖱️' },
  { id: 'teclado', name: 'Teclado', icon: '⌨️' },
  { id: 'monitor', name: 'Monitor', icon: '🖥️' },
  { id: 'cpu', name: 'CPU', icon: '🧠' },
  { id: 'placa', name: 'Placa-mãe', icon: '🟩' },
  { id: 'internet', name: 'Internet', icon: '🌐' },
  { id: 'roteador', name: 'Roteador', icon: '📡' },
  { id: 'notebook', name: 'Notebook', icon: '💻' },
  { id: 'celular', name: 'Celular', icon: '📱' },
  { id: 'gamepad', name: 'Gamepad', icon: '🎮' },
  { id: 'headset', name: 'Headset', icon: '🎧' },
  { id: 'webcam', name: 'Webcam', icon: '📷' }
];

const AVATAR_ART = {
  mouse: ['🖱️', '◕ᴗ◕'], teclado: ['⌨️', '≧◡≦'], monitor: ['🖥️', '•ᴗ•'], cpu: ['🧠', '◉‿◉'], placa: ['🟩', '•̀ᴗ•́'],
  internet: ['🌐', '＾▽＾'], roteador: ['📡', '•ᴗ•✿'], notebook: ['💻', '⌐■ᴗ■'], celular: ['📱', 'ᵔᴥᵔ'],
  gamepad: ['🎮', '≧▽≦'], headset: ['🎧', '•‿•'], webcam: ['📷', '◕‿◕']
};

let selectedAvatar = 'mouse';
let player = null;
let currentQuestion = null;
let timerInterval = null;
let latestLeaderboard = [];
let audioCtx;

function showScreen(id) {
  ['join-screen', 'wait-screen', 'game-screen', 'finish-screen'].forEach(s => $(s).classList.add('hidden'));
  $(id).classList.remove('hidden');
}

function beep(kind) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    const tones = kind === 'ok' ? [740, 988] : kind === 'bad' ? [220, 160] : [440, 660];
    osc.frequency.value = tones[0];
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.13, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.23);
    osc.start(); osc.stop(audioCtx.currentTime + 0.25);
    if (tones[1]) setTimeout(() => { try { beep2(tones[1]); } catch {} }, 110);
  } catch {}
}
function beep2(freq) {
  const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination); osc.frequency.value = freq; osc.type = 'triangle';
  gain.gain.setValueAtTime(0.001, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.1, audioCtx.currentTime+0.02); gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime+0.18);
  osc.start(); osc.stop(audioCtx.currentTime + 0.2);
}

function avatarHtml(id, cls='') {
  const [icon, face] = AVATAR_ART[id] || AVATAR_ART.monitor;
  return `<div class="avatar-face ${cls}" data-avatar="${id}"><div class="avatar-icon">${icon}</div><div class="avatar-mouth">${face}</div></div>`;
}

function buildAvatars() {
  $('avatar-grid').innerHTML = AVATARS.map(a => `<button class="avatar-option ${a.id === selectedAvatar ? 'selected' : ''}" data-avatar="${a.id}">${avatarHtml(a.id)}<span>${a.name}</span></button>`).join('');
  document.querySelectorAll('.avatar-option').forEach(btn => btn.addEventListener('click', () => {
    selectedAvatar = btn.dataset.avatar;
    document.querySelectorAll('.avatar-option').forEach(b => b.classList.toggle('selected', b.dataset.avatar === selectedAvatar));
    $('preview-avatar').innerHTML = avatarHtml(selectedAvatar, 'preview');
    beep('tick');
  }));
  $('preview-avatar').innerHTML = avatarHtml(selectedAvatar, 'preview');
}

function setPinFromUrl() {
  const p = new URLSearchParams(location.search).get('pin');
  if (p) $('pin').value = p;
}

$('name').addEventListener('input', () => $('preview-name').textContent = $('name').value.trim() || 'Seu avatar');
$('join-btn').addEventListener('click', () => {
  const pin = $('pin').value.trim(); const name = $('name').value.trim();
  $('join-error').classList.add('hidden');
  if (!/^\d{6}$/.test(pin)) return errorJoin('Digite o PIN de 6 números.');
  if (name.length < 2) return errorJoin('Digite seu nome.');
  beep('tick');
  socket.emit('player:join', { pin, name, avatar: selectedAvatar }, res => {
    if (!res?.ok) return errorJoin(res?.error || 'Não foi possível entrar.');
    player = res.player; $('wait-name').textContent = player.name; $('wait-avatar').innerHTML = avatarHtml(player.avatar, 'big'); $('player-avatar-mini').innerHTML = avatarHtml(player.avatar, 'mini'); showScreen('wait-screen');
  });
});
function errorJoin(msg) { $('join-error').textContent = msg; $('join-error').classList.remove('hidden'); beep('bad'); }

function startTimer(endsAt) {
  clearInterval(timerInterval);
  const tick = () => { const secs = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)); $('timer').textContent = secs; document.querySelector('.timer-ring').style.setProperty('--progress', `${(secs/15)*100}%`); if (secs <= 0) clearInterval(timerInterval); };
  tick(); timerInterval = setInterval(tick, 200);
}

function renderOptions(options) {
  const letters = ['A', 'B', 'C', 'D'];
  $('options').innerHTML = options.map((opt,i) => `<button class="answer-btn ans-${i}" data-index="${i}"><span class="answer-letter">${letters[i]}</span><span>${opt}</span></button>`).join('');
  document.querySelectorAll('.answer-btn').forEach(btn => btn.addEventListener('click', () => {
    if (btn.disabled) return;
    document.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);
    btn.classList.add('chosen');
    socket.emit('player:answer', { choice: Number(btn.dataset.index) });
    beep('tick');
  }));
}

socket.on('question:start', data => {
  currentQuestion = data; showScreen('game-screen');
  $('question-counter').textContent = `${data.questionIndex + 1} / ${data.totalQuestions}`;
  $('topic').textContent = data.topic; $('question-text').textContent = data.question; $('answer-feedback').classList.add('hidden');
  renderOptions(data.options); startTimer(data.endsAt);
});

socket.on('answer:received', data => {
  $('answer-feedback').className = `answer-feedback ${data.correct ? 'good' : 'bad'}`;
  $('answer-feedback').innerHTML = data.correct ? `✅ Acertou! <strong>+${data.points} pontos</strong>` : `❌ Resposta registrada. Boa sorte na próxima!`;
  $('answer-feedback').classList.remove('hidden');
  beep(data.correct ? 'ok' : 'bad');
});

socket.on('question:reveal', data => {
  if (Number(data.questionIndex) !== Number(currentQuestion?.questionIndex)) return;
  document.querySelectorAll('.answer-btn').forEach((b,i) => {
    b.disabled = true;
    b.classList.toggle('correct', i === data.correctAnswer);
    if (b.classList.contains('chosen') && i !== data.correctAnswer) b.classList.add('incorrect');
  });
  latestLeaderboard = data.leaderboard || [];
  const me = latestLeaderboard.find(p => p.id === player?.id);
  if (me) $('player-score').textContent = me.score;
  renderRankStrip(latestLeaderboard);
});

function renderRankStrip(board) {
  $('player-rank-strip').innerHTML = board.slice(0,3).map(p => `<span>${p.rank===1?'🥇':p.rank===2?'🥈':'🥉'} ${p.name} <b>${p.score}</b></span>`).join('');
}

socket.on('game:finished', ({ leaderboard }) => {
  latestLeaderboard = leaderboard || [];
  const me = latestLeaderboard.find(p => p.id === player?.id);
  showScreen('finish-screen');
  $('finish-avatar').innerHTML = avatarHtml(player?.avatar || 'monitor', 'big');
  $('finish-title').textContent = me?.rank === 1 ? 'VOCÊ FICOU EM 1º!' : 'Mandou bem!';
  $('finish-score').textContent = me?.score || 0;
  $('finish-rank').textContent = `#${me?.rank || '-'}`;
  $('finish-mini-board').innerHTML = latestLeaderboard.slice(0,5).map(p => `<div><span>${p.rank}</span><span>${p.name}</span><b>${p.score}</b></div>`).join('');
  beep('ok');
});

socket.on('room:closed', () => { alert('A sala foi encerrada pelo professor.'); location.reload(); });
socket.on('toast', msg => showToast(msg));
function showToast(msg) { $('toast').textContent = msg; $('toast').classList.remove('hidden'); setTimeout(() => $('toast').classList.add('hidden'), 2500); }

setPinFromUrl(); buildAvatars();
