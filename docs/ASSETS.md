# 完整网站资源

此发行版已包含网页需要的原始游戏资源与生成的 WebP、字体和图标。克隆后即可显示完整图片与五语官方资料，默认 Docker 构建也包含这些文件。

资源目录包括：

| 路径 | 内容 |
| --- | --- |
| `data/demon-profiles.json` | `source` 与按仲魔英文名索引的 `demons[name].paragraphs` |
| `data/demon-traits.json` | 与本地游戏核对的适合度与异常耐性 |
| `web/assets/demons/manifest.json` | `demons` / `essences` 的头像映射 |
| `web/assets/demons/*.png`、`display/*.png` | 原图及显示副本 |
| `web/assets/demons/optimized/*.webp` | 本地生成的响应式头像副本 |
| `web/assets/optimized/story-art.webp` | 本地生成的装饰图副本 |
| `web/assets/elements/*.png` | 技能属性图标 |
| `web/assets/elements/manifest.json` | 原生图标的游戏来源、裁切坐标与像素摘要 |
| `web/assets/ailments/*.png` | 六种异常状态图标 |
| `web/assets/logo.png` | 本地品牌图片 |
| `web/auth/theme/smtvv-logo.png` | 登录页使用的品牌图片副本 |
| `web/assets/favicon.png`、`web/auth/theme/smtvv-favicon.png` | 64px 标签页图标及其公共副本；所有页面引用公共副本 |
| `web/assets/locales/{en,ja,zh-Hant,ko}.json` | 官方多语言名称、技能效果、仲魔介绍及解锁任务名称，见 [多语言说明](I18N.md) |

头像路径必须是 `/assets/demons/名称.png` 或 `/assets/demons/display/名称.png`。映射支持 `src`、`width`、`height` 与嵌套 `display` 字段。资源来源与身份信息保留在原始 manifest 中。游戏美术和原文不受 MIT 或 Unlicense 覆盖，请保留第三方权利声明。

### 本地生成更小的资源

更新原始资源后，可在开发环境重新生成副本：

```sh
python3 -m pip install -r requirements-assets.txt
python3 scripts/optimize_images.py
```

脚本保留全部 PNG，在 `optimized/` 生成 96px、192px 和原始裁切尺寸的 WebP，
并原子更新本地 manifest 的 `optimized.variants`。窄图不放大，共用图片只生成一次；
重复执行复用已有的头像副本。完整尺寸 WebP 使用无损编码，列表副本先缩小再无损编码。
装饰图限制为 720px、WebP quality 94，仅在文件更小时使用。原始装饰图同样保留。

浏览器按显示尺寸和屏幕像素密度选择头像，失败时依次重试当前副本、裁切 PNG、原始 PNG，
最后显示可访问占位。没有 `optimized` 字段的旧资源包仍可直接使用。
`/assets/demons/manifest.json?view=runtime` 提供仅含显示所需字段的紧凑映射，并按请求协商
gzip 压缩；不带该参数的地址保留完整来源、游戏编号等核对信息。生成资源与原图均包含在本仓库和 Docker 镜像中。

字体与图标的构建不访问网络：

```sh
python3 scripts/build_font_subsets.py
node scripts/build_icons.cjs
```

字体脚本从已有 OFL 字体拆分界面和长文本字形，生成 `fonts-optimized.css` 与带哈希的
WOFF2。各字符范围不重叠，原字体为剩余字形提供回退；完整覆盖校验防止漏字。
生成字体、样式和图标子集随仓库分发。新增界面文案、语言包或图标后可重新构建。
这些工具依赖仅用于构建，应用运行时无需 Pillow 或 FontTools。

### 从本地原生图集生成技能图标

已有从本地游戏导出的 `icon_element_01.png` 时，可以生成 14 个技能分类图标和
6 个异常状态图标。输入必须是游戏原生的 1024×680 RGBA 图集。

```sh
python3 scripts/build_game_icons.py /私有目录/icon_element_01.png \
  --source-metadata /私有目录/source.json
```

`source.json` 必须包含与输入文件匹配的 `atlasSha256`，并应记录 Steam 构建、PAK
索引摘要、纹理与材质路径及导出文件摘要。工具采用游戏材质的 80px 单元、84px 步长和
4px 起点，检查原生透明边界，只裁掉透明留白，不缩放、锐化或重新绘制。
生成的属性图标为 64×64，异常状态为 76×76，均以 RGBA PNG 无损保存并回读核对像素。
来源、坐标与逐图摘要写入 `web/assets/elements/manifest.json`。

本发行版已包含生成图片及来源清单；重新导出时使用独立的原生图集和来源数据。

本地更新资源后重启应用即可。Docker 模式直接执行 `docker compose up -d --build`；需要让应用直接读取工作区资源时，可额外使用 `compose.assets.yaml`。网关始终只读挂载工作区的 `web/`。

原生头像来自本地 Steam《Shin Megami Tensei V: Vengeance》，App ID `1875830`、Build ID `17140961`。P3 Reload 素材来源见其目录中的 `SOURCES.md`。全部资源保留相应来源及许可说明。
