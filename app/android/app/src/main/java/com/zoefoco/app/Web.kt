package com.zoefoco.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.view.View
import android.view.WindowInsets
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

/**
 * A interface da Zoe é HTML local (assets/www), desenhada num WebView do próprio sistema.
 * Links externos (fontes das perguntas) abrem no navegador do celular, nunca dentro do app.
 */
object Web {

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    fun criar(a: Activity, ponte: Any, fundo: Int, aoCarregar: () -> Unit = {}): WebView {
        val w = WebView(a)
        w.settings.javaScriptEnabled = true
        w.settings.domStorageEnabled = true
        w.settings.allowContentAccess = false
        w.setBackgroundColor(fundo)
        w.overScrollMode = View.OVER_SCROLL_NEVER
        w.webChromeClient = WebChromeClient()
        w.webViewClient = object : WebViewClient() {
            // Só páginas do próprio app dentro do WebView. Links https abrem no navegador.
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                val url = r.url
                if (url.toString().startsWith("file:///android_asset/")) return false
                if (url.scheme == "https") {
                    try {
                        a.startActivity(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE))
                    } catch (e: Exception) { /* sem navegador */ }
                }
                return true
            }

            override fun onPageFinished(v: WebView, url: String) = aoCarregar()
        }
        w.addJavascriptInterface(ponte, "Zoe")
        return w
    }

    /** Coloca o WebView numa moldura que respeita a barra de status e a de navegação. */
    fun moldura(a: Activity, w: WebView, corFundo: Int, iconesEscuros: Boolean): FrameLayout {
        val f = FrameLayout(a)
        f.setBackgroundColor(corFundo)
        f.addView(w, FrameLayout.LayoutParams(-1, -1))
        f.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        @Suppress("DEPRECATION")
        if (iconesEscuros) {
            a.window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }
        return f
    }

    val NOITE = Color.parseColor("#160A33")
    val FUNDO = Color.parseColor("#F6F2FF")
}
