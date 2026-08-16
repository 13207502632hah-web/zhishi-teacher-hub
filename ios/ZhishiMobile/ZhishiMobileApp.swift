import SwiftUI

@main
struct ZhishiMobileApp: App {
    @StateObject private var session = AppSession()

    init() {
        if let origin = ReleaseTarget.apiBaseURL {
            UserDefaults.standard.register(defaults: ["apiBaseURL": origin.absoluteString])
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if session.checking {
                    ProgressView("正在连接工作室…")
                } else if session.authenticated {
                    RootTabs()
                } else {
                    LoginView()
                }
            }
            .environmentObject(session)
            .task { await session.refresh() }
        }
    }
}

private struct RootTabs: View {
    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("今日", systemImage: "calendar") }
            RecordListView()
                .tabItem { Label("记录", systemImage: "square.and.pencil") }
            SettingsView()
                .tabItem { Label("设置", systemImage: "gearshape") }
        }
    }
}
