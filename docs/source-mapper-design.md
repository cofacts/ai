# Source Mapper：改善 Investigator 出處精確度

## 背景問題

Investigator 透過 Google Search grounding 取得出處，回傳的 `grounding_supports` 格式如下：

```json
{
  "segment": { "start_index": 160, "end_index": 207, "text": "### 一、龍葵鹼致死劑量" },
  "source_ids": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
}
```

問題：Google grounding 的粒度很粗，Section heading 等格式性文字也會被標上所有出處。Writer 拿到的是 n 個 claim × m 個 source URL 的 noisy mapping，無法判斷「哪個 claim 真正對應哪幾個出處」。

---

## 想法：Investigator 內建 Source Mapper

把 investigator 拆成兩個內部步驟，對外介面不變（writer 還是只看到一個 `investigator` tool）：

```
investigator (外殼)
  └── Step 1: Search Agent     → content + sources[] + grounding_supports (noisy)
  └── Step 2: Source Mapper    → 讀取所有 source URL，輸出精確的 claim × source mapping
  └── 合併輸出 → {content, sources, grounding_supports (精確版)}
```

### Source Mapper 的工作

輸入：
- 從 Step 1 的 `grounding_supports` 萃取的 claims（`segment.text` 清單）
- Step 1 的 `sources` URL 清單（最多 20 個）

Prompt 概念：
```
以下是需要確認的 claims：
0. "龍葵鹼致死劑量約為 3–6 mg/kg"
1. "1918 年蘇格蘭事件共 61 人中毒"
...

請讀取下列所有 URL，判斷每個 URL 的頁面內容是否直接支持上述 claims。
只在頁面內容明確包含對應資訊時才標記。

輸出 JSON：
{"mappings": [{"claim_idx": 0, "source_ids": [2, 5]}, {"claim_idx": 1, "source_ids": [0]}]}
```

輸出：精確的 n×m mapping，取代 Step 1 的 noisy `grounding_supports`。

---

## 可行性評估

### 優點

- **成本合理**：Source mapper 用 `url_context` 一次讀取最多 20 個 URL（一個 batch call），不是逐一 fetch
- **對外介面不變**：Writer 還是呼叫一個 `investigator`，不需要改 workflow
- **精確度提升**：LLM 自己讀頁面做 attribution 判斷，不依賴 Google grounding 的間接對應

### 設計問題

**1. Investigator 的外殼結構**

| 方案 | 描述 | 優缺點 |
|------|------|--------|
| 兩個 LlmAgent 包成 SequentialAgent | ADK 原生組合 | 輸出格式控制較難 |
| Custom Python function | 直接呼叫兩個 agent，手動合併輸出 | 可控但脫離 ADK agent 模型 |

**2. Source Mapper 的 callback**

Source mapper 不需要 `append_grounding_sources`（它不依賴 grounding metadata，而是讓 LLM 自己判斷）。需要一個不干擾 LLM JSON 輸出的 callback，或直接不掛 callback。

**3. 最終輸出格式**

Writer 收到的格式維持不變：
```json
{
  "content": "...",
  "sources": [{"title": "...", "url": "..."}],
  "grounding_supports": [
    {
      "segment": {"start_index": N, "end_index": N, "text": "..."},
      "source_ids": [2, 5]   ← 精確版，由 source mapper 產生
    }
  ]
}
```

---

## 開發計畫

- 在 `fix-made-up-sources` PR merge 後，開 stacking branch 實作
- 實作順序：source mapper agent → investigator 外殼重構 → 整合測試

---

## 未解問題

- Source mapper 讀 20 個 URL 的 latency 是否可接受？（目前 investigator 已有一定等待時間）
- Claims 數量若超過 20–30 個，prompt 是否太長？是否需要先篩選 claims？
- Investigator 的 `content` 來自 Step 1（LLM 摘要），Source mapper 確認的是「這些 URL 支持哪些 claims」，兩者的粒度需要對齊
