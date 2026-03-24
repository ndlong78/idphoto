# 🤖 GitHub Custom Agents — Hướng Dẫn Sử Dụng

Dự án này có 4 agents chuyên biệt cho JavaScript/Node.js.

## Cách cài đặt

1. Copy thư mục `.github/agents/` vào root của repo bạn
2. Đảm bảo GitHub Copilot đã được bật trong repo settings

## Danh sách Agents

| Agent | File | Dùng khi nào |
|---|---|---|
| 🧠 Coding | `coding-agent.md` | Viết feature mới, fix bug, refactor |
| 🔍 Review | `review-agent.md` | Review PR, đánh giá code quality |
| 🧪 Test | `test-agent.md` | Viết unit/integration tests |
| 📝 Docs | `docs-agent.md` | Viết README, JSDoc, CHANGELOG |

## Cách sử dụng

### Cách 1: Mention trong PR comment
```
@coding-agent Implement chức năng login với JWT cho route POST /api/auth/login
```

```
@review-agent Review PR này và kiểm tra security issues
```

### Cách 2: Assign Issue cho agent
Trong GitHub Issues, assign issue cho `copilot` và đề cập agent muốn dùng trong description:

```
Use @test-agent to write tests for the userService module
```

### Cách 3: Chat trực tiếp trong VS Code
Mở Copilot Chat và gõ:
```
@workspace /agent coding-agent Tạo một Express middleware để log request time
```

## Workflow gợi ý

```
1. coding-agent  →  Viết code mới
2. test-agent    →  Viết tests cho code vừa viết
3. review-agent  →  Review toàn bộ trước khi merge
4. docs-agent    →  Cập nhật README và JSDoc
```

## Tips

- Càng mô tả chi tiết → agent làm càng đúng ý
- Nên giao từng task nhỏ thay vì một task lớn
- Luôn chạy `npm test` sau khi agent viết code xong
