const apiBases = {
  develop: "http://localhost:3000",
  trial: "https://zhishi-teacher-hub.jz4hbwctq7.chatgpt.site",
  release: "https://zhishi-teacher-hub.jz4hbwctq7.chatgpt.site",
};

function environment() {
  try { return wx.getAccountInfoSync().miniProgram.envVersion || "develop"; } catch (error) { return "develop"; }
}

function apiBase() {
  const override = wx.getStorageSync("mini-api-base");
  return override || apiBases[environment()] || apiBases.develop;
}

function testLoginEnabled() {
  return environment() === "develop" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(apiBase());
}

module.exports = { apiBase, environment, testLoginEnabled };
