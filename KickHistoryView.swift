import SwiftUI

// A wrapper to hold our date and kick number alongside the KickReport
struct HistoricKick: Identifiable {
    let id = UUID()
    let number: Int
    let date: Date
    let report: KickReport
}

// The shared database for our app
class KickStore: ObservableObject {
    @Published var kicks: [HistoricKick] = []
}

struct KickHistoryView: View {
    // Pulls in the live data from the app environment
    @EnvironmentObject var kickStore: KickStore
    @State private var selectedKick: HistoricKick?
    
    // Formats the date to mm/dd/yyyy, hh:mm
    private var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateFormat = "MM/dd/yyyy, HH:mm"
        return formatter
    }
    
    var body: some View {
        List {
            if kickStore.kicks.isEmpty {
                Text("No history available. Analyze a video to save your first kick!")
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 40)
                    .listRowBackground(Color.clear)
            } else {
                Section(header: Text("Recorded Kicks (\(kickStore.kicks.count))")) {
                    ForEach(kickStore.kicks) { kick in
                        Button(action: {
                            selectedKick = kick
                        }) {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Kick #\(kick.number) (\(dateFormatter.string(from: kick.date)))")
                                        .font(.headline)
                                        .foregroundColor(.primary)
                                    
                                    HStack(spacing: 12) {
                                        Text("\(String(format: "%.1f", kick.report.distanceYards)) yds")
                                        Text("•")
                                        Text("\(String(format: "%.1f", kick.report.launchAngle))°")
                                    }
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                                }
                                
                                Spacer()
                                
                                VStack(alignment: .trailing) {
                                    if kick.report.maxGoodDistance > 0 {
                                        Text("≤ \(Int(kick.report.maxGoodDistance)) yds")
                                            .font(.system(.callout, design: .rounded))
                                            .bold()
                                            .foregroundColor(.green)
                                    } else {
                                        Text("MISS")
                                            .font(.system(.callout, design: .rounded))
                                            .bold()
                                            .foregroundColor(.red)
                                    }
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }
        }
        .navigationTitle("History Database")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if !kickStore.kicks.isEmpty {
                    Button(action: {
                        kickStore.kicks.removeAll()
                    }) {
                        Text("Clear")
                            .foregroundColor(.red)
                    }
                }
            }
        }
        .sheet(item: $selectedKick) { historicKick in
            ScoutReportView(report: historicKick.report)
        }
    }
}
