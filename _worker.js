export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const domain = env.DOMAIN;
    const R2_BUCKET = env.R2_BUCKET;
    const maxSizeMB = env.MAX_SIZE_MB ? parseInt(env.MAX_SIZE_MB, 100) : 100;
    const maxSize = maxSizeMB * 1024 * 1024;
    const AUTH = env.AUTH;

    switch (pathname) {
      case "/upload":
        return request.method === "POST"
          ? await handleUploadRequest(request, domain, R2_BUCKET, maxSize, AUTH)
          : new Response("Method Not Allowed", { status: 405 });
      default:
        return await handleImageRequest(request, R2_BUCKET);
    }
  },
};

async function handleUploadRequest(request, domain, R2_BUCKET, maxSize, AUTH) {
  try {
    // 校验Authorization头
    if (AUTH) {
  const authHeader = request.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "缺少Authorization头" }), {
        status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (authHeader !== AUTH) {
        return new Response(
          JSON.stringify({ error: "Authorization验证失败" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const folderPath = formData.get("path") || ""; // 获取文件夹路径
    if (!file) throw new Error("缺少文件");

    if (file.size > maxSize) {
      return new Response(
        JSON.stringify({
          error: `文件大小超过${maxSize / (1024 * 1024)}MB限制`,
        }),
        { status: 413, headers: { "Content-Type": "application/json" } }
      );
    }

    // 生成文件名+时间戳+后缀的键名，支持文件夹路径
    const timestamp = Date.now();
    const fileExtension = file.name.split(".").pop();
    const fileName = file.name.replace(/\.[^/.]+$/, ""); // 移除扩展名
    
    // 处理文件夹路径
    let r2Key;
    if (folderPath && folderPath.trim()) {
      // 清理路径，移除开头和结尾的斜杠，确保路径格式正确
      const cleanPath = folderPath.trim().replace(/^\/+|\/+$/g, '');
      r2Key = `${cleanPath}/${fileName}_${timestamp}.${fileExtension}`;
    } else {
      r2Key = `${fileName}_${timestamp}.${fileExtension}`;
    }

    // 上传到R2
    await R2_BUCKET.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    // 生成访问URL
    const fileURL = `https://${domain}/${r2Key}`;

    return new Response(JSON.stringify(fileURL), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("R2 上传错误:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function handleImageRequest(request, R2_BUCKET) {
  const requestedUrl = request.url;
  const cache = caches.default;
  const cacheKey = new Request(requestedUrl);
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) return cachedResponse;

  // 解析文件路径 - 支持文件夹嵌套
  const url = new URL(requestedUrl);
  const pathname = url.pathname;
  // 移除开头的斜杠，获取相对于域名的路径
  const r2Key = pathname.startsWith('/') ? pathname.substring(1) : pathname;

  // 直接从R2获取文件
  const object = await R2_BUCKET.get(r2Key);
  if (!object) {
    return new Response("获取文件内容失败", { status: 404 });
  }

  // 使用R2存储的Content-Type，如果没有则根据文件扩展名推断
  let contentType =
    object.httpMetadata?.contentType || "application/octet-stream";

  // 如果R2没有存储Content-Type，根据文件扩展名推断
  if (contentType === "application/octet-stream") {
    const fileExtension = r2Key.split(".").pop()?.toLowerCase();
    switch (fileExtension) {
      case "jpg":
      case "jpeg":
    contentType = "image/jpeg";
        break;
      case "png":
        contentType = "image/png";
        break;
      case "gif":
        contentType = "image/gif";
        break;
      case "webp":
        contentType = "image/webp";
        break;
      case "svg":
        contentType = "image/svg+xml";
        break;
      case "mp4":
        contentType = "video/mp4";
        break;
      case "webm":
        contentType = "video/webm";
        break;
      case "avi":
        contentType = "video/x-msvideo";
        break;
      case "mov":
        contentType = "video/quicktime";
        break;
      case "pdf":
        contentType = "application/pdf";
        break;
      case "txt":
        contentType = "text/plain";
        break;
      case "html":
        contentType = "text/html";
        break;
      case "css":
        contentType = "text/css";
        break;
      case "js":
        contentType = "application/javascript";
        break;
      case "json":
        contentType = "application/json";
        break;
      case "zip":
        contentType = "application/zip";
        break;
      case "rar":
        contentType = "application/x-rar-compressed";
        break;
      case "7z":
        contentType = "application/x-7z-compressed";
        break;
      default:
        contentType = "application/octet-stream";
    }
  }

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Content-Disposition", "inline");
  const responseToCache = new Response(object.body, { status: 200, headers });
  await cache.put(cacheKey, responseToCache.clone());
  return responseToCache;
}
