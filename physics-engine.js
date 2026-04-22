class KickPhysicsEngine {
    constructor() {
        this.gravity    = 32.174;  // ft/s²
        this.BALL_IN    = 6.7;     // regulation football short-axis height, inches
        this.UPRIGHT_HW = 3.08;    // half-width of uprights in yards (18.5ft / 2 / 3)
        this.CROSSBAR_H = 10.0;    // crossbar height in feet
    }

    /**
     * Full 5-point kick analysis.
     *
     * @param {Object} startPt      {time, pos:{x,y}}  — impact   (raw canvas coords, x=centerX)
     * @param {Object} peakPt       {time, pos:{x,y}}  — apex     (normalized: x relative to 0.5 center)
     * @param {Object} endPt        {time, pos:{x,y}}  — landing  (normalized)
     * @param {Array}  scaleDots    [{x,y},{x,y}]      — 10-yard reference dots (normalized)
     * @param {number} cameraDistance                  — camera to ball at tee, yards
     * @param {number} canvasWidth                     — canvas CSS width, pixels
     * @param {Object} halfUpPt     {time, pos:{x,y}}  — half-way up   (normalized)
     * @param {Object} halfDownPt   {time, pos:{x,y}}  — half-way down (normalized)
     * @param {number} ballTeePixelHeight              — pixel height of ball on tee (top tap − bottom tap)
     * @param {number} canvasHeight                    — canvas CSS height, pixels
     *
     * @returns {Object} Report: maxGoodDistance, drift, driftYards, kickDistance,
     *                           time, height, angle, points3d
     */
    calculate(startPt, peakPt, endPt,
              scaleDots, cameraDistance, canvasWidth,
              halfUpPt, halfDownPt,
              ballTeePixelHeight, canvasHeight) {

        // ── 1. Scale reference ────────────────────────────────────────────────
        // Pixel distance between the two scale dots (normalized 0-1 coords → canvas pixels)
        const sdx = (scaleDots[1].x - scaleDots[0].x) * canvasWidth;
        const sdy = (scaleDots[1].y - scaleDots[0].y) * canvasHeight;
        const scalePixelDist = Math.sqrt(sdx * sdx + sdy * sdy) || 1;

        // yards per pixel at the depth where the scale dots were placed.
        // We assume scale dots are on the ground at impact depth (camera distance).
        const yardsPerPixel_ref = 10.0 / scalePixelDist;

        // ── 2. Focal length from ball-on-tee measurement ──────────────────────
        // Pinhole: pixelHeight = (realHeight_inches * focalLength) / depth_inches
        // → focalLength (pixels·inches / inches = pixels, dimensionless ratio)
        // We store it as: focalLength = pixelHeight * depth_inches / realHeight_inches
        const cameraDistance_in = cameraDistance * 36; // yards → inches
        const focalLength = (ballTeePixelHeight * cameraDistance_in) / this.BALL_IN;
        // focalLength is now in pixel·inches/inch = pixels at 1-inch distance.

        // ── 3. Timing ─────────────────────────────────────────────────────────
        const t_impact   = startPt.time;
        const t_halfUp   = halfUpPt.time;
        const t_apex     = peakPt.time;
        const t_halfDown = halfDownPt.time;
        const t_land     = endPt.time;

        const totalTime = t_land   - t_impact;
        const peakTime  = t_apex   - t_impact;

        // ── 4. Vertical physics — vUp from gravity + peakTime ─────────────────
        // Classic: at apex vertical velocity = 0
        //   vUp = g * peakTime  (ft/s)
        //   heightFt = ½ g t²
        const vUp    = this.gravity * peakTime;           // ft/s
        const heightFt = 0.5 * this.gravity * peakTime * peakTime; // ft

        // ── 5. Launch angle from pixel positions (no circularity) ─────────────
        // Vertical rise in pixels from impact to apex, converted to feet using
        // the scale reference. This is independent of forward velocity.
        const dyPixels_apex = (startPt.pos.y - peakPt.pos.y) * canvasHeight;
        // at impact depth, yardsPerPixel_ref is valid
        const heightFromPixels_ft = dyPixels_apex * yardsPerPixel_ref * 3; // yds→ft

        // Use the physics-derived height (more reliable than pixel measurement alone)
        // but cross-check both:
        const heightUsed = heightFt; // physics height, grounded in time

        // Forward velocity: vUp / tan(launchAngle)
        // But we derive launchAngle from pixels to avoid circularity:
        //   tan(launchAngle) = heightFromPixels_ft / (horizontal dist to apex in ft)
        // We don't know horizontal dist yet — so instead use the ratio of
        // vertical pixel rise to horizontal pixel advance at apex:
        const dxPixels_apex = (peakPt.pos.x - 0.5) * canvasWidth; // lateral offset at apex
        // For launch angle we only want the forward component, not lateral.
        // Use the Y rise and TIME ratio as the most reliable source:
        //   launchAngle = atan(vUp / vFwd_fps)
        // We need one more relationship. Use symmetry of vertical arc:
        //   total airtime ≈ 2 * peakTime (symmetric under gravity, ignoring drag)
        // Then: vFwd_fps = kickDistance_ft / totalTime
        // And:  kickDistance derived from vFwd — still circular.
        //
        // BREAK THE CIRCLE: use peakTime and totalTime ratio.
        // For a pure gravity parabola: peakTime = totalTime / 2 exactly.
        // Real kicks have slight asymmetry from drag, but it's small.
        // So estimate: vFwd_fps = vUp / tan(launchAngle_estimate)
        // where launchAngle_estimate comes from the pixel Y/X ratio at apex
        // relative to the scale reference.
        //
        // Best single-camera approach: use vertical pixel displacement at apex
        // and the scale to get real height, then use real height + vUp to get vFwd.
        //   heightFt = vUp² / (2g)  →  we already have this from peakTime
        //   vFwd_fps = vUp * (horizontal_ft / vertical_ft_at_apex)
        // horizontal_ft at apex = vFwd_fps * peakTime  ← still circular
        //
        // Final resolution: use the time-symmetry assumption to get vFwd directly.
        //   For symmetric parabola: totalTime = 2 * peakTime
        //   kick_distance_ft = vFwd_fps * totalTime
        //   From vertical: vUp = g * peakTime → vFwd = vUp / tan(angle)
        //   From pixel Y displacement: height_px / (forward_px) ≈ tan(angle) / perspective
        //
        // CLEANEST SOLUTION given constraints:
        // Derive vFwd from the pinhole model + forward pixel displacement.
        // At impact, ball is at depth D0 = cameraDistance.
        // At apex, ball is at depth D_apex (unknown without ball size mid-flight).
        // BUT: we know D_apex = D0 + vFwd * peakTime (constant velocity assumption).
        // And from pinhole: apparent_height_at_apex = BALL_IN * focalLength / (D_apex_in)
        // We don't track ball size mid-flight (Option A) so we can't use that.
        //
        // Therefore: use vUp + peakTime + totalTime with time-symmetry to get vFwd:
        //   Assume symmetric arc → vFwd_fps = (pixel_scale_derived_kickDist_ft) / totalTime
        //   where kickDist from: forward pixel spread × perspective correction
        //
        // Since we explicitly chose Option A (constant vFwd, no mid-flight ball size),
        // the cleanest Option A derivation is:
        //   launchAngle = atan2(vUp, vFwd_fps)
        //   vFwd_fps derived from pixel-measured height vs time:
        //   We use the scale dots to get height in feet, then:
        //     tan(launchAngle) = heightFt_per_unitForward
        //   and unitForward comes from the horizontal pixel displacement scaled by
        //   yardsPerPixel at impact depth.
        //
        // Pixel-based forward proxy: the ball moves AWAY from camera so we can't
        // see forward motion directly. The only clean Option A solution is:
        //
        //   vFwd_fps = vUp / tan(launchAngle_from_vertical_arc_symmetry)
        //
        // For a gravity-only parabola with peakTime = t_apex - t_impact:
        //   The ratio vFwd/vUp = cos(angle)/sin(angle) = 1/tan(angle)
        //   We measure angle from the pixel rise/time: angle = atan(vUp / vFwd)
        //
        // To break the circle, use the HORIZONTAL PIXEL DISPLACEMENT of the ball
        // projected onto the ground plane. Since camera is behind the ball looking
        // forward, forward motion appears as the ball getting smaller + slight Y drop
        // from perspective. We can't measure this without ball size mid-flight.
        //
        // CONCLUSION for Option A: accept that vFwd must come from an assumed
        // typical launch angle range OR from the lateral-corrected scale + pixel
        // vertical displacement. The most defensible single formula is:
        //
        //   vFwd_fps = (heightFt * 2 / totalTime) * (totalTime / peakTime - 1 + 1)
        //            simplified: if symmetric, peakTime = totalTime/2
        //   vFwd_fps = vUp * (totalTime - peakTime) / peakTime  [from horizontal range]
        //   kickDist_ft = vFwd_fps * totalTime
        //   kickDist_yd = kickDist_ft / 3
        //
        // This uses ONLY timestamps — no pixel positions for forward distance.
        // It IS the standard projectile range formula under gravity:
        //   R = vFwd * totalTime,  vFwd = vUp * (t_land-t_apex)/(t_apex-t_impact)
        // This is NOT circular and does NOT require camera distance for kick distance.
        // Camera distance is used only for scale (lateral drift).

        const t_descent  = t_land - t_apex;           // seconds of descent
        // vFwd from projectile symmetry (allows asymmetric arc):
        const vFwd_fps   = vUp * (t_descent / peakTime); // ft/s
        const vFwd_yds   = vFwd_fps / 3;                  // yards/s

        const kickDist_ft = vFwd_fps * totalTime;
        const kickDist_yd = kickDist_ft / 3;

        const launchAngleDeg = Math.atan2(vUp, vFwd_fps) * (180 / Math.PI);

        // ── 6. 3D positions of all 5 points ───────────────────────────────────
        // Z = forward distance from kick spot (yards), constant vFwd assumption
        // X = lateral position (yards), perspective-corrected using pinhole model
        // Y = height (feet)

        const points = [
            { label: 'impact',    pt: startPt,   t: t_impact,   isNorm: false },
            { label: 'halfUp',    pt: halfUpPt,   t: t_halfUp,   isNorm: true  },
            { label: 'apex',      pt: peakPt,     t: t_apex,     isNorm: true  },
            { label: 'halfDown',  pt: halfDownPt, t: t_halfDown, isNorm: true  },
            { label: 'landing',   pt: endPt,      t: t_land,     isNorm: true  },
        ];

        const points3d = points.map(({ label, pt, t, isNorm }) => {
            const dt = t - t_impact;

            // Z: forward distance (yards)
            const Z = vFwd_yds * dt;

            // Depth at this point (yards from camera)
            const depth_yd = cameraDistance + Z;
            const depth_in = depth_yd * 36;

            // yardsPerPixel at this depth using pinhole scaling:
            // At reference depth D0: yardsPerPixel_ref
            // At depth D: yardsPerPixel = yardsPerPixel_ref * (D / D0)
            const ypp = yardsPerPixel_ref * (depth_yd / cameraDistance);

            // X: lateral offset (yards). Normalized points have x relative to 0.5.
            // Impact (isNorm=false) has x = centerX (raw), so lateral = 0 by definition.
            const lateralPx = isNorm
                ? (pt.pos.x - 0.5) * canvasWidth
                : 0;
            const X = lateralPx * ypp;

            // Y: height (feet). Impact is ground level (Y=0).
            // Positive dyPixels (ball higher on screen = lower y value) = ball went up.
            const dyPx = (startPt.pos.y - pt.pos.y) * canvasHeight;
            const Y_ft = dyPx * ypp * 3; // ypp in yards/px → ×3 = feet/px

            return { label, Z, X, Y: Y_ft };
        });

        // ── 7. Fit vertical parabola: Y = aZ² + bZ + c ───────────────────────
        // Using least squares over the 5 3D points.
        const vertCoeffs = this._fitParabola(
            points3d.map(p => p.Z),
            points3d.map(p => p.Y)
        );

        // ── 8. Fit lateral parabola: X = aZ² + bZ + c ────────────────────────
        const latCoeffs = this._fitParabola(
            points3d.map(p => p.Z),
            points3d.map(p => p.X)
        );

        // ── 9. Predicted kick distance (where vertical parabola hits Y=0 again)─
        // Solve aZ² + bZ + c = 0 for Z > 0
        const [av, bv, cv] = vertCoeffs;
        const predictedKickDist = this._parabolaZeroAfterPeak(av, bv, cv, kickDist_yd);

        // ── 10. Good From distance ─────────────────────────────────────────────
        // Step through distance and find max D where:
        //   |lateral(D)| < UPRIGHT_HW  AND  height(D) > CROSSBAR_H
        const [al, bl, cl] = latCoeffs;
        const maxGood = this._calcMaxGood(av, bv, cv, al, bl, cl, predictedKickDist);

        // ── 11. Drift at the uprights ──────────────────────────────────────────
        const driftAtUprights = al * predictedKickDist * predictedKickDist
                              + bl * predictedKickDist
                              + cl;

        let driftLabel;
        if (Math.abs(driftAtUprights) < 0.5)       driftLabel = "Straight";
        else if (driftAtUprights > 0)               driftLabel = "Drift Right";
        else                                         driftLabel = "Drift Left";

        return {
            maxGoodDistance: maxGood,
            drift:           driftLabel,
            driftYards:      driftAtUprights,
            kickDistance:    predictedKickDist,
            time:            totalTime,
            height:          heightFt,
            angle:           launchAngleDeg,
            points3d,        // array of {label, Z, X, Y} for trajectory visualization
        };
    }

    // ── Least-squares parabola fit ────────────────────────────────────────────
    // Fits Y = aX² + bX + c to arrays of x and y values.
    // Returns [a, b, c].
    _fitParabola(xs, ys) {
        const n = xs.length;
        // Build normal equations for [a, b, c]:
        // [Σx⁴  Σx³  Σx²] [a]   [Σx²y]
        // [Σx³  Σx²  Σx ] [b] = [Σxy ]
        // [Σx²  Σx   n  ] [c]   [Σy  ]
        let s0=n, s1=0, s2=0, s3=0, s4=0;
        let t0=0, t1=0, t2=0;
        for (let i = 0; i < n; i++) {
            const x=xs[i], y=ys[i];
            const x2=x*x, x3=x2*x, x4=x3*x;
            s1+=x; s2+=x2; s3+=x3; s4+=x4;
            t0+=y; t1+=x*y; t2+=x2*y;
        }
        // Solve 3×3 system via Cramer's rule
        const M = [
            [s4, s3, s2],
            [s3, s2, s1],
            [s2, s1, s0]
        ];
        const rhs = [t2, t1, t0];
        return this._solve3x3(M, rhs);
    }

    // Gaussian elimination for 3×3 system
    _solve3x3(M, rhs) {
        const A = M.map((row, i) => [...row, rhs[i]]);
        for (let col = 0; col < 3; col++) {
            // Pivot
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
        // Back substitution
        const x = [0, 0, 0];
        for (let i = 2; i >= 0; i--) {
            x[i] = A[i][3];
            for (let j = i+1; j < 3; j++) x[i] -= A[i][j] * x[j];
            x[i] /= A[i][i] || 1;
        }
        return x;
    }

    // Find the Z > 0 root of aZ²+bZ+c=0 closest to kickDistEstimate
    _parabolaZeroAfterPeak(a, b, c, kickDistEstimate) {
        if (Math.abs(a) < 1e-12) {
            // Linear fallback
            return Math.abs(b) > 1e-12 ? -c / b : kickDistEstimate;
        }
        const disc = b*b - 4*a*c;
        if (disc < 0) return kickDistEstimate;
        const r1 = (-b + Math.sqrt(disc)) / (2*a);
        const r2 = (-b - Math.sqrt(disc)) / (2*a);
        // Pick the positive root further from 0 (the landing root, not impact)
        const candidates = [r1, r2].filter(r => r > 1);
        if (candidates.length === 0) return kickDistEstimate;
        return candidates.reduce((best, r) =>
            Math.abs(r - kickDistEstimate) < Math.abs(best - kickDistEstimate) ? r : best
        );
    }

    // Step through distance 0→maxDist, return largest D where ball is good
    _calcMaxGood(av, bv, cv, al, bl, cl, maxDist) {
        const step = 0.5; // yard resolution
        let maxGood = 0;
        for (let D = step; D <= maxDist + step; D += step) {
            const height  = av*D*D + bv*D + cv;
            const lateral = Math.abs(al*D*D + bl*D + cl);
            if (height >= this.CROSSBAR_H && lateral <= this.UPRIGHT_HW) {
                maxGood = D;
            }
        }
        return maxGood;
    }
}
