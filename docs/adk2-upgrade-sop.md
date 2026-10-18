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

# 2. 匯出 production adk（--offload：由臨時執行個體匯出，降低來源負載；有額外費用）
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
-- 只在 adk_staging 執行；逐表 ALTER，PostgreSQL 不接受逗號分隔多張表。
GRANT USAGE, CREATE ON SCHEMA public TO "cofacts-ai@industrious-eye-145611.iam";
ALTER TABLE public.sessions OWNER TO "cofacts-ai@industrious-eye-145611.iam";
ALTER TABLE public.events OWNER TO "cofacts-ai@industrious-eye-145611.iam";
ALTER TABLE public.app_states OWNER TO "cofacts-ai@industrious-eye-145611.iam";
ALTER TABLE public.user_states OWNER TO "cofacts-ai@industrious-eye-145611.iam";
ALTER TABLE public.adk_internal_metadata OWNER TO "cofacts-ai@industrious-eye-145611.iam";
-- 若本次才臨時授予角色，完成後 REVOKE 該角色 FROM postgres；不要移除原有授權。
```

> 這是匯出當下的快照，之後 production 的新對話不會同步過去。要更新時先停止所有連到 staging 的服務與背景工作，再由操作者確認備份及目標 DB，重建 staging；不要在服務仍連線時直接 DROP。

### 1.2 在 PR A 修改 `.github/workflows/deploy.yml`，讓 Cloud Run 用 `adk_staging`

Cloud Run 只服務 `dev.cofacts.ai` 與 PR preview，所以不分 event 一律改接 `adk_staging`。在 `Generate Service YAML` step 的 `run:` 開頭加入（`DATABASE_URL` secret 的格式是 `postgresql+asyncpg://<sa>%40<project>.iam@localhost/adk`）：

```bash
# Cloud Run serves dev.cofacts.ai and PR previews only; production (cofacts.ai)
# runs on GCE with its own DATABASE_URL. Keep Cloud Run off the production DB.
case "$DATABASE_URL" in
  */adk) export DATABASE_URL="${DATABASE_URL%/adk}/adk_staging" ;;
  */adk_staging) ;; # 已切換的 secret
  *) echo "Unexpected DATABASE_URL database suffix" >&2; exit 1 ;;
esac
echo "Cloud Run target database: adk_staging"
# 不輸出完整 URL；移除後面的 cat service.yaml，避免暴露環境變數。
```

更乾淨的做法是直接把 GitHub secret `DATABASE_URL` 改成 `.../adk_staging`，workflow 就不用改。但 secret 的值看不到，之後容易誤會它接的是 production，所以建議用上面明寫在 workflow 的方式。

- 這個修改以 commit 加進 **#163**。push 後 #163 會重新部署 preview，此時就會用 `adk_staging`（workflow 用的是 PR branch 上的檔案）。
- **#162 要先 rebase 到新的 #163 上**才能 push，否則 #162 branch 上的 `deploy.yml` 還是舊的，preview 會接 production DB。
- 1.1 要比這個 push 先做，否則 preview 啟動時會連不到 `adk_staging`。
- 已經部署的 `pr-163`、`pr-162` preview 會在這次 push / rebase 後重新部署，自動改接 `adk_staging`，但仍須讀取部署後 revision 的 DB 名稱確認。
- **其他舊 tags 與原本 100% 流量 revision 不會跟著更新**：workflow 會保留 tags。先盤點所有可存取 revision，逐一重部署到 staging 或移除 tag，並確認 dev 的 100% revision 已切換。未完成前不能宣稱所有 Cloud Run 部署已隔離；移除 tag 也不等於終止進行中的請求。

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

如果 `node_info` 不是 0，代表已經有 2.x 寫入；先找出並停止所有連 production 的 2.x writers，保存備份，再依 [Phase 4 的清理 SQL](#41-清除-node_info)。

### 1.5 確認 GCE production 的 image 來源

2026-10-18 已透過 IAP SSH 唯讀確認：

- VM：`cofacts-prod`，zone `asia-east1-b`；Compose 目錄 `/srv/rumors-deploy`。
- service `adk` / container `rumors-deploy-adk-1`：`cofacts/adk:latest`，無 Compose build 設定。
- 執行中的 ADK：`1.26.0`；DB 名稱 `adk`。
- 當時 image ID：`sha256:8fb153db7939ae604be5a8f0654131cdeacd1a9c624faf588b592d6eca3dbb6e`。
- 當時 RepoDigest：`cofacts/adk@sha256:dfc441215f9199cb4f0c1c2413c9142818b62cb50f71ae1178aabcdad8c9090d`。

上線前重新讀取執行中 container 的 image ID，再以該 ID 查 RepoDigests，保存可 pull 的 digest 作 rollback；`latest` 會變動，不能作為回滾依據。

```bash
gcloud compute ssh cofacts-prod --tunnel-through-iap --project=industrious-eye-145611 --zone=asia-east1-b
cd /srv/rumors-deploy
sudo docker inspect rumors-deploy-adk-1 --format '{{.Config.Image}} {{.Image}}'
# 將上一行的 image ID 代入：
sudo docker image inspect <IMAGE_ID> --format '{{json .RepoDigests}}'
```

**映像發布來源已確認為 [.github/workflows/cd.yaml](../.github/workflows/cd.yaml)**：
`release/*` tag push 或手動 workflow_dispatch 才 build/push Docker Hub 的 `cofacts/adk:latest`。
master merge 的 **Deploy** 只推 Artifact Registry 的 `backend:<sha>`，不會更新 GCE 使用的 Docker Hub image。

---

## Phase 2：PR A preview 測試

1. 1.2 的 commit push 到 #163 後，等 Deploy workflow 完成。
2. 確認 workflow 的非敏感 DB 名稱輸出，並讀取實際 preview revision 的 `DATABASE_URL`，只輸出解析後的 DB 名稱，確認為 **`adk_staging`**（不要貼完整環境或 URL）。
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

等 GitHub Actions 的 Deploy（master）完成，確認 dev revision 已接 staging。

另對已合併且驗證過的 PR A commit 執行 **CD**（手動選定 ref，或由對應 commit 建立 `release/*` tag），等待 `Build & push cofacts/adk` 成功；記錄 run、commit SHA 與產出的 Docker Hub digest。CD 也會發布 site image，但本步只更新 ADK service。

### 3.2 更新 GCE production

依 1.5 確認的方式更新 ADK image，例如：

```bash
gcloud compute ssh cofacts-prod --tunnel-through-iap --project=industrious-eye-145611 --zone=asia-east1-b
cd /srv/rumors-deploy
# 將 docker-compose.yml 中 adk.image 設為本次 CD 的 cofacts/adk@sha256:<digest>
# 先記錄舊 digest；不可只依賴可變動的 latest
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

先停止所有連 `adk` 的 2.12 writers（包含舊 preview、背景工作和進行中的請求），暫停 production 流量並保存可還原備份。GCE 的 Compose image 改回 1.5 記下的舊 digest，暫勿恢復服務；**然後**在 `adk` 執行下列 SQL。清理後啟動舊版、確認舊 session 讀取與續聊正常，再恢復流量。

Cloud Run 已隔離時不必為 production rollback 降版。若也要降版，**保留 1.2 的 staging 隔離修改**，不可直接 revert 整個 PR A 導致重新連 production；其 `adk_staging` 也須獨立清理 `node_info` 或重建後才能供 1.26 使用。

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

PR A 穩定後再做。先確認所有仍可存取的 dev / preview revision 已隔離到 `adk_staging`，且使用相容的 ADK 版本；舊 tag 不會因 merge 自動升級。

### 5.1 上線前

- [ ] 重新確認 Vertex AI Model Garden 已在 `industrious-eye-145611` 啟用 Claude Haiku 5.5（先前測試紀錄稱已完成；本次未驗證有效 model access）
- [ ] 確認 GCE 與 Cloud Run 的 `GOOGLE_CLOUD_LOCATION` 為 `global`，`GOOGLE_CLOUD_PROJECT=industrious-eye-145611`
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

## 附錄：GCP 查核紀錄與待驗證事項

2026-10-18 使用本機既有 gcloud 身分完成唯讀查核，未部署、建立 DB、匯入資料或修改 IAM：

| 項目 | 結果 |
| --- | --- |
| GCE image、版本、Compose 目錄 | 已確認，見 1.5 |
| GCE project / location | `industrious-eye-145611` / `global`（容器環境） |
| Cloud SQL DB | `adk` 存在，`adk_staging` 尚不存在 |
| App DB 使用者 | `cofacts-ai@industrious-eye-145611.iam` 存在，類型為 `CLOUD_IAM_SERVICE_ACCOUNT` |
| Cloud Run template SA | `cofacts-ai@industrious-eye-145611.iam.gserviceaccount.com` |
| Cloud Run 流量 | 100% 在 `cofacts-ai-00496-rzg`；另有多個舊 PR tags，包括 `pr-162`；當時無 `pr-163` tag |

這些是查核當下的快照，上線前須重查。SA 存在不代表 import、DDL 或 Vertex 呼叫權限已驗證。

仍待實作環境驗證：

- `gcloud sql import sql --user=<IAM 使用者>`：官方支援指定 import user，但本次沒有執行匯入，因此不標記為成功。若失敗，先查 operation error；確認部分匯入狀態，勿直接重跑覆蓋，再依 1.1 逐表調整 owner。啟動前以 app 角色驗證 schema USAGE/CREATE 與 table ownership。
- Production 的 `node_info` baseline、schema、實際 GCS artifact 寫入、GCE app 的有效 Vertex 權限與 Claude 請求，尚未驗證。VM metadata 沒有列出附掛 SA，不能據此推定容器的 ADC 身分；需確認容器使用的憑證來源，勿輸出私鑰或 token。
- 匯出前確認操作者具 Cloud SQL export/import 權限，Cloud SQL instance SA 對指定暫存 bucket 有 export 的 object create 與 import 的 object get 權限；app SA 與 instance SA 是不同身分。清除 dump 後也要依 bucket 的 soft delete / versioning / retention 設定確認殘留版本與保存期限。

官方參考：[Cloud SQL SQL 匯出／匯入與權限](https://docs.cloud.google.com/sql/docs/postgres/import-export/import-export-sql)、[import --user](https://docs.cloud.google.com/sdk/gcloud/reference/sql/import/sql)。本次沒有重跑原文件所述 production dump 測試，原有實測結果仍屬先前測試紀錄。
