import SwiftUI

struct RecordListView: View {
    @StateObject private var store = RecordStore()
    @State private var editorDraft: RecordDraft?

    var body: some View {
        NavigationStack {
            List {
                if store.queued > 0 {
                    Section { Label("\(store.queued) 条记录等待联网同步", systemImage: "arrow.triangle.2.circlepath") }
                }
                if !store.conflicts.isEmpty {
                    Section("跨设备冲突") {
                        ForEach(store.conflicts) { draft in
                            VStack(alignment: .leading, spacing: 8) {
                                Label(draft.title, systemImage: "exclamationmark.arrow.triangle.2.circlepath")
                                Text("服务器已有更新；本机内容没有丢失。可另存为新记录后再整理。")
                                    .font(.caption).foregroundStyle(.secondary)
                                HStack {
                                    Button("另存为新记录") { Task { await store.saveConflictAsCopy(draft) } }
                                    Button("放弃本机版本", role: .destructive) { store.discardConflict(draft) }
                                }.buttonStyle(.borderless)
                            }
                        }
                    }
                }
                if !store.notice.isEmpty { Section { Label(store.notice, systemImage: "checkmark.circle").foregroundStyle(.secondary) } }
                if !store.error.isEmpty { Section { Text(store.error).foregroundStyle(.red) } }
                Section("所有设备的记录") {
                    ForEach(store.records) { record in
                        recordRow(record)
                            .contentShape(Rectangle())
                            .onTapGesture { if record.status != "confirmed" { editorDraft = .editing(record) } }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if record.status != "confirmed" {
                                    Button("删除", role: .destructive) { Task { await store.delete(record) } }
                                    Button("共享") { Task { await store.requestShare(record) } }.tint(.green)
                                }
                            }
                    }
                    if store.records.isEmpty && !store.loading {
                        ContentUnavailableView("还没有记录", systemImage: "square.and.pencil", description: Text("记下课堂里最值得跟进的一件事。"))
                    }
                }
            }
            .navigationTitle("移动记录")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("新建", systemImage: "plus") { editorDraft = .blank() }
                }
            }
            .sheet(item: $editorDraft) { draft in
                RecordEditorView(store: store, initial: draft)
            }
            .refreshable { await store.refresh() }
            .task { await store.refresh() }
        }
    }

    @ViewBuilder
    private func recordRow(_ record: MobileRecord) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label(record.kind)).font(.caption)
                Spacer()
                Text(record.status == "confirmed" ? "已确认共享" : "教师草稿").font(.caption).foregroundStyle(.secondary)
            }
            Text(record.title).font(.headline)
            Text(record.content).font(.body).lineLimit(4)
            HStack {
                Text("\(record.source.uppercased()) · v\(record.version)")
                if record.classId != nil || record.studentId != nil { Label("已关联教学对象", systemImage: "link") }
            }.font(.caption2).foregroundStyle(.tertiary)
        }
    }

    private func label(_ kind: String) -> String {
        ["lesson_note":"课堂记录", "homework":"作业想法", "feedback_draft":"反馈草稿", "reflection":"教学反思", "idea":"临时想法"][kind] ?? kind
    }
}

private struct RecordEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: RecordStore
    @State private var draft: RecordDraft
    private let kinds = [("lesson_note","课堂记录"),("homework","作业想法"),("feedback_draft","反馈草稿"),("reflection","教学反思"),("idea","临时想法")]

    init(store: RecordStore, initial: RecordDraft) {
        self.store = store
        _draft = State(initialValue: initial)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("类型", selection: $draft.kind) { ForEach(kinds, id: \.0) { Text($0.1).tag($0.0) } }
                    TextField("标题", text: $draft.title)
                }
                Section("关联今日课时") {
                    Picker("课时", selection: $draft.lessonId) {
                        Text("暂不关联").tag(nil as Int?)
                        ForEach(store.lessons) { lesson in
                            Text("\(lesson.startTime ?? "待定") · \(lesson.className ?? lesson.courseName)").tag(Optional(lesson.id))
                        }
                    }
                    if store.lessons.isEmpty { Text("今天没有可关联课时，可先保存私有记录。请下拉刷新获取最新课表。") }
                }
                Section("内容") { TextEditor(text: $draft.content).frame(minHeight: 180) }
                Section { Label("正式发送给学生或家长仍需在待确认中心核对", systemImage: "checkmark.shield") }
            }
            .onChange(of: draft.lessonId) { _, lessonId in
                draft.classId = store.lessons.first(where: { $0.id == lessonId })?.classId
            }
            .navigationTitle(draft.baseVersion > 0 ? "编辑记录" : "新建记录")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存", systemImage: "checkmark") {
                        Task { if await store.save(draft) { dismiss() } }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
