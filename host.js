const socket = io();
const $ = id => document.getElementById(id);
let pin = null;
let current = null;
let timerInterval = null;
let playerState = [];
let audioCtx;

function beep(type='tick') {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain(); osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.value = type === 'start' ? 880 : type === 'finish' ? 520 : 330; osc.type = 'triangle';
    gain.gain.setValueAtTime(0.001, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime+0.03); gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime+0.25);
    osc.start(); osc.stop(audioCtx.currentTime+0.27);
  } catch {}
}

function show(id, visible=true) { $(id).classList.toggle('hidden', !visible); }

$('create-btn').addEventListener('click', () => {
  $('create-btn').disabled = true;
  socket.emit('host:create', {}, res => {
    $('create-btn').disabled = false;
    if (!res?.ok) return alert(res.error || 'Erro ao criar sala.');
    pin = res.pin; $('pin-code').textContent = pin; $('qr-img').src = res.qrDataUrl; $('join-url').textContent = res.joinUrl;
    show('setup-panel', false); show('lobby-panel', true); beep('start');
  });
});
$('start-btn').addEventListener('click', () => { beep('start'); socket.emit('host:next'); show('start-btn', false); show('finish-btn', true); });
$('next-btn').addEventListener('click', () => { socket.emit('host:next'); show('next-btn', false); });
$('finish-btn').addEventListener('click', () => { socket.emit('host:finish'); beep('finish'); });
$('fullscreen-btn').addEventListener('click', async () => { try { await document.documentElement.requestFullscreen(); } catch {} });
$('new-room-btn').addEventListener('click', () => location.reload());

socket.on('room:state', state => {
  playerState = state.players || [];
  $('player-count').textContent = playerState.length;
  $('progress-count').textContent = `${Math.max(0, state.questionIndex + 1)}/10`;
  $('room-status').textContent = state.status === 'lobby' ? 'AGUARDANDO' : state.status === 'question' ? 'JOGANDO' : state.status === 'reveal' ? 'RESULTADO' : 'FINALIZADO';
  renderPlayers();
  if (state.status === 'question') show('lobby-panel', false);
});

function avatarArt(id) {
  const map = {mouse:'🖱️',teclado:'⌨️',monitor:'🖥️',cpu:'🧠',placa:'🟩',internet:'🌐',roteador:'📡',notebook:'💻',celular:'📱',gamepad:'🎮',headset:'🎧',webcam:'📷'};
  return map[id] || '🖥️';
}

function renderPlayers() {
  if (!playerState.length) { $('players-list').innerHTML = '<div class="empty-state">Aguardando os primeiros jogadores...</div>'; $('players-list').classList.add('empty-list'); return; }
  $('players-list').classList.remove('empty-list');
  $('players-list').innerHTML = playerState.map((p,i) => `<div class="player-row"><div class="host-mini-avatar">${avatarArt(p.avatar)}<span>◡‿◡</span></div><div class="player-name"><strong>${escapeHtml(p.name)}</strong><small>#${String(i+1).padStart(2,'0')}</small></div><div class="player-points">${p.score} pts</div><div class="player-answer ${p.answered ? 'done':''}">${p.answered ? '✓' : '…'}</div></div>`).join('');
  renderLivePlayers();
}

function renderLivePlayers() {
  $('live-players').innerHTML = playerState.map(p => `<div class="live-player"><span class="live-avatar">${avatarArt(p.avatar)}</span><strong>${escapeHtml(p.name)}</strong><span class="live-answer ${p.answered ? 'answered':''}">${p.answered ? 'RESPONDEU ✓' : 'PENSANDO…'}</span></div>`).join('');
  $('answered-count').textContent = playerState.filter(p=>p.answered).length;
}

function escapeHtml(s) { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;'}[c])); }

socket.on('question:start', data => {
  current = data;
  show('lobby-panel', false); show('question-panel', true); show('podium-panel', false); show('next-btn', false); show('finish-btn', true);
  $('live-counter').textContent = `PERGUNTA ${data.questionIndex+1}/${data.totalQuestions}`;
  $('host-topic').textContent = data.topic; $('host-question').textContent = data.question;
  const letters = ['A','B','C','D'];
  $('host-options').innerHTML = data.options.map((x,i) => `<div class="host-answer host-${i}"><span>${letters[i]}</span><strong>${escapeHtml(x)}</strong></div>`).join('');
  startTimer(data.endsAt);
  beep('start');
});

function startTimer(endsAt) {
  clearInterval(timerInterval);
  const tick = () => { const s = Math.max(0, Math.ceil((endsAt-Date.now())/1000)); $('live-timer').textContent = s; $('progress-fill').style.width = `${Math.max(0, (s/15)*100)}%`; if (s<=0) clearInterval(timerInterval); };
  tick(); timerInterval = setInterval(tick, 200);
}

socket.on('question:reveal', data => {
  if (!current) return;
  document.querySelectorAll('.host-answer').forEach((el,i) => el.classList.toggle('host-correct', i===data.correctAnswer));
  $('answer-progress').textContent = '✅ RESPOSTAS REGISTRADAS';
  show('next-btn', true);
  beep('finish');
});

socket.on('answer:count', ({ answered, total }) => { $('answer-progress').textContent = `${answered}/${total} responderam`; $('answered-count').textContent = answered; });

socket.on('game:finished', ({ leaderboard }) => {
  show('question-panel', false); show('lobby-panel', false); show('podium-panel', true); show('finish-btn', false); show('next-btn', false); renderPodium(leaderboard || []); confetti(); beep('finish');
});

function renderPodium(board) {
  const top = board.slice(0,3);
  const slots = [top[1], top[0], top[2]];
  $('podium').innerHTML = slots.map((p,idx) => {
    if (!p) return `<div class="podium-slot empty"></div>`;
    const order = idx===1 ? 'first' : idx===0 ? 'second' : 'third';
    return `<div class="podium-slot ${order}"><div class="podium-avatar">${avatarArt(p.avatar)}<span>◕‿◕</span></div><div class="podium-name">${escapeHtml(p.name)}</div><div class="podium-medal">${order==='first'?'🥇':order==='second'?'🥈':'🥉'}</div><div class="podium-score">${p.score} pts</div><div class="podium-block"><span>${p.rank}º</span></div></div>`;
  }).join('');
}

function confetti() {
  const holder = document.createElement('div'); holder.className='confetti-layer'; document.body.appendChild(holder);
  for(let i=0;i<90;i++) { const s=document.createElement('i'); s.style.left=(Math.random()*100)+'%'; s.style.animationDelay=(Math.random()*0.9)+'s'; s.style.setProperty('--r', `${Math.random()*720-360}deg`); holder.appendChild(s); }
  setTimeout(()=>holder.remove(), 4000);
}

socket.on('toast', msg => { $('toast').textContent = msg; $('toast').classList.remove('hidden'); setTimeout(()=>$('toast').classList.add('hidden'),2500); });
socket.on('room:closed', () => alert('Sala encerrada.'));
