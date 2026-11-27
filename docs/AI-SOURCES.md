# Nguồn dữ liệu của `dev ai`: kết quả khảo sát log

Khảo sát ngày 2026-11-26 trên máy của tác giả. **Chỉ nhìn tên trường và số liệu, không đọc nội dung hội thoại.** Quy tắc cho mọi nguồn: không in và không lưu nội dung, đường dẫn hay tên project ngoài file cache cục bộ (`~/.devcmd/ai-scan-cache.json`).

Mỗi nguồn có hai thuộc tính hiển thị trong `dev ai --tools`:

- **Loại tính phí (`billing`)**: `tokens` (log có số token, tiền tính bằng bảng giá), `reported-cost` (công cụ tự ghi tiền, DevCmd dùng số đó), `requests-only` (chỉ đếm được lượt trả lời, không có token).
- **Mức xác minh (`maturity`)**: `verified` (kiểm tra trên log thật, có test), `experimental` (đọc được nhưng một giả định chưa được tài liệu hóa), `not supported` (không có số liệu cục bộ).

| Công cụ | Vị trí | Loại | Mức | Ghi chú |
| --- | --- | --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` | tokens | verified | Có parity với aicost (`scripts/ai-parity.js`). Có `gitBranch`, `isSidechain` trên mỗi dòng. |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | tokens | verified | Tổng chạy của session, request là hiệu hai tổng. `session_meta` không có trường git. |
| OpenCode | `~/.local/share/opencode/opencode.db` (bảng `message`, cột `data` JSON) | reported-cost | verified | `tokens.total` = input + output + cache read + cache write (kiểm tra 273/288 dòng; phần còn lại là dòng thiếu một thành phần), nên reasoning **đã nằm trong output**. `cost` do OpenCode tự tính (0 với model miễn phí). |
| GitHub Copilot CLI | `~/.copilot/session-store.db` (bảng `assistant_usage_events`) | reported-cost | experimental | `input_tokens` đã gồm cache read và write; `output_tokens` đã gồm reasoning. `total_nano_aiu` là tiền Copilot tự ghi, đã đối chiếu: bằng đúng tổng (số token × đơn giá mỗi triệu) trong `token_details_json`. DevCmd hiển thị 1 AIU = 1 USD vì đơn giá mỗi dòng khớp mức giá USD thông thường, nhưng GitHub chưa tài liệu hóa quy đổi này. |
| Gemini CLI | `~/.gemini/tmp/<project>/chats/session-*.jsonl` | requests-only | verified cho số lượt, unverified cho token | Bản trên máy khảo sát chỉ ghi tin nhắn `user` (5.886 tin) và không có tin của model, không có trường token. Bộ đọc đếm tin `gemini` và dùng `tokens` (`input`, `output`, `cached`, `thoughts`, `tool`) khi có. **Nhánh token chưa kiểm tra được trên log thật.** Mỗi dòng chứa lại toàn bộ danh sách tin nhắn nên mỗi tin chỉ đếm một lần. |
| Antigravity | `~/.gemini/antigravity*/` | không hỗ trợ | not supported | `conversation_summaries.db` chỉ có tiêu đề, số bước, thời gian sửa cuối, workspace; thư mục `conversations` rỗng. **Không có token, model hay tiền.** Theo plan, phase của công cụ này bị bỏ. |
| VS Code Copilot Chat | `…/globalStorage/github.copilot-chat/session-store.db` | không hỗ trợ | not supported | Schema cũ hơn của CLI: chỉ có `sessions`, `turns`, `checkpoints`; không có bảng usage. |

## Chưa khảo sát được

Cline, Roo Code, Kilo Code, Aider, Amp, Cursor: **không cài trên máy khảo sát**, nên không có log thật để xác minh. Theo quy tắc của plan (từng công cụ một, dựa trên log thật), chưa thêm nguồn nào. Khi có log, thêm một file trong `src/ai/sources/` theo mẫu của `gemini.js` hoặc `opencode.js`, cùng fixture bịa và test.

## Cách đọc SQLite

`src/ai/sqlite.js` dùng `node:sqlite` nếu Node có (22.5 trở lên), nếu không dùng lệnh `sqlite3`. Luôn chỉ đọc. Khi công cụ đang giữ file (WAL), đọc một bản sao của file và `-wal`, `-shm`. Không có cả hai thì nguồn đó báo "không đọc được" và các nguồn khác vẫn chạy.

## Không đổi số của Claude và Codex

Các nguồn mới nằm sau cùng trong danh sách; Claude và Codex giữ nguyên quy tắc ở `docs/PLAN-disk-and-ai.md` mục 5.3. `node scripts/ai-parity.js` chỉ so hai nguồn này với aicost.
