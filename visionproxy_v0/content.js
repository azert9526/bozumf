// --- CONFIGURARE ---
const API_URL = "http://localhost:8000";

const THRESHOLD = 40;
const LUMA_DIFF_MIN = 5;
const RISK_BUILD = 15;
const RISK_DECAY = 5;

// --- STARE GLOBALA ---
let isPhotosensitiveMode = true;
let isProtecting = false;
let currentVideoId = null;

// Stare inregistrare
let recordedBlockers = [];
let currentBlockerStart = null;
let hasNewData = false;

console.log("VisionProxy: Client Loaded");

// --- UI SETUP ---
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

// --- SYNC SETARI ---
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

// --- API CALLS DE LA SERVER ---
async function checkDB(videoId) {
    try {
        const res = await fetch(`${API_URL}/check?id=${videoId}`);
        return await res.json();
    } catch {
        return { found: false };
    }
}

async function saveToDB() {
    if (!hasNewData || !currentVideoId || recordedBlockers.length === 0) return;

    const payload = JSON.stringify({
        video_id: currentVideoId,
        platform: 'youtube', // momentan doar youtube
        blockers: recordedBlockers
    });

    try {
        // Folosim keep alive pentru a trimite datele chiar daca se inchide tab-ul
        const addResponse = await fetch(`${API_URL}/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
        });

        if (!addResponse.ok) {
            console.error("Save failed: server said ", addResponse.status);
            return;
        }

        fetch(`${API_URL}/generate-descriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                video_id: currentVideoId,
                platform: 'youtube'
            }),
            keepalive: true
        }).catch(err => console.error("Warning generating descriptions:", err));

        hasNewData = false;
        recordedBlockers = [];

        console.log("Data saved successfully");
    } catch (e) {
        console.error("Save failed:", e);
    }
}

// --- THUMBNAIL BADGES ---
async function processThumbnail(thumbnail) {
    const link = thumbnail.querySelector('a#thumbnail');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || !href.includes('watch?v=')) return;

    const videoId = href.split('v=')[1].split('&')[0];

    if (thumbnail.dataset.vpChecked) return;
    thumbnail.dataset.vpChecked = "true";

    addBadgeToThumbnail(thumbnail, "loading");
    
    // Verificam statusul (folosind aceeasi functie ca la video player)
    const data = await checkDB(videoId);
    
    addBadgeToThumbnail(thumbnail, data.found ? "safe" : "unsafe");
}

function addBadgeToThumbnail(el, status) {
    const old = el.querySelector('.vp-badge');
    if (old) old.remove();

    const badge = document.createElement('div');
    badge.classList.add('vp-badge');

    if (status === "safe") {
        badge.textContent = "✅";
        badge.classList.add('vp-badge-safe');
    } else if (status === "loading") {
        badge.textContent = "↻";
        badge.style.background = "orange";
    } else {
        badge.textContent = "❌";
        badge.classList.add('vp-badge-unknown');
    }
    el.appendChild(badge);
}

function scanThumbnails() {
    document.querySelectorAll('ytd-thumbnail').forEach(t => {
        if (!t.dataset.vpChecked) processThumbnail(t);
    });
}

// --- HELPER VIZUALE ---
function cleanupVisuals() {
    fadeOverlay(0, 100);
    document.querySelectorAll('video').forEach(v => v.classList.remove('vp-active'));
}

function updateOverlayPos(video) {
    const r = video.getBoundingClientRect();
    if (r.width === 0) return;
    overlay.style.top = r.top + 'px';
    overlay.style.left = r.left + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
}

function fadeOverlay(toOpacity, duration = 500) {
    overlay.style.transition = `opacity ${duration}ms ease`;
    overlay.style.opacity = toOpacity;
}

// --- MOD 1: PRECOMPUTED (din DB) ---
function runPrecomputedMode(video, blockers, activeId) {
    console.log("MODE: Precomputed");
    document.getElementById('vp-status').innerText = "Hidden part is too short for a description";
    // daca are in Db description, inlocuim

    const loop = () => {
        // VERIFICARE CRITICA: Daca s-a schimbat video-ul, oprim bucla veche
        if (currentVideoId !== activeId) return;

        if (video.paused || video.ended) {
            requestAnimationFrame(loop);
            return;
        }

        const now = video.currentTime * 1000;
        let shouldBlock = false;

        for (let b of blockers) {
            const start = b.start_time_ms || b.startTime;
            const end = b.end_time_ms || b.endTime;
            if (now >= start && now <= end) {
                shouldBlock = true;
                break;
            }
        }

        if (shouldBlock) {
            if (!isProtecting && isPhotosensitiveMode) {
                isProtecting = true;
                video.classList.add('vp-active');
                fadeOverlay(1, 900);
                updateOverlayPos(video);
            } else if (isProtecting) {
                updateOverlayPos(video);
            }
        } else {
            if (isProtecting) {
                isProtecting = false;
                video.classList.remove('vp-active');
                fadeOverlay(0, 900);
            }
        }
        requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
}

// --- MOD 2: REALTIME ---
function getLuma(video) {
    try {
        ctx.drawImage(video, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let total = 0;
        for (let i = 0; i < data.length; i += 8) {
            total += data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
        }
        return total / (data.length / 8);
    } catch {
        return -1;
    }
}

function runRealtimeMode(video, activeId) {
    console.log("MODE: Realtime");
    document.getElementById('vp-status').innerText = "Recording new data";

    let lastLuma = -1;
    let risk = 0;

    // Reset la state
    recordedBlockers = [];
    hasNewData = false;
    currentBlockerStart = null;

    const onFrame = () => {
        if (currentVideoId !== activeId) return;

        if (!document.contains(video) || video.paused || video.ended) {
            setTimeout(() => video.requestVideoFrameCallback(onFrame), 250);
            return;
        }

        if (isProtecting && isPhotosensitiveMode) updateOverlayPos(video);

        const curr = getLuma(video);

        if (curr !== -1) {
            let diff = (lastLuma === -1) ? 0 : Math.abs(curr - lastLuma);
            lastLuma = curr;

            if (diff > LUMA_DIFF_MIN) {
                risk += (diff > 50) ? 50 : RISK_BUILD;
            } else {
                risk -= RISK_DECAY;
            }

            risk = Math.max(0, Math.min(100, risk));

            if (risk > THRESHOLD) {
                if (!isProtecting) {
                    isProtecting = true;

                    if (isPhotosensitiveMode) {
                        video.classList.add('vp-active');
                        fadeOverlay(1, 0);
                        updateOverlayPos(video);
                    }
                    // Start recording
                    currentBlockerStart = Math.max(0, Math.floor(video.currentTime * 1000) - 200);
                }
            } else {
                if (isProtecting) {
                    isProtecting = false;

                    if (isPhotosensitiveMode) {
                        video.classList.remove('vp-active');
                        fadeOverlay(0, 0);
                    }

                    // Stop recording & save
                    if (currentBlockerStart !== null) {
                        const end = Math.floor(video.currentTime * 1000);
                        recordedBlockers.push({
                            start_time_ms: Math.max(0, currentBlockerStart - 1000),
                            end_time_ms: end + 1000,
                            description: "Auto-detected flashes"
                        });
                        
                        hasNewData = true;
                        currentBlockerStart = null;
                    }
                }
            }
        }

        video.requestVideoFrameCallback(onFrame);
    };

    video.requestVideoFrameCallback(onFrame);

    // Salveaza datele cand video-ul se termina
    video.addEventListener('ended', async () => {
        if (currentVideoId === activeId) await saveToDB();
    }, { once: true });
}

// --- CONTROLLER & NAVIGARE ---

function enableVideoCORS(video) {
    if (!video.crossOrigin) {
        try { video.crossOrigin = "use-credentials"; } catch {}
    }
}

async function handleVideoChange(video) {
    const urlParams = new URLSearchParams(window.location.search);
    const newId = urlParams.get('v');

    // Daca nu avem ID ignoram
    if (!newId) { cleanupVisuals(); return; }

    // Daca ID-ul e acelasi, nu facem nimic (evitam restartarea buclei)
    if (newId === currentVideoId) return;

    console.log(`Video Changed: ${currentVideoId} -> ${newId}`);

    // 1. Salvam datele vechi inainte sa schimbam
    if (currentVideoId && hasNewData) await saveToDB();

    // 2. Actualizam ID-ul curent
    currentVideoId = newId;
    cleanupVisuals();

    // 3. Verificam baza de date pentru noul video
    const db = await checkDB(newId);

    if (db.found && db.blockers && db.blockers.length > 0) {
        runPrecomputedMode(video, db.blockers, newId);
    } else {
        runRealtimeMode(video, newId);
    }
}

// --- LOOP PRINCIPAL ---
// Folosim un interval pentru a verifica constant navigarea
setInterval(() => {
    // Scaneaza Thumbnails
    scanThumbnails();

    // Scaneaza Video Player
    document.querySelectorAll('video').forEach(v => {
        enableVideoCORS(v);
        handleVideoChange(v);
    });
}, 250);

// --- OBSERVER (Doar pentru DOM Updates) ---
const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const m of mutations) {
        if (m.addedNodes.length > 0) {
            shouldScan = true;
            break;
        }
    }
    if (shouldScan) {
        scanThumbnails();
    }
});
observer.observe(document.body, { childList: true, subtree: true });

// Salvare la inchidere tab
window.addEventListener('beforeunload', () => {
    saveToDB();
    cleanupVisuals();
});

// Oprire overlay la navigare inapoi/inainte
window.addEventListener('popstate', () => {
    cleanupVisuals();
});

// https://www.youtube.com/watch?v=nTejB1lAfPA