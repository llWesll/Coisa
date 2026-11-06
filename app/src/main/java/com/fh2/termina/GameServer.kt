package com.fh2.termina

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.Executors

/**
 * Servidor HTTP minúsculo, só em 127.0.0.1.
 * - serve a pasta www do jogo (com Range, keep-alive)
 * - injeta o shim NW.js (nodeshim.js) e os controles de toque (touch.js) no index.html
 * - expõe a API de arquivos em /__fs/ (protegida por token) usado pelo shim de "fs" para saves e plugins
 */
class GameServer(
    private val root: File,
    private val token: String,
    private val onError: (String) -> Unit,
    private val shimReader: (String) -> ByteArray?
) {
    private class Req(
        val method: String,
        val path: String,
        val query: Map<String, String>,
        val headers: Map<String, String>,
        val body: ByteArray,
        val keep: Boolean
    )

    private var server: ServerSocket? = null
    private val pool = Executors.newCachedThreadPool()

    @Volatile
    private var running = false
    private val rootPath: String = root.canonicalPath

    fun start(): Int {
        val loop = InetAddress.getByName("127.0.0.1")
        val ss = try {
            ServerSocket(PREFERRED_PORT, 64, loop)
        } catch (e: IOException) {
            ServerSocket(0, 64, loop)
        }
        server = ss
        running = true
        val t = Thread {
            while (running) {
                try {
                    val s = ss.accept()
                    pool.execute { handle(s) }
                } catch (e: IOException) {
                    if (!running) break
                }
            }
        }
        t.isDaemon = true
        t.name = "fh2-accept"
        t.start()
        return ss.localPort
    }

    fun stop() {
        running = false
        try {
            server?.close()
        } catch (e: IOException) {
        }
        pool.shutdownNow()
    }

    // ------------------------------------------------------------------ conexão

    private fun handle(socket: Socket) {
        try {
            socket.tcpNoDelay = true
            socket.soTimeout = 60000
            val ins = java.io.BufferedInputStream(socket.getInputStream(), 65536)
            val out = java.io.BufferedOutputStream(socket.getOutputStream(), 65536)
            while (running) {
                if (!serveOne(ins, out)) break
                out.flush()
            }
            out.flush()
        } catch (e: Exception) {
            // cliente fechou / timeout: ignorar
        } finally {
            try {
                socket.close()
            } catch (e: IOException) {
            }
        }
    }

    private fun readLine(ins: InputStream): String? {
        val sb = StringBuilder()
        var n = 0
        while (true) {
            val c = ins.read()
            if (c < 0) return if (sb.isEmpty()) null else sb.toString()
            if (c == '\n'.code) break
            if (c != '\r'.code) sb.append(c.toChar())
            n++
            if (n > 16384) throw IOException("linha longa demais")
        }
        return sb.toString()
    }

    private fun readFully(ins: InputStream, len: Int): ByteArray {
        val buf = ByteArray(len)
        var off = 0
        while (off < len) {
            val r = ins.read(buf, off, len - off)
            if (r < 0) throw IOException("EOF")
            off += r
        }
        return buf
    }

    private fun parseQuery(qs: String): Map<String, String> {
        val m = HashMap<String, String>()
        for (pair in qs.split("&")) {
            if (pair.isEmpty()) continue
            val i = pair.indexOf('=')
            val k = if (i >= 0) pair.substring(0, i) else pair
            val v = if (i >= 0) pair.substring(i + 1) else ""
            try {
                m[URLDecoder.decode(k, "UTF-8")] = URLDecoder.decode(v, "UTF-8")
            } catch (e: Exception) {
            }
        }
        return m
    }

    private fun serveOne(ins: InputStream, out: OutputStream): Boolean {
        var line = readLine(ins) ?: return false
        while (line.isEmpty()) {
            line = readLine(ins) ?: return false
        }
        val parts = line.split(" ")
        if (parts.size < 2) return false
        val method = parts[0].uppercase()
        val target = parts[1]

        val headers = HashMap<String, String>()
        while (true) {
            val h = readLine(ins) ?: return false
            if (h.isEmpty()) break
            val i = h.indexOf(':')
            if (i > 0) headers[h.substring(0, i).trim().lowercase()] = h.substring(i + 1).trim()
        }
        val len = headers["content-length"]?.toLongOrNull() ?: 0L
        if (len > MAX_BODY) {
            sendText(out, 413, "Payload Too Large", "too large", false)
            return false
        }
        val body = if (len > 0) readFully(ins, len.toInt()) else ByteArray(0)
        val keep = headers["connection"]?.equals("close", ignoreCase = true) != true

        val qi = target.indexOf('?')
        val rawPath = if (qi >= 0) target.substring(0, qi) else target
        val query = if (qi >= 0) parseQuery(target.substring(qi + 1)) else emptyMap()
        val path = try {
            // '+' em caminho é literal (ex.: "CBF_NameInput+")
            URLDecoder.decode(rawPath.replace("+", "%2B"), "UTF-8")
        } catch (e: Exception) {
            sendText(out, 400, "Bad Request", "bad request", false)
            return false
        }
        val req = Req(method, path, query, headers, body, keep)
        return try {
            route(req, out)
        } catch (e: Throwable) {
            // em vez de fechar a conexão sem resposta, devolve o erro (aparece na tela do app)
            val msg = "Servidor: " + req.method + " " + req.path + " -> " + e.toString()
            onError(msg)
            val trace = e.stackTrace.take(8).joinToString("\n")
            sendText(out, 500, "Internal Server Error", msg + "\n" + trace, false)
            false
        }
    }

    // ------------------------------------------------------------------ rotas

    private fun route(req: Req, out: OutputStream): Boolean {
        if (req.method != "GET" && req.method != "HEAD" && req.method != "POST") {
            return sendText(out, 405, "Method Not Allowed", "method not allowed", req.keep)
        }
        val p = req.path
        if (p.startsWith("/__android/")) {
            val name = p.removePrefix("/__android/")
            val data = if (name.contains("/") || name.contains("..")) null else shimReader(name)
            return if (data == null) {
                sendText(out, 404, "Not Found", "not found", req.keep)
            } else {
                sendBytes(out, 200, "OK", "application/javascript; charset=utf-8", data, req.keep, "no-cache", req.method == "HEAD")
            }
        }
        if (p.startsWith("/__fs/")) {
            return fsApi(req, out, p.removePrefix("/__fs/"))
        }
        if (p == "/" || p == "/index.html") {
            val f = File(root, "index.html")
            if (!f.isFile) return sendText(out, 404, "Not Found", "index.html não encontrado", req.keep)
            return sendBytes(out, 200, "OK", "text/html; charset=utf-8", patchedIndex(f), req.keep, "no-cache", req.method == "HEAD")
        }
        val f = resolve(p) ?: return sendText(out, 403, "Forbidden", "forbidden", req.keep)
        return serveFile(req, out, f, false)
    }

    private fun resolve(p: String): File? {
        val parts = ArrayList<String>()
        for (s in p.replace('\\', '/').split('/')) {
            when (s) {
                "", "." -> {
                }
                ".." -> {
                    if (parts.isEmpty()) return null
                    parts.removeAt(parts.size - 1)
                }
                else -> parts.add(s)
            }
        }
        val f = File(root, parts.joinToString("/"))
        return try {
            if (f.canonicalPath.startsWith(rootPath)) f else null
        } catch (e: IOException) {
            null
        }
    }

    private fun patchedIndex(f: File): ByteArray {
        var html = f.readText(Charsets.UTF_8)
        val head = "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover\">" +
            "<script>window.__ANDROID_TOKEN=\"" + token + "\";</script>" +
            "<script src=\"/__android/nodeshim.js\"></script>"
        val idx = html.indexOf("<head>", ignoreCase = true)
        html = if (idx >= 0) html.substring(0, idx + 6) + head + html.substring(idx + 6) else head + html
        val touch = "<script src=\"/__android/touch.js\"></script>"
        val marker = "<script type=\"module\" src=\"js/main.js\">"
        val mi = html.indexOf(marker)
        html = if (mi >= 0) {
            html.substring(0, mi) + touch + html.substring(mi)
        } else {
            html.replace("</body>", touch + "</body>")
        }
        return html.toByteArray(Charsets.UTF_8)
    }

    // ------------------------------------------------------------------ /__fs

    private fun fsApi(req: Req, out: OutputStream, op: String): Boolean {
        if (req.query["t"] != token) return sendText(out, 403, "Forbidden", "forbidden", req.keep)
        val f = resolve(req.query["p"] ?: "") ?: return sendText(out, 400, "Bad Request", "bad path", req.keep)
        val k = req.keep
        return when (op) {
            "exists" -> sendText(out, 200, "OK", if (f.exists()) "1" else "0", k)
            "stat" -> {
                if (!f.exists()) {
                    sendText(out, 404, "Not Found", "enoent", k)
                } else {
                    val o = JSONObject()
                    o.put("f", f.isFile)
                    o.put("d", f.isDirectory)
                    o.put("s", f.length())
                    o.put("m", f.lastModified())
                    sendText(out, 200, "OK", o.toString(), k)
                }
            }
            "list" -> {
                val names = f.list()
                if (names == null) {
                    sendText(out, 404, "Not Found", "enoent", k)
                } else {
                    names.sort()
                    val arr = JSONArray()
                    for (n in names) arr.put(n)
                    sendText(out, 200, "OK", arr.toString(), k)
                }
            }
            "read" -> if (f.isFile) serveFile(req, out, f, true) else sendText(out, 404, "Not Found", "enoent", k)
            "write" -> {
                f.parentFile?.mkdirs()
                FileOutputStream(f, req.query["append"] == "1").use { it.write(req.body) }
                sendText(out, 200, "OK", "ok", k)
            }
            "mkdir" -> {
                f.mkdirs()
                sendText(out, 200, "OK", "ok", k)
            }
            "unlink", "rmdir" -> {
                if (!f.exists()) sendText(out, 404, "Not Found", "enoent", k)
                else {
                    f.delete()
                    sendText(out, 200, "OK", "ok", k)
                }
            }
            "rename" -> {
                val to = resolve(req.query["to"] ?: "")
                if (to == null || !f.exists()) {
                    sendText(out, 404, "Not Found", "enoent", k)
                } else {
                    to.parentFile?.mkdirs()
                    f.renameTo(to)
                    sendText(out, 200, "OK", "ok", k)
                }
            }
            else -> sendText(out, 404, "Not Found", "unknown op", k)
        }
    }

    // ------------------------------------------------------------------ arquivos estáticos

    private fun serveFile(req: Req, out: OutputStream, f: File, noStore: Boolean): Boolean {
        if (!f.isFile) return sendText(out, 404, "Not Found", "not found", req.keep)
        val total = f.length()
        var start = 0L
        var end = total - 1
        var status = 200
        val range = req.headers["range"]
        if (range != null && range.startsWith("bytes=") && total > 0) {
            val spec = range.substring(6).substringBefore(',').trim()
            val a = spec.substringBefore('-').trim()
            val b = spec.substringAfter('-', "").trim()
            try {
                if (a.isEmpty()) {
                    val suffix = b.toLong()
                    start = maxOf(0L, total - suffix)
                } else {
                    start = a.toLong()
                    end = if (b.isEmpty()) total - 1 else minOf(b.toLong(), total - 1)
                }
                if (start > end || start >= total) {
                    val h = "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */$total\r\nContent-Length: 0\r\nConnection: " +
                        (if (req.keep) "keep-alive" else "close") + "\r\n\r\n"
                    out.write(h.toByteArray(Charsets.ISO_8859_1))
                    return req.keep
                }
                status = 206
            } catch (e: NumberFormatException) {
                start = 0L
                end = total - 1
                status = 200
            }
        }
        val length = if (total == 0L) 0L else end - start + 1
        val ext = f.name.substringAfterLast('.', "").lowercase()
        val sb = StringBuilder()
        sb.append(if (status == 206) "HTTP/1.1 206 Partial Content\r\n" else "HTTP/1.1 200 OK\r\n")
        sb.append("Content-Type: ").append(mime(ext)).append("\r\n")
        sb.append("Accept-Ranges: bytes\r\n")
        sb.append("Content-Length: ").append(length).append("\r\n")
        if (status == 206) sb.append("Content-Range: bytes ").append(start).append('-').append(end).append('/').append(total).append("\r\n")
        sb.append("Cache-Control: ").append(if (noStore) "no-store" else cacheFor(ext)).append("\r\n")
        sb.append("Connection: ").append(if (req.keep) "keep-alive" else "close").append("\r\n\r\n")
        out.write(sb.toString().toByteArray(Charsets.ISO_8859_1))
        if (req.method != "HEAD" && length > 0) {
            RandomAccessFile(f, "r").use { raf ->
                raf.seek(start)
                val buf = ByteArray(64 * 1024)
                var left = length
                while (left > 0) {
                    val r = raf.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                    if (r < 0) break
                    out.write(buf, 0, r)
                    left -= r
                }
            }
        }
        return req.keep
    }

    private fun cacheFor(ext: String): String = when (ext) {
        "png", "jpg", "jpeg", "gif", "webp", "ogg", "m4a", "mp3", "wav", "webm", "mp4",
        "ttf", "otf", "woff", "woff2", "rpgmvp", "rpgmvo", "rpgmvm" -> "public, max-age=86400"
        else -> "no-cache"
    }

    private fun mime(ext: String): String = when (ext) {
        "html", "htm" -> "text/html; charset=utf-8"
        "js", "mjs" -> "application/javascript; charset=utf-8"
        "json" -> "application/json; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "txt", "toml", "md" -> "text/plain; charset=utf-8"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "gif" -> "image/gif"
        "webp" -> "image/webp"
        "svg" -> "image/svg+xml"
        "ogg" -> "audio/ogg"
        "mp3" -> "audio/mpeg"
        "m4a" -> "audio/mp4"
        "wav" -> "audio/wav"
        "webm" -> "video/webm"
        "mp4" -> "video/mp4"
        "ttf" -> "font/ttf"
        "otf" -> "font/otf"
        "woff" -> "font/woff"
        "woff2" -> "font/woff2"
        else -> "application/octet-stream"
    }

    // ------------------------------------------------------------------ respostas simples

    private fun sendText(out: OutputStream, code: Int, reason: String, text: String, keep: Boolean): Boolean {
        return sendBytes(out, code, reason, "text/plain; charset=utf-8", text.toByteArray(Charsets.UTF_8), keep, "no-store", false)
    }

    private fun sendBytes(
        out: OutputStream,
        code: Int,
        reason: String,
        type: String,
        data: ByteArray,
        keep: Boolean,
        cache: String,
        headOnly: Boolean
    ): Boolean {
        val h = "HTTP/1.1 $code $reason\r\nContent-Type: $type\r\nContent-Length: ${data.size}\r\n" +
            "Cache-Control: $cache\r\nConnection: " + (if (keep) "keep-alive" else "close") + "\r\n\r\n"
        out.write(h.toByteArray(Charsets.ISO_8859_1))
        if (!headOnly) out.write(data)
        return keep
    }

    companion object {
        private const val PREFERRED_PORT = 38541
        private const val MAX_BODY = 64L * 1024 * 1024
    }
}
