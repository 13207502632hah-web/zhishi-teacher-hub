const app = () => getApp();

function operationId(prefix = "op") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function sessionExpired() {
  app().globalData.token = ""; app().globalData.me = null;
  wx.removeStorageSync("mini-token"); wx.removeStorageSync("mini-role");
  wx.showToast({ title: "登录已过期", icon: "none" });
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => wx.request({
    url: app().globalData.apiBase + path,
    method: options.method || "GET",
    data: options.data,
    timeout: options.timeout || 15000,
    header: { "content-type": "application/json", authorization: `Bearer ${app().globalData.token}` },
    success(response) {
      if (response.statusCode === 401) sessionExpired();
      if (response.statusCode < 400) resolve(response.data);
      else reject(response.data || { error: readableError(response.statusCode) });
    },
    fail(error) { reject({ error: error.errMsg && error.errMsg.includes("timeout") ? "请求超时，请重试" : "网络连接失败，请重试", retryable: true }); },
  }));
}

function wxLoginOnce(timeout = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, {
      error: "微信登录超时，微信未返回登录凭证",
      code: "WX_LOGIN_TIMEOUT",
      retryable: true,
    }), timeout);
    wx.login({
      timeout,
      success: ({ code }) => code
        ? finish(resolve, code)
        : finish(reject, { error: "微信未返回登录凭证，请关闭小程序后重新打开", code: "WX_LOGIN_EMPTY_CODE", retryable: true }),
      fail: (failure) => finish(reject, {
        error: failure && failure.errMsg ? `微信登录失败：${failure.errMsg}` : "微信登录失败，请关闭小程序后重新打开",
        code: "WX_LOGIN_FAILED",
        retryable: true,
      }),
    });
  });
}

async function loginWithCode() {
  let code;
  try {
    code = await wxLoginOnce();
  } catch (firstError) {
    if (!firstError || !firstError.retryable) throw firstError;
    code = await wxLoginOnce();
  }
  return request("/api/v2/mini/login", { method: "POST", data: { code } }).then(saveLogin);
}

function testLogin(role = "student") {
  const miniRole = role === "parent" ? "parent" : "student";
  return request("/api/v2/mini/login", { method: "POST", data: { testCode: `${miniRole}-preview`, role: miniRole, displayName: `${miniRole}预览账号` } }).then(saveLogin);
}

function saveLogin(data) {
  app().globalData.token = data.token; app().globalData.role = data.role; app().globalData.me = data;
  wx.setStorageSync("mini-token", data.token); wx.setStorageSync("mini-role", data.role);
  return data;
}

function upload(filePath, purpose = "submission", opId = operationId("upload"), onProgress) {
  return new Promise((resolve, reject) => {
    const task = wx.uploadFile({
      url: app().globalData.apiBase + "/api/v2/mini/files", filePath, name: "file", formData: { purpose, operationId: opId }, timeout: 60000,
      header: { authorization: `Bearer ${app().globalData.token}` },
      success(response) { let data = {}; try { data = JSON.parse(response.data); } catch (error) { reject({ error: "上传响应异常，请稍后重试" }); return; } if (response.statusCode === 401) sessionExpired(); response.statusCode < 400 ? resolve(data) : reject(data); },
      fail(error) { reject({ error: error.errMsg && error.errMsg.includes("timeout") ? "上传超时，可单独重试这个文件" : "上传失败，可单独重试这个文件", retryable: true }); },
    });
    if (onProgress) task.onProgressUpdate((progress) => onProgress(progress.progress));
  });
}

function download(path) {
  return new Promise((resolve, reject) => wx.downloadFile({ url: app().globalData.apiBase + path, timeout: 60000, header: { authorization: `Bearer ${app().globalData.token}` }, success(response) { if (response.statusCode === 401) sessionExpired(); response.statusCode < 400 ? resolve(response.tempFilePath) : reject({ error: readableError(response.statusCode) }); }, fail: () => reject({ error: "下载失败，请检查网络后重试" }) }));
}

function sync() {
  const cursor = Number(app().globalData.syncCursor || 0);
  return request(`/api/v2/mini/sync?cursor=${cursor}`).then((data) => { app().globalData.syncCursor = Number(data.cursor || cursor); wx.setStorageSync("mini-sync-cursor", app().globalData.syncCursor); if (data.snapshot && data.snapshot.me) app().globalData.me = data.snapshot.me; return data; });
}

function readableError(status) { return status === 413 ? "文件过大，请压缩或拆分后上传" : status === 429 ? "操作过于频繁，请稍后重试" : status >= 500 ? "服务暂时不可用，请稍后重试" : "操作失败，请检查后重试"; }

module.exports = { request, testLogin, loginWithCode, upload, download, sync, operationId };
