const api = require("../../utils/api");
const config = require("../../config");
const CLIENT_VERSION = "2.0.6";

function diagnosticText(error) {
  const parts = [CLIENT_VERSION, error && error.stage, error && error.code];
  if (error && error.statusCode) parts.push(`HTTP ${error.statusCode}`);
  if (error && error.providerCode) parts.push(`微信 ${error.providerCode}`);
  if (error && error.detail) parts.push(error.detail);
  return parts.filter(Boolean).join(" · ");
}

Page({
  data: { items: [], counts: {}, me: null, loading: true, refreshing: false, loginRetrying: false, error: "", diagnostic: "", clientVersion: CLIENT_VERSION, showTestLogin: config.testLoginEnabled(), testRoles: ["student", "parent"] },
  onShow() { this.load(); },
  onPullDownRefresh() { this.setData({ refreshing: true }); this.load(true).finally(() => { this.setData({ refreshing: false }); wx.stopPullDownRefresh(); }); },
  async load(force = false) {
    this.setData({ loading: !force, error: "", diagnostic: "" });
    try {
      if (!getApp().globalData.token) {
        if (this.data.showTestLogin) throw { error: "请先登录；本地开发可使用下方测试身份" };
        await api.loginWithCode();
        getApp().globalData.syncCursor = 0; wx.setStorageSync("mini-sync-cursor", 0);
      }
      const sync = await api.sync();
      const me = sync.snapshot ? sync.snapshot.me : await api.request("/api/v2/mini/me");
      const assignments = sync.snapshot ? sync.snapshot : await api.request("/api/v2/mini/assignments");
      this.setData({ me, items: (assignments.assignments || []).filter((item) => (item.kind || "homework") === "homework"), counts: assignments.counts || {}, loading: false });
    } catch (error) { this.setData({ loading: false, error: error.error || "加载失败，请重试", diagnostic: diagnosticText(error) }); }
  },
  async login(event) { try { await api.testLogin(event.currentTarget.dataset.role || "student"); getApp().globalData.syncCursor = 0; wx.setStorageSync("mini-sync-cursor", 0); this.load(true); } catch (error) { this.setData({ error: error.error || "请在本地环境开启 WECHAT_TEST_MODE" }); } },
  async realLogin() {
    if (this.data.loginRetrying) return;
    this.setData({ loginRetrying: true, error: "", diagnostic: "" });
    try {
      await api.loginWithCode();
      getApp().globalData.syncCursor = 0;
      wx.setStorageSync("mini-sync-cursor", 0);
      await this.load(true);
    } catch (error) {
      this.setData({ error: error.error || "微信登录失败，请关闭小程序后重新打开", diagnostic: diagnosticText(error) });
    } finally {
      this.setData({ loginRetrying: false });
    }
  },
  registerAccount() { wx.navigateTo({ url: "/pages/register/index" }); },
  openDictations() { wx.navigateTo({ url: "/pages/dictation/index" }); },
  open(event) { wx.navigateTo({ url: `/pages/assignment/index?id=${event.currentTarget.dataset.id}` }); },
});
