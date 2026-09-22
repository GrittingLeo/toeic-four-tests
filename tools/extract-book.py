"""Deterministic extraction of the supplied book. Never synthesizes questions.

PDF page images remain the visual source of truth (especially charts and blanks).
"""
from pathlib import Path
import argparse, json, re, hashlib
import pypdfium2 as pdfium
import pdfplumber
from listening_options import listening_options

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--pdf',default='E:/BaiduNetdiskDownload/新托业全真新题型.pdf')
parser.add_argument('--test',type=int,choices=[1,2,3,4])
args=parser.parse_args()
OUT=ROOT/'web'/'data'
IMG=ROOT/'web'/'images'
OUT.mkdir(parents=True,exist_ok=True);IMG.mkdir(exist_ok=True)
doc=pdfium.PdfDocument(args.pdf)
plumber=pdfplumber.open(args.pdf)
ranges=[(15,51,165,228),(52,88,229,292),(89,124,293,354),(125,162,355,416)]
texts=[]
for page in doc:
    tp=page.get_textpage();texts.append(tp.get_text_range().replace('\r\r\n','\n').replace('\r\n','\n'));tp.close();page.close()

def clean(t):
    t=re.sub(r'[\ufffe\u00ad]\s*\n?', '', t)
    t=re.sub(r'(?<=[a-z])-\n(?=[a-z])','',t)
    t=re.sub(r'^(?:GO ON TO THE NEXT PAGE.*|\d*\s*新托业全真题库.*|TEST [1-4].*|Part [1-7]|PART [1-7])$','',t,flags=re.M)
    return t.strip()

def flat(t):
    return re.sub(r'\s+',' ',clean(t)).strip()

def part(n):
    return next(i+1 for i,b in enumerate([6,31,70,100,130,146,200]) if n<=b)

def locate(pn,literal):
    page=doc[pn-1];tp=page.get_textpage();search=tp.search(literal)
    result=search.get_next()
    if not result:
        search.close();tp.close();page.close();return None
    a,count=result
    boxes=[tp.get_charbox(i) for i in range(a,a+count)]
    h=page.get_height()
    box=[min(b[0] for b in boxes),h-max(b[3] for b in boxes),max(b[2] for b in boxes),h-min(b[1] for b in boxes)]
    search.close();tp.close();page.close();return box

def render(pn):
    target=IMG/f'p{pn:03}.webp'
    if not target.exists():
        page=doc[pn-1];page.render(scale=2.6).to_pil().save(target,format='WEBP',quality=88);page.close()
    return f'images/{target.name}'

def blanks(pn,text):
    """Inject the PDF's actual short horizontal rules into its text stream."""
    page=doc[pn-1];tp=page.get_textpage()
    raw=tp.get_text_range()
    inserts=[]
    for line in plumber.pages[pn-1].lines:
        if line['height']>.5 or not 18<line['width']<65 or line['top']<45:continue
        y=page.get_height()-line['top']; candidates=[]
        for idx in range(tp.count_chars()):
            b=tp.get_charbox(idx)
            if b[0]>=line['x1']-1 and b[0]<line['x1']+65 and y-2<b[1]<y+10:
                candidates.append((b[0],idx))
        if candidates:
            _,idx=min(candidates)
            ti=pdfium.raw.FPDFText_GetTextIndexFromCharIndex(tp,idx)
            if ti>=0:inserts.append(ti)
        else:
            # A blank at the right end of a line has no following character.
            left=[]
            for idx in range(tp.count_chars()):
                b=tp.get_charbox(idx)
                if line['x0']-35<b[2]<=line['x0']+1 and y-2<b[1]<y+10:left.append((b[2],idx))
            if left:
                _,idx=max(left)
                ti=pdfium.raw.FPDFText_GetTextIndexFromCharIndex(tp,idx)
                if ti>=0:inserts.append(ti+1)
    for idx in sorted(set(inserts),reverse=True):raw=raw[:idx]+' ______ '+raw[idx:]
    tp.close();page.close()
    return raw.replace('\r\r\n','\n').replace('\r\n','\n')

banks=[]
for test,(qs,qe,ans,ae) in enumerate(ranges,1):
    if args.test and args.test!=test:continue
    keytext='\n'.join(texts[ans-1:ans+1])
    keys={int(n):a for n,a in re.findall(r'\b(\d{1,3})\.\s*[（(]\s*([ABCD])\s*[）)]',keytext)}
    atext='\n'.join(clean(t) for t in texts[ans+1:ae])
    # Q30 in test 4 has a wrapped heading.
    atext=re.sub(r'(?m)^(30)\n([^\n]+)\n(难度[^\n]*)',r'\1 \2 \3',atext)
    headings=list(re.finditer(r'^(\d{1,3})\s+([^\n]*难度[^\n]*)',atext,re.M))
    materials=list(re.finditer(r'^第\s*(\d+)\s*[～~－–-]\s*(\d+)\s*题请参[照考][^\n]*',atext,re.M))
    transcripts={}
    for i,m in enumerate(materials):
        stop=materials[i+1].start() if i+1<len(materials) else len(atext)
        following=next((h.start() for h in headings if h.start()>m.end()),stop)
        transcripts[int(m.group(1))]=clean(atext[m.start():min(stop,following)])
    exp={}
    for i,h in enumerate(headings):
        num=int(h.group(1));body=atext[h.end():headings[i+1].start() if i+1<len(headings) else len(atext)]
        ma=re.search(r'答案\s*[（(]\s*([ABCD])\s*[）)]',body)
        assert ma and ma.group(1)==keys[num],(test,num,'answer mismatch')
        tag=re.split(r'\s+(?:美|英|澳|难度)',h.group(2))[0].strip()
        # Only take the actual explanation through its answer, not the next transcript.
        extra=re.split(r'\n(?:★ 新托业|第\s*\d+\s*[～~－–-])',body[ma.end():])[0]
        exp[num]={'tag':tag,'difficulty':h.group(2).count('★'),'text':clean(body[:ma.end()]),'extra':clean(extra)}
    segments=[];qpages={};groups=[]
    for pn in range(qs,qe+1):
        t=texts[pn-1]
        if 'PART 5' in t or (re.search(r'^1[012]\d\.',t,re.M) and not 'Questions 131' in t):t=blanks(pn,t)
        for m in re.finditer(r'^(\d{1,3})\.',t,re.M):
            n=int(m.group(1))
            if n in keys and n not in qpages:qpages[n]=pn
        for m in re.finditer(r'Questions\s+(\d+)[-–－]\s*(\d+)\s+refer[^\n]*',t):
            lo,hi=map(int,m.group(1,2))
            if lo>=131:groups.append({'id':f't{test}-g{lo}','start':lo,'end':hi,'page':pn,'title':m.group(0)})
        segments.append(clean(t))
    qtext='\n'.join(segments)
    candidates=list(re.finditer(r'^(\d{1,3})\.\s*',qtext,re.M))
    # Select the sequential 1..200 question headings, not numbered lists in passages.
    qheads=[]
    for h in candidates:
        if int(h.group(1))==len(qheads)+1:qheads.append(h)
    questions=[]
    for i,h in enumerate(qheads):
        n=int(h.group(1))
        if not 1<=n<=200:continue
        body=qtext[h.end():qheads[i+1].start() if i+1<len(qheads) else len(qtext)]
        body=re.split(r'\n(?:Questions\s+\d+|PART\s+[1-7]|READING TEST|Directions：|This is the end of the Listening test)',body)[0]
        opts=list(re.finditer(r'[（(]\s*([ABCD])\s*[）)]',body))
        # Figure labels can be A/B/C; prefer first sequential A B C D option run.
        if n<=31:
            stem='请听录音，选择正确答案。';options=listening_options(exp[n]['extra'],n)
        else:
            if len(opts)!=4 or sorted(m.group(1) for m in opts)!=list('ABCD'):
                print('OPTION_REVIEW',test,n,len(opts),flush=True)
            assert len(opts)>=4,(test,n,'missing options')
            opts=opts[:4]
            stem=flat(body[:opts[0].start()])
            # Visually checked line-final rules that are encoded outside text runs.
            corrections={(1,120):('the computer on','the ______ computer on'),(2,124):('the deadline','the ______ deadline'),(3,102):('its customers','its ______ customers'),(4,103):('not understand','not ______ understand'),(4,120):('rights crude','rights ______ crude'),(4,125):('dedicated to the','dedicated to ______ the')}
            if (test,n) in corrections:
                before,after=corrections[test,n];assert before in stem;stem=stem.replace(before,after,1)
            if (test,n)==(3,105):stem=re.sub(r'\s+______\s*$','',stem)
            options=[{'key':m.group(1),'text':flat(body[m.end():opts[j+1].start() if j<3 else len(body)])} for j,m in enumerate(opts)]
            options.sort(key=lambda option:option['key'])
        group=next((g for g in groups if g['start']<=n<=g['end']),None)
        if n<=6:gid=f't{test}-g{n}'
        elif n<=31:gid=f't{test}-g{n}'
        elif n<=70:gid=f't{test}-g{32+(n-32)//3*3}'
        elif n<=100:gid=f't{test}-g{71+(n-71)//3*3}'
        elif n<=130:gid=f't{test}-g{n}'
        else:assert group,(test,n,'no passage');gid=group['id']
        ep=next(pn for pn in range(ans+2,ae+1) if re.search(r'^0?'+str(n)+r'\s+[^\n]*(?:\n[^\n]*){0,2}?难度',texts[pn-1],re.M))
        questions.append({'id':f't{test}-q{n}','number':n,'part':part(n),'groupId':gid,'stem':stem,'options':options,'answer':keys[n],**exp[n],'sourcePage':qpages[n],'explanationPage':ep})
    assert len(questions)==200 and len(exp)==200,(test,len(questions),len(exp))
    # Full-resolution original pages are deliberately retained; no reconstructed chart data.
    for pn in range(qs,qe+1):render(pn)
    for pn in range(ans+2,ae+1):render(pn)
    for g in groups:
        last=qpages[g['end']]
        firstq=qpages[g['start']]
        # The passage extends from its heading to the first question, across pages.
        images=[]
        for pn in range(g['page'],firstq+1):
            page=doc[pn-1];w,h=page.get_size();page.close()
            title=locate(pn,g['title']) if pn==g['page'] else None
            qb=locate(pn,str(g['start'])+'.') if pn==firstq else None
            top=max(35,title[3]+5) if title else 42
            bottom=qb[1]-8 if qb else h-40
            # Some final questions sit alongside continuing source material; keep original page.
            if bottom-top<30:top,bottom=40,h-40
            images.append({'src':render(pn),'page':pn,'box':[40,top,w-36,bottom],'width':w,'height':h})
        g['images']=images
        passage='\n'.join(texts[g['page']-1:firstq])
        passage=passage.split(g['title'],1)[-1]
        passage=re.split(r'^'+str(g['start'])+r'\.',passage,flags=re.M)[0]
        g['text']=clean(passage)
        g['sourcePages']=list(range(g['page'],last+1))
    for q in questions:
        if any(g['id']==q['groupId'] for g in groups):continue
        n=q['number'];lo=n if n<=31 or n>=101 else (32+(n-32)//3*3 if n<=70 else 71+(n-71)//3*3)
        hi=lo if n<=31 or n>=101 else lo+2
        if n!=lo:continue
        pn=q['sourcePage'];page=doc[pn-1];w,h=page.get_size();page.close()
        box=locate(pn,str(n)+'.')
        images=[]
        if n<=6:
            nextbox=locate(pn,str(n+1)+'.')
            top=box[1]-5 if box else 40;bottom=(nextbox[1]-7 if nextbox and nextbox[1]>top+20 else h-42)
            images=[{'src':render(pn),'page':pn,'box':[42,top,w-35,bottom],'width':w,'height':h}]
        elif 32<=n<=100:
            images=[{'src':render(p),'page':p,'box':[35,40,w-30,h-35],'width':w,'height':h} for p in sorted(set(qpages[k] for k in range(lo,hi+1)))]
        elif 101<=n<=130:
            images=[{'src':render(pn),'page':pn,'box':[35,40,w-30,h-35],'width':w,'height':h}]
        groups.append({'id':q['groupId'],'start':lo,'end':hi,'title':f'Questions {lo}–{hi}' if hi>lo else f'Question {lo}','images':images,'text':'','sourcePages':sorted(set(qpages[k] for k in range(lo,hi+1)))})
    for g in groups:
        g['transcript']=transcripts.get(g['start'],'')
        if 32<=g['start']<=100 and not re.search(r'[A-Za-z]{4}',g['transcript']):
            g['transcript']='\n\n'.join(q['extra'] for q in questions if q['groupId']==g['id'])
    bank={'test':test,'title':f'Actual Test {test}','sourceTitle':'新托业全真题库','questions':questions,'groups':sorted(groups,key=lambda g:g['start'])}
    (OUT/f'test{test}.json').write_text(json.dumps(bank,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    banks.append(bank)
    print('EXTRACTED',test,len(questions),'groups',len(groups),flush=True)

if not args.test:
    # Extract original glossary entries column-by-column to avoid interleaving columns.
    entries=[]
    for pn in range(417,428):
        page=doc[pn-1];tp=page.get_textpage();w,h=page.get_size()
        # Book's three glossary columns.
        for left,right in [(40,184),(184,337),(337,w-25)]:
            raw=tp.get_text_bounded(left=left,right=right,bottom=36,top=h-65).replace('\r\n','\n')
            current=None
            for line in raw.splitlines():
                line=line.strip().replace('（','(').replace('）',')')
                if not line or line=='〓' or re.fullmatch(r'[A-Z]',line):continue
                m=re.match(r'([A-Za-z][A-Za-z0-9\s\-’\'&,./()+~]*?)\s*([\u4e00-\u9fff（].*)',line)
                if m:
                    if current:entries.append(current)
                    term=m.group(1).strip();meaning=m.group(2).strip()
                    if term.endswith('('):term=term[:-1].strip();meaning='('+meaning
                    current={'term':term,'meaning':meaning,'page':pn}
                elif current and re.search(r'[\u4e00-\u9fff]',line):current['meaning']+=line
            if current:entries.append(current)
        tp.close();page.close()
    seen=set();words=[]
    for e in entries:
        key=e['term'].lower()
        if key in seen:continue
        seen.add(key);refs=[];frequency=0
        pattern=re.compile(r'(?<![a-z])'+re.escape(key)+r'(?![a-z])',re.I)
        for b in banks:
            for q in b['questions']:
                corpus=q['stem']+' '+' '.join(o['text'] for o in q['options'])+' '+q['text']+' '+q['extra']
                if pattern.search(corpus):refs.append(q['id'])
            corpus='\n'.join(q['stem']+' '+' '.join(o['text'] for o in q['options']) for q in b['questions'])+'\n'+'\n'.join(g['text'] for g in b['groups'])
            frequency+=len(pattern.findall(corpus))
        words.append({'id':hashlib.sha1(key.encode()).hexdigest()[:12],**e,'frequency':frequency,'references':refs[:30]})
    words.sort(key=lambda e:(-e['frequency'],e['term'].lower()))
    (OUT/'vocabulary.json').write_text(json.dumps(words,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    print('VOCABULARY',len(words),flush=True)
plumber.close();doc.close()
