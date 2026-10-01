/* FLUI - Service Worker (somente para a versao web/PWA; o app Android NAO registra este arquivo).
   Estrategia: o app inteiro e guardado no aparelho na instalacao e depois abre direto do cache, sem internet.
   ATUALIZACAO: para publicar uma versao nova, altere VERSAO abaixo (junto com APP_VERSION no index.html).
   Como o conteudo do sw.js muda, o navegador instala o novo cache e apaga o antigo. Os DADOS do usuario
   ficam no localStorage e nao sao tocados pelo service worker. */
var VERSAO = '1.9.1';
var CACHE = 'flui-' + VERSAO;
var ARQUIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './fonts/fonts.css',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3twJwl5FgtIU.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgg.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3vAOwl5FgtIU.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3vAOwlBFgg.woff2',
  './fonts/6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxC9TeA.woff2',
  './fonts/6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxCFTeO-U.woff2',
  './fonts/k3kPo8UDI-1M0wlSV9XAw6lQkqWY8Q82sLydOxI.woff2',
  './fonts/k3kPo8UDI-1M0wlSV9XAw6lQkqWY8Q82sLyTOxK-vA.woff2',
  './lib/leitor-fatura.js',
  './lib/pdfjs/pdf.min.js',
  './lib/pdfjs/pdf.worker.min.js',
  './lib/pdfjs/LICENSE.txt',
  './lib/pdfjs/ORIGEM.txt'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(ARQUIVOS); }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(nomes){
      return Promise.all(nomes.filter(function(n){ return n.indexOf('flui-') === 0 && n !== CACHE; }).map(function(n){ return caches.delete(n); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;
  var url = new URL(req.url);
  if(url.origin !== self.location.origin) return;            /* nunca intercepta outros dominios (o app nao usa nenhum) */
  e.respondWith(
    caches.match(req, {ignoreSearch: true}).then(function(achado){
      if(achado) return achado;
      if(req.mode === 'navigate') return caches.match('./index.html');
      return fetch(req);
    }).catch(function(){
      return req.mode === 'navigate' ? caches.match('./index.html') : Response.error();
    })
  );
});
