# Cofacts AI 週會回顧：2026/5/22 – 6/2

> 資料來源：Langfuse (`langfuse.cofacts.tw`) sessions / traces / scores + git commit 歷史
> 期間：2026-05-22 ～ 2026-06-02

## 一、整體使用狀況

| 指標 | 數量 |
|------|------|
| Sessions | **55** |
| Traces | **115** |
| 使用者 feedback（`user-thumbs`）| **31**（扣除 3 筆測試 → 實質 **28**）|
| 👍 正面 | 13（實質 10）|
| 👎 負面 | 18 |

**每日 trace 分布**

```
5/22 ████████████ 12
5/23 ████████████████ 16
5/24 ████████████████ 16
5/25 █ 1
5/27 ██████████ 10
5/28 ██ 2
5/29 █ 1
5/30 ████████ 8
5/31 ███████████████████████████████████████████ 43   ← dogfooding 高峰
6/01 ██████ 6
```

> 5/31 是密集 dogfooding 日（43 traces、11 筆 feedback），也直接催生了 6/1 的大改版。

---

## 二、Prompt 迭代時間軸 vs. Feedback

下面把這兩週的 prompt 改動分成 6 個階段，並對應到「**觸發改動的 feedback**」與「**改動後的 feedback**」。整段期間呈現一條清楚的主線：**verifier / 出處可信度** 問題反覆出現，prompt 一路被收緊。

### 🟠 階段 0：基線（~5/23 下午前）

**這段期間的 feedback（全是負面，集中在影片）**
- 👎「verifier 沒看到 youtube short 內容，100% 完全錯誤」
- 👎「verifier does not respond」（×2）
- 👎「兩個影片明顯是同時拍攝，卻錯誤回報說兩則影片是 2024 年的，完全誤導 AI writer」
- 👎「建議往個人意見的方式說明，畢竟是醫療建議」
- 👍「語氣適合」

➡️ **直接催生 → 階段 1**：verifier 根本「看不到」YouTube 影片內容，只讀到 HTML，導致對影片的判斷全錯。

### 🟡 階段 1：YouTube 原生影片理解（5/23 18:03 – 5/24）

| commit | 內容 |
|--------|------|
| `3d68a5c` | verifier 將 YouTube URL 以 **FileData** 注入，讓 Gemini 直接「看」影片 |
| `15adc24` / `9d2f4ad` | 擴充 YouTube regex（`/shorts/`、`/live/`、`/embed/`、`/v/`）|
| `7c0b106` | 防止 training knowledge 滲漏與捏造引用 |
| `c17c19f` | FileData 注入同一個 user message |
| `d704bf7` | 中立影片 metadata 報告；investigator 也注入 FileData |

**改動後 feedback**
- 👍「可以被指正」👍「出處精準」👍「具有說服力」
- 👎「提供不存在的出處」 ← 引用捏造問題仍在

### 🟢 階段 2：強制 url_context + 三層報告（5/25）

| commit | 內容 |
|--------|------|
| `f5aed77` | YouTube URL **強制呼叫 url_context** 以取得 `uploadDate` |
| `f3700de` | verifier instruction 重構為「**三層報告**」：①頁面 metadata（uploadDate 必需）②上傳者 metadata ③影片可觀察內容 |

> 理由：舊影片可能被重新上傳，`uploadDate` 是判斷年份的唯一信號（呼應階段 0「2024 年」誤判）。

### 🔵 階段 3：模型 GA 升級（5/27）

| commit | 內容 |
|--------|------|
| `934ed37` | 4 個 proofreader 從 `gemini-3.1-flash-lite-preview` 換成 GA 版 `gemini-3.1-flash-lite` |

**這段期間 feedback（升級前的舊 prompt）**
- 👎「Verifier 沒有驗證影片和標題的相關性」
- 👎「叫 investigator 去看影片上傳日，但 **investigator 沒有 url context tool**」 ← 工具能力錯配
- 👎（無註解）

### 🟣 階段 4：型別/容錯強化（5/30 – 5/31）

| commit | 內容 |
|--------|------|
| `6f69093` | writer 加 `on_tool_error_callback`，工具失敗不再讓整輪崩潰 |
| `7bb9536`* | grounding metadata 改可選 |
| `299eb84` | 強化 `inject_youtube_filedata` |

**這段期間 feedback（5/31 dogfooding 高峰）**
- 👎「**回應文字與出處不符**」（×3）
- 👎「出處不足，claim 一大堆，就是只回 5 個出處？另外兩個 AI 找了那麼多出處，為何搞到 source 無法 fully cover claim？」
- 👎「沒用 verifier 查原始影片」
- 👍「出處精準」👍「出處精準/具有說服力/語氣適合/篇幅適中」（4 項全勾）

➡️ **直接催生 → 階段 5**：核心問題從「影片看不看得到」轉移到「**writer 引用了未經 verifier 確認的出處 / 出處 cover 不了所有 claim**」。

### 🔴 階段 5：Writer 紀律改革 + 出處覆蓋強制（6/1）★ 本期最重要

| commit | 內容 |
|--------|------|
| `7931d10` | **改善 writer orchestration 紀律 + source-coverage 強制**：`draft_factcheck_response` 新增 `claim_sources`，每個 claim 須對應 `source_url` 且 `verifier_confirmed=true` |
| `c33789b` | `claim_sources` URL 改為與 reference URL **精確比對**（非 substring）|
| `57934a8` | 放寬：允許平行呼叫工具，但**禁止 draft 與其他工具同輪** |
| `107743a` | 把 Working Discipline 規則收進單一 Orchestration Process |
| `0cb1a8a` | `grounding_supports` 從「證據」降級為「吵雜的候選提示」 |
| `adf784d` | **完全移除** investigator 輸出中的 `grounding_supports` |
| `b9d73d7` | 「Track editorial constraints」改用領域中立範例，避免 overfit |

**新增的核心紀律**：先看源再研究、維護 editorial constraints 清單、**沒有 verifier ✓ 的 claim 不准寫進 draft**、不准對已標 ✗ 的 claim 重送同一 URL。明確區分 **Investigator DISCOVERS vs. Verifier CONFIRMS**。

> `grounding_supports` 被移除的依據：Google grounding 嚴重過度歸因（平均 4.5 來源/句、最高 9 個），被過度引用的 claim 往往正是 verifier 最後標 ✗ 的 → 只有真的讀過頁面的 verifier 才是引文真正來源。

**改動後 feedback（全部正面，且直接點名新流程）**
- 👍「出處精準 — 1. Verifier is called at the first place 2. investigate & proofreader first 3. all claims are included in sources」
- 👍「具有說服力 — Nice use of verifier & proof readers」
- 👍「先選擇請 proofreader 再 investigate 滿好的」

✅ 三筆改版後 feedback 全為正面，且明確稱讚「verifier 先行」「所有 claim 都被出處覆蓋」——正是這次 prompt 改動的設計目標。

---

## 三、Feedback 主題彙整（實質 28 筆）

| 主題 | 出現次數 | 對應的 prompt 回應 |
|------|---------|-------------------|
| Verifier 看不到/沒驗證影片 | 5 | 階段 1 FileData 注入、階段 2 url_context |
| 影片日期誤判 | 1 | 階段 2 強制 uploadDate |
| 提供不存在/不符的出處 | 4 | 階段 5 `claim_sources` + verifier_confirmed gate |
| 出處覆蓋不足（claim 多、source 少）| 1 | 階段 5 source-coverage 強制 |
| 工具能力錯配（investigator 無 url_context）| 1 | 流程釐清 discover vs confirm |
| 語氣/篇幅/說服力正面肯定 | 多筆 👍 | — |

---

## 四、給週會的三個 takeaway

1. **問題重心已經轉移**：從「agent 能不能看到影片」（5/23–5/27）演進到「writer 會不會亂引用出處」（5/31–6/1）。Prompt 也從「擴充能力」轉向「**強制紀律 / 驗證閘道**」。
2. **6/1 大改版見效**：改版前 5/31 出現密集的「出處不符 / 覆蓋不足」負評；改版後同類 session 全數轉正，且使用者明確點名新流程的優點。
3. **feedback → prompt 的閉環很健康**：幾乎每一波負評都能對應到 24–72 小時內的具體 prompt commit，dogfooding 的回饋確實在驅動迭代。

---

### 附錄：完整 feedback 清單（依時間）

| 時間 | 評價 | Session | 註解 |
|------|:---:|---------|------|
| 5/22 15:27 | 👍 | 2ed734c7 | 語氣適合（測試）|
| 5/23 03:55 | 👎 | b66074f7 | 出處不足/資訊錯誤（測試）|
| 5/23 04:07 | 👍 | 3c245461 | test up（測試）|
| 5/23 05:25 | 👎 | b5d83023 | verifier 沒看到 youtube short，100% 錯誤 |
| 5/23 05:36 | 👎 | b5d83023 | — |
| 5/23 05:38 | 👎 | b5d83023 | verifier does not respond |
| 5/23 05:38 | 👎 | b5d83023 | verifier does not respond |
| 5/23 05:39 | 👎 | b5d83023 | 兩影片同時拍卻報 2024，誤導 writer |
| 5/23 15:26 | 👎 | 289c50f8 | 醫療建議宜以個人意見方式說明 |
| 5/23 15:34 | 👍 | 5ff85787 | 語氣適合 |
| 5/24 02:27 | 👍 | b5d83023 | 可以被指正 |
| 5/24 15:10 | 👍 | e5749a8b | 出處精準 |
| 5/24 15:39 | 👍 | 9143f84d | 具有說服力 |
| 5/24 15:48 | 👎 | 6d81a32b | 提供不存在的出處 |
| 5/27 12:47 | 👎 | da1c2dce | verifier 沒驗證影片和標題相關性 |
| 5/27 12:52 | 👎 | da1c2dce | investigator 沒有 url context tool |
| 5/27 13:02 | 👎 | da1c2dce | — |
| 5/29 10:31 | 👍 | 8ba804f0 | 語氣適合 |
| 5/30 06:50 | 👎 | fcb16d6f | （空）|
| 5/31 04:56 | 👎 | 240aa16e | 沒用 verifier 查原始影片 |
| 5/31 05:25 | 👍 | 02d6a67e | 出處精準 |
| 5/31 05:34 | 👎 | 33f80fed | （空）|
| 5/31 06:39 | 👍 | 88a2af3c | 出處精準/說服力/語氣/篇幅 |
| 5/31 07:42 | 👍 | 040960fb | — |
| 5/31 13:48 | 👎 | ebc732b2 | 回應文字與出處不符 |
| 5/31 13:48 | 👎 | ebc732b2 | 回應文字與出處不符 |
| 5/31 14:05 | 👎 | 1878006f | 回應文字與出處不符 |
| 5/31 14:54 | 👎 | 2d97c04f | 出處不足，claim 多卻只回 5 個出處 |
| 6/01 15:12 | 👍 | 8d667352 | Verifier 先行、all claims included in sources |
| 6/01 15:14 | 👍 | 09d18a1b | Nice use of verifier & proof readers |
| 6/01 15:15 | 👍 | d6d291df | 先 proofreader 再 investigate 滿好的 |
