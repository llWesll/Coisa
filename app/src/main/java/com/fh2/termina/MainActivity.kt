package com.fh2.termina

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Environment
import android.os.Process
import android.provider.Settings
import android.view.Gravity
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceResponse
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Toast
import android.widget.TextView
import java.io.File
import java.util.UUID

class MainActivity : Activity() {

    private var web: WebView? = null
    private var server: GameServer? = null
    private val held = HashSet<Int>()
    private var browseDir: File? = null
    private val logLines = ArrayList<String>()
    private var logView: TextView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // 60 Hz: o jogo roda a 60 fps; evita gastar bateria/calor em telas de 90/120 Hz
        val lp = window.attributes
        lp.preferredRefreshRate = 60f
        window.attributes = lp
        startOrSetup()
    }

    override fun onResume() {
        super.onResume()
        if (web == null) {
            startOrSetup()
        } else {
            web?.onResume()
            web?.resumeTimers()
            web?.evaluateJavascript(
                "try{if(window.WebAudio&&WebAudio._context&&WebAudio._context.resume)WebAudio._context.resume();}catch(e){}",
                null
            )
        }
    }

    override fun onPause() {
        releaseAllKeys()
        web?.evaluateJavascript(
            "try{if(window.WebAudio&&WebAudio._context&&WebAudio._context.suspend)WebAudio._context.suspend();}catch(e){}",
            null
        )
        web?.onPause()
        web?.pauseTimers()
        super.onPause()
    }

    override fun onDestroy() {
        try {
            web?.destroy()
        } catch (e: Exception) {
        }
        web = null
        server?.stop()
        server = null
        super.onDestroy()
        if (isFinishing) Process.killProcess(Process.myPid())
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            val c = window.insetsController
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars())
                c.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
        }
    }

    // ------------------------------------------------------------------ localizar o jogo / permissões

    private fun hasStorageAccess(): Boolean {
        return if (Build.VERSION.SDK_INT >= 30) {
            Environment.isExternalStorageManager()
        } else {
            checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun requestStorageAccess() {
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                startActivity(
                    Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName"))
                )
            } catch (e: Exception) {
                startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
            }
        } else {
            requestPermissions(
                arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE),
                1
            )
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (web == null) startOrSetup()
    }

    private fun isWww(d: File): Boolean =
        File(d, "index.html").isFile && File(d, "js/rpg_core.js").isFile

    private fun findGame(): File? {
        val saved = getSharedPreferences("fh2", MODE_PRIVATE).getString("gamePath", null)
        if (saved != null) {
            val f = File(saved)
            if (isWww(f)) return f
            if (isWww(File(f, "www"))) return File(f, "www")
        }
        val roots = ArrayList<File>()
        getExternalFilesDir(null)?.let {
            roots.add(File(it, "game"))
            roots.add(it)
        }
        val sd = Environment.getExternalStorageDirectory()
        roots.add(File(sd, "FearAndHunger2"))
        roots.add(File(sd, "MTool/Games"))
        roots.add(File(sd, "Games"))
        roots.add(File(sd, "Download"))
        val found = ArrayList<File>()
        for (r in roots) scan(r, 3, found)
        return found.firstOrNull {
            it.path.contains("fear", ignoreCase = true) || it.path.contains("termina", ignoreCase = true)
        } ?: found.firstOrNull()
    }

    private fun scan(dir: File, depth: Int, out: MutableList<File>) {
        if (!dir.isDirectory) return
        if (File(dir, "index.html").isFile && File(dir, "js/rpg_core.js").isFile) {
            out.add(dir)
            return
        }
        if (depth <= 0) return
        val subs = dir.listFiles() ?: return
        subs.sortBy { it.name }
        for (s in subs) {
            val n = s.name
            if (!s.isDirectory || n.startsWith(".") || n == "__MACOSX" || n == "img" || n == "audio" || n == "data" || n == "js" || n == "save") continue
            scan(s, depth - 1, out)
        }
    }

    private fun startOrSetup() {
        val www = findGame()
        if (www == null) showSetup() else startGame(www)
    }

    private fun showSetup() {
        val ctx = this
        val col = LinearLayout(ctx)
        col.orientation = LinearLayout.VERTICAL
        col.setPadding(48, 48, 48, 48)

        fun label(text: String, size: Float, bold: Boolean): TextView {
            val t = TextView(ctx)
            t.text = text
            t.textSize = size
            t.setTextColor(Color.WHITE)
            if (bold) t.setTypeface(t.typeface, android.graphics.Typeface.BOLD)
            t.setPadding(0, 0, 0, 24)
            return t
        }

        val appDir = getExternalFilesDir(null)?.absolutePath ?: "(indisponível)"
        col.addView(label("Fear & Hunger 2: Termina", 22f, true))
        col.addView(label("Não encontrei a pasta do jogo (a que contém index.html e js/rpg_core.js, normalmente chamada \"www\").", 15f, false))
        col.addView(label("Coloque a pasta do jogo em um destes lugares:", 15f, false))
        col.addView(label("• /sdcard/FearAndHunger2/\n• /sdcard/MTool/Games/Fear and Hunger 2 - Termina/\n• $appDir/game/", 14f, false))
        if (!hasStorageAccess()) {
            col.addView(label("Para ler/gravar a pasta do jogo (e os saves), conceda acesso a todos os arquivos:", 15f, false))
            val b = Button(ctx)
            b.text = "Conceder acesso a arquivos"
            b.setOnClickListener { requestStorageAccess() }
            col.addView(b)
        }
        val games = File(Environment.getExternalStorageDirectory(), "MTool/Games")
        col.addView(label(
            "Diagnóstico: acesso a arquivos = " + (if (hasStorageAccess()) "SIM" else "NÃO") +
                " | MTool/Games existe = " + (if (games.isDirectory) "sim" else "não") +
                " | consigo listar = " + (if (games.list() != null) "sim" else "não"),
            12f, false
        ))
        val manual = Button(ctx)
        manual.text = "Escolher a pasta manualmente"
        manual.setOnClickListener { showBrowser(Environment.getExternalStorageDirectory()) }
        col.addView(manual)
        val retry = Button(ctx)
        retry.text = "Procurar novamente"
        retry.setOnClickListener { startOrSetup() }
        col.addView(retry)

        val sv = ScrollView(ctx)
        sv.setBackgroundColor(Color.BLACK)
        sv.addView(col)
        setContentView(sv)
        hideSystemBars()
    }

    // ------------------------------------------------------------------ escolha manual da pasta

    private fun browseUp() {
        val d = browseDir ?: return
        val parent = d.parentFile
        if (parent == null || d.absolutePath == Environment.getExternalStorageDirectory().absolutePath) {
            browseDir = null
            showSetup()
        } else {
            showBrowser(parent)
        }
    }

    private fun tryUse(dir: File) {
        val www = if (isWww(dir)) dir else File(dir, "www").takeIf { isWww(it) }
        if (www == null) {
            Toast.makeText(
                this,
                "Esta pasta não contém o jogo (precisa ter index.html e js/rpg_core.js). Entre na pasta do jogo ou na pasta www.",
                Toast.LENGTH_LONG
            ).show()
        } else {
            getSharedPreferences("fh2", MODE_PRIVATE).edit().putString("gamePath", www.absolutePath).apply()
            browseDir = null
            startGame(www)
        }
    }

    private fun showBrowser(dir: File) {
        browseDir = dir
        val ctx = this
        val col = LinearLayout(ctx)
        col.orientation = LinearLayout.VERTICAL
        col.setPadding(32, 32, 32, 32)

        fun tv(text: String, size: Float): TextView {
            val t = TextView(ctx)
            t.text = text
            t.textSize = size
            t.setTextColor(Color.WHITE)
            t.setPadding(0, 0, 0, 16)
            return t
        }

        col.addView(tv("Escolha a pasta do jogo", 20f))
        col.addView(tv(dir.absolutePath, 13f))
        val use = Button(ctx)
        use.text = "✔ Usar esta pasta"
        use.setOnClickListener { tryUse(dir) }
        col.addView(use)
        val up = Button(ctx)
        up.text = "⬆ Subir uma pasta"
        up.setOnClickListener { browseUp() }
        col.addView(up)

        val subs = dir.listFiles()
        if (subs == null) {
            col.addView(tv("Não consigo listar esta pasta. Conceda o acesso a todos os arquivos.", 14f))
            val g = Button(ctx)
            g.text = "Conceder acesso a arquivos"
            g.setOnClickListener { requestStorageAccess() }
            col.addView(g)
        } else {
            val dirs = subs.filter { it.isDirectory && !it.name.startsWith(".") }.sortedBy { it.name.lowercase() }
            if (dirs.isEmpty()) col.addView(tv("(sem subpastas)", 14f))
            for (s in dirs) {
                val b = Button(ctx)
                val mark = if (isWww(s) || isWww(File(s, "www"))) "★ " else ""
                b.setAllCaps(false)
                b.text = mark + "📁 " + s.name
                b.setOnClickListener { showBrowser(s) }
                col.addView(b)
            }
        }

        val sv = ScrollView(ctx)
        sv.setBackgroundColor(Color.BLACK)
        sv.addView(col)
        setContentView(sv)
        hideSystemBars()
    }

    // ------------------------------------------------------------------ jogo

    @SuppressLint("SetJavaScriptEnabled")
    private fun startGame(www: File) {
        browseDir = null
        val token = UUID.randomUUID().toString().replace("-", "")
        val srv = GameServer(www, token, { msg -> addLog(msg, true) }) { name ->
            try {
                assets.open("shim/$name").use { it.readBytes() }
            } catch (e: Exception) {
                null
            }
        }
        val port = srv.start()
        server = srv

        WebView.setWebContentsDebuggingEnabled(File(www, "android_debug.txt").exists())

        val wv = WebView(this)
        wv.setBackgroundColor(Color.BLACK)
        wv.overScrollMode = View.OVER_SCROLL_NEVER
        wv.isVerticalScrollBarEnabled = false
        wv.isHorizontalScrollBarEnabled = false
        wv.isLongClickable = false
        wv.setOnLongClickListener { true }

        val s = wv.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.displayZoomControls = false
        s.useWideViewPort = false
        s.loadWithOverviewMode = false
        s.textZoom = 100
        s.javaScriptCanOpenWindowsAutomatically = false
        // UA de desktop: o RPG Maker MV usa caminhos de desktop (áudio WebAudio, vídeo .webm etc.)
        s.userAgentString = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 NWjs/0.80"

        wv.addJavascriptInterface(Bridge(), "AndroidBridge")
        wv.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val host = request?.url?.host
                return host != "127.0.0.1"
            }

            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                runOnUiThread { recreate() }
                return true
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                val u = request?.url?.toString() ?: "?"
                addLog("ERRO de rede: " + u + " (" + error?.description + ")", request?.isForMainFrame == true || u.endsWith(".js"))
            }

            override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: WebResourceResponse?) {
                val u = request?.url?.toString() ?: "?"
                val important = u.endsWith(".js") || u.endsWith("index.html") || u.endsWith(".json")
                addLog("HTTP " + errorResponse?.statusCode + ": " + u, important)
            }
        }
        wv.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(cm: ConsoleMessage?): Boolean {
                if (cm != null && cm.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    addLog("JS: " + cm.message() + " (" + cm.sourceId().substringAfterLast('/') + ":" + cm.lineNumber() + ")", true)
                }
                return true
            }
        }

        val frame = FrameLayout(this)
        frame.setBackgroundColor(Color.BLACK)
        frame.addView(wv, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        val lv = TextView(this)
        lv.setTextColor(Color.YELLOW)
        lv.setBackgroundColor(0xDD000000.toInt())
        lv.textSize = 10f
        lv.typeface = android.graphics.Typeface.MONOSPACE
        lv.setPadding(12, 8, 12, 8)
        lv.visibility = View.GONE
        lv.setOnClickListener { lv.visibility = View.GONE }
        frame.addView(lv, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP))
        logView = lv
        logLines.clear()
        setContentView(frame)
        web = wv
        hideSystemBars()
        wv.requestFocus()
        wv.loadUrl("http://127.0.0.1:$port/index.html")

        // vigia: se em 15 s o jogo não iniciou, mostra o log na tela
        Handler(Looper.getMainLooper()).postDelayed({
            web?.evaluateJavascript(
                "(typeof SceneManager!=='undefined'&&SceneManager._scene)?'1':'0'"
            ) { r ->
                if (r != "\"1\"" && r != "1") {
                    addLog("O jogo não iniciou em 15 s (SceneManager sem cena). Veja os erros acima/abaixo e me envie um print.", true)
                }
            }
        }, 15000)
    }

    private fun addLog(line: String, show: Boolean) {
        runOnUiThread {
            logLines.add(line)
            if (logLines.size > 30) logLines.removeAt(0)
            val lv = logView
            if (lv != null) {
                lv.text = "(toque aqui para fechar)\n" + logLines.joinToString("\n")
                if (show) lv.visibility = View.VISIBLE
            }
        }
    }

    inner class Bridge {
        @JavascriptInterface
        fun exit() {
            runOnUiThread { finishAndRemoveTask() }
        }
    }

    // ------------------------------------------------------------------ gamepad

    private fun mapPadKey(keyCode: Int): Int = when (keyCode) {
        KeyEvent.KEYCODE_DPAD_LEFT -> 37
        KeyEvent.KEYCODE_DPAD_UP -> 38
        KeyEvent.KEYCODE_DPAD_RIGHT -> 39
        KeyEvent.KEYCODE_DPAD_DOWN -> 40
        KeyEvent.KEYCODE_BUTTON_A -> 13 // confirmar
        KeyEvent.KEYCODE_BUTTON_B -> 27 // cancelar / menu
        KeyEvent.KEYCODE_BUTTON_Y -> 27 // menu
        KeyEvent.KEYCODE_BUTTON_X -> 16 // correr (shift)
        KeyEvent.KEYCODE_BUTTON_L1 -> 33 // página anterior
        KeyEvent.KEYCODE_BUTTON_R1 -> 34 // próxima página
        KeyEvent.KEYCODE_BUTTON_L2 -> 16
        KeyEvent.KEYCODE_BUTTON_R2 -> 16
        KeyEvent.KEYCODE_BUTTON_THUMBL -> 16
        KeyEvent.KEYCODE_BUTTON_THUMBR -> 16
        KeyEvent.KEYCODE_BUTTON_START -> 27
        KeyEvent.KEYCODE_BUTTON_SELECT -> 9
        else -> -1
    }

    private fun setKey(code: Int, down: Boolean, fromPad: Boolean) {
        if (down) {
            if (!held.add(code)) return
        } else {
            if (!held.remove(code)) return
        }
        web?.evaluateJavascript("window.__k&&window.__k($code,$down,$fromPad)", null)
    }

    private fun releaseAllKeys() {
        for (c in held.toList()) setKey(c, false, false)
    }

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        if (web == null && browseDir != null && e.keyCode == KeyEvent.KEYCODE_BACK) {
            if (e.action == KeyEvent.ACTION_UP) browseUp()
            return true
        }
        if (web != null) {
            if (e.keyCode == KeyEvent.KEYCODE_BACK) {
                if (e.action == KeyEvent.ACTION_DOWN && e.repeatCount == 0) setKey(27, true, false)
                else if (e.action == KeyEvent.ACTION_UP) setKey(27, false, false)
                return true
            }
            val src = e.source
            val isPad = (src and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD ||
                (src and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
            if (isPad) {
                val code = mapPadKey(e.keyCode)
                if (code >= 0) {
                    if (e.action == KeyEvent.ACTION_DOWN) {
                        if (e.repeatCount == 0) setKey(code, true, true)
                    } else if (e.action == KeyEvent.ACTION_UP) {
                        setKey(code, false, true)
                    }
                    return true
                }
            }
        }
        return super.dispatchKeyEvent(e)
    }

    private fun axisKey(code: Int, v: Float) {
        if (v > 0.55f) setKey(code, true, true) else if (v < 0.35f) setKey(code, false, true)
    }

    override fun dispatchGenericMotionEvent(e: MotionEvent): Boolean {
        if (web != null &&
            (e.source and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK &&
            e.action == MotionEvent.ACTION_MOVE
        ) {
            val ax = e.getAxisValue(MotionEvent.AXIS_X)
            val ay = e.getAxisValue(MotionEvent.AXIS_Y)
            val hx = e.getAxisValue(MotionEvent.AXIS_HAT_X)
            val hy = e.getAxisValue(MotionEvent.AXIS_HAT_Y)
            axisKey(37, maxOf(-ax, -hx))
            axisKey(39, maxOf(ax, hx))
            axisKey(38, maxOf(-ay, -hy))
            axisKey(40, maxOf(ay, hy))
            return true
        }
        return super.dispatchGenericMotionEvent(e)
    }
}
