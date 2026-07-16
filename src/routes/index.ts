// GET / — serve the single-page operator form.
//
// The page is a self-contained static file (inline CSS + vanilla JS). We serve
// it by reading the file and returning it, which avoids any dependency on the
// current working directory. @fastify/static is still registered in server.ts
// for any future assets, but the form itself is returned here explicitly.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { PUBLIC_DIR } from "../config.js";

const indexRoute: FastifyPluginAsync = async function indexRoute(fastify) {
  const indexPath = path.join(PUBLIC_DIR, "index.html");

  fastify.get("/", async function serveForm(_request, reply) {
    const html = await readFile(indexPath, "utf8");
    reply.header("Content-Type", "text/html; charset=utf-8");
    return html;
  });
};

export default indexRoute;
