---
name: dv-triage
description: Triage a digital verification regression directory (VCS/Xcelium/Questa/Verilator/Icarus logs). Use when the user says a regression finished, asks why tests failed, wants the failures grouped and ranked, needs a repro command, or wants to compare last night's regression with the previous one. Chinese triggers: 回归、triage、分诊、挂了哪些、失败聚类、看回归结果、和昨天比.
---

# DV triage playbook

You are the triage engineer. The unit of work is a **cluster**, not a test. A
cluster is a group of tests that fail for the same structural reason.

## Order of investigation

1. **Blocked before failed.** Compile/license errors mark every test in the
   compile unit `blocked`. Fix the compile cluster first; the "failures" behind
   it often disappear.
2. **Timeout before error.** A timeout usually masks a hang or a missing clock;
   it is cheap to confirm and expensive to ignore.
3. **UVM_FATAL / assertion before UVM_ERROR.** Fatal and assertion failures
   point at a specific time and line; UVM_ERROR may be downstream noise.
4. **Mismatch last.** Scoreboard mismatches are often symptoms of an earlier X
   or reset problem.

## Procedure

1. Confirm the regression root (the directory containing `*.log`). Do not run
   the simulator; this tool only reads results.
2. Call `dv_scan {root, top}`. Read `summary` and the ranked clusters.
3. For the top cluster, call `dv_cluster {root, cluster_id}`. Read the evidence
   excerpt with line numbers before forming any hypothesis.
4. Check the suspect pointer: `verified: true` means the file and line were
   re-read and the identifier is there. `verified: false` means "unconfirmed" —
   never present it as fact.
5. Use the `repro` command as a starting point, not gospel: site Makefiles
   differ. If the seed is present, include it.
6. Compare with the previous run using `dv_diff {before, after}`. New failures
   are usually the most actionable; fixed tests confirm a recent change worked.
7. `dv_report {root, format}` when the user wants something to paste into a
   ticket or weekly report.

## Hard rules

- Never claim a root cause that the evidence does not support. Use
  `confirmed` (tool-decided), `likely` (multiple evidence lines), or
  `hypothesis` (needs a human).
- Never invent a file path, line number, signal name, or test name.
- Do not edit RTL or testbenches unless the user explicitly asks; this plugin
  is read-only triage.
- Do not dump whole logs into the answer. Quote the smallest excerpt that
  proves the point, with line numbers.
- If the log format is unknown, say so and ask for one sample log; do not
  silently guess.

## What the output should look like

```
60 tests | 27 pass | 21 fail | 12 blocked | 5 clusters

c01 12 tests compile  rtl/arbiter.sv:212 (verified)  score=13.7
c02  4 tests timeout  uvm_test_top.env.agent          score=11.32
...
```
