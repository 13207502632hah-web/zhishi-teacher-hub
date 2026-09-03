const api = require("../../utils/api");

Page({
  data: { me: null, files: [], studentId: 0, studentIndex: 0, loading: true, error: "", playingId: 0 },
  onShow() { this.load(); },
  onUnload() { if (this.audio) this.audio.destroy(); },
  onPullDownRefresh() { this.load().finally(wx.stopPullDownRefresh); },
  async load() { this.setData({ loading: true, error: "" }); try { const me = await api.request("/api/v2/mini/me"), studentId = this.data.studentId || me.currentStudentId; if (!studentId) { this.setData({ me, loading: false, error: me.bindingStatus === "pending" ? "注册申请待教师批准" : "请先申请注册" }); return; } const data = await api.request(`/api/v2/mini/class-files?studentId=${studentId}`), studentIndex = Math.max(0, me.students.findIndex((item) => Number(item.studentId) === Number(studentId))); this.setData({ me, studentId, studentIndex, files: data.files || [], loading: false }); } catch (error) { this.setData({ loading: false, error: error.error || "班级资料加载失败" }); } },
  switchStudent(event) { const studentIndex = Number(event.detail.value), selected = this.data.me.students[studentIndex]; this.setData({ studentId: Number(selected.studentId), studentIndex }); this.load(); },
  async open(event) { const file = this.data.files[Number(event.currentTarget.dataset.index)]; try { const path = await api.download(file.url), mime = String(file.mimeType || ""); if (mime.startsWith("image/")) wx.previewImage({ urls: [path], current: path }); else if (mime.startsWith("audio/")) { if (this.audio) this.audio.destroy(); this.audio = wx.createInnerAudioContext(); this.audio.src = path; this.audio.onEnded(() => this.setData({ playingId: 0 })); this.audio.onError(() => this.setData({ playingId: 0, error: "音频播放失败，请重新下载" })); this.audio.play(); this.setData({ playingId: Number(file.id) }); } else wx.openDocument({ filePath: path, showMenu: true }); } catch (error) { this.setData({ error: error.error || "文件打开失败，请检查网络" }); } },
});
