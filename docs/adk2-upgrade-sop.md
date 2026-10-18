# cofacts.ai ADK 2 升級 SOP

拆成兩個 PR，依序上線：

| PR                                                                                                                         | 內容                                                                                                                                                   | DB 影響                        |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| **PR A：升級 ADK**（[#163](https://github.com/cofacts/ai/pull/163)，base `master`）                                        | `google-adk` 1.26.0 → 2.12.0、`openinference-instrumentation-google-adk` 0.1.24 → 1.0.4，writer 維持 Gemini；**還需要加上** preview 改用獨立 DB（1.2） | 有（見下方）                   |
| **PR B：writer 換 Claude Haiku 5.5**（[#162](https://github.com/cofacts/ai/pull/162)，base `claude/adk-2-upgrade` = #163） | `anthropic[vertex]`、`Claude(...)` writer、`writer_request.py`、移除 writer 看圖                                                                       | 無（PR A 上線後兩邊都是 2.12） |

測試依據：`TEST-ENV-adk2.md`（production `adk` dump 實測）。

---

## 0. 背景：preview 一打開，production 會不會立刻壞？

**不會立刻全壞，但會「一個一個 session 壞掉」。**

- 2.12 第一次存取 DB 時只做一件事：新增 index `idx_events_app_user_session_ts_id`（實測 0.19 秒）。1.26 不受這個 index 影響，production 照常運作。
- 會壞的是 **2.12 寫入過的 session**：2.12 寫的每個 event 都帶 `node_info`，1.26 讀到就整個 session 開不起來（`ValidationError: node_info — Extra inputs are not permitted`）。
- 「寫入」不只聊天：在 preview **重新命名 session**（`PATCH /sessions/{id}` 也會寫一個 event）同樣會讓該 session 在 production 開不起來。
- 只是在 preview 瀏覽 session 列表、點開舊 session 看，不會寫入，不會壞。
- 在 preview 新開的 session 會出現在 production 的列表裡，但在 production 點開會失敗。

### 目前有三個地方共用同一個 `adk` DB

| 環境                       | 跑在哪裡                                                                                       | 什麼時候換版                  |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------- |
| `cofacts.ai`（production） | GCE `cofacts-prod` 的 docker compose（`rumors-deploy-adk-1`），經 Cloudflare production tunnel | 手動 `docker compose pull/up` |
| `dev.cofacts.ai`           | Cloud Run `cofacts-ai`（`asia-east1`），master push 後 100% 流量                               | merge 到 master 自動部署      |
| PR preview                 | 同一個 Cloud Run service 的 `pr-<N>` tag 版本                                                  | PR open / push 自動部署       |

三者目前用的都是 `industrious-eye-145611:asia-east1:cofacts` 的 `adk` 資料庫。除了 preview，**merge 之後到 GCE 換版之間**，`dev.cofacts.ai`（2.12）和 `cofacts.ai`（1.26）也會混用。

**本 SOP 的做法：Cloud Run 上的所有部署（`dev.cofacts.ai` 與 PR preview）都改用 `adk_staging`，只有 GCE production 接 `adk`。** 這樣 preview 與 dev 都碰不到 production 資料，merge 後的混用期間也消失。

---

## Phase 1：準備（PR A merge 前，可隨時做）

### 1.1 建立 Cloud Run 專用的資料庫 `adk_staging`（clone production 資料）

`dev.cofacts.ai` 與 PR preview 共用。用 production 資料的副本，才測得到「在舊 session 上繼續使用」。

注意：dev 與各個 PR preview 共用 `adk_staging`，彼此之間仍可能有版本相容問題（例如某個 PR 升級了 ADK，它寫過的 session 在 dev 開不起來）。這只影響測試資料，必要時重做 1.1 即可。

```bash
PROJECT=industrious-eye-145611
BUCKET=<暫存用 bucket>   # Cloud SQL 的 SA 要有寫入/讀取權限：
# gcloud sql instances describe cofacts --project=$PROJECT --format='value(serviceAccountEmailAddress)'

# 1. 建立空的資料庫
gcloud sql databases create adk_staging --instance=cofacts --project=$PROJECT

# 2. 匯出 production adk（--offload：由臨時執行個體匯出，不吃 production 資源）
gcloud sql export sql cofacts gs://$BUCKET/adk-preview-seed.sql.gz \
  --database=adk --offload --project=$PROJECT

# 3. 以 app 的 IAM 使用者匯入，資料表的 owner 才會是 app 角色
gcloud sql import sql cofacts gs://$BUCKET/adk-preview-seed.sql.gz \
  --database=adk_staging --user="cofacts-ai@industrious-eye-145611.iam" --project=$PROJECT

# 4. 刪除暫存檔（含使用者對話內容）
gcloud storage rm gs://$BUCKET/adk-preview-seed.sql.gz
```

為什麼要指定 `--user`：dump 不含 `OWNER TO`，資料表會屬於匯入的使用者；ADK 2.12 啟動時要在 `events` 上建 index，**必須是資料表 owner**，否則 preview 會出現 `must be owner of table events`。

確認（Cloud SQL Studio，`adk_staging`）：

```sql
SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public';
-- owner 應為 cofacts-ai@industrious-eye-145611.iam
SELECT count(*) FROM sessions;   -- 與 production 相近
```

若 `--user` 匯入失敗而改用預設使用者匯入，事後用 `postgres` 補（`postgres` 需先能代表該角色）：

```sql
GRANT "cofacts-ai@industrious-eye-145611.iam" TO postgres;
ALTER TABLE sessions, events, app_states, user_states, adk_internal_metadata
  OWNER TO "cofacts-ai@industrious-eye-145611.iam";
```

> 這是匯出當下的快照，之後 production 的新對話不會同步過去。要更新就 `DROP DATABASE adk_staging` 後重做一次。

### 1.2 在 PR A 修改 `.github/workflows/deploy.yml`，讓 Cloud Run 用 `adk_staging`

Cloud Run 只服務 `dev.cofacts.ai` 與 PR preview，所以不分 event 一律改接 `adk_staging`。在 `Generate Service YAML` step 的 `run:` 開頭加入（`DATABASE_URL` secret 的格式是 `postgresql+asyncpg://<sa>%40<project>.iam@localhost/adk`）：

```bash
# Cloud Run serves dev.cofacts.ai and PR previews only; production (cofacts.ai)
# runs on GCE with its own DATABASE_URL. Keep Cloud Run off the production DB.
export DATABASE_URL="${DATABASE_URL%/adk}/adk_staging"
```

更乾淨的做法是直接把 GitHub secret `DATABASE_URL` 改成 `.../adk_staging`，workflow 就不用改。但 secret 的值看不到，之後容易誤會它接的是 production，所以建議用上面明寫在 workflow 的方式。

- 這個修改以 commit 加進 **#163**。push 後 #163 會重新部署 preview，此時就會用 `adk_staging`（workflow 用的是 PR branch 上的檔案）。
- **#162 要先 rebase 到新的 #163 上**才能 push，否則 #162 branch 上的 `deploy.yml` 還是舊的，preview 會接 production DB。
- 1.1 要比這個 push 先做，否則 preview 啟動時會連不到 `adk_staging`。
- 已經部署的 `pr-163`、`pr-162` preview 會在這次 push / rebase 後重新部署，自動改接 `adk_staging`，不需要另外處理。

### 1.3 PR A（#163）目前內容

- 已完成：`adk/pyproject.toml`、`adk/uv.lock`（`sqlalchemy`、`asyncpg` 仍直接列出，2.x 把 SQLAlchemy 移到 `[db]` extra，不會缺套件）
- 待加入：1.2 的 `deploy.yml` 修改
- 已在測試環境驗證（production dump 副本、Gemini writer）：舊 session 續聊、完整查核流程（約 3 分鐘）都正常，設定 `GCS_ARTIFACT_BUCKET` 時 GCS artifact 套件可正常載入並被呼叫（測試用的是不存在的 bucket，實際寫入要在 preview 確認）

**不要**放 Claude writer 相關改動。

### 1.4 確認 production 目前狀態（baseline）

Cloud SQL Studio，`adk` 資料庫，先 `SET ROLE "cofacts-ai@industrious-eye-145611.iam";`：

```sql
SELECT * FROM adk_internal_metadata;                          -- 應為 schema_version | 1
SELECT count(*) FROM events WHERE event_data ? 'node_info';   -- 應為 0（尚未被 2.x 寫入）
SELECT indexname FROM pg_indexes WHERE tablename = 'events';  -- 只有 events_pkey
```

如果 `node_info` 不是 0，代表已經有 2.x 寫入，先跑 [Phase 4 的清理 SQL](#41-清除-node_info)。

### 1.5 確認 GCE production 的 image 來源

devops 文件沒有寫 `cofacts-prod` 上 ADK image 的實際 tag 與更新方式（`rumors-deploy` 的 sample 是 `cofacts/adk:latest`，實際的 `docker-compose.yml` 被 gitignore）。上線前先確認：

```bash
gcloud compute ssh cofacts-prod --tunnel-through-iap --project=industrious-eye-145611 --zone=asia-east1-b
cd /srv/rumors-deploy
docker inspect rumors-deploy-adk-1 --format '{{.Config.Image}}'
docker compose config | grep -A3 -E '^  (adk|cofacts-ai):'
```

記下：

- 目前 image 與 tag：`______________`（rollback 要用）
- 新版 image 從哪裡來（GitHub Actions 推到 Artifact Registry 的 `backend:<sha>`？還是另外 build？）：`______________`

---

## Phase 2：PR A preview 測試

1. 1.2 的 commit push 到 #163 後，等 Deploy workflow 完成。
2. 在 workflow log 的 `Generate Service YAML` 輸出中確認 `DATABASE_URL` 結尾是 **`/adk_staging`**。
   **不是的話立刻停止，不要打開 preview。**
3. 確認 production DB 沒有被碰到（Cloud SQL Studio，`adk`）：
   ```sql
   SELECT count(*) FROM events WHERE event_data ? 'node_info';   -- 仍為 0
   ```
4. 打開 preview（`https://pr-<N>---<service-url>`），用 GitHub 登入，測：
   - **打開升級前的舊 session 並續聊**（`adk_staging` 是 production 副本，用平常的帳號登入就看得到自己的舊對話）
   - 開新對話，貼一則 `https://cofacts.tw/article/<id>` 跑完整查核（約 5 分鐘）
   - 重新整理後 session 還在、標題還在
   - 圖片類文章
   - 👍/👎 回饋能存
5. 看 Cloud Run log 有無錯誤：
   ```bash
   gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="cofacts-ai" AND severity>=ERROR' \
     --project=industrious-eye-145611 --freshness=1h --limit=50
   ```
6. 確認 `adk_staging` 有資料，`adk` 仍無 `node_info`：
   ```sql
   -- 在 adk_staging
   SELECT count(*), count(*) FILTER (WHERE event_data ? 'node_info') FROM events;
   ```

---

## Phase 3：PR A 上線

選一個流量低的時段。Merge 後 Cloud Run（`dev.cofacts.ai`）會自動換成 2.12，但它接的是 `adk_staging`，不影響 production。GCE 換版的時間可以自己挑。

### 3.1 Merge PR A

等 GitHub Actions 的 Deploy（master）完成。

### 3.2 更新 GCE production

依 1.5 確認的方式更新 ADK image，例如：

```bash
gcloud compute ssh cofacts-prod --tunnel-through-iap --project=industrious-eye-145611 --zone=asia-east1-b
cd /srv/rumors-deploy
# 修改 docker-compose.yml 中 adk 的 image tag（若是 :latest 則直接 pull）
docker compose pull adk
docker compose up -d adk
docker compose ps adk            # 等到 healthy
```

### 3.3 驗證

```bash
# ADK log（devops GCE.md）
gcloud logging read 'logName="projects/industrious-eye-145611/logs/gcplogs-docker-driver" AND jsonPayload.container.name="/rumors-deploy-adk-1"' \
  --project=industrious-eye-145611 --limit 50 --format="value(jsonPayload.message)"
```

Cloud SQL Studio（`adk`）：

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'events';  -- 多了 idx_events_app_user_session_ts_id
SELECT count(*) FROM events WHERE event_data ? 'node_info';   -- 開始有新對話後會增加
```

到 `https://cofacts.ai`：

- 打開 **升級前** 的舊 session，能正常顯示並續聊
- 開新 session 跑一次完整查核

---

## Phase 4：PR A rollback（需要時）

### 4.1 清除 `node_info`

先把 GCE 與 Cloud Run 都換回舊版（GCE 用 1.5 記下的 image；Cloud Run revert PR A 的 merge commit 讓 Deploy 重跑），**然後**在 `adk` 執行：

```sql
SET ROLE "cofacts-ai@industrious-eye-145611.iam";
UPDATE events SET event_data = event_data - 'node_info' WHERE event_data ? 'node_info';
```

- 順序很重要：先停掉 2.12 再清，否則 2.12 會繼續寫入新的 `node_info`。
- `model_version`、`error_message` 兩個 key 1.26 本來就認得，不用清。
- 新增的 index 不用刪，1.26 不受影響。
- 實測：清除後 1.26 可讀取全部 424/424 個 session（含 Claude writer 寫入過的 session）。

---

## Phase 5：PR B（writer 換 Claude Haiku 5.5）

PR A 穩定後再做。此時所有環境都是 2.12，preview 也已經用 `adk_staging`，不再有 DB 相容問題。

### 5.1 上線前

- [x] Vertex AI Model Garden 已在 `industrious-eye-145611` 啟用 Claude Haiku 5.5（測試期間已完成）
- [ ] 確認 GCE 的 `env-files/adk` 與 Cloud Run 的 `GOOGLE_CLOUD_LOCATION` 為 `global`，`GOOGLE_CLOUD_PROJECT=industrious-eye-145611`
- [ ] 確認 GCE 上 ADK 使用的 SA 有 `roles/aiplatform.user`（Claude 也走 Vertex AI）
- [ ] Langfuse：新增 `claude-haiku-5-5` 的 model 定價（`input`、`input_cached_tokens`、`output`、`output_reasoning`；100K tokens 以上另一組價格），否則成本會顯示 $0
- [ ] 建議在 PR B 一起處理：writer instruction 加上「使用繁體中文（台灣）回覆」（實測曾出現簡體字）

### 5.2 PR B preview 測試

同 Phase 2（確認 `DATABASE_URL` 是 `/adk_staging`），另外測：

- 圖片類文章（writer 看不到圖，應轉交 verifier）
- 對話中上傳檔案（不應讓 session 卡死）
- Langfuse trace 的 model 顯示 `claude-haiku-5-5` 且有成本

注意：writer 設定 `max_tokens=32000`，**非 streaming 的 `/run` 會失敗**（`Streaming is required for operations that may take longer than 10 minutes`）。前端用 `/run_sse` 不受影響；若有 eval 或腳本呼叫 `/run`，要改用 `/run_sse`。

### 5.3 上線與 rollback

上線同 Phase 3（merge → 換 GCE）。Rollback 只需 revert PR B 並重新部署，不用動 DB。

已在測試環境驗證：把 Claude writer 跑過完整查核的 session，交給 #163（Gemini writer）續聊，回覆與工具呼叫都正常。

---

## 附錄：本 SOP 未能確認的事項

- GCE `cofacts-prod` 上 ADK 實際使用的 image 與更新流程（1.5，我這邊沒有 GCP 權限可以登入查看）
- `gcloud sql import sql --user=<IAM 使用者>` 對 IAM 使用者是否可行（不行就照 1.1 的備案改 owner）；若 preview 啟動時出現 `permission denied for schema public`，在 `adk_staging` 補 `GRANT ALL ON SCHEMA public TO "cofacts-ai@industrious-eye-145611.iam";`
