const VERSION = "v1.6.6";

console.log("KickTracker build:", VERSION);

document.getElementById('app-version').textContent = VERSION;

document.getElementById('btn-record').addEventListener('click', () => {
    window.location.href = 'camera.html';
});

document.getElementById('btn-analyze').addEventListener('click', () => {
    window.location.href = 'analyze.html';
});

document.getElementById('btn-history').addEventListener('click', () => {
    window.location.href = 'history.html';
});
