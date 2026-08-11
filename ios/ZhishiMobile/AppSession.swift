import SwiftUI

@MainActor
final class AppSession: ObservableObject {
    @Published var authenticated = false
    @Published var checking = true
    @Published var userName = "教师"
    @Published var error = ""

    func refresh() async {
        guard APIClient.shared.baseURL != nil else { checking = false; authenticated = false; return }
        do {
            let response: SessionResponse = try await APIClient.shared.request("/api/session")
            authenticated = response.authenticated && response.role == "teacher"
            userName = response.user?.name ?? "教师"
        } catch { authenticated = false }
        checking = false
    }

    func login(server: String, account: String, password: String) async {
        checking = true; error = ""
        guard APIClient.shared.configureBaseURL(server) else {
            self.error = APIClientError.invalidServer.localizedDescription
            checking = false
            return
        }
        do {
            struct Payload: Encodable { let account: String; let password: String; let returnTo = "/v2/record" }
            let _: LoginResponse = try await APIClient.shared.request("/api/auth/login", method: "POST", body: Payload(account: account, password: password))
            await refresh()
        } catch { self.error = error.localizedDescription; authenticated = false; checking = false }
    }

    func logout() async {
        struct Empty: Decodable {}
        _ = try? await APIClient.shared.request("/api/auth/logout?return_to=/") as Empty
        HTTPCookieStorage.shared.cookies?.forEach(HTTPCookieStorage.shared.deleteCookie)
        authenticated = false
    }

    func changeServer(to server: String) async {
        guard let normalized = APIClient.normalizedBaseURL(server) else {
            error = APIClientError.invalidServer.localizedDescription
            return
        }
        await logout()
        UserDefaults.standard.set(normalized.absoluteString, forKey: "apiBaseURL")
        error = "服务器已更换，请重新登录"
        checking = false
    }
}
