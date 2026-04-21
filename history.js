function loadHistory() {
    const historyList = document.getElementById('history-list');
    const clearBtn = document.getElementById('btn-clear');
    
    let history = JSON.parse(localStorage.getItem('kickHistory')) || [];

    if (history.length === 0) {
        historyList.innerHTML = '<div class="empty-state">No kicks recorded yet.<br><br>Go to Analyze Video to generate reports.</div>';
        clearBtn.style.display = 'none';
        return;
    }

    clearBtn.style.display = 'block';
    historyList.innerHTML = '';

    history.forEach((kick, index) => {
        // Fallbacks included to handle older data versus the new physics-engine.js format
        const dateText = kick.date ? new Date(kick.date).toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown Date';
        
        const maxGood = Math.max(0, kick.maxGoodDistance || 0);
        
        // Use 'drift' from the new physics engine, fallback to old 'missType'
        const driftText = kick.drift || kick.missType || '--';
        const missTextClass = driftText.includes("Drift") || driftText.includes("Short") || driftText.includes("Miss") ? "text-red" : "text-green";

        // Map the new kinematics property names
        const timeVal = kick.time || kick.totalTime || 0;
        const heightVal = kick.height || kick.peakHeightFeet || 0;
        const angleVal = kick.angle || kick.launchAngle || 0;

        const card = document.createElement('div');
        card.className = 'history-card';
        card.innerHTML = `
            <div class="card-header">
                <span>Kick #${history.length - index}</span>
                <span>${dateText}</span>
            </div>
            <div class="card-row">
                <span>Max Good:</span>
                <span class="text-green">≤ ${Math.floor(maxGood)} yds</span>
            </div>
            <div class="card-row">
                <span>Past ${Math.floor(maxGood)} yds:</span>
                <span class="${missTextClass}">${driftText}</span>
            </div>
            <div class="card-row" style="font-weight: normal; font-size: 14px; margin-top: 4px; color: #d1d1d6;">
                <span>Time: ${timeVal.toFixed(2)}s</span>
                <span>Height: ${heightVal.toFixed(1)}ft</span>
                <span class="text-orange">Ang: ${angleVal.toFixed(1)}°</span>
            </div>
        `;
        historyList.appendChild(card);
    });
}

document.getElementById('btn-clear').addEventListener('click', () => {
    if(confirm("Are you sure you want to delete all kick history? This cannot be undone.")) {
        localStorage.removeItem('kickHistory');
        loadHistory();
    }
});

document.getElementById('btn-home').addEventListener('click', () => {
    window.location.href = 'index.html';
});

window.onload = loadHistory;
