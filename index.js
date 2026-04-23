console.log("KickTracker build:", "v1.0.5");

document.getElementById('btn-record').addEventListener('click', () => {
    window.location.href = 'camera.html';
});

document.getElementById('btn-analyze').addEventListener('click', () => {
    window.location.href = 'analyze.html';
});

document.getElementById('btn-history').addEventListener('click', () => {
    window.location.href = 'history.html';
});
