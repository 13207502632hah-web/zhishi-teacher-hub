const api = require("../../utils/api");
const tagLabels = ["观点不准确", "材料对应不足", "政治术语不规范", "答题层次不清", "采分点缺失"];
const outcomes = [{ value: "completed", label: "已完成" }, { value: "revision", label: "需订正" }, { value: "excellent", label: "优秀" }, { value: "incomplete", label: "未完成" }];

Page({
  data: { assignments: [], submissions: [], assignmentId: 0, submissionId: 0, tags: tagLabels.map((label) => ({ label, selected: false })), outcomes, outcomeIndex: 0, outcome: "completed", score: "", note: "", requirements: "", loading: true, error: "", busy: false },
  onLoad() { this.load(); },
  async load() { try { const data = await api.request("/api/mini/assignments"); this.setData({ assignments: data.assignments || [], loading: false }); } catch (error) { this.setData({ loading: false, error: error.error || "加载失败" }); } },
  async chooseAssignment(event) { const assignmentId = Number(event.currentTarget.dataset.id), data = await api.request(`/api/mini/submissions?assignmentId=${assignmentId}`); this.setData({ assignmentId, submissions: data.submissions || [], submissionId: 0 }); },
  chooseSubmission(event) { this.setData({ submissionId: Number(event.currentTarget.dataset.id) }); },
  chooseOutcome(event) { const outcomeIndex = Number(event.detail.value); this.setData({ outcomeIndex, outcome: this.data.outcomes[outcomeIndex].value }); },
  toggleTag(event) { const index = Number(event.currentTarget.dataset.index), tags = this.data.tags.map((item, position) => position === index ? { ...item, selected: !item.selected } : item); this.setData({ tags }); },
  field(event) { this.setData({ [event.currentTarget.dataset.key]: event.detail.value }); },
  async save(event) { if (!this.data.submissionId || this.data.busy) return; this.setData({ busy: true }); try { await api.request("/api/mini/submissions", { method: "POST", data: { action: event.currentTarget.dataset.confirm ? "confirm-review" : "save-review", submissionId: this.data.submissionId, outcome: this.data.outcome, score: this.data.score === "" ? null : Number(this.data.score), reviewTags: this.data.tags.filter((item) => item.selected).map((item) => item.label), teacherNote: this.data.note, revisionRequirements: this.data.requirements, operationId: api.operationId("review") } }); wx.showToast({ title: event.currentTarget.dataset.confirm ? "已确认回传" : "草稿已保存" }); } catch (error) { wx.showModal({ title: "保存失败", content: error.error || "请重试", showCancel: false }); } finally { this.setData({ busy: false }); } },
});
