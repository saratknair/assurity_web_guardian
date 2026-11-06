// Local preview server for a built Pages site (dashboard + data).
// Usage: node scripts/serve-site.cjs <site-dir> [port=8080]
// Serves static files from <site-dir> on 127.0.0.1 only. Dev/QA helper, not used in CI.
const http=require("http"),fs=require("fs"),path=require("path");
const root=path.resolve(process.argv[2]);const port=+process.argv[3]||8080;
const T={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".svg":"image/svg+xml",".webm":"video/webm"};
http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split("?")[0]);let f=path.join(root,p);
if(!f.startsWith(root)){s.writeHead(403);return s.end();}
if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,"index.html");
fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);return s.end("404");}s.writeHead(200,{"Content-Type":T[path.extname(f)]||"application/octet-stream"});s.end(d);});
}).listen(port,"127.0.0.1",()=>console.log("serving "+root+" on "+port));