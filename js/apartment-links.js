/* All callers use stable source IDs. Only the detail resolver canonicalizes publications. */
(() => {
  const url = ({id,row,area,tab='overview'}) => {
    const p=new URLSearchParams();
    if(id)p.set('id',id);else if(row!=null)p.set('row',row);
    if(area!=null && area!=='')p.set('area',area);
    p.set('tab',tab);
    return '/apartment/?'+p;
  };
  const go = (selection,replace=false) => {
    const from=new URL(location.href);['a','ar','i','k'].forEach(k=>{const h=new URLSearchParams(from.hash.slice(1));h.delete(k);from.hash=h.toString();});
    try{sessionStorage.setItem('nodoApartmentReturn',from.pathname+from.search+from.hash);}catch{}
    location[replace?'replace':'assign'](url(selection));
  };
  window.NodoApartmentLinks={url,go};
})();
