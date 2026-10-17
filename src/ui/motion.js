// Vor dem ersten Zeichnen setzen, damit nichts hereinanimiert, wenn Animationen aus sind (eigene Datei wegen CSP).
try { if (localStorage.getItem('motion') === 'reduced') document.documentElement.dataset.motion = 'reduced'; } catch {}
