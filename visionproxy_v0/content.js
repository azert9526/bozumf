// Config
// const API_KEY = "PUNE_AICI_CHEIA"; // <--- CHEIA TA AICI

// Setari interne
const LUMA_MIN_DIFFERENCE = 5;
const RISK_BUILD = 15;
const RISK_DECAY = 5;
const THRESHOLD = 40;

// Stare
let isPhotosensitiveMode = true; // Din setari
let riskLevel = 0;
let isProtecting = false;
let lastSummaryTime = 0;

console.log("VisionProxy: Running");

// UI SETUP
const overlay = document.createElement('div');
overlay.id = 'vp-overlay';
overlay.innerHTML = `
    <div class="vp-warning">VisionProxy Active</div>
    <div id="vp-loading" style="color:gray; margin-top:10px;">Analyzing scene...</div>
    <div id="vp-result" class="vp-ai-box" style="display:none;"></div>
`;
document.body.appendChild(overlay);

// Canvas Procesare
const procCanvas = document.createElement('canvas');
const ctx = procCanvas.getContext('2d', { willReadFrequently: true });
procCanvas.width = 32;
procCanvas.height = 32;


// Sync Setari
chrome.storage.local.get({ isPhotosensitiveMode: true }, (items) => {
    isPhotosensitiveMode = items.isPhotosensitiveMode;
    if (!isPhotosensitiveMode) cleanupProtection();
});

chrome.storage.onChanged.addListener((changes) => {
    if (changes.isPhotosensitiveMode) {
        isPhotosensitiveMode = changes.isPhotosensitiveMode.newValue;
        console.log("Mod Fotosensibil schimbat:", isPhotosensitiveMode);

        if (!isPhotosensitiveMode) {
            cleanupProtection();
        }
    }
});

function cleanupProtection() {
    isProtecting = false;
    // Lasam extensia sa mearga dar fara ecran protector
    overlay.style.opacity = '0';
    document.querySelectorAll('video').forEach(v => v.classList.remove('vp-active'));
}


// --- FUNCȚII CORE ---

/*
async function getAISummary(video) {
    // Facem cererea doar dacă modul e activ, altfel nu are sens să consumăm API
    if (!isPhotosensitiveMode) return;

    const now = Date.now();
    if (now - lastSummaryTime < 15000) return;
    lastSummaryTime = now;

    const capCanvas = document.createElement('canvas');
    capCanvas.width = 300;
    capCanvas.height = 200;
    try { capCanvas.getContext('2d').drawImage(video, 0, 0, 300, 200); } catch (e) { return; }

    const base64 = capCanvas.toDataURL('image/jpeg', 0.5).split(',')[1];

    try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{
                    role: "user",
                    content: [
                        { type: "text", text: "Describe scene in 1 short sentence for blind person. Ignore flashes." },
                        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } }
                    ]
                }],
                max_tokens: 40
            })
        });
        const data = await res.json();
        if (data.choices) {
            document.getElementById('vp-loading').style.display = 'none';
            document.getElementById('vp-result').style.display = 'block';
            document.getElementById('vp-result').innerText = data.choices[0].message.content;
        }
    } catch (e) { console.error(e); }
}
*/

// Putem obtine exact coordonatele elementului video
function updateOverlayPos(video) {
    const rect = video.getBoundingClientRect();
    if (rect.width === 0) return;

    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
}

// Practic o functie care calculeaza cat de luminoase sunt frame-urile fata
function getLuma(video) {
    try {
        ctx.drawImage(video, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let total = 0;
        for (let i = 0; i < data.length; i += 8) {
            total += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        }
        return total / (data.length / 8);
    } catch (e) { return -1; }
}

// Procesam video si vedem intre doua frame-uri cum difera luma-ul
function processVideo(video) {
    let lastLuma = -1;

    const onFrame = () => {
        if (!document.contains(video) || video.paused || video.ended) {
            setTimeout(() => video.requestVideoFrameCallback(onFrame), 500);
            return;
        }

        if (isProtecting && isPhotosensitiveMode) updateOverlayPos(video);

        const curr = getLuma(video);
        if (curr !== -1) {
            let diff = 0;
            if (lastLuma !== -1) diff = Math.abs(curr - lastLuma);
            lastLuma = curr;

            // Permanent calculam riscul sa putem actualiza baza de date
            if (diff > LUMA_MIN_DIFFERENCE) {
                riskLevel += RISK_BUILD;
            } else {
                riskLevel -= RISK_DECAY;
            }
            riskLevel = Math.max(0, Math.min(100, riskLevel));

            // Daca e modul activ punem protectia
            if (riskLevel > THRESHOLD) {
                if (isPhotosensitiveMode) {
                    if (!isProtecting) {
                        isProtecting = true;

                        video.classList.add('vp-active');
                        overlay.style.opacity = '1';
                        updateOverlayPos(video);

                        // Reset UI
                        document.getElementById('vp-loading').style.display = 'block';
                        document.getElementById('vp-result').style.display = 'none';
                        // getAISummary(video);
                    }
                } else {
                    if (isProtecting) cleanupProtection();
                }
            } else {
                // Riscul deja a scazut sub Threshold
                if (isProtecting) cleanupProtection();
            }
        }
        video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
}

// Init
setInterval(() => {
    document.querySelectorAll('video').forEach(v => {
        if (!v.dataset.vpHook) {
            v.dataset.vpHook = "true";
            try { v.crossOrigin = "anonymous"; } catch (e) { }
            processVideo(v);
        }
    });
}, 500);
