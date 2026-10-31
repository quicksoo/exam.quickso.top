import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const port = Number(process.env.PORT) || 4174;
const routes = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/robots.txt", ["robots.txt", "text/plain; charset=utf-8"]],
  ["/sitemap.xml", ["sitemap.xml", "application/xml; charset=utf-8"]],
]);

createServer(async (request, response) => {
  let pathname;
  try { pathname = new URL(request.url, "http://localhost").pathname; }
  catch { response.writeHead(400); response.end("Bad request"); return; }
  const route = routes.get(pathname);
  if (!route) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  try {
    const content = await readFile(new URL(route[0], import.meta.url));
    response.writeHead(200, { "Content-Type": route[1], "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    response.writeHead(500); response.end("Unable to load page");
  }
}).listen(port, "127.0.0.1", () => console.log(`QuickSo Exam: http://127.0.0.1:${port}`));
