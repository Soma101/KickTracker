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
        const dateText = kick.date ? new Date(kick.date).toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown Date';
        const maxGood = Math.max(0, kick.maxGoodDistance || 0);
        const missReason = kick.missReason || kick.drift || kick.missType || '--';
        const missTextClass = missReason === 'Good' ? "text-green" : "text-red";

        const card = document.createElement('div');
        card.className = 'history-card';
        
        card.innerHTML = `
            <div class="card-header">
                <span>Kick #${history.length - index}</span>
                <span>${dateText}</span>
            </div>
            <div class="card-row" style="margin-top: 8px;">
                <span>Good From:</span>
                <span class="text-green">≤ ${Math.floor(maxGood)} yds</span>
            </div>
            <div class="card-row">
                <span>Past ${Math.floor(maxGood)} yds:</span>
                <span class="${missTextClass}">${missReason}</span>
            </div>
        `;
        
        card.addEventListener('click', () => {
            showReport(kick);
        });

        historyList.appendChild(card);
    });
}

function showReport(report) {
    const cfg = report.config || { uprightType: 'nfl', hashPosition: 'middle' };
    
    const uprightLabel = `${cfg.uprightType.toUpperCase()} Uprights · ${cfg.hashPosition.charAt(0).toUpperCase()+cfg.hashPosition.slice(1)} Hash`;
    document.getElementById('rep-upright-label').innerText = `Scoring Projection — ${uprightLabel}`;
    
    const maxGood = Math.max(0, report.maxGoodDistance || 0);
    document.getElementById('rep-dist').innerText      = `${report.kickDistance || '--'} yds`;
    document.getElementById('rep-max').innerText       = `≤ ${Math.floor(maxGood)} yds`;
    
    const driftText = report.drift || report.missType || '--';
    document.getElementById('rep-miss').innerText      = driftText;
    document.getElementById('rep-miss').className      = driftText === 'Straight' ? 'text-green' : 'text-red';
    
    const missReason = report.missReason || driftText;
    document.getElementById('rep-result-label').innerText = `Past ${Math.floor(maxGood)} yds`;
    document.getElementById('rep-result').innerText    = missReason;
    document.getElementById('rep-result').className    = missReason === 'Good' ? 'text-green' : 'text-red';

    const driftYds = report.driftYards || 0;
    document.getElementById('rep-drift-yds').innerText = `${driftYds > 0 ? '+' : ''}${driftYds} yds`;

    const timeVal = report.time || report.totalTime || 0;
    const heightVal = report.height || report.peakHeightFeet || 0;
    const angleVal = report.angle || report.launchAngle || 0;
    const apexVal = report.trueApexTime || 0;

    document.getElementById('rep-time').innerText      = `${timeVal.toFixed(2)}s`;
    document.getElementById('rep-height').innerText    = `${heightVal.toFixed(1)} ft`;
    document.getElementById('rep-angle').innerText     = `${angleVal.toFixed(1)}°`;
    document.getElementById('rep-apex').innerText      = `${apexVal.toFixed(2)}s`;

    // Only show alternative uprights if the values were saved in the report
    if (cfg.uprightType !== 'custom' && report.nflGoodDistance !== undefined && report.cfbGoodDistance !== undefined) {
        document.getElementById('rep-multi-section').style.display = 'block';
        document.getElementById('rep-nfl-good').innerText = `≤ ${Math.floor(report.nflGoodDistance)} yds`;
        document.getElementById('rep-cfb-good').innerText = `≤ ${Math.floor(report.cfbGoodDistance)} yds`;
    } else {
        document.getElementById('rep-multi-section').style.display = 'none';
    }

    document.getElementById('report-modal').style.display = 'flex';
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
