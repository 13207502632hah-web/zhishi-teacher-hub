const api = require("../../utils/api");

Page({
  data: { me: null, items: [], studentId: 0, studentIndex: 0, selected: null, loading: true, error: "", playingId: 0 },
  onShow() { this.load(); },
  onUnload() { if (this.audio) this.audio.destroy(); },
  onPullDownRefresh() { this.load().finally(wx.stopPullDownRefresh); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const me = await api.request("/api/v2/mini/me"), studentId = this.data.studentId || me.currentStudentId;
      if (!studentId) { this.setData({ me, loading: false, error: me.bindingStatus === "pending" ? "注册申请待教师批准" : "请先申请注册" }); return; }
      const data = await api.request(`/api/v2/mini/dictations?studentId=${studentId}`), studentIndex = Math.max(0, me.students.findIndex((item) => Number(item.studentId) === Number(studentId)));
      const items = data.assignments || [], selected = items.find((item) => Number(item.id) === Number(this.data.selected && this.data.selected.id)) || null;
      this.setData({ me, studentId, studentIndex, items, selected, loading: false });
    } catch (error) { this.setData({ loading: false, error: error.error || "训练任务加载失败" }); }
  },
  switchStudent(event) { const studentIndex = Number(event.detail.value), selected = this.data.me.students[studentIndex]; this.setData({ studentId: Number(selected.studentId), studentIndex, selected: null }); this.load(); },
  open(event) { const selected = this.data.items.find((item) => Number(item.id) === Number(event.currentTarget.dataset.id)); this.setData({ selected: selected || null }); },
  back() { this.setData({ selected: null }); },
  async openFile(event) {
    const attachment = this.data.selected.attachments[Number(event.currentTarget.dataset.index)];
    try {
      const path = await api.download(attachment.url);
      if (String(attachment.mimeType || "").startsWith("audio/")) {
        if (this.audio) this.audio.destroy(); this.audio = wx.createInnerAudioContext(); this.audio.src = path; this.audio.onEnded(() => this.setData({ playingId: 0 })); this.audio.onError(() => this.setData({ playingId: 0, error: "音频播放失败，请重新下载" })); this.audio.play(); this.setData({ playingId: Number(attachment.id) });
      } else wx.openDocument({ filePath: path, showMenu: true });
    } catch (error) { this.setData({ error: error.error || "附件打开失败" }); }
  },
  submit() { const item = this.data.selected; wx.navigateTo({ url: `/pages/submit/index?id=${item.id}&studentId=${this.data.studentId}&kind=${item.kind}` }); },
});
