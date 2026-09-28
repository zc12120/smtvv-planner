# 仲魔头像素材

本目录是供本工具独立使用的游戏头像副本，覆盖当前仲魔目录全部 **275 只**，包含 DLC、女娲与亚必迭的不同形态，以及复仇篇莉莉丝。

- `*.png`：275 张原生 512×256 RGBA 头像，无损保存，保留透明通道。图片合计 30,520,015 字节，约 29.1 MiB。
- `display/`：275 张页面显示副本，去除透明留白和边角定位块，保留 8px 空隙，未重采样角色像素。它们让相同显示空间里的角色更清楚。
- `preview.html`：双击即可离线浏览全部头像，可用 Ctrl+F 查找中英文名称。
- `manifest.json`：以项目英文仲魔名称为键的映射，页面优先读取 `demons[name].display.src`；`src` 与 `file` 仍指向原始图片。`display` 记录显示副本的尺寸、裁切范围及校验值。

例如，义经页面使用 `manifest.demons["Yoshitsune"].display.src`，得到 `/assets/demons/display/yoshitsune.png`。

映射同时核对了游戏内英文角色名和 `DevilUIGraphicsTable`，不能直接把角色编号当成头像编号。`gameId` 和 `pictureId` 分别记录这两个编号。275 张图片均通过尺寸、文件校验值、像素无损和重复图片检查，无缺图。

使用本目录不需要启动 Steam、安装游戏或安装解码器。头像现已接入路线材料、消耗灵体和操作结果、准备材料表、目标选择、仲魔与灵体全书、侧栏预览及详情页。刷新工具页面即可显示。

来源与提取记录见 `../../../audit/game-avatar-extraction.md`。游戏美术版权归 ATLUS / SEGA，不属于项目数据的开源许可。
