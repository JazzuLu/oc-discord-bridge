# Teams 迭代规约（Balanced）

目标：二者兼顾——每轮有可见产出，同时稳定推进代码。

## 硬规则

### 1) 每轮必须有产出（<=90s 内）
每个 tick 必须产出以下之一：
- A) 1 条 GitHub issue/comment（结论 + 下一步 + 链接）
- B) 1 个 commit + push（iter/* 分支）

### 2) 代码推进频率
每 3 轮至少 1 个 commit：1-3 / 4-6 / 7-9。

### 3) 两段式汇报（减少等待感）
- started：`[tick n/N] started · intent=issue|patch · ETA<60s`
- done：结果 + 链接 + next

### 4) 小步定义（commit 类）
- 改动文件 <= 3（除非纯重构/格式化）
- 不新增依赖（除非修 CI/ops 必需）
- 能跑 `pnpm build`（否则说明原因）

### 5) 失败即资产
卡住也必须落 1 条 issue/comment：复现 / 影响 / 修复建议。

## 输出格式（<=5 行）
```
[tick n/N] done
what: <1句话>
artifacts: <commit|branch|issue 链接>
next: <issue 链接>
notes: <可选，1行>
```
