const diff = process.argv[2] || '';

if (!diff.trim()) {
  console.log('## AI Code Review\n\n_Không có thay đổi JS nào để review._');
  process.exit(0);
}

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: `Bạn là senior dev review code cho dự án idphoto (PhotoVisa).
Stack: vanilla JS ES modules, không có framework, chạy 100% browser-side.
Modules quan trọng: ai.js (ISNet/@imgly), render.js (canvas pipeline), 
crop.js (touch/mouse events), ui.js (AbortController pattern), state.js.
Patterns đang dùng: _renderLock + _renderPending, AbortController cho cleanup,
_triedScriptUrls guard, assertAllowedRemoteUrl allowlist.

Chỉ báo cáo vấn đề THỰC SỰ nghiêm trọng (bỏ qua style, naming):
🔴 Critical: race condition, crash risk, security (CSP/allowlist bypass)
🟡 Warning: memory leak (objectURL/canvas/tensor chưa dispose), 
   stale closure, debounce timer leak sau resetState()
🟢 Suggestion: chỉ khi có pattern rõ ràng tốt hơn hiện tại

Format output:
## AI Code Review
[tóm tắt 1 câu]
### Vấn đề phát hiện
[danh sách hoặc "Không phát hiện vấn đề nghiêm trọng"]
---
_Reviewed by Claude Sonnet_`,
    messages: [{
      role: 'user',
      content: `Review diff sau:\n\`\`\`diff\n${diff}\n\`\`\``
    }]
  })
});

const data = await res.json();
if (data.error) {
  console.log(`## AI Code Review\n\n⚠️ Review thất bại: ${data.error.message}`);
  process.exit(0);
}
console.log(data.content[0].text);
