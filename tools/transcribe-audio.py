"""Local-only audio alignment evidence; recognized words never replace book text."""
from pathlib import Path
import sys, os, json, argparse
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tmp/asr-deps'))
os.environ['HF_HUB_DISABLE_XET']='1'
os.environ['HF_HUB_DISABLE_SYMLINKS_WARNING']='1'
from faster_whisper import WhisperModel
parser=argparse.ArgumentParser();parser.add_argument('--test',type=int);args=parser.parse_args()
out=ROOT/'tmp/audio-audit';out.mkdir(exist_ok=True)
model=WhisperModel('base.en',device='cpu',compute_type='int8',cpu_threads=6,download_root=str(ROOT/'tmp/asr-models'))
for n in ([args.test] if args.test else range(1,5)):
    target=out/f'test{n}.json'
    if target.exists():continue
    segments,info=model.transcribe(f'E:/BaiduNetdiskDownload/Actual Test {n}.mp3',language='en',beam_size=3,word_timestamps=True,vad_filter=True,condition_on_previous_text=False)
    result=[]
    for s in segments:
        result.append({'start':s.start,'end':s.end,'text':s.text,'words':[{'start':w.start,'end':w.end,'word':w.word,'probability':w.probability} for w in (s.words or [])]})
        if len(result)%50==0:print('PROGRESS',n,round(s.end),'seconds',flush=True)
    target.write_text(json.dumps({'test':n,'duration':info.duration,'segments':result},ensure_ascii=False),encoding='utf8')
    print('COMPLETE',n,len(result),flush=True)
