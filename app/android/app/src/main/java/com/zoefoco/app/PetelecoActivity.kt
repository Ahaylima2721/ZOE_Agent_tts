package com.zoefoco.app

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.window.OnBackInvokedDispatcher
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A Zoe por cima do app proibido. Nível 1: cutucada. Nível 2: peteleco. Nível 3: bloqueio.
 * Qualquer saída (botão, voltar, home) manda para a tela inicial do celular.
 */
class PetelecoActivity : Activity() {

    companion object {
        const val EXTRA_NIVEL = "nivel"
        const val EXTRA_PACOTE = "pacote"
        const val EXTRA_FIM = "fim"
    }

    private lateinit var web: WebView
    private var tts: TextToSpeech? = null
    private var ttsPronto = false
    private var falaPendente: String? = null
    private var pacote = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = Web.criar(this, Ponte(), Color.TRANSPARENT)
        setContentView(Web.moldura(this, web, Color.TRANSPARENT, iconesEscuros = false))
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { irParaInicio() }
        }
        if (Store.voz(this)) {
            tts = TextToSpeech(this) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    tts?.language = Locale("pt", "BR")
                    ttsPronto = true
                    falaPendente?.let { falar(it) }
                }
            }
        }
        mostrar(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        mostrar(intent)
    }

    private fun mostrar(i: Intent) {
        val nivel = i.getIntExtra(EXTRA_NIVEL, 1)
        pacote = i.getStringExtra(EXTRA_PACOTE) ?: ""
        val fim = i.getLongExtra(EXTRA_FIM, System.currentTimeMillis())
        val faltam = ((fim - System.currentTimeMillis()) / 60_000).coerceAtLeast(1)
        val ate = SimpleDateFormat("HH:mm", Locale("pt", "BR")).format(Date(fim))
        val nome = try {
            packageManager.getApplicationLabel(packageManager.getApplicationInfo(pacote, 0)).toString()
        } catch (e: PackageManager.NameNotFoundException) {
            "esse app"
        }
        val q = "nivel=$nivel&app=${Uri.encode(nome)}&ate=$ate&faltam=$faltam" +
            "&tom=${Store.tom(this)}&energia=${Store.energia(this)}"
        web.loadUrl("file:///android_asset/www/peteleco.html?$q")
        vibrar(nivel)
    }

    private fun vibrar(nivel: Int) {
        val v: Vibrator = if (Build.VERSION.SDK_INT >= 31) {
            getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Vibrator::class.java)
        }
        val padrao = when (nivel) {
            1 -> longArrayOf(0, 40)
            2 -> longArrayOf(0, 60, 70, 140)
            else -> longArrayOf(0, 220)
        }
        v.vibrate(VibrationEffect.createWaveform(padrao, -1))
    }

    private fun falar(texto: String) {
        if (!ttsPronto) {
            falaPendente = texto; return
        }
        tts?.speak(texto, TextToSpeech.QUEUE_FLUSH, null, "zoe")
    }

    private fun irParaInicio() {
        startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    @Deprecated("Usado só até o Android 12")
    @Suppress("DEPRECATION")
    override fun onBackPressed() = irParaInicio()

    override fun onStop() {
        super.onStop()
        if (!isFinishing) finish()
    }

    override fun onDestroy() {
        tts?.shutdown()
        super.onDestroy()
    }

    inner class Ponte {
        @JavascriptInterface
        fun ok() = runOnUiThread { irParaInicio() }

        @JavascriptInterface
        fun emergencia() = runOnUiThread {
            Store.usarEmergencia(this@PetelecoActivity)
            val abrir = packageManager.getLaunchIntentForPackage(pacote)
            if (abrir != null) startActivity(abrir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
        }

        @JavascriptInterface
        fun falar(texto: String) = runOnUiThread { this@PetelecoActivity.falar(texto) }
    }
}
