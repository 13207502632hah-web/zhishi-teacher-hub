const releaseTarget = require("./release-target");

const apiBases = {
  develop: "http://localhost:3000",
  // 未执行 release:domain 时保持不可解析占位域名，避免误连旧站。
  trial: releaseTarget.apiOrigin,
  release: releaseTarget.apiOrigin,
};

function environment() {
  try { return wx.getAccountInfoSync().miniProgram.envVersion || "develop"; } catch (error) { return "develop"; }
}

function apiBase() {
  const current = environment();
  const override = current === "develop" ? wx.getStorageSync("mini-api-base") : "";
  return override || apiBases[current] || apiBases.develop;
}

function testLoginEnabled() {
  return environment() === "develop" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(apiBase());
}

module.exports = { apiBase, environment, testLoginEnabled };
