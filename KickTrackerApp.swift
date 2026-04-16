import SwiftUI

@main
struct KickTrackerApp: App {
    // This creates the shared database for the entire app
    @StateObject private var kickStore = KickStore()
    
    var body: some Scene {
        WindowGroup {
            HomeView()
                .environmentObject(kickStore) // Injects the database into your views
        }
    }
}
