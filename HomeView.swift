import SwiftUI

struct HomeView: View {
    @State private var showCamera = false
    @State private var recordedURL: URL?
    @State private var navigateToAnalysis = false
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 50) {
                
                // Title Section
                VStack(spacing: 10) {
                    Text("Kick Tracker")
                        .font(.system(size: 40, weight: .black, design: .rounded))
                    
                    Text("Optics & Physics Engine")
                        .font(.headline)
                        .foregroundColor(.secondary)
                }
                
                // Navigation Buttons
                VStack(spacing: 20) {
                    
                    Button(action: { showCamera = true }) {
                        Text("Record video")
                            .font(.title3)
                            .bold()
                            .foregroundColor(.white)
                            .frame(maxWidth: 250)
                            .padding()
                            .background(Color.red)
                            .cornerRadius(12)
                    }
                    
                    NavigationLink(destination: ContentView()) {
                        Text("Analyze Video")
                            .font(.title3)
                            .bold()
                            .foregroundColor(.white)
                            .frame(maxWidth: 250)
                            .padding()
                            .background(Color.blue)
                            .cornerRadius(12)
                    }
                    
                    NavigationLink(destination: KickHistoryView()) {
                        Text("Kick History")
                            .font(.title3)
                            .bold()
                            .foregroundColor(.white)
                            .frame(maxWidth: 250)
                            .padding()
                            .background(Color.green)
                            .cornerRadius(12)
                    }
                }
            }
            .padding()
            .fullScreenCover(isPresented: $showCamera) {
                CameraCaptureView(recordedURL: $recordedURL)
                    .ignoresSafeArea()
            }
            .onChange(of: recordedURL) { _, newURL in
                if newURL != nil {
                    // Automatically navigate when a URL is returned from the camera
                    navigateToAnalysis = true
                }
            }
            .navigationDestination(isPresented: $navigateToAnalysis) {
                ContentView(preloadedURL: recordedURL)
            }
        }
    }
}

