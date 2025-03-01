import express from "express";
import fs from "fs";
import { writeFile, unlink } from "node:fs/promises";
import path from "path";
import { createServer as createViteServer } from "vite";
import "dotenv/config";
import Replicate from "replicate";
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

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

async function imageUrlToBase64(imageUrl) {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      maxContentLength: 50 * 1024 * 1024, // 50MB max
      timeout: 30000 // 30 seconds timeout
    });
    return Buffer.from(response.data).toString('base64');
  } catch (error) {
    console.error('Error fetching image:', error.message);
    throw new Error(`Failed to fetch image: ${error.message}`);
  }
}

app.post("/get-segments", async (req, res) => {
  try {
    if (!req.body.currentImageUrl) {
      throw new Error('No image URL provided');
    }

    console.log('Fetching image from:', req.body.currentImageUrl);
    const imageBase64 = await imageUrlToBase64(req.body.currentImageUrl);
    const segmentPrompt = req.body.prompt || "object";
    
    console.log('Making request to Segmind API...');
    const response = await axios.post(
      "https://api.segmind.com/v1/automatic-mask-generator",
      {
        prompt: segmentPrompt,
        image: imageBase64,
        threshold: 0.2,
        invert_mask: false,
        return_mask: true,
        grow_mask: 10,
        seed: Math.floor(Math.random() * 1000000),
        base64: false
      },
      {
        headers: {
          'x-api-key': process.env.SEGMIND_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 seconds timeout
      }
    );

    if (!response.data || !response.data.combined_mask) {
      throw new Error('Invalid response from Segmind API');
    }

    // Store combined mask
    const timestamp = Date.now();
    console.log('Fetching combined mask from:', response.data.combined_mask);
    const combinedMaskBuffer = await (await fetch(response.data.combined_mask)).arrayBuffer();
    const combinedMaskFilename = `mask_combined_${timestamp}.png`;
    
    const { error: combinedError } = await supabase.storage
      .from('masks')
      .upload(combinedMaskFilename, Buffer.from(combinedMaskBuffer), {
        contentType: 'image/png',
        cacheControl: '3600'
      });

    if (combinedError) throw combinedError;

    // Get combined mask public URL
    const { data: { publicUrl: combinedMaskUrl } } = supabase.storage
      .from('masks')
      .getPublicUrl(combinedMaskFilename);

    // Store individual masks and get their URLs
    const individualMaskUrls = await Promise.all(
      (response.data.masks || []).map(async (maskUrl, index) => {
        console.log(`Fetching individual mask ${index} from:`, maskUrl);
        const maskBuffer = await (await fetch(maskUrl)).arrayBuffer();
        const maskFilename = `mask_individual_${timestamp}_${index}.png`;
        
        const { error: maskError } = await supabase.storage
          .from('masks')
          .upload(maskFilename, Buffer.from(maskBuffer), {
            contentType: 'image/png',
            cacheControl: '3600'
          });

        if (maskError) throw maskError;

        const { data: { publicUrl } } = supabase.storage
          .from('masks')
          .getPublicUrl(maskFilename);

        return publicUrl;
      })
    );

    // Return the Supabase URLs instead of the original URLs
    res.json({
      combined_mask: combinedMaskUrl,
      individual_masks: individualMaskUrls
    });
  } catch (error) {
    console.error("Segment analysis error:", error.response?.data || error.message);
    console.error("Full error:", error);
    res.status(500).json({ 
      error: "Failed to analyze image segments",
      details: error.response?.data || error.message
    });
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
