import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var session: AppSession
    @AppStorage("apiBaseURL") private var server = ""
    @State private var account = ""
    @State private var password = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("工作室地址") {
                    TextField("https://你的域名.cn", text: $server)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                } footer: { Text("正式版会自动带入网站域名；仅在更换工作室服务器时才需要修改。") }
                Section("教师管理员") {
                    TextField("账号", text: $account).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("密码", text: $password)
                }
                if !session.error.isEmpty { Section { Text(session.error).foregroundStyle(.red) } }
                Section {
                    Button("登录工作室", systemImage: "arrow.right.circle.fill") { Task { await session.login(server: server, account: account, password: password) } }
                        .disabled(APIClient.normalizedBaseURL(server) == nil || account.isEmpty || password.isEmpty || session.checking)
                }
            }
            .navigationTitle("知师研室")
        }
    }
}
