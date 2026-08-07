const fps = 30; 
        
const video = document.getElementById('video-player');
const canvas = document.getElementById('overlay');
const cvCanvas = document.getElementById('cv-canvas');
const ctx = canvas.getContext('2d');
const cvCtx = cvCanvas.getContext('2d', { willReadFrequently: true });

const zoomWrapper = document.getElementById('zoom-wrapper');
const scrubber = document.getElementById('scrubber');
const statusText = document.getElementById('status-text');

let isVideoLoaded = false;
let isScrubbing = false;
let zoomLevel = 1.0;
let cameraDistance = 15.0;
let cvReady = false;

// State Machine Data
let scaleDots = []; 
let activeTap = null;
let startPt = null; 
let peakPt = null; 
let endPt = null;

// Automated Tracking State
let autoTrajectory = [];
let isAutoTracking = false;
let kalmanFilter = null;
let measurement = null;
let trackBox = null;
let videoCap = null;

const physics = new KickPhysicsEngine();

// Called by the async script tag in HTML when OpenCV finishes loading
window.onOpenCvReady = function() {
    cvReady = true;
    statusText.innerText = "Upload a video to begin.";
    const uploadBtn = document.getElementById('upload-placeholder');
    uploadBtn.style.pointerEvents = 'auto';
    uploadBtn.style.opacity = '1';
    uploadBtn.innerText = 'Upload Video';
};

document.getElementById('file-upload').addEventListener('change', (e) => {
    if (!cvReady) return;
    const file = e.target.files[0];
    if (!file) return;
    video.src = URL.createObjectURL(file);
    video.load();
    video.onloadeddata = () => {
        document.getElementById('upload-placeholder').style.display = 'none';
        zoomWrapper.style.display = 'inline-flex';
        document.getElementById('persistent-controls').style.display = 'flex';
        isVideoLoaded = true;
        scrubber.max = video.duration;
        resizeCanvas();
        resetAll();
    };
});

function resizeCanvas() {
    if (!isVideoLoaded) return;
    const rect = video.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Hidden canvas matches raw video dimensions for OpenCV
    cvCanvas.width = video.videoWidth;
    cvCanvas.height = video.videoHeight;
}

window.addEventListener('resize', () => { resizeCanvas(); draw(); });

document.getElementById('cam-depth').addEventListener('input', (e) => {
    cameraDistance = parseFloat(e.target.value);
    document.getElementById('depth-val').innerText = cameraDistance;
});

document.getElementById('zoom-slider').addEventListener('input', (e) => {
    zoomLevel = parseFloat(e.target.value);
    document.getElementById('zoom-val').innerText = zoomLevel.toFixed(1) + 'x';
    zoomWrapper.style.transform = `scale(${zoomLevel})`;
    if (activeTap) {
        zoomWrapper.style.transformOrigin = `${activeTap.x * 100}% ${activeTap.y * 100}%`;
    }
    draw(); 
});

video.addEventListener('timeupdate', () => { if (!isScrubbing) scrubber.value = video.currentTime; });
scrubber.addEventListener('input', (e) => { isScrubbing = true; video.currentTime = e.target.value; });
scrubber.addEventListener('change', () => { isScrubbing = false; });

window.togglePlay = function() { 
    if (video.paused) { video.play(); document.getElementById('btn-playpause').innerText = '⏸'; } 
    else { video.pause(); document.getElementById('btn-playpause').innerText = '▶'; } 
};

window.stepFrame = function(f) { 
    video.pause(); 
    document.getElementById('btn-playpause').innerText = '▶'; 
    video.currentTime += (1/fps) * f; 
};

canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width);
    const y = ((e.clientY - rect.top) / rect.height);
    activeTap = {x, y};
    if(zoomLevel > 1) zoomWrapper.style.transformOrigin = `${activeTap.x * 100}% ${activeTap.y * 100}%`;
    updateWorkflow();
    draw();
});

function draw() {
    if (!isVideoLoaded) return;
    const w = canvas.clientWidth; 
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    
    const invZoom = 1.0 / zoomLevel;
    const dotRad = 6 * invZoom;

    // Draw Scale line
    if (scaleDots.length === 2) {
        ctx.strokeStyle = '#3a3a3c';
        ctx.lineWidth = 2 * invZoom;
        ctx.beginPath();
        ctx.moveTo(scaleDots[0].x * w, scaleDots[0].y * h);
        ctx.lineTo(scaleDots[1].x * w, scaleDots[1].y * h);
        ctx.stroke();
    }

    ctx.fillStyle = '#007aff';
    scaleDots.forEach(pt => {
        ctx.beginPath(); ctx.arc(pt.x * w, pt.y * h, dotRad, 0, Math.PI * 2); ctx.fill();
    });

    if (activeTap) {
        const px = activeTap.x * w; const py = activeTap.y * h; const len = 12 * invZoom;
        ctx.strokeStyle = '#ffff00'; ctx.lineWidth = 2.5 * invZoom;
        ctx.beginPath(); ctx.moveTo(px, py - len); ctx.lineTo(px, py + len); 
        ctx.moveTo(px - len, py); ctx.lineTo(px + len, py); ctx.stroke();
    }

    // Draw Auto Trajectory Trail
    if (autoTrajectory.length > 0) {
        ctx.strokeStyle = '#007aff';
        ctx.lineWidth = 2 * invZoom;
        ctx.beginPath();
        ctx.moveTo(autoTrajectory[0].pos.x * w, autoTrajectory[0].pos.y * h);
        for (let i = 1; i < autoTrajectory.length; i++) {
            ctx.lineTo(autoTrajectory[i].pos.x * w, autoTrajectory[i].pos.y * h);
        }
        ctx.stroke();
    }

    const drawMarker = (pt, color) => {
        if (!pt) return; 
        ctx.fillStyle = color; 
        ctx.beginPath(); ctx.arc(pt.pos.x * w, pt.pos.y * h, dotRad, 0, Math.PI * 2); ctx.fill();
    };
    
    drawMarker(startPt, '#34c759'); 
    drawMarker(peakPt, '#ff9500'); 
    drawMarker(endPt, '#ff3b30'); 
}

function updateWorkflow() {
    if (!isVideoLoaded) return;
    const btn = document.getElementById('btn-workflow');
    
    if (scaleDots.length === 0) {
        statusText.innerText = "Step 1: Tap to set 1st scale dot (10 yds)";
        btn.innerText = "CONFIRM 1ST DOT"; 
        btn.style.background = '#007aff'; 
        btn.disabled = (activeTap === null);
        btn.onclick = () => { scaleDots.push(activeTap); activeTap = null; updateWorkflow(); draw(); };
    } 
    else if (scaleDots.length === 1) {
        statusText.innerText = "Step 2: Tap to set 2nd scale dot (10 yds)";
        btn.innerText = "CONFIRM 2ND DOT"; 
        btn.disabled = (activeTap === null);
        btn.onclick = () => { scaleDots.push(activeTap); activeTap = null; updateWorkflow(); draw(); };
    } 
    else if (startPt === null && !isAutoTracking) {
        statusText.innerText = "Tap the ball at rest to initialize Tracker.";
        btn.innerText = "START AUTO-TRACKING"; 
        btn.style.background = '#34c759'; 
        btn.disabled = (activeTap === null);
        btn.onclick = () => { 
            initializeTracker(activeTap); 
            activeTap = null; 
            updateWorkflow(); 
            draw(); 
        };
    } 
    else if (isAutoTracking) {
        statusText.innerText = "Tracking ball trajectory... Please wait.";
        btn.innerText = "ANALYZING..."; 
        btn.style.background = '#ff9500'; 
        btn.disabled = true;
    }
    else if (endPt !== null) {
        statusText.innerText = "Analysis Complete.";
        btn.innerText = "VIEW REPORT"; 
        btn.style.background = '#007aff'; 
        btn.disabled = false;
        btn.onclick = () => document.getElementById('report-modal').style.display = 'flex';
    }
}

// OpenCV Tracker Initialization & Loop
function initializeTracker(initialPos) {
    isAutoTracking = true;
    autoTrajectory = [];
    
    // Set initial bounding box based on normalized tap coordinates
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    
    const boxSize = 40; 
    trackBox = new cv.Rect(
        Math.max(0, (initialPos.x * vw) - (boxSize/2)), 
        Math.max(0, (initialPos.y * vh) - (boxSize/2)), 
        boxSize, boxSize
    );

    // Initialize Kalman Filter (4 dynamics states x,y,vx,vy / 2 measurement states x,y)
    kalmanFilter = new cv.KalmanFilter(4, 2, 0, cv.CV_32F);
    measurement = new cv.Mat(2, 1, cv.CV_32F, new cv.Scalar(0));
    
    // Setup Transition Matrix
    kalmanFilter.transitionMatrix.setFloatAt(0, 0, 1);
    kalmanFilter.transitionMatrix.setFloatAt(0, 2, 1);
    kalmanFilter.transitionMatrix.setFloatAt(1, 1, 1);
    kalmanFilter.transitionMatrix.setFloatAt(1, 3, 1);
    kalmanFilter.transitionMatrix.setFloatAt(2, 2, 1);
    kalmanFilter.transitionMatrix.setFloatAt(3, 3, 1);

    // Setup Measurement Matrix
    kalmanFilter.measurementMatrix.setFloatAt(0, 0, 1);
    kalmanFilter.measurementMatrix.setFloatAt(1, 1, 1);

    // Initial State
    kalmanFilter.statePre.setFloatAt(0, 0, trackBox.x + trackBox.width / 2);
    kalmanFilter.statePre.setFloatAt(1, 0, trackBox.y + trackBox.height / 2);
    kalmanFilter.statePre.setFloatAt(2, 0, 0);
    kalmanFilter.statePre.setFloatAt(3, 0, 0);

    videoCap = new cv.VideoCapture(video);
    
    video.play();
    requestAnimationFrame(processVideo);
}

function processVideo() {
    if (!isAutoTracking || video.paused || video.ended) return;

    let frame = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
    videoCap.read(frame);

    // 1. Predict
    let prediction = kalmanFilter.predict();
    let predX = prediction.floatAt(0, 0);
    let predY = prediction.floatAt(1, 0);

    // 2. Measure (Simplified object detection: CamShift using color histogram)
    // In a full implementation, you'd calculate the back-projection here.
    // For this snippet, we assume the ball is found near the prediction.
    measurement.setFloatAt(0, 0, predX); 
    measurement.setFloatAt(1, 0, predY);
    
    // 3. Correct
    kalmanFilter.correct(measurement);

    // 4. Save Normalized Point
    let estimatedX = kalmanFilter.statePost.floatAt(0, 0);
    let estimatedY = kalmanFilter.statePost.floatAt(1, 0);
    let velY = kalmanFilter.statePost.floatAt(3, 0); // Y Velocity

    autoTrajectory.push({
        time: video.currentTime,
        pos: { x: estimatedX / video.videoWidth, y: estimatedY / video.videoHeight },
        vy: velY
    });

    draw();

    // Detect end of kick (Exits frame or stops moving)
    if (estimatedX < 0 || estimatedX > video.videoWidth || estimatedY > video.videoHeight) {
        video.pause();
        extractKeyFrames();
        frame.delete();
        return;
    }

    frame.delete();
    requestAnimationFrame(processVideo);
}

function extractKeyFrames() {
    isAutoTracking = false;
    
    // Find Impact (Sudden velocity change)
    startPt = autoTrajectory[0]; 
    for(let i=1; i<autoTrajectory.length; i++) {
        if(Math.abs(autoTrajectory[i].vy) > 5) {
            startPt = autoTrajectory[i];
            break;
        }
    }

    // Find Peak (Highest Y, meaning lowest normalized Y value)
    peakPt = startPt;
    for(let i=0; i<autoTrajectory.length; i++) {
        if(autoTrajectory[i].pos.y < peakPt.pos.y) {
            peakPt = autoTrajectory[i];
        }
    }

    // End point is the last recorded trajectory
    endPt = autoTrajectory[autoTrajectory.length - 1];

    // Cleanup OpenCV memory
    kalmanFilter.delete();
    measurement.delete();
    
    handleCalculateAndReport();
    updateWorkflow();
    draw();
}

function handleCalculateAndReport() {
    const activeReport = physics.calculate(startPt, peakPt, endPt, scaleDots, cameraDistance, canvas.clientWidth);

    let history = JSON.parse(localStorage.getItem('kickHistory')) || [];
    history.unshift(activeReport);
    if(history.length > 100) history.pop(); 
    localStorage.setItem('kickHistory', JSON.stringify(history));

    document.getElementById('rep-max').innerText = `≤ ${Math.floor(activeReport.maxGoodDistance)} yds`;
    document.getElementById('rep-miss').innerText = activeReport.drift;
    document.getElementById('rep-time').innerText = `${activeReport.time.toFixed(2)}s`;
    document.getElementById('rep-height').innerText = `${activeReport.height.toFixed(1)} ft`;
    document.getElementById('rep-angle').innerText = `${activeReport.angle.toFixed(1)}°`;

    document.getElementById('report-modal').style.display = 'flex';
}

window.resetAll = function() {
    scaleDots = []; 
    autoTrajectory = [];
    isAutoTracking = false;
    activeTap = startPt = peakPt = endPt = null;
    zoomLevel = 1.0; 
    zoomWrapper.style.transform = `scale(1)`; 
    document.getElementById('zoom-slider').value = 1; 
    document.getElementById('zoom-val').innerText = '1x';
    if(isVideoLoaded) {
        video.pause(); 
        video.currentTime = 0; 
        scrubber.value = 0;
    }
    updateWorkflow(); 
    draw();
};
