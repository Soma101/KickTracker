import SwiftUI
import AVKit
import PhotosUI

struct KickReport {
    var totalTime: Double
    var timeToPeak: Double
    var distanceYards: Double
    var peakHeightFeet: Double
    var launchAngle: Double
    var horizontalVelocity: Double
    var maxGoodDistance: Double
    var missType: String
    var angleWarning: String?   // non-nil if angle is outside 15°–65°
}

enum HashLocation: String, CaseIterable {
    case left = "Left", middle = "Middle", right = "Right"
}

enum GameLevel: String, CaseIterable {
    case nfl = "NFL", college = "College"
}

struct ContentView: View {
    var preloadedURL: URL? = nil
    
    // Connects to our shared database
    @EnvironmentObject var kickStore: KickStore
    
    @State private var selectedItem: PhotosPickerItem?
    @State private var player = AVPlayer()
    @State private var isVideoLoaded = false
    
    // Scrubber & UI
    @State private var scrubberValue: Double = 0
    @State private var totalDuration: Double = 0
    @State private var isScrubbing = false
    @State private var resultsText = "1. Set Camera Distance. Place 10yd scale dots."
    @State private var showReport = false
    @State private var activeReport: KickReport?
    @State private var viewportSize: CGSize = .zero
    
    // Field Settings
    @State private var hashPos: HashLocation = .middle
    @State private var gameLevel: GameLevel = .college
    
    // Optics States
    @State private var cameraDistance: Double = 15.0
    @State private var ballSizeStart: CGFloat = 10.0
    @State private var ballSizeEnd: CGFloat = 10.0
    @State private var isAdjustingSize = false
    @State private var zoomLevel: CGFloat = 1.0
    
    // Point & Trace Tracking
    @State private var scaleDots: [CGPoint] = []
    @State private var activeTap: CGPoint?
    @State private var activeTrace: [CGPoint] = []
    
    @State private var startPt: (time: CMTime, pos: CGPoint)?
    @State private var ascentPt: (time: CMTime, pos: CGPoint)?
    @State private var peakPt: (time: CMTime, pos: CGPoint)?
    @State private var descentPt: (time: CMTime, pos: CGPoint)?
    @State private var endPt: (time: CMTime, pos: CGPoint)?
    
    let gravity: Double = 32.17
    
    var body: some View {
        VStack(spacing: 0) {
            
            // SYSTEM BUTTONS AT THE TOP
            if isVideoLoaded && !isAdjustingSize {
                HStack(spacing: 8) {
                    Spacer()
                    Button("Reset") { resetAll() }.buttonStyle(.bordered)
                    Button("New Video") { clearVideo() }.buttonStyle(.bordered).tint(.red)
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(Color(UIColor.secondarySystemBackground))
            }
            
            // 1. DASHBOARD
            VStack(spacing: 8) {
                HStack {
                    Picker("Level", selection: $gameLevel) {
                        ForEach(GameLevel.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }.pickerStyle(.segmented)
                    
                    Picker("Hash", selection: $hashPos) {
                        ForEach(HashLocation.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }.pickerStyle(.segmented)
                }
                
                HStack {
                    Text("Cam Depth (Yds): \(Int(cameraDistance))").font(.caption).bold()
                    Slider(value: $cameraDistance, in: 5...50, step: 1)
                        .disabled(startPt != nil)
                }
                
                Text(resultsText)
                    .font(.system(.subheadline, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
            }
            .padding().frame(height: 145).background(Color(UIColor.secondarySystemBackground))
            
            // 2. VIEWPORT
            GeometryReader { geo in
                let viewSize = geo.size
                let zoomAnchor = activeTap != nil ? UnitPoint(x: activeTap!.x, y: activeTap!.y) : .center
                
                ZStack(alignment: .topLeading) {
                    if isVideoLoaded {
                        VideoPlayer(player: player)
                            .aspectRatio(contentMode: .fit)
                            .frame(width: viewSize.width, height: viewSize.height)
                            .overlay(
                                Color.white.opacity(0.001)
                                    .contentShape(Rectangle())
                                    .gesture(
                                        DragGesture(minimumDistance: 0)
                                            .onChanged { value in
                                                let nx = value.location.x / viewSize.width
                                                let ny = value.location.y / viewSize.height
                                                if isAdjustingSize { activeTrace.append(CGPoint(x: nx, y: ny)) }
                                            }
                                            .onEnded { value in
                                                if !isAdjustingSize {
                                                    let nx = value.location.x / viewSize.width
                                                    let ny = value.location.y / viewSize.height
                                                    handleTap(CGPoint(x: nx, y: ny))
                                                }
                                            }
                                    )
                            )
                    } else {
                        PhotosPicker(selection: $selectedItem, matching: .videos) {
                            ContentUnavailableView("Upload Video", systemImage: "video.badge.plus")
                        }
                    }
                    
                    ForEach(0..<scaleDots.count, id: \.self) { i in
                        Circle().fill(Color.blue).frame(width: 14 / zoomLevel)
                            .position(x: scaleDots[i].x * viewSize.width, y: scaleDots[i].y * viewSize.height)
                    }
                    
                    if isAdjustingSize && !activeTrace.isEmpty {
                        Canvas { context, size in
                            var path = Path()
                            let firstPt = activeTrace[0]
                            path.move(to: CGPoint(x: firstPt.x * size.width, y: firstPt.y * size.height))
                            for pt in activeTrace.dropFirst() { path.addLine(to: CGPoint(x: pt.x * size.width, y: pt.y * size.height)) }
                            context.stroke(path, with: .color(.cyan), lineWidth: 2 / zoomLevel)
                        }
                    }
                    
                    if let tap = activeTap, !isAdjustingSize {
                        Path { path in
                            let px = tap.x * viewSize.width
                            let py = tap.y * viewSize.height
                            path.move(to: CGPoint(x: px, y: py - 10)); path.addLine(to: CGPoint(x: px, y: py + 10))
                            path.move(to: CGPoint(x: px - 10, y: py)); path.addLine(to: CGPoint(x: px + 10, y: py))
                        }.stroke(Color.cyan, lineWidth: 2 / zoomLevel)
                    }
                    
                    let dotSize: CGFloat = 10.0 / zoomLevel
                    if let p = startPt { markerDot(p.pos, .green, viewSize, dotSize) }
                    if let p = ascentPt { markerDot(p.pos, .yellow, viewSize, dotSize) }
                    if let p = peakPt { markerDot(p.pos, .orange, viewSize, dotSize) }
                    if let p = descentPt { markerDot(p.pos, .yellow, viewSize, dotSize) }
                    if let p = endPt { markerDot(p.pos, .red, viewSize, dotSize) }
                }
                .scaleEffect(zoomLevel, anchor: zoomAnchor)
                .animation(.easeInOut(duration: 0.3), value: zoomLevel)
                .onAppear { 
                    viewportSize = viewSize
                    if let url = preloadedURL, !isVideoLoaded {
                        loadVideo(url: url)
                    }
                }
                .onChange(of: viewSize) { _, newSize in viewportSize = newSize }
                
            }.background(Color.black).clipped()
            
            // 3. PERSISTENT CONTROLS
            if isVideoLoaded {
                VStack(spacing: 10) {
                    Picker("Zoom", selection: $zoomLevel) {
                        Text("1x").tag(CGFloat(1.0)); Text("3.5x").tag(CGFloat(3.5))
                        Text("5x").tag(CGFloat(5.0)); Text("10x").tag(CGFloat(10.0)); Text("20x").tag(CGFloat(20.0))
                    }.pickerStyle(.segmented).padding(.horizontal, 20)
                    
                    if isAdjustingSize {
                        HStack(spacing: 20) {
                            Button("CLEAR TRACE") { activeTrace.removeAll() }.buttonStyle(.bordered).tint(.red)
                            if startPt == nil {
                                Button("CONFIRM TRACE") { confirmStartTrace(viewSize: viewportSize) }.buttonStyle(.borderedProminent).tint(.green).disabled(activeTrace.isEmpty)
                            } else if endPt == nil {
                                Button("CONFIRM & ANALYZE") { confirmEndTrace(viewSize: viewportSize) }.buttonStyle(.borderedProminent).tint(.red).disabled(activeTrace.isEmpty)
                            }
                        }
                    } else {
                        Slider(value: $scrubberValue, in: 0...max(0.1, totalDuration)) { editing in
                            isScrubbing = editing
                            if !editing { player.seek(to: CMTime(seconds: scrubberValue, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) }
                        }.accentColor(.orange)
                        
                        HStack {
                            Button(action: { stepFrame(by: -1) }) { VStack { Image(systemName: "chevron.left.2"); Text("-1 Fr").font(.caption2) } }
                            Spacer()
                            Button(action: { togglePlay() }) { Image(systemName: "pause.fill").font(.title2) }
                            Spacer()
                            Button(action: { stepFrame(by: 1) }) { VStack { Image(systemName: "chevron.right.2"); Text("+1 Fr").font(.caption2) } }
                        }.padding(.horizontal, 40)
                    }
                }.padding().background(Color(UIColor.secondarySystemBackground)).frame(height: 110)
            }
            
            // 4. WORKFLOW BUTTONS
            VStack {
                if isVideoLoaded && !isAdjustingSize {
                    HStack(spacing: 8) {
                        workflowButton()
                    }.padding()
                }
            }.frame(height: 90).background(Color(UIColor.secondarySystemBackground))
        }
        .onChange(of: selectedItem) { _, newItem in handleVideoSelection(newItem) }
        .sheet(isPresented: $showReport) { if let report = activeReport { ScoutReportView(report: report) } }
    }
    
    // --- VIEW UTILS ---
    @ViewBuilder func markerDot(_ pos: CGPoint, _ color: Color, _ size: CGSize, _ dotWidth: CGFloat) -> some View {
        Circle().fill(color).frame(width: dotWidth).position(x: pos.x * size.width, y: pos.y * size.height)
    }
    
    @ViewBuilder func workflowButton() -> some View {
        if scaleDots.count < 2 { Text("Set 10yd Scale First").font(.caption).foregroundColor(.secondary).frame(maxWidth: .infinity) }
        else if startPt == nil { Button(action: { isAdjustingSize = true; resultsText = "Trace the ball outline." }) { Text("LOCK IMPACT").bold().frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent).tint(.green).disabled(activeTap == nil) }
        else if ascentPt == nil { Button(action: { ascentPt = (player.currentTime(), activeTap!); activeTap = nil; resultsText = "3. Scrub to APEX. Tap ball." }) { Text("MARK ASCENT").bold().frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent).tint(.yellow).disabled(activeTap == nil) }
        else if peakPt == nil { Button(action: { peakPt = (player.currentTime(), activeTap!); activeTap = nil; resultsText = "4. Scrub to halfway DOWN. Tap ball." }) { Text("MARK APEX").bold().frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent).tint(.orange).disabled(activeTap == nil) }
        else if descentPt == nil { Button(action: { descentPt = (player.currentTime(), activeTap!); activeTap = nil; resultsText = "5. Scrub to LANDING. Tap ball." }) { Text("MARK DESCENT").bold().frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent).tint(.yellow).disabled(activeTap == nil) }
        else if endPt == nil { Button(action: { isAdjustingSize = true; resultsText = "Trace the landing ball outline." }) { Text("LOCK LANDING").bold().frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent).tint(.red).disabled(activeTap == nil) }
        else { Button(action: { showReport = true }) { Text("VIEW REPORT").bold().frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent).tint(.blue) }
    }
    
    // --- MATH ---
    func loadVideo(url: URL) {
        self.player = AVPlayer(url: url)
        self.isVideoLoaded = true
        self.setupTimeObserver()
        Task { self.totalDuration = (try? await player.currentItem?.asset.load(.duration).seconds) ?? 0 }
    }
    
    func calculateTraceSize(viewSize: CGSize) -> CGFloat {
        guard !activeTrace.isEmpty else { return 10.0 }
        let xs = activeTrace.map { $0.x * viewSize.width }
        let ys = activeTrace.map { $0.y * viewSize.height }
        return CGFloat(sqrt(max((xs.max()! - xs.min()!), 2.0) * max((ys.max()! - ys.min()!), 2.0)))
    }
    
    func confirmStartTrace(viewSize: CGSize) {
        ballSizeStart = calculateTraceSize(viewSize: viewSize)
        startPt = (player.currentTime(), activeTap!)
        activeTap = nil; activeTrace.removeAll(); isAdjustingSize = false; zoomLevel = 1.0
        resultsText = "2. Scrub to halfway UP. Tap ball."
    }
    
    func confirmEndTrace(viewSize: CGSize) {
        ballSizeEnd = calculateTraceSize(viewSize: viewSize)
        endPt = (player.currentTime(), activeTap!)
        activeTap = nil; activeTrace.removeAll(); isAdjustingSize = false; zoomLevel = 1.0
        calculateOpticsPhysics()
    }
    
    func calculateOpticsPhysics() {
        guard let s = startPt, let apex = peakPt, let e = endPt else { return }
        
        let totalTime = abs(e.time.seconds - s.time.seconds)
        let timeToPeak = abs(apex.time.seconds - s.time.seconds)
        
        // 1. Vertical Physics
        let v_y0_ft = gravity * timeToPeak
        let peakH_ft = 0.5 * gravity * (timeToPeak * timeToPeak)
        
        // 2. Optical Depth Physics
        let rawRatio = Double(ballSizeStart) / Double(ballSizeEnd)
        let blurCompensatedRatio = pow(rawRatio, 1.25)
        
        var zDistanceYards = cameraDistance * (blurCompensatedRatio - 1.0)
        
        let minAngleRad = 20.0 * .pi / 180.0
        let max_Vz_ft = v_y0_ft / tan(minAngleRad)
        let max_Z_yards = (max_Vz_ft * totalTime) / 3.0
        
        if zDistanceYards > max_Z_yards {
            zDistanceYards = max_Z_yards
        }
        
        let zDistanceFeet = zDistanceYards * 3.0
        let v_z0_ft = zDistanceFeet / (totalTime > 0 ? totalTime : 1.0)
        let v_z0_yards = v_z0_ft / 3.0
        
        // 3. Lateral Physics
        let points = [startPt, ascentPt, peakPt, descentPt].compactMap { $0 }
        guard points.count >= 2 else { return }
        
        let p1 = scaleDots[0], p2 = scaleDots[1]
        let scalePixelDist = sqrt(
            pow(Double(p2.x - p1.x), 2) +
            pow(Double(p2.y - p1.y), 2)
        )
        let yardsPerNormalizedUnit = 10.0 / (scalePixelDist > 0 ? scalePixelDist : 0.1)
        
        let startX = Double(points[0].pos.x)
        
        var weightedDrift: Double = 0.0
        var totalWeight: Double = 0.0
        
        for i in 1..<points.count {
            let pt = points[i]
            let dx = Double(pt.pos.x) - startX
            let tNorm = (pt.time.seconds - s.time.seconds) / (totalTime > 0 ? totalTime : 1.0)
            let weight = max(0.2, tNorm)
            weightedDrift += dx * weight
            totalWeight += weight
        }
        
        let avgDriftNormalized = weightedDrift / (totalWeight > 0 ? totalWeight : 1.0)
        let trueDriftYards = avgDriftNormalized * yardsPerNormalizedUnit
        let v_x_yards = trueDriftYards / (totalTime > 0 ? totalTime : 1.0)
        
        // 4. Boundary Logic
        let a = 0.5 * gravity
        let b = -v_y0_ft
        let c = 10.0
        
        let discriminant = (b * b) - (4 * a * c)
        
        var crossbarTime = totalTime
        if discriminant > 0 {
            crossbarTime = (-b + sqrt(discriminant)) / (2 * a)
        }
        
        let distanceHeightLimit = v_z0_yards * crossbarTime
        
        var timeItGoesWide: Double = .infinity
        if abs(v_x_yards) > 0.01 {
            timeItGoesWide = 3.11 / abs(v_x_yards)
        }
        
        let distanceAccuracyLimit = v_z0_yards * timeItGoesWide
        
        // 5. Launch Angle
        var launchAngleRad = atan2(v_y0_ft, v_z0_ft > 0 ? v_z0_ft : 0.001)
        let launchAngleDeg = launchAngleRad * (180.0 / .pi)
        
        var angleWarning: String? = nil
        if launchAngleDeg < 15.0 {
            angleWarning = "⚠️ Angle \(String(format: "%.1f", launchAngleDeg))° is unusually flat — check camera depth setting"
        } else if launchAngleDeg > 65.0 {
            angleWarning = "⚠️ Angle \(String(format: "%.1f", launchAngleDeg))° is unusually steep — check ball tracing points"
        }
        
        // 6. Final Result
        let maxGoodDistance = min(distanceHeightLimit, distanceAccuracyLimit)
        
        var missType = "Falls Short"
        if distanceAccuracyLimit < distanceHeightLimit {
            missType = v_x_yards > 0 ? "Misses Right" : "Misses Left"
        }
        
        launchAngleRad = atan(v_y0_ft / (v_z0_ft > 0 ? v_z0_ft : 0.1))
        
        self.activeReport = KickReport(
            totalTime: totalTime,
            timeToPeak: timeToPeak,
            distanceYards: zDistanceYards,
            peakHeightFeet: peakH_ft,
            launchAngle: launchAngleDeg,
            horizontalVelocity: v_z0_ft,
            maxGoodDistance: maxGoodDistance,
            missType: missType,
            angleWarning: angleWarning
        )
        
        // SAVES THE KICK TO OUR DATABASE
        let newKick = HistoricKick(
            number: kickStore.kicks.count + 1,
            date: Date(),
            report: self.activeReport!
        )
        kickStore.kicks.insert(newKick, at: 0) // Puts newest at the top
        
        self.showReport = true
    }
    
    func stepFrame(by frames: Int) {
        let offset = CMTimeMultiply(CMTime(value: 1, timescale: 30), multiplier: Int32(frames))
        let newTime = player.currentTime() + offset
        player.seek(to: newTime, toleranceBefore: .zero, toleranceAfter: .zero)
        scrubberValue = newTime.seconds
    }
    
    func togglePlay() {
        if player.timeControlStatus == .playing { player.pause() } else { player.play() }
    }
    
    func setupTimeObserver() {
        player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 60), queue: .main) { time in
            if !isScrubbing { self.scrubberValue = time.seconds }
        }
    }
    
    func handleTap(_ pt: CGPoint) {
        if scaleDots.count < 2 {
            scaleDots.append(pt)
            if scaleDots.count == 2 { resultsText = "1. Scrub to Impact. Tap ball." }
        } else {
            activeTap = pt
        }
    }
    
    func handleVideoSelection(_ item: PhotosPickerItem?) {
        item?.loadTransferable(type: Data.self) { result in
            if case .success(let data) = result, let data = data {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("kick.mov")
                try? data.write(to: url)
                DispatchQueue.main.async {
                    self.loadVideo(url: url)
                }
            }
        }
    }
    
    func resetAll() {
        scaleDots = []; activeTap = nil; isAdjustingSize = false; activeTrace = []
        startPt = nil; ascentPt = nil; peakPt = nil; descentPt = nil; endPt = nil
        activeReport = nil; zoomLevel = 1.0
        resultsText = "1. Set Camera Distance. Then place 10yd scale dots."
        player.pause(); player.seek(to: .zero); scrubberValue = 0
    }
    
    func clearVideo() { resetAll(); isVideoLoaded = false; selectedItem = nil }
}

struct ScoutReportView: View {
    @Environment(\.dismiss) var dismiss
    var report: KickReport
    var body: some View {
        NavigationView {
            List {
                Section(header: Text("Scoring Projection")) {
                    HStack { Text("Max Good Distance"); Spacer(); Text("≤ \(Int(max(0, report.maxGoodDistance))) yds").bold().foregroundColor(.green) }
                    HStack { Text("Past \(Int(max(0, report.maxGoodDistance))) yds"); Spacer(); Text("\(report.missType)").bold().foregroundColor(.red) }
                }
                Section(header: Text("Flight Physics")) {
                    HStack { Text("Total Hang Time"); Spacer(); Text(String(format: "%.2fs", report.totalTime)).bold() }
                    HStack { Text("Peak Height"); Spacer(); Text(String(format: "%.1f ft", report.peakHeightFeet)).bold() }
                    HStack { Text("Launch Angle"); Spacer(); Text(String(format: "%.1f°", report.launchAngle)).bold().foregroundColor(.orange) }
                    if let warning = report.angleWarning {
                        Text(warning)
                            .font(.caption)
                            .foregroundColor(.orange)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                Section(header: Text("Optics Engine Data")) {
                    HStack { Text("True Depth Travelled"); Spacer(); Text(String(format: "%.1f yds", report.distanceYards)).foregroundColor(.secondary) }
                }
                Section { Button(action: { dismiss() }) { Text("Close Report").frame(maxWidth: .infinity, alignment: .center) } }
            }.navigationTitle("Actuarial Report").navigationBarTitleDisplayMode(.inline)
        }
    }
}
