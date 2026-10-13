# Contribute to TaxiNow Pro / 参与贡献指南

I welcome bug reports, feature ideas, testing feedback, documentation suggestions,
and direct code contributions. You can get involved by forking TaxiNow Pro,
making a focused change, and submitting a pull request (PR).

I permit forks and changes solely for preparing and submitting contributions
to this repository. This permission does not authorize unrelated reuse or
redistribution; read [LICENSE](LICENSE) and [EULA.txt](EULA.txt) for other uses.

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

For larger changes, open an issue first so we can discuss the approach before
you spend time implementing it. For a focused fix, you can submit a PR directly.

1. Fork this repository to your GitHub account, clone your fork, and follow the
   [build guide](docs/BUILDING.md) to set up the Windows environment.
2. Create a descriptive branch in your fork and keep the change focused.
3. Run `./scripts/build.ps1 -Configuration Release` for code changes. Add or update
   tests when needed to verify behavior. For documentation-only changes, check
   links and wording; an application build is unnecessary.
4. Check supported languages when changing interface text. Include before and after
   screenshots for visible interface changes.
5. Push your branch to your fork and open a PR against this repository's `main`
   branch. Explain the problem, resulting behavior, related issue if any, and
   tests you ran. I review proposed changes before merging them.

Preserve author credits, license notices, data attribution, and flight-simulation-only
warnings.

## AI-assisted contributions

Using AI tools is fine. You are responsible for everything you submit: you must
understand the changes, fully test them for their intended behavior and affected
scenarios, and be able to explain how and why they work. Review AI-generated
code yourself and include the actual testing you performed in the PR.

Pure AI slop and blind vibe coding are not encouraged. Submitting generated
changes you cannot explain or have not tested wastes review effort. AI assistance
does not replace your judgment or responsibility for the contribution.

## Respect review time

Keep submissions focused and respond constructively to feedback. I reserve the
right to close abusive or spam submissions and block someone's access to this
repository if they abuse it, including through repeated unreviewed, untested,
or low-effort AI-generated PRs that waste review effort.

## 中文

我欢迎问题报告、功能建议、测试反馈、文档改进及直接的代码贡献。
你可以 fork TaxiNow Pro，在自己的分支中完成修改，然后提交 pull request（PR）。

我允许以向本仓库准备和提交贡献为目的进行 fork 和修改。
这项许可不授权无关的复用或再分发；其他用途仍须遵守[许可证](LICENSE)和 [EULA](EULA.txt)。

### 报告问题与提出建议

1. 先搜索[已有 Issues](https://github.com/skylarkning/TaxiNow/issues)，避免重复。
2. 使用[问题报告或功能建议表单](https://github.com/skylarkning/TaxiNow/issues/new/choose)。
3. 问题报告请提供软件版本及 Build、模拟器和 Windows 版本、相关机场 ICAO、复现步骤、
   预期结果及实际结果。可附截图或相关日志片段，并移除账户信息、令牌及个人信息。
4. 功能建议请说明模拟飞行使用场景和希望改善的体验。

安全漏洞涉及敏感细节时，请直接联系我。非敏感报告也可以提交 GitHub issue，
请避免公开凭据或可能危及其他用户的漏洞利用细节。

### 提交修改

较大的改动请先提交 issue 讨论方案；范围明确的小修复可以直接提交 PR。
先 fork 本仓库并克隆自己的 fork，按照[构建指南](docs/BUILDING.md)准备环境，
然后创建名称清晰的分支完成修改。代码修改请运行
`./scripts/build.ps1 -Configuration Release`，并按需要补充或更新测试。
仅修改文档时，检查链接和措辞即可。界面修改请检查支持的语言，并附前后截图。

将分支推送到自己的 fork，然后向本仓库的 `main` 分支提交 PR，
说明问题、修改后的行为、关联 Issue（如有）和实际执行的测试。我会审核后再决定合并。
请保留作者署名、许可证声明、数据来源标注及仅供模拟飞行的提示。

### AI 辅助贡献

可以使用 AI 工具，但你必须对提交的全部内容负责：理解每项修改，
充分测试预期行为及受影响的场景，并能够解释为什么这样改、修改如何工作。
请自行审查 AI 生成的代码，并在 PR 中写明实际执行的测试。

不鼓励提交纯粹的 AI slop，也不鼓励盲目的 vibe coding。
提交自己无法解释或没有测试过的生成内容，会浪费审核精力。
使用 AI 不能替代你的判断，也不能免除你对贡献的责任。

### 尊重审核精力

请保持提交范围清晰，并建设性地回应反馈。如果有人滥用仓库，
包括反复提交未经自行审查、未经测试或低投入的 AI 生成 PR，浪费审核精力，
我保留关闭滥用或垃圾提交、以及封禁其仓库访问的权利。
