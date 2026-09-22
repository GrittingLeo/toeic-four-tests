import {readFile,writeFile} from 'node:fs/promises';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
// ASR omitted these spoken headings. These offsets were checked against the
// adjacent timestamped words; padding retains the lead-in, not just the question.
const corrections={1:{32:831.5,38:973},3:{31:766},4:{18:502}};
const output={};
for(let t=1;t<=4;t++){
 const data=await read(`tmp/audio-audit/test${t}.json`),markers=await read(`tmp/audio-audit/markers${t}.json`);
 const starts=[...Array.from({length:31},(_,i)=>i+1),...Array.from({length:23},(_,i)=>32+i*3)],groups={};
 for(const n of starts){
  let candidate=markers.find(m=>m.n===n&&(n<32?m.time<810:/^questions?\b/.test(m.text)));
  if(!candidate&&n<32){const s=data.segments.find(s=>new RegExp(`^\\s*(?:No\\.\\s*)?${n}\\.`,'i').test(s.text));if(s)candidate={time:s.words[0].start,text:s.text};}
  const time=corrections[t]?.[n]??candidate?.time;
  if(time===undefined)throw Error(`Missing cue ${t}/${n}`);
  groups[n]={start:Math.max(0,Math.round((time-.6)*100)/100),end:0};
 }
 starts.forEach((n,i)=>{groups[n].end=i+1<starts.length?groups[starts[i+1]].start:data.duration; if(groups[n].end<=groups[n].start)throw Error('Cue ordering');});
 output[t]={duration:data.duration,groups};
 console.log(`Test ${t}: ${starts.length} listening groups indexed`);
}
await writeFile('web/data/audio.json',JSON.stringify(output));
