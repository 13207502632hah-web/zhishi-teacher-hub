const api = require("../../utils/api");
const config = require("../../config");

Page({
  data: { items: [], counts: {}, me: null, loading: true, refreshing: false, error: "", showTestLogin: config.testLoginEnabled(), testRoles: ["student", "parent", "teacher"] },
  onShow() { this.load(); },
  onPullDownRefresh() { this.setData({ refreshing: true }); this.load(true).finally(() => { this.setData({ refreshing: false }); wx.stopPullDownRefresh(); }); },
  async load(force = false) {
    this.setData({ loading: !force, error: "" });
    try {
      if (!getApp().globalData.token) {
        if (this.data.showTestLogin) throw { error: "请先登录；本地开发可使用下方测试身份" };
        await api.loginWithCode();
        getApp().globalData.syncCursor = 0; wx.setStorageSync("mini-sync-cursor", 0);
      }
      const sync = await api.sync();
      const me = sync.snapshot ? sync.snapshot.me : await api.request("/api/mini/me");
      const assignments = sync.snapshot ? sync.snapshot : await api.request("/api/mini/assignments");
      this.setData({ me, items: assignments.assignments || [], counts: assignments.counts || {}, loading: false });
    } catch (error) { this.setData({ loading: false, error: error.error || "加载失败，请重试" }); }
  },
  async login(event) { try { await api.testLogin(event.currentTarget.dataset.role || "student"); getApp().globalData.syncCursor = 0; wx.setStorageSync("mini-sync-cursor", 0); this.load(true); } catch (error) { this.setData({ error: error.error || "请在本地环境开启 WECHAT_TEST_MODE" }); } },
  async realLogin() { try { await api.loginWithCode(); getApp().globalData.syncCursor = 0; wx.setStorageSync("mini-sync-cursor", 0); await this.load(true); } catch (error) { this.setData({ error: error.error || "微信登录失败，请稍后重试" }); } },
  bindAccount() { wx.navigateTo({ url: "/pages/bind/index" }); },
  open(event) { wx.navigateTo({ url: `/pages/assignment/index?id=${event.currentTarget.dataset.id}` }); },
  review() { wx.navigateTo({ url: "/pages/review/index" }); },
  publish() { wx.navigateTo({ url: "/pages/publish/index" }); },
  inbox() { wx.navigateTo({ url: "/pages/inbox/index" }); },
});
