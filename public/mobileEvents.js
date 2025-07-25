
export function disableDoubleTapZoom() {
  document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false, capture: true });
  document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false, capture: true });
  document.addEventListener('gestureend', e => e.preventDefault(), { passive: false, capture: true });
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false, capture: true });

  function updateViewportHeight() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  }
  window.addEventListener('resize', updateViewportHeight);
  window.addEventListener('orientationchange', updateViewportHeight);
  updateViewportHeight();

}
