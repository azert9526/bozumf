// --- CONFIGURARE ---
const API_KEY = "PUNE_AICI_CHEIA_OPENAI"; // <--- CHEIA TA AICI
const SAMPLE_RATE = 100;
const FLASH_THRESHOLD = 10;
const RISK_BUILD = 20;
const RISK_DECAY = 2;

console.log("NeuroShield: YouTube AI version loaded");

// --- SETUP UI ---
// Creăm un overlay GLOBAL care va fi mutat dinamic peste video
const overlay = document.createElement('div');
overlay.id = 'neuro-overlay-global';
overlay.innerHTML = `
    <div class="warning-text">⚠️ SEIZURE RISK BLOCKED</div>
    <div id="ai-loading" style="color:gray; margin-top:10px;">AI Analyzing Scene...</div>
    <div id="ai-result" class="ai-summary-box" style="display:none;"></div>
`;
document.body.appendChild(overlay);

// Canvas Invizibil (Procesare)
const procCanvas = document.createElement('canvas');
const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });
procCanvas.width = 64;
procCanvas.height = 64;

// Variabile de stare
let riskLevel = 0;
let isProtecting = false;
let lastSummaryTime = 0; // Să nu spammăm AI-ul

// --- FUNCȚIA AI VISION (Summarization) ---
async function generateAISummary(videoElement) {
    const now = Date.now();
    if (now - lastSummaryTime < 10000) return; // Maxim 1 request la 10 secunde (să nu consumi banii)
    lastSummaryTime = now;

    console.log("NeuroShield: Generare AI Summary...");

    // 1. Capturăm frame-ul CLAR (înainte de blur, din canvas)
    // Facem un canvas temporar mai mare pentru AI (300px e destul)
    const aiCanvas = document.createElement('canvas');
    aiCanvas.width = 300;
    aiCanvas.height = 200;
    try {
        aiCanvas.getContext('2d').drawImage(videoElement, 0, 0, 300, 200);
    } catch (e) { return; } // CORS block

    const base64Image = aiCanvas.toDataURL('image/jpeg', 0.5).split(',')[1];

    // 2. Trimitem la OpenAI
    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini", // Folosim mini pt viteză
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Describe this scene in 1 short sentence for a blind person. Ignore flashing lights. Start with 'Scene shows:'" },
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                        ]
                    }
                ],
                max_tokens: 30
            })
        });

        const data = await response.json();
        const description = data.choices[0].message.content;

        // 3. Afișăm rezultatul
        const aiResDiv = document.getElementById('ai-result');
        const aiLoadDiv = document.getElementById('ai-loading');

        aiLoadDiv.style.display = 'none';
        aiResDiv.style.display = 'block';
        aiResDiv.innerText = description;

    } catch (error) {
        console.error("AI Error:", error);
    }
}

// --- POSITIONING OVERLAY (Fix pentru YouTube) ---
function updateOverlayPosition(video) {
    if (!isProtecting) return;

    const rect = video.getBoundingClientRect();

    // Dacă video-ul nu e vizibil, ascundem overlay
    if (rect.width === 0 || rect.height === 0) {
        overlay.style.opacity = '0';
        return;
    }

    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.opacity = '1';
}

// --- ANALIZA ---
function getLuma(video) {
    try {
        procCtx.drawImage(video, 0, 0, 64, 64);
        const frame = procCtx.getImageData(0, 0, 64, 64).data;
        let total = 0;
        for (let i = 0; i < frame.length; i += 4) {
            total += frame[i] * 0.299 + frame[i + 1] * 0.587 + frame[i + 2] * 0.114;
        }
        return total / (frame.length / 4);
    } catch (e) { return -1; }
}

function analyze(video) {
    if (video.paused || video.ended) return;

    let lastLuma = -1;

    const loop = setInterval(() => {
        if (!document.contains(video)) { clearInterval(loop); overlay.style.opacity = '0'; return; }

        // Actualizăm poziția overlay-ului mereu (în caz că dai scroll)
        if (isProtecting) updateOverlayPosition(video);

        const currLuma = getLuma(video);
        // CORS Bypass logic pentru Demo: Dacă e -1, nu facem nimic pe Youtube real,
        // dar pe demo.html va merge.
        if (currLuma === -1) return;

        let diff = 0;
        if (lastLuma !== -1) diff = Math.abs(currLuma - lastLuma);
        lastLuma = currLuma;

        if (diff > FLASH_THRESHOLD) riskLevel += RISK_BUILD;
        else riskLevel -= RISK_DECAY;

        riskLevel = Math.max(0, Math.min(100, riskLevel));

        // --- LOGICA DE ACTIVARE ---
        if (riskLevel > 50) {
            if (!isProtecting) {
                // START PROTECȚIE
                isProtecting = true;
                video.classList.add('neuroshield-active');
                updateOverlayPosition(video);

                // Resetăm textul AI
                document.getElementById('ai-loading').style.display = 'block';
                document.getElementById('ai-result').style.display = 'none';

                // Cerem AI Summary
                generateAISummary(video);
            }
        } else {
            if (isProtecting) {
                // STOP PROTECȚIE
                isProtecting = false;
                video.classList.remove('neuroshield-active');
                overlay.style.opacity = '0';
            }
        }
    }, SAMPLE_RATE);
}

// Init
setInterval(() => {
    document.querySelectorAll('video').forEach(v => {
        if (!v.dataset.nsActive) {
            v.dataset.nsActive = "true";
            // Încercăm anonymous, dar YouTube s-ar putea să nu dea voie.
            // PENTRU HACKATHON: Dacă YouTube blochează pixelii (CORS),
            // demo-ul îl faci pe fișierul local demo_flash.html care merge 100%.
            try { v.crossOrigin = "anonymous"; } catch (e) { }
            analyze(v);
        }
    });
}, 1000);
