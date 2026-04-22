class KickPhysicsEngine {
    constructor() {
        this.gravity    = 32.174;  // ft/s²
        this.BALL_IN    = 6.7;     // regulation football short-axis height, inches
        this.UPRIGHT_HW = 3.08;    // half-width of uprights in yards (18.5ft / 2 / 3)
        this.CROSSBAR_H = 10.0;    // crossbar height in feet
    }

    /**
     * Full 5-point kick analysis using parabola fitting.
     * No single point is assumed to be the true apex — the fit finds it.
     *
     * @param {Object} startPt         {time, pos:{x,y}}  impact   (raw coords, x=centerX)
     * @param {Object} peakPt          {time, pos:{x,y}}  user's "apex" tap (imprecise)
     * @param {Object} endPt           {time, pos:{x,y}}  landing  (normalized)
     * @param {Array}  scaleDots       [{x,y},{x,y}]      10-yard reference dots
     * @param {number} cameraDistance                      camera to ball at tee, yards
     * @param {number} canvasWidth                         canvas CSS width, pixels
     * @param {Object} halfUpPt        {time, pos:{x,y}}  half-way up   (normalized)
     * @param {Object} halfDownPt      {time, pos:{x,y}}  half-way down (normalized)
     * @param {number} ballTeePixelHeight                  pixel height of ball on tee
     * @param {number} canvasHeight                        canvas CSS height, pixels
     *
     * @returns {Object} maxGoodDistance, drift, driftYards, kickDistance,
     *                   time, height, angle, trueApexTime, points3d
     */
    calculate(startPt, peakPt, endPt,
              scaleDots, cameraDistance, canvasWidth,
              halfUpPt, halfDownPt,
              ballTeePixelHeight, canvasHeight) {

        // ── 1. Scale reference ────────────────────────────────────────────────
        // Convert normalized scale dot coords to canvas pixels, get distance
        const sdx = (scaleDots[1].x - scaleDots[0].x) * canvasWidth;
        const sdy = (scaleDots[1].y - scaleDots[0].y) * canvasHeight;
        const scalePixelDist = Math.sqrt(sdx*sdx + sdy*sdy) || 1;
        // yards per pixel at impact depth (where scale dots are assumed to be)
        const yardsPerPixel_ref = 10.0 / scalePixelDist;

        // ── 2. Collect all 5 points in time order ─────────────────────────────
        const t_impact = startPt.time;
        const totalTime = endPt.time - t_impact;

        const rawPoints = [
            { time: startPt.time,    xNorm: startPt.pos.x,    yNorm: startPt.pos.y,    isNorm: false },
            { time: halfUpPt.time,   xNorm: halfUpPt.pos.x,   yNorm: halfUpPt.pos.y,   isNorm: true  },
            { time: peakPt.time,     xNorm: peakPt.pos.x,     yNorm: peakPt.pos.y,     isNorm: true  },
            { time: halfDownPt.time, xNorm: halfDownPt.pos.x, yNorm: halfDownPt.pos.y, isNorm: true  },
            { time: endPt.time,      xNorm: endPt.pos.x,      yNorm: endPt.pos.y,      isNorm: true  },
        ];

        // Times relative to impact (t=0 at impact)
        const times = rawPoints.map(p => p.time - t_impact);

        // ── 3. Fit vertical parabola in pixel space ───────────────────────────
        // y pixel increases downward. Ball going up = y decreasing.
        // Fit: yPixel(t) = ay*t² + by*t + cy
        // For a ball under gravity going up then down:
        //   ay > 0  (parabola opens upward in screen coords = ball comes back down)
        //   by < 0  (initially moving up = y decreasing)
        //   cy = impact y pixel
        const yPixels = rawPoints.map(p => p.yNorm * canvasHeight);
        const [ay, by, cy] = this._fitParabola(times, yPixels);

        // ── 4. True apex from fit ─────────────────────────────────────────────
        // Apex = minimum y pixel (highest point on screen) = vertex of parabola
        // dy/dt = 2*ay*t + by = 0  →  t_apex = -by / (2*ay)
        const trueApexTime = (ay > 0.001)
            ? Math.max(0, Math.min(-by / (2 * ay), totalTime))
            : totalTime / 2;

        const apexYPixel    = ay*trueApexTime*trueApexTime + by*trueApexTime + cy;
        const impactYPixel  = cy; // at t=0

        // ── 5. Real-world scale from fit ──────────────────────────────────────
        // The fitted parabola contains real gravity encoded in its curvature.
        // In pixel space:  ay = 0.5 * g_px   where g_px = gravity in pixels/s²
        // In real space:   ay_real = 0.5 * g_real  where g_real = 32.174 ft/s²
        //
        // Scale factor: ftPerPixel = g_real / (2 * ay)
        // This converts any pixel displacement to feet.
        const g_px = 2 * ay; // fitted gravity in pixels/s²
        const ftPerPixel = (g_px > 0.001) ? (this.gravity / g_px) : (yardsPerPixel_ref * 3);

        // ── 6. Vertical velocities ────────────────────────────────────────────
        // vUp_fps = initial upward velocity in ft/s
        // From parabola fit: d(yPixel)/dt at t=0 = by  (pixels/s, negative = moving up)
        // vUp_fps = -by * ftPerPixel  (positive upward)
        const vUp_fps = Math.max(0, -by * ftPerPixel);

        // Peak height in feet
        const heightFt = Math.max(0, (impactYPixel - apexYPixel) * ftPerPixel);

        // ── 7. Forward velocity ───────────────────────────────────────────────
        // Use the fitted apex time (not the user's tap) to get the true ascent/descent split.
        // For a gravity parabola:
        //   vUp_fps = g * t_ascent  →  t_ascent = vUp_fps / g  (theoretical)
        // But we use the MEASURED t_ascent from the fit (more accurate, accounts for
        // any drag or asymmetry visible in the 5 tapped points).
        //
        // From projectile motion: vFwd is constant.
        // At landing (t = totalTime): ball is back at y=0.
        // Theoretical flight time (no drag) = 2 * vUp_fps / g
        // We use measured totalTime since that's what actually happened.
        //
        // vFwd comes from the ascent/descent ratio:
        //   In a symmetric arc: t_ascent = t_descent, vFwd = anything.
        //   The ratio t_descent/t_ascent captures asymmetry from drag.
        //   vFwd_fps = vUp_fps * (t_descent / t_ascent)
        //   This is the same as: vFwd = (kick_distance / totalTime)
        //   solved via energy, and gives correct distance when arc is asymmetric.
        const t_ascent  = trueApexTime;
        const t_descent = Math.max(0.01, totalTime - trueApexTime);
        const vFwd_fps  = vUp_fps * (t_descent / Math.max(0.01, t_ascent));
        const vFwd_yds  = vFwd_fps / 3;

        const launchAngleDeg = Math.atan2(vUp_fps, vFwd_fps) * (180 / Math.PI);

        // ── 8. Predicted kick distance ────────────────────────────────────────
        // Use kinematic formula: ball lands when Y=0 again after impact.
        // Y(t) = vUp_fps*t - 0.5*g*t² = 0  →  t = 2*vUp_fps/g
        // This is the theoretical flight time under gravity only.
        // For a slightly asymmetric arc we instead use totalTime directly since
        // that's what the video shows.
        const kickDist_yd = vFwd_yds * totalTime;

        // ── 9. 3D positions of all 5 points ──────────────────────────────────
        // Z: forward distance (constant vFwd, yards)
        // X: lateral position (perspective-corrected, yards)
        // Y: height (from fitted parabola, feet)
        const points3d = rawPoints.map((p, i) => {
            const t = times[i];

            // Z: forward distance
            const Z = vFwd_yds * t;

            // Depth at this point from camera
            const depth_yd = cameraDistance + Z;

            // yardsPerPixel grows with depth (pinhole perspective correction)
            const ypp = yardsPerPixel_ref * (depth_yd / cameraDistance);

            // X: lateral offset in yards (0 at impact by definition)
            const lateralPx = p.isNorm ? (p.xNorm - 0.5) * canvasWidth : 0;
            const X = lateralPx * ypp;

            // Y: height from fitted parabola
            const fittedYPx = ay*t*t + by*t + cy;
            const Y_ft = Math.max(0, (impactYPixel - fittedYPx) * ftPerPixel);

            return { Z, X, Y: Y_ft };
        });

        const labels = ['impact','halfUp','apex','halfDown','landing'];
        points3d.forEach((p, i) => p.label = labels[i]);

        // ── 10. Fit lateral parabola: X = al*Z² + bl*Z + cl ──────────────────
        const Zvals = points3d.map(p => p.Z);
        const Xvals = points3d.map(p => p.X);
        const [al, bl, cl] = this._fitParabola(Zvals, Xvals);

        // ── 11. Good From ─────────────────────────────────────────────────────
        const maxGood = this._calcMaxGood(vUp_fps, vFwd_yds, al, bl, cl, kickDist_yd);

        // ── 12. Drift at predicted landing ────────────────────────────────────
        const driftAtLanding = al*kickDist_yd*kickDist_yd + bl*kickDist_yd + cl;
        let driftLabel;
        if      (Math.abs(driftAtLanding) < 0.5) driftLabel = "Straight";
        else if (driftAtLanding > 0)              driftLabel = "Drift Right";
        else                                       driftLabel = "Drift Left";

        return {
            maxGoodDistance: maxGood,
            drift:           driftLabel,
            driftYards:      parseFloat(driftAtLanding.toFixed(2)),
            kickDistance:    parseFloat(kickDist_yd.toFixed(1)),
            time:            parseFloat(totalTime.toFixed(2)),
            height:          parseFloat(heightFt.toFixed(1)),
            angle:           parseFloat(launchAngleDeg.toFixed(1)),
            trueApexTime:    parseFloat(trueApexTime.toFixed(2)),
            points3d,
        };
    }

    // ── Least-squares parabola fit: y = ax² + bx + c ─────────────────────────
    _fitParabola(xs, ys) {
        const n = xs.length;
        let s1=0, s2=0, s3=0, s4=0, t0=0, t1=0, t2=0;
        for (let i = 0; i < n; i++) {
            const x=xs[i], y=ys[i], x2=x*x;
            s1+=x; s2+=x2; s3+=x2*x; s4+=x2*x2;
            t0+=y; t1+=x*y; t2+=x2*y;
        }
        const M   = [[s4,s3,s2],[s3,s2,s1],[s2,s1,n]];
        const rhs = [t2, t1, t0];
        return this._solve3x3(M, rhs);
    }

    // Gaussian elimination for 3×3 system
    _solve3x3(M, rhs) {
        const A = M.map((row, i) => [...row, rhs[i]]);
        for (let col = 0; col < 3; col++) {
            let maxRow = col;
            for (let row = col+1; row < 3; row++) {
                if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
            }
            [A[col], A[maxRow]] = [A[maxRow], A[col]];
            if (Math.abs(A[col][col]) < 1e-12) continue;
            for (let row = col+1; row < 3; row++) {
                const f = A[row][col] / A[col][col];
                for (let k = col; k <= 3; k++) A[row][k] -= f * A[col][k];
            }
        }
        const x = [0,0,0];
        for (let i = 2; i >= 0; i--) {
            x[i] = A[i][3];
            for (let j = i+1; j < 3; j++) x[i] -= A[i][j] * x[j];
            x[i] /= (A[i][i] || 1);
        }
        return x;
    }

    // Step through 0→maxDist in 0.5yd steps.
    // Returns largest D where height ≥ crossbar AND |lateral| ≤ upright half-width.
    _calcMaxGood(vUp_fps, vFwd_yds, al, bl, cl, maxDist) {
        let maxGood = 0;
        for (let D = 0.5; D <= maxDist + 0.5; D += 0.5) {
            const t_at_D = D / (vFwd_yds || 0.001);
            const height  = vUp_fps * t_at_D - 0.5 * this.gravity * t_at_D * t_at_D;
            const lateral = Math.abs(al*D*D + bl*D + cl);
            if (height >= this.CROSSBAR_H && lateral <= this.UPRIGHT_HW) {
                maxGood = D;
            }
        }
        return maxGood;
    }
}
