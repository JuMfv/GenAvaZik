// MoodAvatar - main.js (cleaned)
// Basic avatar renderer + Web Audio sync (vanilla JS)

const qs = s => document.querySelector(s);
const $canvas = qs('#avatarCanvas');
const ctx = $canvas.getContext('2d');

const state = {
	style: 'flat',
	color: '#4aa3ff',
	accessory: 'none',
	morph: 50,
	mood: 'detendu'
};

// presets
const PRESETS = {
	sunset: {style:'flat', color:'#ff7a59', accessory:'hat', morph:54, mood:'joyeux'},
	ocean: {style:'line', color:'#2fb3ff', accessory:'none', morph:46, mood:'detendu'},
	midnight: {style:'pixel', color:'#6a5cff', accessory:'glasses', morph:58, mood:'reflechis'},
	pop: {style:'flat', color:'#ffde59', accessory:'earring', morph:42, mood:'energique'}
};

// Audio / scheduler
let audioCtx = null;
let masterGain = null;
let oscNodes = [];
let analyser = null;
let dataArray = null;
let isPlaying = false;
let startTime = 0;

let kickPulse = 0;

// scheduler vars
let sequencer = { bpm: 100 };
let schedulerTimer = null;
const SCHEDULE_AHEAD_TIME = 0.1; // seconds
const LOOKAHEAD_MS = 25; // ms

// mood -> patterns and synths
const MOOD_PATTERNS = {
	detendu: { steps: 8, pattern: [1,0,0,0,1,0,0,0], bpm: 70, synth: {type:'sine', notes:[220,264]} },
	energique: { steps: 8, pattern: [1,0,1,0,1,0,1,0], bpm: 120, synth:{type:'sawtooth', notes:[110,220,330]} },
	reflechis: { steps: 8, pattern: [1,0,0,0,0,0,0,0], bpm: 80, synth:{type:'triangle', notes:[440]} },
	joyeux: { steps: 8, pattern: [1,0,1,0,0,1,0,1], bpm: 110, synth:{type:'sine', notes:[330,392]} }
};

let currentStep = 0;
let nextNoteTime = 0;

// Utilities: state persistence
function loadState(){
	try{
		const raw = localStorage.getItem('moodAvatarState');
		if(raw) Object.assign(state, JSON.parse(raw));
	}catch(e){console.warn(e)}
}
function saveState(){ localStorage.setItem('moodAvatarState', JSON.stringify(state)); }

function capitalize(s){ return s.charAt(0).toUpperCase()+s.slice(1); }

// UI wiring
function wireUI(){
	qs('#styleSelect').value = state.style;
	qs('#primaryColor').value = state.color;
	qs('#accessorySelect').value = state.accessory;
	qs('#morphRange').value = state.morph;
	[...document.querySelectorAll('input[name=mood]')].forEach(r=>{ r.checked = (r.value===state.mood); });
	if(qs('#presetSelect')) qs('#presetSelect').value = 'custom';
	if(qs('#bpmLabel')) qs('#bpmLabel').textContent = sequencer.bpm;

	qs('#styleSelect').addEventListener('change', e=>{ state.style=e.target.value; saveState(); draw(); });
	qs('#primaryColor').addEventListener('input', e=>{ state.color=e.target.value; saveState(); draw(); });
	qs('#accessorySelect').addEventListener('change', e=>{ state.accessory=e.target.value; saveState(); draw(); });
	qs('#morphRange').addEventListener('input', e=>{ state.morph=+e.target.value; saveState(); draw(); });
	[...document.querySelectorAll('input[name=mood]')].forEach(r=>r.addEventListener('change', e=>{ state.mood=e.target.value; qs('#moodLabel').textContent = 'Humeur: '+capitalize(state.mood); saveState(); if(isPlaying) restartAudio(); draw(); }));

	qs('#playBtn').addEventListener('click', startAudio);
	qs('#pauseBtn').addEventListener('click', stopAudio);
	qs('#exportBtn').addEventListener('click', exportImage);

	if(qs('#presetSelect')){
		qs('#presetSelect').addEventListener('change', e=>{
			const v = e.target.value; if(v && PRESETS[v]){ Object.assign(state, PRESETS[v]); saveState(); // refresh controls
				qs('#styleSelect').value=state.style; qs('#primaryColor').value=state.color; qs('#accessorySelect').value=state.accessory; qs('#morphRange').value=state.morph; [...document.querySelectorAll('input[name=mood]')].forEach(r=>{r.checked = (r.value===state.mood)}); draw();
			}
		});
	}
	if(qs('#randomBtn')) qs('#randomBtn').addEventListener('click', randomize);

	// BPM slider
	if(qs('#bpmRange')){
		qs('#bpmRange').addEventListener('input', e=>{ const v = +e.target.value; qs('#bpmLabel').textContent = v; sequencer.bpm = v; });
	}
}

		// Third-party music integration removed

// Drawing avatar (simple parametric face)
function draw(){
	const w = $canvas.width, h = $canvas.height;
	ctx.clearRect(0,0,w,h);

	// subtle canvas dance transform
	const danceX = Math.sin(kickPulse*2*Math.PI)*6;
	const danceY = Math.cos(kickPulse*2*Math.PI)*4;
	$canvas.classList.add('dance');
	$canvas.style.transform = `translate(${danceX}px, ${danceY}px) rotate(${Math.sin(kickPulse*2*Math.PI)*1.8}deg)`;

	// background radial
	const grad = ctx.createLinearGradient(0,0,0,h);
	grad.addColorStop(0, 'rgba(255,255,255,0.02)');
	grad.addColorStop(1, 'rgba(0,0,0,0.06)');
	ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

	const cx = w/2, cy = h/2 - 20;
	const headR = 140 + (state.morph-50)/2;
	ctx.save(); ctx.translate(cx,cy);

	// subtle pulsing from audio
	let pulse = 0;
	if(analyser && dataArray){ const v = dataArray.reduce((a,b)=>a+b,0)/dataArray.length/256; pulse = (v*12); }

	// face circle
	ctx.beginPath(); ctx.fillStyle = state.color; ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 24; ctx.arc(0,0,headR + pulse,0,Math.PI*2); ctx.fill();

	// eyes
	ctx.shadowBlur = 0; ctx.fillStyle = '#08121a'; const eyeY = -10 + Math.sin((Date.now()/500)+pulse)*2; const eyeX = 48;
	ctx.beginPath(); ctx.ellipse(-eyeX, eyeY, 14, 10, 0,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.ellipse(eyeX, eyeY, 14, 10, 0,0,Math.PI*2); ctx.fill();

	// mouth reflecting mood
	ctx.beginPath(); const mouthY = 48 + (state.mood==='reflechis'?6:0) + pulse/2;
	if(state.mood==='energique'){ ctx.fillStyle = '#fff'; ctx.arc(0, mouthY, 28, 0, Math.PI, false); ctx.fill(); }
	else if(state.mood==='joyeux'){ ctx.strokeStyle = '#04202f'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, mouthY, 30, 0, Math.PI, false); ctx.stroke(); }
	else{ ctx.fillStyle = 'rgba(4,32,47,0.85)'; ctx.fillRect(-26, mouthY-6, 52,12); }

	// accessory
	if(state.accessory==='glasses'){ ctx.strokeStyle = '#04202f'; ctx.lineWidth = 6; ctx.strokeRect(-78, -18, 56, 36); ctx.strokeRect(22,-18,56,36); ctx.beginPath(); ctx.moveTo(-22,0); ctx.lineTo(22,0); ctx.stroke(); }
	else if(state.accessory==='hat'){ ctx.fillStyle = '#08121a'; ctx.fillRect(-120, -110, 240, 36); ctx.fillRect(-70,-150,140,56); }
	else if(state.accessory==='earring'){ ctx.fillStyle='#ffd86b'; ctx.beginPath(); ctx.arc(88, 6, 8,0,Math.PI*2); ctx.fill(); }

	// style variations
	if(state.style==='pixel'){ ctx.fillStyle='rgba(0,0,0,0.03)'; for(let y=-headR; y<headR; y+=8) for(let x=-headR; x<headR; x+=8) if(Math.random()<0.05) ctx.fillRect(x,y,6,6); }
	else if(state.style==='line'){ ctx.strokeStyle='rgba(4,32,47,0.5)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,headR-6,0,Math.PI*2); ctx.stroke(); }

	ctx.restore();
}

// init audio components
function initAudio(){
	if(audioCtx) return;
	audioCtx = new (window.AudioContext || window.webkitAudioContext)();
	masterGain = audioCtx.createGain(); masterGain.gain.value = 0.6; masterGain.connect(audioCtx.destination);
	analyser = audioCtx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.7; analyser.minDecibels = -90; analyser.maxDecibels = -10; analyser.connect(masterGain);
	dataArray = new Uint8Array(analyser.frequencyBinCount);
}

// schedule a short kick at precise time
function scheduleKick(time){
	const o = audioCtx.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(120, time);
	const g = audioCtx.createGain(); g.gain.setValueAtTime(0.0001, time);
	o.connect(g); g.connect(analyser);
	o.start(time);
	g.gain.exponentialRampToValueAtTime(0.6, time + 0.01);
	g.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
	o.stop(time + 0.25);
	// visual pulse timed to audio
	setTimeout(()=>{ kickPulse = 1.0; setTimeout(()=>{ kickPulse = 0.0; }, 140); }, Math.max(0, (time - audioCtx.currentTime))*1000 + 10);
}

function scheduleStep(step, time){
	const pat = MOOD_PATTERNS[state.mood] || MOOD_PATTERNS.detendu;
	if(pat.pattern[step % pat.steps]) scheduleKick(time);
	// schedule synth transient
	const noteIdx = step % pat.synth.notes.length;
	const freq = pat.synth.notes[noteIdx];
	const o = audioCtx.createOscillator(); o.type = pat.synth.type; o.frequency.setValueAtTime(freq, time);
	const g = audioCtx.createGain(); g.gain.setValueAtTime(0.0001, time);
	o.connect(g); g.connect(analyser);
	o.start(time);
	g.gain.exponentialRampToValueAtTime(0.12, time + 0.02);
	g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
	o.stop(time + 0.25);
}

function schedulerTick(){
	if(!isPlaying || !audioCtx) return;
	const now = audioCtx.currentTime;
	const pat = MOOD_PATTERNS[state.mood] || MOOD_PATTERNS.detendu;
	const subdivision = pat.steps / 4; // heuristic
	while(nextNoteTime < now + SCHEDULE_AHEAD_TIME){
		scheduleStep(currentStep, nextNoteTime);
		nextNoteTime += 60.0 / sequencer.bpm / subdivision;
		currentStep = (currentStep + 1) % pat.steps;
	}
}

function startScheduler(){
	if(schedulerTimer) return;
	const pat = MOOD_PATTERNS[state.mood] || MOOD_PATTERNS.detendu;
	sequencer.bpm = qs('#bpmRange') ? +qs('#bpmRange').value : (pat.bpm || sequencer.bpm);
	if(qs('#bpmRange')) qs('#bpmLabel').textContent = sequencer.bpm;
	currentStep = 0; nextNoteTime = audioCtx.currentTime + 0.05;
	schedulerTimer = setInterval(schedulerTick, LOOKAHEAD_MS);
}

function stopScheduler(){ if(schedulerTimer){ clearInterval(schedulerTimer); schedulerTimer = null; } currentStep = 0; nextNoteTime = 0; }

// start/stop audio
function startAudio(){
	if(isPlaying) return;
	initAudio();
	const mood = state.mood;
	startTime = audioCtx.currentTime;
	oscNodes.forEach(n=>{ try{ n.stop && n.stop(); if(n.osc) n.osc.stop(); }catch(e){} }); oscNodes = [];

	// create background pad or elements per mood (still useful on top of sequenced notes)
	if(mood==='detendu'){
		const o1 = audioCtx.createOscillator(); const g1 = audioCtx.createGain(); o1.type='sine'; o1.frequency.value=220; g1.gain.value=0.18; o1.connect(g1); g1.connect(analyser);
		const o2 = audioCtx.createOscillator(); const g2 = audioCtx.createGain(); o2.type='sine'; o2.frequency.value=330; g2.gain.value=0.12; o2.connect(g2); g2.connect(analyser);
		o1.start(); o2.start(); oscNodes.push(o1,o2);
	}else if(mood==='energique'){
		for(let i=0;i<3;i++){ const o = audioCtx.createOscillator(); o.type='sawtooth'; o.frequency.value = 110*(i+1); const g = audioCtx.createGain(); g.gain.value = 0.0; o.connect(g); g.connect(analyser); o.start(); oscNodes.push({osc:o,gain:g}); }
		// small pulse loop remains optional (sequencer handles main kick)
	}else if(mood==='reflechis'){
		const o = audioCtx.createOscillator(); o.type='triangle'; o.frequency.value=440; const g = audioCtx.createGain(); g.gain.value = 0.06; o.connect(g); g.connect(analyser); o.start(); oscNodes.push(o);
	}else if(mood==='joyeux'){
		const o1 = audioCtx.createOscillator(); o1.type='sine'; o1.frequency.value = 330; const g1 = audioCtx.createGain(); g1.gain.value=0.12; o1.connect(g1); g1.connect(analyser); o1.start(); oscNodes.push(o1);
	}

	isPlaying = true;
	// visual feedback: add playing class to play button
	const playBtn = qs('#playBtn'); if(playBtn) playBtn.classList.add('playing');
	// connect nodes
	oscNodes.forEach(n=>{ if(n.connect) n.connect(analyser); else if(n.osc){ n.osc.connect(n.gain); n.gain.connect(analyser); } });

	audioCtx.resume();
	// start scheduler for mood-based sequencing
	startScheduler();
	requestAnimationFrame(audioLoop);
}

function stopAudio(){
	if(!isPlaying) return;
	oscNodes.forEach(n=>{ try{ n.stop && n.stop(); if(n.osc) n.osc.stop(); }catch(e){} }); oscNodes = [];
	isPlaying = false; stopScheduler();
	const playBtn = qs('#playBtn'); if(playBtn) playBtn.classList.remove('playing');
}

function restartAudio(){ stopAudio(); setTimeout(startAudio, 80); }

function audioLoop(){
	if(!isPlaying) return;
	analyser.getByteFrequencyData(dataArray);
	const waveAvg = dataArray.reduce((a,b)=>a+b,0)/dataArray.length/256;
	// small influence from kickPulse already applied in draw via transform
	const elapsed = (audioCtx.currentTime - startTime) % 30;
	const pct = Math.min(100, (elapsed/30)*100);
	qs('.progress-fill').style.width = pct + '%';
	draw();
	requestAnimationFrame(audioLoop);
}

function exportImage(){ const dataUrl = $canvas.toDataURL('image/png'); const a = document.createElement('a'); a.href = dataUrl; a.download = 'moodavatar.png'; document.body.appendChild(a); a.click(); a.remove(); }

function randomize(){
	const keys = Object.keys(PRESETS); const pick = PRESETS[keys[Math.floor(Math.random()*keys.length)]];
	state.style = pick.style; state.color = pick.color; state.accessory = pick.accessory;
	state.morph = Math.max(30, Math.min(70, pick.morph + Math.floor((Math.random()-0.5)*12)));
	state.mood = Math.random() < 0.6 ? pick.mood : ['detendu','energique','reflechis','joyeux'][Math.floor(Math.random()*4)];
	saveState(); qs('#styleSelect').value=state.style; qs('#primaryColor').value=state.color; qs('#accessorySelect').value=state.accessory; qs('#morphRange').value=state.morph; [...document.querySelectorAll('input[name=mood]')].forEach(r=>{r.checked = (r.value===state.mood)}); draw();
}

// Profile save/load
function saveProfile(){
	const nameInput = qs('#profileName');
	const name = nameInput && nameInput.value ? nameInput.value.trim() : '';
	if(!name) return alert('Entrez un nom pour le profil');
	const dataUrl = $canvas.toDataURL('image/png');
	const profile = { name, image: dataUrl, savedAt: Date.now() };
	localStorage.setItem('moodAvatarProfile', JSON.stringify(profile));
	applyProfileToHeader(profile);
	alert('Profil enregistré — ' + name);
}

function loadProfile(){
	try{
		const raw = localStorage.getItem('moodAvatarProfile');
		if(!raw) return null;
		return JSON.parse(raw);
	}catch(e){ return null }
}

function applyProfileToHeader(profile){
	const badge = qs('.user-badge');
	if(!badge) return;
	if(profile && profile.image){
		// replace svg with image
		badge.innerHTML = '';
		const img = document.createElement('img'); img.src = profile.image; img.alt = profile.name; img.width = 28; img.height = 28; img.style.borderRadius = '50%';
		const span = document.createElement('span'); span.className = 'user-name'; span.textContent = profile.name;
		badge.appendChild(img); badge.appendChild(span);
	}else{
		// leave default
	}
}

// boot
loadState(); wireUI(); draw();
// wire audio UI if available and initialize effect values
if(typeof wireAudioUI === 'function') wireAudioUI();
if(typeof updateEffectsFromUI === 'function') updateEffectsFromUI();
// load saved profile and apply to header
const existingProfile = loadProfile();
if(existingProfile){ applyProfileToHeader(existingProfile); if(qs('#profileName')) qs('#profileName').value = existingProfile.name; }
// wire save profile button
if(qs('#saveProfileBtn')) qs('#saveProfileBtn').addEventListener('click', saveProfile);

// Accessibility: keyboard play/pause
window.addEventListener('keydown', e=>{ if(e.key===' '){ e.preventDefault(); isPlaying?stopAudio():startAudio(); } });
