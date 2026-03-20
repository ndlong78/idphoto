export function nextStep(step) {
  const order = ['idle', 'loading_libs', 'detect_face', 'remove_bg', 'render_done'];
  const idx = order.indexOf(step);
  return order[Math.min(idx + 1, order.length - 1)];
}
