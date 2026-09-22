import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../web',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webp':'image/webp','.mp3':'audio/mpeg'};
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,`http://${req.headers.host}`);
 if(!['127.0.0.1','localhost'].includes(url.hostname)){res.writeHead(403);return res.end();}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
 const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
 if(!file.startsWith(path.resolve(root)+path.sep)){res.writeHead(403);return res.end();}
 const info=await stat(file);if(!info.isFile())throw Error('not a file');
 const data=await readFile(file),headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','Accept-Ranges':'bytes'};
 const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
 if(range){const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):data.length-1,data.length-1);if(start>end||start>=data.length){res.writeHead(416,{'Content-Range':`bytes */${data.length}`});return res.end();}res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':end-start+1});return res.end(req.method==='HEAD'?undefined:data.subarray(start,end+1));}
 res.writeHead(200,{...headers,'Content-Length':data.length});res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404);res.end('Not found');}});
server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('TOEIC practice: http://127.0.0.1:4173'));
