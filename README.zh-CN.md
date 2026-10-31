<p align="center"><img src="frontend/src/assets/brand/meowdiobooks-social.png" alt="Meowdiobooks" width="100%"></p>

<p align="center"><strong>让书中的角色，拥有自己的声音。</strong><br>在 Mac 上，将 PDF、EPUB 和文本制作成多角色有声书。</p>

<p align="center"><a href="README.md">English</a> · 简体中文<br><a href="#试听">试听</a> · <a href="#看看界面">界面</a> · <a href="#按你的喜好配置">模型</a> · <a href="#安装">安装</a> · <a href="docs/README.md">文档</a> · <a href="#一起改进">社区</a></p>

Meowdiobooks 识别书中的对话，协助你整理角色，并为每个角色设计或克隆声音。
审核文本、试听声音后，即可生成章节，导出 M4B 或 MP3 有声书。声音制作在 Apple Silicon Mac 本地完成。

## 试听

**The Last Door**——一段 36 秒的场景，包含旁白、不同角色的声音和共同说出的台词。

https://github.com/user-attachments/assets/465134c0-cbe0-45bc-a1d1-16fab52ff70f

[下载音频](docs/demo/the-last-door.mp3) · [阅读台词](docs/demo/README.md)

## 看看界面

<p align="center"><img src="docs/assets/showcase/wizard-transcript-check.jpg" alt="书籍页面与文本并排显示，对话已分配给角色" width="100%"></p>

<table>
  <tr>
    <td width="50%">
      <img src="docs/assets/showcase/wizard-extract.jpg" alt="对照书籍原页检查提取的文本">
      <br><strong>从原文开始。</strong> 对照原页检查提取结果。
    </td>
    <td width="50%">
      <img src="docs/assets/showcase/wizard-voice-auditions.jpg" alt="为角色选择和试听声音">
      <br><strong>找到合适的声音。</strong> 设计、试听并确定角色的声音。
    </td>
  </tr>
</table>

<details>
<summary>查看深色模式工作室</summary>

<img src="docs/assets/showcase/studio-dark.jpg" alt="Meowdiobooks 深色模式工作室" width="100%">

</details>

*截图使用公版《爱丽丝梦游仙境》片段及演示数据。*

## 从书籍到有声书

- **导入书籍。** 支持 PDF、EPUB、TXT 和 Markdown。比较 PDF 文本提取方式，对照原文检查对话。
- **整理角色。** 审核建议的说话人，合并同一角色的名字和别名，为每个角色选择一致的声音。
- **设计声音。** 调整声音特征，或用一段音频克隆声音。确定角色声音前，可以先试听。
- **按自己的节奏完成。** 继续中断的音频生成，导出带章节的 M4B 或 MP3，在本地书库中保存成品。

## 按你的喜好配置

默认配置在 Mac 上运行书籍分析、声音设计、克隆和音频生成。
文本清理的“审核”步骤使用 OpenAI，需要你自己的 API 密钥；对话分析也可以选择 OpenAI。
这些云端步骤会向 OpenAI 发送书籍片段。书籍、声音样本、已接受的工作和导出文件保存在本地。

**使用自己的模型：** 在 [`models.toml`](models.toml) 中配置兼容的本地模型和受支持的服务提供方配置。
[模型指南](docs/MODELS.md) 介绍了下载、替换及兼容要求。无需 Meowdiobooks 账户或订阅。

### 使用前了解这几点

- 当前支持 **Apple Silicon Mac 上的 macOS**，本地模型需要手动安装。
- “审核”目前需要 **OpenAI API 密钥**。替换其他模型不会让这一步变为离线运行。
- 生成整本书前，请检查提取文本和说话人分配，尤其是复杂 PDF 或不常见的对话格式。
  详见[支持范围与审核限制](docs/KNOWN_GENERALIZATION_RISKS.md)。

## 安装

请准备 **18 GB 统一内存**、约 **30 GB 可用存储空间**，以及约 **15 GB 的模型下载空间**。
完整要求和故障排查见[安装指南](docs/SETUP.md)。

**1. 安装工具并构建应用。**

```bash
brew install python@3.12 uv node poppler ffmpeg
npm install --global @llamaindex/liteparse

git clone https://github.com/PetarKing/meowdiobooks.git
cd meowdiobooks
npm --prefix frontend ci
npm --prefix frontend run build
uv sync --extra mlx-runtime
```

**2. 配置模型和 API 密钥。** 按照[模型指南](docs/MODELS.md)安装本地运行时和模型文件。
在环境变量或被 Git 忽略的本地 `.env` 文件中设置 `OPENAI_API_KEY`，供“审核”使用。
上面的依赖安装命令不会下载模型。

**3. 检查配置并启动工作室。**

```bash
uv run meowdiobooks doctor
uv run meowdiobooks serve
```

`doctor` 检查通过后，启动服务并打开 **<http://127.0.0.1:8000>**。

## 一起改进

只要我们继续商业运营 Meowdiobooks，就会维护这个个人自托管版本，公开共享有声书工作流程的改进。
使用它始终无需 Meowdiobooks 账户或订阅。

欢迎提交问题报告、改进模型支持、完善文档和贡献代码。社区的改进可以惠及个人用户和付费用户，
我们对共用引擎的改进也会惠及双方。阅读[我们的承诺](docs/COMMUNITY.md)，或[参与贡献](docs/CONTRIBUTING.md)。

## 许可证

源码采用 [PolyForm Noncommercial 1.0.0](LICENSE) 许可证，可用于许可范围内的非商业用途。
商业使用需要另行获得许可。外部贡献适用[贡献者许可协议](CLA.md)。
