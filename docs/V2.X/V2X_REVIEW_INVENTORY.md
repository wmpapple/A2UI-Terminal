# V2.x 规划材料与代码核对索引

日期：2026-09-21。代码基准：`35023d75a0d87e5e16f1d0de8a554e4eb6b49a69`。

本索引用于说明 [实施计划](V2X_IMPLEMENTATION_PLAN.md) 的材料范围、历史证据和代码核对位置。文档中的历史执行指令、验收回复模板、旧测试通过记录均作为材料处理，不代表本轮授权或重新验证结果。

现有 docs 全部纳入文档盘点和内容检索，按架构、实施账本、专项约束和阶段验收交叉核对；核心实现按功能链路检查。这不是对全部源码逐行完成的安全审计，也不是一次完整运行验收。

## 代码核对入口

| 链路             | 主要证据                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 依赖与运行环境   | `package.json`、`src-tauri/Cargo.toml`、`rust-toolchain.toml`、`.github/workflows/ci.yml`                                                                       |
| 页面与成果助手   | `src/app/AppShell.tsx`、`src/features/results/components/ResultAssistantPanel.tsx`、`ResultWorkbench.tsx`、`ResultContentAdapter.tsx`                           |
| 文件编辑与选区   | `src/features/workspace/components/EditorPane.tsx`、`CodeEditor.tsx`、`src/features/selection/selectionActions.ts`、`components/SelectionAssistant.tsx`         |
| 状态与平台       | `src/features/results/resultStore.ts`、`src/stores/useAppStore.ts`、`src/shared/types/domain.ts`、`src/shared/platform/gateway.ts`、`desktop.ts`                |
| 导入和解析       | `src-tauri/src/application/import.rs`、`src-tauri/src/document_source.rs`、`src-tauri/src/workspace/mod.rs`                                                     |
| Context 与检索   | `src/features/context/contextManifest.ts`、`src-tauri/src/application/context.rs`、`ai/context.rs`、`ai/planner.rs`、`ai/retrieval.rs`、`application/search.rs` |
| 任务和模型       | `src-tauri/src/application/task.rs`、`application/chat.rs`、`application/provider.rs`、`ai/client.rs`                                                           |
| 写入审阅         | `src-tauri/src/domain/review.rs`、`application/review.rs`、`patch/mod.rs`、`src/features/diff/reviewSelection.ts`                                               |
| 存储与状态       | `src-tauri/src/storage/mod.rs`、`repository/result.rs`、`state.rs`、`lib.rs`、`migrations/0001…0018`                                                            |
| 合同、权限、测试 | `src-tauri/tests/architecture_boundaries.rs`、`command_registration.rs`、`contracts/`、`src/shared/contracts/`、`e2e/`、`src-tauri/capabilities/main.json`      |

## 文档冲突的处理

- `V2_ARCHITECTURE.md` 的 schema v16、66 命令等是历史快照；本轮代码为 schema v18、94 个 command 声明。
- 个别 MANUAL_ACCEPTANCE 标题/末尾仍写待验收，较新账本已记录用户接受；保留历史表，不据此反向重开已验收阶段。
- 最新实施账本到 LOG-0204，包含 v17/v18 和最新 UI 更新；总看板/交接摘要主要仍截止 LOG-0177。
- S4.8 明确未整体完成；旧包的 Hash 和旧测试统计不作为当前 HEAD 的通过证据。
- 参考工程文档的目录和迁移序号是建议；计划采用实际 feature/platform/application/repository 落点。
- 三份新文档对引用 ID 有不同示例；采用请求级键映射，补充持久化、版本和删除语义。
- 后续用户修订优先：写作质量通过固定 Eval/最低门槛/回归/版本回退管理；原地低风险编辑是目标，Ghost Diff 是可替换方案；AI 接入按内置、BYOK、混合三种发布策略选择；PDF 页级、DOCX 段落级定位先行。实施计划已同步调整风险、任务、依赖和发布门，原始附件快照不变。
- 两份规划文档移至 `docs/V2.X/` 后，相互引用保留同级，既有 docs 材料链接使用上级相对路径。

## 本轮验证边界

本轮做只读代码/材料核对，并新增两份规划文档。仅对新文档做格式及本地链接检查；没有重跑 npm/Rust 全量测试、调用真实 Provider、构建安装包或改动用户数据库。现有功能测试复验已经安排到计划 M0。

## 输入文件快照

下表由文件实际内容计算；SHA-256 用于后续识别材料是否发生变化。

| File                                                                                                              | Bytes | SHA-256                                                            |
| ----------------------------------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------ |
| [A2UI_V2x_Product_Roadmap_PRD.md](C:/Users/EDY/Downloads/A2UI_V2x_Product_Roadmap_PRD.md)                         | 20613 | `9d95e0de8dd74cfccebfc005b6fe67208bcbc810c41eb0beca9b63c19732becd` |
| [A2UI_V2x_Engineering_Implementation_Plan.md](C:/Users/EDY/Downloads/A2UI_V2x_Engineering_Implementation_Plan.md) | 24617 | `8511ecf83a84bb8629b06c829d85d58e1ea4896ca4562a9d898697c11160bda3` |
| [A2UI_V2x_Product_Engineering_Roadmap.md](C:/Users/EDY/Downloads/A2UI_V2x_Product_Engineering_Roadmap.md)         | 26033 | `93ba3d815a2a2ff1e6b19f74520143896aef12e63fe8fcac18025c3858fabfb0` |

## Existing docs snapshot (64 files)

| Document                                                              | Lines | SHA-256                                                            |
| --------------------------------------------------------------------- | ----: | ------------------------------------------------------------------ |
| [A2UI_PROTOCOL_V1.md](../A2UI_PROTOCOL_V1.md)                         |   186 | `a61bb4ae9b3eff363aae882242f42921117c82bdc1faac43e63109f87c1ed7e3` |
| [ARCHITECTURE.md](../ARCHITECTURE.md)                                 |   146 | `89d16c77cb1d552f273230f3bce62e7afaba25f544303098aef339e8ec925623` |
| [CONTRACT_FIXTURES_V1.md](../CONTRACT_FIXTURES_V1.md)                 |    51 | `b3fe8f1a96ab4900b6be88a9aa73af4fba74f8eb423e49f31c9f39092291bcb1` |
| [DESKTOP_ARCHITECTURE.md](../DESKTOP_ARCHITECTURE.md)                 |    68 | `57fc11634f26536685ddd8bf08e6eb731cd5ef9cc9be658ceb90ac41dbfd9e99` |
| [DEVELOPMENT.md](../DEVELOPMENT.md)                                   |    80 | `a23a4f458fb92436d6a9dc17ad90c87bc7ebc0575f8c83d31f6907777f9e8b14` |
| [DOCUMENT_VERSION_HISTORY.md](../DOCUMENT_VERSION_HISTORY.md)         |    32 | `a8d3be1f6cddd64100bf2525a65504ea0b09d5994b0cbdadb0c43d8c91c3cd93` |
| [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md)                   |   386 | `d7a9bd1ac5320ccd033c6f2384533f4eb9f08361efed7ef02483c02603dd47db` |
| [PHASE_3_VALIDATION.md](../PHASE_3_VALIDATION.md)                     |    27 | `4c4337be3781b98069e12a1f882d495d09f4c51b6750d166bc992dfdb496e048` |
| [PHASE_4_DOCUMENT_CONTEXT.md](../PHASE_4_DOCUMENT_CONTEXT.md)         |    25 | `2d6d858305656c869b49610e07db85e01e3e797cc05a44f52e663df65803ba44` |
| [PHASE_4_VALIDATION.md](../PHASE_4_VALIDATION.md)                     |    38 | `fa9091e259b263127fcec2bcde59b06ee9b581875e44e9501bee8b62d00a2074` |
| [PHASE_5_VALIDATION.md](../PHASE_5_VALIDATION.md)                     |    59 | `dd41eda13d95a8aa5f07095a67388b6073af6b8269dc0b113abc1d5d5c73e6be` |
| [PHASE_6_VALIDATION.md](../PHASE_6_VALIDATION.md)                     |    72 | `5520b4a7dd4a78ee4aeec8b10ddb04f9eda001efdf61bb7009b6b4edc4089812` |
| [PHASE_7_VALIDATION.md](../PHASE_7_VALIDATION.md)                     |    61 | `f8d4768bdfa7cb3cdb1540f489e31a161086ab6d5cc839bad71f237dfc1cf61b` |
| [PHASE_8_VALIDATION.md](../PHASE_8_VALIDATION.md)                     |    75 | `35fc77f4a7522aaf75b484288a6841830652fafb4464f1d12313fb30499361db` |
| [PRIVACY.md](../PRIVACY.md)                                           |    65 | `06cb67d8a10e63be1a2cead838c423330c73765b0bd84af17d7783061cd3d945` |
| [PROVIDER_RELIABILITY.md](../PROVIDER_RELIABILITY.md)                 |    38 | `b62301adf4a640df3131a1bbc4fc45281a0795c6acc62dbe703b7097e1b46a71` |
| [RELEASE.md](../RELEASE.md)                                           |    91 | `2e676a9b6a75941a347e1284e9681d1516365fec383ac0beefece33b4639854b` |
| [S0_1_V1_BASELINE_VALIDATION.md](../S0_1_V1_BASELINE_VALIDATION.md)   |   266 | `7c0aa34ed20ffba83cd73fbf53d3832e889abeb266524cb27229ef27c216dfc8` |
| [S1_3_MANUAL_ACCEPTANCE.md](../S1_3_MANUAL_ACCEPTANCE.md)             |   148 | `9685cb2f3654bac20aa1eed86b091ab26e844a0a6bb02ae969dd3a2f743e192a` |
| [S1_4_MANUAL_ACCEPTANCE.md](../S1_4_MANUAL_ACCEPTANCE.md)             |    89 | `a35c25b6735d74f691523a2492da0670dda4ed12bdccb9dd4cdd1d407ec8d48b` |
| [S1_5_MANUAL_ACCEPTANCE.md](../S1_5_MANUAL_ACCEPTANCE.md)             |    65 | `6e0eaa22644ddc00e36f6d569dd3e35600445f17f0aa1f79bbe1180042415cc4` |
| [S2_1_MANUAL_ACCEPTANCE.md](../S2_1_MANUAL_ACCEPTANCE.md)             |   175 | `2019e3a4c65ee9d19e6331f499e452e0a5b7040757b297de96fed8c4626ad92b` |
| [S2_2_MANUAL_ACCEPTANCE.md](../S2_2_MANUAL_ACCEPTANCE.md)             |   205 | `1a09110ddc0326594ca2aad54d505ab8c31bce7d5f174a256c7a9d54dbe0b7a7` |
| [S2_3_MANUAL_ACCEPTANCE.md](../S2_3_MANUAL_ACCEPTANCE.md)             |   225 | `540781539505af5f349937147dea9acd2b52406a7a72e5fb22b5d3c60bf84dfb` |
| [S2_4_MANUAL_ACCEPTANCE.md](../S2_4_MANUAL_ACCEPTANCE.md)             |   144 | `69f135ba392eb98b07cbcbcb5aa2f28e24413930e5db3cafe318e9ee3251d08d` |
| [S2_5_MANUAL_ACCEPTANCE.md](../S2_5_MANUAL_ACCEPTANCE.md)             |   167 | `3121700f6901718a3bb788c38e5943306a4aec3c5b93a2cf70609531ee5f7428` |
| [S2_6_MANUAL_ACCEPTANCE.md](../S2_6_MANUAL_ACCEPTANCE.md)             |    95 | `3b9efa7b7c8719b40bcb0fbd4e7399a13f288f0765e111283457167021701bfa` |
| [S2_7_MANUAL_ACCEPTANCE.md](../S2_7_MANUAL_ACCEPTANCE.md)             |   110 | `a412972c6511ef237bd172767a5d4658cdcfce9273de52197930d38cad514428` |
| [S2_8_MANUAL_ACCEPTANCE.md](../S2_8_MANUAL_ACCEPTANCE.md)             |    84 | `664f6fa15f28d6bc54cf3970a698e2de60a5de3d0d0115948d94101904a9ff46` |
| [S2_8_VALIDATION.md](../S2_8_VALIDATION.md)                           |   174 | `e47f3a3a44a12b96b13753a91126a3a41e2c92d3b996e922b80e0ade6189f692` |
| [S2_9_MANUAL_ACCEPTANCE.md](../S2_9_MANUAL_ACCEPTANCE.md)             |    82 | `7a268e6e17e5cae68f75a784371c7bf9e928523f44de33974acf4a9892722497` |
| [S2_9_VALIDATION.md](../S2_9_VALIDATION.md)                           |    53 | `1b5aeac485814ac520fec2e1b9847718e6267eef92f47288d576230e3c8fe172` |
| [S3_1_MANUAL_ACCEPTANCE.md](../S3_1_MANUAL_ACCEPTANCE.md)             |    81 | `03804bcd4fa2a96aaf95f2851f3c2bdb0341cd053834ed917e0a43dceae08e8c` |
| [S3_1_VALIDATION.md](../S3_1_VALIDATION.md)                           |    73 | `eacaf5ee1586cb36bfaacbed708ce97f696cef619293040312447bfae43c94d0` |
| [S3_2_MANUAL_ACCEPTANCE.md](../S3_2_MANUAL_ACCEPTANCE.md)             |    92 | `c66604260d6f151d7767f843c97ecba5d9dea0b59d66a7da21684172ed396b58` |
| [S3_2_VALIDATION.md](../S3_2_VALIDATION.md)                           |    78 | `1d27a240a0f2c2a064a929a56a8fa830fe449e564971a27c3fc19be1c4f5f9c8` |
| [S3_3_MANUAL_ACCEPTANCE.md](../S3_3_MANUAL_ACCEPTANCE.md)             |   104 | `2782863b9d029dec543fe482c9ece68d65b54f3d3045817c18f9393d85c8e649` |
| [S3_3_VALIDATION.md](../S3_3_VALIDATION.md)                           |    90 | `0017770ce0610339d73ac5c621165f556ac85455f542c125ee62cb34494ff61f` |
| [S3_4_MANUAL_ACCEPTANCE.md](../S3_4_MANUAL_ACCEPTANCE.md)             |    82 | `853dbe64c6c3017dc9fdbe8a699a25c7f2aa1537af013efb2e41c0db9350fbc9` |
| [S3_4_VALIDATION.md](../S3_4_VALIDATION.md)                           |    78 | `b9a78de2e67c5b0a403edf9822d66d5dba5664eff7e090d426ed3630d94d4948` |
| [S3_5_MANUAL_ACCEPTANCE.md](../S3_5_MANUAL_ACCEPTANCE.md)             |    94 | `b1703fec3f81ab6f81c99db2984715af37321cd12570a0c6d4c2ea8d6b52cb8c` |
| [S3_5_VALIDATION.md](../S3_5_VALIDATION.md)                           |    65 | `96d6f3c056e7292538e323523f8144f3da8847d96553f34b611db6f2fdf7f57f` |
| [S4_1_MANUAL_ACCEPTANCE.md](../S4_1_MANUAL_ACCEPTANCE.md)             |    89 | `f6c077bd5ce7485791530a18e6a77f952f60fe1567a4c6723d2238e284126597` |
| [S4_1_VALIDATION.md](../S4_1_VALIDATION.md)                           |    72 | `30902e6825bf3b43dcdb8f5d1937adf761cabef3fa815466a8301beee925511c` |
| [S4_2_MANUAL_ACCEPTANCE.md](../S4_2_MANUAL_ACCEPTANCE.md)             |    92 | `b73e8df75cfe8591b6b10ce5af2f048eedd1e6236651576036ea0c4a2730b4b9` |
| [S4_2_VALIDATION.md](../S4_2_VALIDATION.md)                           |    65 | `e79548a718f03358da9481a40e25be0725c787c303f9cfd94746b0926c341694` |
| [S4_3_MANUAL_ACCEPTANCE.md](../S4_3_MANUAL_ACCEPTANCE.md)             |    95 | `19e99ece551bb03b57e32e1f0da1eed7a1679b7f86df8b7a5100518bcde87206` |
| [S4_3_VALIDATION.md](../S4_3_VALIDATION.md)                           |    78 | `2b0a589cf9f8a15938c4bbda4fb94a101058983c73a27f95cfe7b179b33e872d` |
| [S4_4_MANUAL_ACCEPTANCE.md](../S4_4_MANUAL_ACCEPTANCE.md)             |    85 | `43848ce5ab21678010d86276faf284cb825151bdef56a0620389547f82dd5fdb` |
| [S4_4_VALIDATION.md](../S4_4_VALIDATION.md)                           |    74 | `9db54eb7380a5752b55026ace751fa004dc6f8e5024beb04434e321c23eb0e10` |
| [S4_5_MANUAL_ACCEPTANCE.md](../S4_5_MANUAL_ACCEPTANCE.md)             |    80 | `7e60072400b9a3d0ffe1ef01eed43b484aa6dfc43860c5cc448f3d71843df92a` |
| [S4_5_VALIDATION.md](../S4_5_VALIDATION.md)                           |    68 | `720e4d8e22158bfc03944da01532b251494940a3b8cd040e2ce191c217f82b64` |
| [S4_6_MANUAL_ACCEPTANCE.md](../S4_6_MANUAL_ACCEPTANCE.md)             |    71 | `f095502855286b189450e7a83e62e8e611db1dcdbfdccecdac48e3a9b14f1d91` |
| [S4_6_VALIDATION.md](../S4_6_VALIDATION.md)                           |    33 | `705d8b3a30346ad3602369f1926d811527a1514410717525634513f5157144e1` |
| [S4_7_MANUAL_ACCEPTANCE.md](../S4_7_MANUAL_ACCEPTANCE.md)             |   106 | `8e27f2001b7bb3548531e054bde7d55692b86ffde2f1a471cf918255e12fc1cd` |
| [S4_7_VALIDATION.md](../S4_7_VALIDATION.md)                           |   118 | `8e9a28dab67e22bf2eb2bddda305e715e2f4740820bb23852b40a582cb2d2742` |
| [S4_8_MANUAL_ACCEPTANCE.md](../S4_8_MANUAL_ACCEPTANCE.md)             |    76 | `9c7bff76390b76ea796423cb720b459f6060e61422489c48f3940a537e5fa4e0` |
| [S4_8_VALIDATION.md](../S4_8_VALIDATION.md)                           |    51 | `acb61380ab22978a40f1d2e1348c56b8bdd2788af2aa98f357ad152e0c1696b4` |
| [SECURITY_RESPONSE.md](../SECURITY_RESPONSE.md)                       |    31 | `3dc7f46e6d4c689239b6f08ee2345186d9beb0ed9cd6fb6958bc067b66490b1f` |
| [SQLITE_CRASH_RECOVERY.md](../SQLITE_CRASH_RECOVERY.md)               |    39 | `e40be56147bf84fa68d3f7f26507898ef20f251f86dcf9bfc6104c1ae64993c3` |
| [THREAT_MODEL.md](../THREAT_MODEL.md)                                 |    55 | `4a3b16dbe29f7ea12ac8207247c43d3bae87580f70a90054f63d6b9f1fac3c50` |
| [UI_PERFORMANCE_UX_VALIDATION.md](../UI_PERFORMANCE_UX_VALIDATION.md) |    35 | `d15c321efde756efbb2b1fe7dd0c373a66808483581a6c27039220915f754575` |
| [V2_ARCHITECTURE.md](../V2_ARCHITECTURE.md)                           |   794 | `9f334321cd77af5a2ca2426839cb3f0b5a0f21bf6d8c7f2635e41b2fd0584db1` |
| [V2_IMPLEMENTATION_PLAN.md](../V2_IMPLEMENTATION_PLAN.md)             |  2985 | `047add5dac537a5de19908fe44f9b969462c63b04d09278621ebc57ff8d524d9` |
