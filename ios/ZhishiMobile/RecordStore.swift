import SwiftUI

@MainActor
final class RecordStore: ObservableObject {
    @Published var records: [MobileRecord] = []
    @Published var lessons: [LessonSummary] = []
    @Published var conflicts: [RecordDraft] = []
    @Published var loading = false
    @Published var error = ""
    @Published var notice = ""
    @Published var queued = 0

    private let outboxKey = "mobileRecordOutboxV1"
    private let conflictKey = "mobileRecordConflictsV1"

    init() {
        queued = Self.readDrafts(key: outboxKey).count
        conflicts = Self.readDrafts(key: conflictKey)
    }

    func refresh() async {
        loading = true; error = ""
        await flushOutbox()
        do {
            let response: RecordListResponse = try await APIClient.shared.request("/api/v2/mobile/records")
            records = response.records
        } catch { self.error = error.localizedDescription }
        do {
            let dashboard: DashboardResponse = try await APIClient.shared.request("/api/v2/mobile/dashboard")
            lessons = dashboard.lessons
        } catch {
            if self.error.isEmpty { self.error = "记录已读取，但今日课时暂时无法加载" }
        }
        loading = false
    }

    func save(_ draft: RecordDraft) async -> Bool {
        error = ""; notice = ""
        do {
            let response: RecordSaveResponse = try await APIClient.shared.request("/api/v2/mobile/records", method: "POST", body: draft, operationId: draft.operationId)
            if response.conflict { throw APIClientError.server(status: 409, message: "记录已在其他设备更新") }
            await refresh(); notice = draft.baseVersion > 0 ? "修改已同步到所有设备" : "记录已同步到工作室"; return true
        } catch {
            if isConflict(error) {
                keepConflict(draft); self.error = "另一台设备已修改这条记录；你的版本已保留，可另存为新记录"
                await reloadRecordsOnly(); return false
            }
            guard shouldQueue(error) else { self.error = error.localizedDescription; return false }
            var items = readOutbox()
            if !items.contains(where: { $0.operationId == draft.operationId }) { items.append(draft) }
            writeDrafts(items, key: outboxKey); queued = items.count; self.error = "网络不可用，已保存到本机待同步"
            return true
        }
    }

    func delete(_ record: MobileRecord) async {
        guard record.status != "confirmed" else { error = "已共享记录不能在手机端直接删除"; return }
        struct Payload: Encodable { let baseVersion: Int; let operationId: String }
        let operationId = "ios-delete-\(UUID().uuidString.lowercased())"
        do {
            let _: RecordDeleteResponse = try await APIClient.shared.request("/api/v2/mobile/records/\(record.id)", method: "DELETE", body: Payload(baseVersion: record.version, operationId: operationId), operationId: operationId)
            await refresh(); notice = "草稿已删除"
        } catch {
            self.error = isConflict(error) ? "删除前记录已在其他设备更新，请刷新后重试" : error.localizedDescription
            if isConflict(error) { await reloadRecordsOnly() }
        }
    }

    func requestShare(_ record: MobileRecord, audience: String = "both") async {
        guard record.status != "confirmed" else { return }
        guard record.classId != nil || record.studentId != nil else { error = "请先编辑记录并关联课时，再提交共享确认"; return }
        struct Payload: Encodable { let audience: String }
        do {
            let _: RecordShareResponse = try await APIClient.shared.request("/api/v2/mobile/records/\(record.id)/share", method: "POST", body: Payload(audience: audience))
            notice = "已进入待确认中心；批准后学生和家长才会看到"
        } catch { self.error = error.localizedDescription }
    }

    func flushOutbox() async {
        let items = readOutbox(); guard !items.isEmpty else { queued = 0; return }
        var remaining: [RecordDraft] = [], movedToConflict = 0
        for item in items {
            do {
                let _: RecordSaveResponse = try await APIClient.shared.request("/api/v2/mobile/records", method: "POST", body: item, operationId: item.operationId)
            } catch {
                if isConflict(error) || !shouldQueue(error) { keepConflict(item); movedToConflict += 1 }
                else { remaining.append(item) }
            }
        }
        writeDrafts(remaining, key: outboxKey); queued = remaining.count
        if movedToConflict > 0 { error = "\(movedToConflict) 条离线修改与服务器冲突，已保留在本机" }
    }

    func saveConflictAsCopy(_ draft: RecordDraft) async {
        if await save(.copyOf(draft)) { discardConflict(draft) }
    }

    func discardConflict(_ draft: RecordDraft) {
        conflicts.removeAll { $0.id == draft.id }
        writeDrafts(conflicts, key: conflictKey)
    }

    static func clearLocalDrafts() {
        UserDefaults.standard.removeObject(forKey: "mobileRecordOutboxV1")
        UserDefaults.standard.removeObject(forKey: "mobileRecordConflictsV1")
    }

    private func reloadRecordsOnly() async {
        if let response: RecordListResponse = try? await APIClient.shared.request("/api/v2/mobile/records") { records = response.records }
    }

    private static func readDrafts(key: String) -> [RecordDraft] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([RecordDraft].self, from: data)) ?? []
    }
    private func readOutbox() -> [RecordDraft] { Self.readDrafts(key: outboxKey) }
    private func writeDrafts(_ items: [RecordDraft], key: String) {
        if let data = try? JSONEncoder().encode(items) { UserDefaults.standard.set(data, forKey: key) }
    }
    private func keepConflict(_ draft: RecordDraft) {
        if let index = conflicts.firstIndex(where: { $0.id == draft.id }) { conflicts[index] = draft }
        else { conflicts.append(draft) }
        writeDrafts(conflicts, key: conflictKey)
    }
    private func isConflict(_ error: Error) -> Bool {
        guard let clientError = error as? APIClientError else { return false }
        if case .server(let status, _) = clientError { return status == 409 }
        return false
    }
    private func shouldQueue(_ error: Error) -> Bool {
        if error is URLError { return true }
        return (error as? APIClientError)?.canRetryLater == true
    }
}
