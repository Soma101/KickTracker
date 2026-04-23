class KickPhysicsEngine {
    constructor() {
        this.gravity = 32.174; // ft/s²
    }

    /**
     * @param {Object} startPt          {time, pos:{x,y}}
     * @param {Object} peakPt           {time, pos:{x,y}}  user's approx apex tap
     * @param {Object} endPt            {time, pos:{x,y}}
     * @param {Array}  scaleDots        [{x,y},{x,y}]
     * @param {number} cameraDistance   yards, camera to ball at tee
     * @param {number} canvasWidth      px
     * @param {Object} halfUpPt         {time, pos:{x,y}}
     * @param {Object} halfDownPt       {time, pos:{x,y}}
     * @param {number} ballTeePixelHeight px
     * @param {number} canvasHeight     px
     * @param {number} ballLengthIn     inches (NFL=11, CFB=10.5)
     * @param {Object} tol              {leftTol, rightTol, crossbarFt} in yards/feet
     * @param {number|null} uprightCenterX  normalized canvas X of tapped upright center (or null)
     */
    calculate(startPt, peakPt, endPt,
              scaleDots, cameraDistance, canvasWidth,
              halfUpPt, halfDownPt,
              ballTeePixelHeight, canvasHeight,
              ballLengthIn,
              tol,
              uprightCenterX) {

        ballLengthIn = ballLengthIn || 11;

        // ── 1. Scale reference ────────────────────────────────────────────────
        const sdx = (scaleDots[1].x - scaleDots[0].x) * canvasWidth;
        const sdy = (scaleDots[1].y - scaleDots[0].y) * canvasHeight;
        const scalePixelDist   = Math.sqrt(sdx*sdx + sdy*sdy) || 1;
        const yardsPerPixel_ref = 10.0 / scalePixelDist;

        // ── 2. Raw points + times ─────────────────────────────────────────────
        const t_impact  = startPt.time;
        const totalTime = endPt.time - t_impact;

        const rawPoints = [
            { time: startPt.time,    xNorm: startPt.pos.x,    yNorm: startPt.pos.y,    isNorm: false },
            { time: halfUpPt.time,   xNorm: halfUpPt.pos.x,   yNorm: halfUpPt.pos.y,   isNorm: true  },
            { time: peakPt.time,     xNorm: peakPt.pos.x,     yNorm: peakPt.pos.y,     isNorm: true  },
            { time: halfDownPt.time, xNorm: halfDownPt.pos.x, yNorm: halfDownPt.pos.y, isNorm: true  },
            { time: endPt.time,      xNorm: endPt.pos.x,      yNorm: endPt.pos.y,      isNorm: true  },
        ];
        const times = rawPoints.map(p => p.time - t_impact);

        // ── 3. Fit vertical parabola in pixel space ───────────────────────────
        // y pixel increases downward; ball going up = y decreasing
        const yPixels = rawPoints.map(p => p.yNorm * canvasHeight);
        const [ay, by, cy] = this._fitParabola(times, yPixels);

        // ── 4. True apex from fit ─────────────────────────────────────────────
        const trueApexTime = (ay > 0.001)
            ? Math.max(0, Math.min(-by / (2*ay), totalTime))
            : totalTime / 2;

        const apexYPixel   = ay*trueApexTime*trueApexTime + by*trueApexTime + cy;
        const impactYPixel = cy;

        // ── 5. Real-world scale from gravity encoded in fit ───────────────────
        // ay = 0.5 * g_px  →  g_px = 2*ay
        // ftPerPixel = g_real / g_px
        const g_px       = 2 * ay;
        const ftPerPixel = (g_px > 0.001) ? (this.gravity / g_px) : (yardsPerPixel_ref * 3);

        // ── 6. Vertical velocities ────────────────────────────────────────────
        const vUp_fps  = Math.max(0, -by * ftPerPixel);
        const heightFt = Math.max(0, (impactYPixel - apexYPixel) * ftPerPixel);

        // ── 7. Forward velocity from asymmetric apex split ────────────────────
        const t_ascent  = trueApexTime;
        const t_descent = Math.max(0.01, totalTime - trueApexTime);
        const vFwd_fps  = vUp_fps * (t_descent / Math.max(0.01, t_ascent));
        const vFwd_yds  = vFwd_fps / 3;
        const launchAngleDeg = Math.atan2(vUp_fps, vFwd_fps) * (180 / Math.PI);

        // ── 8. Kick distance ──────────────────────────────────────────────────
        const kickDist_yd = vFwd_yds * totalTime;

        // ── 9. 3D points ──────────────────────────────────────────────────────
        const points3d = rawPoints.map((p, i) => {
            const t = times[i];
            const Z = vFwd_yds * t;

            // Lateral: constant scale, no depth multiplier.
            // Camera is directly behind the ball so lateral drift is in the
            // same plane as the scale dots regardless of forward distance.
            // Depth scaling massively over-amplifies pixel noise at long range.
            let lateralPx = p.isNorm ? (p.xNorm - 0.5) * canvasWidth : 0;
            if (uprightCenterX !== null && p.isNorm) {
                const cameraOffsetPx = (startPt.pos.x - uprightCenterX) * canvasWidth;
                lateralPx -= cameraOffsetPx;
            }
            const X = lateralPx * yardsPerPixel_ref;

            const fittedYPx = ay*t*t + by*t + cy;
            const Y_ft = Math.max(0, (impactYPixel - fittedYPx) * ftPerPixel);

            return { Z, X, Y: Y_ft };
        });

        const labels = ['impact','halfUp','apex','halfDown','landing'];
        points3d.forEach((p,i) => p.label = labels[i]);

        // ── 10. Fit lateral parabola ──────────────────────────────────────────
        const Zvals = points3d.map(p => p.Z);
        const Xvals = points3d.map(p => p.X);
        const latCoeffs = this._fitParabola(Zvals, Xvals);

        // ── 11. Good From with asymmetric tolerance ───────────────────────────
        const maxGood = this._calcMaxGoodAsym(vUp_fps, vFwd_yds, latCoeffs, kickDist_yd, tol);

        // ── 12. Drift at landing ──────────────────────────────────────────────
        const [al,bl,cl] = latCoeffs;
        const driftAtLanding = al*kickDist_yd*kickDist_yd + bl*kickDist_yd + cl;
        let driftLabel;
        if      (Math.abs(driftAtLanding) < 0.5) driftLabel = 'Straight';
        else if (driftAtLanding > 0)              driftLabel = 'Drift Right';
        else                                       driftLabel = 'Drift Left';

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
            // Internal values exposed for multi-standard comparison
            _vUp:       vUp_fps,
            _vFwd:      vFwd_yds,
            _latCoeffs: latCoeffs,
        };
    }

    /**
     * External entry point so the UI can compute good-from for
     * NFL/CFB uprights independently without re-running everything.
     */
    calcMaxGoodExternal(vUp_fps, vFwd_yds, latCoeffs, kickDist_yd, tol) {
        return this._calcMaxGoodAsym(vUp_fps, vFwd_yds, latCoeffs, kickDist_yd, tol);
    }

    // ── Asymmetric good-from ──────────────────────────────────────────────────
    // tol.leftTol  = yards of room on the LEFT side of upright center (can be negative)
    // tol.rightTol = yards of room on the RIGHT side of upright center (can be negative)
    // Drift > 0 = right, < 0 = left
    _calcMaxGoodAsym(vUp_fps, vFwd_yds, latCoeffs, maxDist, tol) {
        const [al, bl, cl] = latCoeffs;
        const crossbar = tol.crossbarFt || 10;
        let maxGood = 0;
        for (let D = 0.5; D <= maxDist + 0.5; D += 0.5) {
            const t_D   = D / (vFwd_yds || 0.001);
            const height  = vUp_fps * t_D - 0.5 * this.gravity * t_D * t_D;
            const lateral = al*D*D + bl*D + cl; // positive = right, negative = left
            // Within upright window?
            const inWindow = lateral <= tol.rightTol && lateral >= -tol.leftTol;
            if (height >= crossbar && inWindow) maxGood = D;
        }
        return maxGood;
    }

    // ── Least-squares parabola fit: y = ax² + bx + c ─────────────────────────
    _fitParabola(xs, ys) {
        const n = xs.length;
        let s1=0,s2=0,s3=0,s4=0,t0=0,t1=0,t2=0;
        for (let i=0;i<n;i++) {
            const x=xs[i],y=ys[i],x2=x*x;
            s1+=x; s2+=x2; s3+=x2*x; s4+=x2*x2;
            t0+=y; t1+=x*y; t2+=x2*y;
        }
        const M   = [[s4,s3,s2],[s3,s2,s1],[s2,s1,n]];
        const rhs = [t2,t1,t0];
        return this._solve3x3(M, rhs);
    }

    _solve3x3(M, rhs) {
        const A = M.map((row,i) => [...row, rhs[i]]);
        for (let col=0;col<3;col++) {
            let mr=col;
            for (let row=col+1;row<3;row++) if (Math.abs(A[row][col])>Math.abs(A[mr][col])) mr=row;
            [A[col],A[mr]]=[A[mr],A[col]];
            if (Math.abs(A[col][col])<1e-12) continue;
            for (let row=col+1;row<3;row++) {
                const f=A[row][col]/A[col][col];
                for (let k=col;k<=3;k++) A[row][k]-=f*A[col][k];
            }
        }
        const x=[0,0,0];
        for (let i=2;i>=0;i--) {
            x[i]=A[i][3];
            for (let j=i+1;j<3;j++) x[i]-=A[i][j]*x[j];
            x[i]/=(A[i][i]||1);
        }
        return x;
    }
}
