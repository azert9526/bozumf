// --- CONFIGURARE ---
const API_URL = "http://localhost:8000"; 

// Parametri Analiză
const THRESHOLD = 40;
const LUMA_DIFF_MIN = 5;
const RISK_BUILD = 15;
const RISK_DECAY = 5;

// --- STARE ---
let isPhotosensitiveMode = true;
let isProtecting = false;
let currentVideoId = null; // ID-ul video-ului curent activ

// Stare pentru Inregistrare (Real-time)
let recordedBlockers = []; 
let currentBlockerStart = null;
let hasNewData = false;

console.log("VisionProxy: Client Loaded (Auto-Save Fixed)");

// --- 1. UI SETUP ---
const overlay = document.createElement('div');
overlay.id = 'vp-overlay';
overlay.innerHTML = `
    <div class="vp-warning">VisionProxy Active</div>
    <div id="vp-status" style="color:#ccc; margin-top:10px; font-size:12px;">Initializing...</div>
`;
document.body.appendChild(overlay);

const procCanvas = document.createElement('canvas');
const ctx = procCanvas.getContext('2d', { willReadFrequently: true });
procCanvas.width = 32;
procCanvas.height = 32;

// --- 2. SYNC SETARI ---
chrome.storage.local.get({ isPhotosensitiveMode: true }, (items) => {
    isPhotosensitiveMode = items.isPhotosensitiveMode;
    if (!isPhotosensitiveMode) cleanupVisuals();
});

chrome.storage.onChanged.addListener((changes) => {
    if (changes.isPhotosensitiveMode) {
        isPhotosensitiveMode = changes.isPhotosensitiveMode.newValue;
        if (!isPhotosensitiveMode) cleanupVisuals();
    }
});

function cleanupVisuals() {
    overlay.style.opacity = '0';
    document.querySelectorAll('video').forEach(v => v.classList.remove('vp-active'));
}

function updateOverlayPos(video) {
    const rect = video.getBoundingClientRect();
    if (rect.width === 0) return;
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
}

// --- 3. COMUNICARE CU SERVERUL ---

async function checkDB(videoId) {
    try {
        console.log(`${API_URL}/check?id=${videoId}`);
        const res = await fetch(`${API_URL}/check?id=${videoId}`);

        const data = await res.json();
        console.log(`DB Check for ${videoId}:`, data.found ? "Found" : "Not Found");
        return data; 
    } catch (e) {
        console.log("Server offline. Using local analysis.", e);
        return { found: false };
    }
}

// Funcția CRITICĂ de salvare
async function saveToDB() {
    if (!hasNewData || !currentVideoId || recordedBlockers.length === 0) return;

    console.log(`💾 Saving ${recordedBlockers.length} blockers for video ${currentVideoId}...`);
    
    const payload = JSON.stringify({
        video_id: currentVideoId,
        blockers: recordedBlockers
    });

    try {
        // Folosim keepalive: true ca să nu moară requestul dacă se închide tabul
        await fetch(`${API_URL}/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true 
        });
        
        console.log("✅ Data saved successfully!");
        // Resetăm starea după salvare
        hasNewData = false;
        recordedBlockers = [];
    } catch (e) {
        console.error("❌ Save failed:", e);
    }
}

// --- 4. MOD 1: PRE-COMPUTED (Din Baza de Date) ---
function runPrecomputedMode(video, blockers, activeId) {
    console.log("MODE: Database (Blockers known)");
    document.getElementById('vp-status').innerText = "Database Protection";

    const loop = () => {
        // Dacă s-a schimbat video-ul între timp, oprim bucla veche
        if (currentVideoId !== activeId) return;

        if (video.paused || video.ended) {
            requestAnimationFrame(loop);
            return;
        }

        const nowMs = video.currentTime * 1000;
        let shouldBlock = false;

        for (let b of blockers) {
            // Support pentru ambele formate (DB vs Local)
            const start = b.start_time_ms || b.startTime;
            const end = b.end_time_ms || b.endTime;
            
            if (nowMs >= start && nowMs <= end) {
                shouldBlock = true;
                break;
            }
        }

        if (shouldBlock) {
            if (isPhotosensitiveMode && !isProtecting) {
                isProtecting = true;
                video.classList.add('vp-active');
                overlay.style.opacity = '1';
                updateOverlayPos(video);
            } else if (isProtecting) {
                updateOverlayPos(video);
            }
        } else {
            if (isProtecting) {
                isProtecting = false;
                video.classList.remove('vp-active');
                overlay.style.opacity = '0';
            }
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}

// --- 5. MOD 2: REAL-TIME (Analiză + Înregistrare) ---
function getLuma(video) {
    try {
        ctx.drawImage(video, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let total = 0;
        for (let i = 0; i < data.length; i += 8) {
            total += data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
        }
        return total / (data.length / 8);
    } catch (e) { return -1; }
}

function runRealtimeMode(video, activeId) {
    console.log("MODE: Real-Time Analysis");
    document.getElementById('vp-status').innerText = "Analyzing Live...";

    let lastLuma = -1;
    let riskLevel = 0;

    // Resetăm buffer-ul local pentru noul video
    recordedBlockers = [];
    hasNewData = false;

    const onFrame = () => {
        // Dacă s-a schimbat video-ul, oprim bucla curentă
        if (currentVideoId !== activeId) return;

        if (!document.contains(video) || video.paused || video.ended) {
            setTimeout(() => video.requestVideoFrameCallback(onFrame), 250);
            return;
        }

        if (isProtecting && isPhotosensitiveMode) updateOverlayPos(video);

        const curr = getLuma(video);
        
        if (curr !== -1) {
            let diff = 0;
            if (lastLuma !== -1) diff = Math.abs(curr - lastLuma);
            lastLuma = curr;

            if (diff > LUMA_DIFF_MIN) {
                riskLevel += (diff > 50) ? 50 : RISK_BUILD;
            } else {
                riskLevel -= RISK_DECAY;
            }
            riskLevel = Math.max(0, Math.min(100, riskLevel));

            // --- TRIGGER ---
            if (riskLevel > THRESHOLD) {
                if (!isProtecting) {
                    isProtecting = true;
                    
                    if (isPhotosensitiveMode) {
                        video.classList.add('vp-active');
                        overlay.style.opacity = '1';
                        updateOverlayPos(video);
                    }

                    // Start Record
                    currentBlockerStart = Math.floor(video.currentTime * 1000);
                    currentBlockerStart = Math.max(0, currentBlockerStart - 200);
                }
            } else {
                if (isProtecting) {
                    isProtecting = false;

                    if (isPhotosensitiveMode) {
                        video.classList.remove('vp-active');
                        overlay.style.opacity = '0';
                    }

                    // End Record -> Save to RAM
                    if (currentBlockerStart !== null) {
                        const end = Math.floor(video.currentTime * 1000);
                        recordedBlockers.push({
                            start_time_ms: Math.max(0, currentBlockerStart - 500),
                            end_time_ms: end + 500,
                            description: "Auto-detected flash"
                        });
                        hasNewData = true;
                        currentBlockerStart = null;
                        console.log("Captured Segment:", recordedBlockers[recordedBlockers.length-1]);
                    }
                }
            }
        }
        video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);

    // Ascultăm când se termină video-ul ca să salvăm
    video.addEventListener('ended', () => {
        if (currentVideoId === activeId) {
            console.log("Video ended. Saving data...");
            saveToDB();
        }
    }, { once: true });
}

// --- 6. INIT CONTROLLER (Logică de Navigare) ---

function enableVideoCORS(video) {
    if (video.crossOrigin) return;
    try { video.crossOrigin = "use-credentials"; } catch (e) {}
}

async function handleVideoChange(video) {
    // 1. Luăm ID-ul nou din URL
    const urlParams = new URLSearchParams(window.location.search);
    const newVideoId = urlParams.get('v');


    if (!newVideoId) return; // Nu e video valid

    // 2. Dacă e același video pe care îl procesăm deja, nu facem nimic
    if (newVideoId === currentVideoId) return;

    // 3. SCHIMBARE DE CONTEXT DETECTATĂ!
    console.log(`🔄 Switching from ${currentVideoId} to ${newVideoId}`);

    // 3a. Salvăm datele vechi (dacă există) înainte să schimbăm
    if (currentVideoId && hasNewData) {
        await saveToDB();
    }

    // 3b. Actualizăm ID-ul curent
    currentVideoId = newVideoId;
    
    // 3c. Resetăm vizualul
    cleanupVisuals();

    // 4. Verificăm baza de date pentru noul video
    const dbData = await checkDB(newVideoId);

    if (dbData.found && dbData.blockers && dbData.blockers.length > 0) {
        runPrecomputedMode(video, dbData.blockers, newVideoId);
    } else {
        runRealtimeMode(video, newVideoId);
    }
}



// --- LOOP PRINCIPAL ---
// Verificăm periodic dacă URL-ul s-a schimbat (Navigare YouTube)
setInterval(() => {
    document.querySelectorAll('video').forEach(v => {
        // Activăm CORS mereu
        enableVideoCORS(v);
        
        // Verificăm dacă trebuie să schimbăm contextul
        // (Funcția handleVideoChange verifică intern dacă ID-ul e diferit)
        handleVideoChange(v);
    });
}, 250);

// Backup: Salvare la închiderea tab-ului
window.addEventListener('beforeunload', () => {
    saveToDB();
    cleanupVisuals();
    console.log("VisionProxy: Unloaded and data saved if any.");
});

window.addEventListener('popstate', () =>{
    cleanupVisuals();
    console.log("VisionProxy: Popstate");
});