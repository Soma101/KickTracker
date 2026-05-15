class KickPhysicsEngine {
    constructor() {
        this.gravity = 32.174; // ft/s²
    }

    calculate(startPt, peakPt, endPt,
              scaleDots, cameraDistance, canvasWidth,
              halfUpPt, halfDownPt,
              ballTeePixelHeight, canvasHeight,
              ballLengthIn,
              tol,
              uprightCenterX) {

        ballLengthIn = ballLengthIn || 11;

        // ── 1. Scale reference (Using Football Size) ──────────────────────────
        const ballLengthYds = ballLengthIn / 36.0;
        const safePixelHeight = Math.max(ballTeePixelHeight, 1);
        const yardsPerPixel_ref = ballLengthYds / safePixelHeight;

        console.log('── SCALE ──────────────────────────────');
        console.log('ballLengthIn:', ballLengthIn, 'in ->', ballLengthYds.toFixed(4), 'yds');
        console.log('ballTeePixelHeight (px):', ballTeePixelHeight.toFixed(3));
        console.log('yardsPerPixel_ref:', yardsPerPixel_ref.toFixed(6));

        // ── 2. Raw points + times ─────────────────────────────────────────────
        const t_impact  = startPt.time;
        const totalTime = endPt.time - t_impact;

        const rawPoints = [
            { time: startPt.time,    xNorm: startPt.pos.x,    yNorm: startPt.pos.y,    isNorm: false, label: 'impact'   },
            { time: halfUpPt.time,   xNorm: halfUpPt.pos.x,   yNorm: halfUpPt.pos.y,   isNorm: true,  label: 'halfUp'   },
            { time: peakPt.time,     xNorm: peakPt.pos.x,     yNorm: peakPt.pos.y,     isNorm: true,  label: 'apex'     },
            { time: halfDownPt.time, xNorm: halfDownPt.pos.x, yNorm: halfDownPt.pos.y, isNorm: true,  label: 'halfDown' },
            { time: endPt.time,      xNorm: endPt.pos.x,      yNorm: endPt.pos.y,      isNorm: true,  label: 'landing'  },
        ];
        const times = rawPoints.map(p => p.time - t_impact);

        // ── 3. Fit vertical parabola ──────────────────────────────────────────
        const yPixels = rawPoints.map(p => p.yNorm * canvasHeight);
        const [ay, by, cy] = this._fitParabola(times, yPixels);

        // ── 4. True apex from fit ─────────────────────────────────────────────
        const trueApexTime = (ay > 0.001)
            ? Math.max(0, Math.min(-by / (2*ay), totalTime))
            : totalTime / 2;

        const apexYPixel   = ay*trueApexTime*trueApexTime + by*trueApexTime + cy;
        const impactYPixel = cy;

        // ── 5. Scale from gravity encoded in fit ──────────────────────────────
        const g_px       = 2 * ay;
        const ftPerPixel = (g_px > 0.001) ? (this.gravity / g_px) : (yardsPerPixel_ref * 3);

        // ── 6. Vertical velocities ────────────────────────────────────────────
        const vUp_fps  = Math.max(0, -by * ftPerPixel);
        const heightFt = Math.max(0, (impactYPixel - apexYPixel) * ftPerPixel);

        // ── 7. Forward velocity (Perspective Corrected) ───────────────────────
        // We calculate forward velocity mathematically based on the shift 
        // between the visual apex and physical apex due to camera perspective.
        const Z0_ft = cameraDistance * 3;
        const t_peak = Math.max(0.1, trueApexTime);
        const num = Z0_ft * (vUp_fps - this.gravity * t_peak);
        const den = 0.5 * this.gravity * t_peak * t_peak;

        let vFwd_fps;
        if (num > 0) {
            vFwd_fps = num / den;
        } else {
            // Edge case: if user taps apex too late, fallback to typical 40deg angle assumption
            vFwd_fps = vUp_fps * 1.2;
        }

        // Clamp to physically realistic NFL speeds (max ~90 mph = 132 fps)
        vFwd_fps = Math.max(10, Math.min(vFwd_fps, 150));
        
        const vFwd_yds  = vFwd_fps / 3;
        const launchAngleDeg = Math.atan2(vUp_fps, vFwd_fps) * (180 / Math.PI);

        console.log('── FORWARD VELOCITY ───────────────────');
        console.log('vFwd_fps:', vFwd_fps.toFixed(3), 'ft/s  =  vFwd_yds:', vFwd_yds.toFixed(3), 'yds/s');
        console.log('launchAngle:', launchAngleDeg.toFixed(2), '°');

        // ── 8. Kick distance ──────────────────────────────────────────────────
        const kickDist_yd = vFwd_yds * totalTime;
        console.log('kickDist_yd:', kickDist_yd.toFixed(2), 'yds');

        // ── 9. 3D points ──────────────────────────────────────────────────────
        const zeroRefX = (uprightCenterX !== null) ? uprightCenterX : startPt.pos.x;

        const points3d = rawPoints.map((p, i) => {
            const t = times[i];
            const Z = vFwd_yds * t;

            const lateralPx = p.isNorm ? (p.xNorm - 0.5) * canvasWidth : 0;
            
            // Perspective Scale: Geometrically fans out lateral pixels 
            // as the ball gets further away from the camera.
            const perspectiveScale = (cameraDistance + Z) / cameraDistance;
            const X = lateralPx * yardsPerPixel_ref * perspectiveScale;

            const fittedYPx = ay*t*t + by*t + cy;
            const Y_ft = Math.max(0, (impactYPixel - fittedYPx) * ftPerPixel);

            return { Z, X, Y: Y_ft, label: p.label };
        });

        // ── 10. Fit lateral parabola (weighted, unconstrained 3x3) ───────────
        const Zvals = points3d.map(p => p.Z);
        const Xvals = points3d.map(p => p.X);
        const Wvals = points3d.map(p => 1 / Math.pow(p.Z + cameraDistance, 2));
        const latCoeffs = this._fitParabolaWeighted(Zvals, Xvals, Wvals);
        const [al, bl, cl] = latCoeffs;

        // ── 11. Adjust tolerance window ───────────────────────────────────────
        let adjustedTol = { ...tol };
        if (uprightCenterX !== null) {
            const ballOffsetYds = (startPt.pos.x - uprightCenterX) * canvasWidth * yardsPerPixel_ref;
            adjustedTol = {
                ...tol,
                rightTol: tol.rightTol - ballOffsetYds,
                leftTol:  tol.leftTol  + ballOffsetYds,
            };
        }

        // ── 12. Good From ─────────────────────────────────────────────────────
        const maxGood = this._calcMaxGoodAsym(vUp_fps, vFwd_yds, latCoeffs, kickDist_yd, adjustedTol);

        // ── 13. Drift at landing ──────────────────────────────────────────────
        const driftAtLanding = al*kickDist_yd*kickDist_yd + bl*kickDist_yd + cl;
        let driftLabel;
        if      (Math.abs(driftAtLanding) < 0.5) driftLabel = 'Straight';
        else if (driftAtLanding > 0)             driftLabel = 'Drift Right';
        else                                     driftLabel = 'Drift Left';

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
            _vUp:        vUp_fps,
            _vFwd:       vFwd_yds,
            _latCoeffs:  latCoeffs,
            _adjustedTol: adjustedTol,
        };
    }

    calcMaxGoodExternal(vUp_fps, vFwd_yds, latCoeffs, kickDist_yd, tol) {
        return this._calcMaxGoodAsym(vUp_fps, vFwd_yds, latCoeffs, kickDist_yd, tol);
    }

    _calcMaxGoodAsym(vUp_fps, vFwd_yds, latCoeffs, maxDist, tol) {
        const [al, bl, cl] = latCoeffs;
        const crossbar = tol.crossbarFt || 10;
        let maxGood = 0;

        for (let D = 0.5; D <= maxDist + 0.5; D += 0.5) {
            const t_D    = D / (vFwd_yds || 0.001);
            const height = vUp_fps * t_D - 0.5 * this.gravity * t_D * t_D;
            const lateral = al*D*D + bl*D + cl;
            const inWindow = lateral <= tol.rightTol && lateral >= -tol.leftTol;
            const heightOk = height >= crossbar;

            if (heightOk && inWindow) maxGood = D;
        }

        return maxGood;
    }

    _fitParabolaWeighted(xs, ys, ws) {
        const n = xs.length;
        let s0=0,s1=0,s2=0,s3=0,s4=0,t0=0,t1=0,t2=0;
        for (let i=0;i<n;i++) {
            const w=ws[i], x=xs[i], y=ys[i], x2=x*x;
            s0+=w; s1+=w*x; s2+=w*x2; s3+=w*x2*x; s4+=w*x2*x2;
            t0+=w*y; t1+=w*x*y; t2+=w*x2*y;
        }
        const M   = [[s4,s3,s2],[s3,s2,s1],[s2,s1,s0]];
        const rhs = [t2,t1,t0];
        return this._solve3x3(M, rhs);
    }

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
