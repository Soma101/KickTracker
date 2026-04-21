class KickPhysicsEngine {
    constructor() {
        this.gravity = 32.17;
    }

    /**
     * Calculates kick kinematics and scoring projections.
     * @param {Object} startPt - {time, pos: {x, y}}
     * @param {Object} peakPt - {time, pos: {x, y}}
     * @param {Object} endPt - {time, pos: {x, y}}
     * @param {Array} scaleDots - [{x, y}, {x, y}]
     * @param {number} cameraDistance - Camera depth in yards
     * @param {number} canvasWidth - Current width of the canvas element
     * @returns {Object} Report containing maxGoodDistance, drift, time, height, and angle
     */
    calculate(startPt, peakPt, endPt, scaleDots, cameraDistance, canvasWidth) {
        const t1 = startPt.time;
        const t2 = peakPt.time;
        const t3 = endPt.time;
        
        const totalTime = Math.abs(t3 - t1);
        const peakTime = Math.abs(t2 - t1);
        
        // Vertical Physics
        const heightFt = 0.5 * this.gravity * Math.pow(peakTime, 2);
        const vUp = this.gravity * peakTime;

        // Forward Velocity (Yards/sec)
        const vFwd = cameraDistance / (totalTime > 0 ? totalTime : 1);
        const launchAngleDeg = Math.atan2(vUp, vFwd * 3) * (180 / Math.PI); // Convert yards to feet for angle

        // Lateral Drift Math
        const dxPixels = endPt.pos.x - startPt.pos.x;
        const scalePixelDist = Math.sqrt(Math.pow((scaleDots[1].x - scaleDots[0].x), 2) + Math.pow((scaleDots[1].y - scaleDots[0].y), 2));
        const yardsPerPixel = 10.0 / (scalePixelDist || 1);
        const lateralDriftYards = dxPixels * canvasWidth * yardsPerPixel;

        // Good From logic (Assuming goal posts are ~6.16 yards wide, so +/- 3.08 yards from center)
        const toleranceYards = 3.08;
        let maxGood = 0;

        if (Math.abs(lateralDriftYards) < 0.2) {
            maxGood = cameraDistance + 20; // Straight kick, good from far
        } else {
            // Similar triangles: (MaxGood / cameraDistance) = (tolerance / |lateralDrift|)
            maxGood = (toleranceYards / Math.abs(lateralDriftYards)) * cameraDistance;
            
            // Cap it by vertical drop distance (can't be good if it drops below 10ft crossbar)
            const vZ0 = vFwd * 3; 
            const a = 0.5 * this.gravity, b = -vUp, c = 10.0;
            const disc = (b * b) - (4 * a * c);
            const crossbarTime = disc > 0 ? (-b + Math.sqrt(disc)) / (2 * a) : totalTime;
            const dropLimitYards = (vZ0 * crossbarTime) / 3;
            
            maxGood = Math.min(maxGood, dropLimitYards);
        }

        return {
            maxGoodDistance: maxGood,
            drift: Math.abs(lateralDriftYards) < 0.5 ? "Straight" : (lateralDriftYards > 0 ? "Drift Right" : "Drift Left"),
            time: totalTime,
            height: heightFt,
            angle: launchAngleDeg
        };
    }
}
