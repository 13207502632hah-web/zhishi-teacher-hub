const config = require("./config");

App({
  globalData: { apiBase: "", token: "", role: "student", me: null, syncCursor: 0 },
  onLaunch() {
    this.globalData.apiBase = config.apiBase();
    this.globalData.token = wx.getStorageSync("mini-token") || "";
    this.globalData.role = wx.getStorageSync("mini-role") || "student";
    this.globalData.syncCursor = Number(wx.getStorageSync("mini-sync-cursor") || 0);
  },
});
