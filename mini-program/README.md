# 知师研室微信小程序一期

当前项目可在微信开发者工具使用测试 AppID 预览。正式发布前必须完成：

1. 注册并认证小程序，填写真实 AppID。
2. 配置 HTTPS `request`、`uploadFile`、`downloadFile` 合法域名。
3. 在托管环境配置 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`，关闭 `WECHAT_TEST_MODE`。
4. 配置作业截止与课程变动订阅消息模板；用户未授权时以小程序内部待办为准。
5. 用学生和家长测试账号验证绑定关系、私有文件权限与优秀作业遮罩后再提交审核。

测试模式只应在本地环境设置 `WECHAT_TEST_MODE=true`，生产环境禁止开启。
