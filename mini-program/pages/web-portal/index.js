const config = require("../../config");

Page({
  data: { src: "", error: "" },
  onLoad() {
    const token = getApp().globalData.token;
    if (!token) {
      this.setData({ error: "登录已过期，请返回小程序重新登录。" });
      return;
    }

    this.setData({
      src: `${config.apiBase()}/portal#mini_token=${encodeURIComponent(token)}`,
    });
  },
});
