const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { execFile } = require("child_process");

const app = express();

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.IGSHOT_API_KEY || "";

function cleanupOldFiles(dir, maxAgeMinutes = 30) {
  const maxAgeMs = maxAgeMinutes * 60 * 1000;
  const now = Date.now();
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (!f.endsWith(".png") && !f.endsWith(".json")) continue;
      const p = path.join(dir, f);
      try {
        const st = fs.statSync(p);
        if (now - st.mtimeMs > maxAgeMs) fs.unlinkSync(p);
      } catch (e) {}
    }
  } catch (e) {}
}

function safeSlug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function hashShort(s) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/screenshot", async (req, res) => {
  try {
    const key = req.header("x-api-key");
    if (API_KEY && key !== API_KEY) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const url = req.query.url;
    const username = req.query.username || safeSlug(url);
    if (!url) return res.status(400).json({ error: "missing url" });

    const outDir = "/work/out";
    fs.mkdirSync(outDir, { recursive: true });

    const ts = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "");
    const uniq = hashShort(url + "|" + ts);

    const base = `${safeSlug(username)}_${ts}_${uniq}`;
    const outPng = path.join(outDir, `${base}.png`);
    const outJson = path.join(outDir, `${base}.json`);

    // Appelle ton script existant
    const args = ["/work/ig_shot.js", url, outPng, outJson];

    const result = await new Promise((resolve, reject) => {
      execFile("node", args, { timeout: 180000 }, (err, stdout, stderr) => {
        // Le script console.log(JSON.stringify(result))
        const txt = String(stdout || "").trim().split("\n").pop() || "";
        let parsed = null;
        try { parsed = JSON.parse(txt); } catch (_) {}

        if (err) {
          return reject({
            err: String(err.message || err),
            stderr: String(stderr || ""),
            parsed,
            outPng,
            outJson,
          });
        }
        resolve({
          parsed,
          stderr: String(stderr || ""),
          outPng,
          outJson,
        });
      });
    });

    if (!fs.existsSync(outPng)) {
      return res.status(500).json({
        error: "png_not_created",
        debug: result.parsed || null,
      });
    }

    const buf = fs.readFileSync(outPng);

    // Métadonnées utiles pour n8n (headers)
    const status = result.parsed?.status || "UNKNOWN";
    const postcount = result.parsed?.postcount ?? "";

    res.setHeader("Content-Type", "image/png");
    res.setHeader("x-ig-status", String(status));
    res.setHeader("x-ig-postcount", String(postcount));
    res.setHeader("x-ig-outpng", path.basename(outPng));
    res.setHeader("x-ig-outjson", path.basename(outJson));

    // Pour que n8n puisse aussi récupérer le JSON si besoin
    res.setHeader("x-ig-result", Buffer.from(JSON.stringify(result.parsed || {}), "utf8").toString("base64"));

    cleanupOldFiles(outDir, 30);

    res.setHeader("Content-Type", "image/png");
    // ... tes headers x-ig-...
    return res.status(200).send(buf);


  } catch (e) {
    return res.status(500).json({ error: "server_error", details: e });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`igshot server listening on :${PORT}`);
});
