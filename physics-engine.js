class KickPhysicsEngine {
    constructor() {
        this.gravity = 32.17;
    }

    calculate(startPt, midUpPt, peakPt, midDownPt, endPt, scaleDots, cameraDistance, canvasWidth) {

        const t1 = startPt.time;
        const t2 = peakPt.time;
        const t3 = endPt.time;

        const totalTime = Math.abs(t3 - t1);
        const peakTime = Math.abs(t2 - t1);

        // --- Vertical Physics ---
        const heightFt = 0.5 * this.gravity * Math.pow(peakTime, 2);
        const vUp = this.gravity * peakTime;

        const vFwd = cameraDistance / (totalTime || 1);
        const launchAngleDeg = Math.atan2(vUp, vFwd * 3) * (180 / Math.PI);

        // --- SCALE ---
        const scalePixelDist = Math.sqrt(
            Math.pow(scaleDots[1].x - scaleDots[0].x, 2) +
            Math.pow(scaleDots[1].y - scaleDots[0].y, 2)
        );

        const yardsPerPixel = 10.0 / (scalePixelDist || 1);

        // --- 5-POINT DRIFT MODEL (CENTERLINE CORRECTED) ---
        const w = canvasWidth;

        const pts = [
            startPt,
            midUpPt,
            peakPt,
            midDownPt,
            endPt
        ];

        const startX = startPt.pos.x * w;

        let weightedSum = 0;
        let totalWeight = 0;

        pts.forEach((pt) => {
            if (!pt) return;

            const x = pt.pos.x * w;
            const dx = x - startX;

            const tNorm = (pt.time - t1) / (totalTime || 1);
            const weight = Math.max(0.15, tNorm); // later = stronger

            weightedSum += dx * weight;
            totalWeight += weight;
        });

        const avgDxPixels = weightedSum / (totalWeight || 1);

        const lateralDriftYards = avgDxPixels * yardsPerPixel;

        // --- Drift Label ---
        let driftLabel = "Straight";
        if (Math.abs(lateralDriftYards) > 0.5) {
            driftLabel = lateralDriftYards > 0 ? "Drift Right" : "Drift Left";
        }

        // --- Good From ---
        const toleranceYards = 3.08;

        let maxGood;

        if (Math.abs(lateralDriftYards) < 0.2) {
            maxGood = cameraDistance + 20;
        } else {
            maxGood = (toleranceYards / Math.abs(lateralDriftYards)) * cameraDistance;

            const vZ0 = vFwd * 3;
            const a = 0.5 * this.gravity, b = -vUp, c = 10.0;
            const disc = (b * b) - (4 * a * c);
            const crossbarTime = disc > 0 ? (-b + Math.sqrt(disc)) / (2 * a) : totalTime;
            const dropLimitYards = (vZ0 * crossbarTime) / 3;

            maxGood = Math.min(maxGood, dropLimitYards);
        }

        return {
            maxGoodDistance: maxGood,
            drift: driftLabel,
            time: totalTime,
            height: heightFt,
            angle: launchAngleDeg
        };
    }
}
