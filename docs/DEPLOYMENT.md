# 部署与维护

自动 HTTPS 的首次部署请先使用 [README 中的部署命令](../README.md)。本页中的基础 Compose 命令适用于已有 HTTPS 代理的部署；自动 HTTPS 模式查看或停止整套服务时，使用 `docker compose -f compose.yaml -f compose.https.yaml`。Caddy 的 `caddy-data` 卷保存证书与 ACME 账号，迁移时请单独备份并保密。

## 首次部署

1. 克隆仓库，安装 Docker Engine、Compose 和 Python 3.10+。
2. 确定最终 HTTPS 域名，运行 `python3 scripts/configure.py https://planner.example.com`。
3. 把 `runtime/credentials.txt` 中的登录信息存入密码管理器。
4. 运行 `docker compose config --quiet`、`docker compose up -d --build`。
5. 配置 HTTPS 反向代理，访问域名并登录。

初始化不会覆盖非空的 `runtime/`，避免误换加密密钥或重置已有账号。配置以 JSON 语法写入 `.yml` 文件；JSON 是有效的 YAML，可直接交给 Authelia。

使用 Caddy 时，站点配置可以是：

```caddyfile
planner.example.com {
    reverse_proxy 127.0.0.1:8088
}
```

使用已有的 Nginx / OpenResty HTTPS 站点时：

```nginx
location / {
    proxy_pass http://127.0.0.1:8088;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 35s;
}
```

TLS 由外层代理负责。网关根据最终域名验证 Host；Authelia Cookie 仅在 HTTPS 下发送，所以不要直接用 `http://服务器:8088` 作为登录地址。默认 `SMTVV_BIND=127.0.0.1`，无需开放应用或认证端口到公网。

在 1Panel 中复用其管理的网站与证书，只更新该站点的上游。对已经以 systemd 运行的应用，也可以使用初始化生成的 `runtime/openresty-locations.conf`：它将应用转发到 `127.0.0.1:8765`，Authelia 转发到 `127.0.0.1:9091`。需要在 OpenResty 的 `http` 上下文声明 `limit_req_zone $binary_remote_addr zone=smtvv_start:1m rate=10r/m;` 和 `limit_req_zone $binary_remote_addr zone=smtvv_login:1m rate=12r/m;`，并为应用设置 `SMTVV_AUTH_PORTAL=/auth/`、`SMTVV_PUBLIC_URL=https://实际域名`。这一路径需要单独运行 Authelia，不能只复制网关片段。

## CDN 与缓存

登录页使用与前台、后台一致的 SMT V 青金视觉主题，`/auth/` 提供本站登录表单，密码校验、会话创建和退出仍由 Authelia API 完成。`/auth/theme/` 提供公开字体和登录展示素材；本地 Logo 副本为 `web/auth/theme/smtvv-logo.png`，缺失时显示文字站名（旧 `/assets/p3reload/` 资源仍用于兼容）；`/api/login/options` 只公开登录期限和选项，不包含账号或操作记录。业务页面、资料和管理 API 继续走原有鉴权。

后台的「登录与 Cookie」可配置 Cloudflare Turnstile 的开关、Site Key、Secret Key、主题和显示方式。Secret Key 保存在 `planner-data` 卷的权限受限文件中，管理 API 只返回是否已配置。首次启用或更换密钥时，后台必须先用同一组密钥完成一次 `turnstile_settings` 验证。登录使用 `login` action；应用检查 Siteverify 返回的 `hostname` 与 `action`，再签发绑定客户端 IP、五分钟有效且只能消费一次的 HttpOnly 票据。Nginx 必须通过 `/_smtvv_login_gate` 消费票据后才把 `/auth/api/firstfactor` 转给 Authelia，不能直接放行该接口。

自动化端到端测试可显式设置 `SMTVV_TURNSTILE_TESTING=1`，此时应用只接受 Cloudflare 官方测试 Secret 和带官方测试标记的 Siteverify 响应。该开关默认是 `0`，生产环境不得开启，也不得使用 `1x`、`2x` 或 `3x` 测试密钥。

主站顶部可在 SMT V、P5 和 P3 RELOAD 之间即时切换，并保留当前深浅色设置。风格选择保存在浏览器中，资料详情页沿用同一选择；切换不会重新加载页面或重建计算任务。新浏览器默认使用 SMT V。官方主角素材及来源见 `web/assets/p3reload/SOURCES.md`，素材随完整发行版提供。

推荐使用完整 Compose 栈。本仓库的默认镜像包含游戏资源；也可使用 `docker compose -f compose.yaml -f compose.assets.yaml up -d --build`，以只读方式挂载工作区的 `web/`、`data/`。

使用 systemd 的实例必须采用新版 `deploy/smtvv-planner.service`，或配置 `StateDirectory=smtvv-planner` 和 `SMTVV_STATE_DIR=/var/lib/smtvv-planner`。不要把可写设置放在只读的 `/opt/` 发布目录。若启用后台改密，还需安装 `requirements-auth.txt`、指定真实 `SMTVV_USERS_FILE`，并让 Authelia 的只读挂载及附加组对应同一账户目录；完整 Compose 已配置这些权限。

为**整个精确主机名**配置缓存绕过。Cloudflare Cache Rule 的条件示例是 `http.host eq "planner.example.com"`，动作是 Bypass cache。确保没有后续规则重新对该主机启用缓存；取消旧的 Cache Everything、目录或扩展名缓存规则。

这包含 `/api/catalog`、`/auth/`、`.js`、`.css`、图片和字体。不要仅对带 Cookie 的请求绕过缓存，否则匿名请求仍可能命中以前缓存的受保护内容。原站统一返回 `Cache-Control: no-store`。不要通过额外的静态站点绕过鉴权直接提供 `web/`。

应用在进程内复用静态文件读取和 gzip 压缩结果，每次响应仍先鉴权。这与浏览器/CDN 缓存
无关，受保护部署保持 `no-store`，包括带哈希的图片与字体。只有本地匿名模式使用 ETag
重验证和哈希资源的长期缓存。静态缓存最多 32 MiB、512 项；单文件超过 4 MiB 时使用流式发送。

更新时一并发布公共 HTML、CSS、`assets/icons.js`、`auth/theme/fonts-optimized.css` 及其
`fonts/optimized/` 字体文件。WebP 头像、装饰图及原始图片随本发行版提供；更新时按
[资源说明](ASSETS.md) 重新生成并同步，不能仅发布更新后的 manifest 而遗漏图片。

同步更新生成的网关配置：`/assets/demons/manifest.json` 必须经过原有访问校验后转发给
应用，才能按 `view=runtime` 返回精简映射；普通静态文件仍由 Nginx 发送。登录页的样式
恢复脚本使用精确的 CSP SHA-256 白名单，保持禁止任意内联脚本，脚本变更须同步该哈希。

保留 Full (strict) 和原有源站访问保护。源站 `/healthz` 只返回固定健康状态，允许匿名监控，不提供业务资料。

## 账号与会话

Authelia 使用文件账号、Argon2id 和加密 SQLite 状态；关闭公开注册与自助邮件重置。当前方案使用账号密码单因素登录，认证规则默认拒绝，只放行配置中的精确域名。

- Cookie：Secure、HttpOnly、SameSite=Lax；新安装默认普通登录有效期 24 小时、闲置超时 12 小时，可在后台修改。
- 每个 HTTPS 站点使用独立且固定的会话 Cookie 名称，避免父域、子域或旧路径下的同名 Cookie 让登录陷入循环。
- 登录页可选择「保持登录」，新安装默认 30 天。改密、修改会话策略或认证服务重启都会使旧登录失效。
- 后台关闭保持登录时，禁用值使用数字 `remember_me: -1`。不要写成 `-1s`：当前固定版本会把它解析为 1 秒。旧登录页提交 `keepMeLoggedIn=true` 时，服务端按普通登录期限处理。
- 「记住密码」交由浏览器密码管理器保存与填入。网站只在用户勾选后保存账号和选项，密码不会写入 localStorage、sessionStorage 或 Cookie。
- 2 分钟内 5 次密码失败会触发 10 分钟限制。账号应使用生成的随机密码。
- 前台右上角提供语言与显示设置。账户门户通过 `/auth/` 直接访问并可退出登录；管理后台通过 `/admin/` 直接访问。
- 登录过期时，页面显示重新登录入口并保留当前浏览器的配置与待恢复任务。

生成或重置一个账号：

```sh
python3 scripts/manage_user.py --username planner-admin
```

命令通过应用容器更新生效的 `/state/accounts/users_database.yml`，与后台修改密码使用同一份文件和文件锁。新密码只写入权限为 0600 的 `runtime/credentials.txt`，命令参数与输出不包含密码。原 `runtime/authelia/users_database.yml` 仅用于首次初始化，不能用修改该文件的方式重置运行中的账号。删除用户可加 `--delete`，脚本拒绝删除最后一个管理员。认证监督程序检测文件变化后会重启 Authelia、清除所有旧会话。

systemd 等非 Compose 部署需明确指定 `--accounts-file /实际生效路径/users_database.yml`，并在安装了 `argon2-cffi` 的环境执行。指定的必须是认证服务正在使用的文件，不能指向初始化副本。

账户目录由应用拥有，权限 0750；账户文件为 0640。Authelia 以附加组 10001 只读访问该目录，继续保持 `cap_drop: [ALL]`。站点设置及日志文件保持 0600。

后台修改密码需验证当前密码，5 分钟内最多尝试 5 次。只有确认旧 Cookie 被认证服务拒绝，页面才会报告“旧会话已清除”；认证异常时会明确提示需要检查。

所有业务 POST 请求还必须携带等于 `SMTVV_PUBLIC_URL` 的 Origin。浏览器自动设置它；脚本客户端需明确发送 Origin 和已认证的会话 Cookie。不要通过加入通配 CORS 来绕过这一检查。

## 升级与备份

必须同时备份 `planner-data` 和 `auth-data` 两个卷，以及 `runtime/` 配置与原密钥。`planner-data` 包含正在生效的账户库、访问开关、公告和操作记录；只备份初始化账号文件会丢失后续密码修改。可执行：

```sh
python3 scripts/backup_state.py /私有备份目录/smtvv-before-upgrade.tar.gz
```

备份脚本短暂暂停本项目的应用与认证容器，复制一致的状态快照后立即恢复，再压缩为 0600 的归档；期间请求可能短暂等待。归档包含两个状态卷、匹配的密钥、网关配置与 `.env`，不会覆盖已有备份。源代码和可选游戏资源需另外保存。备份期间不要并行修改运行配置。

```sh
git pull --ff-only
python3 scripts/upgrade_runtime.py
docker compose build
docker compose up -d
docker compose ps
```

升级 Authelia / Nginx 时，检查固定镜像版本与摘要，重新运行 `authelia config validate` 和鉴权浏览器测试。不要在存在数据库时重新初始化密钥。恢复时同时使用上一版源码、配置和对应备份；容器替换本身不删除命名卷。

`upgrade_runtime.py` 会备份并更新旧网关、账户文件路径及初始化副本权限，保留原用户和全部加密密钥；它不重置已存在的生效账户卷。已有容器应在升级前完整备份，升级后用 `docker compose up -d --wait` 重建，使新的挂载与监督程序生效。

登录设置升级会生成 `runtime/login-bootstrap.json`，其中只有非机密的会话字段。应用通过只读挂载导入原有期限，后续后台修改以 `planner-data` 卷中的 `/state/login-policy/current/` 为准。策略与 Authelia 配置通过一次原子切换发布；认证监督程序检测变化后校验并重载。只改登录页选项不会重启认证服务。更新已经挂载的 `deploy/authelia-supervisor.sh` 后，必须执行 `docker compose restart authelia`，让新的监督程序启动；这会使现有登录失效。

备份整个 `planner-data` 卷时需保留 `login-policy` 目录及相对符号链接，不能只复制 `settings.json`。非 Compose 部署还需设置 `SMTVV_LOGIN_BOOTSTRAP` 指向非机密配置，并让监督程序的 `SMTVV_SESSION_POLICY_FILE` 指向同一个 `login-policy/current/session.json`。应用写入策略目录，认证服务通过共享组只读访问；应用不需要 Docker 管理权限。

迁移旧默认 `smtvv_session` 时，脚本会改用本站独立的 Cookie 名称，保留自定义名称和过期设置。需要用原密码重新登录一次，无需手动清除浏览器数据。若只更新了挂载的认证配置而容器没有重建，执行 `docker compose restart authelia` 使新名称生效；重启会注销现有会话。

升级脚本同时把此前生成的 `remember_me: "-1s"` 改为数字 `-1`，包括单个域名下的覆盖值；自定义的有效期限继续保留。配置修改后须重启认证容器才能生效。

在**空的新项目或新主机**恢复时，先准备相同版本源码，将备份解压到私有目录，复制其中的 `runtime/`、`.env` 和 Compose 配置，再运行 `docker compose create` 创建未启动的容器与空卷。将两个内层 tar 流复制回对应容器，保留 UID/GID：

```sh
docker cp -a - "$(docker compose ps --all -q app)":/state < /解压目录/app-state.tar
docker cp -a - "$(docker compose ps --all -q authelia)":/state < /解压目录/authelia-state.tar
docker compose up -d --wait
```

不要向正在运行或已有数据的卷覆盖恢复；回滚应保留故障版本和当前状态另作备份。SQLite 必须与其原 `storage` 密钥一同恢复。

## 后台操作与验证

管理员访问 `/admin/`。访问开关即时保存，关闭后页面、资料和计算可匿名使用，管理页面与管理 API 仍要求 `admins` 组。维护模式只暂停新计算，已有任务可继续查看与取消。前台每 5 秒同步公告和维护状态，切回页面时立即刷新。公告采用纯文本，编辑冲突会保留草稿并拒绝覆盖他人的更新。

后台会话过期时，重新登录会在新标签页打开；登录后返回原标签页即可恢复编辑，登录设置和公告草稿继续保留。也可点击“刷新状态”重新检查登录状态。页面脚本短暂加载失败会自动重试，持续失败时显示“重新加载”入口。

「登录与 Cookie」可设置普通登录有效期、闲置超时、记住登录有效期，以及保持登录开关、默认勾选和记住密码选项。普通登录最多 30 天，记住登录最多 365 天；期限必须能换算为整数分钟。闲置超时不能长于普通登录有效期，记住登录有效期不能短于普通登录有效期。保存会话策略后，后台只有在确认旧 Cookie 已被拒绝时才显示已生效。未保存的登录设置会保留，跨页面编辑冲突会拒绝覆盖。

```sh
SMTVV_URL=https://实际域名 SMTVV_CREDENTIALS_FILE=/私有凭据文件 npm run test:admin
```

完整写入测试只能用于独立测试栈，示例：

```sh
SMTVV_URL=https://planner.example.com \
SMTVV_TEST_UPSTREAM=http://127.0.0.1:8088 \
SMTVV_ADMIN_MUTATIONS=1 npm run test:admin
```

该测试覆盖开关、维护同步、公告防脚本执行与编辑冲突、实际计算与取消、改密、旧会话失效、新密码登录，并恢复原测试密码和站点设置；它还检查 320–1440px 与深浅主题。测试证据不包含密码或 Cookie。

`npm run test:login-policy` 仅用于隔离测试栈，验证真实 Cookie 期限、策略重载、后台选项、草稿冲突、退出撤销，并等待闲置超时边界。浏览器密码管理器接口采用独立测试替身，认证请求仍全部经过真实 Authelia。

## 检查

```sh
docker compose ps
docker compose logs --tail 100 authelia gateway
SMTVV_URL=https://planner.example.com SMTVV_CREDENTIALS_FILE=runtime/credentials.txt npm run test:auth
SMTVV_URL=https://planner.example.com SMTVV_CREDENTIALS_FILE=runtime/credentials.txt npm run test:session
SMTVV_URL=https://planner.example.com SMTVV_CREDENTIALS_FILE=runtime/credentials.txt npm run test:remember-me
SMTVV_URL=https://planner.example.com SMTVV_CREDENTIALS_FILE=runtime/credentials.txt npm run test:admin-recovery
```

未登录的页面请求应跳转 `/auth/`，业务 API 应返回 401 JSON；带伪造 `Remote-User` 等请求头也不能通过。登录后资料与计算可用，退出后的旧 Cookie 必须失效。所有受保护路径都不应返回 CDN HIT。

会话回归测试会在隔离浏览器中预置旧的主机、父域和路径 Cookie，检查登录、前台与后台、刷新、新标签页和退出后重放。它只改变测试浏览器的会话，不修改网站设置或账号。

“记住我”回归分别发送 `keepMeLoggedIn=true/false`，检查服务端实际下发的 Cookie 有效期，并跨过原先的一秒过期边界后验证前后台、刷新、新标签页及退出撤销。它可用 `SMTVV_BROWSER=firefox` 或 `webkit` 切换引擎；设置 `SMTVV_CREDENTIALS_FILE=-` 可从标准输入读取私有凭据，避免另存明文文件。

后台恢复测试覆盖真实退出、重新登录、原标签页草稿恢复，以及仅在测试浏览器内模拟的脚本和状态请求故障；不会发布公告或修改站点设置。自定义会话 Cookie 名称时，可用 `SMTVV_SESSION_COOKIE` 指定鉴权和会话测试的预期名称。

不要把密码文件、Cookie、完整请求头、Authelia 数据库或真实部署配置作为问题附件上传。
