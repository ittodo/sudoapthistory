"""Content-addressed private month-end states; publish the index only on success."""
import gzip
import hashlib
import json
from pathlib import Path
import uuid

def pack(value):
    return json.dumps(value,ensure_ascii=False,separators=(',', ':'),allow_nan=False).encode()

def sha(raw): return hashlib.sha256(raw).hexdigest()

def atomic(path,raw):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    temp.write_bytes(raw);temp.replace(path)

class MonthCache:
    def __init__(self,root,context,ledger,today):
        self.root=Path(root);self.context=context;self.ledger=ledger;self.today=today
        self.entries={};self.old={};self.reason='no-valid-state';self.restore_month=None
        try:
            old=json.loads((self.root/'index.json').read_bytes())
            if old['schema']==2 and old['context']==context and old.get('safeDates'):
                self.old=old
            else:self.reason='context-or-date-policy-changed'
        except (OSError,ValueError,KeyError,TypeError): pass

    def blob(self,raw):
        key=sha(raw);path=self.root/'objects'/key
        if not path.exists() or sha(path.read_bytes())!=key: atomic(path,raw)
        return key

    def get_blob(self,key):
        if len(key)!=64 or any(c not in '0123456789abcdef' for c in key):raise ValueError('Invalid cache object')
        raw=(self.root/'objects'/key).read_bytes()
        if sha(raw)!=key:raise ValueError('Corrupt cache object')
        return raw

    def restore(self,site):
        old=self.old
        if not old:return None
        changed=[v['month'] for key in set(old['ledger'])|set(self.ledger)
                 if old['ledger'].get(key)!=self.ledger.get(key)
                 for v in (old['ledger'].get(key),self.ledger.get(key)) if v]
        earliest=min(changed) if changed else 999999
        candidates=sorted((m for m in old['states'] if int(m.replace('-',''))<earliest),reverse=True)
        for month in candidates:
            try:
                state=json.loads(gzip.decompress(self.get_blob(old['states'][month])))
                for name,key in state['files'].items():
                    path=Path(name)
                    if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name or not name.startswith('data/daily/') or not name.endswith('.bin'):
                        raise ValueError('Unsafe cache artifact')
                    raw=self.get_blob(key)
                    target=Path(site)/name;target.parent.mkdir(parents=True,exist_ok=True)
                    if not target.exists() or target.read_bytes()!=raw: target.write_bytes(raw)
                self.entries={m:k for m,k in old['states'].items() if m<=month}
                self.restore_month=month;self.reason='unchanged' if not changed else 'changed-month'
                return state
            except (OSError,ValueError,KeyError,TypeError,EOFError):
                self.reason='damaged-state'
        return None

    def capture(self,month,state,site):
        # All earlier objects were captured already or verified by restore().
        for name,key in state['files'].items():
            if name.split('/')[-1].startswith(month):
                raw=(Path(site)/name).read_bytes()
                if sha(raw)!=key:raise ValueError('Output changed while caching')
                self.blob(raw)
        raw=gzip.compress(pack(state),compresslevel=1,mtime=0)
        self.entries[month]=self.blob(raw)

    def commit(self,counts):
        safe=not counts.get('invalidDate') and not counts.get('futureDate')
        atomic(self.root/'index.json',pack({'schema':2,'context':self.context,'ledger':self.ledger,
              'asOfDate':self.today,'safeDates':safe,'states':self.entries}))
