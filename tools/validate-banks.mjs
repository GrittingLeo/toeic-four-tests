import assert from 'node:assert/strict';
import {readFile,access,stat} from 'node:fs/promises';
import {POS_LABELS} from '../web/vocabulary.js';
const read=async name=>JSON.parse(await readFile(`web/data/${name}.json`,'utf8'));
const audio=await read('audio'),all=new Set();
for(let t=1;t<=4;t++){
 const b=await read(`test${t}`);assert.equal(b.questions.length,200);assert.equal(b.groups.length,103);
 const counts=[6,25,39,30,30,16,54];
 for(let p=1;p<=7;p++)assert.equal(b.questions.filter(q=>q.part===p).length,counts[p-1]);
 for(const [i,q] of b.questions.entries()){
  assert.equal(q.number,i+1);assert.equal(q.id,`t${t}-q${i+1}`);assert(!all.has(q.id));all.add(q.id);
  assert.deepEqual(q.options.map(o=>o.key),q.part===2?['A','B','C']:['A','B','C','D']);
  assert(q.options.every(o=>o.text.trim()));assert(q.options.some(o=>o.key===q.answer));
  if(q.part<=2)assert(q.options.every(o=>o.text.length>3&&q.extra.replace(/\s+/g,' ').includes(o.text)),`missing source option text ${q.id}`);
  assert(new RegExp(`答案\\s*[（(]\\s*${q.answer}\\s*[）)]`).test(q.text),`explanation mismatch ${q.id}`);assert(q.tag);
  if(q.part===5)assert.equal((q.stem.match(/______/g)||[]).length,1,`blank ${q.id}`);
  const g=b.groups.find(g=>g.id===q.groupId);assert(g&&q.number>=g.start&&q.number<=g.end);
  await access(`web/images/p${String(q.explanationPage).padStart(3,'0')}.webp`);
 }
 for(const g of b.groups){
  for(const im of g.images){await access(`web/${im.src}`);assert(im.box[2]>im.box[0]&&im.box[3]>im.box[1]);}
  if(g.start>=32&&g.end<=100)assert(/[A-Za-z]{4}/.test(g.transcript),`missing transcript ${g.id}`);
 }
 const cues=Object.values(audio[t].groups);assert.equal(cues.length,54);
 for(const [n,cue] of Object.entries(audio[t].groups)){
  assert.equal(cue.src,`media/clips/test${t}/q${String(n).padStart(3,'0')}.mp3`);
  assert(Math.abs(cue.duration-(cue.end-cue.start))<.15,`clip duration ${t}/${n}`);
  const clip=await stat(`web/${cue.src}`);assert(clip.size>1000&&clip.size<25*1024*1024);
 }
 for(let i=0;i<cues.length;i++){assert(cues[i].start>=0&&cues[i].end>cues[i].start);assert(cues[i].end<=audio[t].duration+.1);if(i)assert.equal(cues[i-1].end,cues[i].start);}
 const media=await stat(`web/media/test${t}.mp3`);assert(media.size>10000000&&media.size<25*1024*1024);
 console.log(`Test ${t}: 200 questions, answer/explanation agreement, blanks, images, transcripts, 54 audio cues OK`);
}
const words=await read('vocabulary');assert(words.length>300);assert.equal(new Set(words.map(w=>w.id)).size,words.length);
for(const w of words){assert(w.term&&w.meaning);assert(Array.isArray(w.pos)&&w.pos.length&&w.pos.every(p=>POS_LABELS[p]),`missing POS ${w.term}`);assert(Number.isInteger(w.frequency)&&w.frequency>=0);assert(w.references.every(id=>all.has(id)));}
console.log(`${words.length} source vocabulary entries OK`);
