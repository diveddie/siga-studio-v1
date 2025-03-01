import express from "express";
import fs from "fs";
import { writeFile, unlink } from "node:fs/promises";
import path from "path";
import { createServer as createViteServer } from "vite";
import "dotenv/config";
import Replicate from "replicate";
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENAI_API_KEY;
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Serve static files from uploads directory
app.use("/uploads", express.static(uploadsDir));

app.use(express.json());

// Configure Vite middleware for React client
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
});
app.use(vite.middlewares);

async function cleanupOldFiles() {
  try {
    const files = await fs.promises.readdir(uploadsDir);
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000; // 1 hour in milliseconds

    for (const file of files) {
      const filepath = path.join(uploadsDir, file);
      const stats = await fs.promises.stat(filepath);

      if (stats.ctimeMs < oneHourAgo) {
        await unlink(filepath);
      }
    }
  } catch (error) {
    console.error("Cleanup error:", error);
  }
}

// API route for token generation
app.get("/token", async (req, res) => {
  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview-2024-12-17",
          voice: "verse",
        }),
      },
    );

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Token generation error:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

app.post("/generate-image", async (req, res) => {
  try {
    const output = await replicate.run("black-forest-labs/flux-dev", {
      input: {
        prompt: req.body.prompt,
        guidance: req.body.guidance || 3.5,
        output_format: "webp",
        go_fast: true,
      },
    });

    console.log('Replicate output:', output);

    // Get the image URL from the output array
    const imageUrl = output[0];

    // Fetch the image from the Replicate URL
    const response = await fetch(imageUrl);
    const imageBuffer = await response.arrayBuffer();

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `generated_${timestamp}.webp`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('images')
      .upload(filename, Buffer.from(imageBuffer), {
        contentType: 'image/webp',
        cacheControl: '3600'
      });

    if (error) throw error;

    // Get the public URL
    const { data: { publicUrl } } = supabase.storage
      .from('images')
      .getPublicUrl(filename);

    res.json([{ url: publicUrl }]);
  } catch (error) {
    console.error("Image generation error:", error);
    res.status(500).json({ error: "Failed to generate image" });
  }
});

app.post("/edit-image", async (req, res) => {
  try {
    const form = new FormData();
    form.append("image_file", req.body.imageFile);
    form.append("mask", req.body.mask);
    form.append("prompt", req.body.prompt);
    form.append("model", "V_1");

    const response = await fetch("https://api.ideogram.ai/edit", {
      method: "POST",
      headers: {
        "Api-Key": ideogramApiKey,
      },
      body: form,
    });

    const { data } = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Image editing error:", error);
    res.status(500).json({ error: "Failed to edit image" });
  }
});

app.post("/get-segments", async (req, res) => {
  try {
    const output = await replicate.run(
      "meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83",
      {
        input: {
          image: req.body.imageUrl,
        },
      },
    );

    res.json({
      combined_mask: output.combined_mask,
      individual_masks: output.individual_masks,
    });
  } catch (error) {
    console.error("Segment analysis error:", error);
    res.status(500).json({ error: "Failed to analyze image segments" });
  }
});

// Render the React client
app.use("*", async (req, res, next) => {
  const url = req.originalUrl;

  try {
    const template = await vite.transformIndexHtml(
      url,
      fs.readFileSync("./client/index.html", "utf-8"),
    );
    const { render } = await vite.ssrLoadModule("./client/entry-server.jsx");
    const appHtml = await render(url);
    const html = template.replace(`<!--ssr-outlet-->`, appHtml?.html);
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  } catch (e) {
    vite.ssrFixStacktrace(e);
    next(e);
  }
});

// Run cleanup every hour
setInterval(cleanupOldFiles, 60 * 60 * 1000);

app.listen(port, () => {
  console.log(`Express server running on *:${port}`);
});
