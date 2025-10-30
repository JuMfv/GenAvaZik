// MoodAvatar - main.js
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

// Audio setup
let audioCtx = null;
let masterGain = null;
let oscNodes = [];
let analyser = null;
let dataArray = null;
let isPlaying = false;
let startTime = 0;

// Restore from localStorage
function loadState(){
	try{
		const raw = localStorage.getItem('moodAvatarState');
		if(raw) Object.assign(state, JSON.parse(raw));
	}catch(e){console.warn(e)}
}
function saveState(){
	localStorage.setItem('moodAvatarState', JSON.stringify(state));
}

function wireUI(){
	qs('#styleSelect').value = state.style;
	qs('#primaryColor').value = state.color;
	qs('#accessorySelect').value = state.accessory;
	qs('#morphRange').value = state.morph;
	[...document.querySelectorAll('input[name=mood]')].forEach(r=>{r.checked = (r.value===state.mood)});

	qs('#styleSelect').addEventListener('change', e=>{state.style=e.target.value; saveState(); draw();});
	qs('#primaryColor').addEventListener('input', e=>{state.color=e.target.value; saveState(); draw();});
	qs('#accessorySelect').addEventListener('change', e=>{state.accessory=e.target.value; saveState(); draw();});
	qs('#morphRange').addEventListener('input', e=>{state.morph=+e.target.value; saveState(); draw();});
	[...document.querySelectorAll('input[name=mood]')].forEach(r=>r.addEventListener('change', e=>{state.mood=e.target.value; qs('#moodLabel').textContent = 'Humeur: '+capitalize(state.mood); saveState(); if(isPlaying) restartAudio(); draw();}));

	qs('#playBtn').addEventListener('click', startAudio);
	qs('#pauseBtn').addEventListener('click', stopAudio);
	qs('#exportBtn').addEventListener('click', exportImage);
}

function capitalize(s){return s.charAt(0).toUpperCase()+s.slice(1)}

// Drawing avatar (simple parametric face)
function draw(timestamp){
	const w = $canvas.width, h = $canvas.height;
	ctx.clearRect(0,0,w,h);

	// background radial
	const grad = ctx.createLinearGradient(0,0,0,h);
	grad.addColorStop(0, 'rgba(255,255,255,0.02)');
	grad.addColorStop(1, 'rgba(0,0,0,0.06)');
	ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

	// head
	const cx = w/2, cy = h/2 - 20;
	const headR = 140 + (state.morph-50)/2;
	ctx.save();
	ctx.translate(cx,cy);

	// subtle pulsing from audio
	let pulse = 0;
	if(analyser && dataArray){
		const v = dataArray.reduce((a,b)=>a+b,0)/dataArray.length/256;
		pulse = (v*12);
	}

	// face circle
	ctx.beginPath();
	ctx.fillStyle = state.color;
	ctx.shadowColor = 'rgba(0,0,0,0.4)';
	ctx.shadowBlur = 24;
	ctx.arc(0,0,headR + pulse,0,Math.PI*2);
	ctx.fill();

	// eyes
	ctx.shadowBlur = 0;
	ctx.fillStyle = '#08121a';
	const eyeY = -10 + Math.sin((Date.now()/500)+pulse)*2;
	const eyeX = 48;
	ctx.beginPath(); ctx.ellipse(-eyeX, eyeY, 14, 10, 0,0,Math.PI*2); ctx.fill();
	ctx.beginPath(); ctx.ellipse(eyeX, eyeY, 14, 10, 0,0,Math.PI*2); ctx.fill();

	// mouth reflecting mood
	ctx.beginPath();
	const mouthY = 48 + (state.mood==='reflechis'?6:0) + pulse/2;
	if(state.mood==='energique'){
		ctx.fillStyle = '#fff'; ctx.arc(0, mouthY, 28, 0, Math.PI, false); ctx.fill();
	}else if(state.mood==='joyeux'){
		ctx.strokeStyle = '#04202f'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, mouthY, 30, 0, Math.PI, false); ctx.stroke();
	}else{
		ctx.fillStyle = 'rgba(4,32,47,0.85)'; ctx.fillRect(-26, mouthY-6, 52,12);
	}

	// accessory
	if(state.accessory==='glasses'){
		ctx.strokeStyle = '#04202f'; ctx.lineWidth = 6; ctx.strokeRect(-78, -18, 56, 36); ctx.strokeRect(22,-18,56,36); ctx.beginPath(); ctx.moveTo(-22,0); ctx.lineTo(22,0); ctx.stroke();
	}else if(state.accessory==='hat'){
		ctx.fillStyle = '#08121a'; ctx.fillRect(-120, -110, 240, 36); ctx.fillRect(-70,-150,140,56);
	}else if(state.accessory==='earring'){
		ctx.fillStyle='#ffd86b'; ctx.beginPath(); ctx.arc(88, 6, 8,0,Math.PI*2); ctx.fill();
	}

	// simple style variations
	if(state.style==='pixel'){
		// overlay pixel grid effect
		ctx.fillStyle='rgba(0,0,0,0.03)';
		for(let y=-headR; y<headR; y+=8) for(let x=-headR; x<headR; x+=8) if(Math.random()<0.05) ctx.fillRect(x,y,6,6);
	}else if(state.style==='line'){
		ctx.strokeStyle='rgba(4,32,47,0.5)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,headR-6,0,Math.PI*2); ctx.stroke();
	}

	ctx.restore();

}

// Audio generation per mood (simple synth loops)
function initAudio(){
	if(audioCtx) return;
	audioCtx = new (window.AudioContext || window.webkitAudioContext)();
	masterGain = audioCtx.createGain(); masterGain.gain.value = 0.6; masterGain.connect(audioCtx.destination);
	analyser = audioCtx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.7; analyser.minDecibels = -90; analyser.maxDecibels = -10; analyser.connect(masterGain);
	dataArray = new Uint8Array(analyser.frequencyBinCount);
}

function startAudio(){
	if(isPlaying) return;
	initAudio();
	// create simple pattern depending on mood
	const mood = state.mood;
	const now = audioCtx.currentTime;
	startTime = now;
	// stop existing
	oscNodes.forEach(n=>n.stop && n.stop()); oscNodes=[];

	if(mood==='detendu'){
		// soft pad: two slow oscillators
		const o1 = audioCtx.createOscillator(); const g1 = audioCtx.createGain(); o1.type='sine'; o1.frequency.value=220; g1.gain.value=0.18; o1.connect(g1); g1.connect(analyser);
		const o2 = audioCtx.createOscillator(); const g2 = audioCtx.createGain(); o2.type='sine'; o2.frequency.value=330; g2.gain.value=0.12; o2.connect(g2); g2.connect(analyser);
		o1.start(); o2.start(); oscNodes.push(o1,o2);
	}else if(mood==='energique'){
		// rhythmic saw pulses
		const pattern = [0.2,0.05,0.2,0.1,0.05];
		for(let i=0;i<3;i++){
			const o = audioCtx.createOscillator(); o.type='sawtooth'; o.frequency.value = 110*(i+1); const g = audioCtx.createGain(); g.gain.value = 0.0; o.connect(g); g.connect(analyser); o.start(); oscNodes.push({osc:o,gain:g});
		}
		// schedule pulsing gain
		const schedulePulse = ()=>{
			const t = audioCtx.currentTime;
			oscNodes.forEach((n,idx)=>{ if(n.gain){ n.gain.cancelScheduledValues(t); n.gain.setValueAtTime(0.001,t); n.gain.linearRampToValueAtTime(0.12/(idx+1), t+0.02); n.gain.exponentialRampToValueAtTime(0.001, t+0.18); }});
			// repeat
			if(isPlaying) setTimeout(schedulePulse, 350);
		};
		schedulePulse();
	}else if(mood==='reflechis'){
		// plucked bell
		const o = audioCtx.createOscillator(); o.type='triangle'; o.frequency.value=440; const g = audioCtx.createGain(); g.gain.value = 0.15; o.connect(g); g.connect(analyser); o.start(); oscNodes.push(o);
	}else if(mood==='joyeux'){
		const o1 = audioCtx.createOscillator(); o1.type='sine'; o1.frequency.value = 330; const g1 = audioCtx.createGain(); g1.gain.value=0.2; o1.connect(g1); g1.connect(analyser); o1.start(); oscNodes.push(o1);
	}

	isPlaying = true;
	// connect nodes directly to analyser or master
	oscNodes.forEach(n=>{
		if(n.connect) n.connect(analyser);
		else if(n.osc){ n.osc.connect(n.gain); n.gain.connect(analyser); }
	});

	audioCtx.resume();
	requestAnimationFrame(audioLoop);
}

function stopAudio(){
	if(!isPlaying) return;
	// stop oscillators
	oscNodes.forEach(n=>{ try{ n.stop && n.stop(); if(n.osc) n.osc.stop(); }catch(e){} });
	oscNodes=[];
	isPlaying=false;
}

function restartAudio(){ stopAudio(); setTimeout(startAudio, 80); }

function audioLoop(){
	if(!isPlaying) return;
	analyser.getByteFrequencyData(dataArray);
	// update progress simple loop
	const elapsed = (audioCtx.currentTime - startTime) % 30; // fake progress
	const pct = Math.min(100, (elapsed/30)*100);
	qs('.progress-fill').style.width = pct + '%';

	// use waveform to influence morph or bob
	const waveAvg = dataArray.reduce((a,b)=>a+b,0)/dataArray.length/256;
	// tweak morph slightly by audio
	draw();
	requestAnimationFrame(audioLoop);
}

function exportImage(){
	const dataUrl = $canvas.toDataURL('image/png');
	const a = document.createElement('a'); a.href = dataUrl; a.download = 'moodavatar.png'; document.body.appendChild(a); a.click(); a.remove();
}

// boot
loadState(); wireUI(); draw();

// Accessibility: keyboard play/pause
window.addEventListener('keydown', e=>{
	if(e.key===' '){ e.preventDefault(); isPlaying?stopAudio():startAudio(); }
});
