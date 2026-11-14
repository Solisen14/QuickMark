const CACHE = "quickmark-v0.4";
const ASSETS = ["./","./index.html","./styles.css?v=0.4","./app.js?v=0.3","./omr.js?v=0.3","./icon.svg","./apple-touch-icon.png","./manifest.webmanifest"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("quickmark-") && key!==CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
// Network-first avoids the stale-code problem, while retaining offline fallback.
self.addEventListener("fetch", event => {
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin || !url.pathname.startsWith(new URL("./",self.registration.scope).pathname))return;
  event.respondWith(
    fetch(request).then(response=>{
      if(response.ok && response.type==="basic"){
        const copy=response.clone();
        event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)));
      }
      return response;
    }).catch(async()=>{
      const cached=await caches.match(request,{ignoreSearch:true});
      return cached||Response.error();
    })
  );
});
