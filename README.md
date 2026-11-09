# dsh-dv-triage · 回归分诊台

[![test](https://github.com/yyyyukari/dsh-dv-triage/actions/workflows/test.yml/badge.svg)](https://github.com/yyyyukari/dsh-dv-triage/actions/workflows/test.yml)

把一次回归的几千条日志，压成几个**带证据、可复现、排好序**的失败簇。

DSH 插件（bundle：5 个工具 + 1 个技能 + 一个独立 CLI）。只读回归结果目录，不启动仿真器、不修改 RTL、不替代 Verdi。

## 快速体验

```sh
cd dsh-dv-triage
node bin/dv-triage.js demo
```

会生成两天的合成回归（60 个 test）并输出：

```
60 tests | 27 pass | 21 fail | 12 blocked | 5 clusters | profile: vcs

c01   12 tests  compile · SE · arbiter.sv:212                          score=13.7  rtl/arbiter.sv:212 (verified)
c02    4 tests  timeout · TIMEOUT · uvm_test_top.env.agent             score=11.32  -
c03    5 tests  assertion · SVA · if.sv:42                             score=7.58  tb/if.sv:42 (verified)
c04    7 tests  uvm_error · X_PROP · uvm_test_top.env.scoreboard       score=7  -
c05    5 tests  mismatch · SCB_MISMATCH · uvm_test_top.env.scoreboard  score=6.58  -
```

同时写出 Markdown / HTML 报告，并演示 `diff`（新增 5 个失败、修复 1 个）。

## 安装到 DSH

```sh
dsh plugin --profile web add github:yyyyukari/dsh-dv-triage
# 重启 dsh web 或桌面端后，会话里可用 dv_* 工具与 dv-triage 技能
```

本地开发：

```sh
dsh plugin --profile web add D:\DS插件\dsh-dv-triage
```

先验证 profile 层：

```sh
dsh --profile web --dump-config | findstr dv-triage
```

## 工具

| 工具 | 作用 |
|---|---|
| `dv_scan {root, profile?, top?}` | 扫描回归目录，解析、聚类、排序，落索引；返回 run_id 与 top 簇 |
| `dv_clusters {root, run_id?, top?}` | 读取已落盘的 run，列出簇（可翻页） |
| `dv_cluster {root, cluster_id, run_id?}` | 单簇详情：证据日志行号、repro、fine 变体、已校验源码指针 |
| `dv_diff {before, after}` | 两次回归对比：新增失败 / 修复 / 持续失败 |
| `dv_report {root, format: md\|html, out?}` | 出报告 |

CLI 子命令：`demo`、`scan`、`clusters`、`cluster`、`diff`、`report`。

## 支持的日志

- VCS：`Error-[...]`、`"file.sv", 42: ...`、`UVM_ERROR/FATAL @ ...`、assertion 失败块
- Questa：`# ** Error/Fatal`、`# UVM_*`（去 `# ` 前缀后解析）
- Verilator：`%Error: file.sv:42: ...`
- Icarus：`file.v:42: error: ...`
- 自动探测；可用 `--profile` 强制

## 设计原则

1. **簇是工作单元。** 人一次修一个根因，不是一个 test。
2. **编译传染标 `blocked`。** 同一 compile unit 的 test 不再算 fail，避免 200 条假失败。
3. **证据优先。** 源码指针重新读文件校验；行不存在/标识符不在 → `unverified`，不当事实展示。
4. **确定性内核 + LLM 外壳。** 解析、归一化、聚类、排序全部可单测；模型只做解释。
5. **无证据就 `unknown`。**

## v0.1 限制

- 日志整文件读入，单文件上限 64 MiB；流式解析在 v0.2。
- 只发现 `*.log`；manifest/results.xml 在 v0.2。
- 不解析 FSDB；波形只记录路径（如有同名 `.vcd/.fst/.fsdb`），交给波形插件。
- 覆盖率关联（URG/LCOV/UCDB）在 v0.3。
- 排序里的 `novel/known` 字段已预留，尚未接 baseline。

## 开发

```sh
node --test          # 15 个测试
node bin/dv-triage.js demo
```

目录：

```
lib/index.js          插件入口（5 个工具）
lib/core/parse.js     日志解析（多行 assertion 块、UVM、编译错）
lib/core/normalize.js 归一化与分层签名
lib/core/cluster.js   聚类 + 证据 + 可疑源码
lib/core/rank.js      排序
lib/core/verify.js    源码指针校验
bin/dv-triage.js      CLI
scripts/make-demo.mjs 合成回归
skills/dv-triage/     技能（triage playbook）
```
