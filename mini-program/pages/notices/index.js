const api = require("../../utils/api");

Page({
  data: { loading: true, error: "", me: null, studentId: 0, studentIndex: 0, notices: [], counts: {}, expandedId: 0, busyId: 0 },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const me = await api.request("/api/v2/mini/me"), studentId = this.data.studentId || me.currentStudentId;
      if (!studentId) { this.setData({ me, loading: false, error: me.bindingStatus === "pending" ? "绑定申请待教师确认" : "请先绑定学生" }); return; }
      const data = await api.request(`/api/v2/mini/notices?studentId=${studentId}`), studentIndex = Math.max(0, me.students.findIndex((item) => Number(item.studentId) === Number(studentId)));
      this.setData({ ...data, me, studentId, studentIndex, loading: false });
    } catch (error) { this.setData({ loading: false, error: error.error || "家校消息加载失败" }); }
  },
  switchStudent(event) { const studentIndex = Number(event.detail.value), selected = this.data.me.students[studentIndex]; this.setData({ studentId: Number(selected.studentId), studentIndex, expandedId: 0 }); this.load(); },
  async openNotice(event) {
    const id = Number(event.currentTarget.dataset.id), current = this.data.notices.find((item) => Number(item.id) === id);
    if (!current) return; this.setData({ expandedId: this.data.expandedId === id ? 0 : id });
    if (current.readAt || this.data.busyId === id) return;
    this.setData({ busyId: id });
    try { const result = await api.request(`/api/v2/mini/notices/${id}/read`, { method: "POST", data: { studentId: this.data.studentId, action: "read", operationId: api.operationId("notice-read") } }); this.updateReceipt(id, result.receipt); }
    catch (error) { this.setData({ error: error.error || "已读状态同步失败，请重试" }); }
    finally { this.setData({ busyId: 0 }); }
  },
  async acknowledge(event) {
    const id = Number(event.currentTarget.dataset.id); if (!id || this.data.busyId === id) return; this.setData({ busyId: id, error: "" });
    try { const result = await api.request(`/api/v2/mini/notices/${id}/read`, { method: "POST", data: { studentId: this.data.studentId, action: "acknowledge", operationId: api.operationId("notice-ack") } }); this.updateReceipt(id, result.receipt); wx.showToast({ title: "已确认知晓", icon: "success" }); }
    catch (error) { this.setData({ error: error.error || "确认失败，请重试" }); }
    finally { this.setData({ busyId: 0 }); }
  },
  updateReceipt(id, receipt) { const notices = this.data.notices.map((item) => Number(item.id) === id ? { ...item, ...(receipt || {}) } : item), unread = notices.filter((item) => !item.readAt).length, unacknowledged = notices.filter((item) => !item.acknowledgedAt).length; this.setData({ notices, counts: { ...this.data.counts, unread, unacknowledged } }); },
});
