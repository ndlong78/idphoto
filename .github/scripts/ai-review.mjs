const diff = process.argv[2] || '';

if (!diff.trim()) {
  console.log('## AI Code Review\n\n_Không có thay đổi JS nào để review._');
  process.exit(0);
}

console.log('## AI Code Review\n\n⚠️ Tính năng review qua Anthropic đang bị tắt.');
