const videoElement = document.getElementById('camera-feed');
const recordBtn = document.getElementById('btn-record');
const recordInnerText = document.getElementById('record-inner-text');
const statusText = document.getElementById('status-text');
const cameraControls = document.getElementById('camera-controls');

const reviewOverlay = document.getElementById('review-overlay');
const reviewVideo = document.getElementById('review-video');
const useVideoBtn = document.getElementById('btn-use-video');
const retakeBtn = document.getElementById('btn-retake');
const cancelBtn = document.getElementById('btn-cancel');

let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let timerInterval = null;
let secondsRecorded = 0;
let finalVideoBlob = null;

async function setupCamera() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false 
        });
        videoElement.srcObject = mediaStream;
        
        mediaRecorder = new MediaRecorder(mediaStream);
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = showReviewOverlay;

    } catch (error) {
        console.error("Camera access error:", error);
        alert("Please enable camera permissions to record kicks.");
    }
}

recordBtn.addEventListener('click', () => {
    if (!isRecording) {
        recordedChunks = [];
        mediaRecorder.start(500);
        isRecording = true;
        
        recordBtn.classList.add('is-recording');
        recordInnerText.innerText = "STOP";
        statusText.style.display = 'block';
        statusText.innerHTML = 'Recording... <span id="timer">00:00</span>';
        const dynamicTimer = document.getElementById('timer');
        
        secondsRecorded = 0;
        timerInterval = setInterval(() => {
            secondsRecorded++;
            let mins = String(Math.floor(secondsRecorded / 60)).padStart(2, '0');
            let secs = String(secondsRecorded % 60).padStart(2, '0');
            dynamicTimer.innerText = `${mins}:${secs}`;
        }, 1000);

    } else {
        mediaRecorder.stop();
        isRecording = false;
        
        recordBtn.classList.remove('is-recording');
        recordInnerText.innerText = "START";
        clearInterval(timerInterval);
        statusText.innerText = "Processing...";
    }
});

function showReviewOverlay() {
    const finalType = recordedChunks[0]?.type || 'video/mp4';
    finalVideoBlob = new Blob(recordedChunks, { type: finalType });
    
    reviewVideo.src = URL.createObjectURL(finalVideoBlob);
    
    cameraControls.style.display = 'none';
    statusText.style.display = 'none';
    reviewOverlay.style.display = 'flex';
    
    reviewVideo.play();
}

retakeBtn.addEventListener('click', () => {
    reviewVideo.pause();
    reviewVideo.src = "";
    
    recordedChunks = [];
    finalVideoBlob = null;
    
    reviewOverlay.style.display = 'none';
    cameraControls.style.display = 'flex';
});

useVideoBtn.addEventListener('click', () => {
    useVideoBtn.innerText = "Saving...";
    useVideoBtn.disabled = true;

    const request = indexedDB.open('KickTrackerDB', 1);

    request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('videos')) {
            db.createObjectStore('videos');
        }
    };

    request.onsuccess = (e) => {
        const db = e.target.result;
        const transaction = db.transaction('videos', 'readwrite');
        const store = transaction.objectStore('videos');
        
        store.put(finalVideoBlob, 'latest_kick');
        
        transaction.oncomplete = () => {
            shutdownCamera();
            window.location.href = 'analyze.html?load=latest';
        };
    };

    request.onerror = (e) => {
        console.error("Failed to save video to database:", e);
        alert("Failed to save video. Please try again.");
        useVideoBtn.innerText = "Use Video";
        useVideoBtn.disabled = false;
    };
});

cancelBtn.addEventListener('click', () => {
    shutdownCamera();
    window.location.href = 'index.html';
});

function shutdownCamera() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }
}

setupCamera();
