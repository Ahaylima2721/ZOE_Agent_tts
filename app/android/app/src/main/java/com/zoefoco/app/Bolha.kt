package com.zoefoco.app

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.hypot

/**
 * A bolinha da Zoe por cima de qualquer app (fora do foco), estilo "chat head".
 * Modos da janela:
 *  - bolha:  pequena, na borda da tela, arrastável; tocar abre o cartão; soltar no X dispensa
 *  - topo:   cartão no topo (1º aviso de rolagem), o app continua visível embaixo
 *  - tela:   tela cheia escurecida (cartão aberto, 2º aviso de rolagem)
 * Some sozinha se ninguém tocar (30 s na bolha, 60 s no topo, 2 min na tela).
 */
@SuppressLint("StaticFieldLeak")
object Bolha {
    @Volatile var visivel = false
        private set

    private val h = Handler(Looper.getMainLooper())
    private var ctx: Context? = null
    private var wm: WindowManager? = null
    private var raiz: Moldura? = null
    private var web: WebView? = null
    private var lp: WindowManager.LayoutParams? = null
    private var alvoX: TextView? = null
    private var alvoLp: WindowManager.LayoutParams? = null
    private var recado: JSONObject = JSONObject()
    private var modo = "bolha"
    private var lado = "direita"
    private val sumir = Runnable { fechar(ignorou = true) }

    private fun dp(v: Int) = (v * (ctx?.resources?.displayMetrics?.density ?: 3f)).toInt()

    private fun tela(): Pair<Int, Int> {
        val m = ctx!!.resources.displayMetrics
        return m.widthPixels to m.heightPixels
    }

    fun mostrar(c: Context, r: JSONObject) = h.post { abrir(c.applicationContext, r) }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    private fun abrir(c: Context, r: JSONObject) {
        if (visivel || !Perms.sobrepor(c)) return
        ctx = c
        recado = r
        modo = r.optString("modo", "bolha")
        lado = "direita"
        wm = c.getSystemService(WindowManager::class.java)

        val w = WebView(c)
        w.settings.javaScriptEnabled = true
        w.setBackgroundColor(Color.TRANSPARENT)
        w.overScrollMode = View.OVER_SCROLL_NEVER
        w.isVerticalScrollBarEnabled = false
        w.webChromeClient = WebChromeClient()
        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, req: android.webkit.WebResourceRequest) = true
        }
        w.addJavascriptInterface(Ponte(), "Zoe")
        web = w

        val m = Moldura(c)
        m.addView(w, FrameLayout.LayoutParams(-1, -1))
        raiz = m

        lp = WindowManager.LayoutParams().apply {
            type = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            format = PixelFormat.TRANSLUCENT
            flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            gravity = Gravity.TOP or Gravity.START
        }
        aplicarModo()
        try {
            wm!!.addView(m, lp)
        } catch (e: Exception) {
            limpar(); return
        }
        visivel = true
        w.loadUrl("file:///android_asset/www/bolha.html")
        manterVivo(c, true)
        agendarSumir()
    }

    private fun aplicarModo() {
        val p = lp ?: return
        val (sw, sh) = tela()
        when (modo) {
            "bolha" -> {
                p.width = dp(300); p.height = dp(116)
                p.x = if (lado == "direita") sw - p.width else 0
                if (p.y == 0) p.y = (sh * 0.32).toInt()
            }
            "topo" -> {
                p.width = WindowManager.LayoutParams.MATCH_PARENT
                if (p.height <= 0 || p.height == WindowManager.LayoutParams.MATCH_PARENT) p.height = dp(330)
                p.x = 0; p.y = 0
            }
            else -> {
                p.width = WindowManager.LayoutParams.MATCH_PARENT
                p.height = WindowManager.LayoutParams.MATCH_PARENT
                p.x = 0; p.y = 0
            }
        }
    }

    private fun atualizar() {
        try {
            raiz?.let { wm?.updateViewLayout(it, lp) }
        } catch (e: Exception) { /* janela já saiu */ }
    }

    private fun agendarSumir() {
        h.removeCallbacks(sumir)
        h.postDelayed(sumir, when (modo) { "bolha" -> 30_000L; "topo" -> 60_000L; else -> 120_000L })
    }

    fun fechar(ignorou: Boolean) = h.post {
        if (!visivel) return@post
        val c = ctx
        if (ignorou && c != null) Store.recadoIgnorado(c)
        limpar()
    }

    private fun limpar() {
        h.removeCallbacks(sumir)
        esconderAlvo()
        try {
            raiz?.let { wm?.removeView(it) }
        } catch (e: Exception) { /* já saiu */ }
        web?.destroy()
        web = null; raiz = null; lp = null
        visivel = false
        ctx?.let { manterVivo(it, false) }
    }

    private fun depois(acao: String) {
        val c = ctx ?: return
        limpar()
        when (acao) {
            "home" -> c.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            "pilula", "pilulaTroca", "estudos" -> c.startActivity(Intent(c, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(MainActivity.EXTRA_ROTA, if (acao == "estudos") "estudos" else "pilula")
                .putExtra(MainActivity.EXTRA_TROCA, acao == "pilulaTroca"))
        }
    }

    // ---------------- o X para dispensar ----------------

    private fun mostrarAlvo() {
        val c = ctx ?: return
        if (alvoX != null) return
        val t = TextView(c).apply {
            text = "✕"
            textSize = 26f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.argb(150, 22, 10, 51))
                setStroke(dp(2), Color.WHITE)
            }
            contentDescription = "Solte aqui para dispensar"
        }
        val (sw, sh) = tela()
        alvoLp = WindowManager.LayoutParams(dp(76), dp(76),
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.START
            x = sw / 2 - dp(38); y = sh - dp(170)
        }
        try {
            wm?.addView(t, alvoLp); alvoX = t
        } catch (e: Exception) { /* sem X */ }
    }

    private fun esconderAlvo() {
        try {
            alvoX?.let { wm?.removeView(it) }
        } catch (e: Exception) { }
        alvoX = null
    }

    /** Centro da bolinha (o orbe fica do lado da borda). */
    private fun centroOrbe(): Pair<Int, Int> {
        val p = lp!!
        val x = if (lado == "direita") p.x + p.width - dp(46) else p.x + dp(46)
        return x to p.y + p.height / 2
    }

    private fun pertoDoX(): Boolean {
        val a = alvoLp ?: return false
        val (x, y) = centroOrbe()
        return hypot((x - (a.x + dp(38))).toDouble(), (y - (a.y + dp(38))).toDouble()) < dp(90)
    }

    /** Moldura que deixa a página receber toques, mas assume o arrastar quando o dedo se move. */
    private class Moldura(c: Context) : FrameLayout(c) {
        private val slop = ViewConfiguration.get(c).scaledTouchSlop
        private var x0 = 0f; private var y0 = 0f
        private var px0 = 0; private var py0 = 0
        private var arrastando = false

        override fun onInterceptTouchEvent(e: MotionEvent): Boolean {
            if (e.actionMasked == MotionEvent.ACTION_DOWN) {
                h.removeCallbacks(sumir); agendarSumir()
            }
            if (modo != "bolha") return false
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    x0 = e.rawX; y0 = e.rawY; px0 = lp?.x ?: 0; py0 = lp?.y ?: 0; arrastando = false
                }
                MotionEvent.ACTION_MOVE -> if (!arrastando && (abs(e.rawX - x0) > slop || abs(e.rawY - y0) > slop)) {
                    arrastando = true
                    web?.evaluateJavascript("window.zoeArrastando && zoeArrastando(true)", null)
                    mostrarAlvo()
                    return true
                }
            }
            return arrastando
        }

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(e: MotionEvent): Boolean {
            if (!arrastando) return super.onTouchEvent(e)
            val p = lp ?: return true
            when (e.actionMasked) {
                MotionEvent.ACTION_MOVE -> {
                    p.x = px0 + (e.rawX - x0).toInt()
                    p.y = py0 + (e.rawY - y0).toInt()
                    atualizar()
                    alvoX?.alpha = if (pertoDoX()) 1f else 0.6f
                    alvoX?.scaleX = if (pertoDoX()) 1.2f else 1f
                    alvoX?.scaleY = alvoX?.scaleX ?: 1f
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    arrastando = false
                    if (pertoDoX()) {
                        fechar(ignorou = true)
                    } else {
                        esconderAlvo()
                        val (sw, sh) = tela()
                        val (cx, _) = centroOrbe()
                        lado = if (cx < sw / 2) "esquerda" else "direita"
                        p.x = if (lado == "direita") sw - p.width else 0
                        p.y = p.y.coerceIn(dp(40), sh - p.height - dp(40))
                        atualizar()
                        web?.evaluateJavascript("window.zoeArrastando && zoeArrastando(false, '$lado')", null)
                    }
                }
            }
            return true
        }
    }

    // ---------------- ponte com bolha.html ----------------

    class Ponte {
        @JavascriptInterface
        fun dados(): String = JSONObject(recado.toString()).put("lado", lado).put("energia", ctx?.let { Store.energia(it) } ?: 50).toString()

        @JavascriptInterface
        fun expandir() = h.post {
            modo = "tela"; aplicarModo(); atualizar(); agendarSumir()
        }

        @JavascriptInterface
        fun altura(cssPx: Int) = h.post {
            if (modo == "topo") {
                lp?.height = dp(cssPx.coerceIn(120, 600)); atualizar()
            }
        }

        @JavascriptInterface
        fun responder(id: String): String {
            val c = ctx ?: return "{}"
            h.post { h.removeCallbacks(sumir) }
            return Recados.responder(c, id).toString()
        }

        @JavascriptInterface
        fun concluir(acao: String) = h.post { depois(acao) }

        @JavascriptInterface
        fun fechar() = Bolha.fechar(ignorou = true)
    }

    // ---------------- mantém o app vivo enquanto a bolinha aparece ----------------

    private fun manterVivo(c: Context, sim: Boolean) {
        val i = Intent(c, BolhaService::class.java)
        try {
            if (sim) c.startForegroundService(i) else c.stopService(i)
        } catch (e: Exception) { /* sem serviço: a bolinha dura pouco, segue sem */ }
    }
}

class BolhaService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("bolha", "Bolinha da Zoe", NotificationManager.IMPORTANCE_MIN).apply {
            description = "Aparece rapidinho enquanto a Zoe mostra um recado"
            setShowBadge(false)
        })
        val n = Notification.Builder(this, "bolha")
            .setSmallIcon(R.drawable.ic_zoe)
            .setContentTitle("A Zoe tem um recado")
            .build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(7, n)
        if (!Bolha.visivel) stopSelf()
        return START_NOT_STICKY
    }
}
