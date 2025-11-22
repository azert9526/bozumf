// const API_KEY = "KEY"; 

const LUMA_MIN_DIFFERENCE = 5;
const RISK_BUILD = 15;
const RISK_DECAY = 5;
const THRESHOLD = 40;

let isPhotosensitiveMode = true;
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
        if (!isPhotosensitiveMode) cleanupProtection();
    }
});

function cleanupProtection() {
    isProtecting = false;
    overlay.style.opacity = '0';
    document.querySelectorAll('video').forEach(v => v.classList.remove('vp-active'));
}

function enableVideoCORS(video) {
    if (video.crossOrigin) return;

    try {
        // incercam sa evitam 403 cu CORS
        video.crossOrigin = "use-credentials";
    } catch (e) {
        console.log("VisionProxy Warning: Could not set crossOrigin");
    }
}

function updateOverlayPos(video) {
    const rect = video.getBoundingClientRect();
    if (rect.width === 0) return;
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
}

function getLuma(video) {
    try {
        ctx.drawImage(video, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let total = 0;
        for (let i = 0; i < data.length; i += 8) {
            total += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        }
        return total / (data.length / 8);
    } catch (e) {
        // eroare cu CORS
        return -1; 
    }
}

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

            if (diff > LUMA_MIN_DIFFERENCE) {
                riskLevel += RISK_BUILD;
            } else {
                riskLevel -= RISK_DECAY;
            }
            
            riskLevel = Math.max(0, Math.min(100, riskLevel));

            if (riskLevel > THRESHOLD) {
                if (isPhotosensitiveMode) {
                    if (!isProtecting) {
                        isProtecting = true;
                        video.classList.add('vp-active');
                        overlay.style.opacity = '1';
                        updateOverlayPos(video);
                        
                        document.getElementById('vp-loading').style.display = 'block';
                        document.getElementById('vp-result').style.display = 'none';
                    }
                } else {
                    if (isProtecting) cleanupProtection();
                }
            } else {
                if (isProtecting) cleanupProtection();
            }
        }
        video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
}

// Init Loop
setInterval(() => {
    document.querySelectorAll('video').forEach(v => {
        if (!v.dataset.vpHook) {
            v.dataset.vpHook = "true";
            enableVideoCORS(v);
            processVideo(v);
        }
    });
}, 500);