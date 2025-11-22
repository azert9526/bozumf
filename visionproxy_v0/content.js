// --- CONFIGURARE ---
const API_KEY = "KEY"; // <--- PUNE CHEIA TA AICI
const FLASH_THRESHOLD = 10; // Sensibilitate normală
const INSTANT_KILL_THRESHOLD = 25; // Flash masiv care declanșează blocarea INSTANT
const RISK_BUILD = 6; // Creștere normală
const RISK_DECAY = 3; // Scădere când e calm

console.log("NeuroShield: Zero-Latency Engine Loaded");

// --- SETUP UI (Overlay & Canvas) ---
const overlay = document.createElement('div');
overlay.id = 'neuro-overlay-global';
overlay.innerHTML = `
    <div class="warning-text">RISK BLOCKED</div>
    <div id="ai-loading" style="color:gray; margin-top:10px;">Analyzing Scene...</div>
    <div id="ai-result" class="ai-summary-box" style="display:none;"></div>
`;
document.body.appendChild(overlay);

// Canvas pentru procesare (micșorat pentru viteză)
const procCanvas = document.createElement('canvas');
const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });
procCanvas.width = 32;
procCanvas.height = 32;

let riskLevel = 0;
let isProtecting = false;
let lastSummaryTime = 0;

// --- AI SUMMARY (Neschimbat) ---
async function generateAISummary(videoElement) {
    const now = Date.now();
    if (now - lastSummaryTime < 15000) return;
    lastSummaryTime = now;

    // Captură High-Res pentru AI
    const aiCanvas = document.createElement('canvas');
    aiCanvas.width = 300;
    aiCanvas.height = 200;
    try {
        aiCanvas.getContext('2d').drawImage(videoElement, 0, 0, 300, 200);
    } catch (e) { return; }

    const base64Image = aiCanvas.toDataURL('image/jpeg', 0.5).split(',')[1];

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Describe scene in 1 sentence for blind person. Ignore flashes." },
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                        ]
                    }
                ],
                max_tokens: 40
            })
        });
        const data = await response.json();
        if (data.choices) {
            const description = data.choices[0].message.content;
            document.getElementById('ai-loading').style.display = 'none';
            document.getElementById('ai-result').style.display = 'block';
            document.getElementById('ai-result').innerText = description;
        }
    } catch (error) { console.error(error); }
}

// --- POZIȚIONARE OVERLAY ---
function updateOverlayPosition(video) {
    if (!isProtecting) return;
    const rect = video.getBoundingClientRect();
    if (rect.width === 0) { overlay.style.opacity = '0'; return; }

    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.opacity = '1';
}

// --- ANALIZA LUMINANȚEI ---
function getLuma(video) {
    try {
        // Desenăm frame-ul curent
        procCtx.drawImage(video, 0, 0, 32, 32);
        const frame = procCtx.getImageData(0, 0, 32, 32).data;
        let total = 0;
        let count = 0;

        // Sampling optimizat (sărim pixeli pentru viteză la 60fps)
        for (let i = 0; i < frame.length; i += 16) {
            total += frame[i] * 0.299 + frame[i + 1] * 0.587 + frame[i + 2] * 0.114;
            count++;
        }
        return total / count;
    } catch (e) { return -1; }
}

// --- ENGINE-UL ZERO-LATENCY ---
function startAnalysis(video) {
    let lastLuma = -1;

    // Folosim requestVideoFrameCallback în loc de setInterval
    // Aceasta se execută FIECARE FRAME, exact când e gata de randare.
    const onFrame = (now, metadata) => {
        if (!document.contains(video) || video.paused || video.ended) {
            // Dacă video-ul s-a oprit, re-verificăm peste 1 secundă
            // (nu putem folosi RVFC pe video oprit)
            setTimeout(() => video.requestVideoFrameCallback(onFrame), 1000);
            return;
        }

        if (isProtecting) updateOverlayPosition(video);

        const currLuma = getLuma(video);

        if (currLuma !== -1) {
            let diff = 0;
            if (lastLuma !== -1) diff = Math.abs(currLuma - lastLuma);
            lastLuma = currLuma;

            // --- LOGICA "INSTANT KILL" ---
            if (diff > INSTANT_KILL_THRESHOLD) {
                // Flash MASIV detectat -> Blocăm instant, nu așteptăm acumularea
                riskLevel = 100;
            }
            else if (diff > FLASH_THRESHOLD) {
                // Flash mediu -> Acumulăm risc
                riskLevel += RISK_BUILD;
            }
            else {
                // Calm -> Scădem risc
                riskLevel -= RISK_DECAY;
            }

            // Limite
            riskLevel = Math.max(0, Math.min(100, riskLevel));

            // --- TRIGGER ---
            if (riskLevel > 50) {
                if (!isProtecting) {
                    isProtecting = true;
                    video.classList.add('neuroshield-active');
                    updateOverlayPosition(video);

                    // UI Reset
                    document.getElementById('ai-loading').style.display = 'block';
                    document.getElementById('ai-result').style.display = 'none';

                    //generateAISummary(video);
                }
            } else {
                if (isProtecting) {
                    isProtecting = false;
                    video.classList.remove('neuroshield-active');
                    overlay.style.opacity = '0';
                }
            }
        }

        // Cerem următorul frame
        video.requestVideoFrameCallback(onFrame);
    };

    // Pornim bucla
    video.requestVideoFrameCallback(onFrame);
}

// --- INIȚIALIZARE ---
// Verificăm periodic pentru videouri noi
setInterval(() => {
    document.querySelectorAll('video').forEach(v => {
        if (!v.dataset.nsActive) {
            v.dataset.nsActive = "true";
            try { v.crossOrigin = "anonymous"; } catch (e) { }
            console.log("NeuroShield: Hooked video", v);
            startAnalysis(v);
        }
    });
}, 2000);
