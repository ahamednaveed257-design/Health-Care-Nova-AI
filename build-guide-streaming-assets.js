#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultChunkBytes = 4 * 1024 * 1024;
const videoRelativePath = "public/media/care-nova-ai-usage-guide-v24.webm";
const assetFolderName = "public__media__care-nova-ai-usage-guide-v24.webm";
const assetFileName = "care-nova-ai-usage-guide-v24.webm";

export async function buildGuideStreamingAssets({
  rootDir = defaultRootDir,
  chunkBytes = defaultChunkBytes
} = {}) {
  const videoPath = path.join(rootDir, ...videoRelativePath.split("/"));
  const largeAssetsDir = path.join(rootDir, "large-assets");
  const chunkDir = path.join(largeAssetsDir, assetFolderName);
  const manifestPath = path.join(largeAssetsDir, "manifest.json");
  const streamingManifestPath = path.join(largeAssetsDir, "streaming-manifest.json");

  if (!existsSync(videoPath)) {
    await mkdir(largeAssetsDir, { recursive: true });
    const missingManifest = {
      name: "Care Nova AI guide streaming assets",
      status: "source-video-missing",
      video: videoRelativePath,
      generatedAt: new Date().toISOString(),
      hls: { ready: false, playlist: "public/media/hls/care-nova-ai-usage-guide-v24.m3u8" },
      dash: { ready: false, manifest: "public/media/dash/care-nova-ai-usage-guide-v24.mpd" },
      chunks: { ready: false, parts: [] }
    };
    await writeFile(streamingManifestPath, `${JSON.stringify(missingManifest, null, 2)}\n`, "utf8");
    return missingManifest;
  }

  await rm(chunkDir, { recursive: true, force: true });
  await mkdir(chunkDir, { recursive: true });

  const details = await stat(videoPath);
  const sha256 = await hashFile(videoPath);
  const parts = await splitFile(videoPath, chunkDir, chunkBytes);
  const generatedAt = new Date().toISOString();
  const manifest = {
    name: "Care Nova AI GitHub large assets",
    packageLimit: "5 MB per file",
    chunkBytes,
    generatedAt,
    files: [
      {
        originalPath: videoRelativePath,
        bytes: details.size,
        sha256,
        mimeType: "video/webm",
        chunkBytes,
        parts
      }
    ]
  };
  const streamingManifest = {
    name: "Care Nova AI guide streaming manifest",
    version: "1.0.0",
    generatedAt,
    strategy: "prefer-native-hls-or-dash-when-generated-fallback-to-github-safe-webm-chunks",
    video: {
      originalPath: videoRelativePath,
      bytes: details.size,
      sha256,
      mimeType: "video/webm"
    },
    hls: {
      ready: existsSync(path.join(rootDir, "public", "media", "hls", "care-nova-ai-usage-guide-v24.m3u8")),
      playlist: "public/media/hls/care-nova-ai-usage-guide-v24.m3u8",
      contentType: "application/vnd.apple.mpegurl",
      note: "Generate with ffmpeg for native HLS playback. Chrome still falls back unless hls.js is added."
    },
    dash: {
      ready: existsSync(path.join(rootDir, "public", "media", "dash", "care-nova-ai-usage-guide-v24.mpd")),
      manifest: "public/media/dash/care-nova-ai-usage-guide-v24.mpd",
      contentType: "application/dash+xml",
      note: "Generate with ffmpeg or MP4Box for DASH playback. Browser support requires an MSE player."
    },
    chunks: {
      ready: true,
      originalPath: videoRelativePath,
      chunkBytes,
      partCount: parts.length,
      parts
    }
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(streamingManifestPath, `${JSON.stringify(streamingManifest, null, 2)}\n`, "utf8");

  return streamingManifest;
}

async function splitFile(sourcePath, targetDir, chunkBytes) {
  const parts = [];
  let partIndex = 1;
  let buffer = Buffer.alloc(0);

  for await (const chunk of createReadStream(sourcePath)) {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= chunkBytes) {
      const part = buffer.subarray(0, chunkBytes);
      buffer = buffer.subarray(chunkBytes);
      parts.push(await writePart(targetDir, partIndex, part));
      partIndex += 1;
    }
  }

  if (buffer.length) {
    parts.push(await writePart(targetDir, partIndex, buffer));
  }

  return parts;
}

async function writePart(targetDir, index, buffer) {
  const fileName = `${assetFileName}.part-${String(index).padStart(3, "0")}`;
  const fullPath = path.join(targetDir, fileName);
  await writeFile(fullPath, buffer);
  return `large-assets/${assetFolderName}/${fileName}`;
}

async function hashFile(filePath) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildGuideStreamingAssets()
    .then((manifest) => {
      console.log("Guide streaming assets built.");
      console.log(`Chunks ready: ${manifest.chunks?.partCount || 0}`);
      console.log(`HLS ready: ${manifest.hls?.ready === true}`);
      console.log(`DASH ready: ${manifest.dash?.ready === true}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
