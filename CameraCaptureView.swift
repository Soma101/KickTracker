<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Record Kick</title>
    <style>
        body {
            margin: 0;
            background-color: black;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            height: 100vh;
            font-family: -apple-system, sans-serif;
        }

        #camera-feed {
            width: 100%;
            flex-grow: 1;
            object-fit: cover;
            background-color: #1c1c1e;
        }

        .camera-controls {
            position: absolute;
            bottom: 0;
            width: 100%;
            height: 120px;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: space-around;
            padding-bottom: 20px;
        }

        .btn-cancel {
            color: white;
            font-size: 18px;
            background: none;
            border: none;
            cursor: pointer;
            padding: 10px;
        }

        /* Recreates the classic iOS record button */
        .btn-record-wrapper {
            width: 70px;
            height: 70px;
            border-radius: 50%;
            border: 4px solid white;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
        }

        .btn-record-inner {
            width: 54px;
            height: 54px;
            background-color: #ff3b30;
            border-radius: 50%;
            transition: all 0.2s ease-in-out;
        }

        /* State class when recording is active */
        .is-recording .btn-record-inner {
            width: 30px;
            height: 30px;
            border-radius: 8px; /* Turns into a stop square */
        }

        #status-text {
            position: absolute;
            top: 40px;
            width: 100%;
            text-align: center;
            color: white;
            font-weight: bold;
            font-size: 18px;
            text-shadow: 0 2px 4px rgba(0,0,0,0.5);
            display: none;
        }
    </style>
</head>
<body>

    <div id="status-text">Recording... <span id="timer">00:00</span></div>
    <video id="camera-feed" autoplay playsinline muted></video>
    
    <div class="camera-controls">
        <button class="btn-cancel" onclick="cancelCamera()">Cancel</button>
        
        <div class="btn-record-wrapper" id="btn-record">
            <div class="btn-record-inner"></div>
        </div>
        
        <div style="width: 60px;"></div> 
    </div>

    <script>
        const videoElement = document.getElementById('camera-feed');
        const recordBtn = document.getElementById('btn-record');
        const statusText = document.getElementById('status-text');
        const timerText = document.getElementById('timer');

        let mediaStream = null;
        let mediaRecorder = null;
        let recordedChunks = [];
        let isRecording = false;
        let timerInterval = null;
        let secondsRecorded = 0;

        // Equivalent to makeUIViewController (Setup Camera)
        async function setupCamera() {
            try {
                // Request back camera with high quality constraints
                mediaStream = await navigator.mediaDevices.getUserMedia({ 
                    video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
                    audio: false // Disabled audio to save file size, enable if needed
                });
                videoElement.srcObject = mediaStream;
                
                // Initialize the MediaRecorder
                mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'video/webm' });
                
                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        recordedChunks.push(event.data);
                    }
                };

                mediaRecorder.onstop = saveAndNavigate;

            } catch (error) {
                console.error("Camera access error:", error);
                alert("Please enable camera permissions to record kicks.");
            }
        }

        // Equivalent to the user clicking the Record/Stop button
        recordBtn.addEventListener('click', () => {
            if (!isRecording) {
                // START RECORDING
                recordedChunks = [];
                mediaRecorder.start();
                isRecording = true;
                
                // UI Updates
                recordBtn.classList.add('is-recording');
                statusText.style.display = 'block';
                secondsRecorded = 0;
                timerInterval = setInterval(() => {
                    secondsRecorded++;
                    let mins = String(Math.floor(secondsRecorded / 60)).padStart(2, '0');
                    let secs = String(secondsRecorded % 60).padStart(2, '0');
                    timerText.innerText = `${mins}:${secs}`;
                }, 1000);

            } else {
                // STOP RECORDING
                mediaRecorder.stop();
                isRecording = false;
                
                // UI Updates
                recordBtn.classList.remove('is-recording');
                clearInterval(timerInterval);
                statusText.innerText = "Saving video...";
            }
        });

        // Equivalent to imagePickerController:didFinishPickingMediaWithInfo
        function saveAndNavigate() {
            // Combine all video data into a single file
            const videoBlob = new Blob(recordedChunks, { type: 'video/webm' });

            // Open browser's built-in IndexedDB to safely store the massive file
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
                
                // Save the video under the key 'latest_kick'
                store.put(videoBlob, 'latest_kick');
                
                transaction.oncomplete = () => {
                    shutdownCamera();
                    // Navigate to the analysis page, appending a flag to the URL
                    window.location.href = 'analyze.html?load=latest';
                };
            };

            request.onerror = (e) => {
                console.error("Failed to save video to database:", e);
                alert("Failed to save video.");
            };
        }

        // Equivalent to imagePickerControllerDidCancel
        function cancelCamera() {
            shutdownCamera();
            window.location.href = 'index.html';
        }

        function shutdownCamera() {
            if (mediaStream) {
                mediaStream.getTracks().forEach(track => track.stop());
            }
        }

        // Start camera automatically when the view loads
        setupCamera();
    </script>
</body>
</html>
