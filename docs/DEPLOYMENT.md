# GitHub Pages + 管理员身份验证后端

目前的公开网站是 `https://lilth2.github.io/COMP8715demo/`。管理员页面集中在 `admin/`，后端在 `backend/`。线上暂时按要求启用初始账号的演示登录，只管理当前浏览器的模拟数据，不能保护真实数据。以下步骤用于切换到真实身份验证：GitHub Pages 提供前端，Node.js 服务验证账号、维护会话并保存管理数据。

## 1. 本地体验

需要 Node.js 20 或更新版本，无需安装额外依赖。在仓库目录运行：

```powershell
npm run setup:admin
npm start
```

打开 `http://127.0.0.1:8765/`，点击 **Admin Login**，新地址为 `http://127.0.0.1:8765/admin/login.html`。初始用户名为 `admin`，密码保存在 `backend/.private/INITIAL_ADMIN_CREDENTIALS.txt`。旧地址会自动跳转。目录调整保留本地已有账号和数据，不会重新生成密码。

账号文件存放加盐密码哈希。这个初始密码说明文件只供我们传递给管理员；它和账号文件都被 Git 忽略，也不能通过网站下载。再次运行初始化会保留原账号。没有注册入口。

## 2. 部署后端

选择可以运行 Node.js 或 Docker、提供 HTTPS 并挂载持久存储的平台。在仓库根目录使用启动命令 `node backend/server.js`。使用单个实例，数据文件必须位于持久磁盘，避免重新部署后丢失修改。

在平台的环境变量设置中填写：

| 变量 | 设置 |
| --- | --- |
| `NODE_ENV` | `production` |
| `PUBLIC_ORIGIN` | 后端 HTTPS 地址，例如 `https://directory-api.example.org`，末尾不要加 `/` |
| `ALLOWED_ORIGINS` | `https://lilth2.github.io`，必须是域名来源，不包含 `/COMP8715demo/` |
| `ADMIN_USERNAME` | `admin` 或我们约定的初始用户名 |
| `ADMIN_PASSWORD` | 初始管理员密码，至少 12 个字符；在平台秘密变量中设置 |
| `DATA_PATH` | 持久磁盘上的 JSON 数据文件，例如 `/app/backend/.private/dataset.json` |
| `PORT` | 使用平台分配的端口；默认 `8765` |

线上设置的账号密码决定线上登录凭证。若希望与本地相同，可将本地初始密码填写为后端的 `ADMIN_PASSWORD`，无需上传本地账号文件。更改密码后重启后端，已有内存会话同时失效。

仓库提供 `Dockerfile` 和 `backend/.env.example`。将 `backend/.env.example` 复制成根目录 `.env` 后填写真实配置，再执行：

```powershell
docker build -t rd-directory-backend .
docker volume create rd-directory-data
docker run --detach --name rd-directory-backend --env-file .env -p 8765:8765 --mount type=volume,source=rd-directory-data,target=/app/backend/.private rd-directory-backend
```

容器需要放在提供 HTTPS 的反向代理或托管平台后方。`PUBLIC_ORIGIN` 填外部访问的 HTTPS 地址。`.env` 不提交到 GitHub。

## 3. 连接 GitHub Pages

在 `site-config.js` 中将 `apiBaseUrl` 改为实际后端的 HTTPS 地址，例如：

```javascript
window.RD_SITE_CONFIG = {
  apiBaseUrl: "https://directory-api.example.org",
  demoAccount: { enabled: false }
};
```

该配置是公开地址，不包含密码或服务密钥。将前端更改发布到 GitHub Pages 后，导航栏登录按钮使用后端验证。所有页面链接使用相对路径，适配 `/COMP8715demo/` 项目网站。

## 4. 上线验收

1. 未登录时，进入 `admin/index.html` 应跳转到 `admin/login.html`。
2. 错误用户名或密码应显示错误并停留在登录页。
3. 正确初始凭证应打开管理控制台，显示管理员用户名。
4. 未登录请求 `/api/admin/dataset` 和 `/api/admin/action` 应返回 `401`。
5. 修改机构并保存后，另一浏览器刷新公开目录应看到修改；服务器重新启动后修改仍应保留。
6. 退出后再次访问管理页或使用旧会话调用接口应失败。
7. 注册接口不存在；账号、密码哈希和 `.private` 文件不能通过后端网址下载。
8. 跨浏览器共享验证：在浏览器 A 登录管理员，新增一条机构并保存草稿；在**另一个浏览器或设备**打开公开页，确认看不到它。回到 A 点击 Publish 并确认，刷新另一个浏览器，应能看到；点击 Withdraw 后再刷新，应消失。
9. 未登录请求 `/api/admin/dataset`、`/api/admin/action`（publish、setLayout、delete 等）均应返回 `401`。

真实后端模式中，登录会话有效期为 8 小时，后端重启也会使会话失效。连接后端的 GitHub Pages 前端使用服务器颁发的随机会话令牌，保存在当前标签页的 sessionStorage；服务器每次处理管理请求时验证令牌。更改前端页面或浏览器状态不能获得服务器写入权限。演示模式没有这些安全保证，应在接入真实数据前关闭。

本次范围为一个固定管理员、基本维护流程和服务器文件存储。请备份持久磁盘上的数据文件。后续可替换为数据库，并增加多角色和审批流程。

GitHub Pages 官方说明：https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages


## 5. 升级与数据迁移（版本 3）

新版本不再有 Archive，关系是项目 host 和研究主题标签的唯一来源，数据集版本为 3。首次启动时，后端会自动迁移旧的 `dataset.json`，并**在改写文件之前**把原文件原样复制到同目录的 `dataset.json.bak-v<旧版本号>`（只创建一次）。出问题时，停止服务，把备份文件改回 `dataset.json` 即可恢复。

迁移规则：

| 旧数据 | 迁移结果 |
| --- | --- |
| 没有 `status` 的记录（版本 1） | 变为 `published`，当前内容作为公开版本，原有公开内容不会消失 |
| `archived` 记录 | 保留全部内容，变为**非公开草稿**，不会自动公开，也不会被丢弃；需要时可编辑后重新发布，不需要可删除 |
| 带有主题标签或 host、但没有对应关系的记录 | 自动补建 `shares_research_theme` / `hosted_by` 关系；两端都已发布时补建为已发布，所以公开筛选和统计不会变少 |
| 没有 `themes` 的旧文件 | 用内置种子主题补齐，使其可在后台管理 |

升级前建议自己再备份一次持久磁盘上的 `dataset.json`。迁移不会清空任何记录；Delete 是唯一删除记录的操作，并且在后台逐条确认。

## 6. GitHub Pages 浏览器演示模式的限制

`site-config.js` 里 `apiBaseUrl` 为空时，站点处于浏览器演示模式：

- 数据只保存在**当前浏览器**的 localStorage，只在同一浏览器、同一站点内同步（同一浏览器的不同标签页通过 `storage` 事件更新）。
- **不会**同步给其他访客、其他浏览器或其他设备；清除站点数据会丢失，请用 Export JSON 备份。
- 演示登录是前端校验，可被绕过，只能用于合成数据。

要让所有访客共享同一份已发布数据，必须部署后端（第 2 节），并在 `site-config.js` 中设置 `apiBaseUrl` 与 `ALLOWED_ORIGINS`（第 3 节）。在没有后端地址和部署凭据的情况下，线上共享**不会**生效。
