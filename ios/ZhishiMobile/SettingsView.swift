import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var session: AppSession
    @State private var server = ""
    @State private var showServerConfirmation = false
    @State private var showLocalDataConfirmation = false

    var body: some View {
        NavigationStack {
            Form {
                Section("当前教师") { LabeledContent("账号", value: session.userName) }
                Section("数据连接") {
                    TextField("HTTPS 工作室地址", text: $server).textInputAutocapitalization(.never).keyboardType(.URL).autocorrectionDisabled()
                    Text("网页、iOS 与微信小程序必须指向同一后端域名，才会共享 D1/R2 数据。").font(.footnote).foregroundStyle(.secondary)
                    Button("保存地址并重新登录") { showServerConfirmation = true }
                        .disabled(APIClient.normalizedBaseURL(server) == nil || APIClient.normalizedBaseURL(server) == APIClient.shared.baseURL)
                }
                Section("本机数据") {
                    Button("清除本机离线记录", role: .destructive) { showLocalDataConfirmation = true }
                    Text("只清除尚未同步或发生冲突的本机副本，不删除服务器中已经同步的记录。").font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    Button(role: .destructive) {
                        Task { await session.logout() }
                    } label: {
                        Label("退出登录", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
            .navigationTitle("设置")
            .task { server = APIClient.shared.baseURL?.absoluteString ?? "" }
            .confirmationDialog("更换服务器会退出当前账号", isPresented: $showServerConfirmation, titleVisibility: .visible) {
                Button("更换并退出", role: .destructive) { Task { await session.changeServer(to: server) } }
                Button("取消", role: .cancel) {}
            } message: { Text("未同步记录仍保留在本机。重新登录后请先检查冲突列表。") }
            .confirmationDialog("清除本机离线记录？", isPresented: $showLocalDataConfirmation, titleVisibility: .visible) {
                Button("清除本机副本", role: .destructive) { RecordStore.clearLocalDrafts() }
                Button("取消", role: .cancel) {}
            } message: { Text("此操作不能恢复；服务器中已同步的数据不受影响。") }
        }
    }
}
