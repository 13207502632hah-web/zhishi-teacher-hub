const api = require("../../utils/api");
Page({
  data: { loading: true, error: "", me: null, studentId: 0, studentIndex: 0, lessons: [], feedback: [], results: [], finance: [] },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load().finally(wx.stopPullDownRefresh); },
  async load() { this.setData({ loading: true, error: "" }); try { const me = await api.request("/api/mini/me"); if (me.role === "teacher") { this.setData({ me, loading: false, error: "教师端的完整学情与财务请使用电脑网站。" }); return; } const studentId = this.data.studentId || me.currentStudentId; if (!studentId) { this.setData({ me, loading: false, error: me.bindingStatus === "pending" ? "绑定申请待教师确认" : "请先绑定学生" }); return; } const data = await api.request(`/api/mini/portal?studentId=${studentId}`), studentIndex = Math.max(0, me.students.findIndex((item) => Number(item.studentId) === Number(studentId))); this.setData({ ...data, me, studentId, studentIndex, loading: false }); } catch (error) { this.setData({ loading: false, error: error.error || "加载失败" }); } },
  switchStudent(event) { const studentIndex = Number(event.detail.value), selected = this.data.me.students[studentIndex]; this.setData({ studentId: Number(selected.studentId), studentIndex }); this.load(); },
});
