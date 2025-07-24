
export function disableDoubleTapZoom() {
  document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false, capture: true });
  document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false, capture: true });
  document.addEventListener('gestureend', e => e.preventDefault(), { passive: false, capture: true });
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false, capture: true });
}
