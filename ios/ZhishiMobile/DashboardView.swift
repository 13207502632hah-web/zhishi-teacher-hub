import SwiftUI

struct DashboardView: View {
    @State private var dashboard: DashboardResponse?
    @State private var error = ""

    var body: some View {
        NavigationStack {
            List {
                if let dashboard {
                    Section {
                        LabeledContent("今日课时", value: "\(dashboard.lessons.count)")
                        LabeledContent("今日记录", value: "\(dashboard.recordsToday)")
                        LabeledContent("待确认", value: "\(dashboard.pendingApprovals)")
                    }
                    Section("今天的课程") {
                        if dashboard.lessons.isEmpty { ContentUnavailableView("今天没有课时", systemImage: "calendar.badge.checkmark") }
                        ForEach(dashboard.lessons) { lesson in
                            VStack(alignment: .leading) {
                                Text(lesson.courseName).font(.headline)
                                Text("\(lesson.startTime ?? "待定")–\(lesson.endTime ?? "待定") · \(lesson.className ?? "未关联班级") · \(lesson.topic ?? "未填写课题")").font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                } else if !error.isEmpty { ContentUnavailableView("暂时无法读取", systemImage: "wifi.exclamationmark", description: Text(error)) }
                else { ProgressView() }
            }
            .navigationTitle("今日")
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func load() async {
        do { dashboard = try await APIClient.shared.request("/api/v2/mobile/dashboard"); error = "" }
        catch { self.error = error.localizedDescription }
    }
}
