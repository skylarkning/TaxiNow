# Contribute to TaxiNow Pro / 参与贡献指南

I welcome bug reports, feature ideas, testing feedback, documentation suggestions,
and help improving TaxiNow Pro. Read [LICENSE](LICENSE) and [EULA.txt](EULA.txt)
before modifying or reusing any material. Public source access does not grant
unrestricted modification or redistribution rights. For code, documentation,
or translation changes, discuss your proposal with me first and obtain the
written permission required by the license before making or publishing changes.

## Report a bug or suggest a feature

1. Search [existing issues](https://github.com/skylarkning/TaxiNow/issues) for the same problem or idea.
2. Use the [bug report or feature request form](https://github.com/skylarkning/TaxiNow/issues/new/choose).
3. For a bug, include the TaxiNow Pro version/build, simulator and Windows versions,
   airport ICAO if relevant, steps to reproduce, and expected versus actual behavior.
   Screenshots or relevant log excerpts help; remove account details, tokens, and personal information.
4. For a feature, explain the flight-simulation use case and the improvement you would like to see.

For a security vulnerability, contact me directly if the report contains sensitive
details. You can also open a GitHub issue for a non-sensitive report; avoid
publishing credentials or exploit details that expose other users.

## Propose a change

After I confirm the scope and the required permission:

1. Follow the [build guide](docs/BUILDING.md) to set up the Windows environment.
2. Work on a descriptive branch and keep the change focused on the agreed issue.
3. Run `./scripts/build.ps1 -Configuration Release` for code changes. Add or update
   tests when needed to verify behavior. For documentation-only changes, check
   links and wording; an application build is unnecessary.
4. Check supported languages when changing interface text. Include before and after
   screenshots for visible interface changes.
5. Open a pull request explaining the problem, resulting behavior, related issue,
   and validation. I review proposed changes before merging them.

Preserve author credits, license notices, data attribution, and flight-simulation-only
warnings. Permission applies to the agreed scope; it does not authorize unrelated reuse.

## 中文

我欢迎问题报告、功能建议、测试反馈及文档改进建议。修改或复用任何内容前，
请先阅读[许可证](LICENSE)和 [EULA](EULA.txt)。源码公开不代表获得不受限制的修改或再分发权限。
代码、文档或翻译修改，请先与我讨论方案，并在修改或发布前取得许可证要求的书面许可。

### 报告问题与提出建议

1. 先搜索[已有 Issues](https://github.com/skylarkning/TaxiNow/issues)，避免重复。
2. 使用[问题报告或功能建议表单](https://github.com/skylarkning/TaxiNow/issues/new/choose)。
3. 问题报告请提供软件版本及 Build、模拟器和 Windows 版本、相关机场 ICAO、复现步骤、
   预期结果及实际结果。可附截图或相关日志片段，并移除账户信息、令牌及个人信息。
4. 功能建议请说明模拟飞行使用场景和希望改善的体验。

安全漏洞涉及敏感细节时，请直接联系我。非敏感报告也可以提交 GitHub issue，
请避免公开凭据或可能危及其他用户的漏洞利用细节。

### 提交修改

在我确认范围并提供所需许可后，按照[构建指南](docs/BUILDING.md)准备环境，
在名称清晰的分支中完成约定修改。代码修改请运行
`./scripts/build.ps1 -Configuration Release`，并按需要补充或更新测试。
仅修改文档时，检查链接和措辞即可。界面修改请检查支持的语言，并附前后截图。

提交 PR 时，请说明问题、修改后的行为、关联 Issue 和验证结果。我会审核后再决定合并。
请保留作者署名、许可证声明、数据来源标注及仅供模拟飞行的提示。
