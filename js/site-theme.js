/* Set before paint; a saved preference always wins over the system theme. */
(() => {
  const embedded=(()=>{try{return window.parent!==window&&parent.location.origin===location.origin&&new URLSearchParams(location.search).get('view')==='panel';}catch{return false;}})();
  document.documentElement.classList.toggle('apartment-embedded',embedded);
  const screen=matchMedia('(min-width:1024px)');
  const density=()=>document.documentElement.classList.toggle('desktop-ui',screen.matches||embedded);screen.addEventListener('change',density);density();
  const media = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try { preference = localStorage.getItem('nodoTheme') || 'system'; } catch {}
  if (!['light', 'dark', 'system'].includes(preference)) preference = 'system';
  const apply = () => {
    const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.dispatchEvent(new CustomEvent('nodo:theme', {detail: theme}));
  };
  window.NodoTheme = {get: () => preference, set(value) {
    preference = ['light','dark','system'].includes(value) ? value : 'system';
    try { localStorage.setItem('nodoTheme', preference); } catch {}
    apply();
  }};
  media.addEventListener('change', apply);
  window.addEventListener('storage', e => { if(e.key === 'nodoTheme') { preference = ['light','dark','system'].includes(e.newValue) ? e.newValue : 'system'; apply(); } });
  apply();
})();
