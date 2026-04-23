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

        // ── 1. Scale reference ────────────────────────────────────────────────
        const sdx = (scaleDots[1].x - scaleDots[0].x) * canvasWidth;
        const sdy = (scaleDots[1].y - scaleDots[0].y) * canvasHeight;
        const scalePixelDist    = Math.sqrt(sdx*sdx + sdy*sdy) || 1;
        const yardsPerPixel_ref = 10.0 / scalePixelDist;

        console.log('── SCALE ──────────────────────────────');
        console.log('scaleDot[0]:', scaleDots[0]);
        console.log('scaleDot[1]:', scaleDots[1]);
        console.log('scalePixelDist (px):', scalePixelDist.toFixed(3));
        console.log('yardsPerPixel_ref:', yardsPerPixel_ref.toFixed(6));
        console.log('canvasWidth:', canvasWidth, 'canvasHeight:', canvasHeight);

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

        console.log('── TIMING ─────────────────────────────');
        console.log('totalTime:', totalTime.toFixed(3), 's');
        rawPoints.forEach((p, i) => {
            console.log(`  ${p.label}: t=${times[i].toFixed(3)}s  xNorm=${p.xNorm.toFixed(4)}  yNorm=${p.yNorm.toFixed(4)}`);
        });

        // ── 3. Fit vertical parabola ──────────────────────────────────────────
        const yPixels = rawPoints.map(p => p.yNorm * canvasHeight);
        const [ay, by, cy] = this._fitParabola(times, yPixels);

        console.log('── VERTICAL FIT ───────────────────────');
        console.log('yPixels:', yPixels.map(v => v.toFixed(1)));
        console.log('vertical parabola [ay, by, cy]:', [ay, by, cy].map(v => v.toFixed(6)));

        // ── 4. True apex from fit ─────────────────────────────────────────────
        const trueApexTime = (ay > 0.001)
            ? Math.max(0, Math.min(-by / (2*ay), totalTime))
            : totalTime / 2;

        const apexYPixel   = ay*trueApexTime*trueApexTime + by*trueApexTime + cy;
        const impactYPixel = cy;

        console.log('trueApexTime:', trueApexTime.toFixed(3), 's');
        console.log('impactYPixel:', impactYPixel.toFixed(2), 'apexYPixel:', apexYPixel.toFixed(2));
        console.log('dyPixels (impact-apex, positive=ball went up):', (impactYPixel - apexYPixel).toFixed(2));

        // ── 5. Scale from gravity encoded in fit ──────────────────────────────
        const g_px       = 2 * ay;
        const ftPerPixel = (g_px > 0.001) ? (this.gravity / g_px) : (yardsPerPixel_ref * 3);

        console.log('── REAL-WORLD SCALE ───────────────────');
        console.log('g_px (fitted gravity px/s²):', g_px.toFixed(6));
        console.log('ftPerPixel:', ftPerPixel.toFixed(6));
        console.log('yardsPerPixel_ref:', yardsPerPixel_ref.toFixed(6));

        // ── 6. Vertical velocities ────────────────────────────────────────────
        const vUp_fps  = Math.max(0, -by * ftPerPixel);
        const heightFt = Math.max(0, (impactYPixel - apexYPixel) * ftPerPixel);

        console.log('── VERTICAL PHYSICS ───────────────────');
        console.log('vUp_fps:', vUp_fps.toFixed(3), 'ft/s');
        console.log('heightFt:', heightFt.toFixed(2), 'ft');

        // ── 7. Forward velocity ───────────────────────────────────────────────
        const t_ascent  = trueApexTime;
        const t_descent = Math.max(0.01, totalTime - trueApexTime);
        const vFwd_fps  = vUp_fps * (t_descent / Math.max(0.01, t_ascent));
        const vFwd_yds  = vFwd_fps / 3;
        const launchAngleDeg = Math.atan2(vUp_fps, vFwd_fps) * (180 / Math.PI);

        console.log('── FORWARD VELOCITY ───────────────────');
        console.log('t_ascent:', t_ascent.toFixed(3), 't_descent:', t_descent.toFixed(3));
        console.log('vFwd_fps:', vFwd_fps.toFixed(3), 'ft/s  =  vFwd_yds:', vFwd_yds.toFixed(3), 'yds/s');
        console.log('launchAngle:', launchAngleDeg.toFixed(2), '°');

        // ── 8. Kick distance ──────────────────────────────────────────────────
        const kickDist_yd = vFwd_yds * totalTime;
        console.log('kickDist_yd:', kickDist_yd.toFixed(2), 'yds');

        // ── 9. 3D points ──────────────────────────────────────────────────────
        console.log('── 3D POINTS ──────────────────────────');
        console.log('cameraDistance:', cameraDistance, 'yds');
        console.log('uprightCenterX:', uprightCenterX);
        console.log('startPt.pos.x (centerX):', startPt.pos.x.toFixed(4));
        if (uprightCenterX !== null) {
            const offsetPx = (startPt.pos.x - uprightCenterX) * canvasWidth;
            console.log('cameraOffsetPx (subtracted from each lateral):', offsetPx.toFixed(3));
        }

        const points3d = rawPoints.map((p, i) => {
            const t = times[i];
            const Z = vFwd_yds * t;

            let lateralPx = p.isNorm ? (p.xNorm - 0.5) * canvasWidth : 0;
            const rawLateralPx = lateralPx;

            if (uprightCenterX !== null && p.isNorm) {
                const cameraOffsetPx = (startPt.pos.x - uprightCenterX) * canvasWidth;
                lateralPx -= cameraOffsetPx;
            }
            const X = lateralPx * yardsPerPixel_ref;

            const fittedYPx = ay*t*t + by*t + cy;
            const Y_ft = Math.max(0, (impactYPixel - fittedYPx) * ftPerPixel);

            console.log(`  ${p.label}: Z=${Z.toFixed(1)}yd  rawLateralPx=${rawLateralPx.toFixed(2)}  correctedLateralPx=${lateralPx.toFixed(2)}  X=${X.toFixed(3)}yd  Y=${Y_ft.toFixed(2)}ft`);

            return { Z, X, Y: Y_ft, label: p.label };
        });

        // ── 10. Fit lateral parabola (weighted, unconstrained 3x3) ───────────
        const Zvals = points3d.map(p => p.Z);
        const Xvals = points3d.map(p => p.X);
        const Wvals = points3d.map(p => 1 / Math.pow(p.Z + cameraDistance, 2));
        const latCoeffs = this._fitParabolaWeighted(Zvals, Xvals, Wvals);
        const [al, bl, cl] = latCoeffs;

        console.log('── LATERAL FIT ────────────────────────');
        console.log('Zvals:', Zvals.map(v => v.toFixed(1)));
        console.log('Xvals:', Xvals.map(v => v.toFixed(4)));
        console.log('Wvals:', Wvals.map(v => v.toFixed(8)));
        console.log('latCoeffs [a, b, c]:', [al, bl, cl].map(v => v.toFixed(6)));
        console.log('lateral at Z=0 (should be ~0 if ball lined up with uprights):', cl.toFixed(4), 'yds');
        console.log('lateral at Z=kickDist:', (al*kickDist_yd*kickDist_yd + bl*kickDist_yd + cl).toFixed(3), 'yds');

        // ── 11. Good From ─────────────────────────────────────────────────────
        console.log('── GOOD FROM ──────────────────────────');
        console.log('tol:', tol);
        const maxGood = this._calcMaxGoodAsym(vUp_fps, vFwd_yds, latCoeffs, kickDist_yd, tol);
        console.log('maxGood result:', maxGood, 'yds');

        // ── 12. Drift at landing ──────────────────────────────────────────────
        const driftAtLanding = al*kickDist_yd*kickDist_yd + bl*kickDist_yd + cl;
        let driftLabel;
        if      (Math.abs(driftAtLanding) < 0.5) driftLabel = 'Straight';
        else if (driftAtLanding > 0)              driftLabel = 'Drift Right';
        else                                       driftLabel = 'Drift Left';

        console.log('driftAtLanding:', driftAtLanding.toFixed(3), 'yds →', driftLabel);

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
            _vUp:       vUp_fps,
            _vFwd:      vFwd_yds,
            _latCoeffs: latCoeffs,
        };
    }

    calcMaxGoodExternal(vUp_fps, vFwd_yds, latCoeffs, kickDist_yd, tol) {
        return this._calcMaxGoodAsym(vUp_fps, vFwd_yds, latCoeffs, kickDist_yd, tol);
    }

    _calcMaxGoodAsym(vUp_fps, vFwd_yds, latCoeffs, maxDist, tol) {
        const [al, bl, cl] = latCoeffs;
        const crossbar = tol.crossbarFt || 10;
        let maxGood = 0;

        console.log('  [loop] vUp_fps:', vUp_fps.toFixed(3), 'vFwd_yds:', vFwd_yds.toFixed(3), 'maxDist:', maxDist.toFixed(1));
        console.log('  [loop] tol.leftTol:', tol.leftTol, 'tol.rightTol:', tol.rightTol, 'crossbar:', crossbar);

        // Log first 10 yards and every 10 yards after to see where it fails
        for (let D = 0.5; D <= maxDist + 0.5; D += 0.5) {
            const t_D    = D / (vFwd_yds || 0.001);
            const height = vUp_fps * t_D - 0.5 * this.gravity * t_D * t_D;
            const lateral = al*D*D + bl*D + cl;
            const inWindow = lateral <= tol.rightTol && lateral >= -tol.leftTol;
            const heightOk = height >= crossbar;

            if (D <= 5 || D % 10 === 0) {
                console.log(`  D=${D.toFixed(1)}yd: t=${t_D.toFixed(3)}s  height=${height.toFixed(2)}ft (ok:${heightOk})  lateral=${lateral.toFixed(3)}yd (inWindow:${inWindow})  maxGood=${maxGood}`);
            }

            if (heightOk && inWindow) maxGood = D;
        }

        return maxGood;
    }

    // ── Weighted unconstrained parabola fit: y = ax² + bx + c ────────────────
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

    // ── Unweighted parabola fit (used for vertical) ───────────────────────────
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
