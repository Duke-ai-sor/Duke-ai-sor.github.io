#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

function httpRequest(url, method = 'HEAD'){
  return new Promise((resolve, reject)=>{
    try{
      const lib = url.startsWith('https') ? https : http;
      const req = lib.request(url, { method, headers: { 'User-Agent': 'EmbedChecker/1.0 (+https://github.com/Duke-ai-sor/Duke-ai-sor.github.io)' }, timeout: 15000 }, (res)=>{
        resolve({statusCode: res.statusCode, headers: res.headers});
        res.resume();
      });
      req.on('error', err=> reject(err));
      req.on('timeout', ()=> { req.destroy(new Error('timeout')) });
      req.end();
    }catch(err){ reject(err) }
  })
}

(async function main(){
  const gamesDir = path.join(__dirname, '..', 'games');
  const files = fs.readdirSync(gamesDir).filter(f => f.toLowerCase().endsWith('.html'));
  const urls = new Map();
  for(const file of files){
    const full = path.join(gamesDir, file);
    const txt = fs.readFileSync(full, 'utf8');
    const m = txt.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if(m && m[1]){
      const url = m[1].trim();
      if(!urls.has(url)) urls.set(url, []);
      urls.get(url).push(file);
    }
  }

  const results = [];
  for(const [url, files] of urls.entries()){
    console.log(`Checking ${url} (found in ${files.join(', ')}) ...`);
    let info = { url, files, ok: false, headers: null, status: null, reason: null };
    try{
      // try HEAD first
      let res;
      try{ res = await httpRequest(url, 'HEAD'); }
      catch(e){
        // some hosts block HEAD; fall back to GET for a small range
        res = await httpRequest(url, 'GET');
      }
      info.status = res.statusCode;
      info.headers = res.headers;
      const xfo = res.headers['x-frame-options'] || res.headers['x-frame-options'.toLowerCase()];
      const csp = res.headers['content-security-policy'] || res.headers['content-security-policy'.toLowerCase()];
      if(xfo){
        info.reason = `X-Frame-Options: ${xfo}`;
        info.ok = !(xfo.toLowerCase().includes('deny') || xfo.toLowerCase().includes('sameorigin'));
      }
      if(csp && csp.toLowerCase().includes('frame-ancestors')){
        info.reason = info.reason ? info.reason + '; CSP frame-ancestors present' : 'CSP frame-ancestors present';
        // conservative: assume blocked
        info.ok = false;
      }
      if(!xfo && (!csp || !csp.toLowerCase().includes('frame-ancestors'))){ info.ok = true; }
    }catch(err){
      info.reason = `request error: ${err.message}`;
      info.ok = false;
    }
    results.push(info);
  }

  const out = { timestamp: (new Date()).toISOString(), results };
  fs.writeFileSync(path.join(__dirname, '..', 'embed-report.json'), JSON.stringify(out, null, 2));
  console.log('\nEmbed check finished. Summary:');
  const blocked = results.filter(r => !r.ok);
  console.log(`Total unique frames: ${results.length}, blocked/unknown: ${blocked.length}`);
  console.log('Report written to embed-report.json');
})();
