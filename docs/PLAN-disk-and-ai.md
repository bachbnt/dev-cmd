# Kế hoạch: `dev disk` / `dev prune` (dọn cả máy dev) và `dev ai`

Trạng thái: **đã triển khai, còn một mục** (cập nhật 2026-11-27). Bản 2.8.2: T1, T2, T3, T7, T10, phase 0. Bản 2.9.0: phase 1, 2, 5. Bản 2.10.0: phase 3, 4, 6, 11, 12, 13, 14, 17 và T5, T6. Bản 2.11.0: 15a (khảo sát), 15b đến 15e (nguồn Gemini, Copilot, OpenCode; Antigravity không có dữ liệu cục bộ nên **không hỗ trợ**), phase 7, 8, 9, 10, 16 và T4, T9. Bản 2.12.0 và 2.13.0: nâng quyền `sudo` dùng được, Xcode, runtime Simulator, Thùng rác, cache trình duyệt, và thử trên macOS thật bằng job CI `macos-e2e`. Sau đó: T8 đủ (mỗi miền MCP một file), phần trăm sub-agent cho Codex và OpenCode, `--notify`, `aiTools`, `aiSourceRoots`, và `dev ai --short` trúng cache 30 giây chỉ còn khoảng 30 ms (gần bằng Node trần 28 ms; lần đọc lại log vẫn khoảng 170 ms). **Chưa làm:** 15f (Cline, Roo, Kilo, Aider, Amp: không cài trên máy khảo sát nên không có log thật để xác minh; Aider sẽ dùng `aiSourceRoots`). Ba lệch so với plan: `--here` thay vì mặc định lọc theo project hiện tại (tránh đổi hành vi); `--pr` giữ tối thiểu; `--check` trả 2 khi chưa đặt ngân sách (README đã ghi), bất thường không đổi mã thoát mà chỉ cảnh báo và thông báo.

**Thay đổi so với bản nháp 1:**

1. Phạm vi mở rộng từ "dọn artifact và cache dev" sang **dọn cả máy theo kiểu Mole/CleanMyMac**: phân tích dung lượng có đào sâu, cache và log của app, gỡ app (macOS), bảo trì tối thiểu. Vẫn giữ các ranh giới cứng ở mục 1.
2. Đã chốt tên lệnh (cách A, mục 4.2): `dev clean` giữ nguyên cho project, `dev prune` dọn máy, `dev disk` để xem.
3. Thêm **hạt nhân an toàn dùng chung** (mục 4.4): xóa vào Thùng rác mặc định, danh sách cấm cứng, nhật ký xóa, ba mức `safe`/`review`/`blocked`.
4. Sửa một chỗ sai ở bản nháp 1: Go có lệnh dọn chính thức (`go clean -cache`, `go clean -modcache`).
5. Thêm các mở rộng cho `dev ai` (mục 5.9): theo nhánh/PR, theo khách hàng, xuất báo cáo, cảnh báo bất thường, nguồn dữ liệu khác.
6. Số phase tăng từ 8 lên 17; phần có xóa và phần gỡ app đi sau cùng.
7. Các ý tưởng mở rộng cho `dev ai` đã được lập kế hoạch đầy đủ ở mục 5.9 đến 5.16 (theo nhánh/PR, theo khách hàng, xuất báo cáo, status line và cảnh báo bất thường, phiên đắt nhất, nguồn dữ liệu khác, gộp nhiều máy, cảnh báo bảng giá cũ), kèm cấu hình, quyền riêng tư và test.
8. **Quyền admin:** cho phép thao tác cần quyền admin (xóa file hoặc chạy lệnh) **nếu người dùng được hỏi và tự nhập mật khẩu cho `sudo`** (mục 4.12, phase 17). DevCmd không bao giờ nhận hay lưu mật khẩu.
9. **Nguồn dữ liệu AI:** Gemini CLI, GitHub Copilot, Antigravity trở thành mục tiêu chính thức, kèm mô hình tính phí theo loại (`tokens`, `reported-cost`, `requests-only`) và cách đọc SQLite (mục 5.14).
10. **Rà soát kiến trúc** (mục 10): các tiền đề refactor T1 đến T10 và số đo hiệu năng quét log, khởi động CLI.
11. **Đã chốt ba câu hỏi (2026-11-26):** câu 3 (port phần AI sang JS), câu 18 (`sudo -k`, luôn nhập mật khẩu mỗi lần), câu 21 (khảo sát nguồn AI ngay sau phase 1; Gemini, Copilot, Antigravity làm trước phase 8). Thứ tự thực hiện mới nằm ở bảng mục 3.

| Nhóm | Lệnh | Một câu mô tả |
| --- | --- | --- |
| A. Máy dev | `dev disk` | Xem và phân tích dung lượng, **chỉ đọc**. Có chế độ đào sâu (`--top`), file lớn (`--large`), xu hướng (`--trend`). |
| | `dev prune` | Dọn dẹp cả máy. Chạy không tham số trong terminal thì hiện menu; có lệnh con `caches`, `projects`, `apps`, `maintenance`. |
| | `dev clean` | **Giữ nguyên**: dọn thư mục build của project hiện tại (được vá ở phase 0). |
| B. AI | `dev ai` | Chi phí và mức dùng của Claude Code, Codex (port từ aicost), kèm ngân sách, lịch sử, chỉ số hiệu quả, phân tích theo nhánh/khách, xuất báo cáo và cảnh báo. |

## 1. Phạm vi

**Làm:**

- Quét và dọn **artifact theo project** (`node_modules`, `.venv`, thư mục build).
- Dọn **cache toàn cục của công cụ dev** (npm, pnpm, yarn, pip, Homebrew, CocoaPods, Xcode DerivedData, simulator, Go, Dart, ...).
- **Phân tích dung lượng** có đào sâu theo thư mục, tìm file lớn, theo dõi xu hướng.
- **Cache và log của ứng dụng** (macOS `~/Library/Caches`, `~/Library/Logs`; Linux `~/.cache`; Windows thư mục tạm cũ), ở mức `review`, chuyển vào Thùng rác.
- **Gỡ ứng dụng** kèm file còn sót, **trên macOS trước**; Windows và Linux chỉ gợi ý lệnh chính thức.
- **Bảo trì tối thiểu** (tùy chọn, mục 4.10), không hứa tăng tốc.
- **Thao tác cần quyền admin** (phase 17), chỉ khi người dùng đồng ý và tự nhập mật khẩu cho `sudo` (4.12).
- Báo cáo chi phí AI từ log có sẵn trên máy, chỉ đọc; gồm theo nhánh/PR, theo khách hàng, xuất báo cáo, cảnh báo ngân sách và bất thường.

**Không làm (cố ý):**

- **Không tự nâng quyền.** DevCmd không bao giờ nhận, đọc hay lưu mật khẩu. Thao tác cần quyền admin chỉ chạy sau khi hỏi người dùng và để chính `sudo` nhắc mật khẩu trong terminal (4.12, phase 17). Không có chế độ ngầm, không có `--yes` cho việc nâng quyền, và danh sách cấm vẫn áp dụng ngay cả với quyền root.
- Không dọn thư mục hệ thống (`/System`, `/Library`, `/usr`, `C:\Windows`, `C:\Program Files`), không gỡ app hệ thống.
- Không đụng vào **dữ liệu cá nhân của người dùng** (Documents, Desktop, Downloads, Pictures, thư viện Photos, Mail, iCloud, Keychain, Time Machine). Đây là danh sách cấm cứng ở mục 4.4.
- Không hứa "tối ưu/tăng tốc máy", không xóa theo mẫu mù (glob rộng không qua danh mục).
- Không bao giờ đề xuất xóa **log hội thoại của công cụ AI** (`~/.claude/projects`, `~/.codex/sessions`). `dev disk` chỉ hiện dung lượng.
- **Không có tool MCP nào xóa file hoặc gỡ app.** MCP chỉ có công cụ chỉ đọc.
- Không gửi dữ liệu đi đâu (không telemetry, không gọi mạng để lấy giá).
- Không tự đoán giá model: chỉ dùng giá từ trang chính thức của nhà cung cấp, ghi nguồn trong `pricing.toml`. Model chưa có giá hiện `n/a`, không bao giờ tính bằng 0.

**Định vị:** các tính năng dọn cả máy nằm trong DevCmd nhưng tách module riêng (`src/disk/`, `src/cleaners/`, `src/apps/`, `src/maintenance/`), để nếu sau này cần tách thành package riêng thì tách được. Tham khảo thiết kế của Mole, CleanMyMac, AppCleaner (kiểm tra tính năng hiện tại của chúng khi làm, không sao chép danh mục của họ).

## 2. Nguyên tắc (bám `AGENTS.md`)

1. Mọi hành động chạy tiến trình là `{ executable, args, cwd? }` đi qua `src/runner/spawn.js` và `executeCommands`; không shell, không nối chuỗi.
2. **Lõi không biết gì về giao diện.** `src/disk/`, `src/apps/`, `src/ai/` chỉ trả dữ liệu; handler trong `src/handlers/` dựng truy vấn, gọi lõi, hiển thị. Menu của `dev prune` chỉ là lớp điều phối, mọi mục đều có lệnh không tương tác và `--json`.
3. Khai báo bằng dữ liệu, không thêm nhánh theo công cụ vào handler: cleaner nằm trong `cleaners/built-ins.json`, bảo trì nằm trong `maintenance/built-ins.json`, mở rộng bằng `~/.devcmd/cleaners/*.json`, giống recipes và openers.
4. **Quét không bao giờ xóa.** Xóa là bước riêng (`dev prune`), nhận danh sách rõ ràng, **kiểm tra lại từng đường dẫn ngay trước khi xóa** (không tin kết quả quét cũ).
5. **Ba mức, không có mức mập mờ:** `safe` (tích sẵn), `review` (hiện kèm lý do, không tích sẵn, chỉ xóa khi người dùng chọn rõ), `blocked` (không bao giờ xóa được). Cái gì chưa chắc là an toàn thì tối đa là `review`.
6. **Xóa có thể hoàn tác là mặc định.** Mọi thứ không phải cache dựng lại được thuần túy đều chuyển vào Thùng rác, không xóa hẳn (mục 4.4).
7. Không in và không commit nội dung log thật (hội thoại, code, đường dẫn). Chỉ xem tên trường và con số. Fixture đều là dữ liệu bịa.
8. File JavaScript mới bắt đầu bằng `// Copyright (c) 2026 bachbnt`. Test và README đi cùng thay đổi hành vi.
9. Lõi nhận `homeDir` qua tham số, không gọi `os.homedir()` sâu bên trong (các hằng số trong `src/config/index.js` được tính lúc `require`, nên test không đổi HOME được). Test chạy trên HOME giả trong thư mục tạm; **không bao giờ xóa trên máy thật trong test**.
10. `dev clean` (project) và `dev prune` (máy) **dùng chung một lõi an toàn** (`src/disk/safety.js`), khác lệnh nhưng không khác luật.
11. **Nâng quyền là ngoại lệ có kiểm soát:** chỉ qua `src/runner/elevate.js`, chỉ cho thao tác khai báo trong danh mục (`needsAdmin`), mỗi lần đều hỏi lại, không bao giờ xử lý mật khẩu (4.12).
12. **Hành động xóa không bao giờ phát lại được:** `dev again` từ chối mục lịch sử đánh dấu `replayable: false` (mục 10, T6).

## 3. Thứ tự làm

Mỗi phase là một nhánh và một PR. Thứ tự đặt theo giá trị và rủi ro: chỉ đọc trước, xóa sau, gỡ app sau cùng. **Snapshot lịch sử AI làm sớm** vì log bị công cụ xóa thì không lấy lại được.

**Tiền đề kiến trúc (mục 10).** Rà soát code cho thấy một số chỗ phải sửa trước khi thêm tính năng, nếu không mỗi phase sẽ nhân thêm nợ kỹ thuật. Mỗi tiền đề là một PR nhỏ, không đổi hành vi, có test cũ làm lưới an toàn:

| Tiền đề | Nội dung | Mở khóa | Công sức (thô) |
| --- | --- | --- | --- |
| T1 | Sổ đăng ký lệnh và khai báo flag (sinh parse, kiểm tra, help, completion), nạp handler lười | phase 1 trở đi | L |
| T2 | `getPaths(homeDir)` và đồng hồ/`now` truyền qua tham số | phase 1, 3 | S |
| T3 | Kho JSON ghi nguyên tử (history, projects, config, trust chuyển sang dùng) | phase 2, 6 | S đến M |
| T4 | Bộ nạp registry dùng chung (recipes, openers, cleaners, maintenance) | phase 4, 6 | M |
| T5 | Danh mục artifact dùng chung (clean, reset, disk, prune) | phase 3 | M |
| T6 | Tách `executeCommands`; cờ `replayable: false`; `dev again` từ chối | phase 6 | M |
| T7 | `--json` bất đồng bộ và mẫu "thu thập dữ liệu, rồi hiển thị" | phase 1 | S |
| T8 | Tách `src/mcp/tools.js` theo miền; nạp SDK lười | phase 7 | S đến M |
| T9 | Config theo schema có kiểu (giá trị đơn, số, object) | phase 5, 8 | M |
| T10 | Hàm trợ giúp test dùng chung (`test/helpers/`) | mọi phase | S |

Thứ tự đề xuất: **T10, T2, T3, T7, T1** trước phase 1; **T5** trước phase 3; **T9** trước phase 5; **T4 và T6** trước phase 6; **T8** trước phase 7. Engine quét log (mục 5.2) làm ngay trong phase 1. **Không còn câu hỏi nào chặn phase 1** (câu 1 và 2 đã chốt).

| Thứ tự | Phase | Nội dung | Rủi ro |
| --- | --- | --- | --- |
| 1 | 0 | Vá `dev clean` để không xóa file git đang theo dõi; tách lõi an toàn dùng chung (4.1) | thấp |
| 2 | 1 | `dev ai`: lõi + parity với aicost + `--json` (5.2, 5.3, 5.8) | thấp, chỉ đọc |
| 3 | 15a | `dev ai` nguồn mới: **khảo sát log** từng công cụ (Gemini CLI, Copilot, Antigravity, ...), viết `docs/AI-SOURCES.md`; **không đổi code, làm ngay sau phase 1** (5.14) | thấp |
| 4 | 2 | `dev ai`: cấu hình, snapshot theo ngày, bảng + `--short` (5.4, 5.5) | thấp |
| 5 | 3 | `dev disk` chỉ đọc: artifact theo project (4.5) | thấp |
| 6 | 4 | `dev disk` chỉ đọc: cache toàn cục, đào sâu `--top`, `--large` (4.6, 4.7) | thấp |
| 7 | 5 | `dev ai`: ngân sách, dự báo, `--check` (5.4) | thấp |
| 8 | 6 | `dev prune`: hạt nhân an toàn (Thùng rác, danh sách cấm, nhật ký) + dọn cache toàn cục và artifact project, **chỉ mục `safe`** (4.4, 4.11) | **cao** |
| 9 | 7 | `dev ai`: chỉ số hiệu quả, phiên đắt nhất, mặc định theo project, tool MCP (5.6, 5.7, 5.13) | thấp |
| 10 | 15b | `dev ai` nguồn mới: khung nguồn, `billing`, `maturity`, `--tools`, đọc SQLite (5.14) | thấp |
| 11 | 15c | `dev ai`: nguồn Gemini CLI (5.14) | thấp |
| 12 | 15d | `dev ai`: nguồn GitHub Copilot (5.14) | thấp |
| 13 | 15e | `dev ai`: nguồn Antigravity (5.14) | thấp |
| 14 | 8 | `dev ai`: phân tích theo nhánh/PR và theo khách hàng (5.9, 5.10) | thấp |
| 15 | 9 | `dev ai`: xuất báo cáo csv, md, html, openmetrics (5.11) | thấp |
| 16 | 10 | `dev ai`: status line, cảnh báo bất thường, cảnh báo bảng giá cũ (5.12, 5.16) | thấp |
| 17 | 11 | `dev prune caches`: cache và log của app, mức `review`, vào Thùng rác (4.8) | **cao** |
| 18 | 12 | `dev prune apps`: gỡ app trên macOS, kể cả cask (4.9) | **rất cao** |
| 19 | 13 | `dev prune maintenance`: bảo trì tối thiểu, **chỉ khi chốt câu hỏi 8** (4.10) | trung bình |
| 20 | 14 | `dev disk`: xu hướng theo thời gian, phiên bản công cụ không dùng, project bỏ quên (4.7) | thấp |
| 21 | 15f | `dev ai`: các nguồn còn lại, từng công cụ một: OpenCode, Cline/Roo/Kilo, Aider, Amp (5.14) | thấp |
| 22 | 16 | `dev ai`: gộp dữ liệu nhiều máy (5.15) | thấp |
| 23 | 17 | Nâng quyền có kiểm soát (`sudo`): bảo trì, cache và log toàn máy, gỡ app cài toàn máy (4.12) | **rất cao** |

**Cột Phase là mã định danh dùng xuyên suốt tài liệu; thứ tự thực hiện là số ở cột Thứ tự (thứ tự dòng).** Mã của các phase nguồn AI mới (15a đến 15f) được giữ nguyên để các tham chiếu ở mục 5.14 không đổi, nhưng chúng được kéo lên trước theo quyết định ở câu hỏi 21: **15a ngay sau phase 1; 15b đến 15e sau phase 7 và trước phase 8; 15f sau phase 14.**

Hai nhóm A và B xen kẽ để mỗi phase nhỏ và độc lập: phần chỉ đọc của cả hai nhóm đi trước, phần xóa (6, 11, 12) đi sau, và các mở rộng `dev ai` (7 đến 10, 15, 16) có thể làm song song với phần dọn dẹp vì không chạm vào nhau.

Phase 11 và 12 chỉ bắt đầu khi phase 6 đã dùng thật một thời gian và nhật ký xóa cho thấy hoạt động đúng. Phase 12 bắt đầu bằng thử trên tài khoản người dùng thử nghiệm hoặc máy ảo macOS, **không phải máy chính**. Phase 8 phụ thuộc vào việc xác minh tên trường nhánh git và thư mục làm việc trong log thật (5.9). Phase 15b đến 15f phụ thuộc vào kết quả khảo sát 15a (5.14); vì Gemini, Copilot, Antigravity là yêu cầu chính, **15a chạy ngay sau phase 1 và 15b đến 15e chạy trước phase 8 (đã chốt, câu hỏi 21)**. Nếu 15a cho thấy công cụ nào không ghi số liệu cục bộ, phase của công cụ đó bị bỏ và ghi vào README là không hỗ trợ. Phase 17 là phase cuối, chỉ bắt đầu sau khi 6, 11, 12 chạy ổn.

Phát hành: mỗi nhóm một bản minor (đề xuất `dev ai` ở phase 1 đến 2 là 2.9.0). Không sửa `scripts/release*.js`; theo quy trình release hiện có. Thêm `ai`, `disk`, `prune` vào `SYSTEM_COMMANDS` biến chúng thành **tên dành riêng** cho recipe (`src/recipes/schema.js`), nên ghi vào release notes.

---

## 4. Phần A: `dev disk`, `dev prune` và `dev clean`

### 4.1 Hiện trạng và phase 0

`dev clean` hiện chạy `src/generators/clean-project.js`, xóa theo bảng `CLEAN_TARGETS` (ví dụ `dist`, `build`, `.cache`, `coverage`) bằng `fs.rmSync(..., { recursive: true, force: true })` **mà không kiểm tra git**. Project nào commit `dist/` hoặc dùng `build/` để chứa script (hay gặp ở Python) sẽ mất file đã được theo dõi. Git khôi phục được nhưng vẫn là bất ngờ.

Việc làm ở phase 0:

1. Trước khi xóa mỗi mục, kiểm tra nó có file nào được git theo dõi không; nếu có thì **bỏ qua và in lý do**. Kiểm tra khi làm: `spawn.js` có API đồng bộ hay chỉ bất đồng bộ (generator hiện là script đồng bộ).
2. Tách các kiểm tra dùng chung (đường dẫn nằm trong root, không theo symlink, git đang theo dõi) vào `src/disk/safety.js` để `dev clean` và `dev prune` dùng cùng một lõi.
3. Test: dựng repo git tạm có `dist/` được commit, chạy `dev clean`, `dist/` còn nguyên.

`dev reset` (xóa `node_modules` hoặc `.venv` rồi cài lại) không bị lỗi này vì nó luôn cài lại, nhưng dùng chung cổng an toàn khi cần.

### 4.2 Lệnh và flag (đã chốt cách A)

| Lệnh | Việc | Ghi chú |
| --- | --- | --- |
| `dev clean [path]` | Dọn build của **một project** | Giữ nguyên hành vi, là hành động lifecycle; không hỏi, không có danh sách chọn |
| `dev disk [path]` | Báo cáo dung lượng, chỉ đọc | `--top` đào sâu tương tác, `--large` file lớn, `--trend` xu hướng. Thêm `disk` vào `SYSTEM_COMMANDS` và `JSON_COMMANDS` |
| `dev prune [path]` | Dọn dẹp | Không tham số trong terminal: hiện menu. Lệnh con: `caches`, `projects`, `apps [tên]`, `maintenance` |

**Vì sao không gộp vào `dev clean`** (ghi lại để khỏi bàn lại):

1. `dev clean` là hành động lifecycle, nhiều nơi gọi nó (`dev parallel clean`, tool MCP `run_lifecycle`, override trong `.devcmd.json`, recipe có thể khai báo `clean` riêng). Đổi nghĩa là phá hợp đồng đang có.
2. Thao tác xóa rộng cần tên và cờ tách biệt, để gõ nhầm một cờ không chuyển từ "dọn thư mục build" sang "xóa cache cả máy".
3. Dọn toàn máy không có project nào để nhận diện, không khớp mô hình adapter của lifecycle.
Điều dùng chung là **lõi an toàn**, không phải tên lệnh.

Menu của `dev prune` (chỉ khi chạy trong terminal tương tác, không có `--json` và không có lệnh con):
```text
Analyze       → mở `dev disk --top`
Clean         → caches (công cụ dev), projects (artifact)
App caches    → cache và log của app            (phase 11)
Uninstall     → gỡ app                          (phase 12)
Maintenance   → bảo trì tối thiểu               (phase 13, tùy chọn)
```

Flag mới (thêm vào `parseArgs` và `validateCommandFlags` trong `src/utils/args.js`, mỗi flag giới hạn đúng lệnh như các flag hiện có):

- `--older-than <ngày>` (`prune`, `disk`): chỉ xét mục lâu không đụng tới (mặc định 30).
- `--root <path>` (`prune`, `disk`, lặp được): thư mục để tìm project. Không có thì dùng project gần đây.
- `--only <id|đường dẫn>` (`prune`, lặp được): chỉ dọn các mục này.
- `--all-safe` (`prune`): dọn mọi mục `safe`, dùng được trong lịch chạy tự động. Chỉ hợp lệ khi có `--yes`.
- `--min-size <kích thước>` (`disk --large`): ví dụ `500MB`.
- `--top`, `--large`, `--trend` (`disk`).
- `--apps` không cần, dùng lệnh con `dev prune apps`.
- Dùng lại `--json`, `--dry-run`, `--yes`. Hiện `--yes` chỉ hợp lệ cho `trust`, cần mở rộng cho `prune`. **`--yes` không bao giờ bỏ qua bước xác nhận nâng quyền** (4.12).
- **Không có `--permanent` ở các bản đầu**: mọi thứ ngoài cache dựng lại được đều vào Thùng rác.

Nguồn project: (1) `getExistingProjects()` (danh sách gần đây), (2) duyệt `--root` giới hạn độ sâu, bỏ qua `node_modules`, `.git` và thư mục ẩn. **Lưu ý:** `saveProjects` cắt danh sách ở 50 (`src/projects/recent.js`), nên mặc định chỉ thấy tối đa 50 project; ghi rõ trong output và khuyên dùng `--root`.

### 4.3 Kiến trúc và file

```text
src/disk/
  size.js         tính dung lượng: fs.opendir + lstat, song song có giới hạn, KHÔNG theo symlink/junction,
                  loại trùng hardlink theo (dev, ino)
  scan.js         tìm ứng viên: project (qua detectProject + adapter) và cache toàn cục
  safety.js       hạt nhân an toàn dùng chung (4.4): danh sách cấm, mức safe/review/blocked, kiểm tra root
  trash.js        chuyển vào Thùng rác theo từng hệ điều hành
  audit.js        nhật ký xóa ~/.devcmd/prune-log.jsonl
  explore.js      cây dung lượng và đào sâu cho `dev disk --top`
  report.js       gom, sắp xếp theo dung lượng, tổng reclaimable
src/cleaners/
  built-ins.json  danh mục cleaner (4.6, 4.8)
  loader.js       built-in + ~/.devcmd/cleaners/*.json (thêm CLEANERS_DIR vào src/config/index.js)
  schema.js       kiểm tra schema; cấm shell executable như recipes
  engine.js       cleaner → [{ executable, args }] hoặc danh sách đường dẫn
src/apps/
  macos.js        liệt kê app, đọc Info.plist, tìm file còn sót (4.9)
  index.js        chọn bộ theo nền tảng; Windows và Linux chỉ trả lệnh gợi ý
src/maintenance/
  built-ins.json  danh mục tác vụ bảo trì (4.10)
  engine.js
src/generators/
  remove-paths.js xóa một danh sách đường dẫn rõ ràng, kiểm tra nằm trong root (kiểu ensureInside của recipes/action-runner)
src/handlers/disk.js     handleDisk
src/handlers/prune.js    handlePrune (menu và lệnh con)
```

- Xóa **artifact theo project** đi qua child process `process.execPath remove-paths.js <root> <path>...`, cùng mẫu với `internalCleaner` hiện có, rồi qua `executeCommands` (có sẵn dry-run, thông báo, history).
- Xóa **cache toàn cục** gọi lệnh chính thức của công cụ (4.6) thay vì tự `rm`, để không hỏng khi công cụ đổi cấu trúc thư mục.
- Tính dung lượng phải chạy được trên **Windows** (CI có `windows-latest`): không gọi `du`, không theo reparse point, xử lý lỗi quyền đọc thành "không đọc được" chứ không dừng. Khi xóa trên Windows dùng `fs.rmSync` với `maxRetries` vì file chỉ đọc và đường dẫn dài hay gây lỗi.

### 4.4 Hạt nhân an toàn (dùng cho mọi thao tác xóa)

Mọi thao tác xóa đi qua một cổng duy nhất trong `src/disk/safety.js`.

**Ba mức:**

| Mức | Hiển thị | Tích sẵn | Xóa được |
| --- | --- | --- | --- |
| `safe` | có | có | có |
| `review` | có, kèm lý do | không | chỉ khi người dùng chọn rõ, và **vào Thùng rác** |
| `blocked` | không hiện như mục xóa được | không | không bao giờ |

**Cổng:**

1. **Chỉ xóa theo danh sách rõ ràng**, đã khớp một mục trong danh mục cleaner hoặc một ứng viên project đã qua cổng 4.5. Không có "xóa theo glob do người dùng gõ".
2. **Danh sách cấm cứng** (kiểm tra theo `realpath`, test phải chứng minh cấm thật sự). Danh sách khởi điểm, kiểm tra từng hệ điều hành khi làm:
   - macOS: `~/Documents`, `~/Desktop`, `~/Downloads`, `~/Pictures`, `~/Movies`, `~/Music`, `*.photoslibrary`, `~/Library/Mobile Documents` (iCloud), `~/Library/Keychains`, `~/Library/Mail`, `~/Library/Messages`, `~/Library/Safari`, Time Machine, `/System`, `/Library`, `/usr`, `/bin`, `/`.
   - Windows: thư mục `Documents`, `Desktop`, `Downloads`, `Pictures` của người dùng, `C:\Windows`, `C:\Program Files*`, gốc ổ đĩa.
   - Linux: `~/Documents` và tương tự, `/etc`, `/usr`, `/bin`, `/boot`, `/`.
   - Mọi nơi: chính thư mục home, gốc của một volume.
   - Trường hợp đặc biệt chỉ hiện dung lượng, không xóa: bản sao lưu iOS (`~/Library/Application Support/MobileSync`).
3. **Kiểm tra lại ngay trước khi xóa** cho từng đường dẫn: tồn tại, `realpath` vẫn nằm trong thư mục cho phép, không đi qua symlink ra ngoài, không trùng danh sách cấm, vẫn đúng mức đã hiển thị.
4. **Thùng rác là mặc định** cho mọi thứ không phải cache dựng lại thuần túy (mức `review`, gỡ app, mục xóa từ explorer). Cách làm theo nền tảng (kiểm tra khi làm, câu hỏi 9):
   - macOS: (a) `fs.rename` vào `~/.Trash` với tên không trùng (đơn giản, không có nút "Put Back") hoặc (b) nhờ Finder xóa qua `osascript` (có "Put Back", có thể hiện yêu cầu quyền Automation). Truyền đường dẫn qua `argv` như `buildNotificationCommand` hiện có để tránh injection.
   - Windows: Recycle Bin qua PowerShell. Linux: `gio trash`. Nếu không có công cụ tương ứng thì **không xóa** và báo rõ, không âm thầm xóa hẳn.
5. **Cache dựng lại thuần túy** (npm, pnpm, pip, ...) đi qua lệnh chính thức của công cụ, không qua Thùng rác.
6. **Nhật ký xóa** `~/.devcmd/prune-log.jsonl`: thời điểm, đường dẫn, dung lượng, mức, kết quả, `moved-to-trash` hay `tool-command`. Chỉ nằm trên máy, **không bao giờ** đưa vào MCP, snapshot hay `--json` của `dev ai`. Giới hạn kích thước và xoay vòng (mặc định 5 MB). `dev prune --log` để xem.
7. **Nâng quyền chỉ qua cổng riêng ở 4.12.** Mục `needsAdmin: true` mặc định chỉ hiển thị; chỉ chạy khi người dùng chọn rõ, xác nhận riêng và tự nhập mật khẩu cho `sudo`. Danh sách cấm ở cổng 2 vẫn áp dụng với quyền root.
8. **`--dry-run` là mặc định** cho lệnh không tương tác; xóa thật cần chọn trong menu, hoặc `--yes` kèm `--only` hoặc `--all-safe`.

### 4.5 Cổng an toàn cho artifact theo project

Mỗi ứng viên chỉ ở mức `safe` khi qua **cả bốn cổng**; thiếu một cổng thì là `review` (hiện, kèm lý do; ở phase 6 chưa cho xóa).

1. **Manifest bên cạnh:** `node_modules` cần `package.json`, `.venv` cần `pyproject.toml` hoặc `requirements*.txt`, v.v. Lấy từ `detectProject` và adapter, không tự viết lại quy tắc nhận diện.
2. **Lockfile có mặt** (với thư mục phải cài lại như `node_modules`, `.venv`).
3. **Bị git ignore:** `git check-ignore -q -- <path>` qua `spawn.js`. Không phải repo git thì coi như chưa chắc (`review`); điều này nghĩa là project không dùng git sẽ không bao giờ được dọn tự động, và output phải nói rõ lý do.
4. **Lâu không đụng tới:** thời điểm commit gần nhất (`git log -1 --format=%ct`), nếu không có thì mtime mới nhất của manifest hoặc lockfile; so với `--older-than`.

Phân loại để hiển thị: `reinstall` (xóa `node_modules`, `.venv`: cần cài lại) và `rebuild` (thư mục build: build lại). Mỗi mục ghi **lệnh tạo lại**, ví dụ `npm install`.

**Dung lượng của pnpm:** `node_modules` của pnpm dùng hardlink vào kho chung nên xóa nó **chưa chắc giải phóng đủ số byte hiển thị**. `size.js` loại trùng theo `(dev, ino)` và báo cáo ghi "ước tính" cho các mục có hardlink ra ngoài thư mục đó.

### 4.6 Cache toàn cục (phase 4 chỉ đọc, phase 6 mới xóa)

Dạng khai báo trong `cleaners/built-ins.json`: `id`, `name`, `category` (`dev-cache`, `app-cache`, `log`, `artifact`), `platforms`, `detect` (executable hoặc đường dẫn), cách đo dung lượng (đường dẫn hoặc lệnh), `clean` (`{ executable, args }` hoặc danh sách đường dẫn), `recreate` (mô tả), `tier` (`safe` hoặc `review`), `needsAdmin`, `reversible`.

| Cleaner | Lệnh dọn (kiểm tra cờ chính xác theo phiên bản khi làm) | Nền tảng | Mức |
| --- | --- | --- | --- |
| npm | `npm cache clean --force` | tất cả | safe |
| pnpm | `pnpm store prune` | tất cả | safe |
| yarn | `yarn cache clean` | tất cả | safe |
| Bun | `bun pm cache rm` | tất cả | safe |
| pip | `pip cache purge` | tất cả | safe |
| conda | `conda clean --all` | tất cả | review |
| Go | `go clean -cache`; `go clean -modcache` (mất mod cache, tải lại khi build) | tất cả | safe / review |
| Dart/Flutter | `dart pub cache clean` | tất cả | review |
| Homebrew | `brew cleanup` | macOS, Linux | safe |
| CocoaPods | `pod cache clean --all` | macOS | safe |
| Xcode DerivedData | xóa `~/Library/Developer/Xcode/DerivedData` | macOS | safe |
| Simulator không dùng | `xcrun simctl delete unavailable` | macOS | safe |
| Docker build cache | `docker builder prune` | tất cả | review |
| Docker | `docker system prune` (xóa container đã dừng và image dangling) | tất cả | review, để sau |
| Cargo, Gradle, Maven | chưa có lệnh dọn registry chính thức đủ chắc; chỉ hiển thị dung lượng | | info |

Dữ liệu của chính công cụ AI (`~/.claude/projects`, `~/.codex/sessions`, `~/.ollama`, cache Hugging Face): **chỉ hiển thị dung lượng** (mức `blocked` cho hành động xóa).

### 4.7 Phân tích: `dev disk` (chỉ đọc)

- **`dev disk`**: báo cáo theo nhóm (artifact project, cache công cụ, thông tin), tổng và tổng có thể giải phóng.
- **`dev disk --top [path]`**: đào sâu tương tác. Chọn một thư mục thì hiện các mục con xếp theo dung lượng, dùng `select` của `@clack/prompts` đã có sẵn (không thêm thư viện TUI). Mặc định không đi qua ổ khác. Thư mục bị hệ điều hành chặn (macOS TCC/Full Disk Access) hiện là "không đọc được"; công cụ **không xin quyền**. Hành động trên một mục: hiện trong trình quản lý file, sao chép đường dẫn, chuyển vào Thùng rác (có xác nhận, đi qua cổng 4.4, danh sách cấm vẫn áp dụng).
- **`dev disk --large [--min-size 500MB] [--root ...]`**: liệt kê file lớn. Chỉ để xem, không có hành động xóa.
- **`dev disk --trend`** (phase 14): ghi tổng dung lượng theo ngày và theo nhóm vào `~/.devcmd/disk-daily.json` để trả lời "tuần này cái gì phình ra". **Chỉ số tổng hợp theo nhóm, không lưu đường dẫn.** Ghi tạm rồi đổi tên.
- **Phiên bản công cụ không dùng** (phase 14): Node cũ trong nvm/fnm, runtime iOS Simulator cũ, system image Android cũ, SDK Flutter cũ. "Không dùng" được xác định bằng cách đối chiếu `.nvmrc`/`engines` của các project đã biết; mức `review`, chỉ hiển thị.
- **Project bỏ quên** (phase 14): liệt kê project không đụng tới quá N ngày kèm dung lượng. **Chỉ báo cáo, không bao giờ xóa project.**
- **Ngưỡng cảnh báo:** `dev disk --check --threshold 50GB` thoát mã 1 khi vượt, dùng trong hook hoặc lịch.

### 4.8 Cache và log của app (phase 11)

- Nguồn: macOS `~/Library/Caches/<bundle-id>` và `~/Library/Logs`; Linux `~/.cache`; Windows `%LOCALAPPDATA%\Temp` và thư mục tạm cũ hơn 7 ngày.
- Mức `review` (không tích sẵn), hiện **từng app kèm dung lượng**, chuyển vào Thùng rác. Có danh sách cho phép và danh sách cấm theo bundle id (ví dụ cấm cache của app đang chạy; kiểm tra khi làm cách phát hiện app đang chạy).
- Trình duyệt: chỉ thư mục cache, không động tới hồ sơ, mật khẩu, lịch sử.
- Thùng rác: chỉ hiện dung lượng. Đổ rác luôn là hành động riêng, người dùng tự xác nhận.
- Windows: file đang bị khóa sẽ lỗi; ghi nhận là "đang dùng", không coi là lỗi cả lệnh. Không dọn Windows Update hay các thư mục cần quyền admin cho tới phase 17 (và trên Windows chỉ ở mức gợi ý lệnh, câu hỏi 17).

### 4.9 Gỡ app (phase 12, macOS trước)

1. **Liệt kê app** trong `/Applications` và `~/Applications`, đọc `CFBundleIdentifier` từ `Info.plist` bằng `plutil -convert json -o - <file>` qua `spawn.js` (đối số riêng, không cần thư viện plist).
2. **Tìm file còn sót** trong các thư mục quen thuộc: `Application Support`, `Caches`, `Preferences/<id>.plist`, `Containers`, `Group Containers`, `Saved Application State`, `Logs`, `LaunchAgents`, `HTTPStorages`, `WebKit`. Hai mức tin cậy:
   - **Khớp chính xác bundle id** (mạnh): hiện, tích sẵn cache và trạng thái.
   - **Khớp theo tên** (yếu): hiện nhưng không tích, kèm cảnh báo.
3. **Dữ liệu người dùng** (Application Support, Containers) mặc định không tích, cảnh báo rõ rằng xóa là mất dữ liệu app.
4. **Từ chối** gỡ app hệ thống (`/System/Applications`), app đang chạy (yêu cầu thoát trước), app có bundle id nằm trong danh sách cấm.
5. App cài bằng **Homebrew cask**: dùng `brew uninstall --cask --zap` thay vì tự xóa (phát hiện qua `brew list --cask`).
6. Mọi thứ đi vào **Thùng rác**, có nhật ký; hiện tổng dung lượng và danh sách cuối cùng trước khi xác nhận.
7. **Windows và Linux:** không tự xóa. Gợi ý lệnh chính thức (`winget uninstall`, `flatpak uninstall`, `snap remove`, `apt remove`) và để người dùng tự chạy.

Test dùng cây `.app` bịa trong HOME giả; CI có runner macOS nên chạy được `plutil` thật trên `Info.plist` bịa. Thử thủ công trên tài khoản người dùng thử nghiệm hoặc máy ảo macOS trước khi phát hành.

### 4.10 Bảo trì tối thiểu (phase 13, tùy chọn)

Chỉ làm nếu chốt câu hỏi 8. Nguyên tắc: **không hứa tăng tốc**; phần lớn các việc "tối ưu" trên macOS hiện đại (xóa cache DNS, dựng lại Spotlight, dựng lại Launch Services) ít khi cải thiện đo được. Danh mục nhỏ trong `maintenance/built-ins.json`, mỗi mục ghi rõ nó làm gì, có cần admin không, có hoàn tác được không:
- Khởi động lại Dock hoặc Finder, `brew doctor`, `npm doctor`.
- Liệt kê mục khởi động cùng máy và tiến trình nặng (chỉ đọc).
- Mục cần admin (xóa cache DNS, `mdutil -E`): chỉ in lệnh cho tới phase 17; sau đó chạy được qua cổng nâng quyền ở 4.12.

### 4.11 Dạng JSON và luồng `dev prune`

`dev disk --json`:
```jsonc
{
  "scannedAt": "2026-11-26T09:00:00.000Z",
  "totals": { "bytes": 0, "reclaimableBytes": 0 },
  "items": [
    {
      "kind": "project-artifact",            // hoặc "global-cache", "app-cache", "app", "info"
      "path": "/abs/path/node_modules",      // luôn đường dẫn tuyệt đối
      "project": "my-app",
      "bytes": 0,
      "bytesIsEstimate": false,              // true khi có hardlink ra ngoài thư mục
      "ageDays": 0,
      "tier": "safe",                        // "safe" | "review" | "blocked"
      "reasons": [],                         // lý do khi không phải "safe"
      "recreate": "npm install"
    }
  ]
}
```

`dev prune` (tương tác): quét → hiện danh sách theo nhóm bằng hộp chọn nhiều mục (`@clack/prompts`), `safe` tích sẵn, `review` không tích sẵn → tổng dung lượng sẽ giải phóng → xác nhận → kiểm tra lại từng mục → xóa → báo kết quả và ghi nhật ký. `--dry-run` in các lệnh sẽ chạy, không xóa. Phase 6 **chỉ cho chọn mục `safe`**; mục `review` mở ở phase 11 và 12.

`dev prune --json` trả kết quả từng mục (`removed`, `skipped`, `failed`, lý do).

### 4.12 Nâng quyền có kiểm soát (phase 17)

Quyết định: cho phép thao tác cần quyền admin (xóa file hoặc chạy lệnh) **nếu người dùng được hỏi và tự nhập mật khẩu**. Thiết kế dưới đây thực hiện đúng ý đó mà không biến DevCmd thành đường leo thang đặc quyền.

**Quy tắc cứng:**

1. **DevCmd không bao giờ nhận, đọc, lưu hay truyền mật khẩu.** Không dùng `sudo -S`, không dùng ô nhập mật khẩu của `@clack/prompts`, không tự viết `askpass`. Tiến trình `sudo` chạy với `stdio: 'inherit'` (`runProcess` đã hỗ trợ), nên mật khẩu đi thẳng từ bàn phím tới `sudo`. Có test quét mã nguồn để cấm `-S`, `--stdin` và `askpass`.
2. **Chỉ qua `src/runner/elevate.js`** (cùng vai trò với `spawn.js`): dựng `{ executable: 'sudo', args: ['-k', '--', ...] }`. Cờ `-k` bỏ qua xác thực `sudo` đã nhớ, nên **mỗi lần nâng quyền đều phải nhập mật khẩu** (đã chốt, câu hỏi 18). Không có `sudo -v` giữ phiên, không dựa vào `NOPASSWD`.
3. **Chỉ chạy thao tác khai báo trong danh mục** (`needsAdmin: true`, `executable` và `args` cố định, hoặc đường dẫn đã qua mọi cổng). Không có "chạy lệnh tùy ý với quyền root".
4. **Hỏi riêng, rõ ràng.** Trước khi gọi `sudo`, hiện **danh sách chính xác** các lệnh hoặc đường dẫn sẽ chạy với quyền root và hỏi xác nhận riêng ("Cho phép chạy các lệnh sau với quyền quản trị?"). `--yes`, `--all-safe` và chế độ không tương tác **không bao giờ** thay thế bước này. Không có TTY thì từ chối.
5. **Danh sách cấm vẫn áp dụng với root** (cổng 2 của 4.4), thêm: `/System`, `/usr`, `/bin`, `/sbin`, `/etc`, `/Library/Apple`, `/private/var/db`, gốc ổ đĩa. SIP trên macOS chặn cả root ở nhiều nơi; DevCmd không cố vượt qua.
6. **Chống đổi đường dẫn giữa lúc kiểm tra và lúc xóa (TOCTOU).** Xóa bằng quyền root chỉ cho đường dẫn mà **mọi thư mục cha đều thuộc root và không ghi được bởi nhóm hay người khác** (kiểm tra bằng `lstat`: uid 0, `mode & 0o022 === 0`). Nếu một thư mục cha người dùng ghi được thì từ chối, vì tiến trình khác của cùng người dùng có thể đổi symlink trong lúc ta chờ mật khẩu. **Không chạy mã Node nằm trong thư mục người dùng ghi được bằng quyền root:** xóa bằng root dùng công cụ hệ thống với đối số cố định (`/bin/rm -rf -- <đường dẫn đã realpath>`), **không** `sudo node remove-paths.js`.
7. **Ghi nhật ký** `elevated: true` kèm lệnh và kết quả. File thuộc root bị xóa **hẳn, không qua Thùng rác**, nên hiển thị "không hoàn tác được", không tích sẵn, và chỉ cho mục có `reversible: false` đã được duyệt trong danh mục.
8. **Không có trong MCP** (không tool nào nâng quyền), không trong lịch chạy tự động, không trong `dev again` (`replayable: false`).
9. **Theo nền tảng:** macOS và Linux dùng `sudo` (cần TTY). Windows: UAC qua PowerShell `Start-Process -Verb RunAs` với đối số mảng, **chưa cam kết** (câu hỏi 17); trong lúc đó Windows chỉ in lệnh.

**Thao tác dự kiến cho phép ở bản đầu** (mỗi mục phải được duyệt riêng trong danh mục, kiểm tra khi làm):
- Bảo trì: xóa cache DNS (`dscacheutil -flushcache`, `killall -HUP mDNSResponder`), `mdutil -E`.
- Cache và log toàn máy qua danh mục: `/Library/Caches/<id>`, `/Library/Logs`, `/private/var/log` (cũ hơn N ngày).
- Gỡ app cài toàn máy thuộc root. **LaunchDaemons và LaunchAgents hệ thống** chỉ sau `launchctl bootout` và chỉ khi khớp bundle id chính xác; mức rủi ro cao nhất, để sau cùng trong phase 17.
- **Không có:** sửa cấu hình hệ thống, cài đặt phần mềm, đổi quyền, hay bất cứ thứ gì ngoài danh mục.

**Test (`elevate.test.js`):** `spawnImpl` giả kiểm tra đối số đúng `['-k', '--', ...]` và không có `-S`; từ chối khi không có TTY; từ chối đường dẫn trong danh sách cấm; từ chối khi có thư mục cha người dùng ghi được; `--yes` không bỏ qua xác nhận; nhật ký có `elevated`. Thử thủ công trên máy ảo macOS với tài khoản thử nghiệm, không trên máy chính.

---

## 5. Phần B: `dev ai`

### 5.1 Lệnh và flag

`dev ai [today|week|month|report]`, mặc định `month`, cùng ngữ nghĩa với aicost. Thêm `ai` vào `SYSTEM_COMMANDS` và `JSON_COMMANDS`.

Flag mới (chỉ hợp lệ cho `ai`, mỗi flag giới hạn đúng lệnh trong `validateCommandFlags`):

- Lọc và nhóm: `--by day|week|month|project|model|tool|session|branch|client`, `--tool <id>` (lặp được; id gồm `claude`, `codex`, `gemini`, `copilot`, `antigravity` và các nguồn khác ở 5.14), `--model <text>`, `--since`, `--until` (chỉ `report`), `--repo <text>`.
- Nguồn: `--tools` liệt kê các nguồn, trạng thái phát hiện, mức xác minh và loại tính phí (5.14).
- Ngân sách và cảnh báo: `--check`, `--short`, `--notify`, `--prices`, `--print-statusline-config`.
- Lịch sử và nhiều máy: `--history`, `--machines`, `--export-snapshot [file]`, `--import-snapshot <file>`.
- Phân tích: `--sessions <n>`, `--pr` (dùng mạng, mặc định tắt), `--allocate-plan`.
- Định dạng: `--format table|json|csv|md|html|openmetrics`.
- Lệnh con: `dev ai clients [add <tên> <đường dẫn> | remove <tên>]` (5.10).

**Xung đột tên:** `--project` trong `dev-cmd` hiện chỉ dành cho `history` và nhận một **đường dẫn**; aicost dùng `--project TEXT` để lọc theo tên thư mục. Đề xuất dùng `--repo <text>` cho `dev ai` để không làm một flag mang hai nghĩa. (Câu hỏi 1.)

Ngoài ra repo đã dùng "ai" cho nghĩa khác (`.ai/skills` là skill cho AI agent, test `ai-skills.test.js`). Đặt tên file test mới là `ai-cost-*.test.js` để khỏi nhầm.

### 5.2 Kiến trúc và file

```text
src/ai/
  model.js        Tokens, Usage, Tool
  pricing.js      bảng giá, khớp tên model, tokens → USD
  query.js        kỳ, bộ lọc, nhóm, múi giờ, parseDate (today, yesterday, 7d, 2w, 3m)
  report.js       gom thành hàng, tổng, model chưa có giá, thống kê quét
  scan.js         tìm file, đọc song song có giới hạn, bỏ trùng, đếm dòng bỏ qua
  lines.js        quét dòng bằng Buffer thô (không dùng readline), lọc theo byte
  cache.js        cache quét tăng dần theo (đường dẫn, kích thước, mtime, vị trí byte)
  sqlite.js       đọc SQLite chỉ đọc: node:sqlite nếu có, nếu không thì `sqlite3` CLI (5.14)
  sources/index.js   đăng ký nguồn, `billing`, `maturity`
  sources/claude.js
  sources/codex.js
  sources/gemini.js, copilot.js, antigravity.js, ...   (phase 15, 5.14)
  data/pricing.toml
src/handlers/ai.js
```

- **Quét log bằng Buffer thô, không dùng `readline`.** Đo trên log thật của tác giả (2,1 GB, 218 file JSONL, 42.309 dòng usage): đọc theo khối Buffer, tìm `"usage"` bằng `indexOf` trên byte rồi mới `toString` và `JSON.parse` các dòng khớp mất **khoảng 1,1 giây**; `readline` kèm `includes` rồi `JSON.parse` mất **khoảng 5,3 giây**, cho cùng kết quả. (Đo một máy, hai lần chạy, bộ nhớ đệm hệ điều hành đã nóng; đo lại khi làm.) Dùng khối đọc 1 đến 4 MB, xử lý dòng vắt qua ranh giới khối, và bỏ qua dòng vượt ngưỡng kích thước để bộ nhớ không phình (file lớn nhất là 425 MB). Tương tự với `"token_count"`, `"turn_context"`, `"session_meta"` (Codex).
- **Cache quét tăng dần.** Mỗi lần quét đầy đủ vẫn mất khoảng 1 giây, quá chậm cho status line và `--check`. Log là file chỉ nối thêm, nên lưu cache `~/.devcmd/ai-scan-cache.json` khóa theo `(đường dẫn, kích thước, mtime)` cùng **vị trí byte đã đọc** và các bản ghi usage rút gọn; lần sau chỉ đọc phần mới. File nhỏ đi hoặc mtime lùi (bị ghi lại) thì đọc lại từ đầu. Bỏ trùng làm trên tập bản ghi đã gom (khóa `message.id:requestId`). Cache chỉ chứa số tổng hợp theo bản ghi, không nội dung. Chỉ làm khi đo cho thấy cần (mục tiêu `--short` dưới 100 ms, xem T1 về khởi động).
- `package.json` đã có `files: ["dev", "src"]` nên `src/ai/data/` được phát hành; kiểm tra bằng `npm pack --dry-run` (CI đã chạy).
- `--json` của `dev-cmd` hiện đồng bộ (`collectJson` trong `src/handlers/json.js`, `runJson` trong `src/cli.js`). Quét log là bất đồng bộ, nên cần cho `runJson` hỗ trợ `await`. Đây là thay đổi nhỏ nhưng chạm vào đường chạy chung, cần test.
- `pricing.toml` cần bộ đọc TOML (Node không có sẵn). Đề xuất thư viện nhỏ không dependency con như `smol-toml` (kiểm tra giấy phép, độ ổn định, hỗ trợ Node 20.12 khi làm) để dùng chung được file giá của người dùng `~/.config/aicost/pricing.toml`. Cấm trường lạ trong `[[model]]`, giống aicost.
- **Đã chốt (câu hỏi 3): port phần AI sang JS** trong `dev-cmd`, không gọi `aicost` bên ngoài. Hệ quả: `dev ai` tự đủ, không phụ thuộc công cụ khác; đổi lại bảng giá và quy tắc số liệu tồn tại ở hai nơi (dev-cmd và aicost) trong giai đoạn parity, nên 5.8 là bắt buộc, không phải tùy chọn.

### 5.3 Quy tắc số liệu phải giữ y hệt aicost

Đây là phần dễ sai âm thầm nhất, nên liệt kê rõ. Các quy tắc này áp dụng cho Claude và Codex (có parity với aicost); nguồn khác có quy tắc riêng trong `docs/AI-SOURCES.md` (5.14):

- **Claude:** khóa bỏ trùng là `message.id:requestId`; bỏ model bắt đầu bằng `<` (`<synthetic>`); dòng usage rỗng thì bỏ; dòng hỏng thì đếm vào `skipped_lines`. `cache_write_5m` = phần tách 5m cộng phần không giải thích được; `cache_write_1h` = phần tách 1h.
- **Codex:** log ghi tổng chạy của session; một request là **hiệu hai tổng liên tiếp**; tổng giảm nghĩa là bộ đếm đã khởi động lại, tính toàn bộ tổng mới; `input_tokens` đã chứa `cached_input_tokens` nên `input = input - cached`; `output_tokens` đã chứa reasoning. Sự kiện `token_count` không có `info` thì bỏ.
- **Giá:** tên model khớp đúng tên hoặc tên cộng mốc ngày 8 chữ số (`-20261001`, `@20261001`), bỏ hậu tố `[1m]`; **không bao giờ khớp phiên bản dài hơn** (`claude-sonnet-5` không bắt `claude-sonnet-5-6`). Thiếu giá cache thì mặc định bằng giá `input`.
- **Thời gian:** ngày tính theo múi giờ cục bộ; tuần bắt đầu thứ Hai; kỳ chứa cả hai đầu; bỏ qua file có mtime trước `since` trừ một ngày đệm.
- **Số:** tổng token là số nguyên không âm; tiền là số thực (JS `Number`), hiển thị làm tròn đến cent; sắp xếp xác định (nhóm theo thời gian: cũ đến mới; nhóm khác: chi phí giảm dần, rồi token, rồi khóa).

### 5.4 Cấu hình và ngân sách

Thêm khóa vào `DEFAULT_CONFIG`, `CONFIG_KEYS`, `parseConfigValue`, `validateConfig` trong `src/config/user.js`:

- `aiBudget`: ngân sách tháng (USD, số không âm; mặc định không đặt).
- `aiPlan`: giá gói thuê bao hàng tháng (USD), để so với giá API.
- `aiClients`: ánh xạ đường dẫn sang tên khách hàng (phase 8, mục 5.10). Là object, không phải giá trị đơn, nên **không** đặt qua `dev config set` (`parseConfigValue` chỉ xử lý giá trị đơn); quản lý bằng `dev ai clients`, kiểm tra trong `validateConfig`.
- `aiAnomalyFactor` (mặc định 3), `aiAnomalyMinUsd` (mặc định 5): ngưỡng cảnh báo bất thường (phase 10, mục 5.12).
- `aiPriceStaleDays` (mặc định 90): sau bấy nhiêu ngày thì nhắc bảng giá cũ (mục 5.16).
- `aiMachine`: nhãn máy khi xuất snapshot (phase 16, mục 5.15); mặc định là mã ngẫu nhiên lưu trong config, không dùng tên máy thật.

Hành vi (phase 5):
- Hiện phần trăm đã dùng và **dự báo cuối tháng** theo nhịp hiện tại (ghi rõ đây là ước tính tuyến tính, không phải cam kết).
- `dev ai --check`: thoát mã 1 khi đã vượt ngân sách, 0 nếu không. Dùng được trong CI hoặc hook.
- `dev ai --short`: một dòng gọn cho status line hoặc prompt, ví dụ tiền hôm nay và phần trăm ngân sách tháng.
- Có `notify` sẵn trong config; không thêm cơ chế thông báo mới ở bản đầu.

### 5.5 Lịch sử theo ngày (snapshot)

Vì công cụ có thể tự xóa log cũ (tôi nhớ Claude Code mặc định giữ khoảng 30 ngày; **kiểm tra lại**), mỗi lần `dev ai` chạy sẽ ghi tổng theo ngày vào `~/.devcmd/ai-daily.json` (thêm `AI_DAILY_FILE` vào `src/config/index.js`).

- **Chỉ lưu số tổng hợp** theo `(ngày, tool, model)`: số request, token từng loại, chi phí. Không lưu nội dung, không lưu tên project, không lưu session.
- Quy tắc cập nhật: với mỗi khóa, **giữ bản có số request lớn hơn**. Như vậy ngày mà log đã bị xóa không bị ghi đè bằng số nhỏ hơn.
- `dev ai --history` đọc file này để xem các tháng vượt quá phạm vi log hiện còn.
- Chi phí lưu theo bảng giá lúc ghi; ghi kèm phiên bản bảng giá để biết khi giá đổi.
- Ghi file theo kiểu an toàn (ghi tạm rồi đổi tên), vì hai lệnh `dev` có thể chạy cùng lúc.

**Giới hạn của snapshot:** snapshot chỉ giữ `(ngày, tool, model)`, nên phân tích theo nhánh, project, khách hàng và phiên (5.9, 5.10, 5.13) **chỉ dùng được với log còn trên đĩa**; phần log đã bị công cụ xóa không phân tích lại được. Có thể mở rộng snapshot để lưu thêm tổng theo `client` (chỉ nhãn do người dùng cấu hình, không có đường dẫn), nhưng việc đó làm lộ tên khách trong file cục bộ nên cần chốt (câu hỏi 13).

### 5.6 Chỉ số hiệu quả (phase 7)

Chỉ dùng dữ liệu đã đọc, không cần quyền mới:
- Tỉ lệ cache: `cache_read / (input + cache_read + cache_write)`.
- Cơ cấu model: phần trăm chi phí theo model; gợi ý "nếu chạy trên model rẻ hơn" chỉ là con số ước tính, ghi rõ không đảm bảo chất lượng.
- Phần của sub-agent: cần đọc `isSidechain` ở Claude, hiện aicost chưa lấy trường này. Thêm vào đây thì **aicost cũng phải thêm** (quy tắc hai bản đi cùng nhau).
- So giá thuê bao với giá API (`aiPlan`).
- **Phiên đắt nhất** (`--sessions <n>`): chi tiết ở 5.13.
- Mặc định lọc theo project hiện tại khi chạy trong một project (`detectProject`), tắt bằng `--all`. Chỉ là xấp xỉ vì aicost gắn project theo tên thư mục làm việc, còn `dev-cmd` theo thư mục gốc project.

### 5.7 Tool MCP (phase 7)

Chỉ một tool **chỉ đọc** `ai_cost` trong `src/mcp/tools.js`, trả số tổng hợp. Quyết định riêng tư: không cho nhóm theo `project`, `session`, `branch` hay `client` qua MCP (tên project, nhánh, khách hàng sẽ lộ cho agent); chỉ `day|week|month|model|tool`. Không có tool xóa nào.

### 5.8 Giữ đồng bộ với aicost (hai repo khác nhau)

`dev-cmd` và aicost nằm ở hai repo riêng, nên **không dùng được** test chống lệch tự động kiểu "so hai file trong cùng cây thư mục". Thay bằng:

1. Chép fixture bịa của aicost vào `test/fixtures/ai/` và dùng **cùng số kỳ vọng tính tay** (9 request, 2 bản trùng, 1 dòng hỏng; Claude 14.600 token, Codex 4.180 token; chi phí từng dòng). Số này đã được kiểm chứng giữa ba bản.
2. Script chạy tay `scripts/ai-parity.js`: chạy `dev ai --json` và `aicost --format json` (nếu có cài; máy này có sẵn `~/.cargo/bin/aicost`) trên cùng một bộ log, so từng trường, in IDENTICAL hoặc DIFF. Dùng trước mỗi lần phát hành phần `ai`, kể cả trên log thật (chỉ so, không in nội dung).
3. `pricing.toml` và fixture là bản sao; ghi rõ nguồn và ngày chép trong đầu file `src/ai/data/pricing.toml`. Khi giá đổi ở bản nào, sửa cả hai.

**Bản chuẩn lâu dài là `dev-cmd` (JS)** (đã chốt, câu hỏi 3). aicost (Rust) vẫn dùng làm bản đối chiếu trong giai đoạn parity; việc có tiếp tục bảo trì aicost hay không là quyết định riêng, ngoài phạm vi plan này. Khi hai bản lệch nhau, **số kỳ vọng tính tay trong fixture là chuẩn**, không phải bản nào trong hai.

### 5.9 Chi phí theo nhánh git và PR (phase 8)

Mục tiêu: trả lời "tính năng hoặc PR này tốn bao nhiêu AI".

- Lệnh: `dev ai --by branch [--repo <text>] [--since ...]`; tùy chọn `--pr` để gắn số PR.
- **Nguồn dữ liệu (kiểm tra khi làm trên log thật, chỉ xem tên trường):** Claude Code theo tôi nhớ ghi thư mục làm việc và nhánh git trên từng dòng (tên trường dự kiến `cwd`, `gitBranch`); Codex có `session_meta` và `turn_context` với thư mục làm việc và có thể có thông tin git. Nguồn nào thiếu nhánh thì vào nhóm `(không rõ)`, vẫn hiện số liệu, **không đoán nhánh từ tên thư mục**.
- **Thuật toán:** gán từng request cho `(repo, nhánh)` của chính dòng đó, không gán cả phiên cho một nhánh, vì phiên có thể đổi nhánh giữa chừng. `repo` là thư mục làm việc quy về gốc project bằng `detectProject` khi được, nếu không thì giữ nguyên thư mục. Mỗi git worktree có nhánh riêng nên vẫn đúng. HEAD tách rời vào nhóm `(detached)`.
- **Cột:** repo, nhánh, chi phí, request, token, lần hoạt động đầu và cuối.
- **`--pr` (mặc định tắt, dùng mạng):** chạy `gh pr list --state all --json number,headRefName,state` qua `spawn.js` trong repo và khớp theo `headRefName`. Chỉ hiện số PR và trạng thái, **không hiện tiêu đề**. Chưa cài `gh` hoặc chưa đăng nhập thì báo rõ và vẫn hiện bảng theo nhánh. Gắn nhãn rõ khi dùng mạng. **Không bao giờ bật trong MCP hay `--check`.**
- **JSON:** `{ "by": "branch", "rows": [{ "repo": "...", "branch": "...", "pr": { "number": 0, "state": "MERGED" }, "cost": 0, "requests": 0, "tokens": {} }] }`; `pr` là `null` khi không có.
- **Giới hạn** (ghi trong output): chỉ dùng log còn trên đĩa (5.5); nhánh dài hạn như `main` gom nhiều việc khác nhau.
- **Test:** fixture bịa có đổi nhánh giữa phiên, thiếu trường nhánh, nhiều worktree, HEAD tách rời; `--pr` với `gh` giả qua `spawnImpl`, `gh` không tồn tại, `gh` chưa đăng nhập.

### 5.10 Chi phí theo khách hàng (phase 8)

Mục tiêu: biết AI tốn bao nhiêu cho từng khách, phục vụ báo giá và đối soát.

- **Cấu hình `aiClients`:** `{ "Khách A": ["~/work/client-a"], "Khách B": ["~/work/client-b", "D:\\work\\b"] }`. Quy tắc kiểm tra: tên không rỗng, tối đa 60 ký tự, không có ký tự điều khiển; mỗi đường dẫn là đường dẫn tuyệt đối hoặc bắt đầu bằng `~/`; không cho hai khách cùng một đường dẫn; **không dùng glob hay regex**, chỉ tiền tố đường dẫn.
- **Khớp:** tiền tố **dài nhất** thắng; trên Windows không phân biệt hoa thường; `~` mở rộng qua tham số `homeDir`; không khớp thì vào `(chưa gán)`.
- **Quản lý:** `dev ai clients` liệt kê khách và phần chi phí còn `(chưa gán)` để gợi ý thêm ánh xạ; `dev ai clients add <tên> <đường dẫn>`; `dev ai clients remove <tên>`. Ghi qua `saveConfig` có kiểm tra.
- **Báo cáo:** `dev ai report --by client --since 2026-11-01 --until 2026-11-30 --format csv|md|html`. Chi phí là **quy đổi theo giá API**; ghi rõ đó không phải số tiền thực trả khi dùng gói thuê bao. `--allocate-plan` chia `aiPlan` theo tỉ lệ sử dụng của từng khách (tùy chọn, ghi rõ là phân bổ).
- **Riêng tư:** tên khách chỉ có trong báo cáo cục bộ; không vào snapshot mặc định (câu hỏi 13) và không bao giờ vào MCP.
- **Test:** tiền tố dài nhất, `~` qua `homeDir`, Windows không phân biệt hoa thường, đường dẫn trùng bị từ chối, nhóm `(chưa gán)`, `--allocate-plan` cộng đúng bằng `aiPlan`.

### 5.11 Xuất báo cáo (phase 9)

- `--format table|json|csv|md|html|openmetrics`, in ra stdout (người dùng tự chuyển hướng ra file). Lõi trả dữ liệu; mỗi định dạng là một hàm thuần trong `src/ai/format/<tên>.js`.
- **csv:** theo RFC 4180. **Chống CSV injection:** ô bắt đầu bằng `=`, `+`, `-`, `@`, tab hoặc xuống dòng được thêm dấu `'` ở đầu, vì tên project, nhánh hay khách hàng có thể do người khác đặt.
- **html:** một file độc lập, **không script**, không tải tài nguyên ngoài, **escape mọi giá trị** (tên project có thể chứa thẻ HTML).
- **md:** bảng, escape ký tự `|`.
- **openmetrics:** `devcmd_ai_cost_usd{tool,model,period}`, `devcmd_ai_tokens{tool,model,type}`, `devcmd_ai_requests{tool,model}`; nhãn **chỉ** gồm giá trị từ danh sách cố định (tool, model, kỳ), **không có** project, nhánh, khách để không lộ qua hệ thống giám sát; kết thúc bằng `# EOF`. Dùng với textfile collector chạy theo lịch.
- **Test:** golden file cho từng định dạng; test thoát ký tự (`<script>`, `=cmd|...`, `|`, dấu nháy, Unicode); openmetrics hợp lệ về cú pháp.

### 5.12 Status line và cảnh báo bất thường (phase 10)

- **`dev ai --short` phải nhanh** vì status line gọi liên tục: dùng cache ngắn hạn `~/.devcmd/ai-short-cache.json` (hết hạn sau 30 giây, quét lại khi hết hạn). Mục tiêu dưới 100 ms khi trúng cache (đo khi làm, không hứa trước). Ghi cache theo kiểu ghi tạm rồi đổi tên.
- **`dev ai --print-statusline-config`:** chỉ **in** đoạn cấu hình để người dùng tự dán vào cài đặt status line của Claude Code (định dạng cần kiểm tra theo tài liệu hiện hành). **Không tự sửa file cài đặt của bất kỳ công cụ nào.**
- **Bất thường:** `dev ai --check` ngoài ngân sách còn so chi phí hôm nay với **trung vị 7 ngày gần nhất có hoạt động** (lấy từ snapshot). Cần ít nhất 3 ngày lịch sử mới đánh giá. Cảnh báo khi hôm nay lớn hơn `aiAnomalyFactor` lần trung vị **và** lớn hơn `aiAnomalyMinUsd`, để tránh ồn khi số tiền nhỏ.
- **Mã thoát của `--check`:** 0 bình thường; 1 vượt ngân sách; 2 bất thường (nếu cả hai thì 1). Ghi rõ trong `--help` và README.
- **Thông báo:** dùng lại cơ chế thông báo hệ thống đang có (`sendNotification` trong `src/runtime/execute.js`, cần xuất ra để dùng chung) khi chạy kèm `--notify`. **Không có tiến trình nền.** Lên lịch là việc của người dùng (cron, launchd, Task Scheduler hoặc hook của Claude Code); README có ví dụ.
- **Test:** trung vị, ngưỡng, lịch sử không đủ, cache hết hạn theo đồng hồ giả, các mã thoát.

### 5.13 Phiên đắt nhất (phase 7)

- `dev ai --sessions <n>` (mặc định 10): top N phiên theo chi phí.
- **Cột:** mã phiên rút gọn (8 ký tự đầu), công cụ, repo, nhánh, bắt đầu, thời lượng, số request, token, tỉ lệ cache, số token vào lớn nhất trong một request, chi phí, model chiếm nhiều nhất, và số lần gọi theo **tên công cụ** (ví dụ Bash, Edit) nếu log có (kiểm tra khi làm).
- **Gợi ý:** cột nhãn tính từ số liệu (tỉ lệ cache thấp, ngữ cảnh rất lớn, một model đắt chiếm phần lớn chi phí). **Không đọc nội dung hội thoại** và không kết luận về chất lượng công việc.
- **Test:** sắp xếp xác định, phiên không có timestamp, phiên chỉ có một request, phiên đa model.

### 5.14 Nguồn dữ liệu khác: Gemini, Copilot, Antigravity và các công cụ khác (phase 15a đến 15f)

Yêu cầu đã chốt: `dev ai` hỗ trợ **Gemini CLI, GitHub Copilot, Antigravity** và các công cụ tương tự.

**Khảo sát sơ bộ trên máy tác giả (2026-11-26, chỉ tên thư mục cấp một, không đọc nội dung):**

| Công cụ | Dấu vết cục bộ | Ghi chú |
| --- | --- | --- |
| Gemini CLI | `~/.gemini/` (có `history`, `config`) | không thấy lệnh `gemini` trong PATH |
| Antigravity | `~/.gemini/antigravity*` và `~/Library/Application Support/Antigravity` | cùng thư mục gốc với Gemini; cần kiểm chứng quan hệ |
| GitHub Copilot CLI | `~/.copilot/` (`session-state`, `session-store.db`, `logs`) | có SQLite; không thấy lệnh `copilot` trong PATH |
| Copilot Chat (VS Code) | `.../Code/User/globalStorage/github.copilot-chat` | |
| OpenCode | `~/.local/share/opencode/` (`opencode.db`, `storage`) | SQLite và file; binary ở `~/.opencode/bin` |
| Cursor, Windsurf, Amp, Aider | không thấy | theo hiểu biết của tôi, Cursor và Windsurf lưu số liệu dùng ở máy chủ |

Bảng này chỉ cho biết có thư mục. **Nó chưa chứng minh** log có ghi token hay chi phí; đó là việc của phase 15a.

**Mô hình tính phí.** Đổi mô hình `Usage` ngay từ phase 1 để khỏi sửa lõi sau. Mỗi bản ghi có `billing`:

- `tokens`: có số token, tính tiền bằng `pricing.toml` (như Claude, Codex).
- `reported-cost`: công cụ tự ghi chi phí (nhiều extension kiểu Cline làm vậy); dùng đúng số đó, ghi nhãn "do công cụ báo cáo", không nhân thêm giá.
- `requests-only`: chỉ có số request hoặc hạn mức (kiểu premium request của Copilot); hiện số request, cột chi phí là `n/a`. **Không bao giờ tự quy ra USD** nếu không có giá chính thức, và tổng tiền không cộng các dòng này.

Báo cáo luôn ghi nguồn của từng con số và **không trộn âm thầm** các loại trong một tổng tiền.

**Giao diện nguồn** (`src/ai/sources/`): `{ id, name, billing, maturity, detect(homeDir), files(homeDir, since), parse(file) → Usage[] }`, đăng ký ở `sources/index.js`. `maturity` là `verified` hoặc `experimental`; nguồn `experimental` phải được bật rõ (`--tool <id>` hoặc `aiTools`) và hiện nhãn `(thử nghiệm)`.

**SQLite.** Nhiều công cụ lưu trong SQLite (OpenCode, Copilot CLI, VS Code). Node >= 20.12 không có `node:sqlite` ổn định. Hướng làm, không thêm dependency native:
1. Dùng `node:sqlite` khi có.
2. Nếu không, gọi `sqlite3` qua `spawn.js` với `-readonly -json` và câu SQL **cố định**, không ghép chuỗi từ đầu vào.
3. Nếu không có cả hai thì nguồn báo "cần sqlite3", không lỗi.

Mở DB ở chế độ chỉ đọc, **không bao giờ ghi hay checkpoint**. Các DB đang có file WAL, nên kiểm tra khi làm cách đọc không khóa và không làm hỏng dữ liệu của công cụ.

**Quy trình bắt buộc cho mỗi công cụ (phase 15a, không viết parser trước khi xong):**
1. Tìm nơi lưu và phiên bản công cụ đã thử.
2. Chỉ liệt kê tên trường, bảng, cột. Không đọc nội dung hội thoại.
3. Xác định: có token từng request không; có tên model; timestamp và múi giờ; khóa bỏ trùng ổn định.
4. Viết mục của công cụ trong `docs/AI-SOURCES.md`: nơi lưu, trường, phiên bản đã thử, kiểu `billing`, giới hạn.
5. Làm fixture bịa theo đúng định dạng đó và tính tay số kỳ vọng.

**Phase và thứ tự thực hiện (đã chốt, câu hỏi 21):**
- **15a** khảo sát (không đổi code; **làm ngay sau phase 1** để biết công cụ nào làm được).
- **15b** khung nguồn, `billing`, `maturity`, `--tools`, `sqlite.js`.
- **15c** Gemini CLI. **15d** GitHub Copilot (CLI, và Chat nếu có số liệu). **15e** Antigravity. Cả 15b đến 15e **chạy sau phase 7 và trước phase 8**.
- **15f** nhóm còn lại, từng công cụ một: OpenCode, Cline/Roo/Kilo (extension VS Code), Aider, Amp. Chạy **sau phase 14**.

**Ghi chú theo công cụ (đều là giả thuyết cần 15a xác nhận):**
- **Gemini CLI:** giá model lấy từ trang chính thức vào `pricing.toml`, vẫn theo quy tắc `n/a` nếu chưa có giá. Nếu có bậc giá theo độ dài ngữ cảnh thì `pricing.toml` phải hỗ trợ bậc (kiểm tra khi làm).
- **GitHub Copilot:** tính theo hạn mức và premium request, rất có thể chỉ là `requests-only`. Không suy ra USD.
- **Antigravity:** kiểm chứng xem dùng chung dữ liệu với Gemini hay riêng, và có hỗ trợ nhiều model không.
- **Cursor, Windsurf:** nếu không có log cục bộ đủ dùng thì ghi vào README là không hỗ trợ, đúng nguyên tắc "không đoán".
- **Aider:** lưu theo từng project (không có thư mục trung tâm), nên cần `aiSourceRoots`.

**Cấu hình:** `aiSourceRoots` (id nguồn → danh sách thư mục thêm), `aiTools` (danh sách id bật mặc định).

**`dev ai --tools`:** hiện từng nguồn: có phát hiện dữ liệu không, `maturity`, `billing`, số file, số dòng bỏ qua.

**Parity:** aicost chỉ có Claude và Codex, nên các nguồn mới **không có parity**; ghi rõ "chỉ có ở dev-cmd" và kiểm bằng số tính tay (mở rộng 5.8). Dòng lỗi định dạng đếm vào `skipped_lines` và hiển thị.

**Riêng tư:** chỉ số tổng hợp. Không đọc, không lưu, không in nội dung hội thoại hay đường dẫn riêng tư.

**Test:** mỗi nguồn một file `ai-cost-source-<id>.test.js` với fixture bịa và số kỳ vọng tính tay; test nguồn thiếu `sqlite3`; test không bao giờ ghi vào DB nguồn.

### 5.15 Gộp dữ liệu nhiều máy (phase 16)

- `dev ai --export-snapshot [file]` xuất snapshot theo ngày (chỉ số tổng hợp, không nhánh, không project, không khách) kèm nhãn máy `aiMachine`.
- `dev ai --import-snapshot <file>` lưu vào `~/.devcmd/ai-imported/<nhãn-máy>.json`, **tách khỏi** `ai-daily.json` của máy này để quy tắc "giữ số lớn hơn" không trộn giữa các máy. Nhập lại cùng một máy thì thay thế file của máy đó (idempotent).
- `dev ai --machines`: báo cáo cộng dồn máy này và các máy đã nhập.
- **File nhập là đầu vào không tin cậy:** kiểm tra schema chặt (phiên bản, ngày đúng định dạng, số không âm, tên tool và model theo mẫu, giới hạn kích thước 5 MB), từ chối trường lạ, không dùng object thường làm bản đồ khóa do file kiểm soát (tránh prototype pollution), nhãn máy chỉ gồm `[A-Za-z0-9_-]` tối đa 40 ký tự (chặn `../x`).
- Không đồng bộ qua mạng; người dùng tự chuyển file.
- **Test:** nhập lặp, file hỏng, trường lạ, nhãn máy độc hại, cộng dồn đúng.

### 5.16 Bảng giá và cảnh báo cũ (phase 10)

- Đầu `pricing.toml` có `updated = "2026-11-26"` và nguồn giá. `dev ai --prices` in bảng giá đang dùng kèm ngày cập nhật và liệt kê model đã dùng nhưng chưa có giá (`n/a`).
- Cảnh báo khi bảng giá cũ hơn `aiPriceStaleDays` ở chân bảng và trong `--check` (chỉ nhắc, không làm lệnh thất bại). Không gọi mạng để cập nhật.
- **Test:** tính tuổi bảng giá bằng đồng hồ giả; model thiếu giá hiện `n/a`, không bao giờ tính bằng 0.

---

## 6. Việc chung cho mọi phase

- **Docs:** README (bảng lệnh, ví dụ, mục "Không xác minh trên Windows" cho phần chưa kiểm chứng), `docs/ARCHITECTURE.md` (thêm tầng `src/disk`, `src/cleaners`, `src/apps`, `src/maintenance`, `src/ai`, sơ đồ luồng), `printHelp` trong `src/cli.js`, script completion trong `src/commands/completion.js`.
- **Skill cho AI agent:** thêm `.ai/skills/devcmd-add-cleaner/SKILL.md` khi danh mục cleaner ổn (phase 4 trở đi) và cập nhật `devcmd-review-command-safety` cho các thao tác xóa; theo mẫu các skill hiện có.
- **Test (`node --test`):** mỗi module một file test. Tên đề xuất: `disk-size.test.js`, `disk-safety.test.js` (gồm danh sách cấm và `realpath`), `disk-trash.test.js`, `disk-scan.test.js`, `disk-explore.test.js`, `cleaners.test.js`, `prune.test.js`, `prune-audit.test.js`, `apps-macos.test.js`, `ai-cost-claude.test.js`, `ai-cost-codex.test.js`, `ai-cost-pricing.test.js`, `ai-cost-query.test.js`, `ai-cost-report.test.js`, `ai-cost-snapshot.test.js`, `ai-cost-config.test.js`, `ai-cost-branch.test.js`, `ai-cost-client.test.js`, `ai-cost-format.test.js`, `ai-cost-anomaly.test.js`, `ai-cost-sessions.test.js`, `ai-cost-sources.test.js` (giao diện nguồn), `ai-cost-source-<id>.test.js` (mỗi nguồn một file), `ai-cost-scan.test.js` (quét Buffer, cache tăng dần), `elevate.test.js`, `registry.test.js`, `cli-registry.test.js`, `json-store.test.js`, `ai-cost-machines.test.js`, `ai-cost-prices.test.js`.
- **Đa nền tảng:** CI chạy Node 20, 22, 24 trên macOS, Linux, Windows. Test không được giả định dấu phân cách đường dẫn, quyền file kiểu POSIX hay múi giờ của máy (cố định đồng hồ và múi giờ qua tham số, như aicost). Test chỉ có ý nghĩa trên macOS thì bỏ qua trên hệ điều hành khác bằng `skip`. Phần nào chưa kiểm chứng trên Windows thì ghi vào README giống mục "Not verified on Windows" hiện có.
- **Smoke test CI:** thêm `dev disk --json` và `dev ai --json` vào job smoke (chạy được cả khi không có log, trả danh sách rỗng). **Không** chạy `dev prune` thật trong CI ngoài cây thư mục bịa.

## 7. Rủi ro

| Rủi ro | Cách giảm |
| --- | --- |
| Xóa nhầm dữ liệu không dựng lại được | Ba mức; danh sách cấm cứng; Thùng rác mặc định cho mọi thứ ngoài cache dựng lại; kiểm tra lại ngay trước khi xóa; `realpath` trong root; không `sudo`; `--dry-run` mặc định; nhật ký xóa; phase có xóa đi sau cùng |
| Gỡ app xóa nhầm dữ liệu người dùng | Khớp bundle id chính xác mới tích sẵn; dữ liệu app không tích sẵn; khớp theo tên không tích sẵn; từ chối app hệ thống và app đang chạy; thử trên tài khoản/VM thử nghiệm trước |
| Danh mục đường dẫn lỗi thời theo phiên bản macOS và app | Cleaner khai báo bằng dữ liệu để sửa không cần phát hành code; mức `review` cho cache app; test trên cây bịa; kiểm tra lại mỗi lần phát hành |
| Bị hệ điều hành chặn (TCC, SIP, file bị khóa) | Hiện "không đọc được/đang dùng", không xin quyền, không coi là lỗi cả lệnh |
| Dung lượng bị tính thừa với hardlink (pnpm) | Loại trùng theo `(dev, ino)`; nhãn "ước tính" |
| Tính sai chi phí một cách âm thầm (bản thứ ba) | Cùng số kỳ vọng tính tay; script parity; quy tắc 5.3 viết thành test |
| Quét `node_modules` hoặc cả ổ chậm trên máy lớn hoặc Windows | `fs.opendir` song song có giới hạn, không theo symlink, cho phép `--root` hẹp; đo thời gian trước khi hứa |
| Lệnh dọn của công cụ đổi cờ giữa các phiên bản | Kiểm tra cờ khi làm; cleaner khai báo bằng dữ liệu; lỗi lệnh chỉ báo thất bại của cleaner đó |
| Quét log lớn chậm bằng Node | Đã đo trên log thật (2,1 GB): `readline` 5,3 giây, Buffer thô 1,1 giây (bản Go: khoảng 0,9 giây). Dùng Buffer thô, lọc theo byte, cache tăng dần (5.2); bộ nhớ đỉnh khi thử khoảng 450 MB nên cần giới hạn khối và dòng; đo lại khi làm |
| Nâng quyền bị lạm dụng hoặc lộ mật khẩu | Không xử lý mật khẩu (`sudo` tự nhắc, `stdio: 'inherit'`); `-k` mỗi lần; chỉ thao tác trong danh mục; danh sách cấm áp dụng với root; từ chối khi thư mục cha ghi được (TOCTOU); không chạy mã Node người dùng ghi được bằng root; không trong MCP, lịch, `dev again` (4.12) |
| Nguồn AI chỉ có số request hoặc hạn mức, không có token | Mô hình `billing` ba loại; `requests-only` không quy ra USD, không cộng vào tổng tiền (5.14) |
| Đọc SQLite của công cụ khác làm hỏng dữ liệu hoặc khóa DB | Chỉ đọc, không checkpoint, SQL cố định, `sqlite3` CLI hoặc `node:sqlite`, test không ghi (5.14) |
| `dev again` phát lại thao tác xóa | `replayable: false` cho prune và mọi thao tác nâng quyền; `dev again` từ chối (T6) |
| Refactor làm hỏng hành vi hiện có | Mỗi tiền đề một PR nhỏ, không đổi hành vi, test hiện có (khoảng 150 test, chạy khoảng 3 giây) làm lưới an toàn, golden test cho `dev help` và completion (mục 10) |
| Snapshot hỏng hoặc bị ghi đè sai | Chỉ giữ số lớn hơn theo khóa; ghi tạm rồi đổi tên; test mô phỏng log đã bị xóa |
| Lộ tên project, nhánh, khách hàng cho agent qua MCP | MCP không nhóm theo project, session, branch, client; không có tool xóa |
| Nhật ký xóa chứa đường dẫn riêng tư | Chỉ nằm cục bộ, giới hạn kích thước, không đưa vào MCP, snapshot hay JSON của `dev ai` |
| Lệch khỏi định vị công cụ dev, bảo trì danh mục lâu dài | Tách module riêng; mở rộng danh mục bằng dữ liệu; sẵn sàng tách thành package riêng |
| `--json` bất đồng bộ làm đổi đường chạy chung | Thay đổi nhỏ có test riêng, làm ở phase 1 |
| Báo cáo xuất ra bị chèn mã qua tên project, nhánh, khách (CSV injection, HTML) | Escape theo từng định dạng, thêm `'` cho ô CSV nguy hiểm, HTML không script; có test thoát ký tự (5.11) |
| File snapshot nhập từ máy khác là dữ liệu độc hại | Kiểm tra schema chặt, giới hạn kích thước, từ chối trường lạ, nhãn máy theo mẫu, lưu tách khỏi dữ liệu máy này (5.15) |
| Status line chậm làm khựng công cụ | Cache 30 giây, đo thời gian, mục tiêu dưới 100 ms khi trúng cache (5.12) |
| `--pr` dùng mạng làm vỡ nguyên tắc "không gọi mạng" | Mặc định tắt, gắn nhãn rõ, không bật trong MCP hay `--check`, chỉ lấy số PR và trạng thái (5.9) |
| Gán nhầm nhánh hoặc khách | Gán theo từng dòng log, nhóm `(không rõ)` và `(chưa gán)` hiện rõ, không đoán; tiền tố dài nhất có test (5.9, 5.10) |
| Cảnh báo bất thường gây ồn | Cần đủ lịch sử, ngưỡng nhân và ngưỡng tuyệt đối tối thiểu, có thể chỉnh (5.12) |
| Định dạng log của công cụ khác đổi hoặc không có token | Chỉ thêm nguồn sau khi qua danh sách kiểm tra; `skipped_lines` hiển thị; nhãn "chỉ có ở dev-cmd" (5.14) |
| Tên `ai`, `disk`, `prune` thành tên dành riêng, recipe trùng tên không còn hợp lệ | Ghi vào release notes; nguy cơ thấp |

## 8. Câu hỏi cần chốt

**Đã chốt:**
- Tên lệnh: `dev clean` (project), `dev prune` (máy), `dev disk` (xem) (cách A, mục 4.2).
- Phạm vi dọn cả máy theo kiểu analyze/clean/uninstall/maintenance, với các ranh giới ở mục 1.

**Đã chốt thêm (2026-11-26):**
- Câu 3: port phần AI sang JS trong `dev-cmd`.
- Câu 18: `sudo -k`, luôn phải nhập mật khẩu mỗi lần nâng quyền.
- Câu 21: khảo sát nguồn AI (15a) ngay sau phase 1; nguồn Gemini, Copilot, Antigravity (15b đến 15e) trước phase 8.

- Câu 1: dùng `--repo` cho `dev ai`, `--project` giữ nghĩa là đường dẫn.
- Câu 2: đọc bảng giá bằng `smol-toml`, dùng chung file giá với aicost (kiểm tra hỗ trợ Node 20.12 khi thêm).

**Không còn câu hỏi nào chặn phase 1.** Các câu còn lại có thể chốt sau.

**Còn mở** (kèm đề xuất):
1. ~~Tên flag lọc project cho `dev ai`~~ (đã chốt: `--repo`).
2. ~~Đọc TOML~~ (đã chốt: `smol-toml`).
3. ~~Bản chuẩn lâu dài của phần AI~~ (đã chốt: port sang `dev-cmd` JS, mục 5.2 và 5.8).
4. **Tuổi mặc định `--older-than`:** 30 ngày có hợp lý không?
5. **Phạm vi bản `dev prune` đầu tiên:** cache toàn cục trước rồi artifact project (đề xuất theo thứ tự phase 6), hay cả hai cùng lúc?
6. ~~Tên lệnh~~ (đã chốt).
7. **MCP:** có cho `ai_cost` ở bản đầu hay đợi sau khi ngân sách ổn? (đề xuất: đợi, phase 7)
8. **Có làm `dev prune maintenance` không?** Giá trị thấp và dễ tạo kỳ vọng sai; đề xuất để sau cùng hoặc bỏ.
9. **Cách chuyển vào Thùng rác trên macOS:** `fs.rename` vào `~/.Trash` (không có "Put Back", không cần quyền) hay Finder qua `osascript` (có "Put Back", có thể xin quyền Automation)? Đề xuất: bắt đầu bằng `fs.rename`, đánh giá lại.
10. **Phạm vi gỡ app:** chỉ macOS (đề xuất) hay làm cả Windows, Linux ở mức gợi ý lệnh?
11. **Có cần chế độ `--permanent` cho người dùng nâng cao không?** Đề xuất: không có ở các bản đầu.
12. **Cho phép `gh` (có dùng mạng) để gắn số PR (`--pr`)?** Đề xuất: có, nhưng mặc định tắt và không bao giờ bật trong MCP (5.9).
13. **Snapshot có lưu thêm tổng theo khách hàng không?** Có thì xem được lịch sử khách sau khi log bị xóa, nhưng tên khách nằm trong file cục bộ. Đề xuất: không ở bản đầu (5.5, 5.10).
14. **Mã thoát 2 cho cảnh báo bất thường** có hợp lý, hay gộp vào mã 1? Đề xuất: giữ 0/1/2 (5.12).
15. ~~Nguồn dữ liệu nào làm trước~~ (đã chốt: Gemini CLI, GitHub Copilot, Antigravity là mục tiêu chính; các công cụ còn lại theo 5.14).
16. **Thêm khóa object `aiClients` vào config:** cho phép `validateConfig` nhận object (đề xuất), hay tách sang file riêng `~/.devcmd/ai-clients.json`?
17. **Nâng quyền trên Windows (UAC):** làm ở mức `Start-Process -Verb RunAs` hay chỉ in lệnh? Đề xuất: chỉ in lệnh ở bản đầu (4.12).
18. ~~`sudo -k` bắt buộc nhập mật khẩu mỗi lần~~ (đã chốt: có, mục 4.12).
19. **Thao tác nâng quyền ở bản đầu:** chỉ bảo trì (xóa cache DNS, `mdutil -E`) và cache/log trong `/Library` (đề xuất), còn gỡ app và LaunchDaemons để sau?
20. **Đọc SQLite:** `node:sqlite` khi có, nếu không thì `sqlite3` CLI (đề xuất), hay chỉ hỗ trợ các nguồn không cần SQLite ở bản đầu?
21. ~~Thứ tự nguồn AI~~ (đã chốt: 15a ngay sau phase 1, 15b đến 15e trước phase 8, bảng mục 3).
22. **Lối nhanh cho `dev ai --short`** (chốt sau khi có số đo của T1): thêm nhánh sớm trong file `dev` để lệnh này không nạp toàn bộ CLI (đề xuất nếu số đo sau T1 vẫn chưa đạt dưới 100 ms)?

## 9. Định nghĩa "xong" cho mỗi phase

- `npm test` xanh trên Node 20, 22, 24 và ba hệ điều hành (CI).
- `git diff --check` sạch; `npm pack --dry-run` có đủ file mới (kể cả `src/ai/data/`, `src/cleaners/built-ins.json`, `src/maintenance/built-ins.json`).
- Chạy thử lệnh đại diện với `--dry-run` hoặc trên thư mục project tạm.
- Phase có xóa file: thử trên cây thư mục bịa trong thư mục tạm, **không bao giờ trên máy thật**; có test cho danh sách cấm, `realpath`/symlink, Thùng rác và nhật ký.
- Phase 17 (nâng quyền): thử thủ công trên máy ảo macOS, xác nhận `sudo -k` luôn đòi mật khẩu, mã nguồn không có `-S`/askpass, và `--yes` không bỏ qua xác nhận.
- Phase 12 (gỡ app): thử thủ công trên tài khoản người dùng thử nghiệm hoặc máy ảo macOS, ghi lại kết quả trong mô tả PR.
- Phase `ai`: `scripts/ai-parity.js` báo IDENTICAL trên fixture (chỉ áp dụng cho Claude và Codex); mỗi định dạng xuất có golden test và test thoát ký tự; mọi tính năng đọc log thật phải được kiểm chứng tên trường trên log thật trước khi viết parser (chỉ xem tên trường, không in nội dung).
- README, `docs/ARCHITECTURE.md`, `dev help`, completion đã cập nhật, hoặc ghi "docs checked, no change" trong mô tả PR.

---

## 10. Rà soát kiến trúc và tiền đề refactor

Đã đọc lại toàn bộ `src/` (khoảng 5.900 dòng, 14 nhóm thư mục) cùng `docs/ARCHITECTURE.md`, và đo thực tế trên máy tác giả. Số đo là một máy, một lần đo nhiều lượt, **cần đo lại sau mỗi tiền đề**.

### 10.1 Cái đang tốt, không cần sửa

- **Lớp spawn** (`src/runner/spawn.js`) và mô hình `{ executable, args, cwd? }`: đúng chỗ để thêm `elevate.js`.
- **Adapter, recipe engine, `.devcmd.json` kèm trust, parallel runner:** khớp với plan, chỉ cần mở rộng.
- **Bộ test:** khoảng 150 test chạy khoảng 3 giây, đủ làm lưới an toàn cho refactor.

### 10.2 Phát hiện và hệ quả khi tích hợp plan

| # | Phát hiện | Bằng chứng | Hệ quả |
| --- | --- | --- | --- |
| 1 | **Khởi động chậm vì nạp sớm** | `dev help` chậm hơn Node trần khoảng 100 ms. Nạp MCP SDK mất 58 ms, `@clack/prompts` 14 ms, phần còn lại của `cli.js` 10 ms, nạp và kiểm tra recipe 2 ms. SDK MCP bị nạp ở **mọi lệnh** vì `handlers/mcp.js` nạp `mcp/server.js` ngay đầu file | `dev ai --short` cho status line cần dưới 100 ms, mà riêng SDK đã tốn 58 ms |
| 2 | **Một flag phải sửa ở 4 nơi** | `parseArgs` có 24 nhánh `arg ===`; `validateCommandFlags`; danh sách tĩnh trong `completion.js`; `printHelp` viết tay. **Đã lệch thật:** completion thiếu `info`, `init`, `update`, `clone`, `mcp` | Plan thêm khoảng 25 flag và 8 lệnh mới |
| 3 | **Đường dẫn gắn cứng lúc `require`** | 6 hằng số `os.homedir()` trong `config/index.js`; chỉ loader recipe và opener nhận `home` qua tham số | Plan (nguyên tắc 9) cần test chạy trên HOME giả |
| 4 | **Bộ nạp registry bị chép lại** | `recipes/loader.js` và `openers/loader.js` gần như giống hệt nhau, chỉ khác xử lý alias và giá trị mặc định `target` | `cleaners` và `maintenance` sẽ là bản chép thứ 3 và 4 |
| 5 | **Kiến thức "project sinh ra gì" ở nhiều nơi** | `CLEAN_TARGETS` trong `clean-project.js`; `reset-project.js` cứng `.venv` và `node_modules`; `python-project.js` sinh `.gitignore` riêng | `dev disk` và `dev prune` thêm nơi thứ 4; dễ lệch nhau |
| 6 | **Ghi file không nguyên tử** | `config/user.js`, `projects/profile.js`, `projects/recent.js`, `commands/history.js` đều `writeFileSync` thẳng | Hai lệnh `dev` chạy cùng lúc (hoặc MCP cộng CLI) có thể làm hỏng file; plan thêm 5 kho dữ liệu mới |
| 7 | **`executeCommands` làm 7 việc** (in bước, dry-run, kiểm tra executable, chạy, thông báo, lưu history, ghi project gần đây); `sendNotification` là hàm riêng tư | 10 nơi gọi `executeCommands` | `prune` cần dùng lại thông báo và nhật ký nhưng làm việc khác (Thùng rác, nâng quyền). **Mọi thao tác thành công đều vào history, và `dev again` phát lại được:** phát lại `remove-paths.js` có thể xóa lần nữa thư mục đã cài lại |
| 8 | **`--json` đồng bộ và dựng lại dữ liệu** | `collectJson` tự gọi lại `inspectProject`, `checkTools`, ... thay vì dùng chung với handler hiển thị | Quét log là bất đồng bộ; thêm `disk`, `ai`, `prune` sẽ nhân đôi logic |
| 9 | **`mcp/tools.js` một file 389 dòng** | định nghĩa tool, hàm xử lý và logic nghiệp vụ trộn lẫn | Thêm `ai_cost` và các tool đọc của `disk` làm file phình tiếp |
| 10 | **Config chỉ nhận giá trị đơn, 4 danh sách song song** | `DEFAULT_CONFIG`, `CONFIG_KEYS`, `validateConfig`, `parseConfigValue` | Plan thêm khoảng 8 khóa, gồm cả object (`aiClients`, `aiSourceRoots`) |
| 11 | **Đồng hồ rải rác** | `new Date()` ở 5 chỗ | Plan cần test có đồng hồ cố định |
| 12 | **Hàm trợ giúp test bị lặp** | `tempDir`, `createNodeProject`, `isolatedEnv`, `write` được định nghĩa lại ở nhiều file; `mkdtempSync` xuất hiện ở 14 file test | Plan thêm khoảng 25 file test nữa |
| 13 | **Quét log là điểm nóng hiệu năng** | Log thật 2,1 GB, 218 file, 209 file đổi trong 31 ngày (nên lọc theo mtime gần như vô ích với `month`); `readline` 5,3 giây, Buffer thô 1,1 giây | Xem 5.2: Buffer thô cộng cache tăng dần |
| 14 | **Dữ liệu nguồn AI nằm trong SQLite** | `opencode.db`, `session-store.db`, `agent-host.db` | Cần `sqlite.js` và quyết định ở 5.14 |

### 10.3 Các tiền đề refactor (T1 đến T10)

Mỗi mục: **không đổi hành vi**, một PR, chạy lại toàn bộ test, đo lại khởi động.

- **T1. Sổ đăng ký lệnh và flag khai báo (`src/cli/`).** Mỗi lệnh khai báo một lần: tên, nhóm, mô tả, cách dùng, danh sách flag (kiểu, lệnh được phép), có hỗ trợ `--json` không, và **handler nạp lười** (`() => require(...)`). Từ đó sinh ra `parseArgs`, `validateCommandFlags`, `printHelp` và completion. Kết quả: hết lệch dữ liệu (completion thiếu 5 lệnh hiện tại), thêm flag chỉ ở một nơi, khởi động giảm (ước tính 60 đến 70 ms vì không nạp MCP SDK và clack khi không cần; **cần đo lại**). Cách làm: viết golden test cho `dev help` và completion hiện tại trước, rồi chuyển từng nhóm lệnh sang sổ đăng ký, giữ handler cũ. Nếu số đo sau T1 vẫn chưa đạt dưới 100 ms cho `ai --short`, thêm lối nhanh trong file `dev` (câu hỏi 22).
- **T2. `getPaths(homeDir)` và `now` truyền qua tham số (`src/config/paths.js`).** Các hằng số cũ trở thành lớp bọc mỏng quanh `getPaths(os.homedir())` để mã cũ không đổi; mã mới nhận `paths` và `now` từ ngữ cảnh. Thêm sẵn đường dẫn mới (cleaners, nhật ký prune, `ai-daily`, `ai-scan-cache`, `ai-short-cache`, `ai-imported`, `disk-daily`).
- **T3. Kho JSON ghi nguyên tử (`src/store/json-store.js`).** Đọc chịu lỗi (file hỏng thì trả mặc định và không ghi đè khi chưa xác nhận), ghi tạm rồi đổi tên, thêm kiểu JSONL có xoay vòng cho nhật ký. Chuyển `history`, `projects`, `config`, `trust` sang dùng; kho mới dùng ngay.
- **T4. Bộ nạp registry dùng chung (`src/registry/`).** Gồm nạp built-in, nạp thư mục người dùng, kiểm tra schema, gắn `source`, ghi đè theo tên, kiểm tra alias. Chuyển `recipes` và `openers` sang, rồi `cleaners` và `maintenance` dùng luôn. Test hiện có của recipes và openers bảo đảm không đổi hành vi.
- **T5. Danh mục artifact dùng chung (`src/projects/artifacts`).** Một nơi khai báo "loại project nào sinh ra thư mục nào, tạo lại bằng lệnh gì, cần manifest và lockfile nào". `clean-project.js`, `reset-project.js`, `dev disk` và `dev prune` đều đọc từ đó. Kèm kiểm tra git theo dõi của phase 0.
- **T6. Tách `executeCommands`.** Tách thành các hàm tái dùng: kiểm tra yêu cầu, chạy, `notifyIfSlow` (xuất `sendNotification`), `recordSuccess`. Thêm cờ `replayable` vào metadata; `saveHistory` ghi cờ; `dev again` **từ chối** mục `replayable: false`. Thêm `runOperations` cho các bước không phải lệnh (chuyển vào Thùng rác, ghi nhật ký).
- **T7. `--json` bất đồng bộ và mẫu "thu thập, rồi hiển thị".** `runJson` chờ `await`. Lệnh mới theo mẫu `collect(context) → data` và `render(context, data)`; `--json` in `collect`, chế độ thường in `render(collect)`. Lệnh cũ chuyển dần, không bắt buộc ngay.
- **T8. Tách `src/mcp/tools.js` theo miền** (`lifecycle`, `scaffold`, `devices`, `processes`, `history`, sau này `ai`, `disk`), mỗi miền xuất `{ definitions, handlers }`; nạp MCP SDK lười để lệnh không phải `mcp` không phải trả 58 ms.
- **T9. Config theo schema có kiểu.** Một `CONFIG_SCHEMA` khai báo từng khóa (kiểu, mặc định, kiểm tra, trợ giúp) thay cho bốn danh sách song song; hỗ trợ số, enum, mảng và object; `dev config` liệt kê từ schema.
- **T10. `test/helpers/`.** Gộp `tempDir`, `tempHome` (đặt cả `HOME` và `USERPROFILE`), `createProject`, `fakeClock`, `isolatedEnv`.

Việc **không** nên làm trước: viết lại `detectProject` (đủ nhanh với tối đa 50 project; `dev disk` cần thêm một bộ duyệt `findProjects(root)` bất đồng bộ, có giới hạn song song và cắt nhánh sớm, không cần đổi cái cũ), đổi cấu trúc thư mục `src/`, hay chuyển sang TypeScript.

### 10.4 Tối ưu hiệu năng đã có số liệu

| Việc | Hiện tại | Hướng | Mục tiêu |
| --- | --- | --- | --- |
| Khởi động mọi lệnh | khoảng 100 ms trên Node trần | T1 và T8: nạp lười | giảm khoảng 60 ms (ước tính) |
| `dev ai` quét log đầy đủ | `readline` 5,3 giây | Buffer thô | khoảng 1,1 giây |
| `dev ai --short` và `--check` | quét đầy đủ mỗi lần | cache tăng dần (5.2) và cache kết quả 30 giây (5.12) | dưới 100 ms khi trúng cache |
| `dev disk` | chưa có | `fs.opendir` song song có giới hạn, loại trùng inode, cắt nhánh (4.3) | đo trước khi hứa |

### 10.5 Rủi ro của chính việc refactor

- **Đổi hành vi âm thầm:** golden test cho `dev help`, completion và các JSON hiện có; chạy trên cả ba hệ điều hành trong CI.
- **Phình phạm vi:** mỗi tiền đề giới hạn ở danh sách trên, không gộp thêm; mọi thứ khác ghi vào backlog.
- **Chậm tiến độ:** T1 là mục lớn nhất; nếu cần, phase 1 có thể làm với cơ chế flag cũ và chuyển sang T1 ngay sau đó (đổi lại phải sửa lại khoảng 15 flag của `dev ai`).
- **`docs/ARCHITECTURE.md`:** mục 9 ("Mở rộng — thêm ở đâu") phải được cập nhật cùng T1, T4, T5 vì chúng đổi chỗ thêm lệnh, registry và artifact.
