import Foundation

enum APIClientError: LocalizedError {
    case invalidServer
    case server(status: Int, message: String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .invalidServer: return "请填写有效的 HTTPS 工作室地址"
        case .server(_, let message): return message
        case .invalidResponse: return "服务器响应无法识别"
        }
    }

    var canRetryLater: Bool {
        switch self {
        case .invalidResponse:
            return true
        case .server(let status, _):
            return status == 408 || status == 429 || status >= 500
        case .invalidServer:
            return false
        }
    }
}

final class APIClient {
    static let shared = APIClient()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    var baseURL: URL? {
        let raw = UserDefaults.standard.string(forKey: "apiBaseURL")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return Self.normalizedBaseURL(raw)
    }

    static func normalizedBaseURL(_ raw: String) -> URL? {
        guard var components = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme?.lowercased() == "https",
              components.host?.isEmpty == false,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.isEmpty || components.path == "/" else { return nil }
        components.scheme = "https"
        components.path = ""
        return components.url
    }

    @discardableResult
    func configureBaseURL(_ raw: String) -> Bool {
        guard let url = Self.normalizedBaseURL(raw) else { return false }
        UserDefaults.standard.set(url.absoluteString, forKey: "apiBaseURL")
        return true
    }

    func request<Response: Decodable, Body: Encodable>(_ path: String, method: String = "GET", body: Body, operationId: String? = nil) async throws -> Response {
        try await execute(path, method: method, body: try encoder.encode(body), operationId: operationId)
    }

    func request<Response: Decodable>(_ path: String, method: String = "GET", operationId: String? = nil) async throws -> Response {
        try await execute(path, method: method, body: nil, operationId: operationId)
    }

    private func execute<Response: Decodable>(_ path: String, method: String, body: Data?, operationId: String?) async throws -> Response {
        guard let baseURL, let url = URL(string: path, relativeTo: baseURL) else { throw APIClientError.invalidServer }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body { request.httpBody = body; request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let operationId { request.setValue(operationId, forHTTPHeaderField: "X-Operation-Id") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIClientError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let payload = try? decoder.decode(APIErrorBody.self, from: data)
            let message = payload?.error ?? "请求失败（\(http.statusCode)）"
            throw APIClientError.server(status: http.statusCode, message: message)
        }
        return try decoder.decode(Response.self, from: data)
    }
}
