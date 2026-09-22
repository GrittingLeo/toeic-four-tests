"""Prepare speech-optimized originals and inspect spoken question markers."""
from pathlib import Path
import json, re, sys, argparse
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tmp/asr-deps'))
parser=argparse.ArgumentParser();parser.add_argument('--encode',action='store_true');args=parser.parse_args()
units=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen']
nums={i:(units[i] if i<20 else ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'][i//10]+(' '+units[i%10] if i%10 else '')) for i in range(100)}
nums[100]='one hundred'
for t in range(1,5):
    data=json.loads((ROOT/f'tmp/audio-audit/test{t}.json').read_text('utf8'))
    words=[w for s in data['segments'] for w in s['words']]
    transcript='';offsets=[]
    for w in words:offsets.append((len(transcript),w['start']));transcript+=w['word'].lower().replace('-',' ')+' '
    def timestamp(pos):return next(tm for idx,tm in reversed(offsets) if idx<=pos)
    reverse={v:k for k,v in nums.items()}
    pattern=r'\b(number|questions?|numbers)\s+('+r'\d{1,3}|'+ '|'.join(sorted(reverse,key=len,reverse=True))+r')\b'
    markers=[]
    for m in re.finditer(pattern,transcript):
        n=int(m[2]) if m[2].isdigit() else reverse[m[2]]
        if 1<=n<=100:markers.append({'n':n,'time':timestamp(m.start()),'text':transcript[m.start():m.end()+80].strip()})
    (ROOT/f'tmp/audio-audit/markers{t}.json').write_text(json.dumps(markers,ensure_ascii=False,indent=2),'utf8')
    print('TEST',t,[(m['n'],m['time']) for m in markers],flush=True)
    if args.encode:
        import av
        target=ROOT/f'web/media/test{t}.mp3';target.parent.mkdir(exist_ok=True)
        if not target.exists():
            source=av.open(f'E:/BaiduNetdiskDownload/Actual Test {t}.mp3')
            output=av.open(str(target),'w');stream=output.add_stream('libmp3lame',rate=44100);stream.bit_rate=64000;stream.layout='mono'
            resampler=av.AudioResampler(format='fltp',layout='mono',rate=44100)
            for frame in source.decode(audio=0):
                for converted in resampler.resample(frame):
                    for packet in stream.encode(converted):output.mux(packet)
            for packet in stream.encode(None):output.mux(packet)
            output.close();source.close()
        print('AUDIO',t,target.stat().st_size,flush=True)
