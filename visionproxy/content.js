// --- CONFIG ---

// URL API Backend
const API_URL = "http://localhost:8000";

// Parametri "sensibilitate"
const THRESHOLD = 40;
const LUMA_DIFF_MIN = 5;
const RISK_BUILD = 15;
const RISK_DECAY = 5;

// --- STARE GLOBALA ---
let isPhotosensitiveMode = true;
let isProtecting = false;
let currentVideoId = null;

// Stare inregistrare (memorie temporara pana la salvare)
let recordedBlockers = [];
let currentBlockerStart = null;
let hasNewData = false;

console.log("VisionProxy: Client Loaded");

// --- UI SETUP ---

// Ecran protector
const overlay = document.createElement('div');
overlay.id = 'vp-overlay';
overlay.innerHTML = `
    <div class="top-ad"> THIS IS AN EXAMPLE BANNER AD </div>
    <div class="vp-warning">VisionProxy Active</div>
    <div id="vp-status">Initializing...</div>
`;
document.body.appendChild(overlay);

// Canvas pentru procesare video, practic punem un video frame in canvas si citim pixelii
const procCanvas = document.createElement('canvas');
const ctx = procCanvas.getContext('2d', { willReadFrequently: true });
procCanvas.width = 32;
procCanvas.height = 32;

// --- SETARI ---
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

// --- COMUNICARE CU SERVER ---
// Verifica daca video-ul exista in baza de date
async function checkDB(videoId) {
    try {
        const res = await fetch(`${API_URL}/check?id=${videoId}`);
        return await res.json();
    } catch {
        return { found: false };
    }
}

// Salveaza datele despre video in baza de date
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
            console.error("Save failed: ", addResponse.status);
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
        }).catch(err => console.error("Error generating descriptions:", err));

        hasNewData = false;
        recordedBlockers = [];

        console.log("Video data saved");
    } catch (e) {
        console.error("Save failed:", e);
    }
}

// --- THUMBNAIL ICONS ---

// Proceseaza un thumbnail individual
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

// Adauga un badge pe thumbnail
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

// Scaneaza toate thumbnail-urile de pe pagina
function scanThumbnails() {
    document.querySelectorAll('ytd-thumbnail').forEach(t => {
        if (!t.dataset.vpChecked) processThumbnail(t);
    });
}

// --- HELPER VIZUALE ---

// Practic scoate ecranul protector
function cleanupVisuals() {
    fadeOverlay(0);
    document.querySelectorAll('video').forEach(v => v.classList.remove('vp-active'));
}

// Actualizeaza pozitia ecranului protector
function updateOverlayPos(video) {
    const r = video.getBoundingClientRect();
    if (r.width === 0) return;
    overlay.style.top = r.top + 'px';
    overlay.style.left = r.left + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
}

// Efect de fade pentru ecranul protector
function fadeOverlay(toOpacity, duration = 900) {
    overlay.style.transition = `opacity ${duration}ms ease`;
    overlay.style.opacity = toOpacity;
}

// --- MOD 1: PRECOMPUTED (din DB) ---
function runPrecomputedMode(video, blockers, activeId) {
    console.log("MODE: Precomputed");
    // daca are in Db description, inlocuim

    const loop = () => {
        // Daca s-a schimbat video-ul, oprim bucla veche
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

                document.getElementById('vp-status').innerText = b.description || "Hidden part is too short for a description";

                break;
            }
        }

        if (shouldBlock) {
            if (!isProtecting && isPhotosensitiveMode) {
                isProtecting = true;
                video.classList.add('vp-active');
                fadeOverlay(1);
                updateOverlayPos(video);
            } else if (isProtecting) {
                updateOverlayPos(video);
            }
        } else {
            if (isProtecting) {
                isProtecting = false;
                video.classList.remove('vp-active');
                fadeOverlay(0);
            }
        }
        // Repetam la urmatorul frame
        requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
}

// Calculeaza luminozitatea medie a unui frame video (luma e calculata dupa ochiul uman si e 0.299*R + 0.587*G + 0.114*B)
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

// --- MOD 2: REALTIME (nu sunt date despre acest video in DB) ---
function runRealtimeMode(video, activeId) {
    console.log("MODE: Realtime");
    document.getElementById('vp-status').innerText = "Recording new data...";

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
                    // Start inregistrare blocker
                    currentBlockerStart = Math.max(0, Math.floor(video.currentTime * 1000) - 200);
                }
            } else {
                if (isProtecting) {
                    isProtecting = false;

                    if (isPhotosensitiveMode) {
                        video.classList.remove('vp-active');
                        fadeOverlay(0);
                    }

                    // Stop inregistrare blocker si punem in lista ca sa se salveze ulterior
                    if (currentBlockerStart !== null) {
                        const end = Math.floor(video.currentTime * 1000);
                        recordedBlockers.push({
                            start_time_ms: Math.max(0, currentBlockerStart - 1000),
                            end_time_ms: end + 1000,
                            description: "Hidden part is too short for a description"
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

// Util uneori pentru a citi pixelii video-ului (CORS uneori blocheaza asta)
function enableVideoCORS(video) {
    if (!video.crossOrigin) {
        try { video.crossOrigin = "use-credentials"; } catch {}
    }
}

// Ruleaza cand intram pe un video nou
async function handleVideoChange(video) {
    const urlParams = new URLSearchParams(window.location.search);
    const newId = urlParams.get('v');

    // Daca nu avem ID ignoram
    if (!newId) { cleanupVisuals(); return; }

    // Daca ID-ul e acelasi, nu facem nimic (evitam restartarea buclei)
    if (newId === currentVideoId) return;

    console.log(`Video Changed: ${currentVideoId} -> ${newId}`);

    // Salvam datele vechi inainte sa schimbam, actualizam ID-ul curent, verificam baza de date pentru noul video
    if (currentVideoId && hasNewData) await saveToDB();

    currentVideoId = newId;
    cleanupVisuals();

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
    // Scaneaza thumbnail-urile de pe pagina
    scanThumbnails();

    // Scaneaza Video Player daca exista
    document.querySelectorAll('video').forEach(v => {
        enableVideoCORS(v);
        handleVideoChange(v);
    });
}, 250);

// Observer care detecteaza cand YouTube incarca elemente noi (scroll infinit)
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

// Clean up la iesire

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
// https://www.youtube.com/watch?v=0YsC6M4GFoc