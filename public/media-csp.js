// Narrow the CSP in index.html, which must allow every port on 127.0.0.1
// because the media server's port is picked at startup, to that one port.
// A second policy only ever tightens the first: a request has to pass both.
// Runs before any other script so it is in force before the first request.
// Only for the bundled renderer (file:), not the dev server, whose HMR
// socket and module requests the narrower policy would block.
// Keep the sources in sync with index.html's img-src, media-src and
// connect-src: one added there but not here is still blocked.
(function () {
  if (location.protocol !== "file:") return;
  var origin = window.api && window.api.mediaOrigin;
  // No media server (it failed to start): nothing on 127.0.0.1 is the app's.
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || "")) origin = "";
  var meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content =
    "img-src 'self' data: blob: " +
    origin +
    "; media-src 'self' blob: " +
    origin +
    "; connect-src 'self' " +
    origin;
  document.head.appendChild(meta);
})();
