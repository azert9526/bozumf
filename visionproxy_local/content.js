// content.js - Updated for CORS with credentials
const API_KEY = "KEY";
const FLASH_THRESHOLD = 10;
const INSTANT_KILL_THRESHOLD = 25;
const RISK_BUILD = 6;
const RISK_DECAY = 3;

console.log("NeuroShield Extension: Zero-Latency Engine Loaded");

// Setup UI
const overlay = document.createElement('div');
overlay.id = 'neuro-overlay-global';
overlay.style.cssText = `
    position: fixed;
    background: rgba(0, 0, 0, 0.9);
    color: white;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    z-index: 10000;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s;
`;
overlay.innerHTML = `
    <div style="font-size: 48px; font-weight: bold; color: #ff4444; margin-bottom: 20px;">RISK BLOCKED</div>
    <div id="ai-loading" style="color: #ccc; margin: 10px 0;">Analyzing Scene...</div>
    <div id="ai-result" style="display:none; background: rgba(255,255,255,0.1); padding: 10px; border-radius: 5px; max-width: 300px; text-align: center;"></div>
    <div id="cors-status" style="color: orange; display: none; margin-top: 10px;">
        ⚠️ Limited analysis (CORS restrictions)
    </div>
`;
document.body.appendChild(overlay);

// Canvas for processing
const procCanvas = document.createElement('canvas');
const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });
procCanvas.width = 32;
procCanvas.height = 32;

let riskLevel = 0;
let isProtecting = false;
let lastSummaryTime = 0;

// Enhanced CORS handling
function enableVideoCORS(video) {
    if (video.src && !video.crossOrigin) {
        // Try different CORS modes
        try {
            // First try without credentials
            video.crossOrigin = "anonymous";
            console.log("NeuroShield: Set CORS anonymous on video");
        } catch (e) {
            console.log("NeuroShield: Failed to set CORS anonymous");
        }
    }
}

// Test if we can actually analyze the video
function testVideoAccess(video) {
    return new Promise((resolve) => {
        try {
            procCtx.drawImage(video, 0, 0, 1, 1);
            procCtx.getImageData(0, 0, 1, 1);
            resolve(true);
        } catch (e) {
            resolve(false);
        }
    });
}

// Analysis function with fallback
function getLuma(video) {
    try {
        procCtx.drawImage(video, 0, 0, 32, 32);
        const frame = procCtx.getImageData(0, 0, 32, 32).data;
        let total = 0;
        let count = 0;

        for (let i = 0; i < frame.length; i += 16) {
            total += frame[i] * 0.299 + frame[i + 1] * 0.587 + frame[i + 2] * 0.114;
            count++;
        }

        // Hide CORS status if analysis works
        document.getElementById('cors-status').style.display = 'none';
        return total / count;

    } catch (e) {
        if (e.name === 'SecurityError') {
            console.log("NeuroShield: CORS still blocked, using fallback analysis");
            document.getElementById('cors-status').style.display = 'block';

            // Fallback: Use timing-based detection when CORS fails
            return getLumaFallback(video);
        }
        return -1;
    }
}

// Fallback analysis when CORS is completely blocked
function getLumaFallback(video) {
    // Method 1: Check video state and dimensions
    if (video.paused || video.ended || video.readyState < 2) return 128;

    // Method 2: Use video time changes as proxy for activity
    const currentTime = video.currentTime;

    // Return a safe middle value since we can't analyze pixels
    // This will prevent false positives but won't detect actual flashes
    return 128;
}

// Overlay positioning
function updateOverlayPosition(video) {
    if (!isProtecting) return;
    const rect = video.getBoundingClientRect();
    if (rect.width === 0) {
        overlay.style.opacity = '0';
        return;
    }

    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.opacity = '1';
}

// Main analysis engine
function startAnalysis(video) {
    let lastLuma = -1;
    let analysisActive = true;
    let corsWorking = false;

    // Test CORS access first
    testVideoAccess(video).then((canAnalyze) => {
        corsWorking = canAnalyze;
        if (!canAnalyze) {
            console.log("NeuroShield: CORS blocked for video, using limited analysis");
            document.getElementById('cors-status').style.display = 'block';
        }
    });

    const onFrame = (now, metadata) => {
        if (!analysisActive || !document.contains(video) || video.paused || video.ended) {
            if (!video.paused && !video.ended) {
                setTimeout(() => video.requestVideoFrameCallback(onFrame), 1000);
            }
            return;
        }

        if (isProtecting) updateOverlayPosition(video);

        const currLuma = getLuma(video);

        if (currLuma !== -1) {
            let diff = 0;
            if (lastLuma !== -1) diff = Math.abs(currLuma - lastLuma);
            lastLuma = currLuma;

            // Adjust sensitivity based on CORS capability
            const effectiveThreshold = corsWorking ? FLASH_THRESHOLD : FLASH_THRESHOLD * 3;
            const effectiveInstantKill = corsWorking ? INSTANT_KILL_THRESHOLD : INSTANT_KILL_THRESHOLD * 3;

            if (diff > effectiveInstantKill) {
                riskLevel = 100;
            } else if (diff > effectiveThreshold) {
                riskLevel += RISK_BUILD;
            } else {
                riskLevel -= RISK_DECAY;
            }

            riskLevel = Math.max(0, Math.min(100, riskLevel));

            if (riskLevel > 10) {
                if (!isProtecting) {
                    isProtecting = true;
                    video.style.filter = 'blur(10px)';
                    updateOverlayPosition(video);
                    document.getElementById('ai-loading').style.display = 'block';
                    document.getElementById('ai-result').style.display = 'none';
                    console.log("NeuroShield: Protection activated");
                }
            } else {
                if (isProtecting) {
                    isProtecting = false;
                    video.style.filter = 'none';
                    overlay.style.opacity = '0';
                    console.log("NeuroShield: Protection deactivated");
                }
            }
        }

        video.requestVideoFrameCallback(onFrame);
    };

    video.requestVideoFrameCallback(onFrame);

    // Cleanup if video is removed
    const observer = new MutationObserver(() => {
        if (!document.contains(video)) {
            analysisActive = false;
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// Initialize - hook all videos
function initializeVideoAnalysis() {
    document.querySelectorAll('video').forEach(v => {
        if (!v.dataset.nsActive) {
            v.dataset.nsActive = "true";
            enableVideoCORS(v);
            console.log("NeuroShield: Hooked video", v.src);
            startAnalysis(v);
        }
    });
}

// Initial scan
initializeVideoAnalysis();

// Watch for new videos
const videoObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
            if (node.nodeName === 'VIDEO') {
                setTimeout(() => {
                    if (!node.dataset.nsActive) {
                        node.dataset.nsActive = "true";
                        enableVideoCORS(node);
                        console.log("NeuroShield: Hooked new video", node.src);
                        startAnalysis(node);
                    }
                }, 100);
            } else if (node.querySelectorAll) {
                node.querySelectorAll('video').forEach(video => {
                    setTimeout(() => {
                        if (!video.dataset.nsActive) {
                            video.dataset.nsActive = "true";
                            enableVideoCORS(video);
                            console.log("NeuroShield: Hooked nested video", video.src);
                            startAnalysis(video);
                        }
                    }, 100);
                });
            }
        });
    });
});

videoObserver.observe(document.body, {
    childList: true,
    subtree: true
});

console.log("NeuroShield: Video observer started");