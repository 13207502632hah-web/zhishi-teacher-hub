import Foundation

struct SessionResponse: Decodable {
    let authenticated: Bool
    let role: String?
    let user: SessionUser?
}

struct SessionUser: Decodable { let id: Int?; let name: String; let email: String? }
struct LoginResponse: Decodable { let ok: Bool; let returnTo: String? }
struct APIErrorBody: Decodable { let error: String?; let code: String? }

struct MobileRecord: Codable, Identifiable, Hashable {
    let id: String
    let kind: String
    let title: String
    let content: String
    let occurredAt: String
    let lessonId: Int?
    let classId: Int?
    let studentId: Int?
    let status: String
    let audience: String
    let source: String
    let version: Int
    let updatedAt: String
    let createdAt: String?
}

struct RecordListResponse: Decodable { let records: [MobileRecord]; let cursor: Int; let full: Bool }
struct RecordSaveResponse: Decodable { let record: MobileRecord?; let repeated: Bool; let conflict: Bool }
struct RecordDeleteResponse: Decodable { let deleted: Bool; let repeated: Bool; let conflict: Bool }
struct ApprovalReference: Decodable { let id: String }
struct RecordShareResponse: Decodable { let approval: ApprovalReference? }

struct RecordDraft: Codable, Identifiable, Hashable {
    let id: String
    let operationId: String
    var baseVersion: Int
    var kind: String
    var title: String
    var content: String
    var occurredAt: String
    var lessonId: Int?
    var classId: Int?
    let source: String

    static func blank() -> RecordDraft {
        let id = UUID().uuidString.lowercased()
        return RecordDraft(id: id, operationId: "ios-\(id)", baseVersion: 0, kind: "lesson_note", title: "", content: "", occurredAt: ISO8601DateFormatter().string(from: Date()), lessonId: nil, classId: nil, source: "ios")
    }

    static func editing(_ record: MobileRecord) -> RecordDraft {
        RecordDraft(id: record.id, operationId: "ios-edit-\(UUID().uuidString.lowercased())", baseVersion: record.version, kind: record.kind, title: record.title, content: record.content, occurredAt: record.occurredAt, lessonId: record.lessonId, classId: record.classId, source: "ios")
    }

    static func copyOf(_ draft: RecordDraft) -> RecordDraft {
        let id = UUID().uuidString.lowercased()
        return RecordDraft(id: id, operationId: "ios-copy-\(id)", baseVersion: 0, kind: draft.kind, title: draft.title, content: draft.content, occurredAt: ISO8601DateFormatter().string(from: Date()), lessonId: draft.lessonId, classId: draft.classId, source: "ios")
    }
}

struct DashboardResponse: Decodable {
    let date: String
    let lessons: [LessonSummary]
    let pendingApprovals: Int
    let recordsToday: Int
}

struct LessonSummary: Decodable, Identifiable {
    let id: Int
    let date: String
    let startTime: String?
    let endTime: String?
    let courseName: String
    let topic: String?
    let status: String
    let classId: Int?
    let className: String?
}
